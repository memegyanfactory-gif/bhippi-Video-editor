// Pure operations on the song document (docs/MUSIC-STUDIO-PLAN.md). The studio UI and the AI tools
// both edit the song only through these, so a person and a model always make the same change.
import { parseNote } from './theory';
import {
  DEFAULT_INSERTS, INSTRUMENT_SPECS, MAX_EFFECTS, MAX_INSERTS, MUSIC_VERSION, EFFECT_SPECS,
  stepsPerBar,
  type Channel, type DrumPiece, type Effect, type EffectType, type InstrumentType, type MixerInsert, type MusicProject, type Note, type Pattern, type PlaylistClip, type PlaylistTrack,
} from './types';
import type { Project } from '../lib/types';

export const musicId = (): string => (globalThis.crypto?.randomUUID?.() ?? `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`).replace(/-/g, '').slice(0, 12);

/** The FL-ish colour wheel channels, patterns and inserts cycle through. */
export const PALETTE = ['#5b8def', '#e0715b', '#59c08a', '#d9a845', '#a77bdb', '#4cb7c4', '#e26aa3', '#8fb348', '#d1824a', '#6f7ee8', '#c9c35a', '#5aa6d6'];
export const colorAt = (i: number): string => PALETTE[((i % PALETTE.length) + PALETTE.length) % PALETTE.length];

export function newInsert(index: number, name?: string): MixerInsert {
  return {
    id: musicId(), name: name ?? (index === 0 ? 'Master' : `Insert ${index}`), color: index === 0 ? '#9aa4b2' : colorAt(index - 1),
    volume: 0, pan: 0, width: 1, mute: false, solo: false, sends: [], effects: [],
  };
}

export function newPattern(index: number, bars = 1, name?: string): Pattern {
  return { id: musicId(), name: name ?? `Pattern ${index + 1}`, color: colorAt(index), bars, notes: {} };
}

export function newTrack(index: number): PlaylistTrack {
  return { id: musicId(), name: `Track ${index + 1}`, color: colorAt(index), mute: false, solo: false };
}

/** An empty song: one pattern, 16 inserts + master (master gets a limiter), 16 playlist tracks. */
export function newSong(name = 'Untitled song', bpm = 120): MusicProject {
  const master = newInsert(0);
  master.effects = [newEffect('limiter')];
  const pattern = newPattern(0);
  return {
    version: MUSIC_VERSION, name, bpm, timeSig: [4, 4], swing: 0, key: { root: 0, scale: 'minor' }, masterVolume: 0, masterPitch: 0, stepsPerBeat: 4,
    channels: [], patterns: [pattern],
    playlist: { tracks: Array.from({ length: 16 }, (_, i) => newTrack(i)), clips: [], markers: [], loop: null },
    mixer: { inserts: Array.from({ length: DEFAULT_INSERTS + 1 }, (_, i) => (i === 0 ? master : newInsert(i))) },
    automations: [], view: { mode: 'pattern', activePatternId: pattern.id, selectedChannelId: null, window: 'rack' },
    seed: Math.floor(Math.random() * 1e9),
  };
}

export function newEffect(type: EffectType, params: Record<string, number> = {}): Effect {
  return { id: musicId(), type, enabled: true, mix: type === 'reverb' ? 0.3 : type === 'delay' ? 0.25 : 1, params: { ...params } };
}

export const DEFAULT_DRUM_KEYS: Record<DrumPiece, number> = { kick: 36, snare: 38, clap: 39, hat: 42, openhat: 46, tom: 45, rim: 37, cowbell: 56, crash: 49, ride: 51, shaker: 70, perc: 60 };

export function newChannel(song: MusicProject, instrument: InstrumentType, options: Partial<Channel> = {}): Channel {
  const index = song.channels.length;
  return {
    id: musicId(), name: options.name ?? (options.drum ? cap(options.drum) : INSTRUMENT_SPECS[instrument].label), color: options.color ?? colorAt(index),
    instrument, params: {}, volume: 0.8, pan: 0, mute: false, solo: false, insert: freeInsert(song), polyphony: instrument === 'bass808' ? 1 : 16,
    glide: instrument === 'bass808' ? 0.06 : 0, rootKey: options.drum ? DEFAULT_DRUM_KEYS[options.drum] : 60,
    ...options,
  };
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The lowest insert no channel routes to (1…), or 0 (master) when all are taken. */
export function freeInsert(song: MusicProject): number {
  const used = new Set(song.channels.map((c) => c.insert));
  for (let i = 1; i < song.mixer.inserts.length; i++) if (!used.has(i)) return i;
  return 0;
}

/** The song in a project, or a fresh one (not saved until something commits it). */
export const songOf = (project: Project): MusicProject => normalizeSong(project.music) ?? newSong(project.name ? `${project.name} song` : 'Untitled song');

/** Writes the song into a project. */
export const withSong = (project: Project, song: MusicProject): Project => ({ ...project, music: song });

// ---------------------------------------------------------------------------------------------
// Edits (all immutable)

export const updateChannel = (song: MusicProject, id: string, change: (c: Channel) => Channel): MusicProject => ({ ...song, channels: song.channels.map((c) => (c.id === id ? change(c) : c)) });

export function addChannel(song: MusicProject, channel: Channel): MusicProject {
  // A channel routed to an insert past the end grows the mixer.
  let next = ensureInserts(song, channel.insert + 1);
  next = { ...next, channels: [...next.channels, channel] };
  // Name the insert after its first channel, as FL does when you route a channel to a fresh insert.
  const insert = next.mixer.inserts[channel.insert];
  if (channel.insert > 0 && insert && /^Insert \d+$/.test(insert.name)) next = updateInsert(next, channel.insert, (ins) => ({ ...ins, name: channel.name, color: channel.color }));
  return next;
}

export function removeChannel(song: MusicProject, id: string): MusicProject {
  return {
    ...song, channels: song.channels.filter((c) => c.id !== id),
    patterns: song.patterns.map((p) => (id in p.notes ? { ...p, notes: Object.fromEntries(Object.entries(p.notes).filter(([k]) => k !== id)) } : p)),
    automations: song.automations.filter((a) => !(a.target.kind === 'channel' && a.target.channelId === id)),
    view: song.view.selectedChannelId === id ? { ...song.view, selectedChannelId: null } : song.view,
  };
}

export function ensureInserts(song: MusicProject, count: number): MusicProject {
  const want = Math.min(MAX_INSERTS, count);
  if (song.mixer.inserts.length >= want) return song;
  const inserts = [...song.mixer.inserts];
  while (inserts.length < want) inserts.push(newInsert(inserts.length));
  return { ...song, mixer: { inserts } };
}

export const updateInsert = (song: MusicProject, index: number, change: (i: MixerInsert) => MixerInsert): MusicProject => {
  const grown = ensureInserts(song, index + 1);
  return { ...grown, mixer: { inserts: grown.mixer.inserts.map((ins, i) => (i === index ? change(ins) : ins)) } };
};

export function addEffect(song: MusicProject, insert: number, effect: Effect, at?: number): MusicProject {
  return updateInsert(song, insert, (ins) => {
    if (ins.effects.length >= MAX_EFFECTS) return ins;
    const effects = [...ins.effects];
    effects.splice(at === undefined ? effects.length : Math.max(0, Math.min(effects.length, at)), 0, effect);
    return { ...ins, effects };
  });
}

export const updatePattern = (song: MusicProject, id: string, change: (p: Pattern) => Pattern): MusicProject => ({ ...song, patterns: song.patterns.map((p) => (p.id === id ? change(p) : p)) });

export function addPattern(song: MusicProject, bars = 1, name?: string): { song: MusicProject; pattern: Pattern } {
  const pattern = newPattern(song.patterns.length, bars, name);
  return { song: { ...song, patterns: [...song.patterns, pattern] }, pattern };
}

export function clonePattern(song: MusicProject, id: string): { song: MusicProject; pattern: Pattern } | null {
  const src = song.patterns.find((p) => p.id === id);
  if (!src) return null;
  const pattern: Pattern = { ...src, id: musicId(), name: `${src.name} copy`, color: colorAt(song.patterns.length), notes: Object.fromEntries(Object.entries(src.notes).map(([k, ns]) => [k, ns.map((n) => ({ ...n, id: musicId() }))])) };
  return { song: { ...song, patterns: [...song.patterns, pattern] }, pattern };
}

export function removePattern(song: MusicProject, id: string): MusicProject {
  const patterns = song.patterns.filter((p) => p.id !== id);
  return {
    ...song, patterns,
    playlist: { ...song.playlist, clips: song.playlist.clips.filter((c) => c.patternId !== id) },
    view: song.view.activePatternId === id ? { ...song.view, activePatternId: patterns[0]?.id ?? null } : song.view,
  };
}

/** Sets one channel's notes in a pattern (sorted by start, then key). */
export function setNotes(song: MusicProject, patternId: string, channelId: string, notes: Note[]): MusicProject {
  return updatePattern(song, patternId, (p) => ({ ...p, notes: { ...p.notes, [channelId]: [...notes].sort((a, b) => a.start - b.start || a.key - b.key) } }));
}

export const notesOf = (pattern: Pattern | undefined, channelId: string): Note[] => pattern?.notes[channelId] ?? [];

/** Steps in a pattern; grows to cover its last note. */
export function patternSteps(song: MusicProject, pattern: Pattern): number {
  const bar = stepsPerBar(song);
  const last = Object.values(pattern.notes).flat().reduce((end, n) => Math.max(end, n.start + n.length), 0);
  return Math.max(pattern.bars * bar, Math.ceil(last / bar) * bar);
}

/** Toggles a one-step note at `step` (the Channel Rack click). */
export function toggleStep(song: MusicProject, patternId: string, channel: Channel, step: number): MusicProject {
  const pattern = song.patterns.find((p) => p.id === patternId);
  if (!pattern) return song;
  const notes = notesOf(pattern, channel.id);
  const hit = notes.find((n) => Math.floor(n.start) === step);
  return setNotes(song, patternId, channel.id, hit ? notes.filter((n) => n !== hit) : [...notes, { id: musicId(), key: channel.rootKey, start: step, length: 1, velocity: 0.78 }]);
}

// ---------------------------------------------------------------------------------------------
// Text forms a model writes

/**
 * A drum step string → notes. One character per step (spaces and | are ignored):
 * `x` hit, `X` accent, `o` ghost, `r` ratchet ×2, `R` ratchet ×3, `1`–`9` velocity tenths,
 * `-` or `.` rest, `_` holds the previous hit one more step.
 */
export function parseSteps(text: string, key: number): Note[] {
  const notes: Note[] = [];
  let step = 0;
  for (const ch of text.replace(/[\s|]/g, '')) {
    if (ch === '_') {
      const last = notes[notes.length - 1];
      if (last && last.start + last.length === step) last.length += 1;
      step++;
      continue;
    }
    const vel = ch === 'x' ? 0.78 : ch === 'X' ? 1 : ch === 'o' ? 0.4 : ch === 'r' || ch === 'R' ? 0.75 : /[1-9]/.test(ch) ? Number(ch) / 9 : 0;
    if (vel > 0) notes.push({ id: musicId(), key, start: step, length: 1, velocity: vel, ...(ch === 'r' ? { ratchet: 2 } : ch === 'R' ? { ratchet: 3 } : {}) });
    step++;
  }
  return notes;
}

/** Notes → a step string (the read-out a model sees). Off-grid notes show as `*`. */
export function stepString(notes: Note[], steps: number): string {
  const cells = Array.from({ length: steps }, () => '-');
  for (const n of notes) {
    const i = Math.floor(n.start);
    if (i < 0 || i >= steps) continue;
    const off = Math.abs(n.start - i) > 1e-3;
    cells[i] = off ? '*' : n.ratchet && n.ratchet >= 3 ? 'R' : n.ratchet === 2 ? 'r' : n.velocity >= 0.95 ? 'X' : n.velocity <= 0.45 ? 'o' : 'x';
    for (let h = 1; h < Math.round(n.length) && i + h < steps; h++) if (cells[i + h] === '-') cells[i + h] = '_';
  }
  return cells.map((c, i) => (i > 0 && i % 16 === 0 ? `|${c}` : c)).join('');
}

/**
 * Compact note text → notes: entries split by `;` or new lines, each `KEY START LENGTH [VELOCITY]`
 * with KEY a note name or MIDI number (several keys joined by `+` make a chord: `C4+E4+G4 0 8 90`),
 * START and LENGTH in steps, VELOCITY 1–127 (or 0–1). Extra flags: `slide`, `p0.5` (probability),
 * `r2` (ratchet). Unreadable entries are reported, not guessed.
 */
export function parseNoteText(text: string): { notes: Note[]; errors: string[] } {
  const notes: Note[] = [];
  const errors: string[] = [];
  for (const raw of text.split(/[;\n]+/)) {
    const entry = raw.trim();
    if (!entry) continue;
    const parts = entry.split(/[\s,]+/);
    const keys = parts[0].split('+').map((k) => parseNote(k));
    const start = Number(parts[1]);
    const length = parts[2] === undefined ? 1 : Number(parts[2]);
    if (keys.some((k) => k === null) || !Number.isFinite(start) || !Number.isFinite(length) || length <= 0) {
      errors.push(entry);
      continue;
    }
    let velocity = 0.8;
    const extra: Partial<Note> = {};
    for (const flag of parts.slice(3)) {
      if (flag === 'slide') extra.slide = true;
      else if (/^p[\d.]+$/.test(flag)) extra.probability = clamp01(Number(flag.slice(1)));
      else if (/^r\d+$/.test(flag)) extra.ratchet = Math.max(1, Math.min(8, Number(flag.slice(1))));
      else if (/^v?[\d.]+$/.test(flag)) {
        const v = Number(flag.replace(/^v/, ''));
        velocity = v > 1 ? clamp01(v / 127) : clamp01(v);
      }
    }
    for (const key of keys) notes.push({ id: musicId(), key: key as number, start: Math.max(0, start), length, velocity, ...extra });
  }
  return { notes, errors };
}

export const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** A note from loose JSON a model sent ({key|note|pitch, start|step|time, length|duration, velocity}). */
export function noteFromJson(value: unknown): Note | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const key = parseNote((v.key ?? v.note ?? v.pitch) as string | number);
  const start = Number(v.start ?? v.step ?? v.time ?? 0);
  const length = Number(v.length ?? v.duration ?? v.len ?? 1);
  if (key === null || !Number.isFinite(start) || !Number.isFinite(length) || length <= 0) return null;
  const rawVel = Number(v.velocity ?? v.vel ?? 0.8);
  const velocity = Number.isFinite(rawVel) ? (rawVel > 1 ? clamp01(rawVel / 127) : clamp01(rawVel)) : 0.8;
  const note: Note = { id: musicId(), key, start: Math.max(0, start), length, velocity };
  if (typeof v.pan === 'number') note.pan = Math.max(-1, Math.min(1, v.pan));
  if (typeof v.fine === 'number') note.fine = Math.max(-100, Math.min(100, v.fine));
  if (v.slide === true) note.slide = true;
  if (typeof v.probability === 'number') note.probability = clamp01(v.probability);
  if (typeof v.ratchet === 'number') note.ratchet = Math.max(1, Math.min(8, Math.round(v.ratchet)));
  if (v.mute === true) note.mute = true;
  return note;
}

// ---------------------------------------------------------------------------------------------
// Playlist

/** Song length in steps: the end of the last clip (at least one bar). */
export function songLengthSteps(song: MusicProject): number {
  const end = song.playlist.clips.reduce((e, c) => Math.max(e, c.start + c.length), 0);
  return Math.max(stepsPerBar(song), end);
}

export function addClip(song: MusicProject, clip: Omit<PlaylistClip, 'id'> & { id?: string }): MusicProject {
  let tracks = song.playlist.tracks;
  if (clip.trackIndex >= tracks.length) tracks = [...tracks, ...Array.from({ length: clip.trackIndex + 1 - tracks.length }, (_, i) => newTrack(tracks.length + i))];
  return { ...song, playlist: { ...song.playlist, tracks, clips: [...song.playlist.clips, { ...clip, id: clip.id ?? musicId() }] } };
}

export const updateClip = (song: MusicProject, id: string, change: (c: PlaylistClip) => PlaylistClip): MusicProject => ({ ...song, playlist: { ...song.playlist, clips: song.playlist.clips.map((c) => (c.id === id ? change(c) : c)) } });
export const removeClips = (song: MusicProject, ids: string[]): MusicProject => ({ ...song, playlist: { ...song.playlist, clips: song.playlist.clips.filter((c) => !ids.includes(c.id)) } });

/** A free playlist track for a span (the lowest index with no clip overlapping it). */
export function freePlaylistTrack(song: MusicProject, start: number, end: number): number {
  for (let i = 0; ; i++) if (!song.playlist.clips.some((c) => c.trackIndex === i && c.start < end && c.start + c.length > start)) return i;
}

// ---------------------------------------------------------------------------------------------
// Validation: a song from disk or a model is mended into a usable shape, never trusted blind.

const num = (v: unknown, d: number, lo = -Infinity, hi = Infinity): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

export function normalizeSong(value: unknown): MusicProject | null {
  if (!value || typeof value !== 'object') return null;
  const s = value as Partial<MusicProject>;
  if (!Array.isArray(s.channels) || !Array.isArray(s.patterns)) return null;
  const base = newSong(typeof s.name === 'string' ? s.name : 'Untitled song');
  const inserts = Array.isArray(s.mixer?.inserts) && s.mixer.inserts.length ? s.mixer.inserts : base.mixer.inserts;
  const patterns = s.patterns.length ? s.patterns : base.patterns;
  return {
    ...base, ...s,
    version: MUSIC_VERSION,
    bpm: num(s.bpm, 120, 20, 999),
    timeSig: Array.isArray(s.timeSig) && s.timeSig.length === 2 ? [num(s.timeSig[0], 4, 1, 32), num(s.timeSig[1], 4, 1, 32)] : [4, 4],
    swing: num(s.swing, 0, 0, 1),
    stepsPerBeat: num(s.stepsPerBeat, 4, 1, 16),
    patterns,
    mixer: { inserts },
    playlist: { tracks: s.playlist?.tracks?.length ? s.playlist.tracks : base.playlist.tracks, clips: s.playlist?.clips ?? [], markers: s.playlist?.markers ?? [], loop: s.playlist?.loop ?? null },
    automations: Array.isArray(s.automations) ? s.automations : [],
    view: { ...base.view, ...(s.view ?? {}), activePatternId: patterns.some((p) => p.id === s.view?.activePatternId) ? s.view!.activePatternId : patterns[0].id },
    seed: num(s.seed, base.seed),
  };
}

/** Effect types a model may name. */
export const isEffectType = (t: unknown): t is EffectType => typeof t === 'string' && t in EFFECT_SPECS;
export const isInstrumentType = (t: unknown): t is InstrumentType => typeof t === 'string' && t in INSTRUMENT_SPECS;
