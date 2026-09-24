import { describe, expect, it } from 'vitest';
import catalogue from '../src/lib/ai-tools.json';
import { PLAYBOOKS, playbook, playbookIndex } from '../src/lib/motionDirection';
import { EASE_NAMES } from '../src/motion/anim';
import { EFFECT_TYPES } from '../src/motion/validate';

const TOOLS = new Set((catalogue as { tools: { name: string }[] }).tools.map((t) => t.name));
// Engine features that exist today (effects are checked against the engine's own list).
const FEATURES = new Set(['shape.groups', 'text.type', 'text.retype', 'text.counter', 'text.scatter', 'text.cascade', 'text.lineSpacing', 'camera.aperture', 'camera.dof', 'bleed', 'kind:array', 'morphTo', 'ops.merge', 'backdrop', 'scene.cues']);

describe('motion direction playbooks', () => {
  it('cite only tools, eases, effects and features that exist', () => {
    for (const book of PLAYBOOKS) {
      for (const tool of book.tools) expect(TOOLS.has(tool), `${book.id}: tool ${tool}`).toBe(true);
      for (const e of book.eases) expect(EASE_NAMES.includes(e as never), `${book.id}: ease ${e}`).toBe(true);
      for (const f of book.features) {
        if (f.startsWith('effects.')) expect(EFFECT_TYPES.includes(f.slice(8) as never), `${book.id}: effect ${f}`).toBe(true);
        else expect(FEATURES.has(f), `${book.id}: feature ${f}`).toBe(true);
      }
    }
  });
  it('have measured beats that run in order', () => {
    for (const book of PLAYBOOKS) {
      let end = 0;
      for (const beat of book.beats) {
        expect(beat.seconds[0]).toBeGreaterThanOrEqual(end - 1e-9);
        expect(beat.seconds[1]).toBeGreaterThan(beat.seconds[0]);
        end = beat.seconds[1];
      }
    }
  });
  it('are reachable by id and listed', () => {
    expect(playbookIndex().map((p) => p.id)).toContain('saas-explainer');
    expect(playbook('ai-launch')?.films.length).toBeGreaterThan(0);
    expect(playbook('nope')).toBeNull();
    expect(TOOLS.has('motion_guide')).toBe(true);
  });
});
