import { afterEach, describe, expect, it } from 'vitest';
import catalog from '../src/lib/ai-tools.json';
import { MUSIC_TOOLS, parseKeyText, runMusicTool, validateParams, type MusicToolContext } from '../src/lib/musicTools';
import type { ToolHost } from '../src/lib/aiTools';
import { TOOL_LABELS } from '../src/lib/toolLabels';
import { isMusicAsk, MUSIC_GROUP, routeTools } from '../src/lib/toolRouter';
import { newProject } from '../src/lib/timeline';
import type { Project } from '../src/lib/types';
import { NOTE_OPS, editNotes } from '../src/music/edit';
import { generatePart, GROOVES, PART_KINDS } from '../src/music/generate';
import { DEFAULT_DRUM_KEYS, normalizeSong, parseSteps } from '../src/music/model';
import { songReadout } from '../src/music/readout';
import { onStudioRequest, setStudioOpen, type StudioRequest } from '../src/music/studioBus';
import { CHANNEL_PRESETS, SONG_TEMPLATE_LIST, layoutSections, presetChannel, songFromTemplate } from '../src/music/templates';
import { SCALE_NAMES, SCALES } from '../src/music/theory';
import { EFFECT_SPECS, INSTRUMENT_SPECS, type MusicProject } from '../src/music/types';
import { newSong } from '../src/music/model';

type Tool = { name: string; description: string; input_schema: { type: string; properties: Record<string, { enum?: string[]; items?: { enum?: string[] } }>; additionalProperties?: boolean } };
const tools = (catalog as unknown as { tools: Tool[] }).tools;
const musicSpecs = tools.filter((t) => t.name.startsWith('music_'));

/** A project and a host the music tools can run against, counting commits. */
function rig() {
  let project: Project = newProject('Test');
  let commits = 0;
  const imported: string[][] = [];
  const host = {
    history: { current: () => project, commit: (change: (p: Project) => Project) => { project = change(project); } },
    assets: () => new Map(),
    selection: () => [],
    setSelection: () => undefined,
    importMedia: async (paths: string[]) => { imported.push(paths); return []; },
    speak: async () => { throw new Error('no'); },
    ask: async () => '',
    testing: true,
  } as unknown as ToolHost;
  const ctx: MusicToolContext = { commit: (change) => { project = change(project); commits++; }, current: () => project, pickComp: (p) => p.comps[0], folderFor: () => 'folder-music' };
  const run = (name: string, args: Record<string, unknown> = {}) => runMusicTool(host, name, args, ctx);
  return { run, song: (): MusicProject => project.music!, project: () => project, commits: () => commits, imported };
}
const text = (r: { ok: boolean; summary?: string; error?: string }) => (r.ok ? r.summary ?? '' : r.error ?? '');
const idOf = (r: { [k: string]: unknown }, key: string) => r[key] as string;

describe('the music tool catalogue', () => {
  it('has every tool dispatched, labelled and described', () => {
    const names = musicSpecs.map((t) => t.name).sort();
    expect(names).toEqual([...MUSIC_TOOLS].sort());
    expect(names.length).toBe(15);
    for (const name of names) expect(TOOL_LABELS[name], name).toBeTruthy();
    for (const spec of musicSpecs) {
      expect(spec.input_schema.type, spec.name).toBe('object');
      expect(spec.input_schema.additionalProperties, spec.name).toBe(false);
      expect(spec.description.length, spec.name).toBeGreaterThan(120);
    }
    expect(musicSpecs.find((t) => t.name === 'music_get_song')!.description).toContain('Call first when working on music');
    expect([...MUSIC_GROUP].sort()).toEqual(names);
  });

  it('keeps the schema enums in step with the code', () => {
    const enumOf = (tool: string, prop: string) => tools.find((t) => t.name === tool)!.input_schema.properties[prop].enum;
    expect(enumOf('music_add_channel', 'instrument')).toEqual(Object.keys(INSTRUMENT_SPECS));
    expect(enumOf('music_add_channel', 'drum')).toEqual(Object.keys(DEFAULT_DRUM_KEYS));
    expect(enumOf('music_add_channel', 'preset')).toEqual(CHANNEL_PRESETS.map((p) => p.id));
    expect(enumOf('music_new_song', 'template')).toEqual(SONG_TEMPLATE_LIST.map((t) => t.id));
    expect(enumOf('music_new_song', 'scale')).toEqual(SCALE_NAMES);
    expect(enumOf('music_generate', 'part')).toEqual(PART_KINDS);
    expect(enumOf('music_studio_guide', 'effect')).toEqual(Object.keys(EFFECT_SPECS));
    expect(enumOf('music_edit_notes', 'op')?.filter((op) => op !== 'remove')).toEqual(NOTE_OPS);
  });
});

describe('channel presets, grooves and templates', () => {
  it('ships 40+ presets whose parameters all exist and are in range', () => {
    expect(CHANNEL_PRESETS.length).toBeGreaterThanOrEqual(40);
    expect(new Set(CHANNEL_PRESETS.map((p) => p.id)).size).toBe(CHANNEL_PRESETS.length);
    for (const preset of CHANNEL_PRESETS) {
      const v = validateParams(preset.instrument, 'instrument', preset.params);
      expect(v.errors, preset.id).toEqual([]);
      expect(v.clamped, preset.id).toEqual([]);
      if (preset.instrument === 'drum') expect(preset.drum, preset.id).toBeTruthy();
    }
    for (const category of ['Drums', 'Bass', 'Leads', 'Pads', 'Keys', 'Plucks', 'FX']) expect(CHANNEL_PRESETS.some((p) => p.category === category), category).toBe(true);
    for (const piece of ['kick', 'snare', 'hat']) expect(CHANNEL_PRESETS.filter((p) => p.drum === piece).length, piece).toBeGreaterThanOrEqual(2);
    const song = newSong('p');
    expect(presetChannel(song, 'kick-808')).toMatchObject({ instrument: 'drum', drum: 'kick' });
    expect(presetChannel(song, 'nope')).toBeNull();
  });

  it('writes grooves in the step syntax, 1-2 bars each', () => {
    expect(GROOVES.length).toBeGreaterThanOrEqual(14);
    for (const groove of GROOVES) {
      expect(Object.keys(groove.parts).length, groove.id).toBeGreaterThan(2);
      for (const [piece, steps] of Object.entries(groove.parts)) {
        expect(piece in DEFAULT_DRUM_KEYS, `${groove.id}.${piece}`).toBe(true);
        const clean = steps!.replace(/[\s|]/g, '');
        expect(/^[xXorR1-9\-._]+$/.test(clean), `${groove.id}.${piece}`).toBe(true);
        expect([16, 32]).toContain(clean.length);
        expect(parseSteps(steps!, 36).length, `${groove.id}.${piece}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('builds every template into a valid, in-key, arranged song', () => {
    expect(SONG_TEMPLATE_LIST.map((t) => t.id)).toEqual(['empty', 'beat', 'lofi', 'trap', 'house', 'dnb', 'cinematic', 'corporate', 'pop', 'afrobeats', 'techno', 'ambient']);
    for (const { id } of SONG_TEMPLATE_LIST) {
      const song = songFromTemplate(id, { seed: 11 });
      const valid = normalizeSong(song);
      expect(valid, id).not.toBeNull();
      if (id === 'empty') { expect(song.channels.length).toBe(0); continue; }
      expect(song.channels.length, id).toBeGreaterThanOrEqual(4);
      expect(song.playlist.clips.length, id).toBeGreaterThan(4);
      expect(song.playlist.markers.length, id).toBeGreaterThanOrEqual(4);
      const patternIds = new Set(song.patterns.map((p) => p.id));
      for (const clip of song.playlist.clips) expect(patternIds.has(clip.patternId!), id).toBe(true);
      for (const channel of song.channels) expect(channel.insert, `${id} ${channel.name}`).toBeLessThan(song.mixer.inserts.length);
      const scale = new Set(SCALES[song.key.scale].map((s) => (s + song.key.root) % 12));
      for (const pattern of song.patterns) {
        for (const [channelId, notes] of Object.entries(pattern.notes)) {
          const channel = song.channels.find((c) => c.id === channelId)!;
          expect(channel, id).toBeTruthy();
          for (const n of notes) {
            expect(n.key).toBeGreaterThanOrEqual(0);
            expect(n.key).toBeLessThanOrEqual(127);
            expect(n.length).toBeGreaterThan(0);
            expect(n.start).toBeGreaterThanOrEqual(0);
            if (channel.instrument !== 'drum' && channel.instrument !== 'noise') expect(scale.has(n.key % 12), `${id} ${pattern.name} ${channel.name} ${n.key}`).toBe(true);
          }
        }
      }
      // the same seed makes the same song
      const again = songFromTemplate(id, { seed: 11 });
      expect(JSON.stringify(again.patterns.map((p) => Object.values(p.notes).map((ns) => ns.map((n) => [n.key, n.start, n.length])))), id).toBe(JSON.stringify(song.patterns.map((p) => Object.values(p.notes).map((ns) => ns.map((n) => [n.key, n.start, n.length])))));
    }
  });

  it('applies name, bpm, root and scale overrides', () => {
    const song = songFromTemplate('lofi', { name: 'Rain', bpm: 70, root: 2, scale: 'dorian', seed: 3 });
    expect(song).toMatchObject({ name: 'Rain', bpm: 70, key: { root: 2, scale: 'dorian' } });
    expect(() => songFromTemplate('nope')).toThrow(/Unknown song template/);
  });

  it('sets the kick up to duck the bass and pads', () => {
    const song = songFromTemplate('house', { seed: 5 });
    const kick = song.channels.find((c) => c.drum === 'kick')!;
    const sends = song.mixer.inserts[kick.insert].sends;
    expect(sends.length).toBeGreaterThanOrEqual(2);
    for (const send of sends) {
      expect(send.sidechain).toBe(true);
      expect(song.mixer.inserts[send.to].effects[0].type).toBe('sidechain');
    }
  });

  it('lays sections end to end, one track per pattern', () => {
    const song = songFromTemplate('beat', { seed: 1 });
    const bar = 16;
    const first = song.playlist.clips.filter((c) => c.start === 0);
    expect(first.length).toBe(1);
    const total = song.playlist.clips.reduce((e, c) => Math.max(e, c.start + c.length), 0);
    expect(total).toBe(24 * bar);
    const byPattern = new Map<string, Set<number>>();
    for (const c of song.playlist.clips) byPattern.set(c.patternId!, (byPattern.get(c.patternId!) ?? new Set()).add(c.trackIndex));
    for (const tracks of byPattern.values()) expect(tracks.size).toBe(1);
    const unknown = layoutSections(song, [{ name: 'x', bars: 2, patterns: ['Nope'] }]);
    expect(unknown.errors[0]).toContain('unknown pattern "Nope"');
  });
});

describe('generated parts', () => {
  const song = (() => {
    const s = songFromTemplate('empty', { seed: 9 });
    return { ...s, key: { root: 9, scale: 'minor' as const } };
  })();
  const kick = { ...presetChannel(song, 'kick-punchy')!, id: 'k' };
  const hat = { ...presetChannel(song, 'hat-house')!, id: 'h' };
  const bassCh = { ...presetChannel(song, 'bass-808')!, id: 'b' };
  const lead = { ...presetChannel(song, 'pluck-lead')!, id: 'l' };
  const scale = new Set(SCALES.minor.map((s) => (s + 9) % 12));

  it('is deterministic from the seed and differs between seeds', () => {
    const a = generatePart(song, { part: 'melody', bars: 4, progression: 'i-VI-III-VII', seed: 1, channel: lead });
    const b = generatePart(song, { part: 'melody', bars: 4, progression: 'i-VI-III-VII', seed: 1, channel: lead });
    const c = generatePart(song, { part: 'melody', bars: 4, progression: 'i-VI-III-VII', seed: 2, channel: lead });
    const sig = (ns: typeof a) => ns.map((n) => [n.key, n.start, n.length]);
    expect(sig(a)).toEqual(sig(b));
    expect(sig(a)).not.toEqual(sig(c));
  });

  it('writes a four-on-the-floor kick on every beat', () => {
    const notes = generatePart(song, { part: 'drums', style: 'four-on-the-floor', bars: 2, density: 0.5, channel: kick, seed: 4 });
    expect(notes.map((n) => n.start)).toEqual([0, 4, 8, 12, 16, 20, 24, 28]);
    expect(notes.every((n) => n.key === kick.rootKey)).toBe(true);
    expect(generatePart(song, { part: 'drums', style: 'four-on-the-floor', bars: 1, channel: { ...hat } }).length).toBeGreaterThan(0);
    expect(() => generatePart(song, { part: 'drums', style: 'polka', bars: 1, channel: kick })).toThrow(/Unknown groove/);
    expect(() => generatePart(song, { part: 'drums', bars: 1, channel: lead })).toThrow(/drum channel/);
  });

  it('keeps bass on the chord roots and every pitched part in key', () => {
    const roots = [9, 5, 0, 7]; // i VI III VII in A minor: A F C G
    const bass = generatePart(song, { part: 'bass', style: 'root', bars: 4, density: 0.2, progression: 'i-VI-III-VII', channel: { ...bassCh, instrument: 'synth' } });
    bass.forEach((n) => expect(n.key % 12).toBe(roots[Math.floor(n.start / 16)]));
    for (const part of PART_KINDS) {
      if (part === 'drums' || part === 'fill' || part === 'riser') continue;
      for (const style of part === 'bass' ? ['root', 'octave', 'offbeat', 'syncopated', 'walking', '808-slide', 'pulse'] : [undefined]) {
        const notes = generatePart(song, { part, style, bars: 4, progression: 'i-VI-III-VII', seed: 3, channel: part === 'bass' ? bassCh : lead });
        expect(notes.length, `${part} ${style}`).toBeGreaterThan(0);
        for (const n of notes) {
          expect(scale.has(n.key % 12), `${part} ${style} ${n.key}`).toBe(true);
          expect(n.length).toBeGreaterThan(0);
          expect(n.start).toBeGreaterThanOrEqual(0);
          expect(n.start).toBeLessThan(64);
        }
      }
    }
  });

  it('puts melody chord tones on strong beats and ends on a chord tone', () => {
    const chords = [[9, 0, 4], [5, 9, 0], [0, 4, 7], [7, 11, 2]];
    const notes = generatePart(song, { part: 'melody', bars: 4, progression: 'i-VI-III-VII', seed: 12, channel: lead });
    const strong = notes.filter((n) => n.start % 8 === 0);
    expect(strong.length).toBeGreaterThan(0);
    for (const n of strong) expect(chords[Math.floor(n.start / 16)], `${n.key}@${n.start}`).toContain(n.key % 12);
    const last = notes[notes.length - 1];
    expect(chords[3]).toContain(last.key % 12);
  });

  it('voice-leads chords and stays inside the progression', () => {
    const notes = generatePart(song, { part: 'chords', style: 'whole', bars: 4, progression: 'Am F C G', channel: lead });
    const byBar = [0, 1, 2, 3].map((b) => notes.filter((n) => n.start === b * 16).map((n) => n.key));
    byBar.forEach((keys) => expect(keys.length).toBe(3));
    const mean = (ks: number[]) => ks.reduce((a, b) => a + b, 0) / ks.length;
    for (let i = 1; i < 4; i++) expect(Math.abs(mean(byBar[i]) - mean(byBar[i - 1]))).toBeLessThan(6);
    expect(() => generatePart(song, { part: 'chords', bars: 2, progression: 'Q-Z', channel: lead })).toThrow(/Unknown chord/);
  });

  it('writes a fill into the last half bar', () => {
    const snare = { ...presetChannel(song, 'snare-tight')!, id: 's' };
    const notes = generatePart(song, { part: 'fill', bars: 2, channel: snare });
    expect(notes.length).toBeGreaterThan(3);
    expect(notes.every((n) => n.start >= 24 && n.start < 32)).toBe(true);
  });
});

describe('note edits', () => {
  const song = newSong('e');
  const mk = (key: number, start: number, length = 1, velocity = 0.8) => ({ id: `${key}-${start}`, key, start, length, velocity });
  const notes = [mk(60, 0, 2), mk(62, 2, 2), mk(65, 4, 2), mk(61, 6, 2)];

  it('runs every op, and every op is deterministic for a seed', () => {
    for (const op of NOTE_OPS) {
      const a = editNotes(song, notes, op, { seed: 5, semitones: 2, steps: 1 });
      const b = editNotes(song, notes, op, { seed: 5, semitones: 2, steps: 1 });
      expect(a.map((n) => [n.key, n.start, n.length, n.velocity]), op).toEqual(b.map((n) => [n.key, n.start, n.length, n.velocity]));
      expect(a.length, op).toBeGreaterThan(0);
    }
  });

  it('transposes, corrects to the scale, quantizes and chordizes', () => {
    expect(editNotes(song, notes, 'transpose', { semitones: 12 }).map((n) => n.key)).toEqual([72, 74, 77, 73]);
    const inKey = editNotes({ ...song, key: { root: 0, scale: 'major' } }, notes, 'scale-correct');
    expect(inKey.map((n) => n.key)).toEqual([60, 62, 65, 60]);
    expect(editNotes(song, [mk(60, 0.4), mk(62, 1.6)], 'quantize', { grid: 1 }).map((n) => n.start)).toEqual([0, 2]);
    const chordy = editNotes({ ...song, key: { root: 0, scale: 'major' } }, [mk(60, 0, 4)], 'chordize');
    expect(chordy.map((n) => n.key).sort((a, b) => a - b)).toEqual([60, 64, 67]);
    expect(editNotes(song, [mk(60, 0, 4)], 'chordize', { quality: 'min7' }).length).toBe(4);
    expect(() => editNotes(song, [mk(60, 0, 4)], 'chordize', { quality: 'zzz' })).toThrow(/Unknown chord quality/);
  });

  it('arpeggiates and strums chords', () => {
    const chord = [mk(60, 0, 4), mk(64, 0, 4), mk(67, 0, 4)];
    const arp = editNotes(song, chord, 'arpeggiate', { rate: 1, pattern: 'up' });
    expect(arp.map((n) => n.key)).toEqual([60, 64, 67, 60]);
    expect(arp.map((n) => n.start)).toEqual([0, 1, 2, 3]);
    const strum = editNotes(song, chord, 'strum', { spread: 0.5 });
    expect(strum.map((n) => n.start)).toEqual([0, 0.5, 1]);
  });
});

describe('a model session through the music tools', () => {
  it('builds, arranges, mixes and reads a track, one undo step per write', async () => {
    const r = rig();
    const first = await r.run('music_get_song');
    expect(first.ok).toBe(true);
    expect(text(first)).toContain('No song in this project yet');
    expect(r.commits()).toBe(0);

    const made = await r.run('music_new_song', { template: 'empty', key: 'A minor', bpm: 90, name: 'Session' });
    expect(made.ok, text(made)).toBe(true);
    expect(r.commits()).toBe(1);
    expect(r.song()).toMatchObject({ name: 'Session', bpm: 90, key: { root: 9, scale: 'minor' } });

    expect((await r.run('music_set_song', { swing: 0.2, bpm: 92, timeSig: '4/4' })).ok).toBe(true);
    expect(r.song()).toMatchObject({ bpm: 92, swing: 0.2 });

    const ids: Record<string, string> = {};
    for (const [key, preset] of Object.entries({ kick: 'kick-punchy', snare: 'snare-tight', hat: 'hat-house', bass: 'sub-bass', pad: 'warm-pad', lead: 'pluck-lead' })) {
      const added = await r.run('music_add_channel', { preset });
      expect(added.ok, text(added)).toBe(true);
      ids[key] = idOf(added, 'channelId');
    }
    expect(r.song().channels.length).toBe(6);
    const again = await r.run('music_new_song', { template: 'trap' });
    expect(again.ok).toBe(false);
    expect(text(again)).toContain('replace:true');
    expect(r.commits()).toBe(8);
    expect(new Set(r.song().channels.map((c) => c.insert)).size).toBe(6);

    const drums = await r.run('music_generate', { part: 'drums', style: 'boom-bap', bars: 4 });
    expect(drums.ok, text(drums)).toBe(true);
    const patternId = idOf(drums, 'patternId');
    const rest = await r.run('music_generate', {
      patternId, progression: 'i-VI-III-VII', parts: [{ part: 'bass', style: 'syncopated' }, { part: 'chords', style: 'lofi', channelId: ids.pad }, { part: 'melody', channelId: ids.lead }],
    });
    expect(rest.ok, text(rest)).toBe(true);
    const stacked = r.song().patterns.find((p) => p.id === patternId)!;
    for (const key of ['kick', 'snare', 'hat', 'bass', 'pad', 'lead']) expect((stacked.notes[ids[key]] ?? []).length, key).toBeGreaterThan(0);
    expect(r.song().view.activePatternId).toBe(patternId);

    const written = await r.run('music_write_pattern', {
      name: 'Break', bars: 2, channels: [
        { channel: ids.kick, steps: 'X---x---x---x---' },
        { channel: 'Pluck Lead', text: 'A4 0 4 100; C5+E5 4 4 90\nG4 8 2 slide' },
        { channel: ids.pad, chords: 'Am F', rhythm: 'whole' },
      ],
    });
    expect(written.ok, text(written)).toBe(true);
    const breakId = idOf(written, 'patternId');
    const brk = r.song().patterns.find((p) => p.id === breakId)!;
    expect(brk.bars).toBe(2);
    expect(brk.notes[ids.kick].length).toBe(8); // the one-bar string repeats to fill two bars
    expect(brk.notes[ids.lead].length).toBe(4);
    expect(brk.notes[ids.lead].some((n) => n.slide)).toBe(true);

    const arranged = await r.run('music_arrange', {
      sections: [
        { name: 'intro', bars: 4, patterns: [stacked.name] },
        { name: 'verse', bars: 8, patterns: [patternId, 'Break'] },
        { name: 'outro', bars: 2, patterns: ['Break'] },
      ],
    });
    expect(arranged.ok, text(arranged)).toBe(true);
    expect(r.song().playlist.markers.map((m) => [m.name, m.kind, m.at])).toEqual([['intro', 'intro', 0], ['verse', 'verse', 64], ['outro', 'outro', 192]]);
    expect(r.song().playlist.clips.length).toBe(4);
    const kickInsert = r.song().channels.find((c) => c.id === ids.kick)!.insert;
    const bassInsert = r.song().channels.find((c) => c.id === ids.bass)!.insert;
    const padInsert = r.song().channels.find((c) => c.id === ids.pad)!.insert;

    const mixed = await r.run('music_mixer', {
      inserts: [
        { insert: bassInsert, volume: -3, effects: [{ type: 'compressor', params: { threshold: -14, ratio: 4 } }], sidechainFrom: kickInsert },
        { insert: padInsert, pan: -0.2, effects: [{ type: 'eq', params: { b1Freq: 200 } }, { type: 'reverb', params: { decay: 3 }, mix: 0.3 }] },
        { insert: 'Pluck Lead', effects: [{ type: 'filter', params: { cutoff: 800 } }] },
      ],
    });
    expect(mixed.ok, text(mixed)).toBe(true);
    const bassFx = r.song().mixer.inserts[bassInsert].effects.map((e) => e.type);
    expect(bassFx).toEqual(['sidechain', 'compressor']);
    expect(r.song().mixer.inserts[kickInsert].sends).toContainEqual({ to: bassInsert, level: 1, sidechain: true });
    expect(r.song().mixer.inserts[padInsert].effects.map((e) => e.type)).toEqual(['eq', 'reverb']);

    const leadInsert = r.song().channels.find((c) => c.id === ids.lead)!.insert;
    const sweep = await r.run('music_automate', { target: { kind: 'effect', insert: leadInsert, effect: 'filter', param: 'cutoff' }, startBar: 4, bars: 8, shape: 'sweep', from: 400, to: 8000 });
    expect(sweep.ok, text(sweep)).toBe(true);
    const vol = await r.run('music_automate', { target: { kind: 'insert', insert: padInsert, param: 'volume' }, bars: 4, shape: 'ramp-up', from: -20, to: 0 });
    expect(vol.ok, text(vol)).toBe(true);
    expect(r.song().automations.length).toBe(2);
    const auto = r.song().automations.find((a) => a.target.kind === 'effect')!;
    expect(auto.points[0].v).toBeCloseTo((400 - 20) / (20000 - 20));
    expect(auto.points[1].v).toBeCloseTo((8000 - 20) / (20000 - 20));
    const clip = r.song().playlist.clips.find((c) => c.automationId === auto.id)!;
    expect(clip).toMatchObject({ kind: 'automation', start: 64, length: 128 });
    // the same control over the same span is replaced, not stacked
    await r.run('music_automate', { target: { kind: 'effect', insert: leadInsert, effect: 'filter', param: 'cutoff' }, startBar: 4, bars: 8, shape: 'ramp-down', from: 8000, to: 400 });
    expect(r.song().automations.filter((a) => a.target.kind === 'effect').length).toBe(1);

    const edit = await r.run('music_edit_notes', { patternId, channelId: ids.lead, op: 'humanize', seed: 3 });
    expect(edit.ok, text(edit)).toBe(true);

    const song = r.song();
    expect(normalizeSong(song)).not.toBeNull();
    const patternIds = new Set(song.patterns.map((p) => p.id));
    for (const c of song.playlist.clips) {
      if (c.kind === 'pattern') expect(patternIds.has(c.patternId!)).toBe(true);
      expect(c.length).toBeGreaterThan(0);
    }
    const read = await r.run('music_get_song', { detail: 'full' });
    const out = text(read);
    for (const word of ['Session', '92 BPM', 'A minor', 'Kick', 'Sub Bass', 'Warm Pad', 'Pluck Lead', 'compressor', 'sidechain', 'intro', 'verse', 'outro', 'AUTOMATION', 'Break', ids.kick]) expect(out, word).toContain(word);
    expect(out).toMatch(/x---|X---/);
    expect(out).toMatch(/[A-G]#?\d@\d+(\.\d+)?\+/);
    // 1 new_song, 1 set_song, 6 add_channel, 2 generate, 1 write_pattern, 1 arrange, 1 mixer, 3 automate, 1 edit_notes
    expect(r.commits()).toBe(1 + 1 + 6 + 2 + 1 + 1 + 1 + 3 + 1);
    expect(songReadout(song, { detail: 'summary', grid: true, patternId })).toContain('PIANO ROLL');
  });

  it('rejects bad input with the valid names, and clamps values', async () => {
    const r = rig();
    await r.run('music_new_song', { template: 'empty' });
    const before = r.commits();
    const bad = await r.run('music_add_channel', { instrument: 'synth', params: { wobble: 3 } });
    expect(bad.ok).toBe(false);
    expect(text(bad)).toContain('unknown synth parameter "wobble"');
    expect(text(bad)).toContain('cutoff');
    expect((await r.run('music_add_channel', { preset: 'nope' })).ok).toBe(false);
    expect((await r.run('music_add_channel', { instrument: 'drum' })).ok).toBe(false);
    expect((await r.run('music_add_channel', {})).ok).toBe(false);
    expect(r.commits()).toBe(before);

    const ok = await r.run('music_add_channel', { instrument: 'synth', name: 'Lead', params: { cutoff: 999999, osc1Wave: 'saw', unison: 3.7 }, volume: 9, pan: -4 });
    expect(ok.ok, text(ok)).toBe(true);
    expect(text(ok)).toContain('cutoff');
    const channel = r.song().channels[0];
    expect(channel.params).toMatchObject({ cutoff: 20000, osc1Wave: 1, unison: 4 });
    expect(channel).toMatchObject({ volume: 1.25, pan: -1 });
    const dup = await r.run('music_add_channel', { instrument: 'synth', name: 'Lead' });
    expect(r.song().channels[1].name).toBe('Lead 2');
    expect(dup.ok).toBe(true);
  });

  it('reports what it could not read when writing a pattern, never dropping it silently', async () => {
    const r = rig();
    await r.run('music_new_song', { template: 'empty' });
    const ch = idOf(await r.run('music_add_channel', { preset: 'pluck-lead' }), 'channelId');
    const kick = idOf(await r.run('music_add_channel', { preset: 'kick-808' }), 'channelId');
    const partial = await r.run('music_write_pattern', {
      channels: [{ channel: ch, text: 'C4 0 4 100; H9 4 4; D4 x 2', notes: [{ key: 'E4', start: 8, length: 2 }, { key: 'zz', start: 0 }, 'G4 12 2'] }],
    });
    expect(partial.ok).toBe(true);
    expect(text(partial)).toContain('NOT written (3)');
    expect(text(partial)).toContain('H9 4 4');
    expect(text(partial)).toContain('notes[1]');
    expect(r.song().patterns[r.song().patterns.length - 1].notes[ch].length).toBe(3);
    const none = await r.run('music_write_pattern', { channels: [{ channel: kick, steps: 'x-?-' }] });
    expect(none.ok).toBe(false);
    expect(text(none)).toContain('characters I cannot read');
    expect((await r.run('music_write_pattern', { patternId: 'nope', channels: [{ channel: ch, text: 'C4 0 1' }] })).ok).toBe(false);
    expect((await r.run('music_write_pattern', { channels: [{ channel: 'Ghost', text: 'C4 0 1' }] })).ok).toBe(false);
    // merge adds, clear empties
    const patternId = r.song().patterns[r.song().patterns.length - 1].id;
    await r.run('music_write_pattern', { patternId, mode: 'merge', channels: [{ channel: ch, text: 'A4 16 2' }] });
    expect(r.song().patterns.find((p) => p.id === patternId)!.notes[ch].length).toBe(4);
    expect(r.song().patterns.find((p) => p.id === patternId)!.bars).toBe(2);
    await r.run('music_write_pattern', { patternId, channels: [{ channel: ch, mode: 'clear' }] });
    expect(r.song().patterns.find((p) => p.id === patternId)!.notes[ch]).toEqual([]);
  });

  it('edits channels, notes, clips, markers and the loop', async () => {
    const r = rig();
    await r.run('music_new_song', { template: 'lofi', seed: 4 });
    const song0 = r.song();
    const lead = song0.channels.find((c) => c.name === 'Kalimba')!;
    const patternId = song0.patterns.find((p) => p.name === 'Melody')!.id;
    const before = song0.patterns.find((p) => p.id === patternId)!.notes[lead.id];
    const up = await r.run('music_edit_notes', { patternId, channelId: lead.name, op: 'transpose', semitones: 12 });
    expect(up.ok, text(up)).toBe(true);
    expect(r.song().patterns.find((p) => p.id === patternId)!.notes[lead.id].map((n) => n.key).sort()).toEqual(before.map((n) => n.key + 12).sort());
    expect((await r.run('music_edit_notes', { patternId, channelId: lead.id, op: 'transpose' })).ok).toBe(false);
    expect((await r.run('music_edit_notes', { patternId, channelId: lead.id, op: 'explode' })).ok).toBe(false);
    const part = await r.run('music_edit_notes', { patternId, channelId: lead.id, op: 'remove', fromStep: 0, toStep: 16 });
    expect(part.ok, text(part)).toBe(true);
    expect(r.song().patterns.find((p) => p.id === patternId)!.notes[lead.id].every((n) => n.start >= 16)).toBe(true);

    const renamed = await r.run('music_update_channel', { channelId: lead.id, name: 'Lead Kalimba', volume: 0.5, params: { decay: 2 }, mute: true });
    expect(renamed.ok, text(renamed)).toBe(true);
    expect(r.song().channels.find((c) => c.id === lead.id)).toMatchObject({ name: 'Lead Kalimba', volume: 0.5, mute: true });
    expect((await r.run('music_update_channel', { channelId: lead.id, params: { nonsense: 1 } })).ok).toBe(false);
    expect((await r.run('music_update_channel', { channelId: 'ghost', volume: 1 })).ok).toBe(false);
    expect((await r.run('music_update_channel', { channelId: lead.id })).ok).toBe(false);

    const clips0 = r.song().playlist.clips.length;
    const added = await r.run('music_arrange', { clips: [{ op: 'add', patternId, startBar: 40, bars: 2, track: 9 }], markers: [{ op: 'add', name: 'Tag', bar: 40 }], loop: { startBar: 8, endBar: 16 } });
    expect(added.ok, text(added)).toBe(true);
    expect(r.song().playlist.clips.length).toBe(clips0 + 1);
    expect(r.song().playlist.loop).toEqual({ start: 128, end: 256 });
    expect(r.song().playlist.markers.some((m) => m.name === 'Tag')).toBe(true);
    const newClip = r.song().playlist.clips.find((c) => c.trackIndex === 9)!;
    expect((await r.run('music_arrange', { clips: [{ op: 'update', clipId: newClip.id, startBar: 42, muted: true }] })).ok).toBe(true);
    expect(r.song().playlist.clips.find((c) => c.id === newClip.id)).toMatchObject({ start: 672, muted: true });
    expect((await r.run('music_arrange', { clips: [{ op: 'remove', clipId: newClip.id }], markers: [{ op: 'remove', name: 'Tag' }], loop: null })).ok).toBe(true);
    expect(r.song().playlist.clips.length).toBe(clips0);
    expect(r.song().playlist.loop).toBeNull();
    const bad = await r.run('music_arrange', { sections: [{ name: 'x', bars: 4, patterns: ['Nope'] }] });
    expect(bad.ok).toBe(true); // the marker lands, the unknown pattern is reported
    expect(text(bad)).toContain('unknown pattern "Nope"');
    expect((await r.run('music_arrange', {})).ok).toBe(false);

    const gone = await r.run('music_update_channel', { channelId: lead.id, remove: true });
    expect(gone.ok, text(gone)).toBe(true);
    expect(r.song().channels.some((c) => c.id === lead.id)).toBe(false);
    expect(r.song().patterns.every((p) => !(lead.id in p.notes))).toBe(true);
  });

  it('validates mixer and automation input', async () => {
    const r = rig();
    await r.run('music_new_song', { template: 'house', seed: 2 });
    const before = r.commits();
    const badParam = await r.run('music_mixer', { insert: 1, effects: [{ type: 'reverb', params: { wetness: 1 } }] });
    expect(badParam.ok).toBe(false);
    expect(text(badParam)).toContain('unknown reverb parameter "wetness"');
    expect(text(badParam)).toContain('decay');
    expect((await r.run('music_mixer', { insert: 'No such insert', volume: 0 })).ok).toBe(false);
    expect((await r.run('music_mixer', { insert: 1 })).ok).toBe(false);
    expect((await r.run('music_automate', { target: { kind: 'insert', insert: 1, param: 'nope' }, to: 1 })).ok).toBe(false);
    expect((await r.run('music_automate', { target: { kind: 'insert', insert: 1, param: 'volume' } })).ok).toBe(false);
    expect((await r.run('music_automate', { target: { kind: 'effect', insert: 1, effect: 'chorus', param: 'rate' }, to: 1 })).ok).toBe(false);
    expect(r.commits()).toBe(before);

    const clamped = await r.run('music_mixer', { insert: 1, volume: -99, pan: 7, effects: [{ type: 'compressor', params: { ratio: 99 } }] });
    expect(clamped.ok, text(clamped)).toBe(true);
    expect(r.song().mixer.inserts[1]).toMatchObject({ volume: -60, pan: 1 });
    const comp = r.song().mixer.inserts[1].effects.filter((e) => e.type === 'compressor').pop()!;
    expect(comp.params.ratio).toBe(20);
    const update = await r.run('music_mixer', { insert: 1, effects: [{ op: 'update', effectId: comp.id, params: { ratio: 2 }, mix: 0.5 }] });
    expect(update.ok, text(update)).toBe(true);
    expect(r.song().mixer.inserts[1].effects.find((e) => e.id === comp.id)).toMatchObject({ mix: 0.5, params: { ratio: 2 } });
    await r.run('music_mixer', { insert: 1, effects: [{ op: 'remove', effectId: comp.id }] });
    expect(r.song().mixer.inserts[1].effects.some((e) => e.id === comp.id)).toBe(false);

    const lfo = await r.run('music_automate', { target: { kind: 'insert', insert: 2, param: 'pan' }, startBar: 0, bars: 2, shape: 'lfo', from: -1, to: 1, cycles: 2 });
    expect(lfo.ok, text(lfo)).toBe(true);
    const pump = await r.run('music_automate', { target: { kind: 'insert', insert: 3, param: 'volume' }, bars: 1, shape: 'pump', from: -12, to: 0 });
    expect(pump.ok, text(pump)).toBe(true);
    const pts = await r.run('music_automate', { target: { kind: 'tempo' }, points: [{ bar: 0, value: 100 }, { bar: 4, value: 140, curve: 'smooth' }], bars: 4 });
    expect(pts.ok, text(pts)).toBe(true);
    const tempo = r.song().automations.find((a) => a.target.kind === 'tempo')!;
    expect(tempo.points.map((p) => p.t)).toEqual([0, 64]);
    expect(tempo.points[0].v).toBeCloseTo((100 - 20) / 280);
    const removed = await r.run('music_automate', { automationId: tempo.id, remove: true });
    expect(removed.ok, text(removed)).toBe(true);
    expect(r.song().automations.some((a) => a.id === tempo.id)).toBe(false);
  });

  it('answers the guide, and the studio request', async () => {
    const r = rig();
    const overview = await r.run('music_studio_guide');
    expect(text(overview)).toContain('WORKFLOW');
    expect(text(overview)).toContain('NOTE SYNTAX');
    expect(text(overview)).toContain('kick-808');
    const synth = await r.run('music_studio_guide', { instrument: 'synth' });
    expect(text(synth)).toContain('osc{1-3}Wave');
    expect(text(synth)).toContain('cutoff');
    expect(text(await r.run('music_studio_guide', { effect: 'compressor' }))).toContain('threshold');
    expect(text(await r.run('music_studio_guide', { topic: 'effects' }))).toContain('sidechain');
    expect(text(await r.run('music_studio_guide', { topic: 'grooves' }))).toContain('dembow');

    const seen: StudioRequest[] = [];
    const off = onStudioRequest((req) => seen.push(req));
    await r.run('music_new_song', { template: 'beat', seed: 1 });
    const patternId = r.song().patterns[0].id;
    const opened = await r.run('music_open_studio', { window: 'pianoroll', patternId });
    off();
    expect(opened.ok, text(opened)).toBe(true);
    expect(seen).toEqual([{ open: true, window: 'pianoroll', patternId }]);
    expect((await r.run('music_open_studio', { window: 'sky' })).ok).toBe(false);
  });

  it('fails gracefully where there is no Web Audio, and changes nothing', async () => {
    const r = rig();
    expect((await r.run('music_render')).ok).toBe(false);
    expect((await r.run('music_analyze_mix')).ok).toBe(false);
    await r.run('music_new_song', { template: 'lofi', seed: 6 });
    const before = r.commits();
    const analysed = await r.run('music_analyze_mix');
    expect(analysed.ok).toBe(false);
    expect(typeof (analysed as { error: string }).error).toBe('string');
    const rendered = await r.run('music_render', { place: true });
    expect(rendered.ok).toBe(false);
    expect(typeof (rendered as { error: string }).error).toBe('string');
    expect(r.commits()).toBe(before);
    expect(r.imported).toEqual([]);
    const unarranged = await r.run('music_new_song', { template: 'empty', replace: true });
    expect(unarranged.ok).toBe(true);
    expect((await r.run('music_render', { mode: 'song' })).ok).toBe(false);
  });

  it('reads keys', () => {
    expect(parseKeyText('A minor')).toEqual({ root: 9, scale: 'minor' });
    expect(parseKeyText('F# dorian')).toEqual({ root: 6, scale: 'dorian' });
    expect(parseKeyText('Bb')).toEqual({ root: 10 });
    expect(parseKeyText('Am')).toEqual({ root: 9, scale: 'minor' });
    expect(parseKeyText('harmonic minor')).toBeNull();
    expect(parseKeyText('D harmonic minor')).toEqual({ root: 2, scale: 'harmonic-minor' });
    expect(parseKeyText('nonsense')).toBeNull();
  });
});

describe('routing', () => {
  afterEach(() => setStudioOpen(false));

  it('recognises asks about making music, and leaves ordinary video asks alone', () => {
    for (const ask of ['make a lofi beat at 80 bpm', 'write a melody over these chords', 'produce a trap song with a sliding 808', 'compose a cinematic track', 'add a bassline and some drums', 'open the music studio', 'mix and master my song with sidechain compression']) {
      expect(isMusicAsk(ask), ask).toBe(true);
    }
    for (const ask of ['add a video track to the timeline', 'cut my wedding clips to the song', 'snap the cuts to the beat', 'make a saas explainer for my app', 'add background music', 'bass boost the voice-over', 'create an audio track for the narration', 'tighten my podcast footage']) {
      expect(isMusicAsk(ask), ask).toBe(false);
    }
  });

  it('sends the music tools whole (and loaded) only when the ask is about music or the studio is open', () => {
    const music = routeTools('make a lofi beat at 80 bpm with a chill melody');
    for (const tool of MUSIC_GROUP) { expect(music.full, tool).toContain(tool); expect(music.core, tool).toContain(tool); }
    const followUp = routeTools('make it faster', ['write a melody and drums for my intro']);
    expect(followUp.full).toContain('music_generate');
    const plain = routeTools('add a video track to the timeline');
    for (const tool of MUSIC_GROUP) expect(plain.full, tool).not.toContain(tool);
    setStudioOpen(true);
    const open = routeTools('make it better');
    expect(open.full).toContain('music_get_song');
    expect(open.genres).toEqual(['edit', 'motion']);
  });
});
