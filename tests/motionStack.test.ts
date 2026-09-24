import { describe, expect, it } from 'vitest';
import { explodeScene, frameOf, fusable, isLayerClip, layeredCompScene, logicalScene, ownLayers, restack, stackGroups, stackLossy, standaloneScene } from '../src/lib/motionStack';
import { newProject } from '../src/lib/timeline';
import type { Comp, Project } from '../src/lib/types';
import { evaluateScene, type ResolvedFrame } from '../src/motion/evaluate';
import { keys } from '../src/motion/anim';
import { findTemplate } from '../src/motion/kit';
import { validateScene } from '../src/motion/validate';
import type { Layer, MotionScene } from '../src/motion/types';

const W = 1920;
const H = 1080;

/** A scene that uses everything that needs layers together: parents, a matte, 3D + camera, a precomp, in/out windows. */
const rich: MotionScene = {
  version: 1, width: W, height: H, duration: 4, background: '#101010',
  layers: [
    { id: 'stage', name: 'Stage', type: 'procedural', kind: 'crimson-stage' },
    { id: 'rig', type: 'null', transform: { position: keys<number[]>([0, [300, 200], 'expo-out'], [1, [900, 540]]) } },
    { id: 'card', type: 'shape', parent: 'rig', shape: { shape: 'rect', size: [600, 300], fill: '#ffffff33' }, transform: { position: [0, 0], rotation: keys<number>([0.5, -8], [1.5, 0]) } },
    { id: 'matte-src', type: 'shape', hidden: true, shape: { shape: 'rect', size: [800, 200], fill: '#fff' } },
    { id: 'title', name: 'Title', type: 'text', in: 0.4, out: 3.2, parent: 'rig', matte: { layer: 'matte-src', mode: 'alpha' }, text: { text: 'Hello world', size: 90 }, transform: { opacity: keys<number>([0.4, 0], [0.9, 100]) } },
    { id: 'cam', type: 'camera', transform: { position: keys<number[]>([0, [960, 540, -2666]], [4, [1100, 540, -2400]]) } },
    { id: 'tile', type: 'shape', threeD: true, shape: { shape: 'rect', size: [200, 200], fill: '#f00' }, transform: { position: [1400, 700, 100], rotationY: keys<number>([0, 30], [2, 0]) } },
    {
      id: 'inner', name: 'Inner shot', type: 'precomp', offset: 0.5, in: 0.5,
      transform: { scale: keys<number>([1, 100], [2, 60]) },
      scene: { version: 1, width: W, height: H, duration: 3, layers: [
        { id: 'plate', type: 'solid', color: '#224466' },
        { id: 'word', type: 'text', in: 0.2, text: { text: 'inside', size: 60 }, transform: { position: keys<number[]>([0.2, [400, 400]], [1.2, [600, 400]]) } },
      ] },
    },
  ],
};

function projectWith(exploded: ReturnType<typeof explodeScene>): Project {
  const base = newProject();
  return { ...base, comps: [...base.comps, exploded.comp, ...exploded.nested] };
}

/** Matrix, opacity and window of every drawn layer, by id. */
function drawn(frame: ResolvedFrame) {
  const out = new Map<string, { matrix: number[]; opacity: number; active: boolean; time: number }>();
  for (const entry of frame.layers) {
    if (entry.layer.ref) continue;
    out.set(entry.layer.id, { matrix: [...entry.matrix], opacity: entry.opacity, active: entry.active, time: entry.time });
  }
  return out;
}

function expectSameFrame(a: ResolvedFrame, b: ResolvedFrame, ids: string[]) {
  const da = drawn(a);
  const db = drawn(b);
  for (const id of ids) {
    const x = da.get(id);
    const y = db.get(id);
    expect(y, `layer ${id} is in the fused scene`).toBeDefined();
    if (!x || !y) continue;
    expect(y.active, `${id} active at ${a.time}`).toBe(x.active);
    expect(y.opacity).toBeCloseTo(x.opacity, 6);
    expect(y.time).toBeCloseTo(x.time, 6);
    x.matrix.forEach((v, i) => expect(y.matrix[i]).toBeCloseTo(v, 4));
  }
}

describe('explodeScene', () => {
  it('opens every layer onto its own track, bottom to top, with the precomp as a nested comp', () => {
    const exploded = explodeScene(rich, { name: '[Motion] Rich', fps: 30 });
    const { comp, nested } = exploded;
    const video = comp.tracks.filter((t) => t.kind === 'video');
    // background solid + 8 layers
    expect(video.map((t) => t.name)).toEqual(['Background', 'Stage', 'rig', 'card', 'matte-src', 'Title', 'cam', 'tile', 'Inner shot']);
    expect(comp.clips).toHaveLength(9);
    for (const clip of comp.clips) {
      expect(isLayerClip(clip)).toBe(true);
      expect(validateScene((clip.source as { scene: MotionScene }).scene)).toEqual([]);
    }
    const title = comp.clips.find((c) => c.name === 'Title')!;
    expect([title.start, title.in, title.duration]).toEqual([0.4, 0.4, expect.closeTo(2.8, 6)]);
    // The title clip carries hidden copies of what it needs to draw alone: its parent and its matte.
    const titleScene = (title.source as { scene: MotionScene }).scene;
    expect(titleScene.layers.filter((l) => l.ref).map((l) => l.id).sort()).toEqual(['matte-src', 'rig']);
    expect(ownLayers(titleScene).map((l) => l.id)).toEqual(['title']);
    // The 3D tile carries the camera.
    const tile = (comp.clips.find((c) => c.name === 'tile')!.source as { scene: MotionScene }).scene;
    expect(tile.layers.filter((l) => l.ref).map((l) => l.id)).toEqual(['cam']);
    expect(nested).toHaveLength(1);
    expect(nested[0].clips.map((c) => c.name)).toEqual(['plate', 'inside']);
    const inner = ownLayers((comp.clips.find((c) => c.name === 'Inner shot')!.source as { scene: MotionScene }).scene)[0] as Extract<Layer, { type: 'precomp' }>;
    expect(inner.comp).toBe(nested[0].id);
  });
});

describe('stackGroups', () => {
  it('fuses the layer clips back into a scene that draws exactly like the original', () => {
    const exploded = explodeScene(rich, { name: '[Motion] Rich', fps: 30 });
    const project = projectWith(exploded);
    const comp = project.comps.find((c) => c.id === exploded.comp.id)!;
    const groups = stackGroups(project, comp);
    expect(groups).toHaveLength(1);
    const fused = groups[0].scene;
    expect(validateScene(fused)).toEqual([]);
    const original: MotionScene = { ...rich, background: null, layers: [{ id: 'background', name: 'Background', type: 'solid', color: '#101010' }, ...rich.layers] };
    const ids = ['background', 'stage', 'card', 'title', 'tile', 'inner'];
    for (const t of [0, 0.3, 0.45, 0.8, 1.2, 2, 3.1, 3.5, 3.9]) {
      const a = evaluateScene(original, t);
      const b = evaluateScene(fused, t);
      expectSameFrame(a, b, ids);
      // The precomp draws its nested comp's layers, the same as its own scene did.
      const pa = a.layers.find((l) => l.layer.id === 'inner')!;
      const pb = b.layers.find((l) => l.layer.id === 'inner')!;
      const inA = (pa.layer as Extract<Layer, { type: 'precomp' }>).scene;
      const inB = (pb.layer as Extract<Layer, { type: 'precomp' }>).scene;
      expectSameFrame(evaluateScene(inA, pa.time), evaluateScene(inB, pb.time), ['plate', 'word']);
    }
    expect(layeredCompScene(project, comp)?.layers.map((l) => l.id)).toEqual(fused.layers.map((l) => l.id));
  });

  it('moves, retimes and restyles a layer from its clip', () => {
    const exploded = explodeScene(rich, { name: '[Motion] Rich', fps: 30 });
    const project = projectWith(exploded);
    const comp = project.comps.find((c) => c.id === exploded.comp.id)!;
    const title = comp.clips.find((c) => c.name === 'Title')!;
    // Slide the title clip one second later and nudge it 10% right and fade it to half.
    const moved: Comp = { ...comp, clips: comp.clips.map((c) => (c.id === title.id ? { ...c, start: c.start + 1, transform: { ...c.transform, x: 0.1, opacity: 50 } } : c)) };
    const next = { ...project, comps: project.comps.map((c) => (c.id === comp.id ? moved : c)) };
    const fused = stackGroups(next, moved)[0].scene;
    const before = evaluateScene(stackGroups(project, comp)[0].scene, 0.9);
    const after = evaluateScene(fused, 1.9);
    const a = before.layers.find((l) => l.layer.id === 'title')!;
    const b = after.layers.find((l) => l.layer.id === 'title')!;
    expect(b.active).toBe(true);
    expect(b.time).toBeCloseTo(a.time, 6);
    expect(b.opacity).toBeCloseTo(a.opacity * 0.5, 6);
    // Same place, 192 px to the right. (Its parent rig is its own clip and did not move.)
    const rig = (m: ResolvedFrame) => m.layers.find((l) => l.layer.id === 'rig')!.matrix;
    const shift = [b.matrix[12] - a.matrix[12] - (rig(after)[12] - rig(before)[12])];
    expect(shift[0]).toBeCloseTo(192, 3);
    expect(evaluateScene(fused, 1.2).layers.find((l) => l.layer.id === 'title')!.active).toBe(false);
  });

  it('keeps razor pieces apart and draws a clip with an NLE effect on its own', () => {
    const exploded = explodeScene(rich, { name: '[Motion] Rich', fps: 30 });
    const project = projectWith(exploded);
    const comp = project.comps.find((c) => c.id === exploded.comp.id)!;
    const stage = comp.clips.find((c) => c.name === 'Stage')!;
    const second = { ...stage, id: 'stage-b', start: 2, in: 2, duration: 2 };
    const cut: Comp = { ...comp, clips: [...comp.clips.map((c) => (c.id === stage.id ? { ...c, duration: 2 } : c)), second] };
    const fused = stackGroups({ ...project, comps: project.comps.map((c) => (c.id === comp.id ? cut : c)) }, cut)[0].scene;
    expect(validateScene(fused)).toEqual([]);
    expect(fused.layers.filter((l) => l.id.startsWith('stage')).map((l) => [l.id, l.in, l.out])).toEqual([['stage', 0, 2], ['stage~2', 2, 4]]);

    const card = comp.clips.find((c) => c.name === 'card')!;
    const blurred: Comp = { ...comp, clips: comp.clips.map((c) => (c.id === card.id ? { ...c, effects: { ...c.effects, blur: 4 } } : c)) };
    expect(fusable(blurred, blurred.clips.find((c) => c.id === card.id)!)).toBe(false);
    const groups = stackGroups({ ...project, comps: project.comps.map((c) => (c.id === comp.id ? blurred : c)) }, blurred);
    expect(groups).toHaveLength(2);
    // On its own the card still hangs off its (hidden) rig.
    const alone = standaloneScene(project, card)!;
    expect(alone.layers.map((l) => [l.id, !!l.ref])).toEqual([['rig', true], ['card', false]]);
  });

  it('turns clip keyframes into the layer frame on the right clock', () => {
    const exploded = explodeScene(rich, { name: '[Motion] Rich', fps: 30 });
    const clip = { ...exploded.comp.clips[1], start: 2, in: 0, keyframes: { ...exploded.comp.clips[1].keyframes, opacity: [{ time: 0, value: 0, easing: 'linear' as const }, { time: 1, value: 100, easing: 'linear' as const }] } };
    const frame = frameOf(clip, W, H, (local) => clip.start + local)!;
    expect(frame.opacity).toEqual({ k: [{ t: 2, v: 0, ease: 'linear' }, { t: 3, v: 100, ease: 'linear' }] });
  });

  it('writes an edited scene back layer by layer, keeping clips, tracks, the precomp comp and user moves', () => {
    const spec = findTemplate('subject-reveal')!;
    const build = (title: string[]) => spec.build({ width: W, height: H }, { subject: { asset: 'a1', matte: 'C:/roto/run/matte.mkv' }, title, phrase: 'Welcome in', cardAt: 3, duration: 4 });
    const exploded = explodeScene(build(['ONE', 'TWO']), { name: '[Motion] Reveal', fps: 30 });
    let project = projectWith(exploded);
    const innerId = exploded.nested[0].id;
    const titleClip = project.comps.find((c) => c.id === innerId)!.clips.find((c) => c.name === 'ONE')!;
    // The user hides the stage track and slides the first title half a second later.
    project = { ...project, comps: project.comps.map((c) => (c.id === exploded.comp.id ? { ...c, tracks: c.tracks.map((t) => (t.name === 'Stage' ? { ...t, hidden: true } : t)) } : c.id === innerId ? { ...c, clips: c.clips.map((clip) => (clip.id === titleClip.id ? { ...clip, start: clip.start + 0.5 } : clip)) } : c)) };
    const scene = logicalScene(project, project.comps.find((c) => c.id === exploded.comp.id)!)!;
    expect(scene.layers.map((l) => l.id)).toEqual(['stage', 'shot']);
    const next = restack(project, exploded.comp.id, build(['UNO', 'DOS']), 'scene');
    const outer = next.comps.find((c) => c.id === exploded.comp.id)!;
    expect(outer.tracks.find((t) => t.name === 'Stage')?.hidden).toBe(true);
    expect(next.comps.filter((c) => c.name.startsWith('[Motion] Reveal ·')).map((c) => c.id)).toEqual([innerId]);
    const inner = next.comps.find((c) => c.id === innerId)!;
    const renamed = inner.clips.find((c) => c.id === titleClip.id)!;
    expect(renamed.name).toBe('UNO');
    expect(renamed.start).toBeCloseTo(titleClip.start + 0.5, 6);
    const drawn = stackGroups(next, outer)[0].scene;
    const shot = drawn.layers.find((l) => l.id === 'shot') as Extract<Layer, { type: 'precomp' }>;
    expect(shot.scene.layers.some((l) => l.type === 'text' && l.text.text === 'DOS')).toBe(true);
  });

  it('draws a nested precomp comp as it is now, even with a clip only the timeline can draw', () => {
    const spec = findTemplate('subject-reveal')!;
    const scene = spec.build({ width: W, height: H }, { subject: { asset: 'a1', matte: 'C:/roto/run/matte.mkv' }, plate: { asset: 'p1', kind: 'image' }, title: ['YOU MADE', 'IT HERE'], phrase: 'Welcome in', cardAt: 3, duration: 4 });
    const exploded = explodeScene(scene, { name: '[Motion] Reveal', fps: 30 });
    const innerId = exploded.nested[0].id;
    const edit = (project: Project, name: string, change: (clip: Comp['clips'][number]) => Comp['clips'][number]): Project => ({
      ...project,
      comps: project.comps.map((c) => (c.id === innerId ? { ...c, clips: c.clips.map((clip) => (clip.name === name ? change(clip) : clip)) } : c)),
    });
    /** Every layer the parent's fused scene draws, down through its precomps. */
    const flat = (layers: Layer[]): Layer[] => layers.flatMap((l) => [l, ...(l.type === 'precomp' ? flat(l.scene.layers) : [])]);
    const titleIn = (project: Project) => flat(stackGroups(project, project.comps.find((c) => c.id === exploded.comp.id)!)[0].scene.layers).find((l) => l.id === 'title-left')?.in;
    let project = projectWith(exploded);
    expect(titleIn(project)).toBeCloseTo(0.17, 6);
    // The user slides the first title a second later, then crops the plate.
    project = edit(project, 'YOU MADE', (clip) => ({ ...clip, start: clip.start + 1 }));
    expect(titleIn(project)).toBeCloseTo(1.17, 6);
    project = edit(project, 'Clean plate', (clip) => ({ ...clip, transform: { ...clip.transform, cropLeft: 10 } }));
    expect(titleIn(project)).toBeCloseTo(1.17, 6);
    // The plate still draws (on its own clock), and what it cannot draw there is named.
    const shot = stackGroups(project, project.comps.find((c) => c.id === exploded.comp.id)!)[0].scene.layers.find((l) => l.id === 'shot') as Extract<Layer, { type: 'precomp' }>;
    expect(flat(shot.scene.layers).some((l) => l.id === 'plate' && !l.ref)).toBe(true);
    expect(stackLossy(project, project.comps.find((c) => c.id === exploded.comp.id)!)).toEqual(["Clean plate: crop is not applied inside 'Shot as card'"]);
    expect(stackLossy(projectWith(exploded), exploded.comp)).toEqual([]);
  });

  it('gives expressions the in and out points on the layer clock, fused, moved or on its own', () => {
    const scene: MotionScene = {
      version: 1, width: W, height: H, duration: 6,
      layers: [{ id: 'fade', type: 'shape', in: 1, out: 4, shape: { shape: 'rect', size: [400, 200], fill: '#fff' }, transform: { opacity: { expr: 'linear(time, inPoint, inPoint+1, 0, 100)' } } }],
    };
    const opacity = (s: MotionScene, t: number) => evaluateScene(s, t).layers.find((l) => l.layer.id === 'fade' && !l.layer.ref)!.opacity;
    expect(opacity(scene, 1.5)).toBeCloseTo(0.5, 6);
    const exploded = explodeScene(scene, { name: '[Motion] Fade', fps: 30 });
    const moved = { ...exploded.comp, clips: exploded.comp.clips.map((clip) => ({ ...clip, start: clip.start + 2 })) };
    const project = projectWith({ ...exploded, comp: moved });
    expect(opacity(stackGroups(project, moved)[0].scene, 3.5)).toBeCloseTo(0.5, 6);
    // Drawn on its own, the clip's scene runs from its in point: half a second in is 1.5 s.
    const clip = moved.clips[0];
    expect(opacity(standaloneScene(project, clip)!, clip.in + 0.5 * clip.speed)).toBeCloseTo(0.5, 6);
  });

  it('opens the reference subject reveal with its card precomp as layers', () => {
    const spec = findTemplate('subject-reveal')!;
    const scene = spec.build({ width: W, height: H }, { subject: { asset: 'a1', matte: 'C:/roto/run/matte.mkv' }, plate: { asset: 'p1', kind: 'image' }, title: ['YOU MADE', 'IT HERE'], phrase: 'Welcome to my channel', cardAt: 3.8, duration: 4.8 });
    const exploded = explodeScene(scene, { name: '[Motion] Square reveal', fps: 30 });
    expect(exploded.comp.clips.map((c) => c.name)).toEqual(['Stage', 'Shot as card']);
    expect(exploded.nested[0].clips.map((c) => c.name)).toEqual(['Clean plate', 'YOU MADE', 'IT HERE', 'Subject', 'Phrase']);
    const project = projectWith(exploded);
    const fused = stackGroups(project, project.comps.find((c) => c.id === exploded.comp.id)!)[0].scene;
    for (const t of [0.2, 1, 3.9, 4.5]) expectSameFrame(evaluateScene(scene, t), evaluateScene(fused, t), ['stage', 'shot']);
  });
});
