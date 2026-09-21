import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/lib/ipc', () => ({
  api: {},
  errorText: (e: unknown) => String(e),
  fileSrc: (p: string) => `asset://${p}`,
}));
vi.mock('../src/lib/sfx', () => ({ playSfx: vi.fn() }));
import React from 'react';
import { renderToString } from 'react-dom/server';
import { EntryThumb, type BinEntry } from '../src/panels/ProjectPanel';
import type { Asset } from '../src/lib/types';

function videoAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: 'vid',
    name: 'what i do.mp4',
    path: 'C:/vid/what i do.mp4',
    kind: 'video',
    duration: 76.5,
    width: 1920,
    height: 1080,
    fps: 30,
    hasAudio: true,
    size: 1024,
    thumbnail: null,
    filmstrip: null,
    waveform: null,
    preview: 'native',
    ...overrides,
  } as Asset;
}

const mediaEntry = (asset: Asset | undefined, offline = false): BinEntry => ({
  type: 'media',
  id: 'vid',
  name: 'what i do.mp4',
  asset,
  offline,
});

describe('EntryThumb', () => {
  it('shows the derived thumbnail image when one exists', () => {
    const html = renderToString(
      React.createElement(EntryThumb, { entry: mediaEntry(videoAsset({ thumbnail: 'C:/thumbs/vid.jpg' })) }),
    );
    expect(html).toContain('<img');
    expect(html).not.toContain('<svg');
  });

  it('falls back to the kind icon when no thumbnail was derived yet', () => {
    const html = renderToString(
      React.createElement(EntryThumb, { entry: mediaEntry(videoAsset()) }),
    );
    expect(html).not.toContain('<img');
    expect(html).toContain('<svg');
  });

  it('falls back to the kind icon for an offline entry', () => {
    const html = renderToString(
      React.createElement(EntryThumb, { entry: mediaEntry(undefined, true) }),
    );
    expect(html).not.toContain('<img');
    expect(html).toContain('<svg');
  });

  it('shows the audio waveform image when that is all there is', () => {
    const audio = { ...videoAsset({ kind: 'audio', waveform: 'C:/thumbs/vid-wave.png' }), kind: 'audio' as const };
    const html = renderToString(React.createElement(EntryThumb, { entry: mediaEntry(audio) }));
    expect(html).toContain('<img');
    expect(html).toContain('wave');
  });
});
