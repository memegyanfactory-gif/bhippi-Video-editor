import { describe, expect, it } from 'vitest';
import { addLearnings, forgetSource, learnedValue, learningsBrief, updateLearning, type TrainedKit } from '../src/lib/brandKit/learnings';

const kit = { id: 'k', name: 'Unlok', updatedAt: '' } as unknown as TrainedKit;
const at = '2026-09-29T10:00:00.000Z';

describe('brand kit learnings', () => {
  it('adds what a reference taught, with its source', () => {
    const { kit: trained, added, sourceId } = addLearnings(kit, { kind: 'link', label: 'youtube.com/watch?v=1' }, [
      { area: 'pacing', text: 'Cuts every 1.5–2 seconds, faster in the hook', value: { cutEvery: 1.8 } },
      { area: 'color', text: 'Near-black backgrounds with one electric lime accent', value: { palette: ['#0B0B0F', '#B7FF19'] } },
    ], at);
    expect(added).toBe(2);
    expect(trained.sources?.map((source) => source.id)).toEqual([sourceId]);
    expect(trained.learnings?.every((learning) => learning.sourceIds[0] === sourceId)).toBe(true);
  });

  it('strengthens a rule when another reference says the same, instead of repeating it', () => {
    const first = addLearnings(kit, { kind: 'link', label: 'a' }, [{ area: 'type', text: 'Bold condensed uppercase headlines, tight tracking' }], at).kit;
    const second = addLearnings(first, { kind: 'video', label: 'b' }, [{ area: 'type', text: 'Headlines in bold condensed uppercase with tight tracking' }], at);
    expect(second.strengthened).toBe(1);
    expect(second.kit.learnings).toHaveLength(1);
    expect(second.kit.learnings?.[0].sourceIds).toHaveLength(2);
    expect(second.kit.learnings?.[0].confidence).toBeGreaterThan(first.learnings![0].confidence);
    expect(learningsBrief(second.kit)[0]).toContain('2 references agree');
  });

  it('replaces an older measured value, keeping it in history', () => {
    const first = addLearnings(kit, { kind: 'link', label: 'a' }, [{ area: 'pacing', text: 'Slow, 4 second shots', value: { cutEvery: 4 } }], at).kit;
    const second = addLearnings(first, { kind: 'link', label: 'b' }, [{ area: 'pacing', text: 'Snappy 1.2 second cuts', value: { cutEvery: 1.2 } }], at);
    expect(second.replaced).toBe(1);
    expect(learnedValue(second.kit, 'pacing', 'cutEvery')).toBe(1.2);
    expect(second.kit.learningHistory?.[0].value?.cutEvery).toBe(4);
  });

  it('caps each area, dropping the least confident', () => {
    const rules = ['Open with the product', 'Show faces early', 'Keep logos small', 'Use real customers', 'End on a question', 'Subtitle every word', 'Prefer daylight footage', 'Avoid stock handshakes', 'Name the price', 'Film vertical first', 'Keep music optimistic', 'Credit every source'];
    const many = rules.map((text, i) => ({ area: 'do' as const, text, confidence: (i + 1) / 12 }));
    const trained = addLearnings(kit, { kind: 'file', label: 'x' }, many, at).kit;
    expect(trained.learnings).toHaveLength(8);
    expect(Math.min(...trained.learnings!.map((learning) => learning.confidence))).toBeGreaterThanOrEqual(5 / 12);
  });

  it('undoes one training and switches learnings off', () => {
    const one = addLearnings(kit, { kind: 'link', label: 'a' }, [{ area: 'voice', text: 'Short confident sentences, no jargon' }], at);
    const two = addLearnings(one.kit, { kind: 'link', label: 'b' }, [{ area: 'voice', text: 'Short, confident sentences and no jargon' }, { area: 'audio', text: 'Punchy bass-heavy music beds' }], at);
    const forgotten = forgetSource(two.kit, two.sourceId);
    expect(forgotten.learnings?.map((learning) => learning.area)).toEqual(['voice']);
    const off = updateLearning(forgotten, forgotten.learnings![0].id, { status: 'off' });
    expect(learningsBrief(off)).toEqual([]);
  });
});
