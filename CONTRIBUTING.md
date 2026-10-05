# Contributing to Bhippi Video Editor

Thanks for your interest in improving Bhippi. This is a Windows-first desktop app built with Tauri v2 (Rust backend, React 19 frontend) around FFmpeg. Bug reports, fixes, and documentation are genuinely welcome — you do not need to be a Rust expert to help.

## Getting set up

**Requirements:** Windows 10/11 (x64), Node.js v20.x or v22.x, Rust 1.85+, and FFmpeg available on your `PATH`. [Blender 4.2+](https://www.blender.org) is optional and only needed for 3D rendering.

```bash
git clone https://github.com/memegyanfactory-gif/bhippi-Video-editor.git
cd bhippi-Video-editor
npm install
npm run dev
```

`npm run dev:web` starts the browser-only UI preview if you just want to iterate on frontend work.

## Before you open a pull request

Run the same checks CI runs:

```bash
npm run typecheck    # TypeScript types
npm run lint         # ESLint
npm run lint:rust    # cargo clippy (advisory for now)
npm run test:ui      # Vitest
```

For changes to the Rust backend, add `cargo test --workspace` as well.

## What makes a good PR here

- **One concern per PR.** Large mixed diffs are slow to review and slow to merge.
- **Match the surrounding code.** Naming, comment density, and structure should read like the code around your change.
- **Keep AI tools in step.** If you add or change a tool in `src/lib/aiTools.ts`, update its registration and any docs listing the tool catalogue.
- **Version bumps are a special case.** If your change ships a release, bump the version together in `package.json`, `package-lock.json` (both entries), `src-tauri/tauri.conf.json`, `Cargo.toml` (`[workspace.package]`), and the `Version X.Y.Z` line in `README.md`. `tests/version.test.ts` fails if these disagree.

## Reporting bugs

Open an issue with: what you did, what you expected, what happened, your Windows version, and the relevant log output. Bugs with a reproduction get fixed much faster. If it is a crash, the app writes logs under the project directory — attaching them helps a lot.

## Reporting security issues

Please do not open a public issue for security problems. Contact the maintainer directly so a fix can be prepared before disclosure.

## Code of conduct

Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md). By contributing you agree to follow it.

## License

Contributions are licensed under the [MIT License](LICENSE), the same terms as the rest of the project.