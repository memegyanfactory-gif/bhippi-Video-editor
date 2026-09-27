// Mends a tool call's arguments against the tool's JSON schema before the tool runs.
//
// Weaker models (and some CLI bridges) send the right values in the wrong JSON types: numbers
// quoted inside arrays ("t": "0.2"), booleans as "true", an array or object serialised as a
// string, one value where a list is expected, an enum in the wrong case. Each of those used to
// cost a failed call and a full round trip. Only a value whose type disagrees with the schema is
// touched; a call that already matches passes through unchanged.
import catalog from './ai-tools.json';

type Schema = {
  type?: string | string[];
  properties?: Record<string, Schema>;
  items?: Schema;
  enum?: unknown[];
};

const SCHEMAS = new Map<string, Schema>(
  (catalog as unknown as { tools: { name: string; input_schema: Schema }[] }).tools.map((tool) => [tool.name, tool.input_schema]),
);

const kinds = (schema: Schema): string[] => (Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : []);

const typeOf = (value: unknown): string => {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
};

const fits = (value: unknown, allowed: string[]): boolean => {
  const actual = typeOf(value);
  return allowed.includes(actual) || (actual === 'integer' && allowed.includes('number'));
};

function parseJson(value: string): unknown {
  const text = value.trim();
  if (!/^[[{]/.test(text)) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** `value` made to fit `schema` where that is unambiguous; otherwise returned as it came. */
export function repairValue(value: unknown, schema: Schema | undefined): unknown {
  if (!schema || value === undefined) return value;
  const allowed = kinds(schema);
  let out = value;

  if (allowed.length && !fits(out, allowed)) {
    if (typeof out === 'string') {
      const text = out.trim();
      if ((allowed.includes('number') || allowed.includes('integer')) && text && Number.isFinite(Number(text))) out = Number(text);
      else if (allowed.includes('boolean') && /^(true|false)$/i.test(text)) out = text.toLowerCase() === 'true';
      else if (allowed.includes('array') || allowed.includes('object')) {
        const parsed = parseJson(text);
        if (parsed !== undefined && fits(parsed, allowed)) out = parsed;
        else if (allowed.includes('array') && parsed === undefined) out = [out];
      }
    } else if (typeof out === 'number' && allowed.includes('string')) {
      out = String(out);
    } else if (allowed.includes('array') && !Array.isArray(out) && out !== null) {
      out = [out];
    }
  }

  if (typeof out === 'string' && schema.enum?.length && !schema.enum.includes(out)) {
    const match = schema.enum.find((option) => typeof option === 'string' && option.toLowerCase() === (out as string).trim().toLowerCase());
    if (match !== undefined) out = match;
  }

  if (Array.isArray(out) && schema.items) {
    const items = schema.items;
    out = out.map((item) => repairValue(item, items));
  } else if (out && typeof out === 'object' && !Array.isArray(out) && schema.properties) {
    const props = schema.properties;
    const obj: Record<string, unknown> = { ...(out as Record<string, unknown>) };
    for (const [key, sub] of Object.entries(props)) if (key in obj) obj[key] = repairValue(obj[key], sub);
    out = obj;
  }
  return out;
}

/** A tool call's arguments mended against that tool's schema (unknown tools pass through). */
export function repairArgs<T>(tool: string, args: T): T {
  const schema = SCHEMAS.get(tool);
  if (!schema) return args;
  // A whole argument object sent as a JSON string.
  const whole = typeof args === 'string' ? parseJson(args) ?? args : args;
  return repairValue(whole, { ...schema, type: 'object' }) as T;
}
