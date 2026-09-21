import { beforeEach, describe, expect, it, vi } from 'vitest';
import { actionLogger } from '../src/lib/actionLogger';

describe('actionLogger', () => {
  beforeEach(() => {
    actionLogger.clear();
  });

  it('records user actions properly', () => {
    actionLogger.user('Clicked split clip', { clipId: 'clip-1', time: 1.5 });
    const logs = actionLogger.getLogs();
    expect(logs.length).toBe(1);
    expect(logs[0].category).toBe('user');
    expect(logs[0].title).toBe('Clicked split clip');
    expect(logs[0].raw).toEqual({ clipId: 'clip-1', time: 1.5 });
  });

  it('records ai actions properly', () => {
    actionLogger.ai('Tool Call: add_clip', { track: 'V1', in: 0 });
    const logs = actionLogger.getLogs();
    expect(logs.length).toBe(1);
    expect(logs[0].category).toBe('ai');
    expect(logs[0].title).toBe('Tool Call: add_clip');
  });

  it('records error actions properly with stringification', () => {
    actionLogger.error('RVM segmentation failed', new Error('CUDA out of memory'));
    const logs = actionLogger.getLogs();
    expect(logs.length).toBe(1);
    expect(logs[0].category).toBe('error');
    expect(logs[0].level).toBe('error');
    expect(logs[0].detail).toContain('CUDA out of memory');
  });

  it('notifies subscribers when actions are logged', () => {
    const subscriber = vi.fn();
    const unsubscribe = actionLogger.subscribe(subscriber);

    // Called once immediately on subscription with current logs
    expect(subscriber).toHaveBeenCalledTimes(1);

    actionLogger.system('Project opened');
    expect(subscriber).toHaveBeenCalledTimes(2);
    expect(subscriber.mock.calls[1][0].length).toBe(1);
    expect(subscriber.mock.calls[1][0][0].title).toBe('Project opened');

    unsubscribe();
    actionLogger.user('Select blade tool');
    // Shouldn't be called after unsubscribe
    expect(subscriber).toHaveBeenCalledTimes(2);
  });

  it('clears logs and notifies subscribers', () => {
    actionLogger.user('Action 1');
    actionLogger.ai('Action 2');
    expect(actionLogger.getLogs().length).toBe(2);

    actionLogger.clear();
    expect(actionLogger.getLogs().length).toBe(0);
  });
});
