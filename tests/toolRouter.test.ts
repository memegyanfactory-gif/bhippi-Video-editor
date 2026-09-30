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

describe('the premium films by name', () => {
  it('open their own playbook, with the ready-made pieces and what to vary', () => {
    expect(routeTools('make a 15 s launch film for Bhippi to the Meet Bhippi song').playbook?.id).toBe('launch-film');
    expect(routeTools('a product demo of my app: ask, work, result').playbook?.id).toBe('product-demo');
    expect(routeTools('an identity film for our glass logo').playbook?.id).toBe('identity-film');
    expect(routeTools('a kinetic explainer in the crimson look').playbook?.id).toBe('kinetic-explainer');
    expect(routeTools('a fluid saas film like the Relume one').playbook?.id).toBe('fluid-saas');
    const set = routeTools('make a launch film that uses the real UI');
    expect(set.playbook?.templates).toEqual(expect.arrayContaining(['product-demo', 'fly-through-word']));
    expect(Array.isArray(set.playbook?.vary)).toBe(true);
    // A drawn look still wins, and an ordinary launch ad keeps its own playbook.
    expect(routeTools('a hand drawn launch film').playbook?.id).toBe('hand-made');
    expect(routeTools('a launch ad for my saas app').playbook?.id).toBe('product-launch');
  });

  it('leave ordinary asks that share a few words with them on their own playbooks', () => {
    // A montage cut to a song, a showreel, brand colours and a physical product are not premium films.
    expect(routeTools('cut my wedding clips to the song').playbook?.id).toBe('normal-edit');
    expect(routeTools('apply my brand identity colours to the captions').playbook?.id).not.toBe('identity-film');
    expect(routeTools('edit my acting demo reel').playbook?.id).not.toBe('product-demo');
    expect(routeTools('show the real product, not renders, in this sneaker ad').playbook?.id).not.toBe('launch-film');
    // Named as films, they still open.
    expect(routeTools('a demo video of my app').playbook?.id).toBe('product-demo');
    expect(routeTools('a brand identity film for our studio').playbook?.id).toBe('identity-film');
    expect(routeTools('a video of the real app at work').playbook?.id).toBe('launch-film');
  });
});
