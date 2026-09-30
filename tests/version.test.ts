import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import appPackage from '../package.json';

// The version lives in package.json, tauri.conf.json (what the installer and the updater compare)
// and Cargo.toml; the splash card shows it on every launch. A release bumps them together.
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const version = appPackage.version;

describe('the version', () => {
  it('is the same in every file that carries it', () => {
    expect(version).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/);
    expect(JSON.parse(read('src-tauri/tauri.conf.json')).version).toBe(version);
    expect(read('Cargo.toml')).toMatch(new RegExp(`\\[workspace\\.package\\][^\\[]*\\nversion = "${version.replace(/\./g, '\\.')}"`));
    const lock = JSON.parse(read('package-lock.json'));
    expect(lock.version).toBe(version);
    expect(lock.packages[''].version).toBe(version);
    expect(read('README.md')).toContain(`Version ${version}`);
  });

  it('is on the splash card, from the first frame', () => {
    // The page's own first frame gets it from the vite.config.ts html transform…
    expect(read('index.html')).toContain('%BHIPPI_VERSION%');
    expect(read('vite.config.ts')).toContain("replaceAll('%BHIPPI_VERSION%', appPackage.version)");
    // …and the splash component reads it from package.json, not from a call that may not answer.
    const splash = read('src/boot/BootSplash.tsx');
    expect(splash).toContain("import appPackage from '../../package.json'");
    expect(splash).toMatch(/Video Editor<span className="splash-version"> · \{VERSION\}<\/span>/);
  });
});
