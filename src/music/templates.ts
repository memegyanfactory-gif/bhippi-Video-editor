// Starting points for the Music Studio: channel presets (a tuned instrument per sound), groove
// templates, and whole-song templates (channels, mixer routing, patterns written by generate.ts, and a
// playlist of sections with markers). The Studio's Browser and the AI's music_new_song /
// music_add_channel / music_arrange all build on these, so a person and a model start from the same
// good-sounding place. Presets and templates are starting points only: every value is plain data the
// song document keeps, and anything can be changed afterwards.
import { generatePart, GROOVES, PART_KINDS, type GenerateRequest, type PartKind } from './generate';
import {
  addChannel, addClip, addPattern, musicId, newChannel, newEffect, newSong, setNotes, songLengthSteps, updateInsert,
} from './model';
import { isScale, SCALES } from './theory';
import { stepsPerBar, type Channel, type DrumPiece, type EffectType, type InstrumentType, type MarkerKind, type MusicProject, type ScaleName } from './types';

export { GROOVES };
export type { Groove } from './generate';

// ---------------------------------------------------------------------------------------------
// Channel presets

export type PresetCategory = 'Drums' | 'Bass' | 'Leads' | 'Pads' | 'Keys' | 'Plucks' | 'FX';
export type ChannelPreset = {
  id: string; name: string; category: PresetCategory; instrument: InstrumentType; drum?: DrumPiece; params: Record<string, number>; about?: string;
  /** Channel settings beyond params. */
  volume?: number; glide?: number; polyphony?: number;
};

const drum = (id: string, name: string, piece: DrumPiece, params: Record<string, number>, about?: string, volume?: number): ChannelPreset => ({ id, name, category: 'Drums', instrument: 'drum', drum: piece, params, about, ...(volume ? { volume } : {}) });
const synth = (id: string, name: string, category: PresetCategory, instrument: InstrumentType, params: Record<string, number>, about?: string, extra: Partial<ChannelPreset> = {}): ChannelPreset => ({ id, name, category, instrument, params, about, ...extra });

export const CHANNEL_PRESETS: ChannelPreset[] = [
  // Drums: every piece in two or three flavours.
  drum('kick-808', '808 Kick', 'kick', { decay: 0.9, tone: 0.3, punch: 0.75, tune: -4, drive: 0.1 }, 'Long round kick with a deep pitch drop: trap, hip-hop.', 0.9),
  drum('kick-punchy', 'Punchy Kick', 'kick', { decay: 0.32, tone: 0.6, punch: 0.85, drive: 0.15 }, 'Short, tight kick that sits under everything: pop, corporate.', 0.9),
  drum('kick-house', 'House Kick', 'kick', { decay: 0.5, tone: 0.45, punch: 0.6, tune: -1 }, 'Round four-on-the-floor kick.', 0.9),
  drum('kick-hard', 'Hard Kick', 'kick', { decay: 0.4, tone: 0.5, punch: 0.7, drive: 0.55 }, 'Distorted techno / hardstyle kick.', 0.9),
  drum('snare-tight', 'Tight Snare', 'snare', { decay: 0.18, tone: 0.55, snap: 0.6, punch: 0.6 }, 'Crisp backbeat snare.'),
  drum('snare-lofi', 'Lofi Snare', 'snare', { decay: 0.28, tone: 0.35, snap: 0.45, punch: 0.3, drive: 0.2, tune: -2 }, 'Soft, dusty snare.', 0.7),
  drum('snare-trap', 'Trap Snare', 'snare', { decay: 0.22, tone: 0.6, snap: 0.7, tune: 2, punch: 0.5 }, 'Bright snare with a short tail.'),
  drum('clap-classic', 'Classic Clap', 'clap', { decay: 0.22, snap: 0.8, tone: 0.5 }, 'Layered hand clap.'),
  drum('clap-wide', 'Wide Clap', 'clap', { decay: 0.4, snap: 0.7, tone: 0.6 }, 'Longer clap with room.', 0.7),
  drum('hat-trap', 'Trap Hat', 'hat', { decay: 0.05, tone: 0.7, snap: 0.6, tune: 3 }, 'Very short, bright closed hat for rolls.', 0.6),
  drum('hat-house', 'House Hat', 'hat', { decay: 0.08, tone: 0.6 }, 'Open-ish closed hat.', 0.6),
  drum('hat-lofi', 'Lofi Hat', 'hat', { decay: 0.1, tone: 0.35, snap: 0.4, gain: 0.7 }, 'Dark, soft hat.', 0.55),
  drum('openhat-house', 'House Open Hat', 'openhat', { decay: 0.35, tone: 0.6 }, 'Offbeat open hat.', 0.6),
  drum('openhat-short', 'Short Open Hat', 'openhat', { decay: 0.2, tone: 0.5 }, 'Quick open hat.', 0.6),
  drum('tom-low', 'Low Tom', 'tom', { tune: -5, decay: 0.5, punch: 0.6 }, 'Floor tom / taiko-ish hit.'),
  drum('tom-high', 'High Tom', 'tom', { tune: 3, decay: 0.35, punch: 0.5 }, 'Rack tom for fills.'),
  drum('rim-click', 'Rim Click', 'rim', { decay: 0.06, tone: 0.7 }, 'Side-stick click.', 0.6),
  drum('cowbell', 'Cowbell', 'cowbell', { decay: 0.25, tone: 0.6 }, 'Funk / reggaeton cowbell.', 0.55),
  drum('crash', 'Crash', 'crash', { decay: 1.8, tone: 0.7 }, 'Crash cymbal for downbeats.', 0.55),
  drum('ride', 'Ride', 'ride', { decay: 1.2, tone: 0.6 }, 'Ride cymbal.', 0.5),
  drum('shaker', 'Shaker', 'shaker', { decay: 0.07, tone: 0.8, snap: 0.7, gain: 0.6 }, 'Fast shaker for groove.', 0.5),
  drum('perc', 'Perc', 'perc', { decay: 0.12, tone: 0.5, tune: 5 }, 'Small tuned percussion hit.', 0.55),
  // Bass
  synth('sub-bass', 'Sub Bass', 'Bass', 'synth', { osc1Wave: 0, osc1Level: 0.9, osc2Level: 0, osc3Level: 0, cutoff: 700, attack: 0.005, decay: 0.3, sustain: 0.9, release: 0.15 }, 'Clean sine sub: sits under everything.', { polyphony: 1, glide: 0.03, volume: 0.85 }),
  synth('reese', 'Reese Bass', 'Bass', 'synth', { osc1Wave: 1, osc1Level: 0.7, osc1Detune: -12, osc2Wave: 1, osc2Level: 0.7, osc2Detune: 12, osc3Wave: 1, osc3Level: 0.5, osc3Octave: -1, cutoff: 900, resonance: 4, lfoTarget: 2, lfoRate: 0.5, lfoDepth: 0.5, lfoShape: 0, release: 0.2 }, 'Detuned saws with a slow filter wobble: drum & bass.', { polyphony: 1, volume: 0.75 }),
  synth('bass-808', '808 Bass', 'Bass', 'bass808', { decay: 1.2, drop: 7, drive: 0.25 }, 'The classic sliding 808 sub.', { volume: 0.85 }),
  synth('bass-808-hard', 'Hard 808', 'Bass', 'bass808', { drive: 0.6, decay: 1.6, punch: 0.7, tone: 0.5 }, 'Distorted 808 that cuts through small speakers.', { volume: 0.8 }),
  synth('bass-808-glide', 'Glide 808', 'Bass', 'bass808', { decay: 2.2, drop: 5, drive: 0.3 }, 'Long 808 for slides (notes with slide:true glide).', { glide: 0.12, volume: 0.85 }),
  synth('acid-bass', 'Acid Bass', 'Bass', 'synth', { osc1Wave: 1, osc1Level: 0.8, osc2Level: 0, cutoff: 500, resonance: 14, filterEnv: 0.6, fDecay: 0.22, fSustain: 0, decay: 0.2, sustain: 0.5, keyTrack: 0.5, velToCutoff: 0.6 }, 'Squelchy resonant 303-style line.', { polyphony: 1, glide: 0.06, volume: 0.75 }),
  synth('pluck-bass', 'Pluck Bass', 'Bass', 'pluck', { damping: 0.5, brightness: 0.35, decay: 0.6, body: 0.5 }, 'Round plucked bass: afrobeats, pop.', { polyphony: 1, volume: 0.85 }),
  synth('fm-bass', 'FM Bass', 'Bass', 'fm', { algorithm: 1, op1Ratio: 1, op1Index: 2.5, op1Decay: 0.35, op2Ratio: 1, op2Index: 1.5, cutoff: 3000 }, 'Punchy electric FM bass.', { polyphony: 1, volume: 0.75 }),
  synth('square-bass', 'Square Bass', 'Bass', 'synth', { osc1Wave: 2, osc1Level: 0.7, osc2Wave: 0, osc2Level: 0.6, osc2Octave: -1, cutoff: 1000 }, 'Hollow square over a sine sub.', { polyphony: 1, volume: 0.75 }),
  // Leads
  synth('supersaw-lead', 'Supersaw Lead', 'Leads', 'synth', { osc1Wave: 1, osc1Level: 0.7, osc2Wave: 1, osc2Level: 0.6, osc2Detune: 12, osc3Level: 0, unison: 5, unisonDetune: 22, unisonSpread: 0.8, cutoff: 9000, attack: 0.01, sustain: 0.8, release: 0.35 }, 'Big detuned saw lead: EDM, pop.', { volume: 0.6 }),
  synth('square-lead', 'Square Lead', 'Leads', 'synth', { osc1Wave: 2, osc1Level: 0.6, osc2Wave: 2, osc2Level: 0.3, osc2Octave: 1, osc2Detune: 8, cutoff: 6000, resonance: 1.5, lfoTarget: 1, lfoRate: 5.5, lfoDepth: 0.05 }, 'Chiptune-ish square with light vibrato.', { volume: 0.55 }),
  synth('pluck-lead', 'Pluck Lead', 'Leads', 'pluck', { damping: 0.3, brightness: 0.7, decay: 1, body: 0.2 }, 'Short bright plucked melody voice.', { volume: 0.7 }),
  synth('saw-lead', 'Saw Lead', 'Leads', 'synth', { osc1Wave: 1, osc1Level: 0.8, osc2Wave: 1, osc2Level: 0.4, osc2Detune: 7, filterEnv: 0.3, cutoff: 4500 }, 'Plain saw lead with a filter blip.', { volume: 0.6 }),
  synth('fm-lead', 'FM Lead', 'Leads', 'fm', { algorithm: 0, op1Ratio: 2, op1Index: 4, feedback: 0.2 }, 'Glassy, metallic FM lead.', { volume: 0.6 }),
  // Pads
  synth('warm-pad', 'Warm Pad', 'Pads', 'pad', { voices: 5, detune: 18, width: 0.8, attack: 0.7, release: 1.6, cutoff: 3000 }, 'Soft analog-style chord bed.', { volume: 0.5 }),
  synth('string-pad', 'String Pad', 'Pads', 'pad', { voices: 7, detune: 14, attack: 0.5, release: 1.4, cutoff: 6500, shimmer: 0.3 }, 'Wide string-ensemble pad.', { volume: 0.5 }),
  synth('choir-pad', 'Choir Pad', 'Pads', 'synth', { osc1Wave: 3, osc1Level: 0.6, osc2Wave: 0, osc2Level: 0.3, osc2Octave: 1, osc3Wave: 1, osc3Level: 0.15, unison: 4, unisonDetune: 12, attack: 0.9, release: 1.8, cutoff: 2200, lfoTarget: 2, lfoDepth: 0.15, lfoRate: 0.3 }, 'Airy "ooh" pad.', { volume: 0.5 }),
  synth('dark-pad', 'Dark Pad', 'Pads', 'pad', { voices: 4, detune: 30, cutoff: 1500, resonance: 2, attack: 1.2, release: 2.5 }, 'Low, moody drone pad: trap, cinematic.', { volume: 0.5 }),
  synth('glass-pad', 'Glass Pad', 'Pads', 'fm', { algorithm: 2, op1Ratio: 2, op1Index: 1.5, op2Ratio: 3, op2Index: 1, attack: 0.8, release: 2 }, 'Cold, glassy FM pad: ambient.', { volume: 0.45 }),
  // Keys
  synth('e-piano', 'Electric Piano', 'Keys', 'keys', { brightness: 0.5, tine: 0.7, hammer: 0.2, decay: 2.5, tremolo: 0.25 }, 'Rhodes-style tines: lofi, neo-soul, pop.', { volume: 0.7 }),
  synth('piano', 'Piano', 'Keys', 'keys', { brightness: 0.55, tine: 0.15, hammer: 0.6, decay: 4 }, 'Acoustic-style piano.', { volume: 0.7 }),
  synth('organ', 'Organ', 'Keys', 'organ', { percussion: 0.4, rotary: 0.5 }, 'Drawbar organ with rotary.', { volume: 0.6 }),
  synth('bell', 'Bell', 'Keys', 'fm', { algorithm: 2, op1Ratio: 3.5, op1Index: 2.5, op1Decay: 1.8, op2Ratio: 7, op2Index: 1, op2Decay: 0.8, attack: 0.002, release: 1.5 }, 'FM bell / celesta.', { volume: 0.55 }),
  // Plucks
  synth('kalimba', 'Kalimba', 'Plucks', 'pluck', { damping: 0.6, brightness: 0.8, decay: 0.9, body: 0.4 }, 'Thumb-piano pluck: lofi, afrobeats.', { volume: 0.6 }),
  synth('harp', 'Harp', 'Plucks', 'pluck', { damping: 0.25, brightness: 0.55, decay: 2.4, body: 0.3 }, 'Long ringing harp.', { volume: 0.6 }),
  synth('guitar-pluck', 'Guitar Pluck', 'Plucks', 'pluck', { damping: 0.45, brightness: 0.5, decay: 1.6, body: 0.6 }, 'Nylon-ish guitar string.', { volume: 0.65 }),
  synth('marimba', 'Marimba', 'Plucks', 'pluck', { damping: 0.75, brightness: 0.45, decay: 0.5, body: 0.7 }, 'Woody mallet pluck.', { volume: 0.65 }),
  // FX
  synth('riser', 'Riser', 'FX', 'noise', { direction: 0, tone: 0.3, startFreq: 300, endFreq: 12000, resonance: 5 }, 'Noise sweep up; note length is the build length.', { volume: 0.6 }),
  synth('downlifter', 'Downlifter', 'FX', 'noise', { direction: 1, tone: 0.3, startFreq: 9000, endFreq: 200, resonance: 4 }, 'Noise sweep down after a drop.', { volume: 0.6 }),
  synth('impact', 'Impact', 'FX', 'noise', { direction: 2, tone: 0.6, startFreq: 120, endFreq: 40, resonance: 2 }, 'Cinematic hit for a drop or a title.', { volume: 0.8 }),
];
export const PRESET_MAP = new Map(CHANNEL_PRESETS.map((p) => [p.id, p]));

/** A preset by id or by (case-insensitive) name. */
export const findPreset = (idOrName: string): ChannelPreset | undefined => PRESET_MAP.get(idOrName) ?? CHANNEL_PRESETS.find((p) => p.name.toLowerCase() === idOrName.toLowerCase().trim());

/** A new channel from a preset, ready for `addChannel`; null for an unknown preset. */
export function presetChannel(song: MusicProject, presetId: string): Channel | null {
  const preset = findPreset(presetId);
  if (!preset) return null;
  return newChannel(song, preset.instrument, {
    name: preset.name, params: { ...preset.params }, group: preset.category,
    ...(preset.drum ? { drum: preset.drum } : {}),
    ...(preset.volume !== undefined ? { volume: preset.volume } : {}),
    ...(preset.glide !== undefined ? { glide: preset.glide } : {}),
    ...(preset.polyphony !== undefined ? { polyphony: preset.polyphony } : {}),
  });
}

// ---------------------------------------------------------------------------------------------
// Arrangement helper (templates and music_arrange share it)

export type SectionSpec = { name: string; kind?: MarkerKind; bars: number; patterns: string[] };

const KIND_WORDS: [RegExp, MarkerKind][] = [[/intro/i, 'intro'], [/pre-?chorus/i, 'prechorus'], [/chorus|hook/i, 'chorus'], [/verse/i, 'verse'], [/drop/i, 'drop'], [/build|riser/i, 'build'], [/break/i, 'breakdown'], [/bridge/i, 'bridge'], [/outro|end/i, 'outro']];
export const sectionKind = (name: string): MarkerKind => KIND_WORDS.find(([re]) => re.test(name))?.[1] ?? 'marker';

/**
 * Lays sections end to end: one pattern clip per pattern per section (it loops to fill the section),
 * each pattern on its own playlist track, a marker at each section start. `append: false` (default)
 * replaces the song's pattern clips and markers; `append: true` continues after the last clip.
 * Patterns are named by id or by name; unknown ones are reported and skipped.
 */
export function layoutSections(song: MusicProject, sections: SectionSpec[], options: { append?: boolean } = {}): { song: MusicProject; errors: string[]; bars: number; laid: number } {
  const errors: string[] = [];
  const bar = stepsPerBar(song);
  let next: MusicProject = song;
  if (!options.append) {
    next = { ...next, playlist: { ...next.playlist, clips: next.playlist.clips.filter((c) => c.kind !== 'pattern'), markers: [] } };
  }
  let at = options.append ? songLengthSteps(song) : 0;
  if (options.append && !song.playlist.clips.length) at = 0;
  const other = new Set(next.playlist.clips.filter((c) => c.kind !== 'pattern').map((c) => c.trackIndex));
  const trackOf = new Map<string, number>();
  for (const c of next.playlist.clips) if (c.kind === 'pattern' && c.patternId && !trackOf.has(c.patternId)) trackOf.set(c.patternId, c.trackIndex);
  const taken = () => new Set([...other, ...trackOf.values()]);
  let laid = 0;
  const bars0 = at / bar;
  for (const section of sections) {
    const length = Math.max(1, Math.round(section.bars)) * bar;
    next = { ...next, playlist: { ...next.playlist, markers: [...next.playlist.markers, { id: musicId(), at, name: section.name, kind: section.kind ?? sectionKind(section.name) }] } };
    for (const ref of section.patterns) {
      const pattern = next.patterns.find((p) => p.id === ref) ?? next.patterns.find((p) => p.name.toLowerCase() === ref.toLowerCase().trim());
      if (!pattern) { errors.push(`section "${section.name}": unknown pattern "${ref}" (known: ${next.patterns.map((p) => `${p.name} [${p.id}]`).join(', ')})`); continue; }
      let track = trackOf.get(pattern.id);
      if (track === undefined) {
        const used = taken();
        track = 0;
        while (used.has(track)) track++;
        trackOf.set(pattern.id, track);
      }
      next = addClip(next, { trackIndex: track, start: at, length, offset: 0, kind: 'pattern', patternId: pattern.id });
      const named = next.playlist.tracks[track];
      if (named && /^Track \d+$/.test(named.name)) next = { ...next, playlist: { ...next.playlist, tracks: next.playlist.tracks.map((t, i) => (i === track ? { ...t, name: pattern.name, color: pattern.color } : t)) } };
      laid++;
    }
    at += length;
  }
  return { song: next, errors, bars: at / bar - bars0, laid };
}

// ---------------------------------------------------------------------------------------------
// Song templates

export const SONG_TEMPLATE_LIST: { id: string; name: string; about: string }[] = [
  { id: 'empty', name: 'Empty', about: 'A blank song: 16 inserts, one empty pattern. Build everything yourself.' },
  { id: 'beat', name: 'Beat', about: '92 BPM boom-bap beat: punchy drums, sub bass and electric-piano stabs.' },
  { id: 'lofi', name: 'Lofi', about: '78 BPM lofi hip-hop: swung drums, rolled 7th chords, kalimba melody, tape-soft mix.' },
  { id: 'trap', name: 'Trap', about: '140 BPM trap: rolling hats, sliding 808 ducked by the kick, dark pad, bell melody, build and drop.' },
  { id: 'house', name: 'House', about: '124 BPM house: four-on-the-floor, offbeat bass and stabs, sidechained pads, build and drop.' },
  { id: 'dnb', name: 'Drum and bass', about: '174 BPM drum & bass: two-step breaks, reese bass, pad and bell lead.' },
  { id: 'cinematic', name: 'Cinematic', about: '84 BPM trailer cue: strings, arpeggiated piano, taiko hits, choir, riser and impact.' },
  { id: 'corporate', name: 'Corporate', about: '112 BPM uplifting bed for explainers and product videos: light drums, piano, pluck lead.' },
  { id: 'pop', name: 'Pop', about: '112 BPM pop: four-on-the-floor, syncopated bass, piano chords, supersaw hook.' },
  { id: 'afrobeats', name: 'Afrobeats', about: '106 BPM afrobeats: syncopated kick, shaker and rim cross-rhythm, plucked chords and kalimba.' },
  { id: 'techno', name: 'Techno', about: '132 BPM techno: hard kick, 16th hats, rolling offbeat bass, acid-ish stabs.' },
  { id: 'ambient', name: 'Ambient', about: '70 BPM drone and pads in a lydian key, sparse bell melody, no drums.' },
];

type Fx = [EffectType, Record<string, number>?, number?];
type Role = { preset: string; name?: string; vol?: number; pan?: number; fx?: Fx[]; duck?: boolean };
type Part = { role: number; part: PartKind; style?: string; density?: number; octave?: number; rate?: number };
type Pat = { name: string; bars: number; parts: Part[] };
type Spec = { bpm: number; root: number; scale: ScaleName; swing?: number; progression: string; groove: string; roles: Role[]; patterns: Pat[]; sections: SectionSpec[] };

const hp = (freq: number): Fx => ['eq', { b1Freq: freq }];
const lp = (freq: number): Fx => ['eq', { b5Type: 4, b5Freq: freq, b5Q: 0.7 }];
const verb = (decay: number, mix: number, size = 0.6): Fx => ['reverb', { decay, size, lowcut: 200 }, mix];
const echo = (sync: number, feedback: number, mix: number): Fx => ['delay', { sync, feedback }, mix];
const comp = (threshold: number, ratio: number, makeup: number): Fx => ['compressor', { threshold, ratio, makeup, attack: 0.01, release: 0.15 }];
const drums = (roles: number[], style?: string, density?: number): Part[] => roles.map((role) => ({ role, part: 'drums' as const, style, density }));

const SPECS: Record<string, Spec> = {
  beat: {
    bpm: 92, root: 0, scale: 'minor', swing: 0.12, progression: 'i-iv-VI-VII', groove: 'boom-bap',
    roles: [
      { preset: 'kick-punchy', vol: 0.9, fx: [comp(-14, 3, 2)] }, { preset: 'snare-tight', vol: 0.8, fx: [verb(0.9, 0.12, 0.3)] }, { preset: 'hat-lofi', vol: 0.5, pan: 0.2 },
      { preset: 'sub-bass', vol: 0.85, fx: [comp(-16, 3, 2)] }, { preset: 'e-piano', vol: 0.65, fx: [verb(1.8, 0.2), lp(7000)] },
    ],
    patterns: [
      { name: 'Drums', bars: 4, parts: drums([0, 1, 2]) },
      { name: 'Bass', bars: 4, parts: [{ role: 3, part: 'bass', style: 'syncopated', density: 0.45 }] },
      { name: 'Chords', bars: 4, parts: [{ role: 4, part: 'chords', style: 'stabs', density: 0.5 }] },
    ],
    sections: [
      { name: 'Intro', bars: 4, patterns: ['Chords'] }, { name: 'Verse', bars: 8, patterns: ['Drums', 'Bass', 'Chords'] },
      { name: 'Hook', bars: 8, patterns: ['Drums', 'Bass', 'Chords'] }, { name: 'Outro', bars: 4, patterns: ['Drums', 'Chords'] },
    ],
  },
  lofi: {
    bpm: 78, root: 5, scale: 'major', swing: 0.3, progression: 'lofi', groove: 'lofi',
    roles: [
      { preset: 'kick-punchy', vol: 0.8, fx: [comp(-14, 2.5, 1.5)] }, { preset: 'snare-lofi', vol: 0.7, fx: [verb(1.2, 0.18, 0.4)] }, { preset: 'hat-lofi', vol: 0.5, pan: 0.25 },
      { preset: 'e-piano', vol: 0.7, fx: [['chorus', { rate: 0.6, depth: 0.35 }], verb(2.6, 0.28), lp(5500)] }, { preset: 'sub-bass', vol: 0.75, fx: [comp(-16, 3, 2)] },
      { preset: 'kalimba', vol: 0.45, pan: -0.15, fx: [echo(5, 0.4, 0.3), verb(2.2, 0.3)] }, { preset: 'warm-pad', vol: 0.3, fx: [lp(3500), verb(3, 0.35)] },
    ],
    patterns: [
      { name: 'Drums', bars: 4, parts: drums([0, 1, 2], 'lofi', 0.45) },
      { name: 'Bass', bars: 4, parts: [{ role: 4, part: 'bass', style: 'syncopated', density: 0.35 }] },
      { name: 'Chords', bars: 4, parts: [{ role: 3, part: 'chords', style: 'lofi', density: 0.5 }] },
      { name: 'Melody', bars: 4, parts: [{ role: 5, part: 'melody', density: 0.3, octave: 5 }] },
      { name: 'Pad', bars: 4, parts: [{ role: 6, part: 'pad' }] },
    ],
    sections: [
      { name: 'Intro', bars: 4, patterns: ['Chords', 'Pad'] }, { name: 'Verse A', bars: 8, patterns: ['Drums', 'Bass', 'Chords', 'Pad'] },
      { name: 'Hook', bars: 8, patterns: ['Drums', 'Bass', 'Chords', 'Melody', 'Pad'] }, { name: 'Verse B', bars: 8, patterns: ['Drums', 'Bass', 'Chords', 'Pad'] },
      { name: 'Outro', bars: 4, patterns: ['Chords', 'Melody', 'Pad'] },
    ],
  },
  trap: {
    bpm: 140, root: 7, scale: 'minor', progression: 'trap-dark', groove: 'trap',
    roles: [
      { preset: 'kick-punchy', vol: 0.9, fx: [comp(-12, 3, 2)] }, { preset: 'snare-trap', vol: 0.8, fx: [verb(1, 0.14, 0.3)] }, { preset: 'clap-classic', vol: 0.55, fx: [verb(1.4, 0.2)] },
      { preset: 'hat-trap', vol: 0.55, pan: 0.2 }, { preset: 'openhat-short', vol: 0.5, pan: -0.2 }, { preset: 'bass-808-glide', vol: 0.85, duck: true, fx: [['distortion', { drive: 0.25, curve: 3, output: -3 }, 0.3]] },
      { preset: 'dark-pad', vol: 0.4, duck: true, fx: [hp(200), verb(3.5, 0.35, 0.8)] }, { preset: 'pluck-lead', vol: 0.6, pan: 0.1, fx: [echo(5, 0.4, 0.28), verb(2, 0.25)] },
      { preset: 'riser', vol: 0.5, fx: [verb(1.5, 0.2)] },
    ],
    patterns: [
      { name: 'Drums', bars: 4, parts: drums([0, 1, 2, 3, 4], 'trap', 0.6) },
      { name: '808', bars: 4, parts: [{ role: 5, part: 'bass', style: '808-slide', density: 0.55 }] },
      { name: 'Pad', bars: 4, parts: [{ role: 6, part: 'pad' }] },
      { name: 'Melody', bars: 4, parts: [{ role: 7, part: 'melody', density: 0.45, octave: 5 }] },
      { name: 'Build', bars: 4, parts: [{ role: 8, part: 'riser' }, { role: 1, part: 'fill' }, { role: 3, part: 'fill' }] },
    ],
    sections: [
      { name: 'Intro', bars: 8, patterns: ['Pad', 'Melody'] }, { name: 'Verse', bars: 8, patterns: ['Drums', '808', 'Pad'] }, { name: 'Build', bars: 4, patterns: ['Build', 'Pad'] },
      { name: 'Drop', bars: 16, patterns: ['Drums', '808', 'Pad', 'Melody'] }, { name: 'Outro', bars: 8, patterns: ['Pad', 'Melody'] },
    ],
  },
  house: {
    bpm: 124, root: 9, scale: 'minor', progression: 'house-minor', groove: 'house',
    roles: [
      { preset: 'kick-house', vol: 0.9, fx: [comp(-12, 3, 2)] }, { preset: 'clap-classic', vol: 0.6, fx: [verb(1.2, 0.15)] }, { preset: 'hat-house', vol: 0.5, pan: 0.2 }, { preset: 'openhat-house', vol: 0.5, pan: -0.15 },
      { preset: 'sub-bass', vol: 0.85, duck: true, fx: [comp(-16, 3, 2)] }, { preset: 'piano', vol: 0.6, duck: true, fx: [verb(1.6, 0.2), hp(150)] }, { preset: 'string-pad', vol: 0.4, duck: true, fx: [hp(200), verb(3, 0.3, 0.7)] },
      { preset: 'pluck-lead', vol: 0.55, pan: 0.15, fx: [echo(5, 0.35, 0.28), verb(1.8, 0.2)] }, { preset: 'riser', vol: 0.5 },
    ],
    patterns: [
      { name: 'Drums', bars: 4, parts: drums([0, 1, 2, 3], 'house', 0.5) },
      { name: 'Bass', bars: 4, parts: [{ role: 4, part: 'bass', style: 'offbeat' }] },
      { name: 'Chords', bars: 4, parts: [{ role: 5, part: 'chords', style: 'stabs', density: 0.55 }] },
      { name: 'Pad', bars: 4, parts: [{ role: 6, part: 'pad' }] },
      { name: 'Lead', bars: 4, parts: [{ role: 7, part: 'melody', density: 0.5, octave: 5 }] },
      { name: 'Build', bars: 4, parts: [{ role: 8, part: 'riser' }, { role: 1, part: 'fill' }, { role: 2, part: 'fill' }] },
    ],
    sections: [
      { name: 'Intro', bars: 8, patterns: ['Drums', 'Pad'] }, { name: 'Verse', bars: 16, patterns: ['Drums', 'Bass', 'Chords', 'Pad'] }, { name: 'Build', bars: 4, patterns: ['Build', 'Pad'] },
      { name: 'Drop', bars: 16, patterns: ['Drums', 'Bass', 'Chords', 'Pad', 'Lead'] }, { name: 'Breakdown', bars: 8, patterns: ['Pad', 'Chords'] },
      { name: 'Drop 2', bars: 16, patterns: ['Drums', 'Bass', 'Chords', 'Pad', 'Lead'] }, { name: 'Outro', bars: 8, patterns: ['Drums', 'Pad'] },
    ],
  },
  dnb: {
    bpm: 174, root: 9, scale: 'minor', progression: 'i-VI-III-VII', groove: 'dnb',
    roles: [
      { preset: 'kick-punchy', vol: 0.9, fx: [comp(-12, 3, 2)] }, { preset: 'snare-tight', vol: 0.8, fx: [verb(0.8, 0.12, 0.3)] }, { preset: 'hat-house', vol: 0.45, pan: 0.2 },
      { preset: 'reese', vol: 0.75, duck: true, fx: [comp(-14, 3, 2), hp(40)] }, { preset: 'warm-pad', vol: 0.4, duck: true, fx: [hp(200), verb(3, 0.3)] }, { preset: 'bell', vol: 0.5, pan: 0.1, fx: [echo(5, 0.4, 0.3), verb(2.4, 0.3)] },
    ],
    patterns: [
      { name: 'Drums', bars: 4, parts: drums([0, 1, 2], 'dnb', 0.55) },
      { name: 'Bass', bars: 4, parts: [{ role: 3, part: 'bass', style: 'syncopated', density: 0.5, octave: 1 }] },
      { name: 'Pad', bars: 4, parts: [{ role: 4, part: 'pad' }] },
      { name: 'Lead', bars: 4, parts: [{ role: 5, part: 'melody', density: 0.4, octave: 5 }] },
    ],
    sections: [
      { name: 'Intro', bars: 8, patterns: ['Pad', 'Lead'] }, { name: 'Drop', bars: 16, patterns: ['Drums', 'Bass', 'Pad', 'Lead'] }, { name: 'Breakdown', bars: 8, patterns: ['Pad', 'Lead'] },
      { name: 'Drop 2', bars: 16, patterns: ['Drums', 'Bass', 'Pad', 'Lead'] }, { name: 'Outro', bars: 8, patterns: ['Drums', 'Pad'] },
    ],
  },
  cinematic: {
    bpm: 84, root: 2, scale: 'minor', progression: 'epic-minor', groove: 'halftime',
    roles: [
      { preset: 'tom-low', name: 'Taiko', vol: 0.9, fx: [verb(2.5, 0.25, 0.8), comp(-14, 3, 2)] }, { preset: 'string-pad', name: 'Strings', vol: 0.6, fx: [verb(4, 0.4, 0.9)] },
      { preset: 'piano', vol: 0.55, fx: [verb(3, 0.35, 0.8)] }, { preset: 'sub-bass', vol: 0.75 }, { preset: 'choir-pad', name: 'Choir', vol: 0.5, fx: [verb(4.5, 0.45, 0.9)] },
      { preset: 'bell', vol: 0.45, pan: 0.15, fx: [echo(5, 0.45, 0.3), verb(3.5, 0.4, 0.9)] }, { preset: 'riser', vol: 0.55, fx: [verb(2, 0.3)] }, { preset: 'impact', vol: 0.8, fx: [verb(3, 0.35, 0.9)] },
    ],
    patterns: [
      { name: 'Perc', bars: 4, parts: [{ role: 0, part: 'drums', style: 'halftime' }] },
      { name: 'Strings', bars: 4, parts: [{ role: 1, part: 'pad', octave: 3 }] },
      { name: 'Piano', bars: 4, parts: [{ role: 2, part: 'arp', style: 'updown', octave: 4 }] },
      { name: 'Bass', bars: 4, parts: [{ role: 3, part: 'bass', style: 'root', density: 0.2, octave: 1 }] },
      { name: 'Choir', bars: 4, parts: [{ role: 4, part: 'chords', style: 'whole', octave: 4 }] },
      { name: 'Melody', bars: 4, parts: [{ role: 5, part: 'melody', density: 0.3, octave: 5 }] },
      { name: 'Build', bars: 4, parts: [{ role: 6, part: 'riser' }, { role: 0, part: 'fill' }] },
      { name: 'Hit', bars: 1, parts: [{ role: 7, part: 'riser', style: 'impact' }] },
    ],
    sections: [
      { name: 'Intro', bars: 8, patterns: ['Strings', 'Piano'] }, { name: 'Build', bars: 8, patterns: ['Strings', 'Piano', 'Bass', 'Build'] },
      { name: 'Climax', bars: 16, patterns: ['Perc', 'Bass', 'Strings', 'Choir', 'Melody', 'Piano', 'Hit'] }, { name: 'Outro', bars: 8, patterns: ['Strings', 'Piano', 'Melody'] },
    ],
  },
  corporate: {
    bpm: 112, root: 0, scale: 'major', progression: 'uplift', groove: 'four-on-the-floor',
    roles: [
      { preset: 'kick-punchy', vol: 0.8, fx: [comp(-14, 2.5, 1.5)] }, { preset: 'clap-classic', vol: 0.5, fx: [verb(1, 0.12)] }, { preset: 'shaker', vol: 0.4, pan: 0.2 }, { preset: 'hat-house', vol: 0.4, pan: -0.2 },
      { preset: 'pluck-bass', vol: 0.8, duck: true }, { preset: 'piano', vol: 0.6, fx: [verb(1.8, 0.2), hp(150)] }, { preset: 'pluck-lead', vol: 0.55, pan: 0.1, fx: [echo(5, 0.3, 0.2), verb(1.8, 0.2)] },
      { preset: 'warm-pad', vol: 0.35, fx: [hp(200), verb(2.8, 0.3)] }, { preset: 'kalimba', vol: 0.4, pan: -0.15, fx: [echo(5, 0.35, 0.25)] },
    ],
    patterns: [
      { name: 'Drums', bars: 4, parts: drums([0, 1, 2, 3], 'four-on-the-floor', 0.45) },
      { name: 'Bass', bars: 4, parts: [{ role: 4, part: 'bass', style: 'syncopated', density: 0.4 }] },
      { name: 'Chords', bars: 4, parts: [{ role: 5, part: 'chords', style: 'syncopated', density: 0.45 }] },
      { name: 'Lead', bars: 4, parts: [{ role: 6, part: 'melody', density: 0.45, octave: 5 }] },
      { name: 'Pad', bars: 4, parts: [{ role: 7, part: 'pad' }] },
      { name: 'Arp', bars: 4, parts: [{ role: 8, part: 'arp', style: 'up', rate: 2 }] },
    ],
    sections: [
      { name: 'Intro', bars: 4, patterns: ['Pad', 'Arp'] }, { name: 'Verse', bars: 8, patterns: ['Drums', 'Bass', 'Chords', 'Pad'] }, { name: 'Chorus', bars: 8, patterns: ['Drums', 'Bass', 'Chords', 'Lead', 'Pad', 'Arp'] },
      { name: 'Verse 2', bars: 8, patterns: ['Drums', 'Bass', 'Chords', 'Pad', 'Arp'] }, { name: 'Outro', bars: 4, patterns: ['Chords', 'Lead', 'Pad'] },
    ],
  },
  pop: {
    bpm: 112, root: 0, scale: 'major', progression: 'pop-axis', groove: 'four-on-the-floor',
    roles: [
      { preset: 'kick-punchy', vol: 0.85, fx: [comp(-12, 3, 2)] }, { preset: 'snare-tight', vol: 0.75, fx: [verb(1, 0.15, 0.3)] }, { preset: 'clap-classic', vol: 0.5 }, { preset: 'hat-house', vol: 0.45, pan: 0.2 },
      { preset: 'sub-bass', vol: 0.85, duck: true, fx: [comp(-16, 3, 2)] }, { preset: 'e-piano', vol: 0.6, fx: [['chorus', { rate: 0.7, depth: 0.3 }], verb(1.8, 0.2)] },
      { preset: 'supersaw-lead', vol: 0.5, pan: 0.1, fx: [echo(5, 0.3, 0.2), verb(2, 0.25)] }, { preset: 'warm-pad', vol: 0.35, duck: true, fx: [hp(200), verb(3, 0.3)] }, { preset: 'riser', vol: 0.45 },
    ],
    patterns: [
      { name: 'Drums', bars: 4, parts: drums([0, 1, 2, 3], 'four-on-the-floor', 0.5) },
      { name: 'Bass', bars: 4, parts: [{ role: 4, part: 'bass', style: 'syncopated', density: 0.5 }] },
      { name: 'Chords', bars: 4, parts: [{ role: 5, part: 'chords', style: 'syncopated', density: 0.5 }] },
      { name: 'Hook', bars: 4, parts: [{ role: 6, part: 'melody', density: 0.5, octave: 5 }] },
      { name: 'Pad', bars: 4, parts: [{ role: 7, part: 'pad' }] },
      { name: 'Build', bars: 4, parts: [{ role: 8, part: 'riser' }, { role: 1, part: 'fill' }] },
    ],
    sections: [
      { name: 'Intro', bars: 4, patterns: ['Chords', 'Pad'] }, { name: 'Verse', bars: 8, patterns: ['Drums', 'Bass', 'Chords'] }, { name: 'Pre-chorus', bars: 4, patterns: ['Build', 'Chords', 'Pad'] },
      { name: 'Chorus', bars: 8, patterns: ['Drums', 'Bass', 'Chords', 'Hook', 'Pad'] }, { name: 'Verse 2', bars: 8, patterns: ['Drums', 'Bass', 'Chords'] },
      { name: 'Chorus 2', bars: 8, patterns: ['Drums', 'Bass', 'Chords', 'Hook', 'Pad'] }, { name: 'Outro', bars: 4, patterns: ['Chords', 'Pad'] },
    ],
  },
  afrobeats: {
    bpm: 106, root: 7, scale: 'major', swing: 0.08, progression: 'afrobeats', groove: 'afrobeats',
    roles: [
      { preset: 'kick-punchy', vol: 0.85, fx: [comp(-12, 3, 2)] }, { preset: 'clap-classic', vol: 0.6, fx: [verb(1, 0.15)] }, { preset: 'hat-house', vol: 0.4, pan: 0.2 }, { preset: 'shaker', vol: 0.4, pan: -0.2 },
      { preset: 'rim-click', vol: 0.5, pan: 0.15 }, { preset: 'perc', vol: 0.45, pan: -0.25 }, { preset: 'pluck-bass', vol: 0.85, duck: true, fx: [comp(-16, 3, 2)] },
      { preset: 'e-piano', vol: 0.55, fx: [verb(1.6, 0.18)] }, { preset: 'kalimba', vol: 0.5, pan: 0.15, fx: [echo(5, 0.35, 0.25), verb(1.8, 0.2)] },
    ],
    patterns: [
      { name: 'Drums', bars: 4, parts: drums([0, 1, 2, 3, 4, 5], 'afrobeats', 0.5) },
      { name: 'Bass', bars: 4, parts: [{ role: 6, part: 'bass', style: 'syncopated', density: 0.55 }] },
      { name: 'Chords', bars: 4, parts: [{ role: 7, part: 'chords', style: 'syncopated', density: 0.5 }] },
      { name: 'Melody', bars: 4, parts: [{ role: 8, part: 'melody', density: 0.5, octave: 5 }] },
    ],
    sections: [
      { name: 'Intro', bars: 4, patterns: ['Chords', 'Melody'] }, { name: 'Verse', bars: 8, patterns: ['Drums', 'Bass', 'Chords'] }, { name: 'Chorus', bars: 8, patterns: ['Drums', 'Bass', 'Chords', 'Melody'] },
      { name: 'Verse 2', bars: 8, patterns: ['Drums', 'Bass', 'Chords'] }, { name: 'Chorus 2', bars: 8, patterns: ['Drums', 'Bass', 'Chords', 'Melody'] }, { name: 'Outro', bars: 4, patterns: ['Chords', 'Melody'] },
    ],
  },
  techno: {
    bpm: 132, root: 0, scale: 'minor', progression: 'i-i-i-VII', groove: 'techno',
    roles: [
      { preset: 'kick-hard', vol: 0.9, fx: [comp(-12, 3, 2)] }, { preset: 'hat-house', vol: 0.4, pan: 0.2 }, { preset: 'openhat-house', vol: 0.45, pan: -0.2 }, { preset: 'clap-classic', vol: 0.5, fx: [verb(1.2, 0.18)] },
      { preset: 'rim-click', vol: 0.45, pan: 0.2 }, { preset: 'sub-bass', name: 'Rolling Bass', vol: 0.8, duck: true, fx: [comp(-14, 3, 2)] },
      { preset: 'saw-lead', name: 'Stab', vol: 0.5, pan: 0.1, duck: true, fx: [echo(5, 0.45, 0.3), verb(2, 0.2), hp(200)] }, { preset: 'acid-bass', vol: 0.5, fx: [echo(4, 0.3, 0.2)] }, { preset: 'riser', vol: 0.5 },
    ],
    patterns: [
      { name: 'Drums', bars: 4, parts: drums([0, 1, 2, 3, 4], 'techno', 0.55) },
      { name: 'Bass', bars: 4, parts: [{ role: 5, part: 'bass', style: 'offbeat' }] },
      { name: 'Stabs', bars: 4, parts: [{ role: 6, part: 'chords', style: 'offbeat', density: 0.4, octave: 4 }] },
      { name: 'Acid', bars: 4, parts: [{ role: 7, part: 'bass', style: 'syncopated', density: 0.7, octave: 2 }] },
      { name: 'Build', bars: 4, parts: [{ role: 8, part: 'riser' }, { role: 3, part: 'fill' }, { role: 1, part: 'fill' }] },
    ],
    sections: [
      { name: 'Intro', bars: 8, patterns: ['Drums'] }, { name: 'Groove', bars: 16, patterns: ['Drums', 'Bass', 'Stabs'] }, { name: 'Build', bars: 4, patterns: ['Build', 'Bass'] },
      { name: 'Peak', bars: 16, patterns: ['Drums', 'Bass', 'Stabs', 'Acid'] }, { name: 'Outro', bars: 8, patterns: ['Drums', 'Bass'] },
    ],
  },
  ambient: {
    bpm: 70, root: 2, scale: 'lydian', progression: 'Imaj7-II-vi7-V', groove: 'halftime',
    roles: [
      { preset: 'warm-pad', vol: 0.6, fx: [verb(5, 0.45, 0.9)] }, { preset: 'glass-pad', vol: 0.4, pan: 0.2, fx: [['chorus', { rate: 0.3, depth: 0.5 }], verb(6, 0.45, 0.9)] },
      { preset: 'bell', vol: 0.4, pan: -0.15, fx: [echo(3, 0.5, 0.35), verb(5, 0.5, 0.9)] }, { preset: 'sub-bass', name: 'Drone', vol: 0.6, fx: [lp(400)] }, { preset: 'riser', vol: 0.3, fx: [verb(4, 0.4, 0.9)] },
    ],
    patterns: [
      { name: 'Pad', bars: 4, parts: [{ role: 0, part: 'pad', octave: 3 }] },
      { name: 'Glass', bars: 4, parts: [{ role: 1, part: 'chords', style: 'whole', octave: 4 }] },
      { name: 'Bells', bars: 4, parts: [{ role: 2, part: 'melody', density: 0.15, octave: 5 }] },
      { name: 'Drone', bars: 4, parts: [{ role: 3, part: 'bass', style: 'root', density: 0, octave: 1 }] },
      { name: 'Swell', bars: 4, parts: [{ role: 4, part: 'riser' }] },
    ],
    sections: [
      { name: 'Intro', bars: 8, patterns: ['Pad', 'Drone'] }, { name: 'Theme', bars: 16, patterns: ['Pad', 'Glass', 'Bells', 'Drone'] }, { name: 'Swell', bars: 4, patterns: ['Pad', 'Glass', 'Swell'] },
      { name: 'Theme 2', bars: 16, patterns: ['Pad', 'Glass', 'Bells', 'Drone'] }, { name: 'Outro', bars: 8, patterns: ['Pad', 'Drone'] },
    ],
  },
};

export type TemplateOptions = { name?: string; bpm?: number; root?: number; scale?: ScaleName; seed?: number };

/**
 * A whole song from a template: tuned channels, mixer routing and effects (EQ, compression, reverb,
 * delay, a kick-driven sidechain on bass and pads), patterns written by generate.ts and a playlist of
 * sections with markers. Throws for an unknown template id.
 */
export function songFromTemplate(id: string, options: TemplateOptions = {}): MusicProject {
  const info = SONG_TEMPLATE_LIST.find((t) => t.id === id);
  if (!info) throw new Error(`Unknown song template "${id}". Use one of: ${SONG_TEMPLATE_LIST.map((t) => t.id).join(', ')}.`);
  const spec = SPECS[id];
  const seed = Math.floor(options.seed ?? Math.random() * 1e9);
  let song = newSong(options.name ?? `${info.name} song`, spec?.bpm ?? 120);
  song = { ...song, seed };
  if (options.bpm !== undefined && Number.isFinite(options.bpm)) song = { ...song, bpm: Math.min(999, Math.max(20, options.bpm)) };
  if (!spec) {
    return { ...song, bpm: options.bpm ?? 120, key: { root: options.root ?? 0, scale: options.scale && isScale(options.scale) ? options.scale : 'minor' } };
  }
  song = {
    ...song, swing: spec.swing ?? 0,
    key: { root: options.root !== undefined ? ((Math.round(options.root) % 12) + 12) % 12 : spec.root, scale: options.scale && options.scale in SCALES ? options.scale : spec.scale },
  };
  // Master: a gentle glue compressor ahead of the limiter newSong put there.
  song = updateInsert(song, 0, (ins) => ({ ...ins, effects: [newEffect('compressor', { threshold: -10, ratio: 2, makeup: 1.5, attack: 0.03, release: 0.2 }), ...ins.effects] }));

  // Channels, one insert each.
  const channels: Channel[] = [];
  spec.roles.forEach((role, i) => {
    const base = presetChannel(song, role.preset);
    if (!base) throw new Error(`Template ${id}: unknown preset ${role.preset}`);
    const channel: Channel = { ...base, insert: i + 1, ...(role.name ? { name: role.name } : {}), ...(role.vol !== undefined ? { volume: role.vol } : {}), ...(role.pan !== undefined ? { pan: role.pan } : {}) };
    song = addChannel(song, channel);
    channels.push(channel);
    if (role.fx?.length) {
      song = updateInsert(song, channel.insert, (ins) => ({
        ...ins, effects: role.fx!.map(([type, params, mix]) => { const fx = newEffect(type, params ?? {}); return mix === undefined ? fx : { ...fx, mix }; }),
      }));
    }
  });
  // The kick drives the ducking of whatever asked for it.
  const kick = channels.find((c) => c.drum === 'kick');
  if (kick) {
    const ducked = spec.roles.map((r, i) => (r.duck ? channels[i].insert : -1)).filter((i) => i > 0);
    if (ducked.length) {
      song = updateInsert(song, kick.insert, (ins) => ({ ...ins, sends: [...ins.sends, ...ducked.map((to) => ({ to, level: 1, sidechain: true }))] }));
      for (const to of ducked) song = updateInsert(song, to, (ins) => ({ ...ins, effects: [newEffect('sidechain', { amount: 0.6, attack: 0.005, release: 0.2, threshold: -24 }), ...ins.effects] }));
    }
  }

  // Patterns: the template's own first, replacing newSong's empty one.
  song = { ...song, patterns: [] };
  spec.patterns.forEach((pat, pi) => {
    const added = addPattern(song, pat.bars, pat.name);
    song = added.song;
    pat.parts.forEach((part, k) => {
      const request: GenerateRequest = {
        part: part.part, style: part.style ?? (part.part === 'drums' || part.part === 'fill' ? spec.groove : undefined), bars: pat.bars, density: part.density, octave: part.octave,
        progression: spec.progression, seed: seed + pi * 31 + k * 7, channel: channels[part.role], rate: part.rate,
      };
      const notes = generatePart(song, request);
      // Parts stack on a channel inside one pattern (a fill on top of a groove).
      const existing = song.patterns.find((p) => p.id === added.pattern.id)?.notes[channels[part.role].id] ?? [];
      const merged = request.part === 'fill' ? [...existing, ...notes] : notes;
      song = setNotes(song, added.pattern.id, channels[part.role].id, merged);
    });
  });
  const laid = layoutSections(song, spec.sections);
  song = laid.song;
  const first = song.patterns[0];
  return { ...song, view: { mode: 'song', activePatternId: first?.id ?? null, selectedChannelId: channels[0]?.id ?? null, window: 'playlist' } };
}

export const isPartKind = (p: unknown): p is PartKind => typeof p === 'string' && (PART_KINDS as string[]).includes(p);
