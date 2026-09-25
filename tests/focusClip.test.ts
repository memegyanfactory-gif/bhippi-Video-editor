import { describe, expect, it } from 'vitest';
import { focusClip } from '../src/lib/timeline';
import type { Comp } from '../src/lib/types';

const clip = (id: string, linkId: string | null = null, groupId: string | null = null) => ({ id, linkId, groupId });
const comp = (clips: ReturnType<typeof clip>[]) => ({ clips } as unknown as Comp);

describe('focusClip', () => {
  const c = comp([clip('v1', 'L1'), clip('a1', 'L1'), clip('v2'), clip('g1', null, 'G'), clip('g2', null, 'G')]);

  it('shows the clicked clip when its linked audio came along', () => {
    expect(focusClip(c, ['v1', 'a1'])?.id).toBe('v1');
    expect(focusClip(c, ['a1', 'v1'])?.id).toBe('a1');
  });
  it('shows a lone clip', () => expect(focusClip(c, ['v2'])?.id).toBe('v2'));
  it('shows the clicked member of a group', () => expect(focusClip(c, ['g2', 'g1'])?.id).toBe('g2'));
  it('has no focus for unrelated clips or nothing', () => {
    expect(focusClip(c, ['v1', 'a1', 'v2'])).toBeUndefined();
    expect(focusClip(c, [])).toBeUndefined();
  });
});
