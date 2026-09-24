// Avatar Lab, stage mode (avatar-lab.html?stage): a stand-in workspace — a program monitor and a
// timeline with clips — driving the real AvatarEngine through the real bus, so every behaviour
// (research, cuts, adds, deletes, polish, drag, slap) can be tried without the desktop app.

import { avatarBus } from './bus';
import { AvatarEngine } from './engine';
import type { Clip, Project } from '../lib/types';
import '../styles/avatar.css';

type LabClip = { id: string; track: number; start: number; duration: number; name: string; kind: 'v' | 'a' | 't' };

const PX = 44;
const HEAD = 150;
const ROW = 46;
let clips: LabClip[] = [
  { id: 'c1', track: 0, start: 0, duration: 6, name: 'talking head.mp4', kind: 'v' },
  { id: 'c2', track: 0, start: 6, duration: 5, name: 'b-roll city.mp4', kind: 'v' },
  { id: 'c3', track: 1, start: 2, duration: 3, name: 'Hook title', kind: 't' },
  { id: 'c4', track: 3, start: 0, duration: 11, name: 'voice.wav', kind: 'a' },
  { id: 'c5', track: 4, start: 0, duration: 12, name: 'music bed.mp3', kind: 'a' },
];
let seq = 10;

document.body.innerHTML = `
<style>
  body { margin: 0; background: #151515; color: #ddd; font: 12px system-ui; height: 100vh; display: grid; grid-template-rows: 1fr 300px 28px; }
  .top { display: grid; grid-template-columns: 320px 1fr; }
  .controls { padding: 10px; display: flex; flex-wrap: wrap; gap: 6px; align-content: flex-start; border-right: 1px solid #333; }
  .controls button { background: #2b2b2b; color: #ddd; border: 1px solid #444; border-radius: 4px; padding: 5px 8px; cursor: pointer; }
  .controls button:hover { border-color: #2d8ceb; }
  [data-panel="program"] { display: grid; place-items: center; background: #1d1d1d; }
  .monitor-frame { width: 480px; height: 270px; background: linear-gradient(135deg, #2c3e50, #4a2c50); border: 1px solid #333; }
  [data-panel="timeline"] { background: #1f1f1f; border-top: 1px solid #333; position: relative; }
  .timeline { position: absolute; inset: 24px 0 0 0; --tl-head: ${HEAD}px; }
  .tl-scroll { position: absolute; inset: 0; overflow: hidden; }
  .tl-ruler { position: absolute; left: 0; right: 0; top: 0; height: 34px; background: #262626; border-bottom: 1px solid #111; }
  .tl-divider { position: absolute; left: 0; right: 0; height: 2px; background: #444; }
  .tl-clip { position: absolute; height: ${ROW - 8}px; border-radius: 3px; border: 1px solid #6a8cd4; color: #fff; font-size: 11px; padding: 2px 4px; box-sizing: border-box; overflow: hidden; }
  .tl-clip.v { background: #3b5ba5; } .tl-clip.a { background: #1f6d7c; border-color: #45b0c4; } .tl-clip.t { background: #a8467f; border-color: #d87ab0; }
  .heads { position: absolute; left: 0; top: 34px; width: ${HEAD}px; bottom: 0; background: #202020; border-right: 1px solid #111; }
  footer { background: #111; border-top: 1px solid #333; padding: 6px 10px; color: #888; }
</style>
<div class="top"><div class="controls" id="controls"></div><section data-panel="program"><div class="monitor-frame"></div></section></div>
<section data-panel="timeline"><div class="timeline"><div class="tl-scroll" id="scroll"><div class="tl-ruler"></div><div class="heads"></div><div class="tl-divider" style="top:${34 + 3 * ROW - 4}px"></div><div id="lanes"></div></div></div></section>
<footer id="status">Avatar Lab — stage</footer>
<div id="avatar-root" class="avatar-layer"></div>`;

const lanes = document.getElementById('lanes')!;
const status = document.getElementById('status')!;

function render() {
  lanes.innerHTML = '';
  for (const clip of clips) {
    const el = document.createElement('div');
    el.className = `tl-clip ${clip.kind}`;
    el.dataset.clipId = clip.id;
    Object.assign(el.style, { left: `${HEAD + clip.start * PX}px`, top: `${34 + clip.track * ROW + 4}px`, width: `${clip.duration * PX - 2}px` });
    el.textContent = clip.name;
    lanes.append(el);
  }
}

function project(list: LabClip[]): Project {
  const toClip = (c: LabClip) => ({ id: c.id, trackId: `t${c.track}`, start: c.start, duration: c.duration, source: { type: 'media', assetId: c.name } }) as unknown as Clip;
  return { activeCompId: 'comp', comps: [{ id: 'comp', clips: list.map(toClip) }] } as unknown as Project;
}

let call = 0;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** The lab's chat turn; Stop closes it and the next action opens a new one, as the real chat does. */
let turn = 'lab-1';
let turns = 1;
let live = false;
const open = () => {
  if (!live) {
    turn = `lab-${++turns}`;
    avatarBus.turn(turn, true);
    live = true;
  }
  return turn;
};

/** Runs one fake tool: start, change the timeline, end — the same order App.tsx reports. */
async function tool(name: string, ms: number, change?: (list: LabClip[]) => LabClip[]) {
  const turnId = open();
  const id = `call-${++call}`;
  const before = project(clips);
  avatarBus.toolStart(turnId, id, name, {});
  await wait(ms);
  if (change) {
    clips = change(clips.map((c) => ({ ...c })));
    render();
  }
  avatarBus.toolEnd(turnId, id, name, true, before, change ? project(clips) : before);
  status.textContent = `${name} done`;
}

/** Streams `ms` of the reply (or of thinking) the way the chat's deltas arrive. */
async function stream(what: 'thinking' | 'writing', ms: number) {
  const turnId = open();
  for (let t = 0; t < ms; t += 120) {
    if (turn !== turnId || !live) return;
    avatarBus.chat(turnId, what);
    await wait(120);
  }
}

/** A step a CLI takes by itself, open for `ms`. */
async function step(verb: string, title: string, ms: number) {
  const turnId = open();
  const id = `step-${++call}`;
  avatarBus.step(turnId, id, verb, title, false);
  await wait(ms);
  avatarBus.step(turnId, id, verb, title, true);
}

const close = (outcome: 'done' | 'stopped' | 'failed') => {
  avatarBus.turn(turn, false, outcome);
  live = false;
  status.textContent = `turn ${outcome}`;
};

const actions: [string, () => void | Promise<void>][] = [
  ['Turn start', () => { open(); }],
  ['Turn end', () => close('done')],
  ['Stop', () => close('stopped')],
  ['Fail', () => close('failed')],
  ['Thinking 3s', () => stream('thinking', 3000)],
  ['Writing 3s', () => stream('writing', 3000)],
  ['CLI web search 3s', () => step('searched', 'Web search: best b-roll sites', 3000)],
  ['CLI ran 3s', () => step('ran', 'npm run build', 3000)],
  ['Ask user 4s', () => tool('ask_user', 4000)],
  ['Research 4s', () => tool('online_research', 4000)],
  ['Free media 3s', () => tool('find_free_media', 3000)],
  ['Mix audio 3s', () => tool('level_audio', 3000)],
  ['Direct 4s', () => tool('layout_clip', 4000)],
  ['Animate 3s', () => tool('create_motion_scene', 3000, (list) => [...list, { id: `c${++seq}`, track: 2, start: 7, duration: 3, name: '[Motion] Stat', kind: 't' }])],
  ['Polish 4s', () => tool('run_frame_qa', 4000)],
  ['Cut clip', () => tool('split_clips', 50, (list) => {
    const target = list.find((c) => c.kind === 'v' && c.duration > 2)!;
    const half = target.duration / 2;
    target.duration = half;
    return [...list, { ...target, id: `c${++seq}`, start: target.start + half, duration: half }];
  })],
  ['Add title', () => tool('add_text', 50, (list) => [...list, { id: `c${++seq}`, track: 1, start: 7 + Math.random() * 3, duration: 2.5, name: 'New title', kind: 't' }])],
  ['Delete clip', () => tool('delete_clips', 50, (list) => list.filter((c) => c !== list.find((x) => x.kind === 't')))],
  ['Move clip', () => tool('move_clips', 50, (list) => list.map((c, i) => (i === 1 ? { ...c, start: c.start + 1 } : c)))],
  ['Tweak clip', () => tool('update_clip', 50, (list) => list.map((c, i) => (i === 0 ? { ...c, name: `${c.name}*` } : c)))],
  ['Burst x8', async () => {
    for (const name of ['get_comp', 'online_research', 'split_clips', 'add_text', 'level_audio', 'add_text', 'delete_clips', 'run_frame_qa']) {
      if (name === 'split_clips') await tool(name, 30, (list) => { const t = list.find((c) => c.kind === 'v' && c.duration > 2)!; const h = t.duration / 2; t.duration = h; return [...list, { ...t, id: `c${++seq}`, start: t.start + h, duration: h }]; });
      else if (name === 'add_text') await tool(name, 30, (list) => [...list, { id: `c${++seq}`, track: 2, start: Math.random() * 10, duration: 2, name: 'Word', kind: 't' }]);
      else if (name === 'delete_clips') await tool(name, 30, (list) => list.slice(1));
      else await tool(name, 400);
    }
    close('done');
  }],
  ['Reset clips', () => { location.reload(); }],
];

const controls = document.getElementById('controls')!;
for (const [label, run] of actions) {
  const button = document.createElement('button');
  button.textContent = label;
  button.onclick = () => void run();
  controls.append(button);
}

render();
const engine = new AvatarEngine(document.getElementById('avatar-root')!);
avatarBus.subscribe((event) => engine.handle(event));
Object.assign(window, { engine, avatarBus, tool, stream, step, close });
