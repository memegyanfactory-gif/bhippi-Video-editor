// Closes a running Bhippi so the next build can replace the binary. A running app is the usual
// reason `cargo build` fails with "Access is denied" (os error 5) in the middle of F5.
//
// The subtlety is that asking is not the same as it being gone. `taskkill` returns as soon as it
// has asked Windows to terminate, and a terminating process keeps its image file locked for a
// moment after that — long enough for the link step to collide with it. Worse, Bhippi holds a
// single-instance lock: a second copy started while one is up (two runners, an IDE task and a
// terminal, say) hands its arguments to the first and can sit there as a windowless process,
// still holding the binary. So every helper here waits for the thing it asked for.
import { execFileSync } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const isWindows = process.platform === 'win32';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export const BINARY = isWindows
  ? join(root, 'target', 'debug', 'bhippi.exe')
  : join(root, 'target', 'debug', 'bhippi');

const sleep = (ms) => {
  // Synchronous on purpose: these run between build steps, not inside an event loop.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

/** How many copies of Bhippi are running, counting windowless and child processes. */
export function running() {
  try {
    if (isWindows) {
      const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq bhippi.exe', '/NH'], { encoding: 'utf8' });
      return (out.match(/bhippi\.exe/gi) ?? []).length;
    }
    const out = execFileSync('pgrep', ['-f', 'target/debug/bhippi'], { encoding: 'utf8' });
    return out.split('\n').filter((line) => line.trim()).length;
  } catch {
    // Neither tool is an error when nothing matches; both exit non-zero to say "none".
    return 0;
  }
}

/**
 * Whether the binary can be replaced right now.
 *
 * Windows locks a running executable's image, so the honest test is to ask for write access:
 * that fails while any copy is alive, including one still shutting down and one wedged with no
 * window. A binary that is not there yet is free by definition — that is just the first build.
 */
export function replaceable() {
  if (!isWindows) return true;
  try {
    const handle = openSync(BINARY, 'r+');
    closeSync(handle);
    return true;
  } catch (error) {
    return error.code === 'ENOENT';
  }
}

/**
 * Closes every running Bhippi and waits until the binary is actually free.
 *
 * Returns what happened so the caller can say something useful rather than failing later with a
 * linker error that does not name the cause.
 */
export function stopBhippi({ timeoutMs = 10_000 } = {}) {
  const found = running();
  try {
    // `/T` takes the children with it: the MCP bridge Bhippi starts is this same binary, and it
    // holds the file just as firmly as the window does.
    if (isWindows) execFileSync('taskkill', ['/F', '/T', '/IM', 'bhippi.exe'], { stdio: 'ignore' });
    else execFileSync('pkill', ['-f', 'target/debug/bhippi'], { stdio: 'ignore' });
  } catch {
    // Nothing was running, which is the normal case.
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (running() === 0 && replaceable()) {
      return { closed: found, freed: true };
    }
    sleep(150);
  }
  return { closed: found, freed: false, stillRunning: running() };
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  const result = stopBhippi();
  if (!result.freed) {
    console.error(
      `Could not close Bhippi: ${result.stillRunning} process(es) are still holding ${BINARY}.\n` +
        'Something is restarting it — check for another runner (an IDE "run app" task, or a second terminal).',
    );
    process.exit(1);
  }
  console.log(result.closed > 0 ? `Closed Bhippi (${result.closed} process${result.closed === 1 ? '' : 'es'}).` : 'Bhippi was not running.');
}
