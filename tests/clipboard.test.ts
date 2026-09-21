import { describe, expect, it } from 'vitest';
import { copyText } from '../src/lib/clipboard';

describe('copyText', () => {
  it('never throws and never claims a copy it did not make', async () => {
    await expect(copyText('')).resolves.toBe(false);
    // Node test env has no clipboard and no DOM: must resolve false, not throw.
    await expect(copyText('paste me')).resolves.toBe(false);
  });
});
