import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/ipc', () => ({
  api: { rotoRead: vi.fn(async () => null), transcriptsCached: vi.fn(async () => []) },
  errorText: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  fileSrc: (p: string) => p,
}));

import { accentOf, bhippiSession, FILM_RECIPES, planFilm, safeFixes, songFromAnalysis, type FilmBeat, type FilmSong } from '../src/lib/filmRecipes';
import { parseSteps } from '../src/lib/appCapture';
import { GUIDED_BRIEF } from '../src/lib/modelProfile';
import { routeTools } from '../src/lib/toolRouter';
import { runMotionTool, type MotionToolContext } from '../src/lib/motionTools';
import { logicalScene } from '../src/lib/motionStack';
import { newProject, updateComp } from '../src/lib/timeline';
import type { Project } from '../src/lib/types';
import type { DemoCapture } from '../src/motion/kit/productDemo';

function harness(project: Project) {
  let current = project;
  const ctx: MotionToolContext = {
    get project() { return current; },
    assets: new Map(),
    commit: (change) => { current = change(current); },
    editComp: (comp, change) => { current = updateComp(current, comp.id, change); },
    pickComp: (p) => p.comps[0],
    current: () => current,
  } as MotionToolContext;
  return { ctx, get: () => current };
}

const typed = 'Cut this to the beat';
const capture: DemoCapture = {
  name: 'bhippi-recipe', dir: 'C:/Film/AI Work/ui-parts/bhippi-recipe', width: 1920, height: 1080, scale: 3,
  parts: [
    { part: 'window', state: 'idle', file: 'window__idle.png', boxCss: [0, 0, 1920, 1080], pixels: [5760, 3240] },
    ...Array.from({ length: typed.length + 1 }, (_, i) => ({ part: 'composer', state: `t${String(i).padStart(2, '0')}`, file: `composer__t${String(i).padStart(2, '0')}.png`, boxCss: [10, 894, 430, 122], pixels: [1290, 366], typed: typed.slice(0, i) })),
    { part: 'send', state: 'idle', file: 'send__idle.png', boxCss: [395, 971, 32, 32], pixels: [96, 96] },
    { part: 'timeline', state: 'idle', file: 'timeline__idle.png', boxCss: [825, 644, 1000, 404], pixels: [3000, 1212] },
  ],
};

/** A launch-style brief: the model's words and moments only. */
const brief: FilmBeat[] = [
  { text: 'An editor with a producer inside', kind: 'hook', accentWord: 'producer' },
  { text: 'Cut this to the beat', kind: 'demo', focus: 'composer' },
  { text: 'Every cut lands on the bar', kind: 'feature', focus: 'timeline', subtitle: '18 cuts, on the beat' },
  { text: 'It comes apart and slams back', kind: 'explode' },
  { text: 'Connect your AI', kind: 'connect', points: ['Claude', 'GPT', 'Gemini', 'Local'] },
  { text: '10x faster first cut', value: 10, suffix: 'x' },
  { text: 'Bhippi', kind: 'logo', subtitle: 'The AI video editor' },
  { text: 'Edit at the speed of thought', cta: 'Try it free' },
];

/** A song whose bars are 99 BPM from 0.2 s, with a drop on its fifth bar and a line that sings the connect beat. */
const bar = (60 / 99) * 4;
const song: FilmSong = {
  bpm: 99, at: 0.2, drops: [0.2 + 4 * bar],
  bars: Array.from({ length: 40 }, (_, i) => 0.2 + i * bar),
  lines: [
    { text: 'An editor, with a producer inside', words: ['An', 'editor', 'with', 'a', 'producer', 'inside'].map((text, i) => ({ text, start: 0.6 + i * 0.3, end: 0.9 + i * 0.3 })) },
    { text: 'Connect your AI: Claude, GPT, Gemini, local', words: ['Connect', 'your', 'AI', 'Claude', 'GPT', 'Gemini', 'local'].map((text, i) => ({ text, start: 18.4 + i * 0.35, end: 18.7 + i * 0.35 })) },
  ],
};

describe('film recipes', () => {
  it('every recipe plans the sample brief into templates, joins and a finish, the same way twice', () => {
    for (const recipe of FILM_RECIPES) {
      const plan = planFilm(recipe, brief, { capture, song });
      expect(plan.beats, recipe).toHaveLength(brief.length);
      expect(plan.transitions, recipe).toHaveLength(brief.length - 1);
      expect(plan.beats.every((beat) => beat.hold > 0.5), recipe).toBe(true);
      expect(['launch-light', 'launch-dark']).toContain(plan.finish.preset);
      expect(JSON.stringify(planFilm(recipe, brief, { capture, song })), recipe).toBe(JSON.stringify(plan));
      // Every cut on the song's grid (bars, half bars or beats by cadence), in film seconds.
      const grid = song.bars.flatMap((b) => [0, 1, 2, 3].map((k) => b - song.at + (k * bar) / 4));
      for (const cut of plan.cuts) expect(grid.some((g) => Math.abs(g - cut) < 0.01), `${recipe} cut ${cut}`).toBe(true);
    }
  });

  it('builds each recipe as one layered [Motion] comp, one layer per track', async () => {
    for (const recipe of FILM_RECIPES) {
      for (const withCapture of [true, false]) {
        const plan = planFilm(recipe, brief, { capture: withCapture ? capture : null, song: withCapture ? song : null });
        const { ctx, get } = harness(newProject());
        const result = await runMotionTool('create_motion_sequence', { beats: plan.beats.map((b) => ({ template: b.template, params: b.params, hold: b.hold, name: b.name })), transitions: plan.transitions, sfx: true, title: `Film ${recipe}` }, ctx) as { ok: boolean; error?: string; compId: string; cuts: number[]; clipId: string };
        expect(result.error, `${recipe} capture:${withCapture}`).toBeUndefined();
        // create_motion_sequence puts the cuts exactly where the plan put them.
        result.cuts.forEach((cut, i) => expect(cut, `${recipe} cut ${i}`).toBeCloseTo(plan.cuts[i], 2));
        const comp = get().comps.find((c) => c.id === result.compId)!;
        expect(comp.name).toBe(`[Motion] Film ${recipe}`);
        const scene = logicalScene(get(), comp)!;
        expect(scene.layers.length).toBeGreaterThanOrEqual(brief.length);
        // Every layer is a clip of its own on its own track.
        const video = new Set(comp.tracks.filter((track) => track.kind === 'video').map((track) => track.id));
        const layerClips = comp.clips.filter((clip) => video.has(clip.trackId));
        expect(layerClips.length).toBeGreaterThanOrEqual(brief.length);
        expect(new Set(layerClips.map((clip) => clip.trackId)).size).toBe(layerClips.length);
        // The finish lands as its own editable layer.
        const finished = await runMotionTool('update_motion_scene', { clipId: result.clipId, finish: plan.finish }, ctx);
        expect(finished.ok, `${recipe} finish`).toBe(true);
        expect(logicalScene(get(), get().comps.find((c) => c.id === result.compId)!)!.layers.some((layer) => layer.id === 'finish')).toBe(true);
      }
    }
  }, 60_000);

  it('carries the craft: the real app, words on their sung times, the drop, the joins', () => {
    const plan = planFilm('launch-film', brief, { capture, song });
    const by = (moment: string) => plan.beats.find((beat) => beat.moment === moment)!;
    expect(by('demo').template).toBe('product-demo');
    expect((by('demo').params.actions as { type?: string; click?: string }[]).map((a) => a.type ?? a.click)).toEqual(['composer', 'send']);
    expect(by('explode').template).toBe('window-explode');
    expect(by('feature').template).toBe('slam-tilt');
    expect((by('feature').params.media as { path: string }).path).toBe(`${capture.dir}/timeline__idle.png`);
    expect(by('connect').template).toBe('connect-hub');
    // The providers land on their sung names, in scene seconds.
    const connect = plan.beats.indexOf(by('connect'));
    const times = by('connect').params.times as number[];
    expect(times).toHaveLength(4);
    expect(times[0]).toBeCloseTo(18.4 + 3 * 0.35 - song.at - plan.starts[connect], 3);
    // The connect beat opens on the bar before its first sung word.
    expect(plan.cuts[connect - 1]).toBeLessThanOrEqual(18.4 - song.at);
    expect(18.4 - song.at - plan.cuts[connect - 1]).toBeLessThan(bar + 0.2);
    // The hook's words carry the song's times.
    expect(plan.beats[0].params.words).toBeDefined();
    expect(plan.beats[0].params.offset).toBeCloseTo(song.at, 3);
    // Stats fall back to the guided build's own template, drawing its own stage.
    expect(by('stat').template).toBe('brand-stat');
    expect(by('stat').params.background).toBeUndefined();
    expect(by('end').template).toBe('end-card');
    expect(by('end').params.name).toBe('Bhippi');
    // The drop falls inside the feature beat, whose words need the time: its card slams on the drop.
    expect(plan.drop).toBeCloseTo(4 * bar, 3);
    const feature = plan.beats.indexOf(by('feature'));
    expect(plan.dropBeat).toBe(feature);
    expect(by('feature').params.at).toBeCloseTo(4 * bar - plan.starts[feature], 3);
    expect(by('feature').params.flash).toBe(true);
    // With fewer words to read, the nearest cut moves onto the drop and the join into it is the drop join.
    const shorter = planFilm('launch-film', brief.map((beat) => (beat.kind === 'feature' ? { ...beat, subtitle: undefined } : beat)), { capture, song });
    expect(shorter.cuts).toContainEqual(shorter.drop);
    expect(shorter.transitions[shorter.dropBeat! - 1].kind).toBe('flash-bridge');
  });

  it('films differ: the variant, the stage and the palette change the plan', () => {
    const plans = Array.from({ length: 8 }, (_, variant) => JSON.stringify(planFilm('launch-film', brief, { style: { variant } }).beats.map((b) => [b.template, b.params])));
    expect(new Set(plans).size).toBeGreaterThan(3);
    const joins = Array.from({ length: 8 }, (_, variant) => planFilm('kinetic-explainer', brief, { style: { variant } }).transitions.map((t) => `${t.kind}:${t.direction ?? ''}`).join(','));
    expect(new Set(joins).size).toBeGreaterThan(1);
    const dark = planFilm('fluid-saas', brief, { style: { stage: 'dark', palette: '#12b886', cadence: 'calm' } });
    expect(dark.finish.preset).toBe('launch-dark');
    expect(dark.accent).toBe('#12b886');
    expect(dark.beats.find((b) => b.moment === 'connect')!.params.accent).toBe('#12b886');
    const light = planFilm('fluid-saas', brief, {});
    expect(light.finish.preset).toBe('launch-light');
    expect(dark.seconds).toBeGreaterThan(light.seconds);
    // Two briefs with other words pick their own variant.
    const other = planFilm('launch-film', brief.map((b) => ({ ...b, text: `${b.text}!` })));
    expect(other.variant).not.toBe(planFilm('launch-film', brief).variant);
  });

  it('guesses moments a small model leaves out and never needs a capture', () => {
    const plain: FilmBeat[] = [{ text: 'Meet the new workspace' }, { text: 'Everything in one place' }, { text: 'Bring your own AI', points: ['Claude', 'GPT'] }, { text: 'Start free today', cta: 'workly.app' }];
    const plan = planFilm('product-demo', plain);
    expect(plan.beats.map((b) => b.moment)).toEqual(['hook', 'feature', 'connect', 'end']);
    expect(plan.notes.join(' ')).not.toContain('no capture');
    const withCapture = planFilm('product-demo', plain, { capture });
    expect(withCapture.beats[1].template).toBe('product-demo');
  });

  it('reads analyze_song, and captures Bhippi with a session the capture accepts', () => {
    const parsed = songFromAnalysis({ bpm: 99, bars: [0.4, 2.8], drops: [16.8], lines: [{ text: 'Meet Bhippi', end: 35, timed: '33.79 Meet 34.20 Bhippi*' }] }, 1);
    expect(parsed?.lines[0].words).toEqual([{ text: 'Meet', start: 33.79, end: 34.2 }, { text: 'Bhippi', start: 34.2, end: 35 }]);
    expect(parsed?.at).toBe(1);
    expect(songFromAnalysis({}, 0)).toBeNull();
    const { steps, problems } = parseSteps(bhippiSession('Cut this to the beat'));
    expect(problems).toEqual([]);
    expect(steps.some((step) => step.do === 'type' && step.part === 'composer')).toBe(true);
    expect(accentOf('royal', 'ember')).toBe('#2f5bff');
    expect(accentOf(['#ABC'], 'ember')).toBe('#aabbcc');
  });

  it('fixes only what cannot make the film worse', () => {
    const fixes = safeFixes([{ kind: 'dark', at: 1 }, { kind: 'quiet-cue', at: 2 }, { kind: 'off-beat', at: 3 }, { kind: 'mix-loudness', at: null }], { preset: 'launch-dark' });
    expect(fixes.map((fix) => fix.tool)).toEqual(['update_motion_scene', 'sound_the_motion']);
    expect((fixes[0].args.finish as { exposure: number }).exposure).toBeCloseTo(1.1, 3);
    expect(safeFixes([{ kind: 'dark', at: 0 }], { preset: 'launch-dark', exposure: 1.1 })[0].args.finish).toMatchObject({ exposure: 1.2 });
    expect(safeFixes([{ kind: 'repeated-phrase', at: 0 }], { preset: 'launch-light' })).toEqual([]);
  });

  it('the guided brief names the recipes in a line; the full tier is not sent to them', () => {
    expect(GUIDED_BRIEF).toMatch(/recipe/);
    for (const recipe of FILM_RECIPES) expect(GUIDED_BRIEF).toContain(recipe);
    // A frontier model's toolset is unchanged: the build is not put in front of it.
    expect(routeTools('make a launch film for my app with this song', [], null, null, false).full).not.toContain('build_edit_from_brief');
  });
});
