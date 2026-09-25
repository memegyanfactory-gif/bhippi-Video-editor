// Launches Bhippi on desktop: closes the previous instance, builds the UI, and runs the app.
// This is what F5 runs (.vscode/launch.json), so it has to work every time, not most times.
//
// Cross-platform without shell separator (&&) issues on Windows PowerShell.
import { execSync, spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BINARY, replaceable, running, stopBhippi } from './stop-app.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';
// `--build-only` is the VS Code build task and the native debugger's preLaunchTask: same
// preparation, but the debugger wants to start the binary itself.
const buildOnly = process.argv.includes('--build-only');

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Makes sure nothing is holding the binary, and says so plainly when something is.
 *
 * Called twice: once before the UI build and again right before the compile. The second call is
 * the one that matters. The UI build takes long enough that a copy started in the meantime — by
 * another runner, or by a file association opening a .bhippi project — would own the binary by
 * the time the linker reached for it, and the failure that follows ("Access is denied") names
 * the file rather than the cause, which is what makes this so confusing to hit.
 */
function clearTheWay(stage) {
  if (replaceable() && running() === 0) return true;
  const result = stopBhippi();
  if (result.freed) {
    if (result.closed > 0) console.log(`Closed a running Bhippi before ${stage}.`);
    return true;
  }
  console.error(
    `\nCannot start ${stage}: ${result.stillRunning} Bhippi process(es) still hold ${BINARY}.\n` +
      'Windows locks a running binary, so the build cannot replace it.\n\n' +
      'Something is restarting Bhippi faster than this script can close it. Look for a second\n' +
      'runner — an IDE "run the app" task on a loop, a watch task, or another terminal — and stop\n' +
      'it, then press F5 again.',
  );
  return false;
}

// 1. Stop any currently running instance, and wait until it is really gone.
if (!clearTheWay('the build')) process.exit(1);

// 2. Build UI bundle
console.log('Building Bhippi UI (tsc & vite)...');
try {
  execSync('npm run build', { cwd: root, stdio: 'inherit', shell: true });
} catch (err) {
  console.error('UI build failed:', err.message);
  process.exit(1);
}

// 3. Compile the desktop binary, with the lock checked immediately beforehand.
//
// Kept separate from `cargo run` so that a binary grabbed in the last second is a retry here
// rather than a hard failure: one more sweep and one more attempt is enough for the case this
// keeps happening in, where a second copy appeared while the UI was building.
console.log('Compiling Bhippi...');
let compiled = false;
for (let attempt = 1; attempt <= 2 && !compiled; attempt++) {
  if (!clearTheWay('the compile')) process.exit(1);
  try {
    execSync('cargo build -p bhippi', { cwd: root, stdio: 'inherit', shell: true });
    compiled = true;
  } catch (err) {
    const locked = isWindows && !replaceable();
    if (attempt === 2 || !locked) {
      console.error('\nCompile failed.', locked ? 'The binary is still locked by a running Bhippi.' : err.message);
      process.exit(1);
    }
    console.warn('\nA Bhippi started while the UI was building and took the binary. Closing it and trying once more...');
    sleep(500);
  }
}

// 4. Launch the desktop app
if (buildOnly) {
  console.log('Bhippi is built and the binary is free.');
  process.exit(0);
}

console.log('Launching Bhippi desktop app...');
const appProcess = spawn(BINARY, [], { cwd: root, stdio: 'inherit' });

appProcess.on('error', (err) => {
  console.error('Failed to start Bhippi:', err);
  process.exit(1);
});

appProcess.on('exit', (code, signal) => {
  // Killed from outside — almost always another runner's `taskkill` — is worth naming, because
  // otherwise the window simply vanishes and F5 looks like it failed for no reason.
  if (signal || (isWindows && code === 1)) {
    console.error(
      '\nBhippi was closed from outside this session' +
        (signal ? ` (${signal})` : '') +
        '. If you did not close the window, something else is running `taskkill /IM bhippi.exe` —\n' +
        'check for another "run the app" task.',
    );
  }
  process.exit(code ?? 0);
});
