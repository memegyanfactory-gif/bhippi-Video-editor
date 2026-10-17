import { describe, expect, it } from 'vitest';
import { hfDisplayName, hfRepoOf, hfStep } from '../src/lib/hfSteps';
import type { HfAccess, HfStatus } from '../src/lib/modelLibrary';

const signedIn: HfStatus = { signedIn: true, name: 'aayush', fullname: 'Aayush K', avatarPath: null, canReadGated: true, tokenRole: 'read' };
const signedOut: HfStatus = { ...signedIn, signedIn: false, name: '', fullname: '' };
const access = (value: HfAccess['access']): HfAccess => ({ gated: true, access: value, termsUrl: 'https://huggingface.co/a/b' });

describe('hfStep', () => {
  it('waits while the account is unknown', () => expect(hfStep(null, null, 'a/b')).toBe('checking'));
  it('asks for a sign-in when signed out', () => expect(hfStep(signedOut, null, 'a/b')).toBe('sign-in'));
  it('is ready once signed in when there is no repository to check', () => expect(hfStep(signedIn, null, null)).toBe('ready'));
  it('waits for the access answer', () => expect(hfStep(signedIn, null, 'a/b')).toBe('checking'));
  it('maps each access answer to a step', () => {
    expect(hfStep(signedIn, access('granted'), 'a/b')).toBe('ready');
    expect(hfStep(signedIn, access('needs-terms'), 'a/b')).toBe('accept-terms');
    expect(hfStep(signedIn, access('needs-sign-in'), 'a/b')).toBe('sign-in');
    expect(hfStep(signedIn, access('unknown'), 'a/b')).toBe('unknown');
  });
});

describe('hfRepoOf', () => {
  it('reads a model page or file address', () => {
    expect(hfRepoOf('https://huggingface.co/black-forest-labs/FLUX.1-schnell')).toBe('black-forest-labs/FLUX.1-schnell');
    expect(hfRepoOf('https://huggingface.co/a/b/resolve/main/x.gguf')).toBe('a/b');
    expect(hfRepoOf('https://example.com/a/b')).toBeNull();
    expect(hfRepoOf(undefined)).toBeNull();
  });
  it('names the account', () => {
    expect(hfDisplayName(signedIn)).toBe('Aayush K');
    expect(hfDisplayName({ ...signedIn, fullname: '' })).toBe('aayush');
  });
});
