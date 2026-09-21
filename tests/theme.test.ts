import { describe, expect, it } from 'vitest';
import { resolveTheme } from '../src/lib/theme';

describe('color theme resolution', () => {
  it('defaults unless minimal is explicitly chosen', () => {
    expect(resolveTheme(null)).toBe('default');
    expect(resolveTheme(undefined)).toBe('default');
    expect(resolveTheme({ theme: null })).toBe('default');
    expect(resolveTheme({ theme: 'default' })).toBe('default');
    expect(resolveTheme({ theme: 'neon' })).toBe('default');
  });
  it('selects the minimalist theme on explicit choice', () => {
    expect(resolveTheme({ theme: 'minimal' })).toBe('minimal');
  });
});
