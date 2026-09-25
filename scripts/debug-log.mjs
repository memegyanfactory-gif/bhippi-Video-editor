// Prints the tail of Bhippi's logs from %APPDATA%/com.bhippi.videoeditor.
//
//   npm run debug:log             last 60 lines of each log
//   npm run debug:log -- 200      last 200
//   npm run debug:log -- -f       follow bhippi.log live (Ctrl+C to stop)
import { existsSync, readFileSync, statSync, watch } from 'node:fs';
import { join } from 'node:path';

const dir = join(process.env.APPDATA ?? '', 'com.bhippi.videoeditor');
const logs = [
  ['bhippi.log (this run)', join(dir, 'logs', 'bhippi.log')],
  ['bhippi.previous.log', join(dir, 'logs', 'bhippi.previous.log')],
  ['hang.log (UI watchdog)', join(dir, 'logs', 'hang.log')],
  ['crash.log (panics + frontend crashes)', join(dir, 'crash.log')],
];

const args = process.argv.slice(2);
const follow = args.includes('-f');
const count = Number(args.find((a) => /^\d+$/.test(a))) || 60;

for (const [label, file] of logs) {
  if (!existsSync(file)) {
    console.log(`── ${label}: none yet (${file})`);
    continue;
  }
  const lines = readFileSync(file, 'utf8').trimEnd().split(/\r?\n/);
  const when = statSync(file).mtime.toLocaleString();
  console.log(`\n── ${label} · ${lines.length} lines · updated ${when}\n   ${file}`);
  console.log(lines.slice(-count).join('\n'));
}

if (follow) {
  const file = logs[0][1];
  if (!existsSync(file)) process.exit(0);
  let offset = statSync(file).size;
  console.log(`\n── following ${file} …`);
  watch(file, () => {
    const size = statSync(file).size;
    if (size < offset) offset = 0; // a new run replaced the file
    if (size > offset) {
      process.stdout.write(readFileSync(file).subarray(offset, size).toString('utf8'));
      offset = size;
    }
  });
}
