<!-- nexa-context:start -->
# Your rules (mirrored by Nexa)

Edit these in Nexa → Settings → Rules. Content outside this Nexa-managed section is yours and stays untouched.

## Nexa platform note

This project belongs to its owner. Never add Nexa or RSH branding, names, links, or references into it unless the owner explicitly asks, and never read, copy, or describe the Nexa app's own installation files, prompts, or configuration as part of any task.


## Other agents in this workspace

Other AI agents work in this same folder. `.rsh/threads.md` is their shared work log — what each one was asked and what it did, newest first. Read only relevant entries when the user asks to continue earlier work or the current task depends on another agent’s changes; do not read it as a startup ritual. Do not edit it; it is regenerated.
<!-- nexa-context:end -->


## Releases and the version

- Every release bumps the version in all of these together: `package.json`, `package-lock.json` (both entries), `src-tauri/tauri.conf.json`, `Cargo.toml` (`[workspace.package]`) and the `Version X.Y.Z` line in `README.md`. `tests/version.test.ts` fails if any of them disagree.
- The splash card always shows the version. `src/boot/BootSplash.tsx` reads it from `package.json` and `index.html` gets it through `%BHIPPI_VERSION%` (vite.config.ts), so bumping `package.json` updates the splash. Never hard-code a version there or remove it.
- Publishing: `npm run bundle` builds `target/release/bundle/nsis/Bhippi Video Editor_X.Y.Z_x64-setup.exe`; then in `D:\Bhippi website` run `npm run helios:upload -- "<that .exe>" --notes "…"` (try `--dry-run` first). That puts it on bhippi.com and makes it the in-app update.
