import { describe, expect, it } from 'vitest';
import { bakeGrade, compileGrade, evalCurve, gradeNeeds3D, puckOf, sampleLut, wheelFromPuck, GRADE_LUT_SIZE, type ColorParams } from '../src/lib/colorGrade';
import { BUILTIN_LUTS, decodeLut, encodeLut, importCube, parseCube, resolveLut, syncProjectLuts, lutToCube } from '../src/lib/luts';
import { createAppliedEffect, gradeFirst } from '../src/lib/effectFilters';
import { EFFECT_MAP } from '../src/lib/effectsCatalog';
import { prepareEffectExport } from '../src/lib/effectExport';
import { autoBalance, colorStats, describeStats } from '../src/lib/colorScopes';
import { asksForLut } from '../src/lib/turnPrompts';
import { runColorTool } from '../src/lib/colorTools';
import { newClip, newComp } from '../src/lib/timeline';
import type { AppliedEffect, Project } from '../src/lib/types';

const grade = (params: ColorParams, rgb: [number, number, number]) => {
  const out = [0, 0, 0];
  compileGrade(params, resolveLut).apply(rgb[0], rgb[1], rgb[2], out);
  return out;
};
const studio = (params: ColorParams = {}): AppliedEffect => {
  const fx = createAppliedEffect(EFFECT_MAP.get('lumetri-color')!);
  return { ...fx, params: { ...fx.params, ...params } };
};
const saturationOf = ([r, g, b]: number[]) => Math.max(r, g, b) - Math.min(r, g, b);

/** A tiny RGBA image of solid colours, for the statistics. */
const image = (pixels: [number, number, number][]): ImageData => {
  const data = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach(([r, g, b], i) => { data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = 255; });
  return { data, width: pixels.length, height: 1, colorSpace: 'srgb' } as ImageData;
};

describe('the Color Studio grade', () => {
  it('starts neutral: a new grade bakes to the identity', () => {
    const fx = studio();
    expect(gradeNeeds3D(fx.params)).toBe(false);
    const lut = bakeGrade(fx.params);
    expect(lut.size).toBe(GRADE_LUT_SIZE);
    let worst = 0;
    for (let b = 0; b < lut.size; b += 4) for (let g = 0; g < lut.size; g += 4) for (let r = 0; r < lut.size; r += 4) {
      const k = (r + g * lut.size + b * lut.size * lut.size) * 3;
      worst = Math.max(worst, Math.abs(lut.data[k] - r / (lut.size - 1)), Math.abs(lut.data[k + 1] - g / (lut.size - 1)), Math.abs(lut.data[k + 2] - b / (lut.size - 1)));
    }
    expect(worst).toBeLessThan(2e-3);
  });

  it('wheels push colour the way they point and keep their master separate', () => {
    for (const wheel of ['lift', 'gamma', 'gain', 'offset'] as const) {
      const push = wheelFromPuck(wheel, 0.3, -0.4, 0.05);
      const back = puckOf(wheel, push.r, push.g, push.b);
      expect(back.x).toBeCloseTo(0.3, 3);
      expect(back.y).toBeCloseTo(-0.4, 3);
      expect(back.master).toBeCloseTo(0.05, 4);
    }
    // Gain pushed toward blue makes highlights bluer and leaves black black.
    const blue = wheelFromPuck('gain', 1, 0, 0); // +Cb is the blue side of the vectorscope
    const params = { gainR: blue.r, gainG: blue.g, gainB: blue.b };
    const bright = grade(params, [0.8, 0.8, 0.8]);
    expect(bright[2]).toBeGreaterThan(bright[0]);
    expect(grade(params, [0, 0, 0]).every((v) => v < 1e-6)).toBe(true);
    // Lift raises the blacks, gain the whites, offset everything.
    expect(grade({ liftY: 0.1 }, [0, 0, 0])[1]).toBeCloseTo(0.1, 3);
    expect(grade({ gainY: 0.25 }, [0.8, 0.8, 0.8])[1]).toBeCloseTo(1, 3);
    expect(grade({ offsetY: 0.05 }, [0.5, 0.5, 0.5])[1]).toBeCloseTo(0.55, 3);
  });

  it('hue curves and Color Slice move only their own colours', () => {
    const red: [number, number, number] = [0.8, 0.2, 0.2], blue: [number, number, number] = [0.2, 0.3, 0.8], grey: [number, number, number] = [0.5, 0.5, 0.5];
    const lessRed = { hueSat: JSON.stringify([[0, 0.1], [0.167, 0.5], [0.333, 0.5], [0.5, 0.5], [0.667, 0.5], [0.833, 0.5]]) };
    expect(gradeNeeds3D(lessRed)).toBe(true);
    expect(saturationOf(grade(lessRed, red))).toBeLessThan(saturationOf(red) * 0.5);
    expect(saturationOf(grade(lessRed, blue))).toBeCloseTo(saturationOf(blue), 2);
    grade(lessRed, grey).forEach((v) => expect(v).toBeCloseTo(0.5, 3));
    const skin: [number, number, number] = [0.85, 0.62, 0.5];
    const skinUp = { sliceSkinSat: 60 };
    expect(saturationOf(grade(skinUp, skin))).toBeGreaterThan(saturationOf(skin) * 1.2);
    expect(saturationOf(grade(skinUp, blue))).toBeCloseTo(saturationOf(blue), 3);
  });

  it('periodic curves wrap round the colour circle', () => {
    const points: [number, number][] = [[0.1, 0.8], [0.5, 0.5], [0.9, 0.2]];
    expect(evalCurve(points, 0, true)).toBeCloseTo(evalCurve(points, 1, true), 5);
    expect(evalCurve(points, 0.5, true)).toBeCloseTo(0.5, 5);
    expect(evalCurve(points, 0, false)).toBeCloseTo(0.8, 5);
  });

  it('saturation, vibrance and hue work on chroma and keep greys grey', () => {
    grade({ saturation: 180, vibrance: 50, hue: 40 }, [0.3, 0.3, 0.3]).forEach((v) => expect(v).toBeCloseTo(0.3, 3));
    expect(saturationOf(grade({ saturation: 0 }, [0.8, 0.3, 0.2]))).toBeLessThan(1e-3);
    // Vibrance lifts a muted colour more than a vivid one.
    const muted: [number, number, number] = [0.55, 0.5, 0.45], vivid: [number, number, number] = [0.9, 0.2, 0.1];
    const gainMuted = saturationOf(grade({ vibrance: 60 }, muted)) / saturationOf(muted);
    const gainVivid = saturationOf(grade({ vibrance: 60 }, vivid)) / saturationOf(vivid);
    expect(gainMuted).toBeGreaterThan(gainVivid);
  });

  it('the grade goes first in any stack, in preview order as in export', () => {
    const blur = { ...createAppliedEffect(EFFECT_MAP.get('gaussian-blur')!), id: 'blur' };
    const fx = { ...studio(), id: 'grade' };
    expect(gradeFirst([blur, fx]).map((e) => e.id)).toEqual(['grade', 'blur']);
  });
});

describe('LUTs', () => {
  const identityCube = (size: number) => {
    const lines = [`LUT_3D_SIZE ${size}`];
    for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) lines.push(`${r / (size - 1)} ${g / (size - 1)} ${b / (size - 1)}`);
    return lines.join('\n');
  };

  it('reads 3D and 1D .cube files and rejects broken ones', () => {
    const three = parseCube('TITLE "Test"\n' + identityCube(5));
    expect(three.title).toBe('Test');
    expect(three.lut.size).toBe(5);
    const one = parseCube('LUT_1D_SIZE 2\n0 0 0\n1 0.5 1\n');
    const out = [0, 0, 0];
    sampleLut(one.lut, 1, 1, 1, out);
    expect(out[1]).toBeCloseTo(0.5, 3);
    expect(() => parseCube('LUT_3D_SIZE 3\n0 0 0\n')).toThrow(/entries/);
    expect(() => parseCube('hello')).toThrow();
  });

  it('stores LUTs compactly and exactly enough', () => {
    const lut = resolveLut('builtin:teal-orange')!;
    const back = decodeLut(lut.size, encodeLut(lut))!;
    let worst = 0;
    for (let i = 0; i < lut.data.length; i++) worst = Math.max(worst, Math.abs(back.data[i] - lut.data[i]));
    expect(worst).toBeLessThan(1 / 65535 + 1e-9);
    expect(lutToCube(lut)).toContain(`LUT_3D_SIZE ${lut.size}`);
  });

  it('every built-in resolves, and a camera conversion brightens log footage', () => {
    for (const builtin of BUILTIN_LUTS) expect(resolveLut(builtin.id), builtin.id).not.toBeNull();
    // S-Log3 middle grey (code 420/1023) should land near display middle grey.
    const out = [0, 0, 0];
    sampleLut(resolveLut('builtin:slog3-709')!, 420 / 1023, 420 / 1023, 420 / 1023, out);
    expect(out[1]).toBeGreaterThan(0.35);
    expect(out[1]).toBeLessThan(0.55);
  });

  it('applies a project LUT at its intensity, after or before the grade', () => {
    const project = { luts: [importCube(identityCube(3).replace(/\n0 0 0\n/, '\n0.2 0.2 0.2\n'), 'lifted.cube')] } as Project;
    syncProjectLuts(project);
    const id = project.luts![0].id;
    const full = grade({ lutId: id, lutAmount: 100 }, [0, 0, 0]);
    const half = grade({ lutId: id, lutAmount: 50 }, [0, 0, 0]);
    expect(full[0]).toBeCloseTo(0.2, 2);
    expect(half[0]).toBeCloseTo(0.1, 2);
    // Before the grade, a lift of the LUT's black is then crushed by the grade's lift.
    expect(grade({ lutId: id, lutStage: 'input', liftY: -0.25 }, [0, 0, 0])[0]).toBeLessThan(full[0]);
    syncProjectLuts(null);
  });
});

describe('the export gets the same grade', () => {
  const project = (fx: AppliedEffect): Project => {
    const comp = newComp({ name: 'c', width: 64, height: 36, fps: 30 });
    const clip = newClip({ trackId: comp.tracks[0].id, source: { type: 'shape', shape: 'rectangle', sides: 4, fill: '#ffffff', stroke: null, strokeWidth: 0, cornerRadius: 0, width: 64, height: 36 } as never, duration: 1, start: 0 });
    return { version: 3, name: 'p', comps: [{ ...comp, clips: [{ ...clip, appliedEffects: [fx] }] }], items: [], media: [], folders: [], activeCompId: comp.id, openCompIds: [comp.id], captionStyle: null };
  };

  it('bakes the grade the preview samples into the export params', () => {
    const fx = studio({ gainB: 0.1, sliceGreenSat: -40 });
    const prepared = prepareEffectExport(project(fx));
    const params = prepared.comps[0].clips[0].appliedEffects![0].params;
    expect(params._lutSize).toBe(GRADE_LUT_SIZE);
    const decoded = decodeLut(GRADE_LUT_SIZE, String(params._exportLut3d))!;
    const baked = bakeGrade(fx.params, resolveLut);
    let worst = 0;
    for (let i = 0; i < baked.data.length; i++) worst = Math.max(worst, Math.abs(decoded.data[i] - baked.data[i]));
    expect(worst).toBeLessThan(1e-4);
  });

  it('stops on a LUT that is not in the project', () => {
    expect(() => prepareEffectExport(project(studio({ lutId: 'lut-gone' })))).toThrow(/LUT/);
  });
});

describe('scopes and statistics', () => {
  it('reads levels, clipping and a colour cast', () => {
    const stats = colorStats(image([[255, 255, 255], [250, 250, 250], [120, 120, 150], [110, 110, 140], [10, 10, 10]]));
    expect(stats.clipped.white).toBeCloseTo(0.2, 3);
    expect(stats.cast.b).toBeGreaterThan(0);
    expect(describeStats(stats).join(' ')).toMatch(/clip/);
  });

  it('auto balance sets black and white points and cancels a cast', () => {
    const pixels: [number, number, number][] = [];
    for (let i = 0; i < 200; i++) { const v = 40 + i; pixels.push([Math.min(255, v), Math.min(255, v), Math.min(255, v + 25)]); }
    const params = autoBalance(image(pixels));
    expect(params.liftY).toBeLessThan(0);
    expect(params.gainB).toBeLessThan(params.gainR);
  });
});

describe('Bhippi AI and LUTs', () => {
  it('only treats a message that asks for a LUT as asking for one', () => {
    expect(asksForLut('color correct this clip properly')).toBe(false);
    expect(asksForLut('put the teal and orange LUT on it')).toBe(true);
    expect(asksForLut('use my FilmLook.cube at 50%')).toBe(true);
    expect(asksForLut('apply a look-up table')).toBe(true);
  });

  it('refuses a LUT the user did not ask for, and applies one they did', async () => {
    const comp = newComp({ name: 'c', width: 64, height: 36, fps: 30 });
    const clip = newClip({ trackId: comp.tracks[0].id, source: { type: 'media', assetId: 'a' }, duration: 2, start: 0 });
    let state: Project = { version: 3, name: 'p', comps: [{ ...comp, clips: [clip] }], items: [], media: [], folders: [], activeCompId: comp.id, openCompIds: [comp.id], captionStyle: null };
    const ctx = (prompt: string) => ({
      project: state, assets: new Map(), prompt,
      commit: (change: (current: Project) => Project) => { state = change(state); },
      current: () => state,
      pickComp: () => state.comps[0],
    });
    const refused = await runColorTool('color_grade', { clipId: clip.id, params: { lutId: 'builtin:teal-orange' } }, ctx('make it cinematic'));
    expect(refused.ok).toBe(false);
    const graded = await runColorTool('color_grade', { clipId: clip.id, params: { contrast: 12, gainB: 0.03 } }, ctx('make it cinematic'));
    expect(graded.ok).toBe(true);
    expect(state.comps[0].clips[0].appliedEffects?.[0].effectId).toBe('lumetri-color');
    const withLut = await runColorTool('color_grade', { clipId: clip.id, params: { lutId: 'builtin:teal-orange', lutAmount: 60 } }, ctx('add the teal orange LUT at 60%'));
    expect(withLut.ok).toBe(true);
    const params = state.comps[0].clips[0].appliedEffects![0].params;
    expect(params.lutId).toBe('builtin:teal-orange');
    expect(params.contrast).toBe(12);
    // Replacing the grade later keeps the user's LUT when the user did not bring LUTs up.
    await runColorTool('color_grade', { clipId: clip.id, mode: 'replace', params: { saturation: 90 } }, ctx('less saturated please'));
    const after = state.comps[0].clips[0].appliedEffects![0].params;
    expect(after.lutId).toBe('builtin:teal-orange');
    expect(after.contrast).toBe(0);
    expect(after.saturation).toBe(90);
    const bad = await runColorTool('color_grade', { clipId: clip.id, params: { contrast: 500 } }, ctx(''));
    expect(bad.ok).toBe(false);
  });
});
