import { describe, expect, it } from 'vitest';
import { routeSignals, type ChatMessage } from '../src/chat/ChatPanel';
import { asksForProduction, continuesTheJob, routeWorkflow } from '../src/lib/workflowRoute';

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
    expect(routeWorkflow('quick', 'carry on', { productionActive: false, continues: 'full' })).toBe('quick');
  });
});

// 29 Sep: the Continue button's "Carry on with the task…" names no video, so a handed-over
// production ran as a Quick edit and skipped the whole pipeline.
const CARRY_ON = 'Carry on with the task from where the last turn stopped. The work already done is listed above; do not redo it.';
const BRIEF = 'https://www.youtube.com/watch?v=eQLi_t0X1ZE see this video, i have added a music with vo make the edit according to it, make the video motion graphic';

describe('Auto routing reads the situation', () => {
  it('keeps the workflow of the turn a message carries on', () => {
    expect(continuesTheJob(CARRY_ON)).toBe(true);
    expect(routeWorkflow('auto', CARRY_ON, { productionActive: false, continues: 'full' })).toBe('full');
    expect(routeWorkflow('auto', CARRY_ON, { productionActive: false, unfinished: { mode: 'full', ask: null } })).toBe('full');
    expect(routeWorkflow('auto', 'continue', { productionActive: false, unfinished: { mode: 'quick', ask: 'make a 40 s reel' } })).toBe('quick');
  });

  it('routes a stopped turn with no recorded workflow by the request it was working on', () => {
    expect(routeWorkflow('auto', CARRY_ON, { productionActive: false, unfinished: { mode: null, ask: BRIEF } })).toBe('full');
    expect(routeWorkflow('auto', 'keep going', { productionActive: false, unfinished: { mode: null, ask: 'trim the first 3 seconds' } })).toBe('quick');
  });

  it('does not treat a new request as a continuation', () => {
    expect(continuesTheJob('add a title that says Hello')).toBe(false);
    expect(routeWorkflow('auto', 'add a title that says Hello', { productionActive: false, unfinished: { mode: 'full', ask: BRIEF } })).toBe('quick');
  });

  it('runs a change pointed at one place as a quick edit', () => {
    expect(routeWorkflow('auto', 'make this bigger', { productionActive: false, scoped: true })).toBe('quick');
  });

  it('runs a brief or a reference link on a comp with no picture as a production', () => {
    expect(routeWorkflow('auto', 'https://youtu.be/abc cut it like this', { productionActive: false, blank: true })).toBe('full');
    expect(routeWorkflow('auto', 'x'.repeat(300), { productionActive: false, blank: true })).toBe('full');
    expect(routeWorkflow('auto', 'add captions', { productionActive: false, blank: true })).toBe('quick');
    expect(routeWorkflow('auto', 'https://youtu.be/abc cut it like this', { productionActive: false, blank: false })).toBe('quick');
  });
});

describe('routeSignals', () => {
  const user = (content: string): ChatMessage => ({ id: content, role: 'user', content, at: 0 });
  const answer = (status: 'done' | 'stopped' | 'error', mode?: 'full' | 'quick'): ChatMessage => ({
    id: `a-${status}-${mode}`, role: 'assistant', turnId: 't', providerId: 'p', providerLabel: 'P', model: null, content: '', thinking: '', steps: [],
    status, ...(mode ? { mode } : {}), notes: [], fault: null, usage: null, elapsedMs: null, limit: null,
  });

  it('finds the job a stopped answer was working on', () => {
    const signals = routeSignals([user(BRIEF), answer('stopped')], { productionActive: false });
    expect(signals.unfinished).toEqual({ mode: null, ask: BRIEF });
  });

  it('looks past a handover turn to the workflow recorded earlier on the same job', () => {
    const signals = routeSignals([user(BRIEF), answer('stopped', 'full'), user(CARRY_ON), answer('stopped')], { productionActive: false });
    expect(signals.unfinished).toEqual({ mode: 'full', ask: BRIEF });
  });

  it('adds nothing after an answer that finished', () => {
    expect(routeSignals([user(BRIEF), answer('done', 'full')], { productionActive: false }).unfinished).toBeUndefined();
  });
});
