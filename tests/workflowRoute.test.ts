import { describe, expect, it } from 'vitest';
import { asksForProduction, routeWorkflow } from '../src/lib/workflowRoute';

describe('Auto workflow routing', () => {
  it.each([
    'make a 40 s reel from this footage',
    'Create an explainer about black holes',
    'turn this podcast into three shorts',
    'can you produce a launch video for my app',
    'do a full edit of the interview',
    'edit this from scratch',
  ])('runs "%s" as a full production', (message) => {
    expect(asksForProduction(message)).toBe(true);
    expect(routeWorkflow('auto', message, false)).toBe('full');
  });

  it.each([
    'trim the first 3 seconds',
    'add a title that says Hello',
    'make the music quieter',
    'make it faster',
    'remove the cough at 0:42',
    'what is on my timeline?',
    'add captions',
  ])('runs "%s" as a quick edit', (message) => {
    expect(asksForProduction(message)).toBe(false);
    expect(routeWorkflow('auto', message, false)).toBe('quick');
  });

  it('keeps a production under way in the full workflow', () => {
    expect(routeWorkflow('auto', 'make the title bigger', true)).toBe('full');
  });

  it('never overrides an explicit choice', () => {
    expect(routeWorkflow('full', 'trim the first 3 seconds', false)).toBe('full');
    expect(routeWorkflow('quick', 'make a 40 s reel', true)).toBe('quick');
  });
});
