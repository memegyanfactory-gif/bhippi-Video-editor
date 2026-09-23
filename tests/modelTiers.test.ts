import { describe, expect, it } from 'vitest';
import { modelGroup, pickerEntries, speedIndex, speedSteps, tierFamilies, tierOf } from '../src/lib/modelTiers';
import { variantModel } from '../src/lib/modelVariants';

// Lists as the real providers print them on the dev machine (September 2026).
const CLAUDE_CLI = ['opus', 'sonnet', 'haiku', 'fable', 'claude-opus-5-5', 'claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5'];
const GEMINI_CLI = ['pro', 'flash', 'flash-lite', 'gemini-3.1-pro-preview', 'gemini-3-pro-preview', 'gemini-3-flash-preview', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];
const CODEX = ['gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5'];
const ANTIGRAVITY = ['gemini-3.8-flash-high', 'gemini-3.8-flash-medium', 'gemini-3.8-flash-low', 'gemini-3.1-pro-high', 'gemini-3.1-pro-low', 'claude-sonnet-4-6', 'gpt-oss-120b-medium'];

describe('tierOf', () => {
  it('reads the size word and the family around it', () => {
    expect(tierOf('gemini-2.5-flash-lite')).toMatchObject({ family: 'gemini-2.5', label: 'Flash-Lite', rank: 1 });
    expect(tierOf('gemini-2.5-pro')).toMatchObject({ family: 'gemini-2.5', label: 'Pro' });
    expect(tierOf('claude-opus-4-6')).toMatchObject({ family: 'claude-4-6', label: 'Opus' });
    expect(tierOf('gpt-5-mini')).toMatchObject({ family: 'gpt-5', label: 'Mini' });
    expect(tierOf('gpt-5')).toMatchObject({ family: 'gpt-5', label: 'Full', sized: false });
  });

  it('never reads a size out of the middle of a word', () => {
    expect(tierOf('gemini-embedding').sized).toBe(false);
    expect(tierOf('prompt-guard').sized).toBe(false);
  });

  it('ignores an effort suffix when finding the family', () => {
    expect(tierOf('gemini-3.8-flash-high').family).toBe('gemini-3.8');
  });
});

describe('tierFamilies', () => {
  it('groups Gemini Pro · Flash · Flash-Lite fastest first', () => {
    const families = tierFamilies(GEMINI_CLI);
    expect(families.get('gemini-2.5')?.map((step) => step.id)).toEqual(['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-pro']);
    expect(families.get('')?.map((step) => step.id)).toEqual(['flash-lite', 'flash', 'pro']);
    expect(families.get('gemini-3-preview')?.map((step) => step.label)).toEqual(['Flash', 'Pro']);
    // 3.1 comes in one size here, so it is no family.
    expect([...families.keys()].some((key) => key.startsWith('gemini-3.1'))).toBe(false);
  });

  it('orders Claude aliases Haiku · Sonnet · Opus and leaves an unknown family out', () => {
    const steps = tierFamilies(CLAUDE_CLI).get('');
    expect(steps?.map((step) => step.id)).toEqual(['haiku', 'sonnet', 'opus']);
    expect(tierFamilies(CLAUDE_CLI).get('claude-4-6')?.map((step) => step.id)).toEqual(['claude-sonnet-4-6', 'claude-opus-4-6']);
  });

  it("orders Codex's named tiers by what its own catalogue says they are for", () => {
    expect(tierFamilies(CODEX).get('gpt-6')?.map((step) => step.label)).toEqual(['Luna', 'Sol', 'Astra']);
    expect(tierFamilies(CODEX).get('gpt-5.6')?.map((step) => step.label)).toEqual(['Luna', 'Terra', 'Sol']);
  });

  it('joins a full-size model to its smaller siblings', () => {
    expect(tierFamilies(['gpt-5', 'gpt-5-mini', 'gpt-5-nano']).get('gpt-5')?.map((step) => step.id)).toEqual(['gpt-5-nano', 'gpt-5-mini', 'gpt-5']);
  });

  it('never groups two unrelated full-size models', () => {
    expect(tierFamilies(['grok-4.7', 'grok-4.7']).size).toBe(0);
    expect(tierFamilies(['deepseek-chat', 'deepseek-reasoner']).size).toBe(0);
  });
});

describe('speedSteps', () => {
  it("offers the chosen model's family and maps each step to a real id", () => {
    const steps = speedSteps(GEMINI_CLI, 'gemini-2.5-flash');
    expect(steps.map((step) => step.id)).toEqual(['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-pro']);
    expect(speedIndex(steps, 'gemini-2.5-flash')).toBe(1);
    for (const step of steps) expect(GEMINI_CLI).toContain(step.id);
  });

  it('is empty for a model that comes in one size or for the default', () => {
    expect(speedSteps(['grok-4.7'], 'grok-4.7')).toEqual([]);
    expect(speedSteps(GEMINI_CLI, null)).toEqual([]);
  });

  it('keeps effort variants on their own axis', () => {
    // Antigravity's Flash comes in three efforts but only one size.
    expect(speedSteps(ANTIGRAVITY, 'gemini-3.8-flash-high')).toEqual([]);
    expect(variantModel(ANTIGRAVITY, 'gemini-3.8-flash-high', 'low')).toBe('gemini-3.8-flash-low');
  });
});

describe('pickerEntries', () => {
  it('folds each family into one row and keeps single models as they are', () => {
    const entries = pickerEntries(GEMINI_CLI, null);
    const titles = entries.map((entry) => entry.title);
    expect(titles).toContain('gemini-2.5');
    expect(titles).toContain('gemini-3.1-pro-preview');
    expect(entries.length).toBeLessThan(GEMINI_CLI.length);
    const family = entries.find((entry) => entry.title === 'gemini-2.5');
    expect(family?.tiers).toHaveLength(3);
  });

  it('stands a family row for the chosen member', () => {
    const entry = pickerEntries(GEMINI_CLI, 'gemini-2.5-flash-lite').find((item) => item.title === 'gemini-2.5');
    expect(entry?.id).toBe('gemini-2.5-flash-lite');
  });

  it('collapses effort variants and keeps a 389-model list far shorter', () => {
    const entries = pickerEntries(ANTIGRAVITY, null);
    expect(entries.filter((entry) => entry.title === 'gemini-3.8-flash')).toHaveLength(1);
  });

  it('groups ids into sections a person recognises', () => {
    expect(modelGroup('openrouter/~anthropic/claude-opus-latest')).toBe('openrouter · anthropic');
    expect(modelGroup('opencode/big-pickle')).toBe('opencode');
    expect(modelGroup('claude-opus-4-6')).toBe('Claude');
    expect(modelGroup('opus')).toBe('Aliases');
    expect(modelGroup('grok-4.7')).toBe('Grok');
  });
});
