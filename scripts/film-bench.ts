// Phase 7 (docs/plans/NATIVE-AI-TOOLKIT-PLAN.md): the film benchmark. Each of the six 15 s films
// the film lab made from scratch is rebuilt inside Bhippi by three models, scored blind on the
// film-lab critics' ten criteria, and costed in tokens and minutes. docs/benchmark/README.md is the
// procedure; this script does the bookkeeping so every round is counted the same way.
//
//   node scripts/film-bench.ts plan   <run>                       the run folder, 6 films × 3 tiers
//   node scripts/film-bench.ts record <run> <film> <tier> --project <folder> [--film <mp4>]
//                                                                  tokens, minutes and calls from Bhippi's turn traces
//   node scripts/film-bench.ts blind  <run> [--seed <n>] [--no-free] films renamed F01…, the key kept apart
//   node scripts/film-bench.ts score  <run> [--against <run>] [--publish]
//                                                                  critics' cards → scores, targets, regressions
//
// Runs on Node 22.18+ (type stripping). BHIPPI_DATA overrides where Bhippi's app data folder is
// looked for, as in scripts/session-report.mjs. Everything here only reads the app's traces.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Tier = 'opus' | 'mid' | 'small' | 'free';
export type Film = { id: string; title: string; playbook: string; reference: string; audio: string; inputs: { name: string; from: string }[]; brief: string; baseline: { score: number | null; render: string | null; minutes: number | null; note: string } };
export type Run = { film: string; tier: Tier; model: string; effort: string; project: string | null; video: string | null; cost: Cost | null };
export type Cost = { turns: number; input: number; output: number; tokens: number; activeMinutes: number; wallMinutes: number; calls: number; failed: number; judge: number[]; models: string[]; tiers: string[]; efforts: string[]; playbooks: string[] };
export type Card = { blind: string; critic: string; scores: Record<string, number>; deduction?: number; why?: string };
export type KeyEntry = { blind: string; film: string; tier: Tier; video: string };

/** The film-lab critics' ten criteria (docs/benchmark/rubric.md), 0–10 each, summed to /100. */
export const CRITERIA = ['look', 'faithfulness', 'camera', 'type', 'sync', 'clarity', 'flow', 'polish', 'originality', 'audio'] as const;
/** The plan's targets: a tier passes when its mean over the six films reaches this. */
export const TARGETS: Record<Exclude<Tier, 'free'>, number> = { opus: 85, mid: 78, small: 70 };
export const TIERS: Exclude<Tier, 'free'>[] = ['opus', 'mid', 'small'];
/** Critics further apart than this on one film get a third critic. */
export const CRITIC_SPREAD = 8;
/** A known render scored this far from its recorded score means the critic is off calibration. */
export const CALIBRATION = 5;
/** Cost growth against the previous round that counts as a regression. */
export const COST_SLACK = 0.1;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function loadFilms(): Film[] {
  return JSON.parse(readFileSync(join(ROOT, 'docs', 'benchmark', 'films.json'), 'utf8')).films as Film[];
}

// --- Scoring ---------------------------------------------------------------------------------

/** A card's score out of 100: the ten criteria summed, less the critic's deduction (0–2) for what they miss. */
export function cardScore(card: Card): number {
  for (const name of CRITERIA) {
    const value = card.scores[name];
    if (typeof value !== 'number' || value < 0 || value > 10 || Math.round(value * 2) !== value * 2) throw new Error(`${card.blind} (${card.critic}): ${name} must be 0–10 in half points, not ${value}`);
  }
  const deduction = card.deduction ?? 0;
  if (deduction < 0 || deduction > 2) throw new Error(`${card.blind} (${card.critic}): the deduction is 0–2, not ${deduction}`);
  if (deduction > 0 && !card.why?.trim()) throw new Error(`${card.blind} (${card.critic}): say why the deduction was taken`);
  const sum = CRITERIA.reduce((total, name) => total + card.scores[name], 0);
  return Math.round((sum - deduction) * 10) / 10;
}

/** A small seeded shuffle, so a blind order can be rebuilt from its seed and nobody picks it. */
export function blindOrder<T>(items: T[], seed: number): T[] {
  let state = seed >>> 0 || 1;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export type Row = { film: string; tier: Tier; blind: string; score: number | null; critics: number[]; spread: number; cost: Cost | null; note: string[] };

/** Every scored film with its critics' mean, and what needs a human look (a split panel, an off-calibration critic). */
export function scoreRows(key: KeyEntry[], cards: Card[], runs: Run[], films: Film[]): Row[] {
  return key.map((entry) => {
    const critics = cards.filter((card) => card.blind === entry.blind).map(cardScore);
    const score = critics.length ? Math.round((critics.reduce((a, b) => a + b, 0) / critics.length) * 10) / 10 : null;
    const spread = critics.length ? Math.max(...critics) - Math.min(...critics) : 0;
    const note: string[] = [];
    if (!critics.length) note.push('not scored yet');
    if (spread > CRITIC_SPREAD) note.push(`critics ${spread.toFixed(1)} apart: add a third critic`);
    const recorded = films.find((film) => film.id === entry.film)?.baseline.score;
    if (entry.tier === 'free' && score !== null && recorded != null && Math.abs(score - recorded) > CALIBRATION) note.push(`calibration: the recorded score is ${recorded}`);
    const run = runs.find((r) => r.film === entry.film && r.tier === entry.tier);
    return { film: entry.film, tier: entry.tier, blind: entry.blind, score, critics, spread, cost: run?.cost ?? null, note };
  });
}

export type TierVerdict = { tier: Exclude<Tier, 'free'>; target: number; mean: number | null; films: number; worst: { film: string; score: number } | null; passed: boolean };

/** A tier passes when all six films are scored, their mean reaches the target and none is more than 5 under it. */
export function tierVerdicts(rows: Row[], filmCount: number): TierVerdict[] {
  return TIERS.map((tier) => {
    const scored = rows.filter((row) => row.tier === tier && row.score !== null) as (Row & { score: number })[];
    const mean = scored.length ? Math.round((scored.reduce((a, row) => a + row.score, 0) / scored.length) * 10) / 10 : null;
    const worst = scored.length ? scored.reduce((a, b) => (b.score < a.score ? b : a)) : null;
    const target = TARGETS[tier];
    const passed = scored.length === filmCount && mean !== null && mean >= target && !!worst && worst.score >= target - 5;
    return { tier, target, mean, films: scored.length, worst: worst ? { film: worst.film, score: worst.score } : null, passed };
  });
}

/** What got worse since the last round: a lower score, or more tokens or minutes beyond the slack. */
export function regressions(now: Row[], before: Row[]): string[] {
  const out: string[] = [];
  for (const row of now) {
    if (row.tier === 'free') continue;
    const old = before.find((b) => b.film === row.film && b.tier === row.tier);
    if (!old) continue;
    const name = `${row.film} / ${row.tier}`;
    if (row.score !== null && old.score !== null && row.score < old.score) out.push(`${name}: score ${old.score} → ${row.score}`);
    if (row.cost && old.cost) {
      if (row.cost.tokens > old.cost.tokens * (1 + COST_SLACK)) out.push(`${name}: tokens ${old.cost.tokens.toLocaleString('en')} → ${row.cost.tokens.toLocaleString('en')}`);
      if (row.cost.activeMinutes > old.cost.activeMinutes * (1 + COST_SLACK)) out.push(`${name}: minutes ${old.cost.activeMinutes.toFixed(0)} → ${row.cost.activeMinutes.toFixed(0)}`);
    }
  }
  return out;
}

// --- Cost from Bhippi's turn traces -----------------------------------------------------------

type Event = { ev?: string; t?: number; [key: string]: unknown };

/** One film's cost: every turn of its project, summed (src-tauri/src/trace.rs writes them). */
export function summariseTurns(turns: Event[][]): Cost {
  const cost: Cost = { turns: 0, input: 0, output: 0, tokens: 0, activeMinutes: 0, wallMinutes: 0, calls: 0, failed: 0, judge: [], models: [], tiers: [], efforts: [], playbooks: [] };
  const add = (list: string[], value: unknown) => { if (typeof value === 'string' && value && !list.includes(value)) list.push(value); };
  let first = Infinity;
  let last = -Infinity;
  for (const events of turns) {
    if (!events.length) continue;
    cost.turns++;
    for (const e of events) {
      if (typeof e.t === 'number') { first = Math.min(first, e.t); last = Math.max(last, e.t); }
      if (e.ev === 'turn_sent') { add(cost.models, e.model); add(cost.tiers, e.tier); add(cost.efforts, e.effort); add(cost.playbooks, e.playbook); }
      if (e.ev === 'turn_start') add(cost.models, e.model);
      if (e.ev === 'tool') {
        cost.calls++;
        if (e.status !== 'done') cost.failed++;
        const judge = (e.judge as { score?: number } | undefined)?.score;
        if (typeof judge === 'number') cost.judge.push(judge);
      }
      if (e.ev === 'turn_end') {
        const usage = e.usage as { inputTokens?: number; outputTokens?: number } | null | undefined;
        cost.input += usage?.inputTokens ?? 0;
        cost.output += usage?.outputTokens ?? 0;
        if (typeof e.elapsedMs === 'number') cost.activeMinutes += e.elapsedMs / 60000;
      }
    }
  }
  cost.tokens = cost.input + cost.output;
  cost.activeMinutes = Math.round(cost.activeMinutes * 10) / 10;
  cost.wallMinutes = Number.isFinite(first) ? Math.round(((last - first) / 60000) * 10) / 10 : 0;
  return cost;
}

/** Tauri's app data folder for com.bhippi.videoeditor. */
function dataDir(): string {
  if (process.env.BHIPPI_DATA) return process.env.BHIPPI_DATA;
  const id = 'com.bhippi.videoeditor';
  if (platform() === 'win32') return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), id);
  if (platform() === 'darwin') return join(homedir(), 'Library', 'Application Support', id);
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), id);
}

/** films.json writes the owner's folders as ~/…. */
export const expandHome = (path: string) => (path.startsWith('~/') ? join(homedir(), path.slice(2)) : path);

const samePath = (a: string, b: string) => a.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() === b.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

/** Every turn Bhippi traced for one project folder. */
function projectTurns(folder: string): Event[][] {
  const root = join(dataDir(), 'traces');
  if (!existsSync(root)) throw new Error(`No turn traces at ${root}: keep Settings → Brain → Keep turn traces on while the benchmark runs.`);
  const turns: Event[][] = [];
  for (const name of readdirSync(root)) {
    const dir = join(root, name);
    const note = join(dir, 'project.txt');
    if (!statSync(dir).isDirectory() || !existsSync(note) || !samePath(readFileSync(note, 'utf8').trim(), folder)) continue;
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.jsonl'))) {
      const events: Event[] = [];
      for (const line of readFileSync(join(dir, file), 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try { events.push(JSON.parse(line)); } catch { /* a torn last line */ }
      }
      turns.push(events);
    }
  }
  return turns;
}

// --- The run folder ---------------------------------------------------------------------------

const readJson = <T>(path: string, fallback: T): T => (existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : fallback);
const writeJson = (path: string, value: unknown) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

function plan(run: string, flags: Record<string, string>) {
  const films = loadFilms();
  mkdirSync(join(run, 'briefs'), { recursive: true });
  mkdirSync(join(run, 'scores'), { recursive: true });
  const models: Record<string, string> = Object.fromEntries((flags.models ?? '').split(',').filter(Boolean).map((pair) => pair.split('=') as [string, string]));
  const runs: Run[] = readJson(join(run, 'runs.json'), [] as Run[]);
  for (const film of films) {
    writeFileSync(join(run, 'briefs', `${film.id}.txt`), `${film.brief}\n`);
    for (const tier of TIERS) {
      if (runs.some((r) => r.film === film.id && r.tier === tier)) continue;
      runs.push({ film: film.id, tier, model: models[tier] ?? '', effort: tier === 'opus' ? 'max' : tier === 'mid' ? 'high' : 'default', project: null, video: null, cost: null });
    }
  }
  writeJson(join(run, 'runs.json'), runs);
  console.log(`${runs.length} runs in ${run}. For each: a fresh project, the brief in briefs/<film>.txt, then\n  node scripts/film-bench.ts record ${run} <film> <tier> --project <folder> --film <export.mp4>`);
}

function record(run: string, film: string, tier: Tier, flags: Record<string, string>) {
  const runs: Run[] = readJson(join(run, 'runs.json'), [] as Run[]);
  const entry = runs.find((r) => r.film === film && r.tier === tier);
  if (!entry) throw new Error(`No run ${film} / ${tier} in ${run}/runs.json (run plan first)`);
  if (!flags.project) throw new Error('Give --project: the Bhippi project folder the film was made in');
  entry.project = flags.project;
  if (flags.film) entry.video = resolve(flags.film);
  entry.cost = summariseTurns(projectTurns(flags.project));
  writeJson(join(run, 'runs.json'), runs);
  const c = entry.cost;
  console.log(`${film} / ${tier}: ${c.turns} turns, ${c.tokens.toLocaleString('en')} tokens, ${c.activeMinutes} min active (${c.wallMinutes} wall), ${c.failed}/${c.calls} calls failed${c.judge.length ? `, judge ${c.judge.join(' → ')}` : ''}`);
  const want = tier === 'small' ? 'guided' : 'full';
  if (c.tiers.length && !c.tiers.every((t) => t === want)) console.log(`  ! Bhippi ran it on the ${c.tiers.join('/')} tier; a ${tier} run should be ${want}.`);
  if (tier === 'opus' && c.efforts.some((e) => e !== 'max')) console.log(`  ! effort was ${c.efforts.join('/')}; the Opus runs are at Max.`);
}

function blind(run: string, flags: Record<string, string>) {
  const films = loadFilms();
  const runs: Run[] = readJson(join(run, 'runs.json'), [] as Run[]);
  const pool: Omit<KeyEntry, 'blind'>[] = runs.filter((r) => r.video && existsSync(r.video)).map((r) => ({ film: r.film, tier: r.tier, video: r.video! }));
  // The from-scratch renders go in blind too: they calibrate the critics against their recorded scores.
  for (const film of flags['no-free'] === undefined ? films : []) {
    const render = film.baseline.render && expandHome(film.baseline.render);
    if (render && existsSync(render)) pool.push({ film: film.id, tier: 'free', video: render });
  }
  const seed = Number(flags.seed ?? Date.now() % 1e9);
  const key: KeyEntry[] = blindOrder(pool, seed).map((entry, i) => ({ blind: `F${String(i + 1).padStart(2, '0')}`, ...entry }));
  const out = join(run, 'blind');
  mkdirSync(out, { recursive: true });
  for (const entry of key) {
    copyFileSync(entry.video, join(out, `${entry.blind}.mp4`));
    const film = films.find((f) => f.id === entry.film)!;
    // The card tells the critic which film it is (and so its reference), never who made it.
    writeJson(join(out, `${entry.blind}.card.json`), { blind: entry.blind, film: film.id, reference: film.reference, brief: film.brief, critic: '', scores: Object.fromEntries(CRITERIA.map((name) => [name, null])), deduction: 0, why: '' });
  }
  copyFileSync(join(ROOT, 'docs', 'benchmark', 'rubric.md'), join(out, 'rubric.md'));
  writeJson(join(run, 'key.json'), { seed, key });
  console.log(`${key.length} films in ${out}. Keep key.json away from the critics; each critic copies the cards into scores/<critic>/ and fills them in.`);
}

function readCards(run: string): Card[] {
  const dir = join(run, 'scores');
  if (!existsSync(dir)) return [];
  const cards: Card[] = [];
  for (const critic of readdirSync(dir)) {
    if (!statSync(join(dir, critic)).isDirectory()) continue;
    for (const file of readdirSync(join(dir, critic)).filter((f) => f.endsWith('.json'))) {
      const card = JSON.parse(readFileSync(join(dir, critic, file), 'utf8')) as Card;
      if (Object.values(card.scores).some((v) => v === null)) continue;
      cards.push({ ...card, critic: card.critic || critic });
    }
  }
  return cards;
}

function rowsOf(run: string): Row[] {
  const { key } = readJson(join(run, 'key.json'), { key: [] as KeyEntry[] });
  return scoreRows(key, readCards(run), readJson(join(run, 'runs.json'), [] as Run[]), loadFilms());
}

export function resultsMarkdown(name: string, rows: Row[], films: Film[], verdicts: TierVerdict[], worse: string[]): string {
  const cell = (film: string, tier: Tier) => {
    const row = rows.find((r) => r.film === film && r.tier === tier);
    if (!row || row.score === null) return '–';
    return row.cost ? `**${row.score}** · ${Math.round(row.cost.tokens / 1000)} K · ${row.cost.activeMinutes.toFixed(0)} min` : `**${row.score}**`;
  };
  const lines = [
    `# Film benchmark: ${name}`,
    '',
    'Blind critic scores on the film-lab rubric (docs/benchmark/rubric.md), mean of the critics; tokens and active minutes from Bhippi\'s turn traces. "free" is the film lab\'s from-scratch render, scored blind in the same pool.',
    '',
    `| Film | Opus (≥ ${TARGETS.opus}) | Mid (≥ ${TARGETS.mid}) | Small (≥ ${TARGETS.small}) | Free run (recorded) |`,
    '|---|---|---|---|---|',
    ...films.map((film) => `| ${film.id} | ${cell(film.id, 'opus')} | ${cell(film.id, 'mid')} | ${cell(film.id, 'small')} | ${cell(film.id, 'free')} (${film.baseline.score ?? '–'}) |`),
    '',
    '| Tier | Mean | Films scored | Lowest | Target | Verdict |',
    '|---|---|---|---|---|---|',
    ...verdicts.map((v) => `| ${v.tier} | ${v.mean ?? '–'} | ${v.films}/${films.length} | ${v.worst ? `${v.worst.score} (${v.worst.film})` : '–'} | ${v.target} | ${v.passed ? 'pass' : v.films < films.length ? 'incomplete' : 'below target'} |`),
    '',
  ];
  const notes = rows.filter((r) => r.note.length).map((r) => `- ${r.blind} (${r.film} / ${r.tier}): ${r.note.join('; ')}`);
  if (notes.length) lines.push('## Needs a look', '', ...notes, '');
  lines.push('## Regressions against the previous round', '', ...(worse.length ? worse.map((w) => `- ${w}`) : ['None.']), '');
  return lines.join('\n');
}

function score(run: string, flags: Record<string, string>) {
  const films = loadFilms();
  const rows = rowsOf(run);
  const verdicts = tierVerdicts(rows, films.length);
  const worse = flags.against ? regressions(rows, rowsOf(flags.against)) : [];
  const text = resultsMarkdown(basename(resolve(run)), rows, films, verdicts, worse);
  writeFileSync(join(run, 'results.md'), text);
  writeJson(join(run, 'results.json'), { rows, verdicts, regressions: worse });
  if (flags.publish !== undefined) {
    const dir = join(ROOT, 'docs', 'benchmark', 'results');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${basename(resolve(run))}.md`), text);
  }
  console.log(text);
}

function main(argv: string[]) {
  const [command, given, ...rest] = argv;
  const run = given && expandHome(given);
  const flags: Record<string, string> = {};
  const positional: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith('--')) {
      const name = rest[i].slice(2);
      const value = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : '';
      flags[name] = expandHome(value);
    } else positional.push(rest[i]);
  }
  if (!command || !run) {
    console.log('node scripts/film-bench.ts plan|record|blind|score <run folder> … (see docs/benchmark/README.md)');
    return;
  }
  if (command === 'plan') plan(run, flags);
  else if (command === 'record') record(run, positional[0], positional[1] as Tier, flags);
  else if (command === 'blind') blind(run, flags);
  else if (command === 'score') score(run, flags);
  else throw new Error(`Unknown command ${command}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
