// What Bhippi AI is told about plugins: the SDK reference (the plugin_sdk_reference tool, and
// what leads the Plugin Maker's prompt) and the Plugin Maker's toolset. The Maker's workflow and
// rules are its own prompt, src-tauri/prompts/plugin-maker.md.

import { harnessToolset } from '../lib/harness';
import type { Toolset } from '../lib/toolRouter';

export const PLUGIN_SDK_REFERENCE = `# Bhippi plugin SDK

A plugin is ONE HTML document with its own <style> and <script> (in the Plugin Maker it is
written as draft files — index.html, app.js, style.css — that plugin_save inlines into one page).
Write the code yourself: no remote scripts from CDNs (plugin_validate refuses them, because code a
plugin downloads later is code nobody reviewed). For 3D, plugin_add_library copies Bhippi's
checked three.js into the draft (window.THREE, with OrbitControls, TransformControls, GLTFLoader,
GLTFExporter). WebAssembly and web workers (blob: URLs) work. The page may be up to 24 MB with its
assets. It runs in a sandboxed frame inside a Bhippi panel. It cannot touch the editor, the disk or the network directly — everything goes through
the global \`bhippi\` object, which applies Bhippi's rules to every call.

## The page
- Use addEventListener, not inline on*="" attributes. No <form> submission (handle submit and preventDefault).
- It already matches the editor: body has the panel background, text colour, 12px system font,
  and styled button / button.primary / input / select / textarea. The editor's colours are CSS
  variables: --panel --panel-2 --panel-3 --panel-4 --field --line --line-strong --text --text-dim
  --text-faint --accent --blue-hi --green --red --amber --gold --radius --font --mono. Use them, so
  the plugin follows the user's theme (they update live).
- Panels are narrow (about 280–600 px wide) and resizable: design for a column, scroll inside.
- \`await bhippi.ready\` before the first call.

## Reading the project
- \`await bhippi.project()\` → { project, playhead, selectedClipIds, comps[], media[] … } (what Bhippi AI sees).
- \`await bhippi.comp(id?)\` → one comp in full: tracks, clips (start/end/in/duration seconds, source kind,
  transform, effects, keyframes), transitions, markers. No id = the active comp.
- \`await bhippi.selection.get()\` / \`bhippi.selection.set([clipIds])\`.
- \`await bhippi.playhead.get()\` / \`bhippi.playhead.seek(seconds)\`.
- \`bhippi.on('project' | 'session' | 'selection' | 'playhead' | 'theme' | 'export', fn)\` → returns an unsubscribe function.
  'project' fires (coalesced, ≤4/s) after any change; re-read what you need. 'export' fires with
  { status: 'started' | 'done' | 'error' | 'cancelled', file } when the user exports (file is the name only).
- \`bhippi.session\` → { key, name, saved } for the open project. key is stable for one project file
  (null until it is first saved); 'session' fires when the user opens another project, starts a new
  one or saves under a new file. bhippi.project().project also carries key and saved.

## Changing the project — only through Bhippi tools
- \`await bhippi.tool(name, args)\` runs any Bhippi tool exactly as Bhippi AI calls it (same names and
  input schemas as your own tools: add_text, update_clip, split_clips, add_transition, add_marker,
  place_clip, import_media, create_motion_scene, level_audio, call_custom_tool …). It resolves with
  the tool's result ({ ok, summary, … }) or rejects with the reason it was refused or failed.
- \`await bhippi.tools()\` lists every tool with its description and input schema.
- Every edit is one Undo step named after the plugin. Calls from one plugin run one at a time.
- Reading tools are always allowed. Every other tool must be listed in the plugin's permissions
  (\`tools\`); \`"*"\` allows all of them EXCEPT the sensitive ones, which must be named one by one:
  the shell and files on disk (run_command, read_file, write_file, edit_file, list_directory,
  glob_search, grep_search), installs, anything that deletes (clips, tracks, comps, media, brand
  kits), the assistant's memory (brain_*), tools that go online (online_research, scrape_*,
  download_online_media, find_memes_online, find_free_media …), paid generation
  (generate_cloud_media) and every MCP server tool (mcp__*).
- The user's permission mode still applies on top: in Plan only nothing edits; in Auto-edit
  nothing deletes. A refused call rejects with the reason — show it to the user, never retry in a loop.
- Plugins can never create, change or delete custom tools or plugins, spawn subagents or ask_user.

## Everything else
- \`bhippi.storage.get(key, fallback)\` (instant), \`await bhippi.storage.set(key, value)\`,
  \`bhippi.storage.remove(key)\`, \`bhippi.storage.keys()\` — this plugin's own saved data (JSON, ≤64 MB),
  the same in every project. Keep big binary things as assets, not in storage.
- \`bhippi.projectStorage\` — the same four calls, but kept per project (todo lists, notes, per-project
  settings). It has already switched when 'session' fires, so redraw from it there. It shares the
  64 MB limit with storage. An unsaved project's data is saved with the project on its first save.

## Assets (pictures, models, fonts, sounds, clips, wasm, data)
- Files in the draft next to the code: .png .jpg .webp .gif .avif .glb .bin .woff .woff2 .ttf .otf
  .wav .mp3 .ogg .m4a .mp4 .webm .wasm (binary, up to 8 MB each) and .json .svg .txt .gltf data.
  plugin_add_asset copies a project media file in; plugin_write_file takes base64 with
  encoding "base64". plugin_save bundles them into the page.
- \`await bhippi.asset(name)\` → a blob URL (for <img>, <video>, CSS, FontFace, three.js loaders).
  \`await bhippi.assetBytes(name)\` → ArrayBuffer (GLTFLoader.parse, WebAssembly.instantiate).
  \`await bhippi.assetText(name)\` → text of a json/svg/txt/gltf file. \`await bhippi.assets()\` → names.
- \`<img data-bhippi-src="logo.png">\` (also video, audio, source) is filled in when the page loads.

## Handing results to the project
- \`await bhippi.importMedia(data, { name: 'Render.png' })\` saves a still, clip or sound the plugin
  made (Blob, ArrayBuffer, typed array, canvas or data: URL; png jpg webp gif mp4 webm mov wav
  mp3 ogg m4a flac, up to 512 MB) under Generated/Plugins and imports it into the Project panel.
  It needs \`import_media\` in the plugin's permissions and resolves with import_media's result
  (its media ids); place it on the timeline with place_clip. Skipped during plugin_test.
- \`bhippi.toast(message, 'info' | 'success' | 'error')\` — a notification in the editor (20 a minute).
- \`await bhippi.chat(message)\` — offers the user a message for the Bhippi AI chat (needs the
  \`chat\` permission): it appears as a notification with a Send button, and reaches the AI only
  when the user clicks it (6 a minute). This is how a plugin hands a job to the AI.
- \`await bhippi.fileUrl(path)\` — a URL for one of the project's media files (from
  bhippi.project().media) or a file in the project's folder, that an <img> / <video> in the plugin
  can show. Any other path is refused.
- Limits: 120 bhippi.tool() calls a minute; past a limit the call is refused with "Slow down".
- Network: fetch() / WebSocket work ONLY to hosts listed in the plugin's \`network\` permission
  (e.g. "api.example.com", "*.example.com", "http://127.0.0.1:5678", "ws://127.0.0.1:4455").
  Anything else is blocked by the page's security policy.
- \`bhippi.expose(name, { description, params }, async (args) => result)\` offers Bhippi AI an action
  it can run with call_plugin_action while the plugin is running (params is a JSON schema).
- \`bhippi.test(name, async () => { … })\` is an acceptance check: throw (or reject) when the plugin
  does not do what its spec says. Checks never run for the user — only under plugin_test, against
  a scratch copy of the project, so a check may make real edits through bhippi.tool().
- console.log / warn / error and uncaught errors are shown in the Plugin Maker console; the AI
  reads them with plugin_logs.

## Automations
A plugin with \`background: true\` keeps running while hidden (as long as it is enabled), so it can
react to bhippi.on(...) events, poll a service it was given network access to, or expose actions.
Keep background work light: no tight loops, no timers faster than ~1 s.
`;


/**
 * The Plugin Maker's toolset: its harness's tools (src/lib/harnesses.json), whole, with no genres —
 * so none of the timeline playbooks or production sections are sent. The backend enforces the same
 * list (src-tauri/src/harness.rs), and App.tsx refuses anything else.
 */
export const PLUGIN_MAKER_TOOLSET: Toolset = harnessToolset('plugin-maker');

/**
 * What leads the Plugin Maker's system prompt: the SDK reference. The Maker's own prompt
 * (src-tauri/prompts/plugin-maker.md) replaces copilot.md and carries the workflow and the rules.
 */
export const PLUGIN_MAKER_BRIEF = PLUGIN_SDK_REFERENCE;
