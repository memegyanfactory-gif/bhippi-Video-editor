// A small, safe expression language for animated properties: the useful core of After Effects
// expressions without `eval`. Parsed once, cached, evaluated per frame.
//
//   wiggle(2, 12)                       smooth seeded noise around the value
//   loopOut('cycle') / loopOut('pingpong')
//   value + [0, Math.sin(time * 3) * 10]
//   linear(time, 0, 1, 0, 100)          ease(t, tMin, tMax, a, b), easeIn, easeOut
//   var s = time * 40; [s, s]
//   posterizeTime(8); wiggle(4, 20)     stepped, stop-motion feel
//
// Numbers and arrays mix freely: arithmetic on arrays is per component and a number broadcasts.
import { ease } from './anim';

type Value = number | number[] | string | boolean | ((...args: Value[]) => Value) | Record<string, unknown> | undefined;

type Node =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'id'; name: string }
  | { t: 'arr'; items: Node[] }
  | { t: 'un'; op: string; arg: Node }
  | { t: 'bin'; op: string; a: Node; b: Node }
  | { t: 'tern'; c: Node; a: Node; b: Node }
  | { t: 'call'; fn: Node; args: Node[] }
  | { t: 'mem'; obj: Node; prop: string }
  | { t: 'idx'; obj: Node; index: Node }
  | { t: 'var'; name: string; value: Node }
  | { t: 'assign'; name: string; value: Node }
  | { t: 'seq'; body: Node[] };

// ───────────────────────── tokens ─────────────────────────

type Token = { k: 'num' | 'str' | 'id' | 'op' | 'end'; v: string };

const OPS = ['===', '!==', '**', '==', '!=', '<=', '>=', '&&', '||', '+', '-', '*', '/', '%', '<', '>', '!', '?', ':', '(', ')', '[', ']', ',', '.', ';', '='];

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i;
      while (j < src.length && /[0-9.eE]/.test(src[j])) { if ((src[j] === 'e' || src[j] === 'E') && (src[j + 1] === '-' || src[j + 1] === '+')) j++; j++; }
      out.push({ k: 'num', v: src.slice(i, j) });
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j++;
      out.push({ k: 'str', v: src.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_$]/.test(src[j])) j++;
      out.push({ k: 'id', v: src.slice(i, j) });
      i = j;
      continue;
    }
    const op = OPS.find((candidate) => src.startsWith(candidate, i));
    if (!op) throw new Error(`unexpected "${c}" in expression`);
    out.push({ k: 'op', v: op });
    i += op.length;
  }
  out.push({ k: 'end', v: '' });
  return out;
}

// ───────────────────────── parser ─────────────────────────

const PRECEDENCE: Record<string, number> = { '||': 1, '&&': 2, '==': 3, '!=': 3, '===': 3, '!==': 3, '<': 4, '>': 4, '<=': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6, '**': 7 };

function parse(src: string): Node {
  const tokens = tokenize(src);
  let p = 0;
  const peek = () => tokens[p];
  const next = () => tokens[p++];
  const accept = (v: string) => (peek().k === 'op' && peek().v === v ? (p++, true) : false);
  const expect = (v: string) => { if (!accept(v)) throw new Error(`expected "${v}" in expression`); };

  const primary = (): Node => {
    const token = next();
    if (token.k === 'num') return { t: 'num', v: Number(token.v) };
    if (token.k === 'str') return { t: 'str', v: token.v };
    if (token.k === 'id') {
      if (token.v === 'true') return { t: 'num', v: 1 };
      if (token.v === 'false') return { t: 'num', v: 0 };
      return { t: 'id', name: token.v };
    }
    if (token.k === 'op' && token.v === '(') { const inner = expression(); expect(')'); return inner; }
    if (token.k === 'op' && token.v === '[') {
      const items: Node[] = [];
      if (!accept(']')) { do items.push(expression()); while (accept(',')); expect(']'); }
      return { t: 'arr', items };
    }
    if (token.k === 'op' && (token.v === '-' || token.v === '!' || token.v === '+')) return { t: 'un', op: token.v, arg: postfix(primary()) };
    throw new Error(`unexpected "${token.v || 'end'}" in expression`);
  };

  const postfix = (node: Node): Node => {
    for (;;) {
      if (accept('(')) {
        const args: Node[] = [];
        if (!accept(')')) { do args.push(expression()); while (accept(',')); expect(')'); }
        node = { t: 'call', fn: node, args };
      } else if (accept('.')) {
        const name = next();
        if (name.k !== 'id') throw new Error('expected a name after "."');
        node = { t: 'mem', obj: node, prop: name.v };
      } else if (accept('[')) {
        const index = expression();
        expect(']');
        node = { t: 'idx', obj: node, index };
      } else return node;
    }
  };

  const unary = (): Node => {
    const token = peek();
    if (token.k === 'op' && (token.v === '-' || token.v === '!' || token.v === '+')) { p++; return { t: 'un', op: token.v, arg: unary() }; }
    return postfix(primary());
  };

  const binary = (min: number): Node => {
    let left = unary();
    for (;;) {
      const token = peek();
      const prec = token.k === 'op' ? PRECEDENCE[token.v] : undefined;
      if (prec === undefined || prec < min) return left;
      p++;
      const right = binary(token.v === '**' ? prec : prec + 1);
      left = { t: 'bin', op: token.v, a: left, b: right };
    }
  };

  const expression = (): Node => {
    const cond = binary(1);
    if (accept('?')) { const a = expression(); expect(':'); const b = expression(); return { t: 'tern', c: cond, a, b }; }
    return cond;
  };

  const statement = (): Node => {
    const token = peek();
    if (token.k === 'id' && (token.v === 'var' || token.v === 'let' || token.v === 'const')) {
      p++;
      const name = next();
      if (name.k !== 'id') throw new Error('expected a variable name');
      expect('=');
      return { t: 'var', name: name.v, value: expression() };
    }
    if (token.k === 'id' && tokens[p + 1]?.k === 'op' && tokens[p + 1].v === '=' ) {
      p += 2;
      return { t: 'assign', name: token.v, value: expression() };
    }
    return expression();
  };

  const body: Node[] = [];
  while (peek().k !== 'end') {
    if (accept(';')) continue;
    body.push(statement());
  }
  return { t: 'seq', body };
}

// ───────────────────────── noise ─────────────────────────

/** Deterministic hash → [0, 1). */
export function hash01(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

/** Smooth 1D value noise in [-1, 1]. */
export function noise1(x: number, seed = 0): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * f * (f * (f * 6 - 15) + 10);
  const a = hash01(i + seed * 57.13) * 2 - 1;
  const b = hash01(i + 1 + seed * 57.13) * 2 - 1;
  return a + (b - a) * u;
}

/** A seeded random generator (mulberry32). */
export function seededRandom(seed: number): () => number {
  let a = (Math.floor(seed * 1000) >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ───────────────────────── evaluation ─────────────────────────

const toNum = (v: Value): number => (typeof v === 'number' ? v : Array.isArray(v) ? v[0] ?? 0 : typeof v === 'boolean' ? (v ? 1 : 0) : Number(v) || 0);
const truthy = (v: Value) => (Array.isArray(v) ? v.length > 0 : !!toNum(v) || (typeof v === 'string' && v.length > 0));

function arith(op: string, a: Value, b: Value): Value {
  const f = (x: number, y: number) => {
    switch (op) {
      case '+': return x + y;
      case '-': return x - y;
      case '*': return x * y;
      case '/': return y === 0 ? 0 : x / y;
      case '%': return y === 0 ? 0 : x % y;
      case '**': return x ** y;
      default: return 0;
    }
  };
  if (Array.isArray(a) || Array.isArray(b)) {
    const va = Array.isArray(a) ? a : null;
    const vb = Array.isArray(b) ? b : null;
    const n = Math.max(va?.length ?? 0, vb?.length ?? 0);
    const out: number[] = [];
    for (let i = 0; i < n; i++) out.push(f(va ? va[i] ?? 0 : toNum(a), vb ? vb[i] ?? 0 : toNum(b)));
    return out;
  }
  if (op === '+' && (typeof a === 'string' || typeof b === 'string')) return `${a}${b}`;
  return f(toNum(a), toNum(b));
}

function compare(op: string, a: Value, b: Value): number {
  const x = toNum(a);
  const y = toNum(b);
  switch (op) {
    case '<': return x < y ? 1 : 0;
    case '>': return x > y ? 1 : 0;
    case '<=': return x <= y ? 1 : 0;
    case '>=': return x >= y ? 1 : 0;
    case '==': case '===': return (typeof a === 'string' || typeof b === 'string' ? a === b : x === y) ? 1 : 0;
    default: return (typeof a === 'string' || typeof b === 'string' ? a !== b : x !== y) ? 1 : 0;
  }
}

const mapVec = (v: Value, fn: (x: number) => number): Value => (Array.isArray(v) ? v.map(fn) : fn(toNum(v)));

/** Everything an expression can read. */
export type ExprScope = {
  time: number;
  value: number | number[];
  valueAtTime: (t: number) => number | number[];
  keys: { t: number; v: number | number[] }[];
  seed: number;
  index?: number;
  duration?: number;
  inPoint?: number;
  outPoint?: number;
  width?: number;
  height?: number;
};

function interpolateFn(kind: 'linear' | 'ease' | 'easeIn' | 'easeOut') {
  const curve = kind === 'linear' ? 'linear' : kind === 'ease' ? 'ease-in-out' : kind === 'easeIn' ? 'ease-in' : 'ease-out';
  return (...args: Value[]): Value => {
    const t = args[0];
    let [, tMin, tMax, a, b] = args;
    if (args.length === 3) { a = tMin; b = tMax; tMin = 0; tMax = 1; }
    const lo = toNum(tMin);
    const hi = toNum(tMax);
    const p = ease(curve, hi === lo ? (toNum(t) >= hi ? 1 : 0) : (toNum(t) - lo) / (hi - lo));
    return arith('+', a, arith('*', arith('-', b, a), p));
  };
}

function buildGlobals(scope: ExprScope, env: { time: number }): Record<string, Value> {
  const random = seededRandom(scope.seed * 7919 + (scope.index ?? 0) * 104729);
  const wiggle = (...args: Value[]): Value => {
    const freq = toNum(args[0] ?? 1);
    const amp = toNum(args[1] ?? 0);
    const octaves = Math.max(1, Math.min(8, Math.round(toNum(args[2] ?? 1))));
    const ampMult = args[3] === undefined ? 0.5 : toNum(args[3]);
    const t = args[4] === undefined ? env.time : toNum(args[4]);
    const base = scope.value;
    const channel = (d: number) => {
      let sum = 0;
      let a = 1;
      let f = freq;
      for (let o = 0; o < octaves; o++) { sum += noise1(t * f + d * 31.7 + o * 11.3, scope.seed + (scope.index ?? 0) * 3.1) * a; a *= ampMult; f *= 2; }
      return sum * amp;
    };
    return Array.isArray(base) ? base.map((v, d) => v + channel(d)) : base + channel(0);
  };
  const loop = (direction: 'out' | 'in') => (...args: Value[]): Value => {
    const type = typeof args[0] === 'string' ? args[0] : 'cycle';
    const k = scope.keys;
    if (k.length < 2) return scope.value;
    const sorted = [...k].sort((a, b) => a.t - b.t);
    const n = Math.max(0, Math.min(sorted.length - 1, Math.round(toNum(args[1] ?? 0))));
    const first = direction === 'out' ? sorted[n === 0 ? 0 : sorted.length - 1 - n].t : sorted[0].t;
    const last = direction === 'out' ? sorted[sorted.length - 1].t : sorted[n === 0 ? sorted.length - 1 : n].t;
    const span = last - first;
    const t = env.time;
    if (span <= 0) return scope.value;
    if (direction === 'out' && t <= last) return scope.value;
    if (direction === 'in' && t >= first) return scope.value;
    const rel = direction === 'out' ? t - last : first - t;
    const cycles = Math.floor(rel / span);
    const phase = rel - cycles * span;
    if (type === 'pingpong') {
      const forward = cycles % 2 === 1;
      return direction === 'out' ? scope.valueAtTime(forward ? first + phase : last - phase) : scope.valueAtTime(forward ? last - phase : first + phase);
    }
    if (type === 'offset' || type === 'continue') {
      const delta = arith('-', scope.valueAtTime(last), scope.valueAtTime(first));
      const at = direction === 'out' ? first + phase : last - phase;
      return arith('+', scope.valueAtTime(at), arith('*', delta, direction === 'out' ? cycles + 1 : -(cycles + 1)));
    }
    return scope.valueAtTime(direction === 'out' ? first + phase : last - phase);
  };
  const math: Record<string, Value> = {
    sin: (x: Value) => mapVec(x, Math.sin), cos: (x: Value) => mapVec(x, Math.cos), tan: (x: Value) => mapVec(x, Math.tan),
    abs: (x: Value) => mapVec(x, Math.abs), floor: (x: Value) => mapVec(x, Math.floor), ceil: (x: Value) => mapVec(x, Math.ceil),
    round: (x: Value) => mapVec(x, Math.round), sqrt: (x: Value) => mapVec(x, Math.sqrt), exp: (x: Value) => mapVec(x, Math.exp),
    log: (x: Value) => mapVec(x, Math.log), atan: (x: Value) => mapVec(x, Math.atan), asin: (x: Value) => mapVec(x, Math.asin), acos: (x: Value) => mapVec(x, Math.acos),
    atan2: (y: Value, x: Value) => Math.atan2(toNum(y), toNum(x)), pow: (a: Value, b: Value) => toNum(a) ** toNum(b),
    min: (...a: Value[]) => Math.min(...a.map(toNum)), max: (...a: Value[]) => Math.max(...a.map(toNum)),
    sign: (x: Value) => mapVec(x, Math.sign), PI: Math.PI, E: Math.E,
    random: () => random(),
  };
  return {
    Math: math,
    ...math,
    time: env.time,
    value: scope.value,
    index: scope.index ?? 0,
    inPoint: scope.inPoint ?? 0,
    outPoint: scope.outPoint ?? scope.duration ?? 0,
    thisComp: { width: scope.width ?? 1920, height: scope.height ?? 1080, duration: scope.duration ?? 0, frameDuration: 1 / 30 },
    wiggle,
    loopOut: loop('out'),
    loopIn: loop('in'),
    valueAtTime: (t: Value) => scope.valueAtTime(toNum(t)),
    linear: interpolateFn('linear'),
    ease: interpolateFn('ease'),
    easeIn: interpolateFn('easeIn'),
    easeOut: interpolateFn('easeOut'),
    clamp: (v: Value, lo: Value, hi: Value) => mapVec(v, (x) => Math.min(toNum(hi), Math.max(toNum(lo), x))),
    random: (...args: Value[]) => {
      if (!args.length) return random();
      if (args.length === 1) return Array.isArray(args[0]) ? args[0].map((v) => random() * v) : random() * toNum(args[0]);
      return arith('+', args[0], arith('*', arith('-', args[1], args[0]), random()));
    },
    gaussRandom: (...args: Value[]) => {
      const g = () => { let s = 0; for (let i = 0; i < 6; i++) s += random(); return s / 6; };
      if (!args.length) return g();
      return arith('+', args[0], arith('*', arith('-', args[1] ?? 1, args[0]), g()));
    },
    noise: (x: Value) => noise1(toNum(x), scope.seed),
    degreesToRadians: (x: Value) => mapVec(x, (v) => (v * Math.PI) / 180),
    radiansToDegrees: (x: Value) => mapVec(x, (v) => (v * 180) / Math.PI),
    length: (a: Value, b?: Value) => {
      const d = b === undefined ? a : arith('-', a, b);
      return Array.isArray(d) ? Math.hypot(...d) : Math.abs(toNum(d));
    },
    normalize: (a: Value) => { const v = Array.isArray(a) ? a : [toNum(a)]; const l = Math.hypot(...v) || 1; return v.map((x) => x / l); },
    add: (a: Value, b: Value) => arith('+', a, b), sub: (a: Value, b: Value) => arith('-', a, b),
    mul: (a: Value, b: Value) => arith('*', a, b), div: (a: Value, b: Value) => arith('/', a, b),
    posterizeTime: (fps: Value) => { const f = Math.max(0.01, toNum(fps)); env.time = Math.floor(env.time * f) / f; return undefined; },
    seedRandom: () => undefined,
  };
}

const cache = new Map<string, Node | Error>();

function run(node: Node, globals: Record<string, Value>, locals: Map<string, Value>, env: { time: number }): Value {
  switch (node.t) {
    case 'num': return node.v;
    case 'str': return node.v;
    case 'id':
      if (locals.has(node.name)) return locals.get(node.name);
      if (node.name === 'time') return env.time;
      if (node.name in globals) return globals[node.name];
      throw new Error(`unknown name "${node.name}"`);
    case 'arr': return node.items.map((item) => toNum(run(item, globals, locals, env)));
    case 'un': {
      const v = run(node.arg, globals, locals, env);
      if (node.op === '-') return mapVec(v, (x) => -x);
      if (node.op === '!') return truthy(v) ? 0 : 1;
      return v;
    }
    case 'bin': {
      if (node.op === '&&') { const a = run(node.a, globals, locals, env); return truthy(a) ? run(node.b, globals, locals, env) : a; }
      if (node.op === '||') { const a = run(node.a, globals, locals, env); return truthy(a) ? a : run(node.b, globals, locals, env); }
      const a = run(node.a, globals, locals, env);
      const b = run(node.b, globals, locals, env);
      if (['<', '>', '<=', '>=', '==', '!=', '===', '!=='].includes(node.op)) return compare(node.op, a, b);
      return arith(node.op, a, b);
    }
    case 'tern': return truthy(run(node.c, globals, locals, env)) ? run(node.a, globals, locals, env) : run(node.b, globals, locals, env);
    case 'call': {
      const fn = run(node.fn, globals, locals, env);
      if (typeof fn !== 'function') throw new Error('called something that is not a function');
      // wiggle/loopOut read `time` from env; refresh the globals' time first.
      globals.time = env.time;
      return fn(...node.args.map((arg) => run(arg, globals, locals, env)));
    }
    case 'mem': {
      const obj = run(node.obj, globals, locals, env);
      if (Array.isArray(obj)) return node.prop === 'length' ? obj.length : undefined;
      if (obj && typeof obj === 'object') return (obj as Record<string, Value>)[node.prop];
      throw new Error(`cannot read "${node.prop}"`);
    }
    case 'idx': {
      const obj = run(node.obj, globals, locals, env);
      const index = toNum(run(node.index, globals, locals, env));
      if (Array.isArray(obj)) return obj[index] ?? 0;
      if (typeof obj === 'number') return obj;
      return undefined;
    }
    case 'var':
    case 'assign': {
      const value = run(node.value, globals, locals, env);
      locals.set(node.name, value);
      return value;
    }
    case 'seq': {
      let last: Value;
      for (const statement of node.body) {
        const value = run(statement, globals, locals, env);
        if (value !== undefined) last = value;
      }
      return last;
    }
  }
}

/** Checks an expression parses, for tools that accept expressions from the AI. */
export function checkExpression(src: string): string | null {
  try {
    parse(src);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** Evaluates `src`; a broken expression returns the property's own value (AE shows an error and does the same). */
export function evaluateExpression(src: string, scope: ExprScope): number | number[] {
  let node = cache.get(src);
  if (!node) {
    try { node = parse(src); } catch (error) { node = error instanceof Error ? error : new Error(String(error)); }
    cache.set(src, node);
  }
  if (node instanceof Error) return scope.value;
  const env = { time: scope.time };
  try {
    const result = run(node, buildGlobals(scope, env), new Map(), env);
    if (typeof result === 'number' && Number.isFinite(result)) return result;
    if (Array.isArray(result) && result.every(Number.isFinite)) return result;
    return scope.value;
  } catch {
    return scope.value;
  }
}
