// The badge beside "Bhippi" on each answer says which AI wrote it, so its wording is pinned down.
import { describe, expect, it } from 'vitest';
import { modelChipText, shortModelName } from '../src/lib/modelTiers';

describe('the model chip on an assistant message', () => {
  it('names the provider and the model without the vendor prefix or context suffix', () => {
    expect(modelChipText('Claude Code', 'claude-opus-5-5[1m]')).toBe('Claude Code · Opus 5.5');
    expect(modelChipText('Claude Code', 'claude-sonnet-5-5-20261001')).toBe('Claude Code · Sonnet 5.5');
  });
  it('falls back to the provider when the model is not known', () => {
    expect(modelChipText('Claude Code', null)).toBe('Claude Code');
    expect(modelChipText('Codex CLI', '  ')).toBe('Codex CLI');
  });
  it('keeps GPT and Gemini names whole', () => {
    expect(modelChipText('Codex CLI', 'gpt-5.1-codex')).toBe('Codex CLI · GPT 5.1 Codex');
    expect(shortModelName('gemini-2.5-pro')).toBe('Gemini 2.5 Pro');
    expect(shortModelName('opus')).toBe('Opus');
  });
  it('says nothing when there is nothing to say', () => {
    expect(modelChipText(undefined, null)).toBeNull();
    expect(modelChipText('Bhippi', null)).toBeNull();
  });
});
