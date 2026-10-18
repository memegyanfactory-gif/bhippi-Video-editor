// The Music Studio's song document (docs/MUSIC-STUDIO-PLAN.md §4). This file is the contract the
// engine, the studio UI and the AI tools all build on: the song fully describes the sound, so a model
// editing this JSON gets exactly what a person gets with the mouse.
//
// All time is in STEPS (a sixteenth note at the default 4 steps per beat), as floats.

export const MUSIC_VERSION = 1 as const;

export type ScaleName =
  | 'major' | 'minor' | 'harmonic-minor' | 'melodic-minor' | 'dorian' | 'phrygian' | 'lydian' | 'mixolydian' | 'locrian'
  | 'major-pentatonic' | 'minor-pentatonic' | 'blues' | 'whole-tone' | 'chromatic' | 'phrygian-dominant' | 'hungarian-minor'
  | 'japanese' | 'arabic' | 'bebop' | 'lydian-dominant' | 'super-locrian' | 'neapolitan-minor' | 'double-harmonic' | 'egyptian';

export type InstrumentType =
  | 'synth' | 'fm' | 'drum' | 'bass808' | 'sampler' | 'pluck' | 'pad' | 'organ' | 'keys' | 'noise';

export type DrumPiece =
  | 'kick' | 'snare' | 'clap' | 'hat' | 'openhat' | 'tom' | 'rim' | 'cowbell' | 'crash' | 'ride' | 'shaker' | 'perc';

export type EffectType =
  | 'eq' | 'compressor' | 'limiter' | 'reverb' | 'delay' | 'chorus' | 'flanger' | 'phaser' | 'distortion'
  | 'bitcrusher' | 'filter' | 'stereo' | 'sidechain' | 'gate' | 'tremolo';

export type Note = {
  id: string;
  /** MIDI key 0–127 (60 = C4). Drum channels play their piece; the key only tunes it. */
  key: number;
  /** Start in steps from the pattern start. */
  start: number;
  /** Length in steps (> 0). */
  length: number;
  /** 0–1. */
  velocity: number;
  /** -1 (left) … 1 (right); unset = centre. */
  pan?: number;
  /** Fine pitch in cents, -100…100. */
  fine?: number;
  /** Glides from the previous note's pitch into this one. */
  slide?: boolean;
  /** 0–1 chance the note plays (deterministic per seed + note id in a render). */
  probability?: number;
  /** Retriggers the note this many times within its length (1 = normal). */
  ratchet?: number;
  mute?: boolean;
};

export type Channel = {
  id: string;
  name: string;
  color: string;
  instrument: InstrumentType;
  /** Instrument parameters by name; ranges in INSTRUMENT_SPECS. Missing values take the default. */
  params: Record<string, number>;
  /** A drum channel's piece. */
  drum?: DrumPiece;
  /** A sampler channel's audio (a bin asset id). */
  sampleAssetId?: string | null;
  /** 0–1.25 (1 = unity). */
  volume: number;
  pan: number;
  mute: boolean;
  solo: boolean;
  /** Mixer insert index this channel feeds (0 = master). */
  insert: number;
  /** Per-channel swing 0–1, overrides the song's when set. */
  swing?: number;
  /** Max voices; 1 = mono (legato glide when `glide` > 0). */
  polyphony: number;
  /** Glide time in seconds for slides / mono legato. */
  glide: number;
  /** A sampler's root key (the key the sample plays unpitched). */
  rootKey: number;
  /** Channel Rack filter group ("Drums", "Bass", …). */
  group?: string;
};

export type Pattern = {
  id: string;
  name: string;
  color: string;
  /** Length in bars. */
  bars: number;
  /** Notes by channel id. A step is a note one step long. */
  notes: Record<string, Note[]>;
};

export type PlaylistTrack = { id: string; name: string; color: string; mute: boolean; solo: boolean; locked?: boolean };

export type PlaylistClip = {
  id: string;
  trackIndex: number;
  /** Start in steps on the song timeline. */
  start: number;
  /** Length in steps. */
  length: number;
  /** Steps into the source the clip starts at (a pattern loops past its end). */
  offset: number;
  kind: 'pattern' | 'audio' | 'automation';
  patternId?: string;
  assetId?: string;
  automationId?: string;
  /** Audio clips: dB gain and fades in seconds. */
  gain?: number;
  fadeIn?: number;
  fadeOut?: number;
  muted?: boolean;
};

export type MarkerKind = 'marker' | 'intro' | 'verse' | 'prechorus' | 'chorus' | 'drop' | 'build' | 'breakdown' | 'bridge' | 'outro';
export type PlaylistMarker = { id: string; at: number; name: string; kind: MarkerKind };

export type Effect = {
  id: string;
  type: EffectType;
  enabled: boolean;
  /** Dry/wet 0–1. */
  mix: number;
  params: Record<string, number>;
};

export type Send = { to: number; level: number; /** Feeds the target's sidechain input instead of its audio. */ sidechain?: boolean };

export type MixerInsert = {
  id: string;
  name: string;
  color: string;
  /** Fader in dB (-60…+6); -60 is silence. */
  volume: number;
  pan: number;
  /** Stereo width 0 (mono) … 2. */
  width: number;
  mute: boolean;
  solo: boolean;
  invert?: boolean;
  /** Where this insert goes besides master (index 0 = master gets everything not routed elsewhere). */
  sends: Send[];
  /** Up to MAX_EFFECTS slots, in order. */
  effects: Effect[];
  /** When false, the insert's output does not go to master directly (only through its sends). */
  toMaster?: boolean;
};

export type AutomationTarget =
  | { kind: 'channel'; channelId: string; param: string }
  | { kind: 'insert'; insert: number; param: 'volume' | 'pan' | 'width' }
  | { kind: 'effect'; insert: number; effectId: string; param: string }
  | { kind: 'send'; insert: number; to: number }
  | { kind: 'tempo' };

export type AutomationCurve = 'hold' | 'linear' | 'smooth' | 'exp';
export type AutomationPoint = { t: number; v: number; curve?: AutomationCurve };
export type Automation = { id: string; name: string; target: AutomationTarget; points: AutomationPoint[] };

export type MusicView = {
  mode: 'pattern' | 'song';
  activePatternId: string | null;
  selectedChannelId: string | null;
  window?: 'playlist' | 'rack' | 'pianoroll' | 'mixer';
};

export type MusicProject = {
  version: typeof MUSIC_VERSION;
  name: string;
  bpm: number;
  timeSig: [number, number];
  /** 0–1. */
  swing: number;
  key: { root: number; scale: ScaleName };
  /** dB. */
  masterVolume: number;
  /** Semitones. */
  masterPitch: number;
  stepsPerBeat: number;
  channels: Channel[];
  patterns: Pattern[];
  playlist: { tracks: PlaylistTrack[]; clips: PlaylistClip[]; markers: PlaylistMarker[]; loop?: { start: number; end: number } | null };
  mixer: { inserts: MixerInsert[] };
  automations: Automation[];
  view: MusicView;
  /** Seed for noise, probability and humanise, so renders repeat. */
  seed: number;
  /** Where the bounced song sits on the video timeline, one entry per composition (src/music/timeline.ts). */
  placements?: SongPlacement[];
};

/** The song's music layer on one composition: sending the song again refreshes this clip in place. */
export type SongPlacement = {
  compId: string;
  clipId: string;
  trackId: string;
  assetId: string;
  bpm: number;
  /** Beat and downbeat times in seconds from the start of the bounce (the clip's source time). */
  beats: number[];
  downbeats: number[];
  placedAt: number;
};

// ---------------------------------------------------------------------------------------------
// Parameter specs: the UI renders knobs from these, the AI reads valid ranges from them.

export type ParamSpec = { name: string; label: string; min: number; max: number; default: number; unit?: string; step?: number; options?: string[]; about?: string };

const p = (name: string, label: string, min: number, max: number, def: number, unit?: string, extra: Partial<ParamSpec> = {}): ParamSpec => ({ name, label, min, max, default: def, ...(unit ? { unit } : {}), ...extra });

const WAVES = ['sine', 'saw', 'square', 'triangle', 'noise', 'pulse'];
const FILTERS = ['lowpass', 'highpass', 'bandpass', 'notch'];
const LFO_TARGETS = ['off', 'pitch', 'cutoff', 'amp', 'pan'];

/** The amp + filter envelope and filter every pitched instrument shares. */
const SHAPE: ParamSpec[] = [
  p('attack', 'Attack', 0, 4, 0.005, 's'), p('decay', 'Decay', 0, 4, 0.2, 's'), p('sustain', 'Sustain', 0, 1, 0.7), p('release', 'Release', 0, 8, 0.25, 's'),
  p('filterType', 'Filter', 0, 3, 0, undefined, { step: 1, options: FILTERS }), p('cutoff', 'Cutoff', 20, 20000, 12000, 'Hz'), p('resonance', 'Resonance', 0, 30, 0.7),
  p('filterEnv', 'Filter env', -1, 1, 0, undefined, { about: 'How far the filter envelope opens the cutoff (fraction of the range, ± ).' }),
  p('fAttack', 'F attack', 0, 4, 0.01, 's'), p('fDecay', 'F decay', 0, 4, 0.3, 's'), p('fSustain', 'F sustain', 0, 1, 0.5), p('fRelease', 'F release', 0, 8, 0.3, 's'),
  p('keyTrack', 'Key track', 0, 1, 0.3), p('velToCutoff', 'Vel→cutoff', 0, 1, 0.3),
  p('lfoTarget', 'LFO target', 0, 4, 0, undefined, { step: 1, options: LFO_TARGETS }), p('lfoShape', 'LFO shape', 0, 3, 0, undefined, { step: 1, options: ['sine', 'triangle', 'square', 'saw'] }),
  p('lfoRate', 'LFO rate', 0.01, 20, 4, 'Hz'), p('lfoSync', 'LFO sync', 0, 8, 0, undefined, { step: 1, options: ['free', '4 bars', '2 bars', '1 bar', '1/2', '1/4', '1/8', '1/16', '1/32'] }), p('lfoDepth', 'LFO depth', 0, 1, 0),
  p('gain', 'Gain', 0, 2, 0.8),
];

export const INSTRUMENT_SPECS: Record<InstrumentType, { label: string; about: string; params: ParamSpec[] }> = {
  synth: {
    label: 'Bhippi Synth', about: '3 oscillators (sine/saw/square/triangle/noise/pulse) with unison, filter, two envelopes and an LFO — leads, basses, pads, keys.',
    params: [
      ...[1, 2, 3].flatMap((n) => [
        p(`osc${n}Wave`, `Osc ${n} wave`, 0, 5, n === 1 ? 1 : n === 2 ? 2 : 0, undefined, { step: 1, options: WAVES }),
        p(`osc${n}Level`, `Osc ${n} level`, 0, 1, n === 1 ? 0.8 : n === 2 ? 0.4 : 0),
        p(`osc${n}Octave`, `Osc ${n} octave`, -3, 3, n === 3 ? -1 : 0, 'oct', { step: 1 }),
        p(`osc${n}Semi`, `Osc ${n} semi`, -12, 12, 0, 'st', { step: 1 }),
        p(`osc${n}Detune`, `Osc ${n} detune`, -100, 100, n === 2 ? 7 : 0, 'ct'),
        p(`osc${n}Width`, `Osc ${n} pulse width`, 0.05, 0.95, 0.5),
      ]),
      p('unison', 'Unison', 1, 8, 1, 'voices', { step: 1 }), p('unisonDetune', 'Uni detune', 0, 100, 15, 'ct'), p('unisonSpread', 'Uni spread', 0, 1, 0.6),
      ...SHAPE,
    ],
  },
  fm: {
    label: 'FM Synth', about: '4-operator FM (DX-style): bells, e-pianos, metallic leads, growls.',
    params: [
      p('algorithm', 'Algorithm', 0, 4, 0, undefined, { step: 1, options: ['1→carrier', '2→1→carrier', 'parallel 1+2', 'stack 3→2→1', 'two pairs'] }),
      ...[1, 2, 3].flatMap((n) => [p(`op${n}Ratio`, `Op ${n} ratio`, 0.25, 16, n === 1 ? 2 : n === 2 ? 3 : 1), p(`op${n}Index`, `Op ${n} index`, 0, 20, n === 1 ? 3 : 0), p(`op${n}Decay`, `Op ${n} decay`, 0.01, 6, 0.6, 's')]),
      p('feedback', 'Feedback', 0, 1, 0),
      ...SHAPE,
    ],
  },
  drum: {
    label: 'Drum Synth', about: 'Synthesized kit piece chosen by the channel\'s drum (kick, snare, clap, hat, openhat, tom, rim, cowbell, crash, ride, shaker, perc).',
    params: [
      p('tune', 'Tune', -24, 24, 0, 'st'), p('decay', 'Decay', 0.02, 3, 0.4, 's'), p('tone', 'Tone', 0, 1, 0.5), p('snap', 'Snap/noise', 0, 1, 0.5),
      p('punch', 'Punch', 0, 1, 0.5, undefined, { about: 'Pitch-sweep depth on kicks and toms, transient on snares.' }), p('drive', 'Drive', 0, 1, 0), p('gain', 'Gain', 0, 2, 0.9),
    ],
  },
  bass808: {
    label: '808 Bass', about: 'Sine 808 with pitch drop, slide/glide between notes and drive.',
    params: [p('decay', 'Decay', 0.05, 6, 1.2, 's'), p('punch', 'Punch', 0, 1, 0.5), p('drop', 'Pitch drop', 0, 24, 7, 'st'), p('dropTime', 'Drop time', 0.005, 0.3, 0.04, 's'), p('drive', 'Drive', 0, 1, 0.25), p('tone', 'Tone', 0, 1, 0.3), p('gain', 'Gain', 0, 2, 0.9)],
  },
  sampler: {
    label: 'Sampler', about: 'Plays an audio file from the bin pitched by key; one-shot or looped, with envelope and filter.',
    params: [
      p('start', 'Start', 0, 1, 0), p('end', 'End', 0, 1, 1), p('loop', 'Loop', 0, 1, 0, undefined, { step: 1, options: ['off', 'on'] }), p('reverse', 'Reverse', 0, 1, 0, undefined, { step: 1, options: ['off', 'on'] }),
      p('oneShot', 'One shot', 0, 1, 1, undefined, { step: 1, options: ['off', 'on'], about: 'On: plays to its end whatever the note length.' }), p('tune', 'Tune', -24, 24, 0, 'st'),
      ...SHAPE,
    ],
  },
  pluck: {
    label: 'Pluck', about: 'Karplus-Strong string: guitars, harps, kalimba, plucked leads.',
    params: [p('damping', 'Damping', 0, 1, 0.4), p('brightness', 'Brightness', 0, 1, 0.6), p('decay', 'Decay', 0.1, 8, 1.5, 's'), p('body', 'Body', 0, 1, 0.3), ...SHAPE.filter((s) => ['cutoff', 'resonance', 'filterType', 'release', 'gain'].includes(s.name))],
  },
  pad: {
    label: 'Supersaw Pad', about: 'Detuned saw stack with slow envelopes: pads, chords, trance leads.',
    params: [p('voices', 'Voices', 1, 9, 7, undefined, { step: 1 }), p('detune', 'Detune', 0, 100, 25, 'ct'), p('width', 'Width', 0, 1, 0.8), p('shimmer', 'Shimmer', 0, 1, 0.2), ...SHAPE.map((s) => (s.name === 'attack' ? { ...s, default: 0.4 } : s.name === 'release' ? { ...s, default: 1.2 } : s.name === 'cutoff' ? { ...s, default: 5000 } : s))],
  },
  organ: {
    label: 'Organ', about: 'Additive drawbar organ with percussion and rotary chorus.',
    params: [...['16\'', '5⅓\'', '8\'', '4\'', '2⅔\'', '2\'', '1⅗\'', '1⅓\'', '1\''].map((label, i) => p(`bar${i + 1}`, `Drawbar ${label}`, 0, 8, [8, 8, 8, 0, 0, 0, 0, 0, 0][i], undefined, { step: 1 })), p('percussion', 'Percussion', 0, 1, 0.3), p('rotary', 'Rotary', 0, 1, 0.3), p('click', 'Key click', 0, 1, 0.2), ...SHAPE.filter((s) => ['attack', 'release', 'gain'].includes(s.name))],
  },
  keys: {
    label: 'Keys', about: 'Electric / acoustic-style piano: tines, hammer, brightness with velocity.',
    params: [p('brightness', 'Brightness', 0, 1, 0.5), p('tine', 'Tine', 0, 1, 0.5), p('hammer', 'Hammer', 0, 1, 0.3), p('decay', 'Decay', 0.2, 10, 3, 's'), p('tremolo', 'Tremolo', 0, 1, 0), ...SHAPE.filter((s) => ['release', 'cutoff', 'gain'].includes(s.name))],
  },
  noise: {
    label: 'FX / Riser', about: 'Filtered noise and tone sweeps: risers, downlifters, impacts, whooshes. Note length is the sweep length.',
    params: [p('direction', 'Direction', 0, 2, 0, undefined, { step: 1, options: ['up (riser)', 'down (downlifter)', 'impact'] }), p('tone', 'Tone mix', 0, 1, 0.3), p('startFreq', 'Start freq', 20, 20000, 300, 'Hz'), p('endFreq', 'End freq', 20, 20000, 9000, 'Hz'), p('resonance', 'Resonance', 0, 30, 4), p('gain', 'Gain', 0, 2, 0.7)],
  },
};

export const EFFECT_SPECS: Record<EffectType, { label: string; about: string; params: ParamSpec[] }> = {
  eq: {
    label: 'Parametric EQ', about: '7 bands; each band type 0 off, 1 lowshelf, 2 peaking, 3 highshelf, 4 lowpass, 5 highpass, 6 notch.',
    params: [1, 2, 3, 4, 5, 6, 7].flatMap((n) => [
      p(`b${n}Type`, `Band ${n} type`, 0, 6, n === 1 ? 5 : n === 7 ? 3 : n === 4 ? 2 : 0, undefined, { step: 1, options: ['off', 'lowshelf', 'peaking', 'highshelf', 'lowpass', 'highpass', 'notch'] }),
      p(`b${n}Freq`, `Band ${n} freq`, 20, 20000, [30, 100, 250, 1000, 3000, 6000, 10000][n - 1], 'Hz'),
      p(`b${n}Gain`, `Band ${n} gain`, -24, 24, 0, 'dB'),
      p(`b${n}Q`, `Band ${n} Q`, 0.1, 18, 0.9),
    ]),
  },
  compressor: { label: 'Compressor', about: 'Dynamics compressor with makeup gain.', params: [p('threshold', 'Threshold', -60, 0, -18, 'dB'), p('ratio', 'Ratio', 1, 20, 4), p('attack', 'Attack', 0, 1, 0.01, 's'), p('release', 'Release', 0.01, 1, 0.15, 's'), p('knee', 'Knee', 0, 40, 6, 'dB'), p('makeup', 'Makeup', 0, 24, 3, 'dB')] },
  limiter: { label: 'Limiter', about: 'Brickwall-style limiter (fast compressor + ceiling).', params: [p('ceiling', 'Ceiling', -12, 0, -0.3, 'dB'), p('gain', 'Input gain', 0, 18, 0, 'dB'), p('release', 'Release', 0.01, 1, 0.08, 's')] },
  reverb: { label: 'Reverb', about: 'Algorithmic-IR reverb (seeded): rooms to halls.', params: [p('size', 'Size', 0, 1, 0.5), p('decay', 'Decay', 0.1, 12, 2.2, 's'), p('predelay', 'Pre-delay', 0, 0.25, 0.02, 's'), p('damping', 'Damping', 0, 1, 0.5), p('lowcut', 'Low cut', 20, 1000, 150, 'Hz')] },
  delay: { label: 'Delay', about: 'Tempo-synced or free delay with feedback filter and ping-pong.', params: [p('sync', 'Sync', 0, 7, 4, undefined, { step: 1, options: ['free', '1/2', '1/4', '1/4 dotted', '1/8', '1/8 dotted', '1/8 triplet', '1/16'] }), p('time', 'Time (free)', 0.01, 2, 0.3, 's'), p('feedback', 'Feedback', 0, 0.95, 0.35), p('pingpong', 'Ping-pong', 0, 1, 1, undefined, { step: 1, options: ['off', 'on'] }), p('tone', 'Tone', 200, 16000, 5000, 'Hz')] },
  chorus: { label: 'Chorus', about: 'Modulated short delays for width and shimmer.', params: [p('rate', 'Rate', 0.05, 8, 0.8, 'Hz'), p('depth', 'Depth', 0, 1, 0.4), p('delay', 'Delay', 0.005, 0.04, 0.018, 's'), p('spread', 'Spread', 0, 1, 0.8)] },
  flanger: { label: 'Flanger', about: 'Short modulated delay with feedback.', params: [p('rate', 'Rate', 0.02, 5, 0.25, 'Hz'), p('depth', 'Depth', 0, 1, 0.6), p('feedback', 'Feedback', -0.95, 0.95, 0.5), p('delay', 'Delay', 0.0005, 0.015, 0.003, 's')] },
  phaser: { label: 'Phaser', about: 'All-pass stages swept by an LFO.', params: [p('rate', 'Rate', 0.02, 8, 0.4, 'Hz'), p('depth', 'Depth', 0, 1, 0.7), p('stages', 'Stages', 2, 12, 6, undefined, { step: 2 }), p('feedback', 'Feedback', 0, 0.9, 0.4), p('center', 'Center', 100, 8000, 900, 'Hz')] },
  distortion: { label: 'Distortion', about: 'Waveshaper: 0 soft clip, 1 hard clip, 2 foldback, 3 tube.', params: [p('drive', 'Drive', 0, 1, 0.4), p('curve', 'Curve', 0, 3, 0, undefined, { step: 1, options: ['soft', 'hard', 'fold', 'tube'] }), p('tone', 'Tone', 200, 16000, 6000, 'Hz'), p('output', 'Output', -24, 6, -3, 'dB')] },
  bitcrusher: { label: 'Bitcrusher', about: 'Bit depth and sample-rate reduction.', params: [p('bits', 'Bits', 1, 16, 8, undefined, { step: 1 }), p('downsample', 'Downsample', 1, 40, 4, 'x', { step: 1 })] },
  filter: { label: 'Auto Filter', about: 'Resonant filter with LFO (tempo-syncable) and envelope follower.', params: [p('type', 'Type', 0, 3, 0, undefined, { step: 1, options: FILTERS }), p('cutoff', 'Cutoff', 20, 20000, 2000, 'Hz'), p('resonance', 'Resonance', 0, 30, 2), p('lfoRate', 'LFO rate', 0, 20, 0, 'Hz'), p('lfoSync', 'LFO sync', 0, 8, 0, undefined, { step: 1, options: ['free', '4 bars', '2 bars', '1 bar', '1/2', '1/4', '1/8', '1/16', '1/32'] }), p('lfoDepth', 'LFO depth', 0, 1, 0), p('follow', 'Env follow', -1, 1, 0)] },
  stereo: { label: 'Stereo Imager', about: 'Width (0 mono, 1 as is, 2 wide) and pan.', params: [p('width', 'Width', 0, 2, 1.2), p('pan', 'Pan', -1, 1, 0)] },
  sidechain: { label: 'Sidechain Ducker', about: 'Ducks this insert from a sidechain send (route a kick insert here with sidechain:true) or, with no source, a tempo-synced pump.', params: [p('amount', 'Amount', 0, 1, 0.7), p('attack', 'Attack', 0.001, 0.2, 0.005, 's'), p('release', 'Release', 0.02, 1, 0.2, 's'), p('rate', 'Pump rate', 0, 4, 2, undefined, { step: 1, options: ['1 bar', '1/2', '1/4', '1/8', '1/16'] }), p('threshold', 'Threshold', -60, 0, -24, 'dB')] },
  gate: { label: 'Gate / Transient', about: 'Noise gate with transient attack and sustain shaping.', params: [p('threshold', 'Threshold', -80, 0, -40, 'dB'), p('attackBoost', 'Attack', -1, 1, 0), p('sustain', 'Sustain', -1, 1, 0), p('release', 'Release', 0.01, 1, 0.1, 's')] },
  tremolo: { label: 'Tremolo / Autopan', about: 'Volume or pan modulation, tempo-syncable.', params: [p('rate', 'Rate', 0.1, 20, 4, 'Hz'), p('sync', 'Sync', 0, 8, 6, undefined, { step: 1, options: ['free', '4 bars', '2 bars', '1 bar', '1/2', '1/4', '1/8', '1/16', '1/32'] }), p('depth', 'Depth', 0, 1, 0.5), p('autopan', 'Autopan', 0, 1, 0, undefined, { step: 1, options: ['off', 'on'] })] },
};

export const MAX_EFFECTS = 10;
export const MAX_INSERTS = 126;
export const DEFAULT_INSERTS = 16;

/** Sync option index → length in beats (index 0 = free). Shared by LFOs, delays, filters. */
export const SYNC_BEATS = [0, 16, 8, 4, 2, 1, 0.5, 0.25, 0.125];

/** A parameter's spec for an instrument or effect, or undefined. */
export function paramSpec(kind: InstrumentType | EffectType, name: string, family: 'instrument' | 'effect'): ParamSpec | undefined {
  const specs = family === 'instrument' ? INSTRUMENT_SPECS[kind as InstrumentType]?.params : EFFECT_SPECS[kind as EffectType]?.params;
  return specs?.find((s) => s.name === name);
}

/** A parameter's value with its default filled in and clamped to its range. */
export function paramValue(params: Record<string, number>, spec: ParamSpec): number {
  const v = params[spec.name];
  if (typeof v !== 'number' || !Number.isFinite(v)) return spec.default;
  return Math.min(spec.max, Math.max(spec.min, v));
}

/** Every param of an instrument / effect resolved (defaults filled, clamped). */
export function resolveParams(specs: ParamSpec[], params: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const spec of specs) out[spec.name] = paramValue(params, spec);
  return out;
}

/** Seconds per step at the song's tempo. */
export const stepSeconds = (song: Pick<MusicProject, 'bpm' | 'stepsPerBeat'>): number => 60 / (song.bpm * song.stepsPerBeat);
/** Steps in one bar. */
export const stepsPerBar = (song: Pick<MusicProject, 'timeSig' | 'stepsPerBeat'>): number => (song.timeSig[0] * song.stepsPerBeat * 4) / song.timeSig[1];
