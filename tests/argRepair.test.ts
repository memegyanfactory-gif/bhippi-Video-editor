import { describe, expect, it } from 'vitest';
import { repairArgs, repairValue } from '../src/lib/argRepair';

describe('tool arguments mended against the schema', () => {
  it('turns the numbers a weak model quoted back into numbers, deep inside arrays', () => {
    expect(repairArgs('animate_character', { clipId: 'c1', actions: [{ do: 'wave', t: '0.2', duration: '1' }], replace: 'true' })).toEqual({
      clipId: 'c1', actions: [{ do: 'wave', t: 0.2, duration: 1 }], replace: true,
    });
    expect(repairArgs('create_character', { character: 'Kai', at: ['660', '975'], height: '540' })).toEqual({ character: 'Kai', at: [660, 975], height: 540 });
  });

  it('parses an array or object sent as a JSON string, and a whole call sent as one', () => {
    expect(repairArgs('animate_character', { clipId: 'c1', actions: '[{"do":"hop","t":"2"}]' })).toEqual({ clipId: 'c1', actions: [{ do: 'hop', t: 2 }] });
    expect(repairArgs('animate_character', '{"clipId":"c1","actions":[{"do":"nod","t":1}]}')).toEqual({ clipId: 'c1', actions: [{ do: 'nod', t: 1 }] });
  });

  it('matches an enum without regard to case and wraps a lone value into a list', () => {
    expect(repairArgs('animate_character', { clipId: 'c1', actions: { do: 'Celebrate', t: 3 } })).toEqual({ clipId: 'c1', actions: [{ do: 'celebrate', t: 3 }] });
  });

  it('leaves a call that already fits exactly as it was, and unknown tools alone', () => {
    const good = { clipId: 'c1', layerId: 'char-kai', actions: [{ do: 'wave', t: 0.2, hand: 'left' }] };
    expect(repairArgs('animate_character', good)).toEqual(good);
    expect(repairArgs('no_such_tool', { t: '1' })).toEqual({ t: '1' });
    expect(repairValue('hello', { type: 'number' })).toBe('hello');
    expect(repairValue('12abc', { type: 'number' })).toBe('12abc');
  });

  it('never turns text into a number where the schema wants text', () => {
    expect(repairValue('1', { type: 'string' })).toBe('1');
    expect(repairValue(1, { type: 'string' })).toBe('1');
  });
});
