import { afterEach, describe, expect, it } from 'vitest';
import catalog from '../src/lib/ai-tools.json';
import { MUSIC_TOOLS, parseKeyText, runMusicTool, SNAP_NAMES, validateParams, type MusicToolContext } from '../src/lib/musicTools';
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
import { placeSongLayer } from '../src/music/timeline';
import { CHANNEL_PRESETS, SONG_TEMPLATE_LIST, layoutSections, presetChannel, songFromTemplate } from '../src/music/templates';
import { SCALE_NAMES, SCALES } from '../src/music/theory';
import { EFFECT_SPECS, INSTRUMENT_SPECS, type MusicProject } from '../src/music/types';
import { newSong } from '../src/music/model';

type Tool = { name: string; description: string; input_schema: { type: string; properties: Record<string, { enum?: string[]; items?: { enum?: string[] } }>; additionalProperties?: boolean } };
const tools = (catalog as unknown as { tools: Tool[] }).tools;
const musicSpecs = tools.filter((t) => t.name.startsWith('music_'));

/** A project and a host the music tools can run against, counting commits. */
function rig(assets: Map<string, unknown> = new Map()) {
  let project: Project = newProject('Test');
  let commits = 0;
  const imported: string[][] = [];
  const host = {
    history: { current: () => project, commit: (change: (p: Project) => Project) => { project = change(project); } },
    assets: () => assets,
    selection: () => [],
    setSelection: () => undefined,
    importMedia: async (paths: string[]) => { imported.push(paths); return []; },
    speak: async () => { throw new Error('no'); },
    ask: async () => '',
    testing: true,
  } as unknown as ToolHost;
  const ctx: MusicToolContext = { commit: (change) => { project = change(project); commits++; }, current: () => project, pickComp: (p) => p.comps[0], folderFor: () => 'folder-music' };
  const run = (name: string, args: Record<string, unknown> = {}) => runMusicTool(host, name, args, ctx);
  return { run, song: (): MusicProject => project.music!, project: () => project, setProject: (next: Project) => { project = next; }, commits: () => commits, imported };
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
    expect(enumOf('music_edit_notes', 'op')?.filter((op) => op !== 'remove' && !['length', 'slice', 'set', 'copy'].includes(op))).toEqual(NOTE_OPS);
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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// "The AI has all the tools it needs to do everything inside the Music Studio": each block below
// walks a family of studio actions (docs of the UI: Toolbar, PatternPicker, ChannelRack, PianoRoll,
// Playlist, Mixer, Browser, ParamPanel) through the tools and checks the song the studio would show.

describe('studio actions through the tools', () => {
  afterEach(() => setStudioOpen(false));
  const schemaProps = (tool: string) => Object.keys(musicSpecs.find((t) => t.name === tool)!.input_schema.properties);

  it('exposes every new argument in the strict schemas', () => {
    expect(schemaProps('music_open_studio')).toEqual(expect.arrayContaining(['window', 'patternId', 'channelId', 'mode', 'transport', 'fromBar', 'metronome', 'snap', 'browser', 'playlist', 'panel', 'closePanels']));
    expect(schemaProps('music_arrange')).toEqual(expect.arrayContaining(['patterns', 'tracks', 'sections', 'clips', 'markers', 'loop']));
    expect(schemaProps('music_edit_notes')).toEqual(expect.arrayContaining(['at', 'every', 'props', 'toPatternId', 'toChannelId', 'toStep']));
    expect(schemaProps('music_update_channel')).toEqual(expect.arrayContaining(['clone', 'moveTo', 'group']));
    expect(schemaProps('music_mixer')).toContain('color');
    expect(musicSpecs.find((t) => t.name === 'music_open_studio')!.input_schema.properties.snap.enum).toEqual([...SNAP_NAMES]);
    for (const spec of musicSpecs) expect(spec.input_schema.additionalProperties, spec.name).toBe(false);
  });

  it('copies, reorders, groups and recolours channels (Channel Rack row menu)', async () => {
    const r = rig();
    await r.run('music_new_song', { template: 'empty' });
    const kick = idOf(await r.run('music_add_channel', { preset: 'kick-punchy' }), 'channelId');
    const snare = idOf(await r.run('music_add_channel', { preset: 'snare-tight' }), 'channelId');
    const lead = idOf(await r.run('music_add_channel', { preset: 'pluck-lead' }), 'channelId');
    const made = await r.run('music_write_pattern', { name: 'Loop', channels: [{ channel: kick, steps: 'X---x---x---x---' }, { channel: lead, text: 'C4 0 4 100; E4 4 4' }] });
    const patternId = idOf(made, 'patternId');

    const cloned = await r.run('music_update_channel', { channelId: kick, clone: true });
    expect(cloned.ok, text(cloned)).toBe(true);
    const names = r.song().channels.map((c) => c.name);
    expect(names).toEqual(['Punchy Kick', 'Punchy Kick copy', 'Tight Snare', 'Pluck Lead']);
    const copy = r.song().channels[1];
    expect(copy.insert).toBe(r.song().channels[0].insert);
    expect(r.song().view.selectedChannelId).toBe(copy.id);
    const loop = r.song().patterns.find((p) => p.id === patternId)!;
    expect(loop.notes[copy.id].length).toBe(loop.notes[kick].length);
    expect(loop.notes[copy.id].every((n) => !loop.notes[kick].some((o) => o.id === n.id))).toBe(true);

    // clone with a name and another change in one call: the change goes to the copy
    const named = await r.run('music_update_channel', { channelId: lead, clone: true, name: 'Lead 2', volume: 0.4, group: 'Leads' });
    expect(named.ok, text(named)).toBe(true);
    expect(r.song().channels.find((c) => c.name === 'Lead 2')).toMatchObject({ volume: 0.4, group: 'Leads' });
    expect(r.song().channels.find((c) => c.id === lead)!.volume).not.toBe(0.4);
    expect((await r.run('music_update_channel', { channelId: lead, clone: true, name: 'Lead 2' })).ok).toBe(false);

    const moved = await r.run('music_update_channel', { channelId: 'Tight Snare', moveTo: 0 });
    expect(moved.ok, text(moved)).toBe(true);
    expect(r.song().channels[0].id).toBe(snare);
    expect((await r.run('music_update_channel', { channelId: 'Tight Snare', moveTo: 99 })).ok).toBe(false);
    expect((await r.run('music_update_channel', { channelId: snare, group: '' })).ok).toBe(true);
    expect(r.song().channels.find((c) => c.id === snare)!.group).toBeUndefined();

    const before = r.commits();
    const bad = await r.run('music_update_channel', { channelId: snare, color: 'red' });
    expect(bad.ok).toBe(false);
    expect(text(bad)).toContain('#rrggbb');
    expect((await r.run('music_add_channel', { preset: 'hat-house', color: 'nope' })).ok).toBe(false);
    expect(r.commits()).toBe(before);
    expect((await r.run('music_update_channel', { channelId: snare, color: '#336699' })).ok).toBe(true);
    expect(r.song().channels.find((c) => c.id === snare)!.color).toBe('#336699');
  });

  it('resizes, slices, flags and copies notes (Piano Roll)', async () => {
    const r = rig();
    await r.run('music_new_song', { template: 'empty' });
    const lead = idOf(await r.run('music_add_channel', { preset: 'pluck-lead' }), 'channelId');
    const bass = idOf(await r.run('music_add_channel', { preset: 'sub-bass' }), 'channelId');
    const patternId = idOf(await r.run('music_write_pattern', { name: 'Roll', channels: [{ channel: lead, text: 'C4 0 8 100; E4 8 4 90; G4 12 4 80' }] }), 'patternId');
    const notes = () => r.song().patterns.find((p) => p.id === patternId)!.notes[lead];

    expect((await r.run('music_edit_notes', { patternId, channelId: lead, op: 'length', set: 2 })).ok).toBe(true);
    expect(notes().map((n) => n.length)).toEqual([2, 2, 2]);
    expect((await r.run('music_edit_notes', { patternId, channelId: lead, op: 'length', multiply: 2, fromStep: 8 })).ok).toBe(true);
    expect(notes().map((n) => n.length)).toEqual([2, 4, 4]);
    expect((await r.run('music_edit_notes', { patternId, channelId: lead, op: 'length', set: 8, toStep: 1 })).ok).toBe(true);
    expect(notes()[0].length).toBe(8);
    expect((await r.run('music_edit_notes', { patternId, channelId: lead, op: 'length' })).ok).toBe(false);
    expect((await r.run('music_edit_notes', { patternId, channelId: lead, op: 'length', set: -1 })).ok).toBe(false);

    // slice: one cut, then chop
    const cut = await r.run('music_edit_notes', { patternId, channelId: lead, op: 'slice', at: 4 });
    expect(cut.ok, text(cut)).toBe(true);
    expect(notes().filter((n) => n.key === 60).map((n) => [n.start, n.length])).toEqual([[0, 4], [4, 4]]);
    expect((await r.run('music_edit_notes', { patternId, channelId: lead, op: 'slice', at: 100 })).ok).toBe(false);
    expect((await r.run('music_edit_notes', { patternId, channelId: lead, op: 'slice' })).ok).toBe(false);
    const chop = await r.run('music_edit_notes', { patternId, channelId: lead, op: 'slice', every: 1, minKey: 'E4', maxKey: 'E4' });
    expect(chop.ok, text(chop)).toBe(true);
    expect(notes().filter((n) => n.key === 64).map((n) => n.start)).toEqual([8, 9, 10, 11]);
    expect(new Set(notes().map((n) => n.id)).size).toBe(notes().length);

    // per-note flags: set and clear
    const flagged = await r.run('music_edit_notes', { patternId, channelId: lead, op: 'set', fromStep: 12, props: { slide: true, probability: 0.5, ratchet: 3, pan: -0.5, fine: 20, mute: true } });
    expect(flagged.ok, text(flagged)).toBe(true);
    expect(notes().find((n) => n.key === 67)).toMatchObject({ slide: true, probability: 0.5, ratchet: 3, pan: -0.5, fine: 20, mute: true });
    expect(notes().find((n) => n.key === 60)!.slide).toBeUndefined();
    await r.run('music_edit_notes', { patternId, channelId: lead, op: 'set', fromStep: 12, props: { slide: false, probability: 1, ratchet: 1, pan: 0, fine: 0, mute: false } });
    expect(Object.keys(notes().find((n) => n.key === 67)!).sort()).toEqual(['id', 'key', 'length', 'start', 'velocity']);
    const unknown = await r.run('music_edit_notes', { patternId, channelId: lead, op: 'set', props: { wobble: 1 } });
    expect(unknown.ok).toBe(false);
    expect(text(unknown)).toContain('slide, probability, ratchet, pan, fine, mute');
    expect((await r.run('music_edit_notes', { patternId, channelId: lead, op: 'set' })).ok).toBe(false);

    // copy: to another channel in the same pattern, to another pattern shifted, and the guard against stacking in place
    const toBass = await r.run('music_edit_notes', { patternId, channelId: lead, op: 'copy', toChannelId: bass, minKey: 'C4', maxKey: 'C4' });
    expect(toBass.ok, text(toBass)).toBe(true);
    expect(r.song().patterns.find((p) => p.id === patternId)!.notes[bass].length).toBe(2);
    const other = idOf(await r.run('music_write_pattern', { name: 'Other', bars: 2, channels: [{ channel: bass, text: 'C2 0 4' }] }), 'patternId');
    const shifted = await r.run('music_edit_notes', { patternId, channelId: lead, op: 'copy', toPatternId: other, toStep: 16, fromStep: 8 });
    expect(shifted.ok, text(shifted)).toBe(true);
    const copied = r.song().patterns.find((p) => p.id === other)!.notes[lead];
    expect(copied.map((n) => n.start)).toEqual([16, 17, 18, 19, 20]);
    expect(r.song().patterns.find((p) => p.id === other)!.bars).toBe(2);
    expect(notes().length).toBeGreaterThan(copied.length - 1);
    const guard = await r.run('music_edit_notes', { patternId, channelId: lead, op: 'copy' });
    expect(guard.ok).toBe(false);
    expect(text(guard)).toContain('toStep');
    expect((await r.run('music_edit_notes', { patternId, channelId: lead, op: 'copy', toPatternId: 'ghost' })).ok).toBe(false);
  });

  it('manages patterns and playlist tracks, and edits clips and markers (Pattern picker, Playlist)', async () => {
    const r = rig();
    await r.run('music_new_song', { template: 'empty' });
    const kick = idOf(await r.run('music_add_channel', { preset: 'kick-punchy' }), 'channelId');
    const first = r.song().patterns[0].id;

    // patterns: add, rename + colour + resize, clone, duplicate names, remove, last-pattern guard
    const added = await r.run('music_arrange', { patterns: [{ op: 'add', name: 'Verse', bars: 4, color: '#112233' }] });
    expect(added.ok, text(added)).toBe(true);
    const verse = (added.patterns as string[])[0];
    expect(r.song().patterns.find((p) => p.id === verse)).toMatchObject({ name: 'Verse', bars: 4, color: '#112233' });
    expect(r.song().view.activePatternId).toBe(verse);
    const renamed = await r.run('music_arrange', { patterns: [{ patternId: 'Verse', name: 'Verse A', color: '#445566', bars: 2 }] });
    expect(renamed.ok, text(renamed)).toBe(true);
    expect(r.song().patterns.find((p) => p.id === verse)).toMatchObject({ name: 'Verse A', color: '#445566', bars: 2 });
    const clone = await r.run('music_arrange', { patterns: [{ op: 'clone', patternId: verse, name: 'Verse B' }] });
    expect(clone.ok, text(clone)).toBe(true);
    const verseB = (clone.patterns as string[])[0];
    expect(r.song().patterns.find((p) => p.id === verseB)).toMatchObject({ name: 'Verse B', bars: 2 });
    const dup = await r.run('music_arrange', { patterns: [{ op: 'add', name: 'verse a' }, { patternId: verseB, name: 'Verse A' }, { op: 'update', patternId: verse }, { op: 'add', color: 'blue' }, { op: 'explode' }] });
    expect(dup.ok).toBe(false);
    expect(text(dup)).toContain('already called "verse a"');
    expect(text(dup)).toContain('update needs name, color or bars');
    expect(text(dup)).toContain('#rrggbb');
    expect(text(dup)).toContain('op is add, update, clone or remove');
    await r.run('music_write_pattern', { patternId: verse, channels: [{ channel: kick, steps: 'x---' }] });

    // tracks: add, update, resolve by name
    const tracks = await r.run('music_arrange', { tracks: [{ op: 'add', count: 2, color: '#abcdef' }, { track: 0, name: 'Drums', color: '#ff0000', mute: true }, { track: 'Track 2', solo: true, locked: false }, { op: 'add', name: 'Solo bus' }] });
    expect(tracks.ok, text(tracks)).toBe(true);
    expect(tracks.tracks).toEqual([16, 17, 18]);
    expect(r.song().playlist.tracks.length).toBe(19);
    expect(r.song().playlist.tracks[0]).toMatchObject({ name: 'Drums', color: '#ff0000', mute: true });
    expect(r.song().playlist.tracks[1].solo).toBe(true);
    expect(r.song().playlist.tracks[18].name).toBe('Solo bus');
    const badTrack = await r.run('music_arrange', { tracks: [{ track: 99, mute: true }, { track: 'Nope', mute: true }, { track: 0 }, { op: 'add', count: 999 }] });
    expect(badTrack.ok).toBe(false);
    expect(text(badTrack)).toContain('No track 99');
    expect(text(badTrack)).toContain('No track named "Nope"');

    // clips: add, duplicate (consecutive copies), slice, update with fades, lock refusal
    const placed = await r.run('music_arrange', { clips: [{ op: 'add', patternId: verse, startBar: 0, bars: 2, track: 3 }] });
    const clipId = (placed.clips as string[])[0];
    const clips = () => r.song().playlist.clips;
    const dups = await r.run('music_arrange', { clips: [{ op: 'duplicate', clipId, times: 2 }] });
    expect(dups.ok, text(dups)).toBe(true);
    expect(clips().filter((c) => c.trackIndex === 3).map((c) => c.start)).toEqual([0, 32, 64]);
    const cut = await r.run('music_arrange', { clips: [{ op: 'slice', clipId, atBar: 1 }] });
    expect(cut.ok, text(cut)).toBe(true);
    const right = clips().find((c) => c.id === (cut.clips as string[])[0])!;
    expect(right).toMatchObject({ start: 16, length: 16, offset: 16, trackIndex: 3 });
    expect(clips().find((c) => c.id === clipId)!.length).toBe(16);
    expect((await r.run('music_arrange', { clips: [{ op: 'slice', clipId, atBar: 5 }] })).ok).toBe(false);
    const moved = await r.run('music_arrange', { clips: [{ op: 'update', clipId: right.id, startBar: 2, track: 21, muted: true }] });
    expect(moved.ok, text(moved)).toBe(true);
    expect(clips().find((c) => c.id === right.id)).toMatchObject({ start: 32, trackIndex: 21, muted: true });
    expect(r.song().playlist.tracks.length).toBeGreaterThanOrEqual(22);
    expect((await r.run('music_arrange', { clips: [{ op: 'update', clipId, fadeIn: -1 }] })).ok).toBe(false);

    await r.run('music_arrange', { tracks: [{ track: 3, locked: true }] });
    const locked = await r.run('music_arrange', { clips: [{ op: 'update', clipId, startBar: 9 }, { op: 'slice', clipId, atBar: 0.5 }, { op: 'duplicate', clipId }, { op: 'remove', clipId }, { op: 'add', patternId: verse, startBar: 40, track: 3 }] });
    expect(locked.ok).toBe(false);
    expect(text(locked)).toContain('track 3 is locked');
    expect(clips().find((c) => c.id === clipId)).toMatchObject({ start: 0 });
    const byPattern = await r.run('music_arrange', { clips: [{ op: 'remove', patternId: verse }] });
    expect(byPattern.ok, text(byPattern)).toBe(true);
    expect(text(byPattern)).toContain('locked tracks');
    expect(clips().every((c) => c.trackIndex === 3)).toBe(true);
    await r.run('music_arrange', { tracks: [{ track: 3, locked: false }] });
    expect((await r.run('music_arrange', { clips: [{ op: 'remove', clipId }] })).ok).toBe(true);

    // markers: add, update (rename, move, kind), remove by id
    await r.run('music_arrange', { markers: [{ op: 'add', name: 'Tag', bar: 2 }] });
    const marker = r.song().playlist.markers[0];
    const edited = await r.run('music_arrange', { markers: [{ op: 'update', id: marker.id, name: 'Hook', bar: 4, kind: 'chorus' }] });
    expect(edited.ok, text(edited)).toBe(true);
    expect(r.song().playlist.markers[0]).toMatchObject({ id: marker.id, name: 'Hook', at: 64, kind: 'chorus' });
    expect((await r.run('music_arrange', { markers: [{ op: 'update', id: marker.id }, { op: 'update', id: 'ghost', name: 'x' }, { op: 'update', id: marker.id, kind: 'solo' }] })).ok).toBe(false);
    expect((await r.run('music_arrange', { markers: [{ op: 'remove', id: marker.id }] })).ok).toBe(true);
    expect(r.song().playlist.markers.length).toBe(0);

    // patterns last: removing one takes its clips, the last pattern stays
    await r.run('music_arrange', { clips: [{ op: 'add', patternId: verseB, startBar: 0, bars: 2 }] });
    const gone = await r.run('music_arrange', { patterns: [{ op: 'remove', patternId: verseB }] });
    expect(gone.ok, text(gone)).toBe(true);
    expect(text(gone)).toContain('1 playlist clip');
    expect(r.song().patterns.some((p) => p.id === verseB)).toBe(false);
    expect(clips().every((c) => c.patternId !== verseB)).toBe(true);
    await r.run('music_arrange', { patterns: [{ op: 'remove', patternId: verse }] });
    const only = await r.run('music_arrange', { patterns: [{ op: 'remove', patternId: first }] });
    expect(only.ok).toBe(false);
    expect(text(only)).toContain('a song needs one pattern');
    expect(r.song().patterns.length).toBe(1);
  });

  it('colours and creates mixer inserts, and renames automations (Mixer, automation clips)', async () => {
    const r = rig();
    await r.run('music_new_song', { template: 'house', seed: 2 });
    const before = r.song().mixer.inserts.length;
    const coloured = await r.run('music_mixer', { inserts: [{ insert: 2, color: '#123456', name: 'Bass bus' }, { insert: 20, color: '#654321' }] });
    expect(coloured.ok, text(coloured)).toBe(true);
    expect(r.song().mixer.inserts[2]).toMatchObject({ color: '#123456', name: 'Bass bus' });
    expect(r.song().mixer.inserts.length).toBeGreaterThan(before - 1);
    expect(r.song().mixer.inserts[20].color).toBe('#654321');
    const bad = await r.run('music_mixer', { insert: 2, color: 'teal' });
    expect(bad.ok).toBe(false);
    expect(text(bad)).toContain('#rrggbb');

    const auto = await r.run('music_automate', { target: { kind: 'insert', insert: 2, param: 'volume' }, bars: 2, shape: 'ramp-up', from: -20, to: 0 });
    const id = idOf(auto, 'automationId');
    const rename = await r.run('music_automate', { automationId: id, name: 'Bass fade-in' });
    expect(rename.ok, text(rename)).toBe(true);
    expect(r.song().automations.find((a) => a.id === id)!.name).toBe('Bass fade-in');
    expect((await r.run('music_automate', { automationId: id })).ok).toBe(false);
    expect((await r.run('music_automate', { automationId: 'ghost', name: 'x' })).ok).toBe(false);
    expect((await r.run('music_automate', { automationId: id, name: 'x', shape: 'sweep', to: 1 })).ok).toBe(false);
  });

  it('adds audio clips with fades from the bin, and reads them back', async () => {
    const assets = new Map<string, unknown>([['a1', { id: 'a1', name: 'vocal.wav', kind: 'audio', duration: 4 }]]);
    const r = rig(assets);
    await r.run('music_new_song', { template: 'empty' });
    const added = await r.run('music_arrange', { clips: [{ op: 'add', assetId: 'a1', startBar: 1, track: 4, gain: -3, fadeIn: 0.5, fadeOut: 1 }] });
    expect(added.ok, text(added)).toBe(true);
    const clip = r.song().playlist.clips[0];
    expect(clip).toMatchObject({ kind: 'audio', assetId: 'a1', gain: -3, fadeIn: 0.5, fadeOut: 1, trackIndex: 4 });
    await r.run('music_arrange', { tracks: [{ track: 4, name: 'Vocal', locked: true }, { track: 5, mute: true }] });
    const read = text(await r.run('music_get_song', { detail: 'full' }));
    expect(read).toContain('T4 "Vocal" LOCKED');
    expect(read).toContain('audio vocal.wav');
    expect(read).toContain('-3 dB');
    expect(read).toContain('fade-in 0.5s');
    expect(read).toContain('T5 "Track 6" MUTED');
    expect(read).toContain('playlist tracks (T0–T15)');
    expect(read).toContain(`[${clip.id}]`);
  });

  it('shows ids and placements on the video timeline in the readout', async () => {
    const r = rig();
    await r.run('music_new_song', { template: 'lofi', seed: 3 });
    const song = r.song();
    const read = text(await r.run('music_get_song'));
    expect(read).toContain('VIEW:');
    expect(read).toContain(`[${song.view.activePatternId}]`);
    for (const m of song.playlist.markers) expect(read, m.name).toContain(`[${m.id}]`);
    expect(read).toContain('studio closed');
    expect(read).not.toContain('ON THE VIDEO TIMELINE');
    const comp = r.project().comps[0];
    const laid = placeSongLayer(r.project(), comp.id, { assetId: 'asset-song', duration: 12, beats: [0, 0.5, 1], downbeats: [0], bpm: song.bpm, name: 'Song' }, { start: 2, db: -6 });
    r.setProject(laid.project);
    const placed = text(await r.run('music_get_song'));
    expect(placed).toContain('ON THE VIDEO TIMELINE');
    expect(placed).toContain(`comp "${comp.name}" [${comp.id}]`);
    expect(placed).toContain(`clip [${laid.clipId}]`);
    expect(placed).toContain(`track [${laid.trackId}]`);
    expect(placed).toContain('asset [asset-song]');
    expect(placed).toContain('starts 2 s, runs 12 s');
    expect(placed).toContain('3 beats stored');
    // an editor removed the clip: the readout says the layer is gone
    r.setProject({ ...laid.project, comps: laid.project.comps.map((c) => ({ ...c, clips: [] })) });
    expect(text(await r.run('music_get_song'))).toContain('no longer on that timeline');
    setStudioOpen(true);
    expect(text(await r.run('music_get_song'))).toContain('studio open');
  });

  it('drives playback, play mode, metronome, snap, panels and windows (Toolbar, Transport)', async () => {
    const r = rig();
    const seen: StudioRequest[] = [];
    const off = onStudioRequest((req) => seen.push(req));
    try {
      await r.run('music_new_song', { template: 'beat', seed: 1 });
      const song = r.song();
      const lead = song.channels.find((c) => c.instrument !== 'drum')!;
      const withFx = song.mixer.inserts.findIndex((ins) => ins.effects.length > 0);
      const effect = song.mixer.inserts[withFx].effects[0];
      setStudioOpen(true);

      // song mode, from a bar
      const play = await r.run('music_open_studio', { transport: 'play', fromBar: 4 });
      expect(play.ok, text(play)).toBe(true);
      expect(text(play)).toContain('Playing the song from bar 4');
      const playReq = seen[seen.length - 1];
      expect(playReq).toMatchObject({ open: true, transport: 'play', mode: 'song', patternId: song.view.activePatternId, playFrom: 64 });
      expect(seen[0]).toMatchObject({ open: true, playFrom: 64 });

      // stop and rewind
      expect((await r.run('music_open_studio', { transport: 'stop' })).ok).toBe(true);
      expect(seen[seen.length - 1]).toMatchObject({ transport: 'stop' });
      expect((await r.run('music_open_studio', { transport: 'rewind' })).ok).toBe(true);
      expect(seen[seen.length - 1]).toMatchObject({ transport: 'rewind' });

      // PAT mode loops the active pattern; the request carries the mode and pattern to play
      const pat = song.patterns[1];
      const loop = await r.run('music_open_studio', { mode: 'pattern', patternId: pat.name, transport: 'play' });
      expect(loop.ok, text(loop)).toBe(true);
      expect(text(loop)).toContain(`pattern ${pat.name} on loop`);
      expect(seen[seen.length - 1]).toMatchObject({ transport: 'play', mode: 'pattern', patternId: pat.id });
      // the view is the song's: an open studio takes it from the request, so no undo step is made
      const commits = r.commits();
      await r.run('music_open_studio', { mode: 'song', channelId: lead.id });
      expect(r.commits()).toBe(commits);

      // the toolbar's other switches and the floating panels
      const flags = await r.run('music_open_studio', { metronome: true, snap: '1/8', browser: false, playlist: true, window: 'mixer' });
      expect(flags.ok, text(flags)).toBe(true);
      expect(seen[seen.length - 1]).toMatchObject({ open: true, window: 'mixer', metronome: true, snap: '1/8', browser: false, playlist: true });
      expect(text(flags)).toContain('metronome on');
      expect((await r.run('music_open_studio', { panel: { kind: 'instrument', channelId: lead.name } })).ok).toBe(true);
      expect(seen[seen.length - 1]).toMatchObject({ panel: { kind: 'instrument', channelId: lead.id } });
      expect((await r.run('music_open_studio', { panel: { kind: 'effect', insert: withFx, effectId: effect.type } })).ok).toBe(true);
      expect(seen[seen.length - 1]).toMatchObject({ panel: { kind: 'effect', insert: withFx, effectId: effect.id } });
      expect((await r.run('music_open_studio', { closePanels: true })).ok).toBe(true);
      expect(seen[seen.length - 1]).toMatchObject({ closePanels: true });
      expect((await r.run('music_open_studio', { fromBar: 8 })).ok).toBe(true);
      expect(seen[seen.length - 1]).toMatchObject({ playFrom: 128 });

      // bad input names the valid choices and sends nothing
      const sent = seen.length;
      for (const bad of [{ transport: 'pause' }, { mode: 'live' }, { snap: '1/3' }, { metronome: 'yes' }, { fromBar: -1 }, { panel: { kind: 'knob' } }, { panel: { kind: 'effect', insert: withFx, effectId: 'nope' } }, { panel: { kind: 'instrument', channelId: 'ghost' } }, { window: 'sky' }, { open: false, transport: 'play' }]) {
        expect((await r.run('music_open_studio', bad)).ok, JSON.stringify(bad)).toBe(false);
      }
      expect(seen.length).toBe(sent);
      expect(text(await r.run('music_open_studio', { snap: '1/3' }))).toContain('1/16');

      // nothing to play
      await r.run('music_new_song', { template: 'empty', replace: true });
      const empty = await r.run('music_open_studio', { mode: 'song', transport: 'play' });
      expect(empty.ok).toBe(false);
      expect(text(empty)).toContain('playlist is empty');
      expect((await r.run('music_open_studio', { transport: 'play', mode: 'pattern' })).ok).toBe(true);
      expect((await r.run('music_open_studio', { open: false })).ok).toBe(true);
      expect(seen[seen.length - 1]).toMatchObject({ open: false });
    } finally {
      off();
    }
  });

  it('keeps the view in the song when the studio is closed, and refuses playback without one', async () => {
    const r = rig();
    await r.run('music_new_song', { template: 'beat', seed: 1 });
    const song = r.song();
    const chan = song.channels[2];
    const pat = song.patterns[1];
    setStudioOpen(false);
    const commits = r.commits();
    const set = await r.run('music_open_studio', { mode: 'pattern', patternId: pat.id, channelId: chan.id, window: 'pianoroll' });
    expect(set.ok, text(set)).toBe(true);
    expect(r.commits()).toBe(commits + 1);
    expect(r.song().view).toMatchObject({ mode: 'pattern', activePatternId: pat.id, selectedChannelId: chan.id, window: 'pianoroll' });
    await r.run('music_open_studio', { mode: 'pattern', patternId: pat.id, channelId: chan.id, window: 'pianoroll' });
    expect(r.commits()).toBe(commits + 1);
    const play = await r.run('music_open_studio', { transport: 'play' });
    expect(play.ok).toBe(false);
    expect(text(play)).toContain('did not open');
  }, 15_000);

  it('walks every studio action to a tool in one scripted session', async () => {
    // [studio action, tool, arguments] — the table the report prints; each must succeed on a real song.
    const r = rig(new Map<string, unknown>([['s1', { id: 's1', name: 'snap.wav', kind: 'audio', duration: 1 }]]));
    await r.run('music_new_song', { template: 'trap', seed: 8 });
    const song = r.song();
    const hat = song.channels.find((c) => c.drum === 'hat')!;
    const pattern = song.patterns[0];
    const insert = song.channels[0].insert;
    const effect = song.mixer.inserts.flatMap((ins, i) => ins.effects.map((e) => ({ i, e }))).find(({ e }) => e.type !== 'limiter')!;
    const steps: [string, string, Record<string, unknown>][] = [
      ['rename pattern', 'music_arrange', { patterns: [{ patternId: pattern.id, name: 'Main groove', color: '#aa5500' }] }],
      ['new pattern / clone pattern', 'music_arrange', { patterns: [{ op: 'add', name: 'Fill' }, { op: 'clone', patternId: pattern.id, name: 'Main groove 2' }] }],
      ['step accents', 'music_edit_notes', { patternId: pattern.id, channelId: hat.id, op: 'velocity', set: 1, fromStep: 0, toStep: 4 }],
      ['fill every 4', 'music_write_pattern', { patternId: pattern.id, channels: [{ channel: hat.id, steps: 'x---', mode: 'replace' }] }],
      ['shift steps right', 'music_edit_notes', { patternId: pattern.id, channelId: hat.id, op: 'shift', steps: 1, wrap: 16 }],
      ['clear steps', 'music_write_pattern', { patternId: 'Fill', channels: [{ channel: hat.id, mode: 'clear' }] }],
      ['pattern length +1 bar', 'music_arrange', { patterns: [{ patternId: 'Fill', bars: 2 }] }],
      ['channel colour / rename / mute / solo', 'music_update_channel', { channelId: hat.id, color: '#00ff88', name: 'Hat X', mute: false, solo: false }],
      ['channel insert / volume / pan', 'music_update_channel', { channelId: hat.id, insert: 30, volume: 0.6, pan: 0.2 }],
      ['sampler from the bin', 'music_add_channel', { instrument: 'sampler', name: 'Snap', sampleAssetId: 's1' }],
      ['audio clip from the bin', 'music_arrange', { clips: [{ op: 'add', assetId: 's1', startBar: 8, track: 20 }] }],
      ['track rename / colour / mute / solo / lock', 'music_arrange', { tracks: [{ track: 20, name: 'Snaps', color: '#cc00cc', mute: true, solo: false, locked: false }, { op: 'add' }] }],
      ['loop region', 'music_arrange', { loop: { startBar: 0, endBar: 4 } }],
      ['mixer volume / pan / width / invert / colour', 'music_mixer', { insert, volume: -2, pan: 0.1, width: 1.2, invert: true, color: '#3355ff' }],
      ['send level + sidechain', 'music_mixer', { insert, sends: [{ to: 25, level: 0.5, sidechain: false }] }],
      ['effect mix / bypass / params', 'music_mixer', { insert: effect.i, effects: [{ op: 'update', effectId: effect.e.id, mix: 0.4, enabled: false }] }],
      ['effect reorder', 'music_mixer', { insert: effect.i, effects: [{ op: 'move', effectId: effect.e.id, at: 0 }] }],
      ['master volume / pitch / swing / time signature / tempo', 'music_set_song', { masterVolume: -1, masterPitch: 1, swing: 0.2, timeSig: '4/4', bpm: 140 }],
      ['key / scale (piano roll)', 'music_set_song', { key: 'D minor' }],
      ['automation clip', 'music_automate', { target: { kind: 'tempo' }, startBar: 0, bars: 4, shape: 'ramp-up', from: 130, to: 150 }],
      ['bounce', 'music_render', { mode: 'pattern' }],
    ];
    const ran: string[] = [];
    for (const [action, tool, args] of steps) {
      const before = r.commits();
      const res = await r.run(tool, args);
      if (action === 'bounce') { expect(res.ok, action).toBe(false); continue; } // needs Web Audio in the app
      expect(res.ok, `${action}: ${text(res)}`).toBe(true);
      expect(r.commits(), action).toBe(before + 1);
      ran.push(action);
    }
    expect(ran.length).toBe(steps.length - 1);
    expect(r.song()).toMatchObject({ bpm: 140, masterVolume: -1, masterPitch: 1, swing: 0.2, key: { root: 2, scale: 'minor' } });
    const read = text(await r.run('music_get_song', { detail: 'full' }));
    for (const word of ['Main groove', 'Fill', 'Hat X', 'Snap', 'Snaps', 'MUTED', 'loop: bars 0–4', 'AUTOMATION']) expect(read, word).toContain(word);
    expect(normalizeSong(r.song())).not.toBeNull();
  });
});
