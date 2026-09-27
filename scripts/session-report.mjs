// Phase 6 (docs/AI-CREW-PLAN.md): what a real AI run cost.
//
//   node scripts/session-report.mjs            the latest OpenCode session
//   node scripts/session-report.mjs <session>  a given session id
//   node scripts/session-report.mjs --last 5   the latest five, one line each
//
//   node scripts/session-report.mjs --bhippi             the latest Bhippi turn trace, any provider
//   node scripts/session-report.mjs --bhippi <turn>      a given turn
//   node scripts/session-report.mjs --bhippi --last 5    the latest five, one line each
//
// Steps, tokens (input + cache read + output), failed tool calls, the heaviest tools by result
// size, and the Judge's scores when judge_edit ran: the numbers to compare before and after a
// change to the prompt, the router or a tool. OpenCode sessions come from OpenCode's own records;
// Bhippi turn traces (src-tauri/src/trace.rs) cover every provider, and add what argRepair
// mended, what readDedupe answered and what the guard or the permission mode refused.
// BHIPPI_DATA overrides where Bhippi's app data folder is looked for.
import { DatabaseSync } from 'node:sqlite';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';

const args = process.argv.slice(2);
const bhippi = args[0] === '--bhippi';
if (bhippi) args.shift();
const lastN = args[0] === '--last' ? Number(args[1] ?? 5) : null;

const fmt = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)} M` : n >= 1e3 ? `${Math.round(n / 1e3)} K` : String(n));

// --- OpenCode ---------------------------------------------------------------------------------

function openCode() {
  const DB = join(homedir(), '.local', 'share', 'opencode', 'opencode.db');
  if (!existsSync(DB)) {
    console.error(`No OpenCode database at ${DB}. (For Bhippi's own traces: --bhippi)`);
    process.exit(1);
  }
  const db = new DatabaseSync(DB, { readOnly: true });

  function report(sessionId) {
    const session = db.prepare('select id, title, time_created, time_updated from session where id = ?').get(sessionId);
    if (!session) throw new Error(`No session ${sessionId}`);
    const tools = new Map();
    const tokens = { input: 0, cacheRead: 0, output: 0 };
    const scores = [];
    let steps = 0;
    let calls = 0;
    let failed = 0;
    for (const { data } of db.prepare('select data from part where session_id = ? order by time_created').iterate(sessionId)) {
      const part = JSON.parse(data);
      if (part.type === 'step-finish') {
        steps++;
        tokens.input += part.tokens?.input ?? 0;
        tokens.cacheRead += part.tokens?.cache?.read ?? 0;
        tokens.output += (part.tokens?.output ?? 0) + (part.tokens?.reasoning ?? 0);
      } else if (part.type === 'tool') {
        calls++;
        const name = String(part.tool ?? '?').replace(/^bhippi_/, '');
        const state = part.state ?? {};
        const row = tools.get(name) ?? { calls: 0, failed: 0, chars: 0 };
        row.calls++;
        row.chars += String(state.output ?? '').length + JSON.stringify(state.input ?? {}).length;
        if (state.status === 'error') { row.failed++; failed++; }
        tools.set(name, row);
        const score = name === 'judge_edit' && /Judge: (\d+)\/100/.exec(String(state.output ?? ''));
        if (score) scores.push(Number(score[1]));
      }
    }
    const total = tokens.input + tokens.cacheRead + tokens.output;
    const minutes = (session.time_updated - session.time_created) / 60000;
    return { session, steps, calls, failed, tokens, total, minutes, tools, scores };
  }

  if (lastN) {
    for (const { id } of db.prepare('select id from session order by time_updated desc limit ?').all(lastN)) {
      const r = report(id);
      console.log(`${id}  ${r.steps} steps  ${fmt(r.total)} tokens  ${r.failed}/${r.calls} failed  ${r.minutes.toFixed(0)} min  ${r.scores.length ? `judge ${r.scores.join('→')}` : ''}  ${r.session.title.slice(0, 50)}`);
    }
  } else {
    const id = args[0] ?? db.prepare('select id from session order by time_updated desc limit 1').get().id;
    const r = report(id);
    console.log(`${r.session.title}\n${id}\n`);
    console.log(`Steps          ${r.steps}  (${r.minutes.toFixed(0)} min)`);
    console.log(`Tokens         ${fmt(r.total)}  = input ${fmt(r.tokens.input)} + cache read ${fmt(r.tokens.cacheRead)} + output ${fmt(r.tokens.output)}`);
    console.log(`Per step       ${fmt(r.steps ? r.total / r.steps : 0)}`);
    console.log(`Tool calls     ${r.calls}, failed ${r.failed} (${r.calls ? ((r.failed / r.calls) * 100).toFixed(1) : 0}%)`);
    if (r.scores.length) console.log(`Judge          ${r.scores.join(' → ')}`);
    console.log('\nHeaviest tools (result + args size):');
    for (const [name, row] of [...r.tools].sort((a, b) => b[1].chars - a[1].chars).slice(0, 12)) {
      console.log(`  ${name.padEnd(30)} ${String(row.calls).padStart(4)} calls ${String(row.failed).padStart(3)} failed ${fmt(row.chars).padStart(7)} chars`);
    }
  }
}

// --- Bhippi turn traces -----------------------------------------------------------------------

/** Tauri's app data folder for com.bhippi.videoeditor. */
function dataDir() {
  if (process.env.BHIPPI_DATA) return process.env.BHIPPI_DATA;
  const id = 'com.bhippi.videoeditor';
  if (platform() === 'win32') return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), id);
  if (platform() === 'darwin') return join(homedir(), 'Library', 'Application Support', id);
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), id);
}

/** Every trace file across projects, newest first. */
function traceFiles() {
  const root = join(dataDir(), 'traces');
  if (!existsSync(root)) {
    console.error(`No Bhippi turn traces at ${root}. Run an AI turn with Settings → Brain → Keep turn traces on.`);
    process.exit(1);
  }
  const files = [];
  for (const project of readdirSync(root)) {
    const dir = join(root, project);
    if (!statSync(dir).isDirectory()) continue;
    const note = join(dir, 'project.txt');
    const folder = existsSync(note) ? readFileSync(note, 'utf8').trim() : project === 'unsaved' ? '(unsaved project)' : project;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.jsonl')) continue;
      const path = join(dir, name);
      files.push({ turn: name.slice(0, -'.jsonl'.length), folder, path, modified: statSync(path).mtimeMs });
    }
  }
  return files.sort((a, b) => b.modified - a.modified);
}

function traceReport(file) {
  const events = [];
  for (const line of readFileSync(file.path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { events.push(JSON.parse(line)); } catch { /* a torn last line */ }
  }
  const start = events.find((e) => e.ev === 'turn_start') ?? {};
  const sent = events.find((e) => e.ev === 'turn_sent') ?? {};
  const end = events.find((e) => e.ev === 'turn_end') ?? {};
  const tools = new Map();
  const counts = { calls: 0, failed: 0, blocked: 0, denied: 0, repaired: 0, deduped: 0, edits: 0 };
  const scores = [];
  const failures = [];
  for (const e of events.filter((e) => e.ev === 'tool')) {
    counts.calls++;
    const row = tools.get(e.name) ?? { calls: 0, failed: 0, chars: 0, ms: 0 };
    row.calls++;
    row.chars += (e.argsChars ?? 0) + (e.resultChars ?? 0);
    row.ms += e.ms ?? 0;
    if (e.status !== 'done') {
      row.failed++;
      counts[e.status === 'blocked' ? 'blocked' : e.status === 'denied' ? 'denied' : 'failed']++;
      failures.push(e);
    }
    if (e.repaired) counts.repaired++;
    if (e.deduped) counts.deduped++;
    if (e.changedProject) counts.edits++;
    if (e.judge?.score != null) scores.push(e.judge.score);
    tools.set(e.name, row);
  }
  const first = events[0]?.t ?? 0;
  const last = events.at(-1)?.t ?? first;
  const minutes = (end.elapsedMs ?? last - first) / 60000;
  const tokens = { input: end.usage?.inputTokens ?? 0, output: end.usage?.outputTokens ?? 0 };
  return { file, start, sent, end, tools, counts, scores, failures, minutes, tokens, total: tokens.input + tokens.output };
}

function bhippiReport() {
  const files = traceFiles();
  if (lastN) {
    for (const file of files.slice(0, lastN)) {
      const r = traceReport(file);
      const failed = r.counts.failed + r.counts.blocked + r.counts.denied;
      console.log(`${file.turn}  ${r.start.provider ?? r.sent.providerId ?? '?'}  ${fmt(r.total)} tokens  ${failed}/${r.counts.calls} failed  ${r.minutes.toFixed(0)} min  ${r.end.outcome ?? 'unfinished'}  ${r.scores.length ? `judge ${r.scores.join('→')}` : ''}  ${file.folder.slice(-40)}`);
    }
    return;
  }
  const file = args[0] ? files.find((f) => f.turn === args[0]) : files[0];
  if (!file) {
    console.error(args[0] ? `No trace for turn ${args[0]}` : 'No traces yet.');
    process.exit(1);
  }
  const r = traceReport(file);
  const c = r.counts;
  console.log(`${file.folder}\n${file.turn}\n`);
  console.log(`Provider       ${r.start.provider ?? r.sent.providerId ?? '?'}${r.start.model ? ` · ${r.start.model}` : ''}  (${r.minutes.toFixed(1)} min, ${r.end.outcome ?? 'unfinished'}${r.end.fault ? `: ${r.end.fault.title}` : ''})`);
  if (r.sent.genres) console.log(`Routed         ${r.sent.genres.join(' + ')}, ${r.sent.toolsWhole} tools whole${r.sent.phase ? `, phase ${r.sent.phase}` : ''}${r.sent.playbook ? `, playbook ${r.sent.playbook}` : ''}`);
  console.log(`Tokens         ${fmt(r.total)}  = input ${fmt(r.tokens.input)} + output ${fmt(r.tokens.output)}`);
  console.log(`Tool calls     ${c.calls}: ${c.edits} changed the project, failed ${c.failed}, guard-blocked ${c.blocked}, denied ${c.denied} (${c.calls ? (((c.failed + c.blocked + c.denied) / c.calls) * 100).toFixed(1) : 0}%)`);
  console.log(`Token Council  argRepair mended ${c.repaired}, readDedupe answered ${c.deduped}`);
  if (r.scores.length) console.log(`Judge          ${r.scores.join(' → ')}`);
  console.log('\nHeaviest tools (result + args size):');
  for (const [name, row] of [...r.tools].sort((a, b) => b[1].chars - a[1].chars).slice(0, 12)) {
    console.log(`  ${name.padEnd(30)} ${String(row.calls).padStart(4)} calls ${String(row.failed).padStart(3)} failed ${fmt(row.chars).padStart(7)} chars ${(row.ms / 1000).toFixed(1).padStart(6)} s`);
  }
  if (r.failures.length) {
    console.log('\nFailed calls:');
    for (const e of r.failures.slice(0, 15)) console.log(`  [${e.status}] ${e.name}: ${String(e.error ?? '').split('\n')[0].slice(0, 110)}`);
    if (r.failures.length > 15) console.log(`  … ${r.failures.length - 15} more`);
  }
}

if (bhippi) bhippiReport();
else openCode();
