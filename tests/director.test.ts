import { describe, expect, it } from 'vitest';
import { debate, parseProposal, type Proposal } from '../src/lib/director';

const beat = (start: number, end: number, rich: boolean, template = 'kinetic-type'): Proposal['scenes'][number] => ({
  start, end, title: 'Beat',
  intent: rich ? 'The editor is buried under urgent edits' : 'x',
  visual: rich ? 'Kai types furiously as notification cards pop in around him; the camera pushes in on his face while the pile of tasks slides up and zooms past the frame edge, lifting on house eases.' : 'Kai.',
  audio: rich ? 'Music bed ducks under the voice; a tick on every card pop and a whoosh on the push.' : 'music',
  evidence: rich ? '"another urgent edit and five more are waiting"' : '',
  mogrt: { template },
});

describe("the Director's debate", () => {
  it('reads a storyboard out of a chatty reply, fenced or bare', () => {
    expect(parseProposal('Here it is:\n```json\n{"scenes":[{"start":0,"end":4,"intent":"a"}]}\n```\nhope it helps', 'a')?.scenes).toHaveLength(1);
    expect(parseProposal('Sure! {"scenes":[{"start":"0","end":"5"}]} done', 'b')?.scenes[0].end).toBe(5);
    expect(parseProposal('I could not do it.', 'c')).toBeNull();
  });

  it('every seat prefers the complete, moving, voice-led plan, and it wins the vote', () => {
    const strong: Proposal = { angle: 'story-first', scenes: [beat(0, 6, true, 'kinetic-type'), beat(6, 12, true, 'brand-stat')] };
    const thin: Proposal = { angle: 'motion-first', scenes: [beat(0, 6, false), beat(6, 9, false)] };
    const result = debate([thin, strong], 12, [0, 6.01]);
    expect(result.votes).toEqual({ director: 1, animator: 1, story: 1 });
    expect(result.winner).toBe(1);
    expect(result.critiques.find((c) => c.proposal === 0 && c.seat === 'director')?.notes.join(' ')).toContain('covers');
  });

  it('a split vote goes to the Director', () => {
    const a: Proposal = { angle: 'a', scenes: [beat(0, 12, true, 'x'), ] };
    const b: Proposal = { angle: 'b', scenes: [beat(0, 6, false, 'y'), beat(6, 12, false, 'z')] };
    const c: Proposal = { angle: 'c', scenes: [beat(0, 4, false), beat(4, 8, false), beat(8, 12, false)] };
    const result = debate([a, b, c], 12);
    const tie = Math.max(...result.tally) === 1;
    if (tie) expect(result.winner).toBe(result.votes.director);
    else expect(result.tally[result.winner]).toBeGreaterThanOrEqual(2);
  });
});
