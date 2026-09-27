// Bhippi's services for plugins, in one place: what a plugin can reach beyond the tools
// (`bhippi.tool`) — transcripts, the user's AI model, playback, audio data, jobs, batched edits.
//
// Everything about a service is read from here: the SDK reference the Plugin Maker is given
// (brief.ts), the permission a manifest must declare (rules.ts, drafts.ts), what the install and
// marketplace screens say it may do, and the coverage test (tests/pluginCapabilities.test.ts),
// which fails when an entry has no handler in the bridge or no method in the SDK. Adding a service
// is: an entry here, a handler in bridge.ts, a method in sdk.ts.

/** Services that cost the user something, so a plugin must declare them (`permissions.services`). */
export type PluginService = 'transcribe' | 'ai' | 'plugins';

export const PLUGIN_SERVICES: Record<PluginService, { label: string; risk: string; hint: string }> = {
  transcribe: {
    label: 'Transcribe speech',
    risk: 'Transcribes speech in your media (with your transcription engine: its time, and credits if it is a paid service)',
    hint: 'bhippi.transcript.get / .comp with { transcribe: true }. Reading transcripts Bhippi already has needs nothing.',
  },
  ai: {
    label: 'Ask your AI model',
    risk: 'Sends questions to your AI model (uses your tokens or subscription; at most 20 a minute)',
    hint: 'bhippi.ai.ask(prompt, options).',
  },
  plugins: {
    label: 'Use other plugins',
    risk: 'Runs actions your other plugins offer (each within that plugin\'s own permissions)',
    hint: 'bhippi.plugins.call(plugin, action, args).',
  },
};

export const isPluginService = (name: string): name is PluginService => Object.prototype.hasOwnProperty.call(PLUGIN_SERVICES, name);

/** One SDK call a plugin makes: the bridge method it reaches and what it is for. */
export type SdkEntry = {
  /** The bridge method (bridge.ts HANDLERS) and the SDK's `call()` name (sdk.ts). */
  method: string;
  /** The service the manifest must declare, when the call costs the user something. */
  service?: PluginService;
  /** How a plugin writes it. */
  usage: string;
  doc: string;
};

export type SdkArea = { title: string; intro?: string; entries: SdkEntry[] };

export const SDK_AREAS: SdkArea[] = [
  {
    title: 'Clips the plugin draws (visualizers, particles, overlays)',
    intro: 'A generator is a kind of clip on the timeline that this plugin draws, frame by frame. It plays in the Program monitor and renders in the export like any graphic, and the user moves, trims, fades and keyframes it like any clip. Place one with bhippi.tool(\'add_plugin_clip\', { plugin: bhippi.plugin.id, generator, start, duration, params }) (list add_plugin_clip in permissions.tools), or let Bhippi AI place it: running plugins\' generators are listed to it. Bhippi keeps a hidden copy of the page running to draw them (bhippi.role is \'render\' there: skip panel-only work).',
    entries: [
      {
        method: 'generator.register',
        usage: 'bhippi.generator(name, { label, description, params }, (ctx, info) => { … })',
        doc: 'Registers a kind of clip. params are the settings the Properties panel shows: { key: { type: \'number\', label, default, min, max, step } | { type: \'color\', default: \'#ff3b6b\' } | { type: \'boolean\' } | { type: \'select\', options: [...] } | { type: \'text\' } }. The draw function paints ONE frame on a cleared, transparent CanvasRenderingContext2D of info.width × info.height and may be async. info: { time (s into the clip), duration, progress, compTime, fps, frame, width, height, u (= width / 1920: multiply sizes by it), exporting, params (with defaults filled in), audio: { rms, peak, bands: 64 values 0–1 from 30 Hz to 11 kHz, smooth (bands averaged over 3 frames), waveform: 128 values −1..1, loading } }. audio is the edit\'s own mix at that moment (mute, solo, volume keyframes, trims and speed included), the same in the preview and the export. Draw only from info: no state kept between frames, no Math.random() (seed a random from info.frame), because frames are drawn out of order and one at a time. For WebGL draw on your own canvas, then ctx.drawImage(it, 0, 0).',
      },
    ],
  },
  {
    title: 'Transcripts (what is said)',
    intro: 'Words come with timeline times, already mapped through each clip\'s in point, speed and place, so they line up with the playhead and with bhippi.tool() times. Reading a transcript Bhippi already made is free; making a new one needs the `transcribe` service.',
    entries: [
      {
        method: 'transcript.comp',
        usage: 'await bhippi.transcript.comp(compId?, { transcribe? })',
        doc: 'Everything said in a comp (default: the active one), as the edit plays it: { compId, words: [{ text, start, end }], lines: [{ start, end, text }], text, missing: [assetId] }. Words come from the audible clips, in timeline seconds. `missing` lists media with speech that has no transcript yet; pass { transcribe: true } (service `transcribe`) to make them first.',
      },
      {
        method: 'transcript.get',
        usage: 'await bhippi.transcript.get(clipId | { clipId } | { assetId }, { transcribe? })',
        doc: 'One clip\'s or one file\'s words: { assetId, clipId, language, text, words: [{ text, start, end, sourceStart, sourceEnd, speaker? }] }. With a clip, start/end are timeline seconds and only the words inside the clip\'s trim are returned; with an asset they are seconds in the file. Resolves with words: [] and cached: false when there is no transcript and { transcribe: true } was not passed.',
      },
    ],
  },
  {
    title: 'Your AI model',
    intro: 'The model the user picked for Bhippi AI answers one question at a time: no tools, no chat history, nothing shown in the chat. Needs the `ai` service; 20 questions a minute.',
    entries: [
      {
        method: 'ai.ask',
        service: 'ai',
        usage: 'await bhippi.ai.ask(prompt, { system?, json?, maxTokens? })',
        doc: 'Resolves with { text, json, provider, model, usage: { input, output } }. json: true (or a JSON schema object) asks for JSON only and parses it into `json` (it rejects when the answer is not valid JSON). maxTokens is 16–8192 (default 2048). Put the transcript or whatever the model needs into the prompt yourself.',
      },
    ],
  },
  {
    title: 'Playback',
    entries: [
      { method: 'playback.state', usage: 'await bhippi.playback.state()', doc: '{ playing, rate, time }. bhippi.on(\'playback\', fn) fires with the same object when playback starts, stops or changes speed.' },
      { method: 'playback.play', usage: 'await bhippi.playback.play({ from?, rate? })', doc: 'Plays the Program monitor (from a time, at a shuttle rate: 1, 2, 4, 8, or negative for reverse).' },
      { method: 'playback.pause', usage: 'await bhippi.playback.pause()', doc: 'Stops playback where it is.' },
      { method: 'playback.toggle', usage: 'await bhippi.playback.toggle()', doc: 'Play / pause.' },
    ],
  },
  {
    title: 'Audio data',
    entries: [
      {
        method: 'audio.analyze',
        usage: 'await bhippi.audio.analyze({ compId?, from, to, fps?, bands? })',
        doc: 'The edit\'s mixed sound as frames, exactly what a generator\'s info.audio holds: { compId, fps, from, frames: [{ rms, peak, bands, smooth, waveform, loading }] }. fps default 30 (up to 120), bands default 32 (8–256), at most 36,000 frames a call. For beat-synced edits, meters and analysis panels.',
      },
      {
        method: 'audio.peaks',
        usage: 'await bhippi.audio.peaks(assetId, { from?, to? })',
        doc: 'The file\'s waveform (the timeline\'s own): { perSecond: 100, from, peak: number[], rms: number[] }, each 0–1 of full scale, 100 values a second of source. from/to are seconds in the file. Rejects for media without sound.',
      },
      {
        method: 'audio.loudness',
        usage: 'await bhippi.audio.loudness(assetId, { from?, to? })',
        doc: 'EBU R128 loudness of a range of the file: { integrated (LUFS), range (LU), truePeak (dBTP) }.',
      },
    ],
  },
  {
    title: 'Pictures and files',
    entries: [
      {
        method: 'video.frame',
        usage: 'await bhippi.video.frame({ time?, compId?, assetId?, size? })',
        doc: 'A picture as the export draws it (graphics and titles included): { image: "data:image/png;base64,…", time, compId }. Default: the active comp at the playhead, 540 px on the short side (size 64–2160). With assetId it is that file\'s own picture at `time` seconds into it. Draw it with an <img> or createImageBitmap(await (await fetch(image)).blob()) to read pixels. A render takes a moment: don\'t call it every frame.',
      },
      {
        method: 'media.read',
        usage: 'await bhippi.media.read(assetId)',
        doc: 'The bytes of one of the project\'s media files: { name, kind, bytes: ArrayBuffer } (up to 256 MB). Decode sound with new AudioContext().decodeAudioData(bytes) or an OfflineAudioContext; this is how a plugin analyses audio itself.',
      },
    ],
  },
  {
    title: 'Other plugins',
    intro: 'Plugins work together through the actions they expose (bhippi.expose): one plugin can transcribe, another score, a third place sounds. Each action runs in its own plugin, under that plugin\'s permissions.',
    entries: [
      { method: 'plugins.list', usage: 'await bhippi.plugins.list()', doc: 'The running plugins and what they offer: [{ id, name, actions: [{ name, description, params }], generators: [{ name, label }] }].' },
      { method: 'plugins.call', service: 'plugins', usage: 'await bhippi.plugins.call(pluginId, action, args)', doc: 'Runs another plugin\'s exposed action and resolves with what it returns. That plugin must be running (a panel, or background: true); it has 2 minutes. 120 calls a minute, shared with bhippi.tool.' },
    ],
  },
  {
    title: 'Menu entries',
    intro: 'While the plugin runs (a panel, or background: true), it can add entries to Bhippi\'s right-click menus, under Plugins. This is how a plugin works on what the user points at.',
    entries: [
      {
        method: 'menu.add',
        usage: "await bhippi.menu.add({ id, label, where: 'clip' | 'timeline' | 'media' | [...] }, fn)",
        doc: "fn runs when the entry is chosen, with what was right-clicked: clip → { clipIds, compId, time }; timeline (empty space) → { compId, trackId, time }; media (the Project panel) → { ids }. At most 12 entries; the menu shows them as \"<plugin name>: <label>\".",
      },
      { method: 'menu.remove', usage: 'await bhippi.menu.remove(id)', doc: 'Takes an entry away.' },
    ],
  },
  {
    title: 'Batched edits',
    entries: [
      {
        method: 'batch',
        usage: 'await bhippi.batch([{ tool, args }, …], { label? })',
        doc: 'Runs the tools in order as ONE undo step (named label, or the plugin\'s name). Each tool needs the same permission as with bhippi.tool(). Stops at the first failure and rejects with its reason; the steps before it stay, and one Undo takes them back. Resolves with { results: [each tool\'s result] }. At most 100 steps.',
      },
    ],
  },
  {
    title: 'Jobs (long work with a progress bar)',
    entries: [
      { method: 'jobs.start', usage: 'const job = await bhippi.jobs.start(label, { cancellable? })', doc: 'Shows a job in Bhippi\'s job list. job.progress(0..1, message?) updates it; job.done(message?) or job.fail(error) ends it; job.onCancel(fn) runs when the user stops it (cancellable only). A job still running when the plugin closes ends as failed.' },
      { method: 'jobs.update', usage: '(through the job handle)', doc: 'job.progress / job.done / job.fail.' },
    ],
  },
];

/** Every SDK method in the registry. */
export const SDK_METHODS = SDK_AREAS.flatMap((area) => area.entries);

/** The service a bridge method needs, if any. */
export const serviceFor = (method: string): PluginService | undefined => SDK_METHODS.find((entry) => entry.method === method)?.service;

/** The registry as reference text: a section of the SDK reference (brief.ts). */
export function servicesReference(): string {
  const lines: string[] = ['## Bhippi services', ''];
  lines.push('Beyond the tools, a plugin reaches Bhippi\'s own services directly. Calls marked with a service need it in the manifest: `"permissions": { "services": ["transcribe", "ai"] }`.');
  for (const area of SDK_AREAS) {
    lines.push('', `### ${area.title}`);
    if (area.intro) lines.push(area.intro);
    for (const entry of area.entries) {
      if (entry.usage.startsWith('(')) continue;
      lines.push(`- \`${entry.usage}\`${entry.service ? ` [service: ${entry.service}]` : ''} — ${entry.doc}`);
    }
  }
  lines.push('', 'During plugin_test, ai.ask and new transcriptions are not run (they reject with a "[test]" reason) and jobs only log: `bhippi.testing` is true then, so a check can skip what needs them.');
  return lines.join('\n');
}
