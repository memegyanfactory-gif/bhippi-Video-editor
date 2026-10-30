import { describe, expect, it } from 'vitest';
import { advanceChain, autoLead, freshChain, isAutomatic, MAX_AUTO_CONTINUES, nextAutoStep, type TurnEnd } from '../src/chat/autoContinue';
import { workflowAtStart } from '../src/chat/ChatPanel';

const edit = { status: 'done', changedProject: true };
const read = { status: 'done', changedProject: false };
const failed = { status: 'failed', changedProject: false };

const end = (over: Partial<TurnEnd>): TurnEnd => ({ stopped: false, faultKind: null, cutShort: null, runs: [], workflow: null, ...over });

describe('a turn that ended before the job was done carries on by itself', () => {
  it('a turn a budget cut short carries on when any call worked, in any workflow', () => {
    expect(nextAutoStep(end({ cutShort: 'output', runs: [read] }), freshChain())).toBe('cut-short');
    expect(nextAutoStep(end({ cutShort: 'rounds', runs: [edit], workflow: { mode: 'quick' } }), freshChain())).toBe('cut-short');
    // Nothing worked: another round would only repeat it.
    expect(nextAutoStep(end({ cutShort: 'output', runs: [failed] }), freshChain())).toBeNull();
    expect(nextAutoStep(end({ cutShort: 'output' }), freshChain())).toBeNull();
  });

  it('a Full edit that changed the timeline but was never verified gets a finishing round', () => {
    const workflow = { mode: 'full', phase: 'editing', structurallyVerified: false };
    expect(nextAutoStep(end({ runs: [edit], workflow }), freshChain())).toBe('finish');
    expect(nextAutoStep(end({ runs: [edit], workflow: { ...workflow, phase: null } }), freshChain())).toBe('finish');
    // Verified, read-only, a Quick edit, or a plan turn (it ends at the user's button): no.
    expect(nextAutoStep(end({ runs: [edit], workflow: { ...workflow, structurallyVerified: true } }), freshChain())).toBeNull();
    expect(nextAutoStep(end({ runs: [read], workflow }), freshChain())).toBeNull();
    expect(nextAutoStep(end({ runs: [edit], workflow: { ...workflow, mode: 'quick' } }), freshChain())).toBeNull();
    expect(nextAutoStep(end({ runs: [edit], workflow: { ...workflow, phase: 'plan-ready' } }), freshChain())).toBeNull();
  });

  it('a gather turn with shots pending carries on while it gets calls through', () => {
    const workflow = { mode: 'full', phase: 'gathering', gather: { ready: 2, total: 5, pending: ['shot 3', 'shot 4', 'shot 5'] } };
    expect(nextAutoStep(end({ runs: [read], workflow }), freshChain())).toBe('gather');
    expect(nextAutoStep(end({ runs: [failed], workflow }), freshChain())).toBeNull();
    expect(nextAutoStep(end({ runs: [read], workflow: { ...workflow, gather: { ready: 5, total: 5, pending: [] } } }), freshChain())).toBeNull();
  });

  it('a dropped connection is retried once; other faults and a stop wait for the person', () => {
    expect(nextAutoStep(end({ faultKind: 'network' }), freshChain())).toBe('retry');
    expect(nextAutoStep(end({ faultKind: 'timeout', runs: [edit] }), freshChain())).toBe('retry');
    expect(nextAutoStep(end({ faultKind: 'network' }), advanceChain(freshChain(), 'retry'))).toBeNull();
    expect(nextAutoStep(end({ faultKind: 'rate_limited_weekly' }), freshChain())).toBeNull();
    expect(nextAutoStep(end({ faultKind: 'unauthenticated' }), freshChain())).toBeNull();
    expect(nextAutoStep(end({ stopped: true, cutShort: 'rounds', runs: [edit] }), freshChain())).toBeNull();
  });

  it('is bounded: after the automatic budget the Continue button is the fail-safe', () => {
    let chain = freshChain();
    const turn = end({ cutShort: 'output', runs: [edit] });
    let sent = 0;
    for (let round = 0; round < 10; round++) {
      const kind = nextAutoStep(turn, chain);
      if (!kind) break;
      chain = advanceChain(chain, kind);
      sent++;
    }
    expect(sent).toBe(MAX_AUTO_CONTINUES);
  });

  it('says what happened, and its messages are known as automatic', () => {
    expect(autoLead('cut-short', { faultKind: null, cutShort: 'rounds' })).toContain('round limit');
    expect(autoLead('cut-short', { faultKind: null, cutShort: 'output' })).toContain('output limit');
    expect(autoLead('retry', { faultKind: 'timeout', cutShort: null })).toContain('timeout');
    for (const kind of ['retry', 'cut-short', 'finish', 'gather'] as const) expect(isAutomatic(autoLead(kind, { faultKind: null, cutShort: null }))).toBe(true);
    expect(isAutomatic('Continue the EDIT/POLISH phase only.')).toBe(false);
  });
});

describe('the workflow status a turn starts from', () => {
  it('keeps what steers the first move and drops what says nothing', () => {
    const status = {
      mode: 'full', phase: 'gathering', nextUserAction: null, gather: { ready: 1, total: 2, pending: ['shot 2'] },
      transcriptPending: [], frameReviewPending: [{ clipId: 'c1', reviewed: 0, total: 6 }], blueprintActive: false,
      pendingJobs: [], frameSizeNeeded: false, successfulActions: ['get_comp'], judge: { score: null },
    };
    expect(workflowAtStart(status)).toEqual({ phase: 'gathering', gather: { ready: 1, total: 2, pending: ['shot 2'] }, frameReviewPending: ['c1'] });
    expect(workflowAtStart(null)).toBeNull();
  });
});
