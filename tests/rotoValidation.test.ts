import { expect, it } from 'vitest';
import { validateRotoResult } from '../src/lib/rotoValidation';
const result = (covers: number[]) => ({ frames: covers.length, matte: 'mask.mkv', subjects: covers.map((cover, at) => ({ at, x: 0, y: 0, width: 1, height: 1, cover })) });
it('rejects empty and full-frame masks instead of claiming a cutout', () => {
  expect(() => validateRotoResult(result([0, 0]))).toThrow('did not find');
  expect(() => validateRotoResult(result([1, 1]))).toThrow('entire frame');
});
it('allows subject absence followed by re-entry', () => {
  expect(() => validateRotoResult(result([.2, 0, .3]))).not.toThrow();
});
it('refuses incomplete or invalid inference output', () => {
  expect(() => validateRotoResult({ ...result([.2]), frames: 3 })).toThrow('incomplete');
  expect(() => validateRotoResult(result([NaN]))).toThrow('invalid');
});
