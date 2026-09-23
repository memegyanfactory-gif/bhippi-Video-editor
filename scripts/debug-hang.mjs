// Dumps every thread's stack of a running (or frozen) Helios, without stopping or changing it.
//
//   npm run debug:hang            the Helios window process
//   npm run debug:hang -- 1234    a specific pid
//
// Uses cdb (WinDbg) in noninvasive mode (-pv): the app keeps running, unsaved work is safe.
// The full dump goes to target/hang-reports/; the console gets the UI thread's stack with
// Helios' own frames marked, plus the tail of hang.log from the UI watchdog.
// First run downloads Windows symbols into target/symcache (slow once, cached after).
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

if (process.platform !== 'win32') {
  console.error('debug:hang is Windows-only (it drives cdb). On macOS/Linux use `sample` or `gdb -p`.');
  process.exit(1);
}

function findCdb() {
  const candidates = [];
  try {
    // WindowsApps itself is not listable; the package manager knows where WinDbg lives.
    const location = execFileSync(
      'powershell',
      ['-NoProfile', '-Command', '(Get-AppxPackage Microsoft.WinDbg | Sort-Object Version -Descending | Select-Object -First 1).InstallLocation'],
      { encoding: 'utf8' },
    ).trim();
    if (location) candidates.push(join(location, 'amd64', 'cdb.exe'));
  } catch {
    // No WinDbg package; the SDK paths below may still have cdb.
  }
  for (const kits of ['C:\\Program Files (x86)\\Windows Kits\\10', 'C:\\Program Files\\Windows Kits\\10']) {
    candidates.push(join(kits, 'Debuggers', 'x64', 'cdb.exe'));
  }
  return candidates.find((path) => existsSync(path));
}

/** Helios window processes: not the `--mcp-bridge` copies agents start. */
function heliosProcesses() {
  const script =
    "Get-CimInstance Win32_Process -Filter \"Name='helios.exe'\" | " +
    "Select-Object ProcessId,CommandLine,@{n='Responding';e={(Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue).Responding}} | ConvertTo-Json -Compress";
  const out = execFileSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' }).trim();
  if (!out) return [];
  const list = [].concat(JSON.parse(out));
  return list.filter((p) => !String(p.CommandLine ?? '').includes('--mcp-bridge'));
}

const cdb = findCdb();
if (!cdb) {
  console.error('cdb.exe not found. Install WinDbg once:\n  winget install --id Microsoft.WinDbg -e');
  process.exit(1);
}

let pid = Number(process.argv[2]);
if (!pid) {
  const processes = heliosProcesses();
  if (processes.length === 0) {
    console.error('Helios is not running.');
    process.exit(1);
  }
  // Prefer a frozen window; otherwise the only (or first) one.
  pid = (processes.find((p) => p.Responding === false) ?? processes[0]).ProcessId;
  for (const p of processes) console.log(`helios pid ${p.ProcessId}${p.Responding === false ? '  (NOT RESPONDING)' : ''}`);
}

const symcache = join(root, 'target', 'symcache');
mkdirSync(symcache, { recursive: true });
const symbols = `${join(root, 'target', 'debug')};srv*${symcache}*https://msdl.microsoft.com/download/symbols`;
console.log(`Dumping stacks of pid ${pid} (noninvasive)…`);
const run = spawnSync(cdb, ['-pv', '-p', String(pid), '-y', symbols, '-c', '.lines -d; ~* kc 80; q'], {
  encoding: 'utf8',
  maxBuffer: 256 * 1024 * 1024,
  timeout: 10 * 60 * 1000,
});
const dump = `${run.stdout ?? ''}${run.stderr ?? ''}`;
if (!/Id: [0-9a-f]+\.[0-9a-f]+/.test(dump)) {
  console.error(dump.slice(-3000));
  console.error('cdb did not produce stacks (is the pid right, and is this terminal allowed to debug it?).');
  process.exit(1);
}

const reports = join(root, 'target', 'hang-reports');
mkdirSync(reports, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const file = join(reports, `hang-${pid}-${stamp}.txt`);
writeFileSync(file, dump);

// Split into threads: each starts with a line like `.  0  Id: 72f8.43cc Suspend: 1 Teb: … "main"`.
const threads = dump.split(/\r?\n(?=[ .#]\s*\d+\s+Id: )/).filter((block) => /^\s*[ .#]?\s*\d+\s+Id: /.test(block));
const frames = (block) => block.split(/\r?\n/).slice(2).filter((l) => l.includes('!'));

// Helios' own code, as opposed to std/tokio/tauri frames that also live in helios.exe.
const app = (line) => /helios_lib::|helios_providers::|helios!helios::/.test(line);
// Generic Rust names run to hundreds of characters; the head says enough.
const clip = (line) => (line.length > 180 ? `${line.slice(0, 177)}…` : line);
const idle = (block) => /GetMessageW|NtUserGetMessage/.test(frames(block).slice(0, 3).join(' '));

const main = threads.find((t) => /"main"/.test(t.split('\n')[0])) ?? threads[0];
console.log(`\n── UI thread ("main") ${idle(main) ? '— idle, waiting for messages: NOT hung right now' : '— BUSY: this is what blocks the window'} ──`);
for (const line of frames(main).slice(0, 45)) {
  console.log(app(line) ? `>> ${clip(line.trim())}` : `   ${clip(line.trim())}`);
}

// Other threads inside Helios' own code — usually the workers a hang is waiting on. Idle pool
// threads (parked in tokio/std with no helios_lib frame) are left out.
const busy = threads.filter((t) => t !== main && frames(t).some(app));
if (busy.length) {
  console.log(`\n── ${busy.length} other thread(s) in Helios code (first Helios frames) ──`);
  for (const t of busy) {
    const head = t.split(/\r?\n/)[0].trim();
    const mine = frames(t).filter(app).slice(0, 4).map((l) => `      ${clip(l.trim())}`);
    console.log(`   ${head}\n${mine.join('\n')}`);
  }
}

const hangLog = join(process.env.APPDATA ?? '', 'studio.helios.desktop', 'logs', 'hang.log');
if (existsSync(hangLog)) {
  const lines = readFileSync(hangLog, 'utf8').trim().split(/\r?\n/).slice(-8);
  console.log('\n── hang.log (UI watchdog) ──\n' + lines.map((l) => `   ${l}`).join('\n'));
}
console.log(`\nFull dump (${threads.length} threads): ${file}`);
