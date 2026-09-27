# Plugin Platform Plan: a Plugin Maker harness, a package format, and a marketplace

Goal: anyone can describe a plugin to Bhippi AI and get a good one. They can use it privately,
share it as a file, or publish it. Published plugins are reviewed and signed. Once approved,
everyone can install them from inside Bhippi with one click. Uploading must never break the app,
and installing must never put a user's machine at risk.

## Where we are (read from the code, 2026-09-27)

**What is already good:** user plugins have a sound runtime, and we keep it.

- A plugin is a sandboxed iframe with an opaque origin: `sandbox` without `allow-same-origin`
  (`src/plugins/PluginFrame.tsx`). It has no Tauri IPC, no parent DOM and no localStorage.
- It talks to Bhippi only through the postMessage bridge (`src/plugins/bridge.ts`) and the
  `window.bhippi` SDK (`src/plugins/sdk.ts`).
- Tool calls go through a manifest permission check (`rules.ts pluginToolRefusal`), then the
  user's permission mode, then the workflow guard, and then run through the same `runTool` the AI
  uses.
- Every edit a plugin makes can be undone and is labelled with the plugin's name.

**What is wrong**

1. **The Plugin Maker asks for a resolution.**
   - Its `EditWorkflow` is built without `askFrameSize = false` (`App.tsx:3087`, and the fallback
     at `App.tsx:751`).
   - The size gate runs before the quick-mode bypass (`editWorkflow.ts:536`), and `save_plugin`
     is in `HELD_FOR_SIZE`.
   - So on an empty project the first `save_plugin` is refused, and the model is told to call
     `choose_comp_size`.
   - The plugin runtime already passes `false` (`bridge.ts:179`); the Maker simply doesn't.
2. **The Maker is the timeline chat with a hat on.**
   - It is the same `ChatPanel` with the whole of `copilot.md` underneath. The persona is only
     prepended (`chat.rs:436`).
   - It gets `routeTools()`, which adds `CORE_TOOLS`, `choose_comp_size`, genres and playbooks,
     and it sees all ~221 tools (the rest as slim entries, still callable).
   - It also gets the edit workflow guard and the timeline context.
   - There is **no real tool allowlist** anywhere: `run_call` and MCP `tools/call` only check
     that the name is known.
3. **No package format.**
   - A plugin is a single JSON record with one inline HTML page (`types.ts`), capped at 1 MB.
   - It has no semver, no author identity, no signature, no update channel and no multi-file
     assets.
   - Export is a bare `.bhippi-plugin.json`.
4. **Remote code.** The page CSP allows scripts from jsdelivr, cdnjs and unpkg
   (`rules.ts:87-103`). A reviewed plugin could therefore load different code tomorrow, which
   makes it impossible to review for a marketplace.
5. **Security gaps a marketplace would expose**
   - **MCP tools:** `mcp__*` tools are neither "read" nor "destructive", so `tools: ['*']`
     reaches every connected MCP server.
   - **Chat:** the `chat` permission injects text straight into the AI's chat as
     `[From the "X" plugin] …`, which is a prompt-injection path.
   - **Files:** `fileUrl` turns *any* absolute path into a viewable asset URL (the asset scope is
     `**`).
   - **Characters:** it is a hard-coded, unsandboxed, same-origin iframe
     (`CharactersWindow.tsx`), so it effectively has full app IPC. That is fine for first-party
     code, but it must never be the model for third-party plugins.
6. **No backend for sharing.**
   - bhippi.com (`D:\Bhippi website`, Cloudflare Pages Functions + D1 `bhippi-ve` + R2) already
     has Google sign-in, app bearer tokens, an owner/admin check, an audit table and Ed25519
     signing for licences.
   - It has no plugin tables, storage or routes.

## Principles

- **Separate harness, shared engine.** The Plugin Maker gets its own prompt, tools, guard and
  checks. It reuses the turn loop, the providers, the MCP bridge, subagents and traces.
- **Enforced in code, not in the prompt.** A tool outside the harness's allowlist is refused in
  Rust *and* in the frontend, and a CLI agent never even sees it.
- **What was reviewed is what runs.**
  - Packages are self-contained: no remote scripts.
  - Every file is hashed.
  - The whole package is signed by bhippi.com on approval.
  - The app verifies the signature and hashes before installing.
- **Local stays free.** Anyone can make and use their own plugins without signing in or being
  reviewed; unsigned plugins are simply marked "Local".
- **Permissions are visible and minimal.** The install sheet shows exactly what a plugin can do.
  An update that asks for more needs consent again.
- **One click to install, one click to kill.** A signed revocation list lets us disable a bad
  plugin on every machine.

---

## Architecture

### A. The Plugin Maker harness

A **harness** is a named profile the backend selects per turn: `editor` (today's chat) or
`plugin-maker`. Later ones could be `character-director` or `brand-kit`.

```
HarnessProfile {
  id: "plugin-maker"
  prompt: prompts/plugin-maker.md        // replaces copilot.md, not prepended to it
  tools: allowlist                      // the only tools listed, callable or bridged
  workflow: none                        // no EditWorkflow, no size gate, no production phases
  router: none                          // no routeTools/genres/playbooks
  context: pluginMakerContext()         // the open plugin, SDK version, project *summary*
  maxRounds: 60
  brainScope: "plugins"                 // its memory/skills don't leak into edit turns
}
```

**Plumbing**
- `ChatRequest.harness` (`chat.rs`): `build_request` picks the prompt from the profile, and
  `catalogue_for` filters by the allowlist.
- The MCP bridge gets `--allow=a,b,c`, so Claude Code, Codex and OpenCode list only those tools.
- `run_call` rejects anything else. That is the defence in depth.
- Frontend: a per-turn `harnesses` map next to `editWorkflows`. The `events.toolCall` handler
  checks it right after `allowTool`; `host.guard` checks it for custom tools; subagents inherit it
  through the parent turn id.
- The Maker's `ChatPanel` sends `harness: 'plugin-maker'` and no `toolset` or `editingWorkflow`.

**Maker tools** (the allowlist)

| Group | Tools |
|---|---|
| Plugin files | `plugin_scaffold` (from a template), `plugin_list_files`, `plugin_read_file`, `plugin_write_file`, `plugin_delete_file`: all confined to the plugin's own draft folder |
| Manifest | `plugin_set_manifest` (name, version, permissions, actions), `plugin_permission_diff` |
| Knowledge | `plugin_sdk_reference`, `plugin_examples` (the curated gallery), `tool_catalog` (read-only: what each Bhippi tool does and takes, so the plugin calls the right ones) |
| Check | `plugin_validate`, `plugin_test`, `plugin_screenshot`, `plugin_logs` |
| Project (read) | `project_summary`: comps, tracks and asset *kinds*, never paths or media. Only so the plugin can be designed against real shapes. |
| Finish | `plugin_save` (writes the draft as a local plugin), `ask_user` |

**Excluded:** every timeline edit, `choose_comp_size`, generation, `run_command`, `write_file`
outside the draft, the brain's edit memory and the production tools.

**Maker loop (bounded contract → build → sense → fix)**
1. **Spec card:** the model writes a one-screen spec first, and the user can edit it:
   - what the plugin does, its UI, the tools it will call, the permissions it needs and its
     acceptance checks.
   - It is kept in the draft as `spec.md`. That is the "contract" step from harness engineering.
2. **Scaffold** from a template: a panel, a background worker, an AI action, or a panel plus
   actions.
3. **Write** the files.
4. **`plugin_validate`** (deterministic, no tokens):
   - the manifest schema; no remote scripts;
   - permissions ⊆ the tools the code actually calls (a static scan of `bhippi.tool('…')`);
   - no sensitive tool without a stated reason; size limits; the theme tokens are used.
5. **`plugin_test`** loads the plugin in a hidden sandboxed frame against a **scratch copy of the
   project**, an in-memory `History`, so the user's project is never touched while testing. It:
   - runs the spec's acceptance checks through a small `bhippi.test()` hook;
   - collects console errors and refused calls.
6. **`plugin_screenshot`** renders the panel at 320 px and 480 px wide, in light and dark, for a
   vision check of layout and legibility.
7. **Maker Judge** scores 0–100 on:
   - loads clean; acceptance checks pass; minimal permissions; no console errors;
   - it responds to resizing; it follows the theme; it gives empty and error states.
   - Below 80 the model loops, at most 3 times, and the Token Council caps the spend.
8. **Save** as a local plugin; the preview reloads, and the model reports in 2–3 lines.

Every turn is traced (`trace.rs`) under the plugin's draft, so "why did the Maker produce this" is
answerable.

### B. Package format v2 (`.bhippi-plugin`, a zip)

```
manifest.json
  schema: 2
  id: "memegyan.shot-list"             // publisher.slug, unique in the marketplace
  name, description, icon: "icon.svg"
  version: "1.2.0"                     // semver
  bhippi: ">=0.9 <2"                   // SDK/host compatibility range
  author: { id, name }                 // the bhippi.com account id once published
  entry: { panel?: "index.html", background?: "worker.html" }
  permissions: {
    tools: ["get_comp", "add_marker"], // explicit; "*" is not allowed in the marketplace
    mcp: [],                           // named mcp__server__tool entries, never a wildcard
    network: ["api.example.com"],
    chat: "suggest" | "none",          // suggest = a card the user clicks, never auto-sent
    storage: true, projectStorage: true,
    files: "project-media" | "none"    // what fileUrl may reach
  }
  actions: [{ id, title, params }]     // what the AI can call (bhippi.expose)
  customTools: ["tools/trim-silence.json"]  // custom tools shipped with the plugin
  kind: "panel" | "tool-pack" | "content-pack"  // content packs: templates, LUTs, SFX, rigs
files/…                                // all code and assets, bundled locally
SIGNATURE                              // added by bhippi.com on approval (not by the author)
```

- **Installed on disk:** `app_data/plugins/<id>/<version>/`, unpacked, with a `manifest.lock`
  holding every file's sha256.
- **Served by** a custom Tauri URI scheme, `bhippi-plugin://<id>/…`:
  - It serves only that folder and answers with `Access-Control-Allow-Origin: null`, so the
    sandboxed (opaque-origin) frame can load its own scripts and fetch its own JSON.
  - The iframe stays `sandbox="allow-scripts …"`, without `allow-same-origin`.
- **CSP for v2 packages:** `script-src bhippi-plugin://<id>` only (no CDNs, no `unsafe-eval`
  unless the manifest declares it and review allows it), and `connect-src` = the declared hosts.
- **Migration:** v1 JSON plugins keep working and are converted to a v2 draft when opened in the
  Maker. The `.bhippi-plugin.json` import stays.
- **Custom tools shipped in a plugin** register as `plugin.<id>.<tool>` while the plugin is
  enabled, and are removed with it.

### C. Security hardening (needed before anything third-party runs)

- **MCP tools** must be listed by name under `permissions.mcp`; `tools: ['*']` never covers them.
- **`chat`** becomes `suggest`: the plugin's text shows as a card in the chat, and the user sends
  it. Nothing reaches the AI without a click.
- **`fileUrl`** is limited to the open project's media and the plugin's own files; other paths
  are refused.
- **Sensitive tools** (`run_command`, `write_file`, `edit_file`, destructive tools, MCP) are
  allowed in local plugins with a red consent row. In the marketplace they need the "Verified"
  review tier.
- **Rate limits** per plugin frame: tool calls per minute, and the storage size (already capped
  at 4 MB).
- **Characters:** the first-party pages get a same-origin check. Their IPC surface is noted now,
  and they are moved onto the plugin platform as a signed first-party package in Phase 5.
- **Kill switch:**
  - The app fetches a signed `revocations.json` (plugin id, versions, reason) on start and every
    6 hours.
  - A revoked plugin is disabled at once and the user sees why.

### D. The marketplace backend (bhippi.com, Cloudflare)

**D1 tables** (new migration `0005_plugins.sql`)

| Table | Holds |
|---|---|
| `publishers` | user id, handle (the `publisher` part of plugin ids), verified flag |
| `plugin_listings` | id, publisher, name, summary, category, tags, status (`live`, `hidden`, `revoked`), install count, rating |
| `plugin_versions` | listing id, semver, manifest JSON, R2 key, sha256, size, `bhippi` range, status (`uploaded` → `checking` → `in_review` → `approved`, `rejected` or `revoked`), review notes, signature, timestamps |
| `plugin_reviews` | automated report (JSON), reviewer, decision, reason |
| `plugin_ratings` | user, listing, stars, text |
| `plugin_reports` | abuse reports from users |

**R2:** a new `bhippi-plugins` bucket. Uploads go to `pending/`; approved packages are copied to
`public/<id>/<version>.bhippi-plugin`.

**Upload (safe by construction)**
1. The app sends `POST /api/plugins/submissions` (bearer token) with the manifest and sha256.
   The server checks:
   - the account is signed in; the id's publisher part is theirs; the version is new and higher;
   - the size is at most 20 MB; the rate limit is 10 submissions a day.
2. It returns a one-time upload URL, and the app `PUT`s the zip. The upload is resumable and
   verified against the sha256, so a broken upload never becomes a version.
3. `POST …/finalize` starts **automated checks** in a Worker. They:
   - unzip safely (no path traversal, no symlinks, file-count and size caps);
   - validate the manifest schema; re-hash every file;
   - look for remote script references, `eval`/`Function`, obfuscation and minified bundles
     without a source map;
   - compare the permissions against the tool calls found in the code;
   - produce an **AI review** (Claude via API): does the code do what the description says, is
     there data exfiltration, do the network hosts make sense.
   The result is a risk report with a score.
4. The version moves to `in_review`, and the author sees its status in the app.

**Review and approval**
- An admin page on bhippi.com (behind the existing `isOwner` check) shows the queue: manifest,
  permission sheet, file browser, diff against the previous version, automated report and
  screenshots.
- **Approve:**
  - The server signs `{id, version, sha256 of the zip, manifest hash}` with a **dedicated
    plugin-signing Ed25519 key**, not the licence key.
  - It copies the package to `public/`, sets the listing live and writes an `audit` row.
- **Reject:** the reason goes back to the author in the app.
- **Revoke** (at any time) adds the plugin to the signed `revocations.json`.
- **Later:** auto-approve updates from verified publishers when the permissions don't change and
  the risk score is low.

**Catalogue (public, cached at Cloudflare's edge)**
- `GET /api/plugins?query=&category=&sort=` lists plugins.
- `GET /api/plugins/:id` returns the listing, versions, screenshots and permissions.
- `GET /api/plugins/:id/:version/download` returns a short-lived R2 URL and counts the install.
- `GET /api/plugins/revocations.json` returns the signed revocation list.

### E. In the app

- **The Plugins panel has three tabs:**
  - **Installed:** enable, disable, update, uninstall, open in the Maker.
  - **Browse:** the marketplace with search, categories, cards and a detail page showing
    screenshots, **the permission sheet**, versions, author, installs and ratings.
  - **Create:** the Plugin Maker.
- **Install:**
  1. Download, then verify the Ed25519 signature and every file hash against the manifest.
  2. Check the `bhippi` compatibility range.
  3. Show the permission sheet, then unpack and enable.
  4. A failure at any step leaves nothing behind. The unpack is atomic: into a temp folder, then
     renamed.
- **Updates:** checked on start. An update that asks for no new permissions installs quietly and
  can be rolled back to the previous version. One that asks for more waits for consent.
- **Publish** (in the Maker, signed-in users only):
  1. `plugin_validate` and `plugin_test` must pass.
  2. The app packs the zip, uploads it and shows the status: `checking` → `in review` →
     `live` or `rejected: reason`.
- **Local plugins** (unsigned) show a "Local" badge. They can be exported as `.bhippi-plugin`
  and imported on another PC, where they install as "Local", still disabled until reviewed.

---

## Phases

Each phase ships on its own.

### Phase 0: Stop the resolution question — done (2026-09-27)
- [x] **The Maker's workflow skips the size gate.**
  - Its `onStartWorkflow` (App.tsx, Plugin Maker `ChatPanel`) now builds
    `new EditWorkflow(…, mode, disableLocalGeneration, false)`, and records the turn in a
    `makerTurns` set.
  - The fallback in the `events.toolCall` handler rebuilds a workflow when "New conversation"
    has cleared it mid-turn. For a turn in `makerTurns` it uses `quick` with
    `askFrameSize = false`; every other turn behaves exactly as before.
- [x] **The Maker sends its own toolset instead of the router's.**
  - It is `PLUGIN_MAKER_TOOLSET` in `src/plugins/brief.ts`: 14 tools sent whole (the plugin
    tools, `get_project`, `get_comp`, `list_custom_tools`, `call_custom_tool`, `ask_user` and
    `tool_help`), `genres: []` and no playbook.
  - `ChatPanel` has a new `toolset` prop that replaces `routeTools()` when set.
  - Sending *no* toolset would have been worse: the backend then sends all ~221 tools whole
    (`ai_tools.rs catalogue_for`).
  - With no genres, `gate_genres` drops every genre-only section of copilot.md.
  - **Measured per step** (prompt + tool catalogue, tokens ≈ bytes ÷ 4, the benchmark's method):
    | Ask | Before | After |
    |---|---|---|
    | "make a shot list panel plugin" | edit + motion, 88 tools whole, ~43.3 K | 14 tools whole, ~19.6 K (−55 %) |
    | "build a plugin with a dashboard ui…" | routed as a SaaS ad, 66 tools whole, ~38.7 K | ~19.6 K (−49 %) |
- [x] **Tests:** `tests/pluginMakerHarness.test.ts` (3 tests).
  - On an empty project the timeline chat's workflow holds `save_plugin` for
    `choose_comp_size`, while the Maker's lets `save_plugin`, `plugin_logs`, `get_plugin`,
    `show_plugin` and `call_custom_tool` through.
  - The toolset names only real tools, has no genres or playbook, and contains no
    `choose_comp_size` or timeline-edit tools.
  - Full suite: 1,420 passed. `tsc` and `eslint` are clean.
- **Still open, fixed properly in Phase 1:**
  - The Maker still runs on copilot.md with the persona prepended, and `permissionBrief('full')`
    still mentions `choose_comp_size`.
  - The other ~207 tools are still listed slim, so they can still be called.
  - The size question can no longer be *forced* by the guard, but only Phase 1's own prompt and
    enforced allowlist remove the timeline tools entirely.

### Phase 1: The Plugin Maker harness — done (2026-09-27)
- [x] **Harness profiles** (step 1, done 2026-09-27).
  - `src/lib/harnesses.json` names each harness, its prompt and its tools. Rust and the UI both
    read it. `plugin-maker` has 22 tools.
  - `src-tauri/src/harness.rs` loads it. A listed tool that isn't in the catalogue is dropped, not
    trusted.
  - `ChatRequest.harness` (Rust and TS). `chat_send` refuses a name that isn't a harness, so an
    unknown name can't quietly become the editor with every tool.
  - `src-tauri/prompts/plugin-maker.md` **replaces** copilot.md for Maker turns (no timeline,
    frame size, storyboard or phases). The SDK reference still leads it through `persona`.
  - Maker turns get no brain brief: the editing memory stays out of plugin work.
- [x] **The allowlist enforced in Rust**, on every transport (step 1).
  - Native requests carry exactly the harness's tools, whole (`Harness::catalogue`). The text
    protocol lists exactly them (`ai_tools::compact_only`).
  - **CLI agents:** the MCP bridge gets `--only=…` (the new `mcp::Scope`). It lists only those
    tools and answers any other `tools/call` with "not available in this chat".
  - **Executor:** every call of a harness turn passes `harness::Scoped`. That covers native, text,
    MCP and the offline parser, and a refused call never reaches the app.
  - A harness turn is `read_only` for CLI agents: Claude Code, Codex and OpenCode lose their own
    Bash and Write, and build only through the draft tools.
  - Subagent requests carry `harness: None`, and the Maker has no `spawn_subagent`.
  - **Tests:** `harness::tests` (3: the tools are real and have no timeline tools; unknown names
    are refused; the scoped executor refuses and never forwards) and
    `chat::tests::a_harness_turn_sees_only_its_own_prompt_and_tools` (native, text and MCP list
    exactly the harness's tools; the bridge refuses `place_clip`; `read_only` is set; the editor
    is unchanged). 35/35 chat, MCP and harness tests pass.
- [x] **The allowlist enforced in the frontend** (step 2).
  - `src/lib/harness.ts` (`harnessTools`, `harnessRefusal`, `harnessToolset`) reads the same
    `harnesses.json`.
  - The `events.toolCall` handler (App.tsx) refuses a Maker turn's call outside the list before
    anything else. `host.guard` does the same for nested calls.
  - Maker turns skip the edit workflow's gate entirely: the allowlist is their guard.
  - The Maker's `ChatPanel` sends `harness: 'plugin-maker'` and a toolset built from the harness.
    Its `persona` is now just the SDK reference (`PLUGIN_MAKER_BRIEF`); the old persona
    duplicated the new prompt and was removed.
  - The SDK reference no longer tells the AI it may load CDN scripts.
- [x] **Drafts and their file tools** (step 3).
  - Rust: `plugin_draft_list / read / write / delete / remove` in `plugins.rs`, under
    `plugin-drafts/<id>/`.
    - Flat folders only. File names are `[A-Za-z0-9_.-]`, with no leading dot, no `..` and only
      `.html .js .css .json .md .svg .txt`.
    - Limits: 40 files, 1 MB per file, 4 MB per draft.
    - Tested: traversal, bad names, size limit, delete, remove.
  - `src/plugins/drafts.ts` holds the draft store (disk in the app, memory in tests) and
    `ensureDraft`, which starts a draft from an installed plugin that has none. It also holds:
    - `bundleDraft`: inlines the draft's own `<script src>` and stylesheet `<link>`, and escapes
      `</script` / `</style` in code.
    - `validateDraft`, which checks the manifest schema and that every referenced file exists.
      It refuses:
      - remote scripts or styles, and network `import`s;
      - tool names that aren't real, and forbidden tools;
      - edits called without permission;
      - connections to hosts not in `network`.
    - It warns about:
      - unused permissions, `"*"`, and sensitive tools with no reason in the spec;
      - a missing or unfinished spec, and no acceptance checks;
      - no `bhippi.ready`, no error handling, no theme variables, TODOs and computed tool names.
  - Tools, with specs in `ai-tools.json`:
    - `plugin_scaffold`, `plugin_list_files`, `plugin_read_file`, `plugin_write_file`,
      `plugin_delete_file`, `plugin_validate`, `plugin_save`;
    - `plugin_examples`, `plugin_tool_catalog` (every tool a plugin can call, marked
      read/edit/SENSITIVE).
  - `delete_plugin` removes the draft too.
  - `PLUGIN_FORBIDDEN` now holds all the Maker tools: a plugin can never build or run plugins.
  - **Templates** (`src/plugins/templates.ts`): panel, background, action and panel + actions.
    Each has a spec skeleton, `bhippi.ready`, error display, a debounced project sync, theme
    variables and a first `bhippi.test()`.
  - **3 reviewed examples** (fewer than the 5–8 planned; more can be added over time):
    - Shot list: a panel that only reads.
    - Marker here: one named edit tool, its check really edits the scratch copy.
    - Clip counter: an action for the AI.
    All three validate with zero problems and zero warnings.
- [x] **Checking: `plugin_test`, `plugin_screenshot` and the Maker Judge** (step 4).
  - **SDK:**
    - `bhippi.test(name, fn)` registers an acceptance check. Checks never run for the user,
      only under `plugin_test`, each with an 8 s timeout.
    - The page can take a picture of itself **inside the sandbox**: computed styles are frozen
      onto a copy and drawn through an SVG foreignObject. The host never reads the plugin's DOM.
  - **Bridge** (rewritten, same behaviour for real frames): `connectSandboxFrame` gives a test
    frame its own editor, plugin record, storage, playhead, action list and log.
    - A toast or a chat message from a test frame goes to its log and is never sent.
    - Real editor events (project, selection, playhead, session) never reach test frames.
    - `pluginRunning` and `callPluginAction` ignore test frames.
  - **`src/plugins/testRunner.ts`:**
    - A scratch copy of the project with its own undo history (`scratchHistory`), and a scratch
      host: no media import, speech, asking the user or settings writes.
    - The plugin runs in an off-screen `sandbox="allow-scripts allow-forms"` frame. The runner
      waits for it to connect (8 s cap), lets it settle, then runs its checks or pictures it at
      each width.
    - **Only `SCRATCH_READS` and `SCRATCH_TOOLS` really run**, which are explicit lists of pure
      reads and project-only edits. Anything else comes back as "[test] … was not run" and is
      counted as *skipped*, never as the plugin's fault.
  - **The Judge** (`src/plugins/makerJudge.ts`) scores 0–100 and passes at 80. Weights:
    - loads 20, clean console 15, acceptance checks 25, calls honoured 10;
    - least permissions 10, craft 10, spec 10.
    It returns concrete fixes. It is deterministic, so it's free and can't be talked up.
  - **Checked in a real browser** (Chromium through `plugin-lab.html` and Playwright, the real
    bridge and `runTool`):
    - All 3 examples loaded, passed their checks and scored **100/100**.
    - Marker here made **1 edit to the scratch copy while the real project stayed at 1 marker
      before and after**.
    - Screenshots at 320 px and 480 px render with the editor's theme. The first run caught a
      40 px list indent in the templates' styles, and it is fixed.
    - The lab's own security self-test still passes on the rewritten bridge: delete refused;
      network, parent DOM and storage blocked.
- [x] **Maker UI and prompt** (step 5).
  - A **Spec** tab (the first tab) shows `spec.md` for the user to read and edit.
  - A hand edit in the Code tab, or a restored version, is written back into the draft
    (`syncDraftPage`), so the next `plugin_save` can't silently undo it.
  - The empty state explains the spec → build → scratch test → look → fix loop.
  - `prompts/plugin-maker.md` spells out that loop: spec first, validate, save, test,
    screenshot, at most 3 rounds, and rules for code and permissions.
  - Turn traces carry `harness` on `turn_sent`.
  - Maker turns neither read the editing brain nor write to it (no brief, and the Maker's chat
    records no turns). A separate plugins memory is deferred until it's needed.
- [x] **Tests:**
  - `tests/pluginMakerHarness.test.ts` (5) and `tests/pluginMakerTools.test.ts` (16) cover
    templates, examples, the validator, bundling, the Judge, the scratch history, the
    scratch-skip rules, and scaffold → write → validate → save end to end, plus the refusals.
  - Rust: `harness::tests` (3), the chat harness test, and the draft test.
  - **Full suites:** 1,483 frontend tests and 353 Rust tests pass. `tsc` and `eslint` are clean.
- **Not done in Phase 1, on purpose:**
  - Screenshots are dark theme only (Bhippi has one theme).
  - The Code tab edits the bundled page rather than the draft files one by one.
  - The Maker has not yet been run end to end with a live AI provider in the app. The first real
    session should be watched with `node scripts/session-report.mjs --bhippi`.

### Phase 2: Package format and hardening — done (2026-09-27)

**Security (plugins already installed get all of this too)**
- [x] **Plugins get their own read list** (`rules.ts PLUGIN_READS`): the project and the built-in
  catalogues, nothing else.
  - The Phase 1 finding is fixed: `set_playhead`, `brain_*`, `save_meme`, `find_memes_online`,
    `refresh_meme_trends`, `read_file` and the rest of `permissions.ts isReadTool` now need a
    named permission.
  - The validator, the tool catalogue and the scratch test all use the same list.
- [x] **`"*"` covers far less** (`PLUGIN_SENSITIVE`). It never covers:
  - reading files (`read_file`, `list_directory`, `glob_search`, `grep_search`);
  - reaching the network through Bhippi (`scrape_web_page`, `online_research`,
    `download_online_media`, `find_free_media`, `extract_brand_from_url` …). These used to let a
    `"*"` plugin get round its own network policy;
  - paid generation (`generate_cloud_media`) and the AI's memory;
  - **every MCP tool (`mcp__*`)**, which must be named one by one.
  (Before, `"*"` covered MCP tools and file reads.)
- [x] **One plugin can't read another:** `list_plugins`, `get_plugin`, `plugin_logs` and
  `show_plugin` are forbidden to plugins.
- [x] **Chat is suggest-only.** `bhippi.chat()` shows a notification with a *Send to Bhippi AI*
  button; nothing a plugin writes reaches the assistant without the user's click.
- [x] **`fileUrl` is scoped** (`bridge.ts fileAllowed`) to the project's media and files inside
  the project folder. `..` and every other path are refused (before, any path on disk).
- [x] **Rate limits per plugin frame:** 120 tool calls, 20 toasts and 6 chat suggestions a minute.
  Over the limit a call gets "Slow down".
- [x] **Strict page policy for format-2 plugins** (built from drafts or installed from packages):
  `script-src 'unsafe-inline'` only. No CDN scripts, styles or fonts, no `eval`, no blob
  scripts. Older plugins keep the CDN allowance until they're next saved in the Maker.
- [x] **Consent before a plugin from outside runs.**
  - An imported or installed plugin starts off.
  - Its Permissions tab shows a review that lists sensitive tools in red, plus `"*"`, edit
    tools, hosts and chat. It has an *I trust it — turn it on* button.
  - The Details Enabled switch sends the user to that review instead of turning it on.

**Packages** (`src/plugins/package.ts`, Rust `plugins.rs`)
- [x] **The `.bhippi-plugin` format:** a zip of the draft's flat text files, a schema-2
  `manifest.json` and `manifest.lock.json` (the SHA-256 of every other file).
  - `src/plugins/manifest.schema.json` is the JSON Schema the website will share.
  - Packing is deterministic: fixed timestamps and sorted entries, so the same files always give
    the same bytes.
  - The lock file is named `manifest.lock.json` rather than `manifest.lock`, so it passes the
    same known-types file rule as everything else on disk.
- [x] **Safe reading.** Entries are checked from the zip's own directory *before anything is
  inflated*: flat names, text types only, ≤ 1 MB each, ≤ 42 files, ≤ ~4 MB unpacked, stored or
  deflate only (a zip bomb is refused unopened).
  - Files must be valid UTF-8.
  - Every hash must match the lock, and nothing may be missing or extra.
  - The `bhippi` compatibility range is checked against the app version (`package.json`, 1.0.3).
- [x] **Install** (`installPackage`), in this order:
  1. The package checks above.
  2. The same `validateDraft` checks as the Maker.
  3. A new plugin with an id a local plugin already uses is refused; so is the same or an older
     version.
  4. The version is written to `plugin-packages/<id>/<version>/` **atomically**: staged in
     `.incoming-*`, then renamed. A failure leaves nothing behind.
  5. The disk's own SHA-256 of each file is compared with the lock.
  6. It is bundled and installed as format 2, with `pkg` (version, author, source, lock hash).
  7. The draft becomes the installed files.
  After install:
  - **A new plugin waits for review.** An update that asks for nothing new stays on; one that
    asks for more (`widens`) waits for review. A newly named sensitive tool always counts as
    more, even under `"*"`.
- [x] **Rollback:** the last 3 versions stay on disk. In the Versions tab, *Use this version*
  (`switchVersion`) re-checks the version's files against its lock before switching.
- [x] **Export / Import in the Maker:**
  - *Export package* writes `<id>-<version>.bhippi-plugin` from the draft (or the page, for an
    older plugin).
  - *Import* installs `.bhippi-plugin` packages, and still takes old `.bhippi-plugin.json`
    exports (they arrive off, for review).
  - Details shows the package's version, author and source.
  - Deleting a plugin removes its draft and every installed version.
- [x] **v1 → v2 migration:** older plugins keep running unchanged. Opening one in the Maker makes
  a draft from its page (Phase 1 `ensureDraft`); the next `plugin_save` makes it format 2, and
  *Export package* produces a v2 package.

**Checks**
- [x] **Tests:**
  - `tests/pluginSecurity.test.ts` (10) and `tests/pluginPackages.test.ts` (14): semver and
    ranges, deterministic packing, the manifest against its schema, and tampering (a changed
    file, a missing lock, an added file).
  - Unsafe zips: `../`, folders, `.exe`, `.env`, a 1 MB+ file, 50 files, not a zip.
  - A package for a newer Bhippi; install, update, widening, review, downgrade and conflict
    refusals; rollback and forward; Maker checks at install; export round trip.
  - Rust: `package_versions_install_atomically_and_keep_the_newest_three` (bad versions and
    names, pruning, no staging left behind, hashes).
  - **Full suites:** 1,507 frontend and 354 Rust tests pass. `tsc` and `eslint` are clean.
  - Writing the tests caught a real bug: an update adding a *sensitive* tool to a `"*"` plugin
    was not treated as widening. Fixed.
- [x] **Escape tests in a real browser** (`plugin-lab.html`, Chromium, the real bridge). The lab
  plugin tried each of these and all were refused:
  - an MCP tool, `read_file`, `scrape_web_page` and `get_plugin`;
  - `set_playhead`, `fileUrl` of `~/.ssh/id_rsa`, and chat without permission.
  The 121st tool call in a minute got "Slow down". The earlier sandbox checks still hold:
  network, parent DOM and storage blocked; delete refused.
  - **The strict page policy, proven:** the same page with a jsDelivr script and `eval` ran both
    under the old policy, and had **both blocked** under format 2.

**Deferred on purpose (and why)**
- **A `bhippi-plugin://` URI scheme and binary assets.** Packages are bundled into one page at
  install time, like drafts. That keeps the proven sandbox (an opaque origin, CSP in the page)
  with no new protocol to secure. A scheme is only needed for binary assets (PNG, fonts) or
  pages over 4 MB; SVG and inline data cover images today.
- **Custom tools shipped inside plugins.** A plugin's steps tool would run with *the AI's*
  permissions when the AI calls it. That's an escalation path unless every step is limited to
  the plugin's own grant, so it moves to Phase 5 (content packs) with that rule designed in.
- **Signing.** The lock hash (`pkg.lockHash`) is what bhippi.com will sign in Phase 3; the
  install already verifies the lock end to end.

### Phase 3: Marketplace backend — built and tested locally (2026-09-27); not deployed yet
Everything is in `D:\Bhippi website`. That repo has **no git commits yet**, so these files are
only on disk there. New files, plus a few small edits to existing ones.

- [x] **Database** (`migrations/0005_plugins.sql`):
  - `plugin_listings`: one per plugin id, owned by the first submitter; status pending, live,
    hidden or revoked; latest approved version; install count.
  - `plugin_versions`: manifest, R2 key, zip SHA-256, lock hash, size, compatibility range,
    status, automated report, review note, reviewer and signature.
  - `plugin_revocations`: one row per revoked version, or `*` for a whole plugin.
- [x] **Automated check** (`functions/_lib/plugins/check.ts`). It mirrors the app's
  `readPackage` + `validateDraft`; keep them in step.
  - Safe unzip decided from the zip directory before inflating (names, types, sizes, count,
    compression). Files must be UTF-8.
  - The manifest is checked against the schema: fields, id, semver, no extra fields.
    **Bhippi's own ids are reserved** (`bhippi-*`, `builtin-*`, `official-*`, `helios-*`).
  - Every file must match `manifest.lock.json`.
  - Refused: remote scripts, styles and imports; forbidden tools; undeclared hosts.
  - **Marketplace policy: sensitive tools are refused** until a Verified tier exists (decision 2).
    `PLUGINS_ALLOW_SENSITIVE=true` turns it off.
  - Output is a risk level (low, medium or high) plus warnings for the reviewer: `"*"`,
    network, chat, unused permissions, computed tool names, `eval` / long encoded strings, no
    acceptance checks.
- [x] **Signing** (`functions/_lib/plugins/sign.ts`, `scripts/plugins-keygen.mjs`):
  - A **dedicated** Ed25519 key (`PLUGIN_SIGNING_KEY`), separate from the licence key.
  - Signed statement: `bhippi-plugin/1\n<id>\n<version>\n<lock hash>\n<zip sha256>`.
  - `revocations.json` is signed over its exact text.
- [x] **API `/api/plugins/*`** (`functions/_lib/plugins/routes.ts`,
  `functions/api/plugins/[[path]].ts`). It reuses the site's sign-in, owner check, audit and
  JSON helpers; the licence routes are untouched.
  - **Public:**
    - The catalogue (search, category, popular/new; cached 60 s).
    - Listing detail (no emails).
    - Download of approved versions only: the zip, plus `X-Bhippi-Signature`, `-Lock-Hash`
      and `-Zip-Sha256` headers. Installs are counted.
    - `revocations.json` (signed, cached 5 min).
  - **Authors (the app's sign-in token):**
    - `POST submissions?category=` takes the zip as the body, ≤ 6 MB, 10 a day. A failing
      package is answered with its report and **not stored**. A passing one goes to R2, then
      `in_review`.
    - The id belongs to its first author. The same version or an older one than live is
      refused. A failed write rolls the R2 object back.
    - `GET mine` shows my listings and versions with the reviewer's notes. Authors can withdraw
      a version that's still in review.
  - **Owner only** (the hard-coded `OWNER_EMAILS`; anyone else sees an unknown URL, and the
    attempt is audited):
    - Queue and version detail (every file as text, and permissions compared with the live
      version).
    - Approve: the stored package is re-hashed first, then it is signed and goes live.
    - Reject with a reason (the package is deleted), or revoke with a reason (it goes into the
      revocation list; the latest version is recomputed).
    - Hide or show a listing, or revoke a whole listing.
    - Every action writes an `audit` row. Cross-site POSTs are refused.
- [x] **Admin panel › Plugins** (`src/helios/Plugins.tsx`, `api.ts` `pluginsApi`, `Admin.tsx`
  tab, `helios.css`):
  - A queue with status counts and risk pills.
  - A review drawer with the description, "What it may do" in plain words (sensitive tools in
    red, and anything new since the live version marked **new**), the automated notes, and a
    file browser showing every file.
  - Approve and publish, reject with a reason, revoke, and hide/show.
- [x] **Declared dependencies:** `fflate` added to the website's `package.json` (it was only
  there as a dependency of another package). The `PLUGINS` bucket binding is in
  `wrangler.jsonc`.
- [x] **Tested end to end on a local Cloudflare runtime** (`wrangler pages dev`, a throwaway D1
  and R2 in the scratch folder; your local dev database was not touched), with packages made
  by **the app's own `packPackage`**. **32/32 checks pass:**
  - **Submitting:**
    - Sign-in is required, and clean packages go into review with nothing listed before
      approval.
    - Another author can't take the id; the same version twice is refused.
    - Also refused: sensitive tools, remote scripts, reserved ids, a tampered file, and path
      traversal.
  - **Review:**
    - Non-owners get 404, and the owner sees the queue and every file.
    - A cross-site approve gets 403.
    - Approve → listed with its permissions and no email.
  - **Download:**
    - The bytes match the hash header, and **the signature verifies with the public key** (a
      changed statement does not).
    - Installs are counted.
  - **Updates and rejection:**
    - An older version is refused, and a version in review can't be downloaded.
    - A rejection needs a reason, and the author sees it in `mine`.
    - Nobody else can withdraw a version; the author can.
  - **Revocation:**
    - Revoke → it appears in the revocation list, which is **signed**.
    - The download returns 404, and the plugin leaves the catalogue.
  - The admin tab was checked in a browser: the queue and the review drawer both render with
    real data.
  - `tsc` is clean on the site and on the new functions.
- **Deferred:**
  - **The AI review report:** the automated check plus your review cover launch. An on-demand
    "AI review" button (the Claude API, with its own key secret) can be added to the review
    drawer later.
  - **A public web page for the marketplace:** browsing happens in the app (Phase 4).
  - **Ratings and reports:** Phase 5.

**To go live (needs your go-ahead; these change bhippi.com):**
1. `npx wrangler r2 bucket create bhippi-plugins`
2. `node scripts/plugins-keygen.mjs`, then
   `npx wrangler pages secret put PLUGIN_SIGNING_KEY --project-name bhippi` with the private key.
   Keep the `publicKey` for the app (Phase 4).
3. `npx wrangler d1 migrations apply bhippi-ve --remote` (adds the three tables; changes nothing
   else).
4. `npm run deploy`

Note: the local wrangler (4.125) is older than `wrangler.jsonc`'s compatibility date
(2026-09-01), so local runs need `--compatibility-date 2026-08-27` or a newer wrangler.

### Phase 4: Marketplace in the app — done (2026-09-27); live once Phase 3 is deployed
- [x] **Rust client** (`src-tauri/src/market.rs`). The UI never talks to bhippi.com itself.
  - Only fixed marketplace paths can be read: the catalogue, `p/<id>` and `mine`. The admin
    routes are unreachable from the app.
  - **Every download is verified before the UI sees it:**
    - the bytes must hash to the server's `X-Bhippi-Zip-Sha256`;
    - the Ed25519 signature over `bhippi-plugin/1\n<id>\n<version>\n<lock hash>\n<zip sha256>`
      must verify with `PLUGIN_PUBLIC_KEY`;
    - at most 6 MB.
  - The revocation list is used only when its signature verifies.
  - The Google sign-in token (license.rs) is sent only to publish, to read your own
    submissions, or to withdraw.
  - Debug builds can point at a local marketplace (`BHIPPI_MARKET_API`,
    `BHIPPI_PLUGIN_PUBLIC_KEY`); release builds always use bhippi.com and the built-in key.
  - **`PLUGIN_PUBLIC_KEY` is empty until go-live step 2**, so until then browsing works and
    installing from the marketplace says it isn't set up yet.
- [x] **App logic** (`src/plugins/market.ts`):
  - `browse`, `listing`, `mySubmissions`, `withdraw`, `updateFor`.
  - `installFromMarket`: the verified download's own lock must hash to the lock hash bhippi.com
    signed, and it must be the id and version asked for. Then `installPackage` runs: the app's
    checks, atomic install, off until reviewed, source `marketplace`.
  - `checkRevocations`: every installed version on the signed list (or `*`) is turned off and
    marked `revoked`. `patchPlugin` refuses to turn a revoked plugin on; a newer version installs
    clean of it. It runs 20 s after start and every 6 h, and a notification names each plugin it
    turned off.
  - `publish`, with **the Maker's own gate**:
    - a draft with no problems and at least one acceptance check;
    - the draft is saved with the chosen version (so what is tested is exactly what is
      published);
    - **a real test run the Judge passes (80+)**;
    - then it's packed and sent. bhippi.com's report comes back either way.
- [x] **The marketplace screen** (`src/plugins/PluginMarket.tsx`):
  - Opened from Plugins › Plugin Marketplace…, the Plugins panel menu, or the Maker's
    *Marketplace* button.
  - **Browse:** search, categories, and cards with an Installed / *Update x.y.z* badge. The
    detail pane shows author, installs, category, **What it may do** (sensitive tools in red),
    background use and versions (pulled ones marked).
    - *Install* / *Update* shows "Checking the signature and installing…". After an install,
      *Review and turn on* opens the Maker on the plugin's consent review.
    - A local plugin with the same id is never overwritten.
  - **Installed:** every packaged plugin with its version, source, on/off or **Pulled: reason**,
    and *Update* when a newer version is live.
  - **My submissions:** each version's status (In review, Live, Rejected, Pulled, Withdrawn), the
    reviewer's note, and *Withdraw* while in review.
- [x] **In the Maker:**
  - *Publish to the marketplace…* in Details: version (next patch pre-filled), category, and
    step-by-step progress (checking, testing, packing, sending). It shows the result, or every
    problem.
  - A pulled plugin shows why.
  - A plugin waiting for review, or pulled, opens straight on its Permissions tab.
  - **Fixed along the way:** the Maker chat's standing instruction still told the AI to use
    `save_plugin`, which it hasn't had since Phase 1. It now describes the real loop.
- [x] **Tests:**
  - `tests/pluginMarket.test.ts` (9), with Rust stubbed:
    - a signed install arrives off and marked;
    - a download whose files aren't the signed lock is refused, and so is a different id or
      version;
    - update detection;
    - revocations turn plugins off and they can't be turned back on; a newer version installs
      clean; `*` pulls every version; unrelated plugins are left alone;
    - the publish gate (bad version, failing Judge, no checker, no acceptance checks);
    - a successful publish sends a package that passes `readPackage` at the chosen version,
      from the saved draft.
  - Rust `market::tests` (2): only marketplace pages are readable; a download must match its
    hash, version, lock and key.
- [x] **End to end against a running marketplace** (the local `wrangler pages dev` from
  Phase 3):
  - Shot list 1.1.0 was published from the app's packer and approved as owner.
  - Then the **live Rust test** (`cargo test --lib market:: -- --include-ignored` with the
    `BHIPPI_*` variables):
    - the catalogue lists it, and the download **verifies**;
    - the revocation list **verifies**;
    - admin routes are unreachable;
    - with a stranger's key both the download and the revocation list are **refused**.
  - The app's `readPackage` lock hash of the real download equals the lock hash bhippi.com
    signed (`e5dc4d41…`), so app and site agree byte for byte.
  - The marketplace screen was rendered in Chromium with real data (the Browse detail, and My
    submissions with Live, Rejected + note, Withdrawn, Pulled + note). That caught and fixed a
    table-row layout glitch.
  - **Full suites:** 1,516 frontend and 356 Rust tests pass. `tsc` and `eslint` are clean.
- **Still to do at go-live:** put the public key from step 2 into `market.rs`
  `PLUGIN_PUBLIC_KEY` and ship a build. Until then no marketplace install can verify, which is
  intended.

### Phase 5: Trust and growth — the trust layer done (2026-09-27); three items designed, not built
**Built** (in `D:\Bhippi website` and the app):
- [x] **Database** (`migrations/0006_plugins_trust.sql`):
  - `plugin_publishers`: handle, display name, bio, and `verified` plus who verified and when.
  - `plugin_ratings`: one per account per plugin, 1–5 stars, a review, the version rated, and
    `hidden` for moderation.
  - `plugin_reports`: reason (malicious, broken, misleading, privacy, copyright, other),
    details, open/closed and a resolution.
  - A denormalised `rating_avg` / `rating_count` on listings.
- [x] **Publisher profiles** (`functions/_lib/plugins/trust.ts`):
  - `@handle`s are 3–32 plain characters, one per handle; Bhippi's own names are reserved.
  - Listings credit the publisher's display name and show the Verified badge.
  - **Changing your handle or name drops Verified** until the owner checks again.
- [x] **Ratings and reviews:**
  - One per account; rating again replaces it. You can't rate your own plugin.
  - Public reviews show a first name only (or the reviewer's publisher name), never an email.
  - The owner can hide a review, which also takes its stars out of the average.
  - The catalogue can sort by rating.
- [x] **Reports:** 5 per account a day, going to the owner's Reports view, which closes them
  with a note. Every action is audited.
- [x] **The Verified tier** (decision 2, answered): only the owner grants it.
  - **A verified publisher may ship sensitive tools.** Those versions still wait in review, and
    are marked high risk.
  - **Auto-approve:** a verified publisher's update that asks for **nothing the live version
    didn't** (same `widens` rule as the app) is approved and signed on arrival, recorded as
    `auto (verified publisher, no new permissions)` in the audit log. It stays revocable. An
    update that asks for more still waits.
- [x] **AI second opinion** (`functions/_lib/plugins/aiReview.ts`, with the official
  `@anthropic-ai/sdk` added to the website):
  - Owner-only and on demand (**Run AI review** in the review drawer). **Advisory: it never
    approves, rejects or signs.**
  - Model `claude-opus-5`, adaptive thinking, effort high, streamed.
  - `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`) re-runs a declined review
    on the recommended model. A refusal or an incomplete answer is reported plainly.
  - The answer is constrained to a JSON schema: verdict, risk, summary, whether it matches its
    description, where data goes, and findings by file.
  - **The plugin's files go in as delimited untrusted data**; the system prompt says any text
    trying to steer the review is itself a danger finding.
  - Over 400 K characters of source is refused with "review it by hand", never cut short.
  - The result is kept on the version (paid once).
  - Needs the `ANTHROPIC_API_KEY` secret; without it the button says so.
- [x] **Admin › Plugins** has three views: **Review queue** (the drawer now shows the
  publisher's @handle, ✓ verified, the AI panel, and ratings with hide/show), **Reports**, and
  **Publishers** (each publisher's track record: live, approved, refused, reports; Verify /
  Unverify with a warning of what it grants).
- [x] **In the app** (`market.rs` `market_post` with a write whitelist; `market.ts`;
  `PluginMarket.tsx`):
  - Stars and the Verified badge on cards.
  - In the detail pane: publisher @handle ✓, the average rating, reviews, **Rate it** (after
    installing), and **Report this plugin** (plain-words reasons).
  - A **publisher profile** form in My submissions.
- [x] **Tested:**
  - **26/26 end-to-end checks** on the local Cloudflare runtime (packages from the app's packer):
    - **Profiles:** handle rules, reserved names, a taken handle, publisher credit.
    - **Ratings:** no self-rating, the star range, replacement, first names only, owner hide
      removing it from the average.
    - **Reports:** a real reason needed, invisible to non-owners, the owner closes with a note.
    - **Verified tier:** a sensitive tool refused before verification; only the owner verifies;
      a verified sensitive plugin goes into review, not live; a verified same-permissions
      update is **approved, signed and downloadable at once**; a wider one waits; a handle
      change drops Verified.
    - AI review reports a missing key plainly.
  - A manual approve after the refactor still signs and serves, and records the owner.
  - The admin views were checked in a browser.
  - Rust `market::tests` cover the new read and write whitelists.
  - **Full suites:** 1,516 frontend and 356 Rust tests pass. `tsc` is clean in both repos.
  - **Not exercised:** a real Claude call (it needs your API key, and costs money). The code
    type-checks against the SDK's own types.

**Designed, not built (each needs something first):**
- **Characters as a signed first-party package.** Today its pages are unsandboxed and
  same-origin: `public/characters/shared.js` reads `window.parent.document` for the theme and
  keeps the character library in the app's `localStorage`, and the 3D studio loads ~1.8 MB of
  model files. A sandboxed plugin has neither, so moving it now would break Characters. The
  order that works:
  1. A `bhippi-plugin://<id>/…` URI scheme that serves a plugin's own files, binary ones
     included, with `Access-Control-Allow-Origin: null` (the Phase 2 deferral).
  2. Change `shared.js` to talk to the host only: the theme from `init`, the library through a
     bridge storage call, and export through the existing `use` message.
  3. Add `sandbox="allow-scripts"` to its frames.
  4. Package and sign it like any plugin, as author `bhippi`.
  It's also where other agents are actively working, so it should be coordinated.
- **Content packs.** A manifest `kind: "content-pack"` with
  `content: [{ type: "lut" | "motion-template" | "sfx" | "rig", file, name }]`. **No code runs**;
  the installer hands each file to its library (the LUT parser in `colorGrade.ts`, the motion
  template registry, the SFX library). LUTs (`.cube`) and motion templates (JSON) are text and
  fit the Phase 2 format today; SFX and rigs are binary and need the URI scheme above. Each type
  needs its own install and uninstall hook in its library.
- **Paid plugins.** Dodo Payments already handles licences, but a marketplace needs your
  decisions first: the revenue share, how authors are paid out (Dodo's payout or split support,
  or manual), tax and invoicing, refunds, and whether a paid plugin is locked by the licence
  certificate. Until those are made, building it would mean guessing at money flows.
- **Custom tools shipped inside plugins** (from Phase 2). The design that is safe: each step's
  tool must be inside the plugin's own permission grant (checked at install and at run time),
  and steps run under the *plugin's* guard, not the AI's.

**Go-live additions:** apply `0006_plugins_trust.sql` too
(`npx wrangler d1 migrations apply bhippi-ve --remote` applies both), and optionally
`npx wrangler pages secret put ANTHROPIC_API_KEY --project-name bhippi` for the AI review.

## Level 3: plugins as part of Bhippi

The goal: anything Bhippi can do, a plugin can do, under the same rules. A plugin that needs the
transcript, the user's AI model, the sound, the frames or the transport gets them from the SDK,
not by guessing at file paths. What was missing were Bhippi's services outside the tools, and
places in the editor for plugins to plug into.

**How it stays complete.** `src/plugins/capabilities.ts` is the one list of services. It produces
the Plugin Maker's SDK reference, names the permission each service needs, and feeds the install
and marketplace screens. `tests/pluginCapabilities.test.ts` fails when an entry has no bridge
handler or SDK method, or when the bridge answers a service the list does not name.

**Permissions.** Reading costs nothing. What spends the user's money or time is a declared
**service** (`permissions.services`: `transcribe`, `ai`), shown before the plugin runs; asking
for a new one sends an update back for review (`widens`).

### Step 1: services a plugin can call — done (2026-09-27)

- `bhippi.transcript.comp / .get`: words in timeline time, from the transcripts Bhippi already
  has; `{ transcribe: true }` makes missing ones (service `transcribe`).
- `bhippi.ai.ask(prompt, { system, json, maxTokens })`: the user's own model, one question, no
  tools (service `ai`, 20 a minute). Backend: `plugin_ask` → `chat::ask_once`, sealed so a CLI
  agent gets none of its own tools.
- `bhippi.playback.*` and the `'playback'` event; `bhippi.audio.peaks / .loudness`.
- `bhippi.batch([...])`: many tools as one undo step (`history.squash`).
- `bhippi.jobs.start(label)`: progress in Bhippi's job list, cancellable, ended if the page closes.
- The Plugin Maker gets a "which API for which job" table, runs sealed (no Claude Code
  `Read`/`Glob`/`Grep`/web tools: it had been searching AppData) and at most `high` effort
  (`maxEffort` in `harnesses.json`).

### Step 2: pictures and places in the editor — done (2026-09-27)

- `bhippi.video.frame({ time, compId | assetId, size })`: the edit as the export draws it
  (graphics included), or one file's picture, as a PNG data URL.
- `bhippi.media.read(assetId)`: a project file's bytes (up to 256 MB), so a plugin can decode and
  analyse sound itself.
- `bhippi.menu.add({ id, label, where }, fn)`: entries under Plugins in the clip, empty-timeline
  and Project panel right-click menus, told what was clicked.
- Not built: a command palette (Bhippi has none yet) and plugin keyboard shortcuts (key events
  stay out of plugins on purpose, see Level 2).

### Step 3: plugin clips — done (2026-09-27)

- A plugin registers a kind of clip with `bhippi.generator(name, { label, params }, draw)`. The
  clip is an HTML clip carrying `plugin: { id, generator, params }` (Rust keeps the field;
  without frames it draws nothing rather than a white title).
- **Who draws:** the plugin's own sandboxed page, one frame at a time: the editor sends `render`,
  the page draws on a cleared canvas and returns a transferred `ImageBitmap`. Plugin code never
  runs in the editor's document. A hidden `role: 'render'` copy of each plugin with a clip in
  the project stays running (`PluginClipRenderers`).
- **Preview:** `PluginClipLayer` in the Compositor, one request in flight, latest frame wins.
  **Export and stills:** `htmlFrames.ts` mounts the plugin in place of the DOM renderer, so the
  existing PNG-sequence path and Rust compositing are unchanged.
- **Sound:** `clipAudio.ts` mixes the decoded files the way the preview does (mute, solo, volume
  keyframes, audio transitions, trims, speed, reverse, nested comps) and gives every frame
  `{ rms, peak, 64 bands, smooth, waveform }`. It is computed, not tapped from the speakers, so
  the preview and the export match frame for frame. `bhippi.audio.analyze` returns the same.
- **Placing:** the `add_plugin_clip` tool (plugins and Bhippi AI; running plugins' generators are
  in the AI's plugins brief). **Settings:** the Properties panel edits a clip's params, one undo
  step each.
- **The Maker:** a reviewed `audio-visualizer` example; `plugin_test` draws one frame of every
  generator and reports errors or empty frames.
- Checked in headless Chromium through `plugin-lab.html`: a sandboxed generator drew a
  320×180 frame (11,146 pixels) back to the editor.
- Not built: **plugin effects** (a clip's frame in, a new frame out). They need the source frames
  handed to the plugin per frame at export. That is the next piece to design.

### Step 4: plugins working together — done (2026-09-27)

- `bhippi.plugins.list()` and `bhippi.plugins.call(id, action, args)` (service `plugins`): one
  plugin uses another's exposed actions, each running under its own permissions.
- Export hooks: `bhippi.on('export')` (Level 2) reports start and finish. A hook that changes
  an export was left out on purpose: an export must not depend on a plugin being open.
- Per-clip panels: the generator settings in the Properties panel, plus right-click entries
  (step 2), cover a plugin acting on a selected clip. A free-form inspector section was not built.

## Decisions

1. **Who approves? — built as: you approve.** The author submits, automated checks run, and you
   approve in Admin › Plugins. Verified publishers' updates that ask for nothing new are
   approved on arrival (Phase 5). Still open if you want it: a "Community (unreviewed)" lane.
2. **Sensitive tools in the marketplace — built as: only from Verified publishers**, and those
   versions still wait for your review (Phase 5). `PLUGINS_ALLOW_SENSITIVE=true` opens them to
   everyone.
3. **Paid plugins — open.** Needs your decisions on the revenue share, payouts, tax and refunds
   (see Phase 5, *Designed, not built*).

## Progress log

- **2026-09-27:** Plan written from a read of the code (plugin runtime, the Maker, the chat
  harness) and of the bhippi.com backend (`D:\Bhippi website`: Cloudflare Pages + D1 + R2).
- **2026-09-27:** **Phase 0 done.**
  - The Plugin Maker no longer asks for a resolution.
  - Its steps carry ~20 K tokens instead of ~39–43 K.
  - Files changed: `src/App.tsx`, `src/chat/ChatPanel.tsx`, `src/plugins/brief.ts`, and the new
    test `tests/pluginMakerHarness.test.ts`.
  - Next up: Phase 1, the Plugin Maker harness.
- **2026-09-27:** **Phase 1 done.**
  - The Plugin Maker is its own harness: its own prompt, and 22 tools enforced in Rust (on every
    transport) and in the app.
  - Plugins are built as drafts from templates. Each is validated, bundled, and tested in a
    sandbox against a scratch project.
  - They are pictured at two widths and scored by a deterministic Judge.
  - Checked in a real browser: the real project was untouched and the examples scored 100.
  - Found a Phase 2 security item: plugins' "read" tools include memory and meme-library
    writes, the real playhead and online searches.
  - Next up: Phase 2, the package format and hardening.
- **2026-09-27:** **Phase 2 done.**
  - Plugins get only pure reads without asking.
  - `"*"` no longer covers files, network through Bhippi, paid generation, memory or MCP.
  - Plugins can't read each other.
  - Chat is suggest-only, `fileUrl` is scoped, and there are rate limits.
  - Format-2 plugins run under a strict policy, proven in Chromium.
  - Plugins from outside wait for a consent review.
  - `.bhippi-plugin` packages have hash locks, safe unzip, atomic versioned installs,
    review-on-widening updates, rollback to the last 3, and export/import in the Maker.
  - Deferred with reasons: the URI scheme and binary assets, plugin-shipped custom tools, and
    signing (Phase 3).
  - Next up: Phase 3, the marketplace backend on bhippi.com.
- **2026-09-27:** **Phase 3 built and tested locally.**
  - Built in `D:\Bhippi website`: the D1 tables, the automated check that mirrors the app's,
    dedicated-key signing, `/api/plugins/*` (catalogue, signed download, signed revocations,
    author submissions and withdrawals, owner review), and an admin Plugins tab with a review
    drawer.
  - 32/32 end-to-end checks pass on a local Cloudflare runtime, using packages made by the app.
  - Not deployed; the four go-live steps are listed above.
  - Next up: Phase 4, the marketplace in the app (it needs the public key from step 2).
- **2026-09-27:** **Phase 4 done.**
  - The app browses, installs (signature, hash and lock verified in Rust and TS), updates and
    publishes. Publishing is gated by the Maker's Judge.
  - Your own submissions can be tracked and withdrawn.
  - The signed revocation list is applied at start and every 6 h.
  - Verified end to end against a running marketplace, with the same lock hash on both sides.
  - Waiting on: the Cloudflare token, then the four go-live steps plus the public key in
    `market.rs`.
- **2026-09-27:** **Phase 5 trust layer done.**
  - Publisher profiles, ratings and reviews (with moderation), and reports.
  - The Verified tier: sensitive tools allowed (still reviewed), and same-permissions updates
    auto-approved and signed.
  - An owner-only, advisory AI review (Claude Opus 5, schema-constrained, untrusted-input
    safe).
  - 26/26 end-to-end checks pass.
  - Characters, content packs, paid plugins and plugin custom tools are designed above, with
    what each needs first.
- **2026-09-27:** **Level 2 ("bigger plugins, same trust") done.**
  - Pages moved out of `plugins.json`: each page and revision is stored once as
    `plugins/sources/<sha256>.html` and named by `htmlHash`. Old libraries still load.
  - New limits: 24 MB page, 8 MB per draft file, 16 MB and 120 files per draft, 24 MB packages,
    64 MB plugin storage. Old versions are capped at 48 MB in total.
  - Binary assets (pictures, glb, fonts, audio, video, wasm) are real bytes on disk and in
    packages, and base64 in memory. Locks hash the real bytes. Assets are bundled into the page
    as blocks that never run, read with `bhippi.asset / assetBytes / assetText / assets` and
    `data-bhippi-src`.
  - CSP: `connect-src` and `font-src` allow `blob:` and `data:` (the page's own assets), and
    strict pages get `'wasm-unsafe-eval'`. `eval` stays blocked.
  - New Maker tools: `plugin_add_library` (a pinned three.js bundle in `public/plugin-libs/`,
    built by `scripts/build-plugin-libs.mjs`) and `plugin_add_asset` (a project media file).
    `plugin_write_file` takes base64.
  - `bhippi.importMedia` hands stills, clips and sounds back through `import_media` (a plugin
    permission). `bhippi.on('export')` reports export status and the file name only.
  - The Maker may run up to 10 fix rounds for big plugins. There's an Assets section in Details.
  - Keyboard events were left out on purpose: a plugin that hears every key press could read
    what the user types into the chat.
  - Still to do: the bhippi.com automated check must accept the new file types and limits
    before plugins with assets can be published.
- **2026-09-27:** **Level 3, step 1 done** (plugins as part of Bhippi).
  - Why: an "audio visualizer" took the Plugin Maker 40+ minutes. Traces showed the tools ran for
    under a minute in total. The rest was max-effort thinking, probing a sandbox that could not
    read media, and searching the disk with Claude Code's own tools.
  - New: the capability registry, the `services` permission, and transcripts, AI questions,
    playback, audio data, batched edits and jobs for plugins, with the backend `plugin_ask`.
  - The Maker runs sealed and at most at `high` effort.
  - Step 2 the same day: `video.frame`, `media.read`, and right-click menu entries.
  - Steps 3 and 4 the same day: plugin clips (generators) drawn in the preview and the export
    from the edit's own sound, `add_plugin_clip`, clip settings in the Properties panel, and
    plugins calling each other's actions.
  - Next: plugin effects (frame in, frame out).
