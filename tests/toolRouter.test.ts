import { describe, expect, it } from 'vitest';
import catalog from '../src/lib/ai-tools.json';
import { CORE_TOOLS, GENRE_TOOLS, routeTools } from '../src/lib/toolRouter';

const names = new Set((catalog as unknown as { tools: { name: string }[] }).tools.map((t) => t.name));
const size = (tools: string[]) => (catalog as unknown as { tools: { name: string }[] }).tools.filter((t) => tools.includes(t.name)).reduce((n, t) => n + JSON.stringify(t).length, 0);

describe('Token Council: the tool router', () => {
  it('names only tools that exist', () => {
    for (const tool of [...CORE_TOOLS, ...Object.values(GENRE_TOOLS).flat()]) expect(names.has(tool), tool).toBe(true);
  });

  it('routes the real SaaS ad brief to saas + characters + motion, with the hand-made playbook for a drawn look', () => {
    const set = routeTools('D:\\Bhippi Video editor this is the bhippi app make a video a saas video with hand drawn 2d characters and motion graphics');
    expect(set.genres).toEqual(expect.arrayContaining(['saas', 'character2d', 'motion']));
    expect(set.full).toEqual(expect.arrayContaining(['create_ui_screen', 'create_character', 'animate_character', 'create_motion_graphic', 'tool_help']));
    expect(set.full).not.toContain('roast_move');
    expect(set.playbook?.id).toBe('hand-made');
  });

  it('keeps the kind of video on a follow-up, adds memes for @funny, and falls back to an edit', () => {
    expect(routeTools('continue', ['make a documentary about the history of chai']).genres).toContain('documentary');
    expect(routeTools('go on', [], 'funny').genres).toContain('meme');
    expect(routeTools('make it better').genres).toEqual(['edit', 'motion']);
    expect(routeTools('turn my podcast into vertical reels').genres).toEqual(expect.arrayContaining(['shorts', 'edit']));
    expect(routeTools('a 3d blender product render').genres).toContain('3d');
  });

  it('sends a fraction of the catalogue in full', () => {
    const all = [...names];
    const set = routeTools('make a saas explainer for my app');
    expect(size(set.full) * 2).toBeLessThan(size(all));
  });
});

describe('playbooks for every kind of video', () => {
  it('name only tools that exist, and each genre opens with one', async () => {
    const { PLAYBOOKS } = await import('../src/lib/motionDirection');
    for (const book of PLAYBOOKS) for (const tool of book.tools) expect(names.has(tool), `${book.id}: ${tool}`).toBe(true);
    expect(routeTools('make a documentary about chai history').playbook?.id).toBe('documentary');
    expect(routeTools('a 3d render of our headphones for a promo').playbook?.id).toBe('3d-promo');
    expect(routeTools('a walkthrough tutorial of my saas app').playbook?.id).toBe('ui-walkthrough');
    expect(routeTools('a launch ad for my saas app').playbook?.id).toBe('product-launch');
    expect(routeTools('make memes on this clip, funny').playbook?.id).toBe('meme-edit');
    expect(routeTools('tighten my podcast footage').playbook?.id).toBe('normal-edit');
  });
});
