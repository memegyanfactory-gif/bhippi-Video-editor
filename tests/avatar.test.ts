import { describe, expect, it } from 'vitest';
import catalogue from '../src/lib/ai-tools.json';
import { SEAT_TOOLS } from '../src/lib/council';
import { ACTED_TOOLS, activityForStep, activityForTool, clipIdsIn, diffTimeline } from '../src/avatar/brain';
import type { AvatarEvent } from '../src/avatar/bus';
import { ChatMirror, TURN_STALE_MS, WRITING_MS } from '../src/avatar/mirror';
import { ANIMS, poseAt, type AnimName } from '../src/avatar/poses';
import { ART_H, ART_W, CHARACTERS, FEET_Y, HAIR_TOP, REST, renderPose, type Pose } from '../src/avatar/sprite';
import { newClip, newProject, tracksOf } from '../src/lib/timeline';
import type { Clip, Project } from '../src/lib/types';

const toolNames = new Set((catalogue as { tools: { name: string }[] }).tools.map((tool) => tool.name));

describe('what the avatar acts out', () => {
  it('dresses for the council seat whose tool is running', () => {
    expect(activityForTool('online_research')).toEqual({ kind: 'research', role: 'researcher' });
    expect(activityForTool('find_free_media')).toEqual({ kind: 'research', role: 'researcher' });
    expect(activityForTool('level_audio')).toEqual({ kind: 'mix', role: 'audio' });
    expect(activityForTool('layout_clip')).toEqual({ kind: 'direct', role: 'director' });
    expect(activityForTool('create_motion_scene')).toEqual({ kind: 'draw', role: 'animator' });
  });

  it('polishes during QA, thinks while it reads, and leaves timeline edits to the diff', () => {
    expect(activityForTool('run_frame_qa')?.kind).toBe('polish');
    expect(activityForTool('consult_council')?.kind).toBe('polish');
    expect(activityForTool('get_comp')?.kind).toBe('think');
    expect(activityForTool('split_clips')).toBeNull();
    expect(activityForTool('delete_clips')).toBeNull();
  });

  it('only names tools Bhippi AI really has', () => {
    const named = [...ACTED_TOOLS, ...Object.values(SEAT_TOOLS).flatMap((set) => [...set])];
    expect(named.filter((name) => !toolNames.has(name))).toEqual([]);
  });

  it('reads the clips a call is about from its arguments', () => {
    expect(clipIdsIn({ clipId: 'a', clipIds: ['b', 3, 'c'] })).toEqual(['a', 'b', 'c']);
    expect(clipIdsIn(null)).toEqual([]);
  });
});

describe('mirroring the chat', () => {
  const start = (turnId: string): AvatarEvent => ({ type: 'turn', turnId, busy: true });
  const end = (turnId: string, outcome: 'done' | 'stopped' | 'failed'): AvatarEvent => ({ type: 'turn', turnId, busy: false, outcome });
  const call = (turnId: string, callId: string, name: string): AvatarEvent => ({ type: 'tool-start', turnId, callId, name, activity: activityForTool(name), clipIds: [] });
  const done = (turnId: string, callId: string, name: string, edited = false): AvatarEvent => ({
    type: 'tool-end', turnId, callId, name, ok: true, ghosts: [],
    diff: edited ? { compId: 'c', added: ['x'], removed: [], cuts: [], moved: [], changed: [] } : null,
  });
  const kind = (mirror: ChatMirror, now: number) => mirror.desired(now)?.kind ?? null;

  it('does what the newest running call does, then writes or thinks between calls', () => {
    const mirror = new ChatMirror();
    expect(mirror.apply(start('t'), 0)).toEqual({ type: 'started', plugin: false });
    expect(kind(mirror, 10)).toBe('think');
    mirror.apply(call('t', 'a', 'online_research'), 100);
    expect(mirror.desired(110)).toMatchObject({ kind: 'research', role: 'researcher' });
    mirror.apply(call('t', 'b', 'level_audio'), 200);
    expect(mirror.desired(210)).toMatchObject({ kind: 'mix', role: 'audio' });
    mirror.apply(done('t', 'b', 'level_audio'), 300);
    expect(kind(mirror, 310)).toBe('research');
    mirror.apply(done('t', 'a', 'online_research'), 400);
    expect(kind(mirror, 410)).toBe('think');
    mirror.apply({ type: 'chat', turnId: 't', what: 'writing' }, 500);
    expect(kind(mirror, 510)).toBe('talk');
    expect(kind(mirror, 500 + WRITING_MS + 10)).toBe('think');
    mirror.apply(call('t', 'c', 'ask_user'), 2000);
    expect(kind(mirror, 2010)).toBe('ask');
  });

  it('acts out the steps a CLI takes by itself, for as long as they are open', () => {
    const mirror = new ChatMirror();
    mirror.apply(start('t'), 0);
    mirror.apply({ type: 'step', turnId: 't', id: 's1', verb: 'searched', title: 'Web search: skyline b-roll', done: false }, 10);
    expect(mirror.desired(20)).toMatchObject({ kind: 'research', role: 'researcher' });
    mirror.apply({ type: 'step', turnId: 't', id: 's1', verb: 'searched', title: '', done: true }, 30);
    expect(kind(mirror, 40)).toBe('think');
    expect(activityForStep('ran', 'npm test')).toEqual({ kind: 'tinker', role: null });
    expect(activityForStep('edited', 'scene.html')).toEqual({ kind: 'draw', role: null });
    expect(activityForStep('used', 'something')).toBeNull();
  });

  it('stops dead when the chat stops, and ignores what the stopped turn still sends', () => {
    const mirror = new ChatMirror();
    mirror.apply(start('t'), 0);
    mirror.apply(call('t', 'a', 'create_motion_scene'), 10);
    expect(mirror.apply(end('t', 'stopped'), 20)).toEqual({ type: 'ended', outcome: 'stopped', plugin: false });
    expect(mirror.desired(30)).toBeNull();
    expect(mirror.busy(30)).toBe(false);
    // Already in flight when the user pressed Stop: none of it is acted out, none of it wakes the chat.
    expect(mirror.apply(done('t', 'a', 'create_motion_scene', true), 40)).toEqual({ type: 'none' });
    expect(mirror.apply({ type: 'chat', turnId: 't', what: 'writing' }, 50)).toEqual({ type: 'none' });
    expect(mirror.apply(call('t', 'b', 'online_research'), 60)).toEqual({ type: 'none' });
    expect(mirror.desired(70)).toBeNull();
    // The backend's own closing event after the chat's: nothing more happens.
    expect(mirror.apply(end('t', 'stopped'), 80)).toEqual({ type: 'none' });
    // The next message is a new turn, and it starts fresh.
    expect(mirror.apply(start('t2'), 90)).toEqual({ type: 'started', plugin: false });
  });

  it('stopping the lead stops its council workers; a lead that simply finished leaves them working', () => {
    const stopped = new ChatMirror();
    stopped.apply(start('lead'), 0);
    stopped.apply(start('lead:sub:1'), 5);
    stopped.apply(call('lead:sub:1', 'w', 'level_audio'), 10);
    expect(stopped.apply(end('lead', 'stopped'), 20)).toEqual({ type: 'ended', outcome: 'stopped', plugin: false });
    expect(stopped.desired(30)).toBeNull();
    expect(stopped.apply(done('lead:sub:1', 'w', 'level_audio', true), 40)).toEqual({ type: 'none' });

    const finished = new ChatMirror();
    finished.apply(start('lead'), 0);
    finished.apply(start('lead:sub:1'), 5);
    finished.apply(call('lead:sub:1', 'w', 'level_audio'), 10);
    expect(finished.apply(end('lead', 'done'), 20)).toEqual({ type: 'none' });
    expect(finished.desired(30)).toMatchObject({ kind: 'mix', role: 'audio' });
    expect(finished.apply(done('lead:sub:1', 'w', 'level_audio', true), 40).type).toBe('edited');
    expect(finished.apply(end('lead:sub:1', 'done'), 50)).toEqual({ type: 'ended', outcome: 'done', plugin: false });
  });

  it('a Plugin Maker turn builds the plugin and leaves the edit open', () => {
    const mirror = new ChatMirror();
    expect(mirror.apply({ type: 'turn', turnId: 'p', busy: true, plugin: true }, 0)).toEqual({ type: 'started', plugin: true });
    expect(mirror.busy(10)).toBe(true);
    // Nothing in the video is changing, so nothing is guarded.
    expect(mirror.editBusy(10)).toBe(false);
    expect(mirror.buildingPlugin(10)).toBe(true);
    expect(kind(mirror, 10)).toBe('tinker');
    // Its file writes and research read as building, not drawing keyframes or researching footage.
    mirror.apply(call('p', 'a', 'write_file'), 20);
    expect(kind(mirror, 30)).toBe('tinker');
    mirror.apply({ type: 'step', turnId: 'p:sub:1', id: 's', verb: 'edited', title: 'index.html', done: false }, 40);
    expect(kind(mirror, 50)).toBe('tinker');
    // A question to the user is still a question.
    mirror.apply(call('p', 'q', 'ask_user'), 60);
    expect(kind(mirror, 70)).toBe('ask');
    // An editing turn alongside it guards the edit again.
    mirror.apply(start('e'), 80);
    expect(mirror.editBusy(90)).toBe(true);
    mirror.apply(end('e', 'done'), 100);
    expect(mirror.editBusy(110)).toBe(false);
    expect(mirror.apply({ type: 'step', turnId: 'p:sub:1', id: 's', verb: 'edited', title: '', done: true }, 115)).toEqual({ type: 'none' });
    mirror.apply(done('p', 'a', 'write_file'), 120);
    mirror.apply(done('p', 'q', 'ask_user'), 125);
    mirror.apply(end('p:sub:1', 'done'), 128);
    expect(mirror.apply(end('p', 'done'), 130)).toEqual({ type: 'ended', outcome: 'done', plugin: true });
  });

  it('forgets a turn that went silent without closing', () => {
    const mirror = new ChatMirror();
    mirror.apply(start('t'), 0);
    expect(mirror.busy(TURN_STALE_MS - 1)).toBe(true);
    expect(mirror.busy(TURN_STALE_MS + 1)).toBe(false);
    expect(mirror.desired(TURN_STALE_MS + 1)).toBeNull();
  });
});

describe('the timeline diff', () => {
  function base(): { project: Project; v1: string; v2: string; head: Clip; title: Clip } {
    const project = newProject('avatar');
    const comp = project.comps[0];
    const [v1, v2] = tracksOf(comp, 'video').map((track) => track.id);
    const head = newClip({ trackId: v1, start: 0, duration: 10, source: { type: 'media', assetId: 'head' } });
    const title = newClip({ trackId: v2, start: 2, duration: 3, source: { type: 'media', assetId: 'logo' } });
    comp.clips = [head, title];
    return { project, v1, v2, head, title };
  }
  const withClips = (project: Project, clips: Clip[]): Project => ({ ...project, comps: project.comps.map((comp, i) => (i === 0 ? { ...comp, clips } : comp)) });

  it('sees a split as a cut, not an added clip', () => {
    const { project, head, title } = base();
    const right = { ...head, id: 'right-half', start: 4, duration: 6 };
    const after = withClips(project, [{ ...head, duration: 4 }, right, title]);
    const diff = diffTimeline(project, after);
    expect(diff.cuts).toEqual([{ id: 'right-half', from: head.id }]);
    expect(diff.added).toEqual([]);
    // The left half shrank because of the cut; that is not a separate tweak.
    expect(diff.changed).toEqual([]);
  });

  it('tells added, removed, moved and changed clips apart', () => {
    const { project, v2, head, title } = base();
    const extra = newClip({ trackId: v2, start: 12, duration: 2, source: { type: 'media', assetId: 'broll' } });
    const after = withClips(project, [{ ...head, volume: 0.5 }, extra]);
    expect(diffTimeline(project, after)).toMatchObject({ added: [extra.id], removed: [title.id], moved: [], changed: [head.id] });
    const moved = withClips(project, [head, { ...title, start: 6 }]);
    expect(diffTimeline(project, moved).moved).toEqual([title.id]);
  });

  it('ignores a clip rebuilt with the same contents', () => {
    const { project, head, title } = base();
    expect(diffTimeline(project, withClips(project, [{ ...head }, { ...title }]))).toMatchObject({ added: [], removed: [], cuts: [], moved: [], changed: [] });
  });
});

/** RGBA of one art pixel. */
const px = (pixels: Uint8ClampedArray, x: number, y: number) => [...pixels.slice((y * ART_W + x) * 4, (y * ART_W + x) * 4 + 4)];
const rows = (pixels: Uint8ClampedArray) => Array.from({ length: ART_H }, (_, y) => Array.from({ length: ART_W }, (_, x) => px(pixels, x, y)[3] > 0).some(Boolean));

describe('the pixel character', () => {
  it('stands on the ground line with its hair at the top of the frame', () => {
    const drawn = rows(renderPose(REST));
    expect(drawn.indexOf(true)).toBeGreaterThanOrEqual(HAIR_TOP - 3);
    expect(drawn.indexOf(true)).toBeLessThanOrEqual(HAIR_TOP + 3);
    expect(drawn[FEET_Y - 1]).toBe(true);
    expect(drawn.slice(FEET_Y + 1).some(Boolean)).toBe(false);
  });

  it('puts glasses on for research and takes them off after', () => {
    const frame = [0x1c, 0x1f, 0x40, 255];
    const count = (pose: Pose) => {
      const pixels = renderPose(pose);
      let n = 0;
      for (let y = 25; y < 50; y++) for (let x = 0; x < ART_W; x++) if (px(pixels, x, y).join() === frame.join()) n++;
      return n;
    };
    expect(count({ ...REST, gear: ['glasses'] })).toBeGreaterThan(count(REST) + 20);
  });

  it('carries a clip in the clip’s own colour, as the timeline reports it', () => {
    const pixels = renderPose(poseAt('carry', 0.2, { color: 'rgb(168, 70, 127)' }));
    let found = false;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] === 168 && pixels[i + 1] === 70 && pixels[i + 2] === 127) found = true;
    expect(found).toBe(true);
  });

  it('draws every animation, all the way through, inside its frame', () => {
    for (const name of Object.keys(ANIMS) as AnimName[]) {
      for (const t of [0, 0.2, 0.5, 1.2, 2.5, 4.4, 9.8]) {
        const drawn = rows(renderPose(poseAt(name, t, { gear: ['beret'], color: '#4fb3ff' })));
        expect(drawn.some(Boolean), `${name} at ${t}s`).toBe(true);
        // Nothing but dangling legs goes below the ground line.
        expect(drawn.slice(FEET_Y + 12).some(Boolean), `${name} at ${t}s`).toBe(false);
      }
    }
  });

  it('plays every animation as every character, standing on the same ground line', () => {
    const heli = renderPose(REST);
    for (const { id } of CHARACTERS) {
      const standing = renderPose({ ...REST, character: id });
      const drawn = rows(standing);
      expect(drawn[FEET_Y - 1], id).toBe(true);
      expect(drawn.slice(FEET_Y + 1).some(Boolean), id).toBe(false);
      if (id !== 'heli') expect(standing.join() === heli.join(), `${id} looks like Heli`).toBe(false);
      for (const name of Object.keys(ANIMS) as AnimName[]) {
        for (const t of [0, 0.5, 2.5, 9.8]) {
          const frame = rows(renderPose(poseAt(name, t, { gear: ['glasses'], color: '#4fb3ff', character: id })));
          expect(frame.some(Boolean), `${id} ${name} at ${t}s`).toBe(true);
          expect(frame.slice(FEET_Y + 12).some(Boolean), `${id} ${name} at ${t}s`).toBe(false);
        }
      }
    }
  });

  it('draws Heli the same after another character was drawn', () => {
    const before = renderPose(REST).join();
    renderPose({ ...REST, character: 'genie' });
    expect(renderPose(REST).join()).toBe(before);
  });
});
