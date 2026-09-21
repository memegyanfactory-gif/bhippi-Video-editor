// Dynamic AI Custom Tool Management System
// Enables Helios AI and external models to dynamically invent, persist, improve,
// and execute reusable editing tools and macro recipes.

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

export type CustomTool = {
  version: 1;
  id: string;
  name: string;
  description: string;
  params: CustomToolParam[];
  opsTemplate: OpTemplate[];
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

  const duration = compDuration(comp);
  const audioTracks = tracksOf(comp, 'audio');
  const videoTracks = tracksOf(comp, 'video');
  const freeAudio = audioTracks.find((t) => !comp.clips.some((c) => c.trackId === t.id))?.id ?? audioTracks[0]?.id;
  const upperVideo = videoTracks.length > 1 ? videoTracks[videoTracks.length - 1]?.id : videoTracks[0]?.id;

  const replaceVal = (val: unknown): unknown => {
    if (typeof val === 'string') {
      if (val.startsWith('$')) {
        const key = val.slice(1);
        if (key === 'compDuration') return duration;
        if (key === 'fps') return comp.fps;
        if (key === 'freeAudioTrack') return freeAudio;
        if (key === 'upperVideoTrack') return upperVideo;
        if (key in params) {
          const p = params[key];
          if (typeof p === 'string' && !isNaN(Number(p)) && p.trim() !== '') return Number(p);
          return p;
        }
      }
      return val.replace(/\$\{([a-zA-Z0-9_]+)\}/g, (_, k) => {
        if (k === 'compDuration') return String(duration);
        if (k === 'fps') return String(comp.fps);
        return String(params[k] ?? '');
      });
    }
    if (Array.isArray(val)) {
      const result: unknown[] = [];
      for (const item of val) {
        if (typeof item === 'string' && item.startsWith('$')) {
          const key = item.slice(1);
          if (Array.isArray(params[key])) {
            result.push(...(params[key] as unknown[]));
            continue;
          }
        }
        result.push(replaceVal(item));
      }
      return result;
    }
    if (typeof val === 'object' && val !== null) {
      const obj: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val)) {
        obj[k] = replaceVal(v);
      }
      return obj;
    }
    return val;
  };

  try {
    const rawReplaced = replaceVal(opsTemplate) as Op[];
    return { ops: rawReplaced };
  } catch (err) {
    return { ops: [], error: `Template substitution failed: ${errorText(err)}` };
  }
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
    opsTemplate: OpTemplate[];
    promptGuide?: string;
    author?: 'ai' | 'user';
  },
  existing: CustomTool[],
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

  if (!Array.isArray(input.opsTemplate) || input.opsTemplate.length === 0) {
    return { error: 'opsTemplate must contain at least one operation' };
  }

  const tool: CustomTool = {
    version: 1,
    id: `tool_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: input.name.trim(),
    description: input.description.trim(),
    params: Array.isArray(input.params) ? input.params : [],
    opsTemplate: input.opsTemplate,
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
): { tool?: CustomTool; error?: string } {
  const normalized = name.trim().toLowerCase();
  const index = existing.findIndex((t) => t.name.toLowerCase() === normalized);
  if (index === -1) {
    return { error: `Custom tool "${name}" not found` };
  }

  const current = existing[index];
  const updated: CustomTool = {
    ...current,
    description: patch.description !== undefined ? patch.description.trim() : current.description,
    params: patch.params !== undefined ? patch.params : current.params,
    opsTemplate: patch.opsTemplate !== undefined ? patch.opsTemplate : current.opsTemplate,
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
