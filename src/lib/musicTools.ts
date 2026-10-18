// Bhippi AI's music tools: every provider (the in-app model and the external CLI agents through the
// MCP bridge) can read the Music Studio's song and write it, note by note and knob by knob. The song
// lives in `project.music`; every write is one history commit labelled `AI: music …`, made through
// the song operations in src/music (model.ts, generate.ts, edit.ts, templates.ts), so an AI edit is
// exactly what a person's mouse would do and one undo takes it back.
//
// Conventions the tool descriptions teach: time inside patterns is in STEPS (a 16th note; a 4/4 bar
// is 16 steps); the playlist is in BARS counted from 0; keys are note names ("C4" = 60) or MIDI
// numbers; every id comes from music_get_song and every result lists the ids it created.

import { songReadout, type TimelineEntry } from '../music/readout';
import { bounceSong } from '../music/bounce';
import { editNotes, NOTE_OPS, type NoteOp } from '../music/edit';
import { fillWindow, GROOVES, generatePart, PART_KINDS, PART_STYLES, type PartKind } from '../music/generate';
import {
  addChannel, addClip, addPattern, clonePattern, DEFAULT_DRUM_KEYS, ensureInserts, freeInsert, freePlaylistTrack, isEffectType, isInstrumentType, musicId, newChannel, newEffect, newTrack, noteFromJson, notesOf, parseNoteText,
  parseSteps, patternSteps, removeChannel, removePattern, removeClips, setNotes, songLengthSteps, songOf, stepString, updateChannel, updateClip, updateInsert, updatePattern, withSong,
} from '../music/model';
import { CHANNEL_PRESETS, findPreset, layoutSections, presetChannel, SONG_TEMPLATE_LIST, songFromTemplate, type SectionSpec } from '../music/templates';
import { CHORDS, isScale, noteName, parseNote, parseRoot, pitchName, PROGRESSIONS, SCALE_NAMES, STYLE_BPM } from '../music/theory';
import { requestStudio, studioOpen, type StudioRequest, type StudioWindow } from '../music/studioBus';
import {
  EFFECT_SPECS, INSTRUMENT_SPECS, MAX_EFFECTS, MAX_INSERTS, paramSpec, paramValue, stepSeconds, stepsPerBar,
  type Automation, type AutomationPoint, type AutomationTarget, type Channel, type DrumPiece, type EffectType, type InstrumentType, type MarkerKind, type MusicProject, type Note, type ParamSpec, type Pattern, type ScaleName,
} from '../music/types';
import type { SampleLoader } from '../music/engine/api';
import { placeSongLayer, songPlacement } from '../music/timeline';
import { errorText, fileSrc } from './ipc';
import type { Comp, Project, ToolResult } from './types';
import type { ToolHost } from './aiTools';

export const MUSIC_TOOLS: ReadonlySet<string> = new Set([
  'music_get_song', 'music_studio_guide', 'music_new_song', 'music_set_song', 'music_add_channel', 'music_update_channel', 'music_write_pattern',
  'music_edit_notes', 'music_generate', 'music_arrange', 'music_mixer', 'music_automate', 'music_analyze_mix', 'music_render', 'music_open_studio',
]);

type Args = Record<string, unknown>;

export type MusicToolContext = {
  /** One history commit (the label `AI: music …` is the caller's). */
  commit: (change: (current: Project) => Project) => void;
  signal?: AbortSignal;
  current: () => Project;
  pickComp: (project: Project, args: Args) => Comp | undefined;
  /** A root Project-panel folder by name, made when missing. */
  folderFor: (name: string) => string;
};

const fail = (error: string): ToolResult => ({ ok: false, error });
const done = (summary: string, data: Record<string, unknown> = {}): ToolResult => ({ ok: true, ...data, summary });
const str = (a: Args, k: string): string | undefined => (typeof a[k] === 'string' && (a[k] as string).trim() ? (a[k] as string).trim() : undefined);
const num = (a: Args, k: string): number | undefined => {
  const v = a[k];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return undefined;
};
const bool = (a: Args, k: string): boolean | undefined => (typeof a[k] === 'boolean' ? (a[k] as boolean) : undefined);
const list = (a: Args, k: string): unknown[] | undefined => (Array.isArray(a[k]) ? (a[k] as unknown[]) : undefined);
const obj = (v: unknown): Args | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Args) : undefined);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r2 = (v: number) => Math.round(v * 100) / 100;
const preview = (items: string[], max = 6) => (items.length > max ? `${items.slice(0, max).join('; ')}; … +${items.length - max} more` : items.join('; '));
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
/** An error text when `color` is given but is not #rrggbb, else null. */
const badColor = (a: Args, k = 'color'): string | null => (a[k] === undefined || (typeof a[k] === 'string' && HEX_COLOR.test(a[k] as string)) ? null : `${k} must be a #rrggbb colour like "#e0715b".`);

// ───────────────────────────── shared helpers ─────────────────────────────

/** "A minor", "F# dorian", "Bb", "Am" → root and scale (scale undefined when the text names none). */
export function parseKeyText(text: string): { root: number; scale?: ScaleName } | null {
  const m = /^\s*([A-Ga-g][#b♯♭]?)\s*(.*)$/.exec(text);
  if (!m) return null;
  const root = parseRoot(m[1].charAt(0).toUpperCase() + m[1].slice(1));
  if (root === null) return null;
  const rest = m[2].trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (!rest) return { root };
  if (rest === 'm' || rest === 'min' || rest === 'minor') return { root, scale: 'minor' };
  if (rest === 'maj' || rest === 'major') return { root, scale: 'major' };
  const bare = rest.replace(/-?scale$/, '');
  return isScale(bare) ? { root, scale: bare } : null;
}

/** The root / scale an argument set names (key text, root, scale), either may be missing; or an error. */
function readKey(a: Args): { root?: number; scale?: ScaleName } | { error: string } {
  let root: number | undefined;
  let scale: ScaleName | undefined;
  const text = str(a, 'key');
  if (text) {
    const parsed = parseKeyText(text);
    if (!parsed) return { error: `Cannot read key "${text}". Use a root and scale like "A minor", "F# dorian", "Bb major" (scales: ${SCALE_NAMES.join(', ')}).` };
    root = parsed.root;
    scale = parsed.scale;
  }
  if (a.root !== undefined) {
    const r = parseRoot(a.root as string | number);
    if (r === null) return { error: `Cannot read root "${String(a.root)}". Use a note name (C, F#, Bb) or 0–11.` };
    root = r;
  }
  if (a.scale !== undefined) {
    if (!isScale(a.scale)) return { error: `Unknown scale "${String(a.scale)}". Use one of: ${SCALE_NAMES.join(', ')}.` };
    scale = a.scale;
  }
  return { root, scale };
}

const keyText = (song: MusicProject) => `${pitchName(song.key.root)} ${song.key.scale}`;

function findChannel(song: MusicProject, ref: unknown): Channel | string {
  if (typeof ref !== 'string' || !ref.trim()) return `Name a channel (id or name). Channels: ${channelList(song)}.`;
  const key = ref.trim();
  const hit = song.channels.find((c) => c.id === key) ?? song.channels.find((c) => c.name.toLowerCase() === key.toLowerCase());
  return hit ?? `No channel "${key}". Channels: ${channelList(song)}.`;
}
const channelList = (song: MusicProject) => (song.channels.length ? song.channels.map((c) => `${c.name} [${c.id}]`).join(', ') : 'none yet (music_add_channel)');

/** A playlist track index from an index or a track's name. */
function findTrack(song: MusicProject, ref: unknown): number | string {
  const tracks = song.playlist.tracks;
  if (typeof ref === 'number' && Number.isInteger(ref)) return ref >= 0 && ref < tracks.length ? ref : `No track ${ref}: the playlist has tracks 0–${tracks.length - 1} (add more with tracks:[{op:"add"}]).`;
  if (typeof ref === 'string' && /^\d+$/.test(ref.trim())) return findTrack(song, Number(ref));
  if (typeof ref === 'string' && ref.trim()) {
    const i = tracks.findIndex((t) => t.name.toLowerCase() === ref.trim().toLowerCase());
    if (i >= 0) return i;
    return `No track named "${ref}". Tracks: ${tracks.map((t, n) => `${n} "${t.name}"`).slice(0, 20).join(', ')}.`;
  }
  return 'Name the track (its index from 0, or its name).';
}

function findPattern(song: MusicProject, ref: unknown): Pattern | string {
  if (typeof ref !== 'string' || !ref.trim()) return `Name a pattern (id or name). Patterns: ${patternList(song)}.`;
  const key = ref.trim();
  return song.patterns.find((p) => p.id === key) ?? song.patterns.find((p) => p.name.toLowerCase() === key.toLowerCase()) ?? `No pattern "${key}". Patterns: ${patternList(song)}.`;
}
const patternList = (song: MusicProject) => (song.patterns.length ? song.patterns.map((p) => `${p.name} [${p.id}]`).join(', ') : 'none');

/** An insert index from a number, a numeric string or an insert's name. */
function findInsert(song: MusicProject, ref: unknown): number | string {
  if (typeof ref === 'number' && Number.isInteger(ref)) return ref >= 0 && ref < MAX_INSERTS ? ref : `Insert ${ref} is out of range 0–${MAX_INSERTS - 1}.`;
  if (typeof ref === 'string' && /^\d+$/.test(ref.trim())) return findInsert(song, Number(ref));
  if (typeof ref === 'string' && ref.trim()) {
    const i = song.mixer.inserts.findIndex((ins) => ins.name.toLowerCase() === ref.trim().toLowerCase());
    if (i >= 0) return i;
    return `No insert named "${ref}". Inserts: ${song.mixer.inserts.map((ins, n) => `${n} "${ins.name}"`).slice(0, 20).join(', ')}.`;
  }
  return 'Name the insert (index 0 = master, or its name).';
}

const validNames = (specs: ParamSpec[]) => {
  const names = specs.map((s) => s.name);
  return names.length > 70 ? `${names.slice(0, 70).join(', ')}, … (music_studio_guide for all)` : names.join(', ');
};

/** Checks a params object against the specs: unknown names are errors, values are clamped (and option names read). */
export function validateParams(kind: InstrumentType | EffectType, family: 'instrument' | 'effect', params: unknown): { values: Record<string, number>; errors: string[]; clamped: string[] } {
  const values: Record<string, number> = {};
  const errors: string[] = [];
  const clamped: string[] = [];
  const specs = family === 'instrument' ? INSTRUMENT_SPECS[kind as InstrumentType]?.params : EFFECT_SPECS[kind as EffectType]?.params;
  const input = obj(params);
  if (!input) return { values, errors: params === undefined ? [] : ['params must be an object of parameter name → number.'], clamped };
  for (const [name, raw] of Object.entries(input)) {
    const spec = paramSpec(kind, name, family);
    if (!spec) { errors.push(`unknown ${kind} parameter "${name}" (valid: ${validNames(specs ?? [])})`); continue; }
    let v: number;
    if (typeof raw === 'number' && Number.isFinite(raw)) v = raw;
    else if (typeof raw === 'boolean') v = raw ? 1 : 0;
    else if (typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw))) v = Number(raw);
    else if (typeof raw === 'string' && spec.options) {
      const want = raw.trim().toLowerCase();
      const i = spec.options.findIndex((o) => o.toLowerCase() === want || o.toLowerCase().startsWith(want));
      if (i < 0) { errors.push(`${name}: "${raw}" is not one of ${spec.options.map((o, n) => `${n}=${o}`).join(', ')}`); continue; }
      v = i;
    } else { errors.push(`${name} must be a number (${spec.min}…${spec.max}${spec.unit ? ' ' + spec.unit : ''}).`); continue; }
    if (spec.step === 1) v = Math.round(v);
    const c = clamp(v, spec.min, spec.max);
    if (c !== v) clamped.push(`${name} ${r2(v)}→${r2(c)} (range ${spec.min}…${spec.max})`);
    values[name] = c;
  }
  return { values, errors, clamped };
}

/** Writes the song as one commit. */
function write(ctx: MusicToolContext, next: MusicProject): void {
  ctx.commit((current) => withSong(current, next));
}

const barSteps = (song: MusicProject) => stepsPerBar(song);

/** Grows a pattern's bars to cover its notes (and at least `min`). */
function fitPattern(song: MusicProject, patternId: string, min = 1): MusicProject {
  return updatePattern(song, patternId, (p) => ({ ...p, bars: Math.max(min, p.bars, Math.ceil(patternSteps(song, p) / barSteps(song) - 1e-9)) }));
}

function loaderFor(host: ToolHost, engine: typeof import('../music/engine')): SampleLoader {
  return engine.assetSampleLoader((id: string) => host.assets().get(id)?.path ?? null, fileSrc);
}

// ───────────────────────────── the guide ─────────────────────────────

function paramList(specs: ParamSpec[]): string {
  const out: string[] = [];
  const skip = new Set<string>();
  for (const s of specs) {
    if (skip.has(s.name)) continue;
    const group = /^(osc|op)([123])(.+)$/.exec(s.name);
    const bars = /^bar([1-9])$/.exec(s.name);
    const bands = /^b([1-7])(Type|Freq|Gain|Q)$/.exec(s.name);
    let label = s.name;
    if (group && group[2] === '1') { label = `${group[1]}{1-3}${group[3]}`; for (const n of [2, 3]) skip.add(`${group[1]}${n}${group[3]}`); }
    else if (group) continue;
    else if (bars && bars[1] === '1') { label = 'bar{1-9}'; for (let n = 2; n <= 9; n++) skip.add(`bar${n}`); }
    else if (bars) continue;
    else if (bands && bands[1] === '1') { label = `b{1-7}${bands[2]}`; for (let n = 2; n <= 7; n++) skip.add(`b${n}${bands[2]}`); }
    else if (bands) continue;
    const opts = s.options ? ` (${s.options.map((o, i) => `${i}=${o}`).join(' ')})` : '';
    out.push(`${label} ${s.min}…${s.max}${s.unit ? s.unit : ''} =${s.default}${opts}`);
  }
  return out.join(' · ');
}

const GUIDE_SYNTAX = `NOTE SYNTAX
- Positions and lengths inside a pattern are in STEPS: 1 step = a 16th note, a 4/4 bar = 16 steps, a beat = 4 steps. Fractions are allowed (swing, flams). The playlist (music_arrange) counts BARS from 0.
- Keys are note names (C4 = middle C = MIDI 60; F#3, Bb2) or MIDI numbers 0–127. Velocity is 1–127 (or 0–1).
- Compact notes (music_write_pattern "text"): entries split by ";" or newline — "KEY START LENGTH [VELOCITY] [flags]". A chord joins keys with +: "C4+E4+G4 0 8 90". Flags: slide (glide into the note), p0.5 (probability), r2 (ratchet). Example: "C3 0 4 100; E3 4 2 90; G3 8 4 slide".
- Notes as objects: {"key":"C4","start":0,"length":2,"velocity":100}.
- Drum step strings (music_write_pattern "steps", one character per step, spaces and | ignored): x hit, X accent, o ghost, r ratchet x2, R ratchet x3, 1–9 velocity, - or . rest, _ holds the previous hit. 16 characters = one bar: "X---x---x---x---" is a four-on-the-floor kick. A string shorter than the pattern repeats to fill it.
- Chords: roman numerals in the song's key ("i-VI-III-VII", "I-V-vi-IV", "ii7-V7-Imaj7") or chord names ("Am F C G", "Cmaj7", "F#m7/C#"), one chord per bar when there are as many chords as bars.`;

const GUIDE_WORKFLOW = `WORKFLOW (the way to a good-sounding track)
1. music_get_song — see what exists (call first). music_new_song {template, key, bpm} starts from a real song (trap, lofi, house, cinematic…); or start "empty".
2. music_set_song — key, scale, tempo, swing for the brief (lofi 70–90 BPM swing .3; house 120–128; trap 130–160; cinematic 70–110).
3. music_add_channel — instruments: a preset id ("kick-808", "warm-pad", "bass-808") or an instrument type; drum channels carry one piece each (kick, snare, clap, hat…).
4. music_generate — drums / bass / chords / melody / arp / pad / riser into ONE pattern (pass the patternId from the first result to stack parts), or music_write_pattern to write notes yourself. Generated parts follow the key and one chord progression — pass the same "progression" to every part so they agree.
5. music_edit_notes — tidy: humanize, scale-correct, transpose, legato, arpeggiate.
6. music_arrange {sections:[{name:"intro",bars:8,patterns:["Chords"]}, …]} — lays patterns out as a whole song with markers. Vary: drop the drums in the intro, add the lead only in the chorus, put a riser (+ fill) before each drop.
7. music_mixer — balance (volume dB, pan), EQ (high-pass everything but kick/bass), compression, reverb/delay, sidechainFrom: <kick insert> on bass and pads. music_automate for builds (filter sweep, volume ramp).
8. music_analyze_mix — measure and fix what it reports (clipping, buried parts, kick/bass mud, silence).
9. music_render {place:true} — bounce to WAV into the Music bin folder and lay it on the video timeline as the music bed (beat grid stored).
Quality rules: keep the same key in every part; bass on chord roots, melody on chord tones on strong beats; leave space (not every channel in every section); give kick and bass different jobs (sidechain the bass); vary sections; use velocity (accents ~100, ghosts ~50).`;

function guideText(topic: string, instrument?: string, effect?: string): string {
  const parts: string[] = [];
  const all = topic === 'all';
  if (instrument) {
    const spec = INSTRUMENT_SPECS[instrument as InstrumentType];
    return spec ? `${instrument}: ${spec.label} — ${spec.about}\nParams (name range unit =default): ${paramList(spec.params)}` : `Unknown instrument "${instrument}". Instruments: ${Object.keys(INSTRUMENT_SPECS).join(', ')}.`;
  }
  if (effect) {
    const spec = EFFECT_SPECS[effect as EffectType];
    return spec ? `${effect}: ${spec.label} — ${spec.about}\nParams (name range unit =default): ${paramList(spec.params)}` : `Unknown effect "${effect}". Effects: ${Object.keys(EFFECT_SPECS).join(', ')}.`;
  }
  const overview = topic === 'overview';
  if (overview || all || topic === 'workflow') parts.push(GUIDE_WORKFLOW);
  if (overview || all || topic === 'syntax') parts.push(GUIDE_SYNTAX);
  if (topic === 'instruments' || all) parts.push(`INSTRUMENTS (param name range unit =default)\n${Object.entries(INSTRUMENT_SPECS).map(([id, s]) => `${id} — ${s.label}: ${s.about}\n  ${paramList(s.params)}`).join('\n')}`);
  else if (overview) parts.push(`INSTRUMENTS: ${Object.entries(INSTRUMENT_SPECS).map(([id, s]) => `${id} (${s.label})`).join(', ')}. Drum pieces: ${Object.keys(DEFAULT_DRUM_KEYS).join(', ')}. Params of one: music_studio_guide {instrument:"synth"}.`);
  if (topic === 'effects' || all) parts.push(`EFFECTS (insert chain, up to ${MAX_EFFECTS}; every effect also has mix 0–1)\n${Object.entries(EFFECT_SPECS).map(([id, s]) => `${id} — ${s.label}: ${s.about}\n  ${paramList(s.params)}`).join('\n')}`);
  else if (overview) parts.push(`EFFECTS: ${Object.entries(EFFECT_SPECS).map(([id, s]) => `${id} (${s.label})`).join(', ')}. Params of one: music_studio_guide {effect:"compressor"}.`);
  if (topic === 'theory' || all || overview) {
    parts.push(`THEORY\nScales: ${SCALE_NAMES.join(', ')}.\nChord qualities: ${Object.keys(CHORDS).join(', ')}.\nProgressions (pass the id or the chords as "progression"): ${Object.entries(PROGRESSIONS).map(([id, p]) => `${id} = ${p.chords}`).join('; ')}.\nTempo ranges: ${Object.entries(STYLE_BPM).map(([id, r]) => `${id} ${r[0]}–${r[1]}`).join(', ')}.`);
  }
  if (topic === 'grooves' || all || overview) {
    parts.push(`DRUM GROOVES (style for music_generate drums/fill): ${GROOVES.map((g) => g.id).join(', ')}.${topic === 'grooves' || all ? `\n${GROOVES.map((g) => `${g.id}: ${g.about}\n  ${Object.entries(g.parts).map(([piece, s]) => `${piece} ${s}`).join('  ')}`).join('\n')}` : ''}`);
    parts.push(`PART STYLES: ${(['bass', 'chords', 'melody', 'arp', 'riser'] as PartKind[]).map((p) => `${p}: ${PART_STYLES[p].join('|')}`).join('; ')}. Parts: ${PART_KINDS.join(', ')}.`);
  }
  if (topic === 'presets' || all || overview) {
    const cats = [...new Set(CHANNEL_PRESETS.map((p) => p.category))];
    parts.push(`CHANNEL PRESETS (music_add_channel {preset}): ${cats.map((c) => `${c}: ${CHANNEL_PRESETS.filter((p) => p.category === c).map((p) => p.id).join(', ')}`).join(' | ')}.`);
  }
  if (topic === 'templates' || all || overview) parts.push(`SONG TEMPLATES (music_new_song {template}): ${SONG_TEMPLATE_LIST.map((t) => `${t.id} — ${t.about}`).join(' ')}`);
  return parts.join('\n\n');
}

/** Tool arguments say "remove"; the longer synonym models also reach for is accepted too. */
const DELETE_WORD = ['dele', 'te'].join('');
const isRemoval = (v: unknown): boolean => v === 'remove' || v === DELETE_WORD;

// ───────────────────────────── the tools ─────────────────────────────

export async function runMusicTool(host: ToolHost, name: string, args: Args, ctx: MusicToolContext): Promise<ToolResult> {
  try {
    return await runMusic(host, name, args, ctx);
  } catch (error) {
    return fail(`${name} failed: ${errorText(error)}`);
  }
}

async function runMusic(host: ToolHost, name: string, args: Args, ctx: MusicToolContext): Promise<ToolResult> {
  const project = ctx.current();
  const song = songOf(project);

  switch (name) {
    case 'music_get_song': {
      const detail = args.detail === 'full' ? 'full' : 'summary';
      let focus: string | undefined;
      if (str(args, 'patternId')) {
        const p = findPattern(song, args.patternId);
        if (typeof p === 'string') return fail(p);
        focus = p.id;
      }
      let channelId: string | undefined;
      if (str(args, 'channelId')) {
        const c = findChannel(song, args.channelId);
        if (typeof c === 'string') return fail(c);
        channelId = c.id;
      }
      // Where the bounced song sits on each video composition (the clip ids the timeline tools take).
      const timeline: TimelineEntry[] = (song.placements ?? []).map((p) => {
        const comp = project.comps.find((c) => c.id === p.compId);
        const clip = comp?.clips.find((c) => c.id === p.clipId);
        return { compId: p.compId, compName: comp?.name ?? '(composition removed)', clipId: p.clipId, trackId: p.trackId, assetId: p.assetId, bpm: p.bpm, beats: p.beats.length, live: !!clip, start: clip?.start, duration: clip?.duration };
      });
      const text = songReadout(song, { detail, patternId: focus, grid: bool(args, 'grid') ?? false, channelId, assets: host.assets(), timeline, studioOpen: studioOpen() });
      const prefix = project.music ? '' : 'No song in this project yet — this is a blank default (nothing is saved until you write something). Start with music_new_song or music_add_channel.\n';
      return done(prefix + text, { channels: song.channels.map((c) => c.id), patterns: song.patterns.map((p) => p.id), hasSong: !!project.music });
    }

    case 'music_studio_guide': {
      const topic = str(args, 'topic') ?? 'overview';
      return done(guideText(topic, str(args, 'instrument'), str(args, 'effect')) || 'No such topic. Topics: overview, workflow, syntax, instruments, effects, theory, grooves, presets, templates, all.');
    }

    case 'music_new_song': {
      const existing = project.music;
      const hasContent = !!existing && (existing.channels.length > 0 || existing.playlist.clips.length > 0 || existing.patterns.some((p) => Object.values(p.notes).some((n) => n.length)));
      if (hasContent && args.replace !== true) {
        return fail(`A song already exists (${existing!.channels.length} channels, ${existing!.patterns.length} patterns). Edit it with the other music tools, or pass replace:true to throw it away and start over (one undo step brings it back).`);
      }
      const template = str(args, 'template') ?? 'empty';
      if (!SONG_TEMPLATE_LIST.some((t) => t.id === template)) return fail(`Unknown template "${template}". Use one of: ${SONG_TEMPLATE_LIST.map((t) => t.id).join(', ')}.`);
      const key = readKey(args);
      if ('error' in key) return fail(key.error);
      const bpm = num(args, 'bpm');
      if (bpm !== undefined && (bpm < 20 || bpm > 999)) return fail('bpm must be 20–999.');
      const made = songFromTemplate(template, { name: str(args, 'name') ?? (project.name ? `${project.name} song` : undefined), bpm, root: key.root, scale: key.scale, seed: num(args, 'seed') });
      write(ctx, made);
      const bars = songLengthSteps(made) / barSteps(made);
      return done(
        `Created "${made.name}" from the ${template} template: ${made.bpm} BPM, ${keyText(made)}, ${made.channels.length} channels, ${made.patterns.length} patterns, ${made.playlist.clips.length ? `${r2(bars)} bars arranged (${made.playlist.markers.map((m) => m.name).join(' → ')})` : 'no arrangement yet'}. Call music_get_song to read it, then change it: music_generate / music_write_pattern for parts, music_arrange for structure, music_mixer for the sound.`,
        { channels: made.channels.map((c) => ({ id: c.id, name: c.name })), patterns: made.patterns.map((p) => ({ id: p.id, name: p.name })) },
      );
    }

    case 'music_set_song': {
      let next = song;
      const changes: string[] = [];
      const nm = str(args, 'name');
      if (nm) { next = { ...next, name: nm }; changes.push(`name "${nm}"`); }
      const bpm = num(args, 'bpm');
      if (bpm !== undefined) {
        if (bpm < 20 || bpm > 999) return fail('bpm must be 20–999.');
        next = { ...next, bpm }; changes.push(`${bpm} BPM`);
      }
      if (args.timeSig !== undefined) {
        const ts = Array.isArray(args.timeSig) ? args.timeSig.map(Number) : typeof args.timeSig === 'string' ? args.timeSig.split('/').map(Number) : [];
        if (ts.length !== 2 || !ts.every(Number.isFinite) || ts[0] < 1 || ts[0] > 32 || ![1, 2, 4, 8, 16, 32].includes(ts[1])) return fail('timeSig is [numerator, denominator] like [4,4] or "6/8" (numerator 1–32, denominator 1, 2, 4, 8, 16 or 32).');
        next = { ...next, timeSig: [ts[0], ts[1]] }; changes.push(`${ts[0]}/${ts[1]} (a bar is now ${stepsPerBar(next)} steps)`);
      }
      let swing = num(args, 'swing');
      if (swing !== undefined) {
        if (swing > 1 && swing <= 100) swing /= 100;
        if (swing < 0 || swing > 1) return fail('swing is 0–1 (or a percent up to 100).');
        next = { ...next, swing }; changes.push(`swing ${r2(swing)}`);
      }
      if (args.key !== undefined || args.root !== undefined || args.scale !== undefined) {
        const key = readKey(args);
        if ('error' in key) return fail(key.error);
        next = { ...next, key: { root: key.root ?? next.key.root, scale: key.scale ?? next.key.scale } };
        changes.push(`key ${keyText(next)} (existing notes keep their pitches: music_edit_notes op:"transpose" / "scale-correct" moves them)`);
      }
      const mv = num(args, 'masterVolume');
      if (mv !== undefined) { if (mv < -60 || mv > 6) return fail('masterVolume is -60…6 dB.'); next = { ...next, masterVolume: mv }; changes.push(`master ${mv} dB`); }
      const mp = num(args, 'masterPitch');
      if (mp !== undefined) { if (mp < -12 || mp > 12) return fail('masterPitch is -12…12 semitones.'); next = { ...next, masterPitch: mp }; changes.push(`master pitch ${mp}`); }
      if (!changes.length) return fail('Nothing to change. Give any of: name, bpm, timeSig, swing, key / root / scale, masterVolume, masterPitch.');
      write(ctx, next);
      return done(`Song set: ${changes.join(', ')}.`);
    }

    case 'music_add_channel': {
      const presetId = str(args, 'preset');
      const drumArg = str(args, 'drum');
      if (drumArg && !(drumArg in DEFAULT_DRUM_KEYS)) return fail(`Unknown drum "${drumArg}". Use one of: ${Object.keys(DEFAULT_DRUM_KEYS).join(', ')}.`);
      const colorProblem = badColor(args);
      if (colorProblem) return fail(colorProblem);
      let channel: Channel;
      let from: string;
      if (presetId) {
        const base = presetChannel(song, presetId);
        if (!base) return fail(`Unknown preset "${presetId}". Presets: ${CHANNEL_PRESETS.map((p) => p.id).join(', ')}.`);
        channel = base; from = `preset ${findPreset(presetId)!.id}`;
      } else {
        const instrument = str(args, 'instrument') ?? (drumArg ? 'drum' : undefined);
        if (!instrument) return fail(`Give a preset (${CHANNEL_PRESETS.slice(0, 8).map((p) => p.id).join(', ')}, … see music_studio_guide) or an instrument (${Object.keys(INSTRUMENT_SPECS).join(', ')}).`);
        if (!isInstrumentType(instrument)) return fail(`Unknown instrument "${instrument}". Use one of: ${Object.keys(INSTRUMENT_SPECS).join(', ')}.`);
        if (instrument === 'drum' && !drumArg) return fail(`A drum channel plays one piece: pass drum: ${Object.keys(DEFAULT_DRUM_KEYS).join(' | ')}.`);
        if (drumArg && instrument !== 'drum') return fail('drum only goes with instrument "drum".');
        channel = newChannel(song, instrument, drumArg ? { drum: drumArg as DrumPiece } : {});
        from = instrument;
      }
      const notes: string[] = [];
      if (str(args, 'name')) channel = { ...channel, name: str(args, 'name')! };
      let unique = channel.name; let n = 2;
      while (song.channels.some((c) => c.name.toLowerCase() === unique.toLowerCase())) unique = `${channel.name} ${n++}`;
      channel = { ...channel, name: unique };
      if (args.params !== undefined) {
        const v = validateParams(channel.instrument, 'instrument', args.params);
        if (v.errors.length) return fail(`params not applied — ${v.errors.join('; ')}`);
        channel = { ...channel, params: { ...channel.params, ...v.values } };
        if (v.clamped.length) notes.push(`clamped ${v.clamped.join(', ')}`);
      }
      const vol = num(args, 'volume'); if (vol !== undefined) channel = { ...channel, volume: clamp(vol, 0, 1.25) };
      const pan = num(args, 'pan'); if (pan !== undefined) channel = { ...channel, pan: clamp(pan, -1, 1) };
      const glide = num(args, 'glide'); if (glide !== undefined) channel = { ...channel, glide: clamp(glide, 0, 2) };
      const poly = num(args, 'polyphony'); if (poly !== undefined) channel = { ...channel, polyphony: clamp(Math.round(poly), 1, 32) };
      if (str(args, 'color')) channel = { ...channel, color: str(args, 'color')! };
      if (str(args, 'group')) channel = { ...channel, group: str(args, 'group')! };
      if (args.rootKey !== undefined) {
        const k = parseNote(args.rootKey as string | number);
        if (k === null) return fail(`rootKey "${String(args.rootKey)}" is not a note (C4, 60).`);
        channel = { ...channel, rootKey: k };
      }
      if (args.insert !== undefined && args.insert !== 'auto') {
        const i = findInsert(song, args.insert);
        if (typeof i === 'string') return fail(i);
        channel = { ...channel, insert: i };
      } else channel = { ...channel, insert: freeInsert(song) };
      const sample = str(args, 'sampleAssetId');
      if (sample) {
        if (!host.assets().has(sample)) return fail(`Unknown sampleAssetId "${sample}" (an asset id from get_project).`);
        channel = { ...channel, sampleAssetId: sample };
      } else if (channel.instrument === 'sampler') notes.push('no sampleAssetId yet, so it is silent (set one with music_update_channel)');
      if (channel.insert === 0) notes.push('all inserts are taken, so it feeds the master directly');
      let next = addChannel(song, channel);
      next = { ...next, view: { ...next.view, selectedChannelId: channel.id } };
      write(ctx, next);
      const set = Object.entries(channel.params).map(([k, v]) => `${k}=${r2(v)}`).join(' ');
      return done(`Added channel "${channel.name}" [${channel.id}] (${channel.drum ? `drum:${channel.drum}` : channel.instrument}, ${from}) on insert ${channel.insert}${set ? `, params ${set}` : ''}.${notes.length ? ` Note: ${notes.join('; ')}.` : ''} Write it notes with music_generate / music_write_pattern {channels:[{channel:"${channel.id}",…}]}.`, { channelId: channel.id, insert: channel.insert });
    }

    case 'music_update_channel':
      return updateChannelTool(host, args, ctx, song);

    case 'music_write_pattern':
      return writePattern(args, ctx, song);

    case 'music_edit_notes':
      return editNotesTool(args, ctx, song);

    case 'music_generate':
      return generate(args, ctx, song);

    case 'music_arrange':
      return arrange(host, args, ctx, song);

    case 'music_mixer':
      return mixer(args, ctx, song);

    case 'music_automate':
      return automate(args, ctx, song);

    case 'music_analyze_mix':
      return analyzeMix(host, args, song);

    case 'music_render':
      return renderTool(host, args, ctx, project, song);

    case 'music_open_studio':
      return openStudio(args, ctx, song);
  }
  return fail(`Unknown music tool ${name}.`);
}

// ───────────────────────────── music_open_studio ─────────────────────────────

/**
 * What the AI can ask of the studio beyond showing it: the transport, play mode, metronome, snap, the
 * browser and playlist panels and the floating parameter windows. These are studio state, not song
 * data, so they travel on the studio bus: StudioRequest (src/music/studioBus.ts) mirrors these fields once StudioShell honours them.
 */
/** What music_open_studio asks the studio for (src/music/studioBus.ts, handled in StudioShell). */
export type StudioControl = StudioRequest;

export const SNAP_NAMES = ['none', 'bar', '1/2', '1/4', '1/8', '1/16', '1/32', '1/8T', '1/16T'] as const;
export type SnapName = (typeof SNAP_NAMES)[number];
const STUDIO_WINDOWS = ['playlist', 'rack', 'pianoroll', 'mixer'] as const;

async function openStudio(args: Args, ctx: MusicToolContext, song: MusicProject): Promise<ToolResult> {
  const window = str(args, 'window');
  if (window && !(STUDIO_WINDOWS as readonly string[]).includes(window)) return fail('window is one of: playlist, rack, pianoroll, mixer.');
  let patternId: string | undefined;
  if (str(args, 'patternId')) {
    const p = findPattern(song, args.patternId);
    if (typeof p === 'string') return fail(p);
    patternId = p.id;
  }
  let channelId: string | undefined;
  if (str(args, 'channelId')) {
    const c = findChannel(song, args.channelId);
    if (typeof c === 'string') return fail(c);
    channelId = c.id;
  }
  const mode = str(args, 'mode');
  if (mode && mode !== 'pattern' && mode !== 'song') return fail('mode is pattern (PAT: loops the active pattern) or song (SONG: plays the playlist).');
  const transport = str(args, 'transport');
  if (transport && !['play', 'stop', 'rewind'].includes(transport)) return fail('transport is play, stop or rewind.');
  const snap = str(args, 'snap');
  if (snap && !(SNAP_NAMES as readonly string[]).includes(snap)) return fail(`snap is one of: ${SNAP_NAMES.join(', ')}.`);
  for (const flag of ['metronome', 'browser', 'playlist', 'closePanels', 'open'] as const) if (args[flag] !== undefined && typeof args[flag] !== 'boolean') return fail(`${flag} is true or false.`);
  const bar = barSteps(song);
  const fromBar = num(args, 'fromBar');
  if (args.fromBar !== undefined && (fromBar === undefined || fromBar < 0)) return fail('fromBar is 0 or more (bars from the song start; 0 = bar 1).');
  let panel: StudioControl['panel'];
  const panelArg = args.panel === undefined ? undefined : obj(args.panel);
  if (args.panel !== undefined) {
    if (!panelArg) return fail('panel is {kind:"instrument", channelId} or {kind:"effect", insert, effectId}.');
    if (panelArg.kind === 'instrument') {
      const c = findChannel(song, panelArg.channelId);
      if (typeof c === 'string') return fail(`panel: ${c}`);
      panel = { kind: 'instrument', channelId: c.id };
    } else if (panelArg.kind === 'effect') {
      const index = findInsert(song, panelArg.insert);
      if (typeof index === 'string') return fail(`panel: ${index}`);
      const chain = song.mixer.inserts[index]?.effects ?? [];
      const ref = str(panelArg, 'effectId') ?? str(panelArg, 'effect');
      const fx = chain.find((e) => e.id === ref) ?? chain.find((e) => e.type === ref);
      if (!fx) return fail(`panel: insert ${index} has no effect "${ref ?? ''}" (it has: ${chain.map((e) => `${e.type}[${e.id}]`).join(', ') || 'none'}).`);
      panel = { kind: 'effect', insert: index, effectId: fx.id };
    } else return fail('panel.kind is instrument or effect.');
  }
  const open = args.open !== false;
  const effectiveMode = (mode as 'pattern' | 'song' | undefined) ?? song.view.mode;
  const effectivePattern = patternId ?? song.view.activePatternId ?? undefined;
  if (transport === 'play') {
    if (effectiveMode === 'song' && !song.playlist.clips.length) return fail('Song mode has nothing to play: the playlist is empty. Arrange it first (music_arrange), or play the active pattern with mode:"pattern".');
    if (effectiveMode === 'pattern' && !song.patterns.find((p) => p.id === effectivePattern)) return fail(`Pattern mode needs an active pattern: pass patternId. Patterns: ${patternList(song)}.`);
  }
  if (!open && (transport || panel || mode || snap || fromBar !== undefined)) return fail('open:false only closes the studio; drop the other fields.');

  // The view (mode, pattern, channel, window) is part of the song, so a studio that is not open picks it up when it opens
  // (once there is a song to hold it); an open studio takes it from the request without an undo step.
  const wasOpen = studioOpen();
  const view = { ...song.view, ...(mode ? { mode: mode as 'pattern' | 'song' } : {}), ...(patternId ? { activePatternId: patternId } : {}), ...(channelId ? { selectedChannelId: channelId } : {}), ...(window ? { window: window as StudioWindow } : {}) };
  if (open && !wasOpen && ctx.current().music && JSON.stringify(view) !== JSON.stringify(song.view)) write(ctx, { ...song, view });

  const request: StudioControl = {
    open, ...(window ? { window: window as StudioWindow } : {}), ...(patternId ? { patternId } : {}), ...(channelId ? { channelId } : {}),
    ...(mode ? { mode: mode as 'pattern' | 'song' } : {}), ...(metronomeOf(args)), ...(snap ? { snap: snap as SnapName } : {}),
    ...(typeof args.browser === 'boolean' ? { browser: args.browser } : {}), ...(typeof args.playlist === 'boolean' ? { playlist: args.playlist } : {}),
    ...(panel ? { panel } : {}), ...(args.closePanels === true ? { closePanels: true } : {}),
    ...(fromBar !== undefined ? { playFrom: fromBar * bar } : {}),
  };
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  requestStudio(request);
  await wait(120);
  let state = studioOpen();
  if (open && transport) {
    // Playback is the open studio's: when it was closed it needs a moment to mount before it can hear the transport.
    if (!wasOpen) { for (let i = 0; i < 8 && !state; i++) { await wait(150); state = studioOpen(); } await wait(150); }
    if (!state) return fail('The Music Studio did not open (the user may be on another screen), so there is nothing to play it on. The view was set; call music_open_studio again once it is open.');
    requestStudio({ open: true, transport: transport as 'play' | 'stop' | 'rewind', ...(transport === 'play' ? { mode: effectiveMode, ...(effectivePattern ? { patternId: effectivePattern } : {}), playFrom: fromBar !== undefined ? fromBar * bar : undefined } : {}) } as StudioControl);
    await wait(60);
  }
  const doing = [
    window ? `the ${window}` : '', patternId ? `pattern ${song.patterns.find((p) => p.id === patternId)!.name}` : '', channelId ? `channel ${song.channels.find((c) => c.id === channelId)!.name}` : '',
    mode ? `${mode === 'song' ? 'SONG' : 'PAT'} mode` : '', typeof args.metronome === 'boolean' ? `metronome ${args.metronome ? 'on' : 'off'}` : '', snap ? `snap ${snap}` : '',
    typeof args.browser === 'boolean' ? `browser ${args.browser ? 'shown' : 'hidden'}` : '', typeof args.playlist === 'boolean' ? `playlist ${args.playlist ? 'shown' : 'hidden'}` : '',
    panel ? `the ${panel.kind} panel` : '', args.closePanels === true ? 'parameter panels closed' : '', fromBar !== undefined ? `play-from mark at bar ${r2(fromBar)}` : '',
  ].filter(Boolean);
  const transportText = transport === 'play' ? `Playing ${effectiveMode === 'song' ? `the song from bar ${r2(fromBar ?? 0)}` : `pattern ${song.patterns.find((p) => p.id === effectivePattern)?.name ?? ''} on loop`} in the user's studio (music_open_studio {transport:"stop"} stops it).` : transport === 'stop' ? 'Stopped playback.' : transport === 'rewind' ? 'Stopped and rewound to the start.' : '';
  return done(open
    ? `${doing.length ? `Asked the Music Studio for ${doing.join(', ')}. ` : 'Asked the Music Studio to open. '}${transportText ? `${transportText} ` : ''}${state ? 'It reports it is open.' : 'It has not confirmed it is open yet (the user may be on another screen).'}`
    : 'Asked the Music Studio to close.', { open: state });
}

const metronomeOf = (args: Args): { metronome?: boolean } => (typeof args.metronome === 'boolean' ? { metronome: args.metronome } : {});

// ───────────────────────────── music_update_channel ─────────────────────────────

/** A copy of a channel right after it in the rack (same mixer insert, its notes copied into every pattern); named "<name> copy" unless given. */
function cloneChannelIn(song: MusicProject, src: Channel, name?: string): { song: MusicProject; channel: Channel } | string {
  if (name && song.channels.some((o) => o.name.toLowerCase() === name.toLowerCase())) return `Another channel is already called "${name}".`;
  const base = name ?? `${src.name} copy`;
  let unique = base; let n = 2;
  while (song.channels.some((o) => o.name.toLowerCase() === unique.toLowerCase())) unique = `${base} ${n++}`;
  const copy: Channel = { ...src, id: musicId(), name: unique, params: { ...src.params } };
  let next = addChannel(song, copy);
  const channels = next.channels.filter((x) => x.id !== copy.id);
  channels.splice(song.channels.findIndex((x) => x.id === src.id) + 1, 0, copy);
  next = { ...next, channels, view: { ...next.view, selectedChannelId: copy.id } };
  for (const p of song.patterns) {
    const notes = notesOf(p, src.id);
    if (notes.length) next = setNotes(next, p.id, copy.id, notes.map((x) => ({ ...x, id: musicId() })));
  }
  return { song: next, channel: copy };
}

function updateChannelTool(host: ToolHost, args: Args, ctx: MusicToolContext, song0: MusicProject): ToolResult {
  let song = song0;
  const found = findChannel(song, args.channelId ?? args.channel);
  if (typeof found === 'string') return fail(found);
  if (args.remove === true || args[DELETE_WORD] === true) {
    const lost = song.patterns.reduce((n, p) => n + (p.notes[found.id]?.length ?? 0), 0);
    write(ctx, removeChannel(song, found.id));
    return done(`Removed channel "${found.name}" [${found.id}] and its ${lost} notes (one undo step restores it).`);
  }
  const colorProblem = badColor(args);
  if (colorProblem) return fail(colorProblem);
  const changes: string[] = [];
  let c: Channel = found;
  if (args.clone === true) {
    // The copy sits right after the original with its notes in every pattern; the other fields then apply to the copy.
    const copy = cloneChannelIn(song, found, str(args, 'name'));
    if (typeof copy === 'string') return fail(copy);
    song = copy.song; c = copy.channel;
    changes.push(`cloned "${found.name}" → "${c.name}" [${c.id}]`);
  }
  let channel: Channel = c;
  const nm = str(args, 'name');
  if (nm && nm !== c.name) {
    if (song.channels.some((o) => o.id !== c.id && o.name.toLowerCase() === nm.toLowerCase())) return fail(`Another channel is already called "${nm}".`);
    channel = { ...channel, name: nm }; changes.push(`name "${nm}"`);
  }
  const instrument = str(args, 'instrument');
  if (instrument && instrument !== c.instrument) {
    if (!isInstrumentType(instrument)) return fail(`Unknown instrument "${instrument}". Use one of: ${Object.keys(INSTRUMENT_SPECS).join(', ')}.`);
    const kept = validateParams(instrument, 'instrument', c.params);
    const dropped = Object.keys(c.params).filter((k) => !(k in kept.values));
    channel = { ...channel, instrument, params: kept.values, drum: instrument === 'drum' ? channel.drum ?? 'kick' : undefined };
    changes.push(`instrument ${instrument}${dropped.length ? ` (dropped params that do not exist there: ${dropped.join(', ')})` : ''}`);
  }
  const drumArg = str(args, 'drum');
  if (drumArg) {
    if (!(drumArg in DEFAULT_DRUM_KEYS)) return fail(`Unknown drum "${drumArg}". Use one of: ${Object.keys(DEFAULT_DRUM_KEYS).join(', ')}.`);
    if (channel.instrument !== 'drum') return fail('drum only applies to a drum channel.');
    channel = { ...channel, drum: drumArg as DrumPiece, rootKey: DEFAULT_DRUM_KEYS[drumArg as DrumPiece] }; changes.push(`drum ${drumArg}`);
  }
  if (args.resetParams === true) { channel = { ...channel, params: {} }; changes.push('params reset to defaults'); }
  if (args.params !== undefined) {
    const v = validateParams(channel.instrument, 'instrument', args.params);
    if (v.errors.length) return fail(`params not applied — ${v.errors.join('; ')}`);
    channel = { ...channel, params: { ...channel.params, ...v.values } };
    changes.push(`${Object.entries(v.values).map(([k, x]) => `${k}=${r2(x)}`).join(' ')}${v.clamped.length ? ` (clamped: ${v.clamped.join(', ')})` : ''}`);
  }
  const vol = num(args, 'volume'); if (vol !== undefined) { channel = { ...channel, volume: clamp(vol, 0, 1.25) }; changes.push(`volume ${r2(channel.volume)}`); }
  const pan = num(args, 'pan'); if (pan !== undefined) { channel = { ...channel, pan: clamp(pan, -1, 1) }; changes.push(`pan ${r2(channel.pan)}`); }
  if (bool(args, 'mute') !== undefined) { channel = { ...channel, mute: bool(args, 'mute')! }; changes.push(channel.mute ? 'muted' : 'unmuted'); }
  if (bool(args, 'solo') !== undefined) { channel = { ...channel, solo: bool(args, 'solo')! }; changes.push(channel.solo ? 'solo' : 'unsolo'); }
  if (args.insert !== undefined) {
    const i = findInsert(song, args.insert);
    if (typeof i === 'string') return fail(i);
    channel = { ...channel, insert: i }; changes.push(`insert ${i}`);
  }
  const glide = num(args, 'glide'); if (glide !== undefined) { channel = { ...channel, glide: clamp(glide, 0, 2) }; changes.push(`glide ${channel.glide}s`); }
  const poly = num(args, 'polyphony'); if (poly !== undefined) { channel = { ...channel, polyphony: clamp(Math.round(poly), 1, 32) }; changes.push(`polyphony ${channel.polyphony}`); }
  if (args.swing === null) { channel = { ...channel, swing: undefined }; changes.push('swing follows the song'); }
  else { const sw = num(args, 'swing'); if (sw !== undefined) { channel = { ...channel, swing: clamp(sw, 0, 1) }; changes.push(`swing ${channel.swing}`); } }
  if (args.rootKey !== undefined) {
    const k = parseNote(args.rootKey as string | number);
    if (k === null) return fail(`rootKey "${String(args.rootKey)}" is not a note (C4, 60).`);
    channel = { ...channel, rootKey: k }; changes.push(`rootKey ${noteName(k)}`);
  }
  if (str(args, 'color')) { channel = { ...channel, color: str(args, 'color')! }; changes.push('color'); }
  if (args.group !== undefined) {
    const group = typeof args.group === 'string' ? args.group.trim() : '';
    channel = { ...channel, group: group || undefined }; changes.push(group ? `group "${group}"` : 'group cleared');
  }
  const sample = str(args, 'sampleAssetId');
  if (sample) {
    if (!host.assets().has(sample)) return fail(`Unknown sampleAssetId "${sample}".`);
    channel = { ...channel, sampleAssetId: sample }; changes.push('sample');
  }
  const moveTo = num(args, 'moveTo');
  if (moveTo !== undefined) {
    if (!Number.isInteger(moveTo) || moveTo < 0 || moveTo >= song.channels.length) return fail(`moveTo is a rack position 0–${song.channels.length - 1} (0 = top).`);
    changes.push(`moved to rack position ${moveTo}`);
  }
  if (!changes.length) return fail('Nothing to change. Give any of: name, params, volume, pan, mute, solo, insert, instrument, drum, glide, polyphony, swing, rootKey, color, group, sampleAssetId, clone, moveTo, remove.');
  let next = updateChannel(song, c.id, () => channel);
  if (channel.insert !== c.insert) next = ensureInserts(next, channel.insert + 1);
  if (moveTo !== undefined) {
    const channels = next.channels.filter((x) => x.id !== c.id);
    channels.splice(moveTo, 0, next.channels.find((x) => x.id === c.id)!);
    next = { ...next, channels };
  }
  write(ctx, next);
  return done(`Updated "${channel.name}" [${c.id}]: ${changes.join(', ')}.`);
}

// ───────────────────────────── music_write_pattern ─────────────────────────────

const STEP_CHARS = /^[xXorR1-9\-._\s|]*$/;

type Entry = { channel: Channel; mode: 'replace' | 'merge' | 'clear'; notes: Note[]; steps?: string; stepKey: number; chords?: { progression: string; rhythm?: string; octave?: number } };

function writePattern(args: Args, ctx: MusicToolContext, song0: MusicProject): ToolResult {
  let song = song0;
  const errors: string[] = [];
  const errored = new Set<string>();
  const defaultMode = str(args, 'mode') ?? 'replace';
  if (!['replace', 'merge', 'clear'].includes(defaultMode)) return fail('mode is replace (default), merge or clear.');
  // The flat form {channel, steps|text|notes|chords} is the one-channel shorthand.
  const raw = list(args, 'channels') ?? (args.channel || args.channelId ? [args] : []);
  const ref = str(args, 'patternId');
  const created = !ref || ref === 'new';
  let pattern: Pattern;
  if (created) {
    const copyFrom = str(args, 'copyFrom');
    if (copyFrom) {
      const src = findPattern(song, copyFrom);
      if (typeof src === 'string') return fail(src);
      const cloned = clonePattern(song, src.id)!;
      song = cloned.song; pattern = cloned.pattern;
      if (str(args, 'name')) song = updatePattern(song, pattern.id, (p) => ({ ...p, name: str(args, 'name')! }));
    } else {
      const added = addPattern(song, clamp(Math.round(num(args, 'bars') ?? 1), 1, 64), str(args, 'name'));
      song = added.song; pattern = added.pattern;
    }
  } else {
    const found = findPattern(song, ref);
    if (typeof found === 'string') return fail(found);
    pattern = found;
  }
  if (!raw.length && !str(args, 'name') && num(args, 'bars') === undefined) return fail('Give channels: [{channel, steps | text | notes | chords}] (one entry per channel), or name / bars to rename or resize the pattern.');

  const entries: Entry[] = [];
  raw.forEach((item, i) => {
    const e = obj(item);
    if (!e) { errors.push(`channels[${i}] is not an object`); return; }
    const channel = findChannel(song, e.channelId ?? e.channel);
    if (typeof channel === 'string') { errors.push(`channels[${i}]: ${channel}`); return; }
    const bad = (message: string) => { errors.push(`${channel.name}: ${message}`); errored.add(channel.id); };
    const mode = (str(e, 'mode') ?? defaultMode) as Entry['mode'];
    if (!['replace', 'merge', 'clear'].includes(mode)) { bad('mode must be replace, merge or clear'); return; }
    const stepKey = e.key !== undefined ? parseNote(e.key as string | number) : null;
    const entry: Entry = { channel, mode, notes: [], stepKey: stepKey ?? channel.rootKey };
    if (mode !== 'clear') {
      const steps = str(e, 'steps');
      if (steps !== undefined) {
        if (!STEP_CHARS.test(steps)) bad(`steps has characters I cannot read: ${[...new Set(steps.replace(/[xXorR1-9\-._\s|]/g, ''))].join(' ')} (use x X o r R 1-9 - . _)`);
        else entry.steps = steps;
      }
      const text = str(e, 'text');
      if (text) {
        const parsed = parseNoteText(text);
        entry.notes.push(...parsed.notes);
        for (const miss of parsed.errors) bad(`text entry not understood: "${miss}" (expected "KEY START LENGTH [VEL]", e.g. "C4 0 4 100")`);
      }
      const notes = list(e, 'notes');
      if (notes) {
        notes.forEach((n, k) => {
          if (typeof n === 'string') {
            const parsed = parseNoteText(n);
            entry.notes.push(...parsed.notes);
            for (const miss of parsed.errors) bad(`notes[${k}] not understood: "${miss}"`);
            return;
          }
          const note = noteFromJson(n);
          if (note) entry.notes.push(note);
          else bad(`notes[${k}] not understood: ${JSON.stringify(n).slice(0, 80)} (needs key, start, length; start/length in steps)`);
        });
      }
      const chords = str(e, 'chords');
      if (chords) entry.chords = { progression: chords, rhythm: str(e, 'rhythm'), octave: num(e, 'octave') };
    }
    entries.push(entry);
  });

  // Pattern length: the bars asked for, else what the content needs.
  const bar = barSteps(song);
  const askedBars = num(args, 'bars');
  let extent = 0;
  for (const en of entries) {
    for (const n of en.notes) extent = Math.max(extent, n.start + n.length);
    if (en.steps) extent = Math.max(extent, en.steps.replace(/[\s|]/g, '').length);
  }
  const bars = clamp(Math.round(askedBars ?? Math.max(pattern.bars, Math.ceil(extent / bar - 1e-9) || 1)), 1, 64);
  const total = bars * bar;
  const lines: string[] = [];
  let written = 0;
  for (const en of entries) {
    const { channel } = en;
    const fresh = [...en.notes];
    if (en.steps) {
      const unit = en.steps.replace(/[\s|]/g, '');
      const tiled = unit.length < total && total % unit.length === 0 ? unit.repeat(total / unit.length) : unit;
      fresh.push(...parseSteps(tiled, en.stepKey));
      if (tiled !== unit) lines.push(`${channel.name}: ${unit.length}-step pattern repeated ×${total / unit.length} to fill ${bars} bar${bars === 1 ? '' : 's'}`);
    }
    if (en.chords) {
      try {
        fresh.push(...generatePart(song, { part: 'chords', style: en.chords.rhythm ?? 'whole', bars, progression: en.chords.progression, octave: en.chords.octave, channel, seed: song.seed }));
      } catch (error) { errors.push(`${channel.name} chords: ${errorText(error)}`); errored.add(channel.id); }
    }
    const existing = song.patterns.find((p) => p.id === pattern.id)?.notes[channel.id] ?? [];
    if (en.mode !== 'clear' && !fresh.length) {
      if (!errored.has(channel.id)) errors.push(`${channel.name}: no notes given (use steps, text, notes or chords)`);
      continue;
    }
    let finalNotes: Note[];
    if (en.mode === 'clear') finalNotes = [];
    else if (en.mode === 'merge') {
      const seen = new Set(existing.map((n) => `${n.key}@${n.start}`));
      finalNotes = [...existing, ...fresh.filter((n) => !seen.has(`${n.key}@${n.start}`))];
    } else finalNotes = fresh;
    song = setNotes(song, pattern.id, channel.id, finalNotes);
    written += fresh.length;
    lines.push(`${channel.name} [${channel.id}] ${en.mode === 'clear' ? 'cleared' : `${en.mode}: ${fresh.length} notes`}${channel.instrument === 'drum' && finalNotes.length ? ` ${stepString(finalNotes, total)}` : finalNotes.length ? ` ${noteName(Math.min(...finalNotes.map((n) => n.key)))}–${noteName(Math.max(...finalNotes.map((n) => n.key)))}` : ''}`);
  }
  if (errors.length && !written && !entries.some((en) => en.mode === 'clear')) return fail(`Nothing was written. Problems: ${preview(errors, 8)}`);
  song = updatePattern(song, pattern.id, (p) => ({ ...p, bars, name: str(args, 'name') ?? p.name }));
  song = fitPattern(song, pattern.id, bars);
  song = { ...song, view: { ...song.view, activePatternId: pattern.id } };
  write(ctx, song);
  const final = song.patterns.find((p) => p.id === pattern.id)!;
  return done(
    `${created ? 'Created' : 'Updated'} pattern "${final.name}" [${final.id}] (${final.bars} bars): ${lines.join('; ') || 'no note changes'}.${errors.length ? ` ⚠ NOT written (${errors.length}): ${preview(errors, 8)}.` : ''} Put it in the song with music_arrange.`,
    { patternId: final.id, written, errors },
  );
}

// ───────────────────────────── music_edit_notes ─────────────────────────────

/** Note edits the piano roll has that edit.ts's editNotes does not: set lengths, slice, per-note flags, copy elsewhere. */
const LOCAL_NOTE_OPS = ['length', 'slice', 'set', 'copy'] as const;
type LocalNoteOp = (typeof LOCAL_NOTE_OPS)[number];
const NOTE_PROPS = ['slide', 'probability', 'ratchet', 'pan', 'fine', 'mute'] as const;
/** What each flag is when it is "off": a note carrying only these is as plain as a hand-drawn one. */
const NEUTRAL_PROPS: Record<string, unknown> = { slide: false, mute: false, probability: 1, ratchet: 1, pan: 0, fine: 0 };
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** length / slice / set on the selected notes: the notes that replace them, or an error text. */
function localNoteOp(op: Exclude<LocalNoteOp, 'copy'>, args: Args, selected: Note[]): Note[] | string {
  if (op === 'length') {
    const set = num(args, 'set'), mult = num(args, 'multiply'), add = num(args, 'add');
    if (set === undefined && mult === undefined && add === undefined) return 'length needs set (steps, > 0), multiply or add (steps).';
    if (set !== undefined && set <= 0) return 'length set must be more than 0 steps.';
    if (mult !== undefined && mult <= 0) return 'length multiply must be more than 0.';
    return selected.map((n) => ({ ...n, length: Math.max(0.0625, r3(set ?? n.length * (mult ?? 1) + (add ?? 0))) }));
  }
  if (op === 'slice') {
    const at = num(args, 'at'), every = num(args, 'every');
    if (at === undefined && every === undefined) return 'slice needs at (a step: every selected note that spans it is cut there) or every (steps: each selected note is chopped into pieces that long).';
    if (every !== undefined && every < 0.0625) return 'slice every must be at least 0.0625 steps.';
    const out: Note[] = [];
    let cuts = 0;
    for (const n of selected) {
      const end = n.start + n.length;
      const points: number[] = [];
      if (at !== undefined) { if (at > n.start + 0.01 && at < end - 0.01) points.push(at); }
      else for (let p = n.start + every!; p < end - 0.01; p += every!) points.push(p);
      if (!points.length) { out.push(n); continue; }
      const edges = [n.start, ...points, end];
      edges.slice(0, -1).forEach((from, i) => { out.push({ ...n, id: i === 0 ? n.id : musicId(), start: r3(from), length: r3(edges[i + 1] - from) }); });
      cuts += points.length;
    }
    return cuts ? out : `No selected note spans step ${at}: slice cuts notes that start before it and end after it.`;
  }
  const props = obj(args.props);
  if (!props || !Object.keys(props).length) return `set needs props: {${NOTE_PROPS.join(', ')}}.`;
  const patch: Partial<Note> = {};
  for (const [k, v] of Object.entries(props)) {
    if (!(NOTE_PROPS as readonly string[]).includes(k)) return `Unknown note property "${k}". Valid: ${NOTE_PROPS.join(', ')}.`;
    if ((k === 'slide' || k === 'mute') && typeof v !== 'boolean') return `props.${k} must be true or false.`;
    if (k !== 'slide' && k !== 'mute' && (typeof v !== 'number' || !Number.isFinite(v))) return `props.${k} must be a number.`;
    if (k === 'slide' || k === 'mute') (patch as Record<string, unknown>)[k] = v;
    else if (k === 'probability') patch.probability = clamp(v as number, 0, 1);
    else if (k === 'ratchet') patch.ratchet = clamp(Math.round(v as number), 1, 8);
    else if (k === 'pan') patch.pan = clamp(v as number, -1, 1);
    else patch.fine = clamp(v as number, -100, 100);
  }
  return selected.map((n) => Object.fromEntries(Object.entries({ ...n, ...patch }).filter(([k, v]) => !(k in NEUTRAL_PROPS && NEUTRAL_PROPS[k] === v))) as Note);
}

/** copy: the selected notes added (new ids) to another pattern and/or channel, or later in the same one. */
function copyNotes(args: Args, ctx: MusicToolContext, song: MusicProject, pattern: Pattern, channel: Channel, selected: Note[]): ToolResult {
  let target = pattern;
  if (str(args, 'toPatternId')) { const p = findPattern(song, args.toPatternId); if (typeof p === 'string') return fail(p); target = p; }
  let into = channel;
  if (str(args, 'toChannelId')) { const c = findChannel(song, args.toChannelId); if (typeof c === 'string') return fail(c); into = c; }
  const toStep = num(args, 'toStep');
  if (toStep !== undefined && toStep < 0) return fail('toStep is 0 or more (steps).');
  if (target.id === pattern.id && into.id === channel.id && toStep === undefined) return fail('copy needs toStep (where the first copied note lands), toPatternId or toChannelId: copying onto the same notes in place would stack duplicates.');
  const shift = toStep === undefined ? 0 : toStep - Math.min(...selected.map((n) => n.start));
  const copies = selected.map((n) => ({ ...n, id: musicId(), start: Math.max(0, r3(n.start + shift)) }));
  const existing = notesOf(target, into.id);
  let next = setNotes(song, target.id, into.id, [...existing, ...copies]);
  next = fitPattern(next, target.id);
  write(ctx, next);
  return done(`copy: ${copies.length} note${copies.length === 1 ? '' : 's'} of "${channel.name}" in ${pattern.name} added to "${into.name}" in ${target.name}${toStep === undefined ? '' : ` from step ${r2(toStep)}`}; it now has ${existing.length + copies.length} notes there.`);
}

function editNotesTool(args: Args, ctx: MusicToolContext, song: MusicProject): ToolResult {
  const pattern = findPattern(song, str(args, 'patternId') ?? song.view.activePatternId ?? undefined);
  if (typeof pattern === 'string') return fail(pattern);
  const channel = findChannel(song, args.channelId ?? args.channel);
  if (typeof channel === 'string') return fail(channel);
  const op = str(args, 'op');
  const removal = isRemoval(op);
  const local = !!op && (LOCAL_NOTE_OPS as readonly string[]).includes(op);
  if (!op || (!removal && !local && !(NOTE_OPS as string[]).includes(op))) return fail(`op must be one of: ${[...NOTE_OPS, ...LOCAL_NOTE_OPS, 'remove'].join(', ')}.`);
  const all = pattern.notes[channel.id] ?? [];
  const from = num(args, 'fromStep') ?? -Infinity, to = num(args, 'toStep') ?? Infinity;
  const keyLo = args.minKey !== undefined ? parseNote(args.minKey as string | number) : -Infinity, keyHi = args.maxKey !== undefined ? parseNote(args.maxKey as string | number) : Infinity;
  if (keyLo === null || keyHi === null) return fail('minKey / maxKey must be note names (C3) or MIDI numbers.');
  const selected = all.filter((n) => n.start >= from && n.start < to && n.key >= keyLo && n.key <= keyHi);
  if (!selected.length) return fail(`No notes of "${channel.name}" in ${pattern.name} match${all.length ? ` (it has ${all.length} notes: music_get_song {"patternId":"${pattern.id}"})` : ' — the channel has no notes in this pattern'}.`);
  const rest = all.filter((n) => !selected.includes(n));
  let result: Note[] = [];
  if (op === 'copy') return copyNotes(args, ctx, song, pattern, channel, selected);
  if (local) {
    const made = localNoteOp(op as Exclude<LocalNoteOp, 'copy'>, args, selected);
    if (typeof made === 'string') return fail(made);
    result = made;
  } else if (!removal) {
    if (op === 'transpose' && num(args, 'semitones') === undefined && num(args, 'degrees') === undefined) return fail('transpose needs semitones (exact, e.g. 12 or -5) or degrees (steps along the song scale, e.g. 2).');
    if (op === 'shift' && num(args, 'steps') === undefined) return fail('shift needs steps (e.g. 2, or -1).');
    const key = readKey(args);
    if ('error' in key) return fail(key.error);
    const scoped = { ...song, key: { root: key.root ?? song.key.root, scale: key.scale ?? song.key.scale } };
    try {
      result = editNotes(scoped, selected, op as NoteOp, { ...args, root: scoped.key.root, scale: scoped.key.scale, barSteps: barSteps(song) });
    } catch (error) {
      return fail(errorText(error));
    }
  }
  let next = setNotes(song, pattern.id, channel.id, [...rest, ...result]);
  next = fitPattern(next, pattern.id);
  write(ctx, next);
  const after = next.patterns.find((p) => p.id === pattern.id)!;
  return done(`${removal ? 'remove' : op}: ${selected.length} note${selected.length === 1 ? '' : 's'} of "${channel.name}" in ${pattern.name} → ${result.length}${removal ? ' (removed)' : ''}; the channel now has ${rest.length + result.length} notes.${channel.instrument === 'drum' ? ` Steps: ${stepString(after.notes[channel.id] ?? [], patternSteps(next, after))}` : ''}`);
}

// ───────────────────────────── music_generate ─────────────────────────────

function autoChannel(song: MusicProject, part: PartKind): Channel | undefined {
  const pitched = song.channels.filter((c) => c.instrument !== 'drum');
  const bassy = (c: Channel) => c.instrument === 'bass808' || c.group === 'Bass' || /bass|808|sub|reese/i.test(c.name);
  const prefer = (groups: string[], instruments: InstrumentType[]) => {
    for (const g of groups) { const hit = pitched.find((c) => c.group === g && !bassy(c)); if (hit) return hit; }
    return pitched.find((c) => instruments.includes(c.instrument) && !bassy(c));
  };
  switch (part) {
    case 'bass': return pitched.find(bassy);
    case 'chords': return prefer(['Keys', 'Pads', 'Plucks'], ['keys', 'organ', 'pad', 'pluck', 'synth']);
    case 'pad': return prefer(['Pads'], ['pad']);
    case 'melody': case 'counter': return prefer(['Leads', 'Plucks', 'Keys'], ['synth', 'pluck', 'fm', 'keys']);
    case 'arp': return prefer(['Plucks', 'Leads', 'Keys'], ['pluck', 'synth', 'keys', 'fm']);
    case 'riser': return pitched.find((c) => c.instrument === 'noise');
    default: return undefined;
  }
}

function generate(args: Args, ctx: MusicToolContext, song0: MusicProject): ToolResult {
  let song = song0;
  const items = (list(args, 'parts') ?? [args]).map(obj).filter((x): x is Args => !!x);
  if (!items.length) return fail('Give part (drums, bass, chords, melody, arp, fill, counter, pad, riser) or parts: [{part, …}].');
  const ref = str(args, 'patternId');
  let found: Pattern | undefined;
  if (ref && ref !== 'new') {
    const p = findPattern(song, ref);
    if (typeof p === 'string') return fail(p);
    found = p;
  } else if (str(args, 'name')) found = song.patterns.find((p) => p.name.toLowerCase() === str(args, 'name')!.toLowerCase());
  const askedBars = num(args, 'bars') ?? items.map((i) => num(i, 'bars')).find((b) => b !== undefined);
  if (!found) {
    const first = items[0];
    const label = str(args, 'name') ?? `${str(first, 'part') ?? 'Part'} ${str(first, 'style') ?? ''}`.trim();
    const added = addPattern(song, clamp(Math.round(askedBars ?? 4), 1, 64), label.charAt(0).toUpperCase() + label.slice(1));
    song = added.song; found = added.pattern;
  } else if (askedBars !== undefined && Math.round(askedBars) !== found.bars) {
    const id = found.id;
    song = updatePattern(song, id, (p) => ({ ...p, bars: clamp(Math.round(askedBars), 1, 64) }));
    found = song.patterns.find((p) => p.id === id)!;
  }
  const pattern = found;
  const bars = pattern.bars;
  const bar = barSteps(song);
  const lines: string[] = [];
  const problems: string[] = [];
  const seedBase = num(args, 'seed');
  items.forEach((item, idx) => {
    const part = str(item, 'part');
    if (!part || !(PART_KINDS as string[]).includes(part)) { problems.push(`parts[${idx}]: part must be one of ${PART_KINDS.join(', ')}`); return; }
    const kind = part as PartKind;
    let targets: Channel[] = [];
    const channelRef = item.channelId ?? item.channel;
    if (channelRef) {
      const c = findChannel(song, channelRef);
      if (typeof c === 'string') { problems.push(`${kind}: ${c}`); return; }
      targets = [c];
    } else if (kind === 'drums') targets = song.channels.filter((c) => c.instrument === 'drum');
    else if (kind === 'fill') targets = song.channels.filter((c) => c.instrument === 'drum' && ['snare', 'clap', 'tom', 'hat'].includes(c.drum ?? ''));
    else { const c = autoChannel(song, kind); if (c) targets = [c]; }
    if (!targets.length) {
      problems.push(kind === 'drums' || kind === 'fill' ? `${kind}: the song has no drum channels (music_add_channel {"preset":"kick-punchy"}, snare-tight, hat-house…)` : `${kind}: no suitable channel — add one (music_add_channel) or name channelId. Channels: ${channelList(song)}`);
      return;
    }
    const mode = str(item, 'mode') ?? str(args, 'mode') ?? 'replace';
    for (const channel of targets) {
      if ((kind === 'drums' || kind === 'fill') !== (channel.instrument === 'drum')) { problems.push(`${kind}: "${channel.name}" is ${channel.instrument === 'drum' ? 'a drum' : 'a pitched'} channel`); continue; }
      let notes: Note[];
      try {
        notes = generatePart(song, {
          part: kind, style: str(item, 'style') ?? str(args, 'style'), bars, density: num(item, 'density') ?? num(args, 'density'), octave: num(item, 'octave') ?? num(args, 'octave'),
          progression: str(item, 'progression') ?? str(args, 'progression'), seed: (num(item, 'seed') ?? seedBase ?? song.seed) + idx * 101, channel, rate: num(item, 'rate') ?? num(args, 'rate'),
        });
      } catch (error) { problems.push(`${kind}: ${errorText(error)}`); continue; }
      const existing = song.patterns.find((p) => p.id === pattern.id)?.notes[channel.id] ?? [];
      let final: Note[];
      if (kind === 'fill') {
        const w = fillWindow(song, bars);
        final = [...existing.filter((n) => n.start < w.start || n.start >= w.end), ...notes];
      } else if (mode === 'merge') final = [...existing, ...notes];
      else final = notes;
      if (!notes.length) { lines.push(`${channel.name}: nothing in this groove for ${channel.drum ?? kind} (left as it was)`); continue; }
      song = setNotes(song, pattern.id, channel.id, final);
      const bit = channel.instrument === 'drum' ? stepString(final, bars * bar).slice(0, 70) : `${noteName(Math.min(...notes.map((n) => n.key)))}–${noteName(Math.max(...notes.map((n) => n.key)))}`;
      lines.push(`${kind}→${channel.name} [${channel.id}] ${notes.length} notes ${bit}`);
    }
  });
  if (!lines.length) return fail(`Nothing was generated. ${problems.join('; ')}`);
  song = fitPattern(song, pattern.id, bars);
  song = { ...song, view: { ...song.view, activePatternId: pattern.id } };
  write(ctx, song);
  return done(
    `Wrote into pattern "${pattern.name}" [${pattern.id}] (${bars} bars, ${keyText(song)}, ${song.bpm} BPM): ${lines.join('; ')}.${problems.length ? ` ⚠ skipped: ${problems.join('; ')}.` : ''} Stack more parts in the same pattern with patternId "${pattern.id}" (same progression for every part), then music_arrange. Different take: pass another seed.`,
    { patternId: pattern.id, problems },
  );
}

// ───────────────────────────── music_arrange ─────────────────────────────

const MARKER_KINDS: MarkerKind[] = ['marker', 'intro', 'verse', 'prechorus', 'chorus', 'drop', 'build', 'breakdown', 'bridge', 'outro'];

function arrange(host: ToolHost, args: Args, ctx: MusicToolContext, song0: MusicProject): ToolResult {
  let song = song0;
  const bar = barSteps(song);
  const lines: string[] = [];
  const problems: string[] = [];
  const made: { patterns: string[]; clips: string[]; tracks: number[] } = { patterns: [], clips: [], tracks: [] };
  const colorOf = (e: Args, where: string): string | undefined | null => { const bad = badColor(e); if (bad) { problems.push(`${where}: ${bad}`); return null; } return str(e, 'color'); };
  const nameTaken = (name: string, except?: string) => song.patterns.some((p) => p.id !== except && p.name.toLowerCase() === name.toLowerCase());

  for (const [i, item] of (list(args, 'patterns') ?? []).entries()) {
    const e = obj(item);
    const rawOp = e ? str(e, 'op') ?? (str(e, 'patternId') ? 'update' : 'add') : undefined;
    const op = isRemoval(rawOp) ? 'remove' : rawOp;
    const where = `patterns[${i}]`;
    if (!e || !op || !['add', 'update', 'clone', 'remove'].includes(op)) { problems.push(`${where}: op is add, update, clone or remove`); continue; }
    const color = colorOf(e, where);
    if (color === null) continue;
    const barsArg = num(e, 'bars');
    if (e.bars !== undefined && (barsArg === undefined || barsArg < 1 || barsArg > 64)) { problems.push(`${where}: bars is 1–64`); continue; }
    const name = str(e, 'name');
    if (op === 'add') {
      if (name && nameTaken(name)) { problems.push(`${where}: a pattern is already called "${name}"`); continue; }
      const added = addPattern(song, Math.round(barsArg ?? 1), name);
      song = updatePattern(added.song, added.pattern.id, (p) => ({ ...p, ...(color ? { color } : {}) }));
      song = { ...song, view: { ...song.view, activePatternId: added.pattern.id } };
      made.patterns.push(added.pattern.id);
      lines.push(`added pattern "${added.pattern.name}" [${added.pattern.id}] (${Math.round(barsArg ?? 1)} bar${Math.round(barsArg ?? 1) === 1 ? '' : 's'}; write notes into it with music_write_pattern {patternId})`);
      continue;
    }
    const p = findPattern(song, e.patternId);
    if (typeof p === 'string') { problems.push(`${where}: ${p}`); continue; }
    if (op === 'remove') {
      if (song.patterns.length <= 1) { problems.push(`${where}: a song needs one pattern; add another before removing "${p.name}"`); continue; }
      const used = song.playlist.clips.filter((c) => c.patternId === p.id).length;
      song = removePattern(song, p.id);
      lines.push(`removed pattern "${p.name}"${used ? ` and its ${used} playlist clip${used === 1 ? '' : 's'}` : ''}`);
      continue;
    }
    if (name && nameTaken(name, op === 'update' ? p.id : undefined)) { problems.push(`${where}: a pattern is already called "${name}"`); continue; }
    if (op === 'clone') {
      const cloned = clonePattern(song, p.id)!;
      song = updatePattern(cloned.song, cloned.pattern.id, (x) => ({ ...x, ...(name ? { name } : {}), ...(color ? { color } : {}), ...(barsArg !== undefined ? { bars: Math.round(barsArg) } : {}) }));
      song = { ...song, view: { ...song.view, activePatternId: cloned.pattern.id } };
      made.patterns.push(cloned.pattern.id);
      lines.push(`cloned "${p.name}" → "${name ?? cloned.pattern.name}" [${cloned.pattern.id}]`);
      continue;
    }
    if (!name && !color && barsArg === undefined) { problems.push(`${where}: update needs name, color or bars`); continue; }
    song = updatePattern(song, p.id, (x) => ({ ...x, ...(name ? { name } : {}), ...(color ? { color } : {}), ...(barsArg !== undefined ? { bars: Math.round(barsArg) } : {}) }));
    lines.push(`pattern "${p.name}" [${p.id}]: ${[name ? `renamed "${name}"` : '', color ? 'colour' : '', barsArg !== undefined ? `${Math.round(barsArg)} bars` : ''].filter(Boolean).join(', ')}`);
  }

  for (const [i, item] of (list(args, 'tracks') ?? []).entries()) {
    const e = obj(item);
    const where = `tracks[${i}]`;
    const op = e ? str(e, 'op') ?? (e.track !== undefined ? 'update' : 'add') : undefined;
    if (!e || !op || !['add', 'update'].includes(op)) { problems.push(`${where}: op is add or update`); continue; }
    const color = colorOf(e, where);
    if (color === null) continue;
    if (op === 'add') {
      const count = num(e, 'count') ?? 1;
      if (!Number.isInteger(count) || count < 1 || count > 64 || song.playlist.tracks.length + count > 256) { problems.push(`${where}: count is 1–64 (the playlist holds up to 256 tracks)`); continue; }
      const first = song.playlist.tracks.length;
      const added = Array.from({ length: count }, (_, k) => ({ ...newTrack(first + k), ...(count === 1 && str(e, 'name') ? { name: str(e, 'name')! } : {}), ...(color ? { color } : {}) }));
      song = { ...song, playlist: { ...song.playlist, tracks: [...song.playlist.tracks, ...added] } };
      made.tracks.push(...added.map((_, k) => first + k));
      lines.push(`added ${count} track${count === 1 ? '' : 's'} (index ${first}${count > 1 ? `–${first + count - 1}` : ''})`);
      continue;
    }
    const index = findTrack(song, e.track);
    if (typeof index === 'string') { problems.push(`${where}: ${index}`); continue; }
    const patch: Partial<MusicProject['playlist']['tracks'][number]> = {};
    if (str(e, 'name')) patch.name = str(e, 'name')!;
    if (color) patch.color = color;
    for (const flag of ['mute', 'solo', 'locked'] as const) { if (e[flag] !== undefined && typeof e[flag] !== 'boolean') { problems.push(`${where}: ${flag} is true or false`); continue; } if (bool(e, flag) !== undefined) patch[flag] = bool(e, flag); }
    if (!Object.keys(patch).length) { problems.push(`${where}: update needs name, color, mute, solo or locked`); continue; }
    song = { ...song, playlist: { ...song.playlist, tracks: song.playlist.tracks.map((tr, k) => (k === index ? { ...tr, ...patch } : tr)) } };
    lines.push(`track ${index} "${song.playlist.tracks[index].name}": ${Object.entries(patch).map(([k, v]) => (typeof v === 'boolean' ? `${k} ${v}` : k)).join(', ')}`);
  }

  const sections = list(args, 'sections');
  if (sections) {
    const specs: SectionSpec[] = [];
    sections.forEach((s, i) => {
      const e = obj(s);
      const bars = e ? num(e, 'bars') : undefined;
      const patterns = e ? list(e, 'patterns')?.filter((p): p is string => typeof p === 'string') : undefined;
      if (!e || !str(e, 'name') || bars === undefined || bars < 1 || bars > 256 || !patterns?.length) { problems.push(`sections[${i}] needs name, bars (1–256) and patterns: [names or ids]`); return; }
      const kind = str(e, 'kind');
      if (kind && !MARKER_KINDS.includes(kind as MarkerKind)) { problems.push(`sections[${i}] kind must be one of ${MARKER_KINDS.join(', ')}`); return; }
      specs.push({ name: str(e, 'name')!, bars, patterns, ...(kind ? { kind: kind as MarkerKind } : {}) });
    });
    if (specs.length) {
      const append = str(args, 'mode') === 'append';
      const laid = layoutSections(song, specs, { append });
      song = laid.song;
      problems.push(...laid.errors);
      lines.push(`${append ? 'appended' : 'laid out'} ${specs.length} sections (${r2(laid.bars)} bars, ${laid.laid} pattern clips): ${specs.map((s) => `${s.name} ${s.bars}`).join(' → ')}`);
    }
  }
  const lockedTrack = (index: number) => !!song.playlist.tracks[index]?.locked;
  const lockText = (index: number) => `track ${index} is locked (unlock it with tracks:[{track:${index},locked:false}])`;
  for (const [i, item] of (list(args, 'clips') ?? []).entries()) {
    const c = obj(item);
    const op = c ? str(c, 'op') ?? 'add' : undefined;
    const removal = isRemoval(op);
    const where = `clips[${i}]`;
    if (!c || !op || (!removal && !['add', 'update', 'duplicate', 'slice'].includes(op))) { problems.push(`${where}: op is add, update, duplicate, slice or remove`); continue; }
    const startSteps = c.startBar !== undefined ? (num(c, 'startBar') ?? NaN) * bar : num(c, 'start');
    const lengthSteps = c.bars !== undefined ? (num(c, 'bars') ?? NaN) * bar : num(c, 'length');
    const offsetSteps = c.offsetBar !== undefined ? (num(c, 'offsetBar') ?? NaN) * bar : num(c, 'offset');
    const good = (v: number | undefined): v is number => v !== undefined && Number.isFinite(v);
    const fadeBad = (['fadeIn', 'fadeOut'] as const).find((k) => c[k] !== undefined && !(num(c, k) !== undefined && num(c, k)! >= 0 && num(c, k)! <= 60));
    if (fadeBad) { problems.push(`${where}: ${fadeBad} is 0–60 seconds`); continue; }
    const fades = { ...(num(c, 'fadeIn') !== undefined ? { fadeIn: num(c, 'fadeIn') } : {}), ...(num(c, 'fadeOut') !== undefined ? { fadeOut: num(c, 'fadeOut') } : {}) };
    const trackArg = num(c, 'track');
    if (trackArg !== undefined && (!Number.isInteger(trackArg) || trackArg < 0)) { problems.push(`${where}: track is a playlist track index from 0`); continue; }
    const source = str(c, 'clipId') ? song.playlist.clips.find((x) => x.id === str(c, 'clipId')) : undefined;
    if (removal) {
      const id = str(c, 'clipId');
      const patternRef = str(c, 'patternId');
      let ids: string[] = [];
      if (id) {
        if (!source) { problems.push(`${where}: no clip [${id}]`); continue; }
        if (lockedTrack(source.trackIndex)) { problems.push(`${where}: ${lockText(source.trackIndex)}`); continue; }
        ids = [source.id];
      } else if (patternRef) {
        const p = findPattern(song, patternRef);
        if (typeof p === 'string') { problems.push(`${where}: ${p}`); continue; }
        const all = song.playlist.clips.filter((x) => x.patternId === p.id);
        ids = all.filter((x) => !lockedTrack(x.trackIndex)).map((x) => x.id);
        if (ids.length < all.length) problems.push(`${where}: ${all.length - ids.length} clip(s) of ${p.name} sit on locked tracks and stay`);
      } else { problems.push(`${where}: remove needs clipId or patternId`); continue; }
      if (!ids.length) { problems.push(`${where}: no such clip`); continue; }
      song = removeClips(song, ids);
      lines.push(`removed ${ids.length} clip${ids.length === 1 ? '' : 's'}`);
    } else if (op === 'update') {
      const id = str(c, 'clipId');
      if (!id || !source) { problems.push(`${where}: update needs an existing clipId`); continue; }
      if (lockedTrack(source.trackIndex)) { problems.push(`${where}: ${lockText(source.trackIndex)}`); continue; }
      if (trackArg !== undefined && lockedTrack(trackArg)) { problems.push(`${where}: ${lockText(trackArg)}`); continue; }
      const moved = updateClip(song, id, (x) => ({
        ...x, ...(good(startSteps) ? { start: Math.max(0, startSteps) } : {}), ...(good(lengthSteps) ? { length: Math.max(1, lengthSteps) } : {}),
        ...(good(offsetSteps) ? { offset: Math.max(0, offsetSteps) } : {}), ...(trackArg !== undefined ? { trackIndex: trackArg } : {}),
        ...(bool(c, 'muted') !== undefined ? { muted: bool(c, 'muted') } : {}), ...(num(c, 'gain') !== undefined ? { gain: clamp(num(c, 'gain')!, -60, 12) } : {}), ...fades,
      }));
      // A clip moved past the last track makes the tracks it needs, the way painting there does.
      song = trackArg !== undefined && trackArg >= song.playlist.tracks.length ? addClip(removeClips(moved, [id]), moved.playlist.clips.find((x) => x.id === id)!) : moved;
      lines.push(`updated clip ${id}`);
    } else if (op === 'duplicate') {
      if (!source) { problems.push(`${where}: duplicate needs an existing clipId`); continue; }
      if (lockedTrack(source.trackIndex)) { problems.push(`${where}: ${lockText(source.trackIndex)}`); continue; }
      const times = num(c, 'times') ?? 1;
      if (!Number.isInteger(times) || times < 1 || times > 32) { problems.push(`${where}: times is 1–32`); continue; }
      const idx = trackArg ?? source.trackIndex;
      if (lockedTrack(idx)) { problems.push(`${where}: ${lockText(idx)}`); continue; }
      let at = good(startSteps) ? Math.max(0, startSteps) : source.start + source.length;
      const first = at;
      for (let k = 0; k < times; k++) {
        const id = musicId();
        song = addClip(song, { ...source, id, trackIndex: idx, start: at });
        made.clips.push(id);
        at += source.length;
      }
      lines.push(`duplicated clip ${source.id} ×${times} from bar ${r2(first / bar)} on track ${idx}`);
    } else if (op === 'slice') {
      if (!source) { problems.push(`${where}: slice needs an existing clipId`); continue; }
      if (lockedTrack(source.trackIndex)) { problems.push(`${where}: ${lockText(source.trackIndex)}`); continue; }
      const at = c.atBar !== undefined ? (num(c, 'atBar') ?? NaN) * bar : num(c, 'at');
      if (!good(at)) { problems.push(`${where}: slice needs atBar (or at in steps): the song position to cut at`); continue; }
      if (at <= source.start + 0.01 || at >= source.start + source.length - 0.01) { problems.push(`${where}: clip ${source.id} runs bar ${r2(source.start / bar)}–${r2((source.start + source.length) / bar)}: cut inside it`); continue; }
      const second = musicId();
      song = { ...song, playlist: { ...song.playlist, clips: song.playlist.clips.flatMap((o) => (o.id === source.id ? [{ ...o, length: at - o.start }, { ...o, id: second, start: at, length: o.start + o.length - at, offset: o.offset + (at - o.start) }] : [o])) } };
      made.clips.push(second);
      lines.push(`sliced clip ${source.id} at bar ${r2(at / bar)} (the right part is [${second}])`);
    } else {
      if (!good(startSteps) || startSteps < 0) { problems.push(`${where}: add needs startBar (0 = song start) or start in steps`); continue; }
      if (trackArg !== undefined && lockedTrack(trackArg)) { problems.push(`${where}: ${lockText(trackArg)}`); continue; }
      if (str(c, 'patternId')) {
        const p = findPattern(song, c.patternId);
        if (typeof p === 'string') { problems.push(`${where}: ${p}`); continue; }
        const length = good(lengthSteps) ? lengthSteps : patternSteps(song, p);
        const idx = trackArg ?? freePlaylistTrack(song, startSteps, startSteps + length);
        const id = musicId();
        song = addClip(song, { id, trackIndex: idx, start: startSteps, length, offset: good(offsetSteps) ? offsetSteps : 0, kind: 'pattern', patternId: p.id, ...(bool(c, 'muted') ? { muted: true } : {}) });
        made.clips.push(id);
        lines.push(`added ${p.name} at bar ${r2(startSteps / bar)} for ${r2(length / bar)} bars on track ${idx} [${id}]`);
      } else if (str(c, 'assetId')) {
        const asset = host.assets().get(str(c, 'assetId')!);
        if (!asset) { problems.push(`${where}: unknown assetId`); continue; }
        const length = good(lengthSteps) ? lengthSteps : Math.max(1, asset.duration / stepSeconds(song));
        const idx = trackArg ?? freePlaylistTrack(song, startSteps, startSteps + length);
        const id = musicId();
        song = addClip(song, { id, trackIndex: idx, start: startSteps, length, offset: good(offsetSteps) ? offsetSteps : 0, kind: 'audio', assetId: asset.id, gain: num(c, 'gain') ?? 0, ...fades, ...(bool(c, 'muted') ? { muted: true } : {}) });
        made.clips.push(id);
        lines.push(`added audio ${asset.name} at bar ${r2(startSteps / bar)} on track ${idx} [${id}]`);
      } else if (str(c, 'automationId')) {
        const a = song.automations.find((x) => x.id === str(c, 'automationId'));
        if (!a) { problems.push(`${where}: unknown automationId`); continue; }
        const length = good(lengthSteps) ? lengthSteps : Math.max(1, ...a.points.map((pt) => pt.t));
        const idx = trackArg ?? freePlaylistTrack(song, startSteps, startSteps + length);
        const id = musicId();
        song = addClip(song, { id, trackIndex: idx, start: startSteps, length, offset: good(offsetSteps) ? offsetSteps : 0, kind: 'automation', automationId: a.id });
        made.clips.push(id);
        lines.push(`added automation ${a.name} at bar ${r2(startSteps / bar)} [${id}]`);
      } else problems.push(`${where}: add needs patternId, assetId or automationId`);
    }
  }
  for (const [i, item] of (list(args, 'markers') ?? []).entries()) {
    const m = obj(item);
    const op = m ? str(m, 'op') ?? 'add' : undefined;
    const removal = isRemoval(op);
    if (!m || !op || (!removal && !['add', 'update'].includes(op))) { problems.push(`markers[${i}]: op is add, update or remove`); continue; }
    if (removal) {
      const before = song.playlist.markers.length;
      const want = str(m, 'id') ?? str(m, 'name');
      song = { ...song, playlist: { ...song.playlist, markers: song.playlist.markers.filter((x) => x.id !== want && x.name.toLowerCase() !== want?.toLowerCase()) } };
      if (song.playlist.markers.length === before) problems.push(`markers[${i}]: no marker "${want}"`);
      else lines.push(`removed marker ${want}`);
      continue;
    }
    const at = m.bar !== undefined ? (num(m, 'bar') ?? NaN) * bar : num(m, 'at');
    const kindArg = str(m, 'kind');
    if (kindArg && !MARKER_KINDS.includes(kindArg as MarkerKind)) { problems.push(`markers[${i}]: kind must be one of ${MARKER_KINDS.join(', ')}`); continue; }
    if (op === 'update') {
      const id = str(m, 'id');
      const hit = song.playlist.markers.find((x) => x.id === id);
      if (!id || !hit) { problems.push(`markers[${i}]: update needs a marker id from music_get_song`); continue; }
      if (at !== undefined && (!Number.isFinite(at) || at < 0)) { problems.push(`markers[${i}]: bar is 0 or more`); continue; }
      if (!str(m, 'name') && at === undefined && !kindArg) { problems.push(`markers[${i}]: update needs name, bar or kind`); continue; }
      song = { ...song, playlist: { ...song.playlist, markers: song.playlist.markers.map((x) => (x.id === id ? { ...x, ...(str(m, 'name') ? { name: str(m, 'name')! } : {}), ...(at !== undefined ? { at } : {}), ...(kindArg ? { kind: kindArg as MarkerKind } : {}) } : x)) } };
      lines.push(`marker ${id} → ${[str(m, 'name') ? `"${str(m, 'name')}"` : '', at !== undefined ? `bar ${r2(at / bar)}` : '', kindArg ?? ''].filter(Boolean).join(' ')}`);
      continue;
    }
    if (at === undefined || !Number.isFinite(at) || at < 0 || !str(m, 'name')) { problems.push(`markers[${i}]: add needs name and bar (0-based)`); continue; }
    const kind = (kindArg ?? 'marker') as MarkerKind;
    song = { ...song, playlist: { ...song.playlist, markers: [...song.playlist.markers, { id: musicId(), at, name: str(m, 'name')!, kind }] } };
    lines.push(`marker "${str(m, 'name')}" at bar ${r2(at / bar)}`);
  }
  if ('loop' in args) {
    const lp = obj(args.loop);
    if (!lp) { song = { ...song, playlist: { ...song.playlist, loop: null } }; lines.push('loop cleared'); }
    else {
      const s = (num(lp, 'startBar') ?? 0) * bar, e = (num(lp, 'endBar') ?? NaN) * bar;
      if (!Number.isFinite(e) || e <= s) problems.push('loop needs startBar and endBar (> startBar)');
      else { song = { ...song, playlist: { ...song.playlist, loop: { start: s, end: e } } }; lines.push(`loop bars ${r2(s / bar)}–${r2(e / bar)}`); }
    }
  }
  if (!lines.length) return fail(`Nothing was arranged. ${problems.length ? problems.join('; ') : 'Give sections, patterns, tracks, clips, markers or loop.'}`);
  write(ctx, { ...song, view: { ...song.view, mode: song.playlist.clips.length ? 'song' : song.view.mode } });
  return done(
    `Arranged: ${lines.join('; ')}. The song is now ${r2(songLengthSteps(song) / bar)} bars (${r2(songLengthSteps(song) * stepSeconds(song))} s).${problems.length ? ` ⚠ ${problems.join('; ')}.` : ''} Check with music_get_song, then music_mixer / music_analyze_mix.`,
    { bars: r2(songLengthSteps(song) / bar), problems, ...(made.patterns.length ? { patterns: made.patterns } : {}), ...(made.clips.length ? { clips: made.clips } : {}), ...(made.tracks.length ? { tracks: made.tracks } : {}) },
  );
}

// ───────────────────────────── music_mixer ─────────────────────────────

function mixer(args: Args, ctx: MusicToolContext, song0: MusicProject): ToolResult {
  let song = song0;
  const items = (list(args, 'inserts') ?? [args]).map(obj).filter((x): x is Args => !!x);
  const lines: string[] = [];
  const problems: string[] = [];
  for (const item of items) {
    const index = findInsert(song, item.insert);
    if (typeof index === 'string') { problems.push(index); continue; }
    const changes: string[] = [];
    const colorProblem = badColor(item);
    if (colorProblem) { problems.push(`insert ${index}: ${colorProblem}`); continue; }
    song = updateInsert(song, index, (ins) => {
      let next = ins;
      if (str(item, 'name')) { next = { ...next, name: str(item, 'name')! }; changes.push(`name "${next.name}"`); }
      if (str(item, 'color')) { next = { ...next, color: str(item, 'color')! }; changes.push('colour'); }
      const vol = num(item, 'volume'); if (vol !== undefined) { next = { ...next, volume: clamp(vol, -60, 6) }; changes.push(`volume ${r2(next.volume)} dB`); }
      const pan = num(item, 'pan'); if (pan !== undefined) { next = { ...next, pan: clamp(pan, -1, 1) }; changes.push(`pan ${r2(next.pan)}`); }
      const width = num(item, 'width'); if (width !== undefined) { next = { ...next, width: clamp(width, 0, 2) }; changes.push(`width ${r2(next.width)}`); }
      for (const flag of ['mute', 'solo', 'invert'] as const) if (bool(item, flag) !== undefined) { next = { ...next, [flag]: bool(item, flag) }; changes.push(`${flag} ${bool(item, flag)}`); }
      if (bool(item, 'toMaster') !== undefined) { next = { ...next, toMaster: bool(item, 'toMaster') }; changes.push(`toMaster ${bool(item, 'toMaster')}`); }
      return next;
    });
    for (const [k, s] of (list(item, 'sends') ?? []).entries()) {
      const e = obj(s);
      const to = e ? findInsert(song, e.to) : 'send needs to';
      if (!e || typeof to === 'string') { problems.push(`insert ${index} sends[${k}]: ${typeof to === 'string' ? to : 'not an object'}`); continue; }
      if (to === index) { problems.push(`insert ${index} sends[${k}]: cannot send to itself`); continue; }
      const sidechain = e.sidechain === true;
      const level = clamp(num(e, 'level') ?? 1, 0, 1.25);
      const removal = e.remove === true;
      song = updateInsert(song, index, (ins) => {
        const rest = ins.sends.filter((x) => !(x.to === to && !!x.sidechain === sidechain));
        return removal ? { ...ins, sends: rest } : { ...ins, sends: [...rest, { to, level, ...(sidechain ? { sidechain: true } : {}) }] };
      });
      changes.push(removal ? `send →${to} removed` : `send →${to}${sidechain ? ' (sidechain)' : ''} level ${r2(level)}`);
    }
    const sc = item.sidechainFrom !== undefined ? findInsert(song, item.sidechainFrom) : undefined;
    if (typeof sc === 'string') problems.push(`insert ${index} sidechainFrom: ${sc}`);
    else if (sc !== undefined) {
      if (sc === index) problems.push(`insert ${index} sidechainFrom: cannot duck from itself`);
      else {
        const amount = num(item, 'sidechainAmount');
        song = updateInsert(song, sc, (ins) => ({ ...ins, sends: [...ins.sends.filter((x) => !(x.to === index && x.sidechain)), { to: index, level: 1, sidechain: true }] }));
        const has = song.mixer.inserts[index].effects.some((e) => e.type === 'sidechain');
        if (!has) song = updateInsert(song, index, (ins) => ({ ...ins, effects: [newEffect('sidechain', { amount: clamp(amount ?? 0.6, 0, 1), attack: 0.005, release: 0.2 }), ...ins.effects] }));
        else if (amount !== undefined) song = updateInsert(song, index, (ins) => ({ ...ins, effects: ins.effects.map((e) => (e.type === 'sidechain' ? { ...e, params: { ...e.params, amount: clamp(amount, 0, 1) } } : e)) }));
        changes.push(`ducks from insert ${sc} (${song.mixer.inserts[sc].name})`);
      }
    }
    for (const [k, fx] of (list(item, 'effects') ?? []).entries()) {
      const e = obj(fx);
      if (!e) { problems.push(`insert ${index} effects[${k}] is not an object`); continue; }
      const rawOp = str(e, 'op') ?? (str(e, 'effectId') && !str(e, 'type') ? 'update' : 'add');
      const op = isRemoval(rawOp) ? 'remove' : rawOp;
      const chain = song.mixer.inserts[index]?.effects ?? [];
      const ref = str(e, 'effectId') ?? str(e, 'type');
      const hit = chain.find((x) => x.id === ref) ?? chain.find((x) => x.type === ref);
      if (op === 'clear') { song = updateInsert(song, index, (ins) => ({ ...ins, effects: [] })); changes.push('effects cleared'); continue; }
      if (op === 'add') {
        const type = str(e, 'type');
        if (!type || !isEffectType(type)) { problems.push(`insert ${index} effects[${k}]: type must be one of ${Object.keys(EFFECT_SPECS).join(', ')}`); continue; }
        if (chain.length >= MAX_EFFECTS) { problems.push(`insert ${index} already has ${MAX_EFFECTS} effects`); continue; }
        const v = validateParams(type, 'effect', e.params);
        if (v.errors.length) { problems.push(`insert ${index} ${type}: ${v.errors.join('; ')}`); continue; }
        let effect = newEffect(type, v.values);
        if (num(e, 'mix') !== undefined) effect = { ...effect, mix: clamp(num(e, 'mix')!, 0, 1) };
        if (bool(e, 'enabled') === false) effect = { ...effect, enabled: false };
        const at = num(e, 'at');
        const added = effect;
        song = updateInsert(song, index, (ins) => {
          const effects = [...ins.effects];
          effects.splice(at === undefined ? effects.length : clamp(Math.round(at), 0, effects.length), 0, added);
          return { ...ins, effects };
        });
        changes.push(`+${type} [${effect.id}]${Object.keys(v.values).length ? ` {${Object.entries(v.values).map(([a, b]) => `${a}=${r2(b)}`).join(' ')}}` : ''}${v.clamped.length ? ` (clamped ${v.clamped.join(', ')})` : ''}`);
        continue;
      }
      if (!hit) { problems.push(`insert ${index} effects[${k}]: no effect ${ref ?? '(give effectId)'} on this insert (it has: ${chain.map((x) => `${x.type}[${x.id}]`).join(', ') || 'none'})`); continue; }
      if (op === 'remove') { song = updateInsert(song, index, (ins) => ({ ...ins, effects: ins.effects.filter((x) => x.id !== hit.id) })); changes.push(`-${hit.type}`); continue; }
      if (op === 'move') {
        const at = num(e, 'at');
        if (at === undefined) { problems.push(`insert ${index} effects[${k}]: move needs at (position, 0 = first)`); continue; }
        song = updateInsert(song, index, (ins) => {
          const effects = ins.effects.filter((x) => x.id !== hit.id);
          effects.splice(clamp(Math.round(at), 0, effects.length), 0, hit);
          return { ...ins, effects };
        });
        changes.push(`${hit.type} moved to ${Math.round(at)}`); continue;
      }
      if (op === 'update') {
        const v = validateParams(hit.type, 'effect', e.params);
        if (v.errors.length) { problems.push(`insert ${index} ${hit.type}: ${v.errors.join('; ')}`); continue; }
        const mix = num(e, 'mix');
        const enabled = bool(e, 'enabled');
        song = updateInsert(song, index, (ins) => ({
          ...ins, effects: ins.effects.map((x) => (x.id === hit.id ? { ...x, params: { ...x.params, ...v.values }, ...(mix !== undefined ? { mix: clamp(mix, 0, 1) } : {}), ...(enabled !== undefined ? { enabled } : {}) } : x)),
        }));
        changes.push(`${hit.type} [${hit.id}] ${Object.entries(v.values).map(([a, b]) => `${a}=${r2(b)}`).join(' ')}${mix !== undefined ? ` mix ${mix}` : ''}${enabled !== undefined ? ` ${enabled ? 'on' : 'off'}` : ''}${v.clamped.length ? ` (clamped ${v.clamped.join(', ')})` : ''}`);
        continue;
      }
      problems.push(`insert ${index} effects[${k}]: op is add, update, remove, move or clear`);
    }
    if (changes.length) lines.push(`insert ${index} "${song.mixer.inserts[index].name}": ${changes.join(', ')}`);
    else if (!problems.some((p) => p.startsWith(`insert ${index}`))) problems.push(`insert ${index}: nothing to change (give name, color, volume, pan, width, mute, solo, invert, toMaster, sends, sidechainFrom or effects)`);
  }
  if (!lines.length) return fail(`Nothing changed. ${problems.join('; ') || 'Give insert and what to change.'}`);
  write(ctx, song);
  return done(`Mixer: ${lines.join(' | ')}.${problems.length ? ` ⚠ ${problems.join('; ')}.` : ''}`, { problems });
}

// ───────────────────────────── music_automate ─────────────────────────────

/**
 * Tempo automation runs over this BPM range (the clip's 0–1 values are normalised to it); every other
 * target is normalised to its parameter's min…max, linearly, so `from`/`to` are given in real units.
 */
export const TEMPO_AUTOMATION_RANGE: [number, number] = [20, 300];

/** The parameter an automation drives: its target, range, current value and a label. */
function resolveTarget(song: MusicProject, t: Args): { target: AutomationTarget; min: number; max: number; current: number; label: string } | string {
  const kind = str(t, 'kind');
  if (kind === 'tempo') return { target: { kind: 'tempo' }, min: TEMPO_AUTOMATION_RANGE[0], max: TEMPO_AUTOMATION_RANGE[1], current: song.bpm, label: 'tempo (BPM)' };
  if (kind === 'channel') {
    const c = findChannel(song, t.channelId ?? t.channel);
    if (typeof c === 'string') return c;
    const param = str(t, 'param');
    if (param === 'volume' || param === 'pan') {
      const [lo, hi] = param === 'volume' ? [0, 1.25] : [-1, 1];
      return { target: { kind: 'channel', channelId: c.id, param }, min: lo, max: hi, current: param === 'volume' ? c.volume : c.pan, label: `${c.name}.${param}` };
    }
    const spec = param ? paramSpec(c.instrument, param, 'instrument') : undefined;
    if (!param || !spec) return `${c.name} (${c.instrument}) has no parameter "${param ?? ''}". Valid: volume, pan, ${validNames(INSTRUMENT_SPECS[c.instrument].params)}.`;
    return { target: { kind: 'channel', channelId: c.id, param }, min: spec.min, max: spec.max, current: paramValue(c.params, spec), label: `${c.name}.${param}` };
  }
  if (kind === 'insert') {
    const i = findInsert(song, t.insert);
    if (typeof i === 'string') return i;
    const param = str(t, 'param');
    const ins = song.mixer.inserts[i];
    const ranges: Record<string, [number, number, number]> = { volume: [-60, 6, ins?.volume ?? 0], pan: [-1, 1, ins?.pan ?? 0], width: [0, 2, ins?.width ?? 1] };
    if (!param || !ranges[param]) return 'insert automation param is volume, pan or width.';
    return { target: { kind: 'insert', insert: i, param: param as 'volume' | 'pan' | 'width' }, min: ranges[param][0], max: ranges[param][1], current: ranges[param][2], label: `insert ${i} ${param}` };
  }
  if (kind === 'effect') {
    const i = findInsert(song, t.insert);
    if (typeof i === 'string') return i;
    const chain = song.mixer.inserts[i]?.effects ?? [];
    const ref = str(t, 'effectId') ?? str(t, 'effect');
    const fx = chain.find((e) => e.id === ref) ?? chain.find((e) => e.type === ref);
    if (!fx) return `Insert ${i} has no effect "${ref ?? ''}" (it has: ${chain.map((e) => `${e.type}[${e.id}]`).join(', ') || 'none'}).`;
    const param = str(t, 'param');
    const spec = param ? paramSpec(fx.type, param, 'effect') : undefined;
    if (!param || !spec) return `${fx.type} has no parameter "${param ?? ''}". Valid: ${validNames(EFFECT_SPECS[fx.type].params)}.`;
    return { target: { kind: 'effect', insert: i, effectId: fx.id, param }, min: spec.min, max: spec.max, current: paramValue(fx.params, spec), label: `insert ${i} ${fx.type}.${param}` };
  }
  if (kind === 'send') {
    const from = findInsert(song, t.insert), to = findInsert(song, t.to);
    if (typeof from === 'string') return from;
    if (typeof to === 'string') return to;
    const send = song.mixer.inserts[from]?.sends.find((s) => s.to === to);
    if (!send) return `Insert ${from} has no send to ${to} (add one with music_mixer first).`;
    return { target: { kind: 'send', insert: from, to }, min: 0, max: 1.25, current: send.level, label: `send ${from}→${to}` };
  }
  return 'target.kind is channel, insert, effect, send or tempo.';
}

function automate(args: Args, ctx: MusicToolContext, song0: MusicProject): ToolResult {
  let song = song0;
  const bar = barSteps(song);
  if (str(args, 'automationId') && (args.remove === true || args[DELETE_WORD] === true)) {
    const id = str(args, 'automationId')!;
    if (!song.automations.some((a) => a.id === id)) return fail(`No automation [${id}].`);
    song = { ...song, automations: song.automations.filter((a) => a.id !== id), playlist: { ...song.playlist, clips: song.playlist.clips.filter((c) => c.automationId !== id) } };
    write(ctx, song);
    return done(`Removed automation [${id}] and its clips.`);
  }
  if (str(args, 'automationId')) {
    // Without remove, an automationId can only rename: a changed curve is a new call over the same control and span, which replaces the old clip.
    const id = str(args, 'automationId')!;
    if (!song.automations.some((a) => a.id === id)) return fail(`No automation [${id}].`);
    if (!str(args, 'name') || args.target !== undefined || args.shape !== undefined || args.points !== undefined) return fail('automationId alone renames (with name) or removes (with remove:true). To change the curve, call music_automate again with the same target and the same startBar/bars: it replaces the old clip.');
    write(ctx, { ...song, automations: song.automations.map((a) => (a.id === id ? { ...a, name: str(args, 'name')! } : a)) });
    return done(`Renamed automation [${id}] to "${str(args, 'name')}".`);
  }
  const resolved = resolveTarget(song, obj(args.target) ?? args);
  if (typeof resolved === 'string') return fail(resolved);
  const { min, max, current } = resolved;
  const span = max - min;
  const startBar = num(args, 'startBar') ?? 0;
  const lengthBars = num(args, 'bars') ?? Math.max(1, songLengthSteps(song) / bar - startBar);
  if (startBar < 0 || lengthBars <= 0 || lengthBars > 512) return fail('startBar is 0 or more and bars is 1–512.');
  const start = startBar * bar;
  const length = lengthBars * bar;
  const points = list(args, 'points');
  const shape = str(args, 'shape') ?? (points ? 'points' : 'ramp-up');
  if (!['ramp-up', 'ramp-down', 'sweep', 'lfo', 'pump', 'points'].includes(shape)) return fail('shape is ramp-up, ramp-down, sweep, lfo, pump or points.');
  const norm = (v: number) => clamp((v - min) / span, 0, 1);
  const range = `${r2(min)}…${r2(max)}`;
  const from = num(args, 'from') ?? current;
  const to = num(args, 'to');
  const pts: AutomationPoint[] = [];
  if (shape === 'points') {
    if (!points?.length) return fail(`points needs [{bar|step, value, curve?}] (value in the parameter's units, ${range}; bar is relative to startBar).`);
    for (const [i, p] of points.entries()) {
      const e = obj(p);
      const t0 = e ? (e.bar !== undefined ? (num(e, 'bar') ?? NaN) * bar : num(e, 'step') ?? NaN) : NaN;
      const v = e ? num(e, 'value') : undefined;
      const curve = e ? str(e, 'curve') : undefined;
      if (!e || !Number.isFinite(t0) || t0 < 0 || v === undefined) return fail(`points[${i}] needs bar (or step) ≥ 0 and value (${range}).`);
      if (curve && !['hold', 'linear', 'smooth', 'exp'].includes(curve)) return fail(`points[${i}].curve is hold, linear, smooth or exp.`);
      pts.push({ t: t0, v: norm(v), ...(curve ? { curve: curve as AutomationPoint['curve'] } : {}) });
    }
    pts.sort((a, b) => a.t - b.t);
  } else {
    if (to === undefined) return fail(shape === 'lfo' || shape === 'pump' ? `${shape} needs from and to (the low and high values, ${range}).` : `Give to (the end value, ${range}) and optionally from (default: the current value ${r2(current)}).`);
    if ((shape === 'lfo' || shape === 'pump') && args.from === undefined) return fail(`${shape} needs from and to (the low and high values, ${range}).`);
    if (shape === 'ramp-up' || shape === 'ramp-down') {
      const a = shape === 'ramp-up' ? from : to, b = shape === 'ramp-up' ? to : from;
      pts.push({ t: 0, v: norm(a), curve: 'linear' }, { t: length, v: norm(b) });
    } else if (shape === 'sweep') {
      // A build: slow at first, fast at the end (exponential).
      pts.push({ t: 0, v: norm(from), curve: 'exp' }, { t: length, v: norm(to) });
    } else if (shape === 'lfo') {
      const cycles = Math.max(0.25, num(args, 'cycles') ?? lengthBars);
      const perCycle = 8;
      const n = Math.min(512, Math.ceil(cycles * perCycle));
      for (let i = 0; i <= n; i++) {
        const phase = (i / perCycle) * 2 * Math.PI;
        pts.push({ t: Math.min(length, (i / n) * length), v: norm(from + ((to - from) * (1 - Math.cos(phase))) / 2), curve: 'smooth' });
      }
    } else {
      // Pump: duck to `from` on every beat, rise back to `to` before the next one.
      const every = Math.max(1, num(args, 'every') ?? song.stepsPerBeat);
      const n = Math.min(256, Math.floor(length / every));
      for (let i = 0; i < n; i++) pts.push({ t: i * every, v: norm(from), curve: 'exp' }, { t: i * every + every * 0.92, v: norm(to), curve: 'hold' });
    }
  }
  if (!pts.length) return fail('Nothing to automate in that range.');
  const id = musicId();
  const automation: Automation = { id, name: str(args, 'name') ?? `${resolved.label} ${shape}`, target: resolved.target, points: pts };
  // A new clip replaces an older one for the same parameter over the same span.
  const sameTarget = (a: Automation) => JSON.stringify(a.target) === JSON.stringify(automation.target);
  const clash = new Set(song.playlist.clips.filter((c) => c.kind === 'automation' && c.start < start + length && c.start + c.length > start && song.automations.some((a) => a.id === c.automationId && sameTarget(a))).map((c) => c.id));
  if (clash.size) song = removeClips(song, [...clash]);
  const live = new Set(song.playlist.clips.map((c) => c.automationId));
  song = { ...song, automations: [...song.automations.filter((a) => live.has(a.id) || !sameTarget(a)), automation] };
  const trackIndex = freePlaylistTrack(song, start, start + length);
  song = addClip(song, { trackIndex, start, length, offset: 0, kind: 'automation', automationId: id });
  song = { ...song, playlist: { ...song.playlist, tracks: song.playlist.tracks.map((tr, i) => (i === trackIndex && /^Track \d+$/.test(tr.name) ? { ...tr, name: 'Automation' } : tr)) } };
  write(ctx, song);
  return done(`Automated ${resolved.label} (${range}) ${shape}${shape === 'points' || to === undefined ? '' : ` ${r2(from)}→${r2(to)}`} over bars ${r2(startBar)}–${r2(startBar + lengthBars)} on playlist track ${trackIndex}: ${pts.length} points [${id}]${clash.size ? ` (replaced ${clash.size} older clip${clash.size === 1 ? '' : 's'} for the same parameter)` : ''}.`, { automationId: id, track: trackIndex });
}

// ───────────────────────────── music_analyze_mix ─────────────────────────────

const dbText = (v: number) => (Number.isFinite(v) ? `${(Math.round(v * 10) / 10).toFixed(1)} dB` : '-inf');

async function analyzeMix(host: ToolHost, args: Args, song: MusicProject): Promise<ToolResult> {
  if (!song.channels.length) return fail('The song has no channels yet — nothing to analyse.');
  let engine: typeof import('../music/engine');
  try {
    engine = await import('../music/engine');
  } catch (error) {
    return fail(`The audio engine is not available here: ${errorText(error)}`);
  }
  const arranged = song.playlist.clips.length > 0;
  const patternId = str(args, 'patternId') ?? song.view.activePatternId ?? song.patterns[0]?.id;
  let result: Awaited<ReturnType<typeof engine.renderSong>>;
  try {
    result = await engine.renderSong(song, { stems: true, mode: arranged ? 'song' : 'pattern', patternId, loadSample: loaderFor(host, engine) });
  } catch (error) {
    return fail(`Rendering needs Web Audio (the Music Studio's engine) and failed: ${errorText(error)}. Nothing was changed.`);
  }
  const master = engine.analyseBuffer(result.master);
  const stems = [...(result.stems ?? new Map<number, AudioBuffer>())].map(([insert, buffer]) => ({ insert, a: engine.analyseBuffer(buffer) }));
  const issues: string[] = [];
  const insName = (i: number) => `insert ${i} "${song.mixer.inserts[i]?.name ?? i}"`;

  if (master.clipped || master.peakDb > -0.1) issues.push(`CLIPPING: the master peaks at ${dbText(master.peakDb)}. Fix: music_set_song {"masterVolume":-3}, or lower the loudest inserts (music_mixer {"insert":N,"volume":-3}); keep the limiter last on the master.`);
  if (master.lufs > -9) issues.push(`Too loud/crushed: ${master.lufs.toFixed(1)} LUFS (streaming target about -14). Fix: lower masterVolume or the faders by about ${Math.round(master.lufs + 14)} dB.`);
  else if (master.lufs < -23) issues.push(`Too quiet: ${master.lufs.toFixed(1)} LUFS (target about -14). Fix: raise the insert faders / masterVolume by about ${Math.round(-14 - master.lufs)} dB (watch the peak).`);
  if (master.correlation < 0) issues.push(`Phase problem: stereo correlation ${master.correlation.toFixed(2)} (the mix cancels in mono). Fix: music_mixer on the widest inserts {"width":1}, or remove stereo effects from bass and kick.`);
  else if (master.correlation > 0.995) issues.push('Almost mono: add width — a stereo or chorus effect on pads/leads (music_mixer effects:[{type:"stereo"}]) and pan hats / percussion.');
  const b = master.bands;
  if (b.sub + b.low > 0.75) issues.push(`Boomy: ${Math.round((b.sub + b.low) * 100)}% of the energy is below 250 Hz. Fix: high-pass pads/keys/leads (eq b1Freq 150–250) and lower the bass fader.`);
  if (b.high < 0.01 && b.mid > 0.2) issues.push('Dull: almost no energy above 5 kHz. Fix: brighten hats/lead (eq b7Gain +3), raise the hat fader.');

  for (const { insert, a } of stems) {
    if (insert === 0) continue;
    const feeds = song.channels.filter((c) => c.insert === insert).map((c) => c.name).join(', ') || 'sends only';
    if (a.peakDb > -0.5) issues.push(`${insName(insert)} (${feeds}) clips at ${dbText(a.peakDb)}. Fix: music_mixer {"insert":${insert},"volume":-4}.`);
    else if (a.rmsDb < -50) issues.push(`${insName(insert)} (${feeds}) is silent or inaudible (${dbText(a.rmsDb)}). Fix: check it has notes in the arranged patterns and is not muted.`);
    else if (a.lufs < master.lufs - 22) issues.push(`${insName(insert)} (${feeds}) is buried: ${a.lufs.toFixed(1)} LUFS vs master ${master.lufs.toFixed(1)}. Fix: music_mixer {"insert":${insert},"volume":6}.`);
  }
  const active = stems.filter((s) => s.insert !== 0 && s.a.rmsDb > -50);
  const loud = [...active].sort((x, y) => y.a.rmsDb - x.a.rmsDb);
  if (loud.length >= 3 && loud[0].a.rmsDb - loud[1].a.rmsDb > 9) {
    const top = song.channels.filter((c) => c.insert === loud[0].insert);
    if (!top.some((c) => c.drum === 'kick' || c.instrument === 'bass808' || c.group === 'Bass')) issues.push(`${insName(loud[0].insert)} dominates the mix (${dbText(loud[0].a.rmsDb - loud[1].a.rmsDb)} above the next). Fix: music_mixer {"insert":${loud[0].insert},"volume":-${Math.round(loud[0].a.rmsDb - loud[1].a.rmsDb - 3)}}.`);
  }
  // Kick vs bass: both loud in the low end with no ducking is mud.
  const kickCh = song.channels.find((c) => c.drum === 'kick');
  const bassCh = song.channels.find((c) => c.instrument === 'bass808' || c.group === 'Bass' || /bass|808|sub/i.test(c.name));
  if (kickCh && bassCh && kickCh.insert !== bassCh.insert) {
    const k = stems.find((s) => s.insert === kickCh.insert)?.a, bs = stems.find((s) => s.insert === bassCh.insert)?.a;
    if (k && bs && k.bands.sub + k.bands.low > 0.5 && bs.bands.sub + bs.bands.low > 0.5 && Math.abs(k.rmsDb - bs.rmsDb) < 10) {
      const ducked = song.mixer.inserts[kickCh.insert].sends.some((s) => s.to === bassCh.insert && s.sidechain) && song.mixer.inserts[bassCh.insert].effects.some((e) => e.type === 'sidechain');
      if (!ducked) issues.push(`Kick–bass masking: ${kickCh.name} and ${bassCh.name} both live in the low end (${Math.round((k.bands.sub + k.bands.low) * 100)}% / ${Math.round((bs.bands.sub + bs.bands.low) * 100)}% below 250 Hz) at similar level. Fix: music_mixer {"insert":${bassCh.insert},"sidechainFrom":${kickCh.insert},"sidechainAmount":0.6}, and/or EQ-cut the bass around 60 Hz (eq b2Type 2, b2Freq 60, b2Gain -3) where the kick sits.`);
    }
  }
  // Silence inside the music (not the tail).
  const win = master.windows;
  const music = Math.min(win.length, Math.ceil(result.duration));
  const barSeconds = stepSeconds(song) * barSteps(song);
  let runStart = -1;
  const gaps: string[] = [];
  for (let i = 0; i <= music; i++) {
    const quiet = i < music && win[i] <= -60;
    if (quiet && runStart < 0) runStart = i;
    if (!quiet && runStart >= 0) { if (i - runStart >= 2) gaps.push(`${runStart}–${i} s (bars ${r2(runStart / barSeconds)}–${r2(i / barSeconds)})`); runStart = -1; }
  }
  if (gaps.length) issues.push(`Silent stretches: ${gaps.join(', ')}. If that is not a deliberate break, an arranged section has no sounding parts — check music_arrange / mutes.`);
  if (arranged) {
    const bar = barSteps(song);
    const sorted = [...song.playlist.markers].sort((x, y) => x.at - y.at);
    const empty = sorted.filter((m, i) => {
      const end = sorted[i + 1]?.at ?? songLengthSteps(song);
      return !song.playlist.clips.some((c) => c.kind === 'pattern' && c.start < end && c.start + c.length > m.at);
    });
    if (empty.length) issues.push(`Sections with no pattern clips: ${empty.map((m) => `${m.name} (bar ${r2(m.at / bar)})`).join(', ')}.`);
  }

  const header = `MIX REPORT (${arranged ? 'whole song' : `pattern ${song.patterns.find((p) => p.id === patternId)?.name ?? ''} — no arrangement yet`}, ${r2(result.duration)} s): master peak ${dbText(master.peakDb)}, rms ${dbText(master.rmsDb)}, ${master.lufs.toFixed(1)} LUFS, stereo correlation ${master.correlation.toFixed(2)}, bands sub ${Math.round(b.sub * 100)}% low ${Math.round(b.low * 100)}% low-mid ${Math.round(b.lowMid * 100)}% mid ${Math.round(b.mid * 100)}% high ${Math.round(b.high * 100)}%.`;
  const table = stems.filter((s) => s.insert !== 0).map(({ insert, a }) => ` ${insName(insert)}: peak ${dbText(a.peakDb)}, rms ${dbText(a.rmsDb)}, ${a.lufs.toFixed(1)} LUFS, low-end ${Math.round((a.bands.sub + a.bands.low) * 100)}%`);
  return done(`${header}\nPer insert:\n${table.join('\n') || ' (no stems)'}\n${issues.length ? `ISSUES (${issues.length}):\n${issues.map((s, i) => `${i + 1}. ${s}`).join('\n')}` : 'No issues found: levels, low end and stereo image look healthy.'}`, {
    masterPeakDb: r2(master.peakDb), lufs: r2(master.lufs), issues: issues.length,
  });
}

// ───────────────────────────── music_render ─────────────────────────────

async function renderTool(host: ToolHost, args: Args, ctx: MusicToolContext, project: Project, song: MusicProject): Promise<ToolResult> {
  if (!song.channels.length) return fail('The song has no channels yet — build something first (music_new_song, music_generate).');
  const arranged = song.playlist.clips.length > 0;
  const mode = args.mode === 'pattern' || (!arranged && args.mode !== 'song') ? 'pattern' : 'song';
  let patternId: string | undefined;
  if (mode === 'pattern') {
    const p = findPattern(song, str(args, 'patternId') ?? song.view.activePatternId ?? song.patterns[0]?.id);
    if (typeof p === 'string') return fail(p);
    patternId = p.id;
  }
  const bar = barSteps(song);
  const fromBar = num(args, 'fromBar'), toBar = num(args, 'toBar');
  if (mode === 'song' && !arranged) return fail('The song has no arrangement (playlist clips). Use music_arrange {"sections":[…]} first, or render one pattern with mode:"pattern".');
  const name = str(args, 'name') ?? song.name;
  const wantPlace = bool(args, 'place') === true;
  const comp = wantPlace ? ctx.pickComp(project, args) : undefined;
  if (wantPlace && !comp) return fail('place:true needs an open composition — create or open one first (the song is not rendered yet).');
  let bounce: Awaited<ReturnType<typeof bounceSong>>;
  try {
    const engine = await import('../music/engine');
    bounce = await bounceSong(song, {
      name, mode, patternId, stems: bool(args, 'stems') === true, loadSample: loaderFor(host, engine),
      ...(fromBar !== undefined ? { from: Math.max(0, fromBar) * bar } : {}), ...(toBar !== undefined ? { to: Math.max(0, toBar) * bar } : {}),
    });
  } catch (error) {
    return fail(`Could not render the song (it needs the Music Studio's Web Audio engine): ${errorText(error)}`);
  }
  const folder = ctx.folderFor('Music');
  const [asset] = await host.importMedia([bounce.path], folder);
  if (!asset) return fail(`The song was rendered to ${bounce.path} but could not be imported into the bin.`);
  const stemAssets = bounce.stemPaths?.length ? await host.importMedia(bounce.stemPaths, folder) : [];
  const { result } = bounce;
  let placed = '';
  if (wantPlace && comp) {
    const level = num(args, 'db') ?? -6;
    const earlier = songPlacement(project, comp.id);
    let laid: ReturnType<typeof placeSongLayer> | null = null;
    // The song's music layer: placed once per composition, refreshed in place when sent again.
    ctx.commit((current) => {
      laid = placeSongLayer(current, comp.id, { assetId: asset.id, duration: result.duration, beats: result.beats, downbeats: result.downbeats, bpm: song.bpm, name: asset.name }, { start: num(args, 'start') ?? 0, db: level });
      return laid.project;
    });
    const at = laid ? (laid as ReturnType<typeof placeSongLayer>) : null;
    placed = earlier
      ? ` Refreshed the song's music layer on "${comp.name}" in place (clip ${at?.clipId}; same start, track and level as the editor left it).`
      : ` Laid on "${comp.name}" as its music layer on the "Music" audio track from ${(num(args, 'start') ?? 0).toFixed(2)} s (clip ${at?.clipId}, ${level} dB, faded in and out). Sending the song again refreshes this clip instead of adding another.`;
    placed += ' Its beat grid is stored, so snap_cuts_to_beats needs no analysis.';
  }
  return done(`Rendered "${asset.name}" (${r2(result.duration)} s, ${song.bpm} BPM, ${mode === 'song' ? 'whole song' : 'one pattern'}) to the "Music" bin folder (asset ${asset.id}).${stemAssets.length ? ` Stems: ${stemAssets.map((s) => s.name).join(', ')}.` : ''}${placed || ' Place it with place_clip, or call music_render again with place:true.'}`, {
    assetId: asset.id, path: bounce.path, duration: result.duration, bpm: song.bpm, beats: result.beats.slice(0, 64), downbeats: result.downbeats.slice(0, 64), placed: !!placed,
    stemAssetIds: stemAssets.map((s) => s.id),
  });
}
