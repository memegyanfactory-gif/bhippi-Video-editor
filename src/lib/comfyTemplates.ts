// ComfyUI's official workflow templates (github.com/Comfy-Org/workflow_templates, MIT) turned into
// the API-format prompt that POST /prompt takes, so Bhippi can run many models without a hand-written
// graph for each. A template is saved in the UI format (nodes, links, subgraphs, widget values in
// order); the server's own node definitions (GET /object_info, through the comfy_object_info
// command) say which widget value belongs to which input.
//
// Pipeline: convertTemplate (UI -> API, subgraphs flattened) -> applySlots / applyFixed (Bhippi writes
// the prompt, size, seed, model files) -> finalizePrompt (folds on/off switches, drops previews and
// everything that no longer feeds a Save node). The whole thing is pure: tests feed it the saved
// templates and a saved object_info.

export type ApiNode = { class_type: string; inputs: Record<string, unknown>; _meta?: { title?: string } };
export type ApiPrompt = Record<string, ApiNode>;

/** One input as `/object_info` describes it: `[type, options]`; a combo is a list or `["COMBO", { options }]`. */
export type InputSpec = [unknown, Record<string, unknown>?];
export type NodeDef = {
  input?: { required?: Record<string, InputSpec>; optional?: Record<string, InputSpec>; hidden?: Record<string, unknown> };
  input_order?: { required?: string[]; optional?: string[] };
  output?: unknown[];
  output_name?: string[];
  output_node?: boolean;
};
export type ObjectInfo = Record<string, NodeDef>;

export type UiInput = { name: string; type?: string; link?: number | null; widget?: { name: string } };
export type UiNode = {
  id: number | string;
  type: string;
  mode?: number;
  title?: string;
  inputs?: UiInput[];
  outputs?: { name?: string; type?: string; links?: number[] | null }[];
  widgets_values?: unknown;
  widgets_values_named?: Record<string, unknown>;
};
type SubgraphDef = {
  id: string;
  name?: string;
  inputs?: { name: string; type?: string; linkIds?: number[] }[];
  outputs?: { name: string; type?: string; linkIds?: number[] }[];
  nodes: UiNode[];
  links?: SubLink[];
};
type SubLink = { id: number; origin_id: number; origin_slot: number; target_id: number; target_slot: number; type?: string };
export type UiTemplate = {
  nodes: UiNode[];
  links?: (unknown[] | SubLink)[];
  definitions?: { subgraphs?: SubgraphDef[] };
};

export type ConvertResult = {
  prompt: ApiPrompt;
  /** Things the converter could not map exactly (a template that converts cleanly has none). */
  warnings: string[];
  /** Node classes the template uses that the server does not have (the nodes are left out). */
  missing: string[];
};

export type ConvertOptions = {
  /** Node ids (as in the template, `outer:inner` inside a subgraph) whose mode to force: 0 on, 2 muted, 4 bypassed. */
  modes?: Record<string, number>;
};

/** Frontend-only nodes that never reach the server. */
const UI_ONLY = new Set(['Note', 'MarkdownNote', 'Reroute', 'PrimitiveNode']);
const WIDGET_TYPES = new Set(['INT', 'FLOAT', 'STRING', 'BOOLEAN', 'COMBO']);
const MUTED = 2;
const BYPASSED = 4;

type Scope = {
  /** Prefix of the API ids of this scope's nodes: "" at the top, "57:" inside subgraph instance 57. */
  prefix: string;
  nodes: Map<string, UiNode>;
  links: Map<number, SubLink>;
  /** The subgraph this scope is the inside of, and the instance that stands for it in the outer scope. */
  sub?: SubgraphDef;
  instance?: { node: UiNode; outer: Scope };
  inner: Map<string, Scope>;
};

type Source = { ref: [string, number] } | { value: unknown } | { none: true };

const NONE: Source = { none: true };

function normalizeLink(raw: unknown[] | SubLink): SubLink | null {
  if (Array.isArray(raw)) {
    const [id, originId, originSlot, targetId, targetSlot, type] = raw as [number, number, number, number, number, string?];
    return { id, origin_id: originId, origin_slot: originSlot, target_id: targetId, target_slot: targetSlot, type };
  }
  return raw && typeof raw === 'object' ? raw : null;
}

function makeScope(prefix: string, nodes: UiNode[], links: (unknown[] | SubLink)[] | undefined, sub?: SubgraphDef, instance?: Scope['instance']): Scope {
  const map = new Map<number, SubLink>();
  for (const raw of links ?? []) {
    const link = normalizeLink(raw);
    if (link) map.set(link.id, link);
  }
  return { prefix, nodes: new Map(nodes.map((node) => [String(node.id), node])), links: map, sub, instance, inner: new Map() };
}

const specType = (spec: InputSpec): unknown => spec[0];
const specOptions = (spec: InputSpec): Record<string, unknown> => (spec[1] && typeof spec[1] === 'object' ? spec[1] : {});

/** The input is a widget (a typed value a person edits) rather than a socket that only takes links. */
function isWidget(spec: InputSpec): boolean {
  const type = specType(spec);
  const options = specOptions(spec);
  if (options.socketless === true) return false;
  if (options.forceInput === true) return false;
  if (Array.isArray(type)) return true;
  return typeof type === 'string' && WIDGET_TYPES.has(type);
}

const isDynamicCombo = (spec: InputSpec) => specType(spec) === 'COMFY_DYNAMICCOMBO_V3';

function orderedInputs(def: NodeDef): { name: string; spec: InputSpec; optional: boolean }[] {
  const out: { name: string; spec: InputSpec; optional: boolean }[] = [];
  for (const section of ['required', 'optional'] as const) {
    const specs = def.input?.[section] ?? {};
    const order = def.input_order?.[section] ?? Object.keys(specs);
    for (const name of order) {
      const spec = specs[name];
      if (spec) out.push({ name, spec, optional: section === 'optional' });
    }
  }
  return out;
}

function defaultFor(spec: InputSpec): unknown {
  const options = specOptions(spec);
  if ('default' in options) return options.default;
  const type = specType(spec);
  if (Array.isArray(type)) return type[0];
  if (type === 'COMBO' && Array.isArray(options.options)) return options.options[0];
  return undefined;
}

function coerce(spec: InputSpec, value: unknown): unknown {
  if (value === undefined || value === null) return defaultFor(spec);
  const type = specType(spec);
  if (type === 'INT' && typeof value === 'number') return Math.round(value);
  if (type === 'BOOLEAN' && typeof value !== 'boolean') return Boolean(value);
  return value;
}

class Converter {
  readonly prompt: ApiPrompt = {};
  readonly warnings: string[] = [];
  readonly missing = new Set<string>();
  private readonly defs: Map<string, SubgraphDef>;
  private readonly top: Scope;

  constructor(template: UiTemplate, private readonly info: ObjectInfo, private readonly options: ConvertOptions) {
    this.defs = new Map((template.definitions?.subgraphs ?? []).map((sub) => [sub.id, sub]));
    this.top = makeScope('', template.nodes ?? [], template.links);
  }

  run(): ConvertResult {
    this.emitScope(this.top);
    return { prompt: this.prompt, warnings: this.warnings, missing: [...this.missing].sort() };
  }

  private modeOf(scope: Scope, node: UiNode): number {
    const forced = this.options.modes?.[scope.prefix + node.id];
    return forced ?? node.mode ?? 0;
  }

  private innerScope(scope: Scope, node: UiNode): Scope | null {
    const sub = this.defs.get(node.type);
    if (!sub) return null;
    const key = String(node.id);
    let inner = scope.inner.get(key);
    if (!inner) {
      inner = makeScope(`${scope.prefix}${node.id}:`, sub.nodes ?? [], sub.links, sub, { node, outer: scope });
      scope.inner.set(key, inner);
    }
    return inner;
  }

  private emitScope(scope: Scope): void {
    for (const node of scope.nodes.values()) {
      if (this.modeOf(scope, node) === MUTED || this.modeOf(scope, node) === BYPASSED) continue;
      if (this.defs.has(node.type)) {
        const inner = this.innerScope(scope, node);
        if (inner) this.emitScope(inner);
        continue;
      }
      if (UI_ONLY.has(node.type)) continue;
      this.emitNode(scope, node);
    }
  }

  // --- where a value comes from ------------------------------------------------------------

  private resolveLink(scope: Scope, linkId: number | null | undefined): Source {
    if (linkId === null || linkId === undefined) return NONE;
    const link = scope.links.get(linkId);
    if (!link) return NONE;
    return this.resolveOutput(scope, link.origin_id, link.origin_slot);
  }

  private resolveOutput(scope: Scope, originId: number, slot: number, depth = 0): Source {
    if (depth > 64) return NONE;
    if (originId === -10) return this.resolveSubgraphInput(scope, slot);
    const node = scope.nodes.get(String(originId));
    if (!node) return NONE;
    const mode = this.modeOf(scope, node);
    if (mode === MUTED) return NONE;
    if (mode === BYPASSED) return this.bypass(scope, node, slot, depth);
    if (this.defs.has(node.type)) {
      const inner = this.innerScope(scope, node);
      const out = inner?.sub?.outputs?.[slot];
      const linkId = out?.linkIds?.[0];
      return inner && linkId !== undefined ? this.resolveLink(inner, linkId) : NONE;
    }
    if (node.type === 'Reroute') {
      const input = node.inputs?.[0];
      return this.resolveLink(scope, input?.link);
    }
    if (node.type === 'PrimitiveNode') {
      const values = node.widgets_values;
      return Array.isArray(values) && values.length ? { value: values[0] } : NONE;
    }
    if (UI_ONLY.has(node.type)) return NONE;
    return { ref: [scope.prefix + node.id, slot] };
  }

  /** A bypassed node passes its input of the output's type straight through (the same rule as the editor). */
  private bypass(scope: Scope, node: UiNode, slot: number, depth: number): Source {
    const type = node.outputs?.[slot]?.type;
    const inputs = node.inputs ?? [];
    const matching = type ? inputs.find((input) => input.type === type && input.link !== null && input.link !== undefined) : undefined;
    const chosen = matching ?? (inputs[slot]?.link !== null && inputs[slot]?.link !== undefined ? inputs[slot] : undefined);
    if (!chosen) return NONE;
    const link = scope.links.get(chosen.link as number);
    return link ? this.resolveOutput(scope, link.origin_id, link.origin_slot, depth + 1) : NONE;
  }

  /** Inside a subgraph, its input `slot`: the outer link when the instance's input is linked, else the value set on the instance. */
  private resolveSubgraphInput(scope: Scope, slot: number): Source {
    const { sub, instance } = scope;
    const input = sub?.inputs?.[slot];
    if (!sub || !instance || !input) return NONE;
    const instIn = instance.node.inputs?.find((entry) => entry.name === input.name);
    if (instIn && instIn.link !== null && instIn.link !== undefined) {
      const outer = this.resolveLink(instance.outer, instIn.link);
      if (!('none' in outer)) return outer;
    }
    const value = this.instanceValue(sub, instance.node, slot) ?? this.innerWidgetValue(scope, input);
    return value === undefined ? NONE : { value };
  }

  /**
   * The value a subgraph input shows when nothing was set on the instance: the widget value of an inner
   * node it feeds (the editor reads a promoted widget from there). Needed when the input also feeds a
   * socket that has no widget of its own, such as a text preview of the width.
   */
  private innerWidgetValue(scope: Scope, input: { linkIds?: number[] }): unknown {
    for (const linkId of input.linkIds ?? []) {
      const link = scope.links.get(linkId);
      const target = link ? scope.nodes.get(String(link.target_id)) : undefined;
      const def = target ? this.info[target.type] : undefined;
      if (!link || !target || !def || this.defs.has(target.type) || UI_ONLY.has(target.type)) continue;
      const name = target.inputs?.[link.target_slot]?.widget?.name;
      if (!name) continue;
      const value = this.widgetValuesOf(target, def).get(name);
      if (value !== undefined && value !== null) return value;
    }
    return undefined;
  }

  /** Every widget value a node carries, by input name, read the same way emitNode reads them. */
  private widgetValuesOf(node: UiNode, def: NodeDef): Map<string, unknown> {
    const out = new Map<string, unknown>();
    const named = node.widgets_values_named;
    const positional = Array.isArray(node.widgets_values) ? node.widgets_values : undefined;
    let cursor = 0;
    const take = (apiName: string): unknown => {
      if (named && apiName in named) return named[apiName];
      if (named || !positional) return undefined;
      const value = positional[cursor];
      cursor += 1;
      return value;
    };
    const visit = (spec: InputSpec, apiName: string): void => {
      if (isDynamicCombo(spec)) {
        const raw = take(apiName);
        out.set(apiName, raw);
        const options = specOptions(spec).options;
        const option = Array.isArray(options) ? (options as { key: string; inputs?: NodeDef['input'] }[]).find((entry) => entry.key === String(raw)) : undefined;
        for (const section of ['required', 'optional'] as const) {
          for (const [childName, childSpec] of Object.entries(option?.inputs?.[section] ?? {})) visit(childSpec, `${apiName}.${childName}`);
        }
        return;
      }
      if (!isWidget(spec)) return;
      out.set(apiName, take(apiName));
      if (specOptions(spec).control_after_generate && !named) cursor += 1;
    };
    for (const { name, spec } of orderedInputs(def)) visit(spec, name);
    return out;
  }

  /** The value set on a subgraph instance for its input `slot` (widget values follow the widget-typed inputs in order). */
  private instanceValue(sub: SubgraphDef, node: UiNode, slot: number): unknown {
    const input = sub.inputs?.[slot];
    if (!input) return undefined;
    const named = node.widgets_values_named;
    if (named && input.name in named) return named[input.name];
    const values = node.widgets_values;
    if (!Array.isArray(values)) return undefined;
    const widgetInputs = (sub.inputs ?? []).filter((entry) => entry.type && WIDGET_TYPES.has(entry.type));
    if (values.length !== widgetInputs.length) return undefined;
    const index = widgetInputs.indexOf(input);
    return index >= 0 ? values[index] : undefined;
  }

  // --- one real node -----------------------------------------------------------------------

  private emitNode(scope: Scope, node: UiNode): void {
    const def = this.info[node.type];
    const id = scope.prefix + node.id;
    if (!def) {
      this.missing.add(node.type);
      return;
    }
    const inputs: Record<string, unknown> = {};
    const uiInputs = new Map<string, UiInput>((node.inputs ?? []).map((entry) => [entry.name, entry]));
    const named = node.widgets_values_named;
    const positional = Array.isArray(node.widgets_values) ? node.widgets_values : undefined;
    const keyed = !Array.isArray(node.widgets_values) && node.widgets_values && typeof node.widgets_values === 'object' ? (node.widgets_values as Record<string, unknown>) : undefined;
    let cursor = 0;

    const takeWidget = (apiName: string, localName: string): unknown => {
      if (named && apiName in named) return named[apiName];
      if (keyed && localName in keyed) return keyed[localName];
      if (named) return undefined;
      if (!positional) return undefined;
      const value = positional[cursor];
      cursor += 1;
      return value;
    };

    const linked = (apiName: string, fallback: () => unknown): void => {
      const ui = uiInputs.get(apiName);
      const source = ui && ui.link !== null && ui.link !== undefined ? this.resolveLink(scope, ui.link) : NONE;
      if ('ref' in source) inputs[apiName] = source.ref;
      else if ('value' in source) inputs[apiName] = source.value;
      else {
        const value = fallback();
        if (value !== undefined) inputs[apiName] = value;
      }
    };

    const visit = (name: string, spec: InputSpec, apiName: string): void => {
      if (isDynamicCombo(spec)) {
        const raw = takeWidget(apiName, name);
        const key = raw === undefined || raw === null ? undefined : String(raw);
        linked(apiName, () => key);
        const options = specOptions(spec).options;
        const option = Array.isArray(options) ? (options as { key: string; inputs?: NodeDef['input'] }[]).find((entry) => entry.key === (inputs[apiName] ?? key)) : undefined;
        if (option?.inputs) {
          for (const section of ['required', 'optional'] as const) {
            for (const [childName, childSpec] of Object.entries(option.inputs[section] ?? {})) visit(childName, childSpec, `${apiName}.${childName}`);
          }
        }
        return;
      }
      if (isWidget(spec)) {
        const raw = takeWidget(apiName, name);
        // A seed-like widget is followed by its "control after generate" value ("fixed", "randomize"...); a string means the same.
        if (specOptions(spec).control_after_generate && !named) cursor += 1;
        linked(apiName, () => coerce(spec, raw));
        return;
      }
      if (specOptions(spec).socketless === true) return;
      linked(apiName, () => undefined);
    };
    for (const { name, spec } of orderedInputs(def)) visit(name, spec, name);

    // Dynamic sockets (auto-grow image lists, match-type switches) exist only as links on the node.
    for (const [name, ui] of uiInputs) {
      if (name in inputs || ui.link === null || ui.link === undefined) continue;
      const source = this.resolveLink(scope, ui.link);
      if ('ref' in source) inputs[name] = source.ref;
      else if ('value' in source) inputs[name] = source.value;
    }

    if (positional && !named && cursor < positional.length) {
      const leftover = positional.slice(cursor).filter((value) => value !== null && value !== undefined);
      const uploads = orderedInputs(def).some(({ spec }) => specOptions(spec).image_upload || specOptions(spec).audio_upload || specOptions(spec).video_upload);
      if (leftover.length && !uploads) this.warnings.push(`${node.type} ${id}: ${leftover.length} widget value(s) were not used`);
    }
    this.prompt[id] = { class_type: node.type, inputs, ...(node.title ? { _meta: { title: node.title } } : {}) };
  }
}

/** The node classes a template uses (inside subgraphs too), so only their definitions need fetching from the server. */
export function templateClasses(template: UiTemplate): string[] {
  const subs = template.definitions?.subgraphs ?? [];
  const subIds = new Set(subs.map((sub) => sub.id));
  const classes = new Set<string>();
  for (const node of [...(template.nodes ?? []), ...subs.flatMap((sub) => sub.nodes ?? [])]) {
    if (!subIds.has(node.type) && !UI_ONLY.has(node.type)) classes.add(node.type);
  }
  return [...classes].sort();
}

/** UI-format template -> API-format prompt, subgraphs flattened (inner ids are `outer:inner`). */
export function convertTemplate(template: UiTemplate, info: ObjectInfo, options: ConvertOptions = {}): ConvertResult {
  if (!template || !Array.isArray(template.nodes)) throw new Error('This is not a ComfyUI workflow: it has no nodes.');
  return new Converter(template, info, options).run();
}

// --- slots: where Bhippi writes things ---------------------------------------------------------

/** Picks a node of the converted prompt: by API id, by title, by class (with `nth` among several). */
export type NodeSelector = { id?: string; title?: string; class?: string; nth?: number };
export type SlotTarget = NodeSelector & { input: string; as?: 'int' | 'float' | 'string' | 'bool' };
export type FixedValue = NodeSelector & { input: string; value: unknown };

export type ComfyTaskSpec = {
  /** Template file name (public/comfy-templates/<name>.json), without extension. */
  template?: string;
  /** What Bhippi writes per job: prompt, negative, width, height, seed, steps, cfg, duration, image, audio ... */
  slots: Record<string, SlotTarget | SlotTarget[]>;
  /** Model files per folder under `comfyui/` (diffusion_models, text_encoders, vae, loras, checkpoints): where each file name goes, in the order the variant lists them. */
  loaders?: Record<string, SlotTarget | SlotTarget[]>;
  /** Folders (under `comfyui/`) whose loader is only used when the variant or an installed add-on has a file there (a LoRA). */
  optionalLoaders?: string[];
  /** Constants for this model (prompt enhancer off, a sampler, ...). A `null` value removes that input. */
  fixed?: FixedValue[];
  /** Inputs to remove when a slot got no value (the second reference image's link, when only one was given). */
  whenAbsent?: Record<string, (NodeSelector & { input: string })[]>;
  /** Node modes forced before converting (e.g. bypass a branch): id -> 0 | 2 | 4. */
  modes?: Record<string, number>;
  /** Plain numbers the generation layer needs: steps, cfg, multiple, megapixels ... */
  params?: Record<string, unknown>;
};

const asList = <T>(value: T | T[] | undefined): T[] => (value === undefined ? [] : Array.isArray(value) ? value : [value]);

export function selectNodes(prompt: ApiPrompt, selector: NodeSelector): string[] {
  const ids = Object.keys(prompt).filter((id) => {
    const node = prompt[id];
    if (selector.id !== undefined && id !== selector.id) return false;
    if (selector.class !== undefined && node.class_type !== selector.class) return false;
    if (selector.title !== undefined && (node._meta?.title ?? '').toLowerCase() !== selector.title.toLowerCase()) return false;
    return true;
  });
  const sorted = ids.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (selector.nth !== undefined) return sorted[selector.nth] ? [sorted[selector.nth]] : [];
  return sorted;
}

function castValue(value: unknown, as: SlotTarget['as']): unknown {
  if (as === 'int') return Math.round(Number(value));
  if (as === 'float') return Number(value);
  if (as === 'string') return String(value);
  if (as === 'bool') return Boolean(value);
  return value;
}

/** Writes `value` into the input a target names. Throws in plain words when the template has no such node. */
export function writeTarget(prompt: ApiPrompt, target: SlotTarget, value: unknown, label: string): void {
  const ids = selectNodes(prompt, target);
  if (!ids.length) throw new Error(`The workflow has no node for "${label}" (${JSON.stringify({ ...target, input: undefined })}). The model's catalog entry and its workflow template disagree.`);
  if (ids.length > 1 && target.nth === undefined) throw new Error(`"${label}" matches ${ids.length} nodes (${ids.join(', ')}); the catalog entry must say which with id or nth.`);
  prompt[ids[0]].inputs[target.input] = castValue(value, target.as);
}

/** Writes each given value into its slot. A slot the task does not define is a mistake, so it throws. */
export function applySlots(prompt: ApiPrompt, slots: ComfyTaskSpec['slots'], values: Record<string, unknown>): void {
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue;
    const targets = asList(slots[name]);
    if (!targets.length) throw new Error(`This model's workflow has no "${name}" setting.`);
    for (const target of targets) writeTarget(prompt, target, value, name);
  }
}

/** Removes an input (and so its link) from the node a selector names. */
export function removeInput(prompt: ApiPrompt, target: NodeSelector & { input: string }, label: string): void {
  const ids = selectNodes(prompt, target);
  if (!ids.length) throw new Error(`The workflow has no node for "${label}" (${JSON.stringify({ ...target, input: undefined })}). The model's catalog entry and its workflow template disagree.`);
  for (const id of ids) delete prompt[id].inputs[target.input];
}

export function applyFixed(prompt: ApiPrompt, fixed: FixedValue[] | undefined): void {
  for (const entry of fixed ?? []) {
    if (entry.value === null) removeInput(prompt, entry, `fixed ${entry.input}`);
    else writeTarget(prompt, entry, entry.value, `fixed ${entry.input}`);
  }
}

/** For every slot that got no value, removes the inputs the spec lists for it. */
export function applyWhenAbsent(prompt: ApiPrompt, whenAbsent: ComfyTaskSpec['whenAbsent'], given: Set<string>): void {
  for (const [slot, targets] of Object.entries(whenAbsent ?? {})) {
    if (given.has(slot)) continue;
    for (const target of targets) removeInput(prompt, target, `${slot} (not given)`);
  }
}

/**
 * Model files go to the loader nodes: `files` are the variant's dest paths (`comfyui/<folder>/<file>`);
 * the nth file of a folder goes to the nth target the spec lists for it. Files in a folder the spec
 * does not mention (a VAE the template loads under another name) are left alone on purpose.
 */
export function applyLoaders(prompt: ApiPrompt, loaders: ComfyTaskSpec['loaders'], destPaths: string[], optionalFolders: string[] = []): void {
  const byFolder = new Map<string, string[]>();
  for (const dest of destPaths) {
    const parts = dest.replace(/\\/g, '/').split('/');
    const folder = parts[1];
    const file = parts[parts.length - 1];
    if (parts[0] !== 'comfyui' || !folder || !file) continue;
    byFolder.set(folder, [...(byFolder.get(folder) ?? []), file]);
  }
  for (const [folder, targets] of Object.entries(loaders ?? {})) {
    const files = byFolder.get(folder) ?? [];
    const list = asList(targets);
    if (!files.length && optionalFolders.includes(folder)) continue;
    if (files.length < list.length) throw new Error(`The downloaded files do not include enough of the "${folder}" files this workflow loads (${files.length} of ${list.length}).`);
    list.forEach((target, index) => writeTarget(prompt, target, files[index], `${folder} file ${index + 1}`));
  }
}

// --- finishing -------------------------------------------------------------------------------

const PRIMITIVES = new Set(['PrimitiveBoolean', 'PrimitiveInt', 'PrimitiveFloat', 'PrimitiveString', 'PrimitiveStringMultiline']);

const isRef = (value: unknown): value is [string, number] => Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && typeof value[1] === 'number';

function literalOf(prompt: ApiPrompt, value: unknown): unknown {
  if (!isRef(value)) return value;
  const node = prompt[value[0]];
  if (node && PRIMITIVES.has(node.class_type) && value[1] === 0 && !isRef(node.inputs.value)) return node.inputs.value;
  return undefined;
}

/**
 * Replaces each on/off switch whose condition is known with the branch it selects, so the branch it
 * does not select (a prompt enhancer, a second model) is never validated or loaded.
 */
export function foldSwitches(prompt: ApiPrompt): void {
  for (let pass = 0; pass < 64; pass += 1) {
    const found = Object.entries(prompt).find(([, node]) => node.class_type === 'ComfySwitchNode' && typeof literalOf(prompt, node.inputs.switch) === 'boolean');
    if (!found) return;
    const [id, node] = found;
    const on = literalOf(prompt, node.inputs.switch) === true;
    const chosen = node.inputs[on ? 'on_true' : 'on_false'];
    for (const other of Object.values(prompt)) {
      for (const [name, value] of Object.entries(other.inputs)) {
        if (isRef(value) && value[0] === id && value[1] === 0) {
          if (chosen === undefined) delete other.inputs[name];
          else other.inputs[name] = chosen;
        }
      }
    }
    delete prompt[id];
  }
}

/** Keeps only what feeds a Save node (previews and unused branches go). */
export function pruneToSaves(prompt: ApiPrompt, info: ObjectInfo): void {
  const roots = Object.keys(prompt).filter((id) => /^Save/.test(prompt[id].class_type) && info[prompt[id].class_type]?.output_node !== false);
  const keep = new Set<string>();
  const stack = [...roots];
  while (stack.length) {
    const id = stack.pop() as string;
    if (keep.has(id) || !prompt[id]) continue;
    keep.add(id);
    for (const value of Object.values(prompt[id].inputs)) if (isRef(value)) stack.push(value[0]);
  }
  for (const id of Object.keys(prompt)) if (!keep.has(id)) delete prompt[id];
}

/** Folds switches, then drops every node that no longer feeds a Save node. */
export function finalizePrompt(prompt: ApiPrompt, info: ObjectInfo): ApiPrompt {
  foldSwitches(prompt);
  pruneToSaves(prompt, info);
  return prompt;
}

/** The node classes a finished prompt uses, for the missing-nodes check. */
export const classesOf = (prompt: ApiPrompt): string[] => [...new Set(Object.values(prompt).map((node) => node.class_type))].sort();
