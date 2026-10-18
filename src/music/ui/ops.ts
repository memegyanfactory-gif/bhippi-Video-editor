// Song operations the studio windows share (pure: song in, song out). Each is one `edit` — the
// Browser, the Channel Rack and the empty states all add channels and write grooves the same way.
import { addChannel, musicId, newChannel, notesOf, parseSteps, setNotes, updatePattern } from '../model';
import { stepsPerBar, type Channel, type DrumPiece, type InstrumentType, type MusicProject, type Note } from '../types';

/** Adds a channel and selects it. */
export function withChannel(song: MusicProject, channel: Channel): MusicProject {
  const next = addChannel(song, channel);
  return { ...next, view: { ...next.view, selectedChannelId: channel.id } };
}

export function withNewChannel(song: MusicProject, instrument: InstrumentType, options: Partial<Channel> = {}): MusicProject {
  return withChannel(song, newChannel(song, instrument, options));
}

/** Writes a groove's drum step strings into the active pattern, making drum channels as needed. */
export function applyGroove(song: MusicProject, parts: Partial<Record<DrumPiece, string>>): MusicProject {
  const patternId = song.view.activePatternId ?? song.patterns[0]?.id;
  if (!patternId) return song;
  let next = song;
  let bars = 1;
  for (const [piece, text] of Object.entries(parts) as [DrumPiece, string | undefined][]) {
    if (!text) continue;
    let channel = next.channels.find((c) => c.instrument === 'drum' && c.drum === piece);
    if (!channel) {
      channel = newChannel(next, 'drum', { drum: piece });
      next = addChannel(next, channel);
    }
    next = setNotes(next, patternId, channel.id, parseSteps(text, channel.rootKey));
    bars = Math.max(bars, Math.ceil(text.replace(/[\s|]/g, '').length / stepsPerBar(next)));
  }
  return updatePattern(next, patternId, (p) => ({ ...p, bars: Math.max(p.bars, bars) }));
}

/** Moves a channel one place up or down the rack. */
export function moveChannel(song: MusicProject, id: string, dir: -1 | 1): MusicProject {
  const i = song.channels.findIndex((c) => c.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= song.channels.length) return song;
  const channels = [...song.channels];
  [channels[i], channels[j]] = [channels[j], channels[i]];
  return { ...song, channels };
}

/** A copy of a channel (with its notes in every pattern) right after it. */
export function cloneChannel(song: MusicProject, id: string): MusicProject {
  const src = song.channels.find((c) => c.id === id);
  if (!src) return song;
  const copy: Channel = { ...src, id: musicId(), name: `${src.name} copy`, params: { ...src.params } };
  const i = song.channels.findIndex((c) => c.id === id);
  let next = addChannel(song, copy);
  const channels = next.channels.filter((c) => c.id !== copy.id);
  channels.splice(i + 1, 0, copy);
  next = { ...next, channels, view: { ...next.view, selectedChannelId: copy.id } };
  for (const p of song.patterns) {
    const notes = notesOf(p, id);
    if (notes.length) next = setNotes(next, p.id, copy.id, notes.map((n) => ({ ...n, id: musicId() })));
  }
  return next;
}

/** Rewrites a channel's step pattern in the pattern: fill every n, shift, clear. */
export function stepOp(song: MusicProject, patternId: string, channel: Channel, steps: number, op: 'clear' | 'fill2' | 'fill4' | 'fill8' | 'left' | 'right' | 'random'): MusicProject {
  const pattern = song.patterns.find((p) => p.id === patternId);
  if (!pattern) return song;
  const notes = notesOf(pattern, channel.id);
  const mk = (start: number): Note => ({ id: musicId(), key: channel.rootKey, start, length: 1, velocity: 0.78 });
  let out: Note[] = notes;
  if (op === 'clear') out = [];
  else if (op === 'fill2' || op === 'fill4' || op === 'fill8') {
    const every = op === 'fill2' ? 2 : op === 'fill4' ? 4 : 8;
    out = Array.from({ length: Math.ceil(steps / every) }, (_, i) => mk(i * every));
  } else if (op === 'left' || op === 'right') out = notes.map((n) => ({ ...n, start: (((n.start + (op === 'left' ? -1 : 1)) % steps) + steps) % steps }));
  else if (op === 'random') out = Array.from({ length: steps }, (_, i) => i).filter(() => Math.random() < 0.3).map((i) => ({ ...mk(i), velocity: 0.5 + Math.random() * 0.5 }));
  return setNotes(song, patternId, channel.id, out);
}
