import { describe, expect, it } from 'vitest';
import { checkGraphic, issuesText, refit } from '../src/lib/graphicCheckRun';
import { guidedRefusal } from '../src/lib/modelProfile';

const canvas = { width: 1920, height: 1080 };

describe('guided tier', () => {
  it('holds a guided model to templates: no raw HTML or hand-written scenes', () => {
    expect(guidedRefusal('create_motion_graphic', { template: 'custom', html: '<div>hi</div>' })).toMatch(/templates, not raw HTML.*add_graphic/);
    expect(guidedRefusal('create_motion_graphic', { template: 'hook-promise', title: 'Save more', css: '.x{}' })).toMatch(/Guided mode/);
    expect(guidedRefusal('create_motion_graphic', { template: 'hook-promise', title: 'Save more' })).toBeNull();
    expect(guidedRefusal('create_motion_scene', { scene: { layers: [] } })).toMatch(/hand-written scene/);
    expect(guidedRefusal('create_motion_scene', { template: 'brand-title', params: { title: 'x' } })).toBeNull();
    expect(guidedRefusal('create_motion_sequence', { beats: [{ template: 'brand-title', params: {} }, { scene: {} }] })).toMatch(/each beat is a template/);
    expect(guidedRefusal('add_graphic', { kind: 'title', text: 'x' })).toBeNull();
    expect(guidedRefusal('update_clip', { clipId: 'a' })).toBeNull();
  });

  it('refits the slot that spilled, and the one that grows the card when no slot owns the problem', () => {
    expect(refit({}, [{ text: 'Long title', problem: 'overflows-panel', by: 40, slot: 'title' }], canvas)).toEqual({ title: 0.88 });
    expect(refit({ rows: 0.9 }, [{ text: '42%', problem: 'outside-safe', by: 26 }], canvas, ['title', 'rows'])).toEqual({ rows: 0.72 });
    expect(refit({ title: 0.6 }, [{ text: 'x', problem: 'off-frame', by: 300, slot: 'title' }], canvas)).toBeNull();
    expect(refit({}, [{ text: 'x', problem: 'outside-safe', by: 10 }], canvas)).toBeNull();
    expect(issuesText([{ text: 'a', problem: 'overflows-panel', by: 12, slot: 'rows' }])).toBe('rows spills out of its card by 12px');
  });

  it('reports nothing where there is no page to lay a graphic out in', async () => {
    expect(await checkGraphic({ html: '<div>x</div>', css: '' }, canvas, 4)).toBeNull();
  });
});

describe('render scenes are for frontier models', () => {
  it('turns a guided model away from planning a scene it would have to render itself', () => {
    const scenes = [{ start: 0, end: 6, mediaSource: 'generate' }, { start: 6, end: 12, mediaSource: 'render' }];
    expect(guidedRefusal('save_video_blueprint', { scenes })).toMatch(/"render" scene.*generate.*build_edit_from_brief/s);
    expect(guidedRefusal('save_video_blueprint', { scenes: [{ start: 0, end: 6, mediaSource: 'generate' }] })).toBeNull();
  });
});
