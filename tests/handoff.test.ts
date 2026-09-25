import { describe, expect, it } from 'vitest';
import { handoffFor, historyFor, lastSpeaker, type Turn } from '../src/chat/handoff';

const user = (content: string): Turn => ({ role: 'user', content });

const said = (providerId: string, providerLabel: string, model: string | null, content: string, status = 'done'): Turn => ({
  role: 'assistant',
  providerId,
  providerLabel,
  model,
  content,
  status,
});

const CLAUDE = (content: string, status?: string) => said('claude-code', 'Claude Code', null, content, status);
const GEMINI = (content: string, status?: string) => said('gemini', 'Gemini', 'gemini-3.8-flash', content, status);

describe('handing a conversation to another provider', () => {
  it('names the model being relieved when the picker moves mid-conversation', () => {
    const chat = [user('cut this tighter'), CLAUDE('Trimmed the dead air.')];
    const handoff = handoffFor(chat, 'gemini', 'gemini-3.8-flash');
    expect(handoff).toEqual({ fromLabel: 'Claude Code', fromModel: null });
  });

  it('says nothing when the same provider and model answers again', () => {
    const chat = [user('cut this tighter'), CLAUDE('Trimmed the dead air.')];
    expect(handoffFor(chat, 'claude-code', null)).toBeNull();
  });

  it('treats another model from the same provider as a handover too', () => {
    const chat = [user('again'), said('gemini', 'Gemini', 'gemini-3.8-pro', 'Done.')];
    expect(handoffFor(chat, 'gemini', 'gemini-3.8-flash')).toEqual({
      fromLabel: 'Gemini',
      fromModel: 'gemini-3.8-pro',
    });
  });

  it('starts clean after /clear or in a new conversation', () => {
    // `clear` empties the transcript, and the handover is read from the transcript — so there is
    // nothing to carry and the next turn is a first turn.
    expect(handoffFor([], 'gemini', 'gemini-3.8-flash')).toBeNull();
    expect(lastSpeaker([])).toBeNull();
  });

  it('does not hand over from Bhippi talking to itself', () => {
    // `/compact` recaps and offline command replies are written by the builtin, not by a provider.
    const chat = [user('hi'), said('bhippi', 'Bhippi', null, 'Put the project back.')];
    expect(handoffFor(chat, 'gemini', 'gemini-3.8-flash')).toBeNull();
  });

  it('hands over from the last provider that actually spoke, not the last turn', () => {
    const chat = [user('one'), CLAUDE('First pass done.'), user('two'), GEMINI('', 'error')];
    // Gemini faulted without saying anything, so Claude Code is still the voice being relieved.
    expect(handoffFor(chat, 'gemini', 'gemini-3.8-flash')).toEqual({ fromLabel: 'Claude Code', fromModel: null });
  });
});

describe('the transcript a new provider receives', () => {
  it('attributes the other model and leaves the asking model unnamed', () => {
    const chat = [user('cut this'), CLAUDE('Trimmed it.'), user('now colour it')];
    const lines = historyFor(chat, 'gemini', 'gemini-3.8-flash');
    expect(lines).toEqual([
      { role: 'user', content: 'cut this', speaker: null },
      { role: 'assistant', content: 'Trimmed it.', speaker: 'Claude Code' },
      { role: 'user', content: 'now colour it', speaker: null },
    ]);
    // Asked of Claude Code itself, its own line carries no other name.
    expect(historyFor(chat, 'claude-code', null)[1].speaker).toBeNull();
  });

  it('carries a turn the user cut short, because that is the job being inherited', () => {
    const chat = [user('cut this'), CLAUDE('I trimmed the first half and then', 'stopped')];
    const lines = historyFor(chat, 'gemini', 'gemini-3.8-flash');
    expect(lines).toHaveLength(2);
    expect(lines[1].content).toBe('I trimmed the first half and then');
  });

  it('drops a turn that only faulted, and one still being written', () => {
    const chat = [user('cut this'), CLAUDE('', 'error'), CLAUDE('half a thou', 'streaming')];
    expect(historyFor(chat, 'gemini', 'gemini-3.8-flash')).toEqual([
      { role: 'user', content: 'cut this', speaker: null },
    ]);
  });

  it('keeps only the most recent turns', () => {
    const chat = Array.from({ length: 30 }, (_, i) => user(`message ${i}`));
    const lines = historyFor(chat, 'gemini', 'gemini-3.8-flash');
    expect(lines).toHaveLength(12);
    expect(lines[11].content).toBe('message 29');
  });
});
