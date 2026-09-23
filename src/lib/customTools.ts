// Dynamic AI Custom Tool Management System
// Enables Helios AI and external models to dynamically invent, persist, improve,
// and execute reusable editing tools and macro recipes.
//
// A tool is one of two kinds:
//   - ops:   an edit program template (`opsTemplate`), applied to the timeline as one undo step.
//   - steps: an ordered list of calls to any other Helios tool (`steps`) — run_command for FFmpeg
//            or a script, import_media, add_captions, another custom tool… — for what the edit
//            program cannot express. This is how the AI builds a capability Helios does not have.

import type { Op, Program } from './editProgram';
import type { Recipe, Context } from './recipes';
import type { Comp } from './types';
import type { AssetMap } from './timeline';
import { compDuration, tracksOf } from './timeline';
import { api, errorText } from './ipc';

export type OpTemplate = Record<string, unknown>;

export type CustomToolParam = {
  name: string;
  kind: 'number' | 'text' | 'boolean' | 'style' | 'media';
  about: string;
  default?: number | string | boolean;
  required?: boolean;
};

/**
 * One call in a steps tool. `args` are templated like opsTemplate, plus `$prev.<path>` /
 * `$steps.<as>.<path>` for earlier results and `${q:param}` for a shell-quoted value.
 */
export type ToolStep = {
  tool: string;
  args?: Record<string, unknown>;
  /** Name this step's result for later steps (`$steps.<as>.…`); steps are also reachable by index. */
  as?: string;
  /** Keep going when this step fails (the default stops the tool there). */
  continueOnError?: boolean;
  /** What the step is for, shown when the tool runs. */
  about?: string;
};

export type CustomTool = {
  version: 1;
  id: string;
  name: string;
  description: string;
  params: CustomToolParam[];
  /** Empty for a steps tool. */
  opsTemplate: OpTemplate[];
  /** Present (non-empty) for a steps tool. */
  steps?: ToolStep[];
  promptGuide?: string;
  author: 'ai' | 'user';
  createdAt: string;
  updatedAt: string;
  usageCount: number;
  lastUsedAt?: string;
  lastResult?: { ok: boolean; summary?: string };
};

// In-memory cache for fast lookup during editing sessions
let cachedTools: CustomTool[] | null = null;

export function validateToolName(name: string): string | null {
  if (!name || typeof name !== 'string') return 'Tool name is required';
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 64) return 'Tool name must be between 2 and 64 characters';
  if (!/^[a-z0-9_-]+$/i.test(trimmed)) return 'Tool name can only contain letters, numbers, underscores, and dashes';
  return null;
}

/** Looks a value up by name; `undefined` means "not mine". */
type Resolve = (key: string) => unknown;

/** Follows `a.b.0.c` into objects and arrays. */
export function valueAtPath(root: unknown, path: string[]): unknown {
  let at: unknown = root;
  for (const part of path) {
    if (at === null || at === undefined) return undefined;
    if (Array.isArray(at) && /^\d+$/.test(part)) at = at[Number(part)];
    else if (typeof at === 'object') at = (at as Record<string, unknown>)[part];
    else return undefined;
  }
  return at;
}

/** Where steps tools may write files, and the FFmpeg Helios found — set once at startup. */
const toolEnv: { workDir?: string; ffmpeg?: string; windows?: boolean } = {};
export function setCustomToolEnv(env: { workDir?: string; ffmpeg?: string | null; windows?: boolean }) {
  toolEnv.workDir = env.workDir;
  toolEnv.ffmpeg = env.ffmpeg ?? undefined;
  toolEnv.windows = env.windows;
}

const defaultShell = (): 'powershell' | 'sh' =>
  (toolEnv.windows ?? (typeof navigator !== 'undefined' && /windows/i.test(navigator.userAgent ?? ''))) ? 'powershell' : 'sh';

/** A value quoted for the shell run_command uses: PowerShell on Windows, sh elsewhere. */
export function shellQuote(value: unknown, flavor: 'powershell' | 'sh' = defaultShell()): string {
  const text = value === null || value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value);
  return flavor === 'powershell' ? `'${text.replace(/'/g, "''")}'` : `'${text.replace(/'/g, `'\\''`)}'`;
}

const WHOLE = /^\$[a-zA-Z0-9_.]+$/;

/**
 * Fills `$name` (a whole value, keeping its type) and `${name}` (inside text) from `resolve`.
 * `${q:name}` is the shell-quoted form. An array item `$name` naming an array spreads it.
 * Unknown `$name` stays as written; unknown `${name}` becomes '' — except dotted names, which stay.
 */
function fill(value: unknown, resolve: Resolve): unknown {
  if (typeof value === 'string') {
    if (WHOLE.test(value)) {
      const found = resolve(value.slice(1));
      if (found !== undefined) return typeof found === 'string' && found.trim() !== '' && !isNaN(Number(found)) ? Number(found) : found;
    }
    return value.replace(/\$\{(q:)?([a-zA-Z0-9_.]+)\}/g, (whole, quote: string | undefined, key: string) => {
      const found = resolve(key);
      if (found === undefined) return key.includes('.') ? whole : quote ? shellQuote('') : '';
      if (quote) return shellQuote(found);
      return typeof found === 'object' && found !== null ? JSON.stringify(found) : String(found);
    });
  }
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const item of value) {
      if (typeof item === 'string' && WHOLE.test(item)) {
        const found = resolve(item.slice(1));
        if (Array.isArray(found)) {
          out.push(...found);
          continue;
        }
      }
      out.push(fill(item, resolve));
    }
    return out;
  }
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = fill(item, resolve);
    return out;
  }
  return value;
}

/** The names every template can use about the comp being edited. */
function compResolver(comp: Comp): Resolve {
  const audioTracks = tracksOf(comp, 'audio');
  const videoTracks = tracksOf(comp, 'video');
  const builtins: Record<string, unknown> = {
    compDuration: compDuration(comp),
    fps: comp.fps,
    freeAudioTrack: audioTracks.find((t) => !comp.clips.some((c) => c.trackId === t.id))?.id ?? audioTracks[0]?.id,
    upperVideoTrack: videoTracks.length > 1 ? videoTracks[videoTracks.length - 1]?.id : videoTracks[0]?.id,
    compId: comp.id,
  };
  return (key) => builtins[key];
}

/** Recursively substitutes $variables and ${variable} templates in Ops */
export function substituteTemplate(
  opsTemplate: OpTemplate[],
  params: Record<string, unknown>,
  comp: Comp,
  _assets?: AssetMap,
): { ops: Op[]; error?: string } {
  if (!Array.isArray(opsTemplate) || opsTemplate.length === 0) {
    return { ops: [], error: 'Custom tool ops template cannot be empty' };
  }
  const fromComp = compResolver(comp);
  const resolve: Resolve = (key) => {
    const builtin = fromComp(key);
    if (builtin !== undefined) return builtin;
    return key in params ? params[key] : undefined;
  };
  try {
    return { ops: fill(opsTemplate, resolve) as Op[] };
  } catch (err) {
    return { ops: [], error: `Template substitution failed: ${errorText(err)}` };
  }
}

/** Results of the steps run so far, for `$prev.…` and `$steps.<as>.…`. */
export type StepResults = { byName: Record<string, unknown>; prev: unknown };

/**
 * One step's arguments with every template filled: the tool's params, comp built-ins,
 * `$workDir` / `$ffmpeg` / `$runId`, and earlier results.
 */
export function substituteStepArgs(args: Record<string, unknown> | undefined, params: Record<string, unknown>, comp: Comp | null, results: StepResults, runId: string): Record<string, unknown> {
  const fromComp: Resolve = comp ? compResolver(comp) : () => undefined;
  const resolve: Resolve = (key) => {
    const [head, ...rest] = key.split('.');
    // Output read back from an earlier step is trimmed: stdout ends in a newline, and a path or a
    // number with one on the end is not the file or the value it names.
    const earlier = (value: unknown) => (typeof value === 'string' ? value.trim() : value);
    if (head === 'prev') return earlier(rest.length ? valueAtPath(results.prev, rest) : results.prev);
    if (head === 'steps') return earlier(valueAtPath(results.byName, rest));
    if (rest.length) return undefined;
    if (key === 'workDir') return toolEnv.workDir;
    if (key === 'ffmpeg') return toolEnv.ffmpeg ?? 'ffmpeg';
    if (key === 'runId') return runId;
    const builtin = fromComp(key);
    if (builtin !== undefined) return builtin;
    return key in params ? params[key] : undefined;
  };
  return fill(args ?? {}, resolve) as Record<string, unknown>;
}

/** Tools a steps tool may not call: it must not rewrite the library it is part of. */
export const STEP_FORBIDDEN = new Set(['create_custom_tool', 'update_custom_tool', 'delete_custom_tool']);
export const MAX_STEPS = 40;

/** Why a steps list cannot be saved, or null. `known` is every tool name Helios executes. */
export function validateSteps(steps: unknown, known: ReadonlySet<string>, selfName: string): string | null {
  if (!Array.isArray(steps) || steps.length === 0) return 'steps must be a non-empty list of { tool, args } calls';
  if (steps.length > MAX_STEPS) return `A steps tool can have at most ${MAX_STEPS} steps`;
  const names = new Set<string>();
  for (const [index, raw] of steps.entries()) {
    const at = `step ${index + 1}`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return `${at} must be an object like { "tool": "run_command", "args": { … } }`;
    const step = raw as ToolStep;
    if (typeof step.tool !== 'string' || !step.tool.trim()) return `${at} needs a "tool" name`;
    if (STEP_FORBIDDEN.has(step.tool)) return `${at} calls ${step.tool}; a custom tool cannot create, change or delete custom tools`;
    if (!known.has(step.tool) && !step.tool.startsWith('mcp__')) return `${at} calls "${step.tool}", which is not a Helios tool. Use one of the listed tools (run_command covers anything a shell can do).`;
    if (step.tool === 'call_custom_tool' && typeof step.args?.name === 'string' && step.args.name.trim().toLowerCase() === selfName.trim().toLowerCase()) return `${at} calls this tool itself`;
    if (step.args !== undefined && (typeof step.args !== 'object' || step.args === null || Array.isArray(step.args))) return `${at} "args" must be an object`;
    if (step.as !== undefined) {
      if (typeof step.as !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(step.as)) return `${at} "as" must be a plain name (letters, digits, underscores)`;
      if (names.has(step.as)) return `${at} reuses the name "${step.as}"`;
      names.add(step.as);
    }
  }
  return null;
}

export const customToolKind = (tool: Pick<CustomTool, 'steps'>): 'ops' | 'steps' => (tool.steps?.length ? 'steps' : 'ops');

/** What the AI is told about the saved tools on every turn: enough to pick one and call it. */
export function customToolsBrief(tools: CustomTool[] = cachedTools ?? []) {
  return tools.map((tool) => ({
    name: tool.name,
    kind: customToolKind(tool),
    description: tool.description,
    params: tool.params.map((p) => `${p.name}${p.required ? '*' : ''}:${p.kind}${p.default !== undefined ? `=${JSON.stringify(p.default)}` : ''}`),
    usageCount: tool.usageCount,
    lastResult: tool.lastResult?.ok === false ? `failed last time: ${tool.lastResult.summary ?? ''}`.slice(0, 160) : undefined,
  }));
}

/** Convert a stored CustomTool into an active Helios Recipe */
export function customToolToRecipe(tool: CustomTool): Recipe {
  return {
    name: tool.name.toLowerCase().replace(/_/g, '-'),
    about: tool.description,
    params: tool.params.map((p) => ({
      name: p.name,
      kind: p.kind,
      about: p.about,
      default: p.default,
    })),
    build: (context: Context): Program => {
      const { comp, assets, params } = context;
      // Merge with parameter defaults
      const mergedParams: Record<string, unknown> = {};
      for (const p of tool.params) {
        if (p.default !== undefined) mergedParams[p.name] = p.default;
      }
      Object.assign(mergedParams, params);

      const substituted = substituteTemplate(tool.opsTemplate, mergedParams, comp, assets);
      if (substituted.error) {
        throw new Error(substituted.error);
      }
      return {
        label: tool.name,
        compId: comp.id,
        ops: substituted.ops,
      };
    },
  };
}

/** Create a new custom tool and return updated list */
export function createCustomTool(
  input: {
    name: string;
    description: string;
    params?: CustomToolParam[];
    opsTemplate?: OpTemplate[];
    steps?: ToolStep[];
    promptGuide?: string;
    author?: 'ai' | 'user';
  },
  existing: CustomTool[],
  known?: ReadonlySet<string>,
): { tool?: CustomTool; error?: string } {
  const nameError = validateToolName(input.name);
  if (nameError) return { error: nameError };

  const normalized = input.name.trim().toLowerCase();
  if (existing.some((t) => t.name.toLowerCase() === normalized)) {
    return { error: `A tool named "${input.name}" already exists. Use update_custom_tool to modify it.` };
  }

  if (!input.description || input.description.trim().length < 5) {
    return { error: 'Tool description must be at least 5 characters explaining what it does' };
  }

  const hasOps = Array.isArray(input.opsTemplate) && input.opsTemplate.length > 0;
  const hasSteps = Array.isArray(input.steps) && input.steps.length > 0;
  if (hasOps && hasSteps) return { error: 'Give either opsTemplate (timeline edits) or steps (calls to other tools), not both' };
  if (!hasOps && !hasSteps) return { error: 'A tool needs opsTemplate (at least one edit operation) or steps (at least one tool call)' };
  if (hasSteps && known) {
    const problem = validateSteps(input.steps, known, input.name);
    if (problem) return { error: problem };
  }

  const tool: CustomTool = {
    version: 1,
    id: `tool_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: input.name.trim(),
    description: input.description.trim(),
    params: Array.isArray(input.params) ? input.params : [],
    opsTemplate: hasOps ? (input.opsTemplate as OpTemplate[]) : [],
    ...(hasSteps ? { steps: input.steps } : {}),
    promptGuide: input.promptGuide?.trim(),
    author: input.author || 'ai',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    usageCount: 0,
  };

  return { tool };
}

/** Update an existing custom tool to improve its behavior */
export function updateCustomTool(
  name: string,
  patch: Partial<Omit<CustomTool, 'id' | 'version' | 'createdAt'>>,
  existing: CustomTool[],
  known?: ReadonlySet<string>,
): { tool?: CustomTool; error?: string } {
  const normalized = name.trim().toLowerCase();
  const index = existing.findIndex((t) => t.name.toLowerCase() === normalized);
  if (index === -1) {
    return { error: `Custom tool "${name}" not found` };
  }

  const current = existing[index];
  // A patch may switch kinds: new steps replace the ops, new ops replace the steps.
  const steps = patch.steps !== undefined ? patch.steps : patch.opsTemplate?.length ? undefined : current.steps;
  const opsTemplate = patch.opsTemplate !== undefined ? patch.opsTemplate : patch.steps?.length ? [] : current.opsTemplate;
  if (steps?.length && known) {
    const problem = validateSteps(steps, known, current.name);
    if (problem) return { error: problem };
  }
  if (!steps?.length && !opsTemplate.length) return { error: 'The tool would be left with neither opsTemplate nor steps' };
  const { steps: _previousSteps, ...rest } = current;
  void _previousSteps;
  const updated: CustomTool = {
    ...rest,
    description: patch.description !== undefined ? patch.description.trim() : current.description,
    params: patch.params !== undefined ? patch.params : current.params,
    opsTemplate,
    ...(steps?.length ? { steps } : {}),
    promptGuide: patch.promptGuide !== undefined ? patch.promptGuide.trim() : current.promptGuide,
    updatedAt: new Date().toISOString(),
  };

  return { tool: updated };
}

/** Load all custom tools from disk/IPC with in-memory fallback */
export async function loadCustomTools(): Promise<CustomTool[]> {
  if (cachedTools !== null) return cachedTools;
  try {
    const loaded = await api.customToolsLoad();
    if (Array.isArray(loaded)) {
      cachedTools = loaded;
      return loaded;
    }
  } catch {
    // Fallback in tests or non-Tauri environments
  }
  cachedTools = cachedTools ?? [];
  return cachedTools;
}

/** Save custom tools to disk/IPC */
export async function saveCustomTools(tools: CustomTool[]): Promise<void> {
  cachedTools = tools;
  try {
    await api.customToolsSave(tools);
  } catch {
    // Fallback in tests or non-Tauri environments
  }
}

/** Record a run outcome for a tool to track reliability and performance */
export async function recordToolUsage(name: string, ok: boolean, summary?: string): Promise<void> {
  const tools = await loadCustomTools();
  const normalized = name.trim().toLowerCase();
  const found = tools.find((t) => t.name.toLowerCase() === normalized);
  if (found) {
    found.usageCount = (found.usageCount || 0) + 1;
    found.lastUsedAt = new Date().toISOString();
    found.lastResult = { ok, summary };
    await saveCustomTools(tools);
  }
}

/** Clear cache (primarily for tests) */
export function clearCustomToolsCache(): void {
  cachedTools = null;
}
