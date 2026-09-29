// The AI's own work, inside the project.
//
// A CLI agent (Claude Code, Codex…) starts in the project's `AI Work` folder (storage.rs
// `Category::AiWork`) and may use its own shell and file tools there: scripts, caches, crops and
// test renders stay on disk. What it finishes for the edit goes in `AI Work/Output`, and the app
// brings each new file there into the Project panel's "AI Work" bin as it appears, so the user
// watches the work arrive instead of it piling up somewhere they cannot see.

export const AI_WORK_FOLDER = 'AI Work';
export const AI_WORK_OUTPUT = 'Output';
/** The Project panel bin the finished pieces land in. */
export const AI_WORK_BIN = 'AI Work';

const MEDIA = /\.(mp4|mov|webm|mkv|m4v|avi|png|jpe?g|webp|gif|wav|mp3|m4a|aac|flac|ogg)$/i;
/** Half-written or temporary files an encoder leaves while it works. */
const PARTIAL = /(\.part|\.tmp|\.partial|\.bhippi-part\.[a-z0-9]+|~)$/i;

export type OutputEntry = { path: string; isDir: boolean; sizeBytes: number };

/** `<project>/AI Work/Output`, with the project folder's own separator. */
export function aiWorkOutputDir(projectDir: string): string {
  const sep = projectDir.includes('\\') ? '\\' : '/';
  return [projectDir.replace(/[\\/]+$/, ''), AI_WORK_FOLDER, AI_WORK_OUTPUT].join(sep);
}

const key = (path: string) => path.replace(/\\/g, '/').toLowerCase();

/**
 * The files in Output ready to bring in: media, not in the library already (so a piece the user
 * removed from the project does not come back), and the same non-zero size as on the last look,
 * so a render still being written waits for the next one. Returns the sizes to compare next time.
 */
export function readyOutputs(entries: OutputEntry[], library: Iterable<string>, lastSizes: ReadonlyMap<string, number>): { ready: string[]; sizes: Map<string, number> } {
  const known = new Set([...library].map(key));
  const sizes = new Map<string, number>();
  const ready: string[] = [];
  for (const entry of entries) {
    if (entry.isDir || !MEDIA.test(entry.path) || PARTIAL.test(entry.path) || known.has(key(entry.path))) continue;
    sizes.set(key(entry.path), entry.sizeBytes);
    if (entry.sizeBytes > 0 && lastSizes.get(key(entry.path)) === entry.sizeBytes) ready.push(entry.path);
  }
  return { ready: ready.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), sizes };
}
