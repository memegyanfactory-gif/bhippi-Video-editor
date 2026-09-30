import { describe, expect, it } from 'vitest';
import catalogue from '../src/lib/ai-tools.json';
import { PLAYBOOKS, playbook, playbookIndex } from '../src/lib/motionDirection';
import { EASE_NAMES } from '../src/motion/anim';
import { EFFECT_TYPES } from '../src/motion/validate';
import { MOTION_TEMPLATES } from '../src/motion/kit';
import { TRANSITION_KINDS } from '../src/motion/sequence';

const TOOLS = new Set((catalogue as { tools: { name: string }[] }).tools.map((t) => t.name));
// Engine features that exist today (effects are checked against the engine's own list).
const FEATURES = new Set(['shape.groups', 'text.type', 'text.retype', 'text.counter', 'text.scatter', 'text.cascade', 'text.lineSpacing', 'camera.aperture', 'camera.dof', 'bleed', 'kind:array', 'morphTo', 'ops.merge', 'backdrop', 'scene.cues', 'scene.finish', 'layer.shutter', 'form', 'form.morph', 'form.squash', 'particles', 'link', 'character', 'drawing']);
// A playbook's ready-made pieces are templates or the joins between beats.
const PIECES = new Set<string>([...MOTION_TEMPLATES.map((t) => t.id), ...TRANSITION_KINDS]);
const FILMS = ['launch-film', 'product-demo', 'identity-film', 'kinetic-explainer', 'fluid-saas'];

describe('motion direction playbooks', () => {
  it('cite only tools, eases, effects, features and templates that exist', () => {
    for (const book of PLAYBOOKS) {
      for (const tool of book.tools) expect(TOOLS.has(tool), `${book.id}: tool ${tool}`).toBe(true);
      for (const e of book.eases) expect(EASE_NAMES.includes(e as never), `${book.id}: ease ${e}`).toBe(true);
      for (const f of book.features) {
        if (f.startsWith('effects.')) expect(EFFECT_TYPES.includes(f.slice(8) as never), `${book.id}: effect ${f}`).toBe(true);
        else expect(FEATURES.has(f), `${book.id}: feature ${f}`).toBe(true);
      }
      for (const id of book.templates ?? []) expect(PIECES.has(id), `${book.id}: template ${id}`).toBe(true);
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
  it('teach the five premium films on a 15 s clock, with what to vary per film', () => {
    for (const id of FILMS) {
      const book = playbook(id);
      expect(book, id).not.toBeNull();
      expect(book!.beats.at(-1)!.seconds[1], id).toBe(15);
      expect(book!.vary?.length, `${id}: vary`).toBeGreaterThanOrEqual(2);
      expect(book!.templates?.length, `${id}: templates`).toBeGreaterThan(0);
      // Measured before judged: every film playbook sends the model to look at its frames.
      expect(book!.tools, id).toContain('review_frames');
    }
  });
  it('offer templates without requiring them', () => {
    // Full-tier models keep their own scenes and renderer: no playbook says a template is the only way.
    const forcing = /\b(must|always|only) use (a |the )?templates?\b|\bnever (write|build) (your own|a raw)\b/i;
    for (const book of PLAYBOOKS) expect(forcing.test(JSON.stringify(book)), `${book.id} forces templates`).toBe(false);
    expect(playbook('launch-film')!.rules.some((rule) => /mediaSource "render"/.test(rule) && /passes/.test(rule))).toBe(true);
  });
});
