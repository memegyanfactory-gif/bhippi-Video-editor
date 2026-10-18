// The song as text a model can read in a few hundred tokens: header, channels (with only the
// parameters that differ from their defaults), patterns (drum channels as step strings, pitched
// channels as compact notes, or an ASCII piano roll for one pattern), the playlist as a section map
// per track, the mixer chains in use, and automations. Every id the AI needs to name something is
// shown in [brackets]. Positions inside patterns are in STEPS (sixteenth notes); the playlist is in
// BARS counted from 0.
import { stepString, songLengthSteps } from './model';
import { noteName, pitchName } from './theory';
import {
  EFFECT_SPECS, INSTRUMENT_SPECS, paramValue, stepSeconds, stepsPerBar,
  type Automation, type Channel, type Effect, type MixerInsert, type MusicProject, type Note, type ParamSpec, type Pattern,
} from './types';

export type ReadoutOptions = {
  detail: 'summary' | 'full';
  /** Only this pattern (all its notes), the rest listed by name. */
  patternId?: string;
  /** An ASCII piano roll for the pattern (the given one, else the active one). */
  grid?: boolean;
  /** One channel only in the grid. */
  channelId?: string;
  /** Names for sampler / audio assets. */
  assets?: { get(id: string): { name: string } | undefined };
  /** Where the bounced song sits on each video composition (from song.placements). */
  timeline?: TimelineEntry[];
  /** Whether the Music Studio window is open (the AI can only play through an open studio). */
  studioOpen?: boolean;
};

/** One placement of the song on a video composition, with the clip's place on that timeline when it is still there. */
export type TimelineEntry = {
  compId: string; compName: string; clipId: string; trackId: string; assetId: string; bpm: number; beats: number;
  /** The clip is still on the composition (an editor may have removed it). */
  live: boolean;
  /** Seconds on the composition timeline. */
  start?: number; duration?: number;
};

const fmt = (v: number): string => String(Math.round(v * 100) / 100);
const velText = (v: number): number => Math.round(v * 127);
const SUMMARY_NOTES = 10;

/** `name=value` for every parameter that is not at its default. */
export function changedParams(specs: ParamSpec[], params: Record<string, number>): string {
  const out: string[] = [];
  for (const spec of specs) {
    if (!(spec.name in params)) continue;
    const v = paramValue(params, spec);
    if (Math.abs(v - spec.default) > 1e-9) out.push(`${spec.name}=${fmt(v)}`);
  }
  return out.join(' ');
}

/** One note as `C4@0+4 v100` (key @ start + length, velocity 1–127) with its extra flags. */
export function noteText(n: Note): string {
  const flags = `${n.slide ? ' slide' : ''}${n.ratchet && n.ratchet > 1 ? ` r${n.ratchet}` : ''}${n.probability !== undefined && n.probability < 1 ? ` p${fmt(n.probability)}` : ''}${n.mute ? ' muted' : ''}`;
  return `${noteName(n.key)}@${fmt(n.start)}+${fmt(n.length)} v${velText(n.velocity)}${flags}`;
}

/** Notes as text, notes that start and end together written as one chord `C4+E4+G4@0+8 v90`. */
export function notesText(notes: Note[]): string {
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.key - b.key);
  const out: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const n = sorted[i];
    const plain = !n.slide && !n.ratchet && n.probability === undefined && !n.mute;
    const same = [n];
    while (plain && i + same.length < sorted.length) {
      const m = sorted[i + same.length];
      if (Math.abs(m.start - n.start) < 1e-6 && Math.abs(m.length - n.length) < 1e-6 && !m.slide && !m.ratchet && m.probability === undefined && !m.mute) same.push(m);
      else break;
    }
    if (same.length > 1) {
      out.push(`${same.map((s) => noteName(s.key)).join('+')}@${fmt(n.start)}+${fmt(n.length)} v${velText(Math.max(...same.map((s) => s.velocity)))}`);
      i += same.length - 1;
    } else out.push(noteText(n));
  }
  return out.join(' ');
}

function channelKind(c: Channel, assets: ReadoutOptions['assets']): string {
  if (c.instrument === 'drum') return `drum:${c.drum ?? 'kick'}`;
  if (c.instrument === 'sampler') return `sampler(${c.sampleAssetId ? assets?.get(c.sampleAssetId)?.name ?? c.sampleAssetId : 'no sample'})`;
  return c.instrument;
}

function channelLine(song: MusicProject, c: Channel, assets: ReadoutOptions['assets']): string {
  const insert = song.mixer.inserts[c.insert];
  const specs = INSTRUMENT_SPECS[c.instrument]?.params ?? [];
  const extra = [
    c.mute ? 'MUTED' : '', c.solo ? 'SOLO' : '', c.swing !== undefined ? `swing ${fmt(c.swing)}` : '', c.glide ? `glide ${fmt(c.glide)}s` : '',
    c.polyphony === 1 ? 'mono' : '', c.instrument === 'sampler' ? `root ${noteName(c.rootKey)}` : '', c.group ? `group "${c.group}"` : '',
  ].filter(Boolean).join(' ');
  const params = changedParams(specs, c.params);
  return ` [${c.id}] ${c.name} · ${channelKind(c, assets)} · ins ${c.insert}${c.insert > 0 && insert ? ` "${insert.name}"` : ' (master)'} · vol ${fmt(c.volume)} pan ${fmt(c.pan)}${extra ? ` · ${extra}` : ''}${params ? ` · ${params}` : ''}`;
}

function patternBlock(song: MusicProject, pattern: Pattern, full: boolean): string[] {
  const bar = stepsPerBar(song);
  const steps = Math.max(pattern.bars * bar, Math.ceil(Math.max(0, ...Object.values(pattern.notes).flat().map((n) => n.start + n.length)) / bar) * bar);
  const lines = [` [${pattern.id}] ${pattern.name} · ${steps / bar} bar${steps / bar === 1 ? '' : 's'} (${steps} steps)`];
  const filled = song.channels.filter((c) => (pattern.notes[c.id] ?? []).length > 0);
  if (!filled.length) lines.push('   (empty)');
  for (const c of filled) {
    const notes = pattern.notes[c.id];
    if (c.instrument === 'drum') {
      lines.push(`   ${c.name} [${c.id}] ${stepString(notes, steps)}`);
      continue;
    }
    const keys = notes.map((n) => n.key);
    const range = `${noteName(Math.min(...keys))}–${noteName(Math.max(...keys))}`;
    if (full || notes.length <= SUMMARY_NOTES) lines.push(`   ${c.name} [${c.id}] ${notes.length} notes ${range}: ${notesText(notes)}`);
    else lines.push(`   ${c.name} [${c.id}] ${notes.length} notes ${range}: ${notesText([...notes].sort((a, b) => a.start - b.start || a.key - b.key).slice(0, SUMMARY_NOTES))} … (+${notes.length - SUMMARY_NOTES} more; music_get_song {"patternId":"${pattern.id}"} for all)`);
  }
  return lines;
}

/** An ASCII piano roll: `#` where a note starts, `=` while it sounds, `.` empty; a `|` every beat. */
function gridBlock(song: MusicProject, pattern: Pattern, channelId?: string): string[] {
  const bar = stepsPerBar(song);
  const beat = song.stepsPerBeat;
  const lines: string[] = [`PIANO ROLL ${pattern.name} [${pattern.id}] (1 column = 1 step, | = beat, bar = ${bar} steps)`];
  const channels = song.channels.filter((c) => (!channelId || c.id === channelId) && (pattern.notes[c.id] ?? []).length > 0);
  if (!channels.length) return [...lines, '  (no notes)'];
  for (const c of channels) {
    const notes = pattern.notes[c.id];
    const total = Math.min(128, Math.max(pattern.bars * bar, Math.ceil(Math.max(...notes.map((n) => n.start + n.length)) / bar) * bar));
    if (c.instrument === 'drum') { lines.push(`  ${c.name} [${c.id}] ${stepString(notes, total)}`); continue; }
    const used = [...new Set(notes.map((n) => n.key))].sort((a, b) => b - a);
    const lo = used[used.length - 1], hi = used[0];
    const rows = hi - lo <= 30 ? Array.from({ length: hi - lo + 1 }, (_, i) => hi - i) : used;
    lines.push(`  ${c.name} [${c.id}]`);
    const header = Array.from({ length: total }, (_, i) => (i % bar === 0 ? String(Math.floor(i / bar) % 10) : i % beat === 0 ? '+' : ' ')).join('');
    lines.push(`      ${header}`);
    for (const key of rows) {
      const cells = Array.from({ length: total }, () => '.');
      for (const n of notes) {
        if (n.key !== key) continue;
        const s = Math.floor(n.start);
        if (s >= total) continue;
        cells[s] = '#';
        for (let k = 1; k < Math.round(n.length) && s + k < total; k++) if (cells[s + k] === '.') cells[s + k] = '=';
      }
      const row = cells.map((ch, i) => (i > 0 && i % beat === 0 ? `|${ch}` : ch)).join('');
      lines.push(`  ${noteName(key).padEnd(4)}${row}`);
    }
  }
  return lines;
}

function effectText(e: Effect): string {
  const specs = EFFECT_SPECS[e.type]?.params ?? [];
  const params = changedParams(specs, e.params);
  const defaultMix = e.type === 'reverb' ? 0.3 : e.type === 'delay' ? 0.25 : 1;
  return `${e.type}[${e.id}]${e.enabled ? '' : '(off)'}${Math.abs(e.mix - defaultMix) > 1e-9 ? `@mix ${fmt(e.mix)}` : ''}${params ? `{${params}}` : ''}`;
}

function insertLine(song: MusicProject, ins: MixerInsert, index: number): string {
  const feeds = song.channels.filter((c) => c.insert === index).map((c) => c.name);
  const bits = [
    ins.volume !== 0 ? `vol ${fmt(ins.volume)} dB` : '', ins.pan !== 0 ? `pan ${fmt(ins.pan)}` : '', ins.width !== 1 ? `width ${fmt(ins.width)}` : '',
    ins.mute ? 'MUTED' : '', ins.solo ? 'SOLO' : '', ins.invert ? 'phase-inverted' : '', ins.toMaster === false ? 'not to master' : '',
  ].filter(Boolean).join(' ');
  const sends = ins.sends.length ? `sends: ${ins.sends.map((s) => `→${s.to}${s.sidechain ? ' sidechain' : ''} ${fmt(s.level)}`).join(', ')}` : '';
  const fx = ins.effects.length ? `fx: ${ins.effects.map(effectText).join(' → ')}` : '';
  return ` ${index} "${ins.name}"${feeds.length ? ` ← ${feeds.join(', ')}` : ''}${bits ? ` · ${bits}` : ''}${sends ? ` · ${sends}` : ''}${fx ? ` · ${fx}` : ''}`;
}

/** A track's non-default state, e.g. " MUTED LOCKED" (empty when it has none). */
const trackFlags = (t: { mute: boolean; solo: boolean; locked?: boolean } | undefined): string => (t ? `${t.mute ? ' MUTED' : ''}${t.solo ? ' SOLO' : ''}${t.locked ? ' LOCKED' : ''}` : '');

/** What an automation drives, in words. */
export function targetText(song: MusicProject, a: Automation): string {
  const t = a.target;
  if (t.kind === 'tempo') return 'tempo';
  if (t.kind === 'channel') return `channel ${song.channels.find((c) => c.id === t.channelId)?.name ?? t.channelId}.${t.param}`;
  if (t.kind === 'insert') return `insert ${t.insert} ${t.param}`;
  if (t.kind === 'send') return `send ${t.insert}→${t.to}`;
  const fx = song.mixer.inserts[t.insert]?.effects.find((e) => e.id === t.effectId);
  return `insert ${t.insert} ${fx?.type ?? t.effectId}.${t.param}`;
}

export function songReadout(song: MusicProject, options: ReadoutOptions): string {
  const bar = stepsPerBar(song);
  const total = songLengthSteps(song);
  const hasSong = song.playlist.clips.length > 0;
  const seconds = total * stepSeconds(song);
  const lines: string[] = [];
  lines.push(`SONG "${song.name}" · ${fmt(song.bpm)} BPM · ${song.timeSig[0]}/${song.timeSig[1]} · swing ${fmt(song.swing)} · key ${pitchName(song.key.root)} ${song.key.scale} · ${hasSong ? `${fmt(total / bar)} bars (${fmt(seconds)} s)` : 'no arrangement yet'} · master ${fmt(song.masterVolume)} dB${song.masterPitch ? `, pitch ${song.masterPitch}` : ''}`);
  lines.push('Ids are in [brackets]. Pattern positions are STEPS (1 step = a 16th note; a bar = ' + bar + ' steps); playlist positions are BARS counted from 0.');
  const view = song.view;
  lines.push(`VIEW: ${view.mode === 'song' ? 'SONG' : 'PAT'} mode · active pattern [${view.activePatternId ?? '-'}] · selected channel [${view.selectedChannelId ?? '-'}]${view.window ? ` · window ${view.window}` : ''}${options.studioOpen === undefined ? '' : ` · studio ${options.studioOpen ? 'open' : 'closed (music_open_studio opens it)'}`}`);

  lines.push('', `CHANNELS (${song.channels.length})`);
  if (!song.channels.length) lines.push(' (none — music_add_channel)');
  for (const c of song.channels) lines.push(channelLine(song, c, options.assets));

  const full = options.detail === 'full';
  const focus = options.patternId ? song.patterns.find((p) => p.id === options.patternId) : undefined;
  lines.push('', `PATTERNS (${song.patterns.length}) · active [${song.view.activePatternId ?? '-'}]`);
  if (options.patternId && !focus) lines.push(` (no pattern [${options.patternId}])`);
  for (const p of song.patterns) {
    if (focus && p.id !== focus.id) { lines.push(` [${p.id}] ${p.name} · ${p.bars} bars`); continue; }
    lines.push(...patternBlock(song, p, full || !!focus));
  }
  if (options.grid) {
    const target = focus ?? song.patterns.find((p) => p.id === song.view.activePatternId) ?? song.patterns[0];
    if (target) lines.push('', ...gridBlock(song, target, options.channelId));
  }

  lines.push('', 'PLAYLIST');
  const { markers, clips, tracks } = song.playlist;
  if (markers.length) lines.push(` sections: ${[...markers].sort((a, b) => a.at - b.at).map((m) => `${fmt(m.at / bar)} ${m.name}${m.kind !== 'marker' && m.kind !== m.name.toLowerCase() ? ` (${m.kind})` : ''} [${m.id}]`).join(' · ')}`);
  if (song.playlist.loop) lines.push(` loop: bars ${fmt(song.playlist.loop.start / bar)}–${fmt(song.playlist.loop.end / bar)}`);
  const byTrack = new Map<number, typeof clips>();
  for (const c of clips) byTrack.set(c.trackIndex, [...(byTrack.get(c.trackIndex) ?? []), c]);
  if (!clips.length) lines.push(' (no clips — music_arrange {"sections":[…]} lays patterns out as a song)');
  for (const [index, list] of [...byTrack].sort((a, b) => a[0] - b[0])) {
    const sorted = [...list].sort((a, b) => a.start - b.start);
    const runs: { from: number; to: number; label: string; id: string }[] = [];
    for (const c of sorted) {
      const label = c.kind === 'pattern' ? song.patterns.find((p) => p.id === c.patternId)?.name ?? c.patternId ?? '?'
        : c.kind === 'audio' ? `audio ${options.assets?.get(c.assetId ?? '')?.name ?? c.assetId}` : `automation ${song.automations.find((a) => a.id === c.automationId)?.name ?? c.automationId}`;
      const extras = [c.offset > 0 ? `offset ${fmt(c.offset / bar)}` : '', c.gain ? `${fmt(c.gain)} dB` : '', c.fadeIn ? `fade-in ${fmt(c.fadeIn)}s` : '', c.fadeOut ? `fade-out ${fmt(c.fadeOut)}s` : ''].filter(Boolean).join(', ');
      const entry = { from: c.start / bar, to: (c.start + c.length) / bar, label: `${label}${c.muted ? ' (muted)' : ''}${extras ? ` (${extras})` : ''}`, id: c.id };
      // Back-to-back clips of the same thing read as one run (the first clip's id names it).
      const last = runs[runs.length - 1];
      if (!full && last && Math.abs(last.to - entry.from) < 1e-6 && last.label === entry.label) { last.to = entry.to; last.id = last.id.replace(/…?$/, '…'); }
      else runs.push(entry);
    }
    lines.push(` T${index} "${tracks[index]?.name ?? `Track ${index + 1}`}"${trackFlags(tracks[index])}: ${runs.map((r) => `${fmt(r.from)}-${fmt(r.to)} ${r.label} [${r.id}]`).join(' · ')}`);
  }
  // Tracks with no clips show only when they say something (renamed, muted, soloed, locked); the rest are free, numbered from 0.
  const idle = tracks.map((tr, i) => ({ tr, i })).filter(({ tr, i }) => !byTrack.has(i) && (trackFlags(tr) || !/^Track \d+$/.test(tr.name)));
  if (idle.length) lines.push(` empty tracks: ${idle.map(({ tr, i }) => `T${i} "${tr.name}"${trackFlags(tr)}`).join(' · ')}`);
  lines.push(` ${tracks.length} playlist tracks (T0–T${tracks.length - 1}); a clip on a higher index makes the tracks it needs.`);

  lines.push('', 'MIXER (inserts in use; 0 = master)');
  song.mixer.inserts.forEach((ins, i) => {
    const interesting = i === 0 || song.channels.some((c) => c.insert === i) || ins.effects.length || ins.sends.length || ins.volume !== 0 || ins.pan !== 0 || ins.mute || ins.solo || ins.width !== 1;
    if (interesting) lines.push(insertLine(song, ins, i));
  });

  if (song.automations.length) {
    lines.push('', `AUTOMATION (${song.automations.length})`);
    for (const a of song.automations) {
      const vs = a.points.map((p) => p.v);
      lines.push(` [${a.id}] ${a.name} → ${targetText(song, a)} · ${a.points.length} points${vs.length ? `, normalized ${fmt(Math.min(...vs))}–${fmt(Math.max(...vs))}` : ''}`);
    }
  }
  if (options.timeline?.length) {
    lines.push('', 'ON THE VIDEO TIMELINE (the bounced song as the music layer; music_render {place:true} refreshes it in place)');
    for (const p of options.timeline) {
      lines.push(` comp "${p.compName}" [${p.compId}] · clip [${p.clipId}] on track [${p.trackId}] · asset [${p.assetId}] · ${fmt(p.bpm)} BPM, ${p.beats} beats stored${p.live ? `${p.start !== undefined ? ` · starts ${fmt(p.start)} s, runs ${fmt(p.duration ?? 0)} s` : ''}` : ' · the clip is no longer on that timeline (the next music_render {place:true} lays a fresh one)'}`);
    }
  }
  return lines.join('\n');
}
