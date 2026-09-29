import { beforeEach, describe, expect, it, vi } from 'vitest';

const written: { dir: string; index: number; width: number; height: number }[] = [];
vi.mock('../src/lib/ipc', () => ({ api: { mogrtFramesBegin: vi.fn(async (id: string) => `frames/${id}`) }, fileSrc: (p: string) => p }));
vi.mock('../src/lib/pngEncoder', () => ({
  openFrameWriter: vi.fn(async (dir: string) => ({
    pixels: async (index: number, width: number, height: number) => { written.push({ dir, index, width, height }); },
    finish: async () => undefined,
    close: async () => undefined,
  })),
}));

import { fiwnCaptionsForExport, renderFiwnCaptionsForExport } from '../src/lib/fiwn/export';
import { newClip, newProject, textSource, tracksOf } from '../src/lib/timeline';
import type { Project } from '../src/lib/types';

/** A 2D canvas that accepts every call (Node has none). */
class FakeCanvas {
  constructor(public width: number, public height: number) {}
  getContext() {
    const state: Record<string | symbol, unknown> = { globalAlpha: 1 };
    return new Proxy(state, {
      get: (target, key) => {
        if (key in target) return target[key];
        if (key === 'measureText') return (text: string) => ({ width: String(text).length * 12 });
        if (key === 'getImageData') return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) });
        if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({ addColorStop() {} });
        return () => undefined;
      },
      set: (target, key, value) => { target[key] = value; return true; },
    });
  }
}

function captioned(look: Project['captionLook']): Project {
  const project = { ...newProject(), captionLook: look };
  const comp = project.comps[0];
  const [, v2] = tracksOf(comp, 'video');
  const caption = newClip({ trackId: v2.id, start: 2, duration: 1, source: textSource('caption', { text: 'make it pop', style: 'hormozi', words: [0, 0.3, 0.6], wordEnds: [0.3, 0.6, 1] }) });
  const title = newClip({ trackId: v2.id, start: 5, duration: 1, source: textSource('title', { text: 'Not a caption' }) });
  return { ...project, comps: [{ ...comp, fps: 30, clips: [caption, title] }] };
}

beforeEach(() => {
  written.length = 0;
  vi.stubGlobal('OffscreenCanvas', FakeCanvas);
});

describe('WatchFIWN captions in the export', () => {
  it('draws each caption to frames across its span and hands them to the exporter as a graphic', async () => {
    const project = captioned('fiwn');
    const compId = project.comps[0].id;
    expect(fiwnCaptionsForExport(project, compId)).toHaveLength(1);
    const out = await renderFiwnCaptionsForExport(project, compId);
    const [caption, title] = out.comps[0].clips;
    expect(caption.source.type).toBe('html');
    expect(caption.source.type === 'html' && caption.source.frames).toMatchObject({ fps: 30, frames: 30, width: 1920, height: 1080 });
    expect(written).toHaveLength(30);
    // Titles are not captions: they keep their own renderer.
    expect(title.source.type).toBe('text');
    // The saved project is untouched.
    expect(project.comps[0].clips[0].source.type).toBe('text');
  });

  it('draws only the frame a still needs', async () => {
    const project = captioned('fiwn');
    await renderFiwnCaptionsForExport(project, project.comps[0].id, { times: [2.5, 9] });
    expect(written.map((frame) => frame.index)).toEqual([15]);
  });

  it('renders only the frames an In→Out export shows', async () => {
    const project = captioned('fiwn');
    const comp = project.comps[0];
    const long = { ...project, comps: [{ ...comp, clips: [{ ...comp.clips[0], start: 0, duration: 10 }] }] };
    const out = await renderFiwnCaptionsForExport(long, comp.id, { range: { start: 8, end: 8.5 } });
    // 8–8.5 s with a second of margin either side is 7–9.5 s: clip frames 210–285 at 30 fps.
    expect(written.map((frame) => frame.index)).toEqual(Array.from({ length: 76 }, (_, i) => 210 + i));
    const [caption] = out.comps[0].clips;
    expect(caption.source.type === 'html' && caption.source.frames?.frames).toBe(286);
  });

  it('draws sharper frames for an export larger than the comp', async () => {
    const project = captioned('fiwn');
    const out = await renderFiwnCaptionsForExport(project, project.comps[0].id, { scale: 2 });
    const [caption] = out.comps[0].clips;
    expect(caption.source.type === 'html' && caption.source.frames).toMatchObject({ width: 3840, height: 2160 });
  });

  it('leaves projects on the classic look to the burn-in exporter', async () => {
    const project = captioned('classic');
    expect(fiwnCaptionsForExport(project, project.comps[0].id)).toEqual([]);
    expect(await renderFiwnCaptionsForExport(project, project.comps[0].id)).toBe(project);
    expect(written).toEqual([]);
  });
});
