import { describe, expect, it } from 'vitest';
import { reopened, type ChatMessage } from '../src/chat/ChatPanel';

const answer = (status: 'streaming' | 'done'): ChatMessage => ({
  id: 'a', role: 'assistant', turnId: 't', providerId: 'claude', providerLabel: 'Claude Code', model: 'claude-opus-5-5',
  content: 'Rendering scene 14…', thinking: '', steps: [{ id: 's1', verb: 'run', title: 'python render.py', detail: '', done: false, at: 0 }] as never,
  status, mode: 'full', sessionId: '532fdf93-79d3', notes: [], fault: null, usage: null, elapsedMs: null, limit: null,
});

describe('a turn cut off when the app closed', () => {
  it('reopens as interrupted, with its work, workflow and session kept', () => {
    const item = reopened(answer('streaming'));
    if (item.role !== 'assistant') throw new Error('an answer');
    expect(item.status).toBe('stopped');
    expect(item.content).toBe('Rendering scene 14…');
    expect(item.steps.every((step) => step.done)).toBe(true);
    expect(item.mode).toBe('full');
    expect(item.sessionId).toBe('532fdf93-79d3');
    expect(item.notes.join(' ')).toContain('Continue carries on');
  });

  it('leaves finished answers and the user\'s messages as they were', () => {
    const done = answer('done');
    expect(reopened(done)).toBe(done);
    const user: ChatMessage = { id: 'u', role: 'user', content: 'make the film', at: 0 };
    expect(reopened(user)).toBe(user);
  });
});
