import { describe, expect, it } from 'vitest';
import { channelForFormat, describeExport, findFormat, formatForChannel, outputSize, recommendResolution, withExtension, EXPORT_FORMATS } from '../src/lib/exportPresets';
import { newComp } from '../src/lib/timeline';

describe('export presets', () => {
  it('covers five containers with honest blurbs', () => {
    expect(EXPORT_FORMATS.map((format) => format.id)).toEqual(['mp4', 'mov', 'mov-alpha', 'avi', 'mp3']);
    expect(EXPORT_FORMATS.every((format) => format.blurb && format.recommends)).toBe(true);
    expect(findFormat('mov-alpha').alpha).toBe(true);
    expect(findFormat('nope').id).toBe('mp4');
  });

  it('maps the MOV channel choice to the alpha format', () => {
    expect(formatForChannel('rgba')).toBe('mov-alpha');
    expect(formatForChannel('rgb')).toBe('mov');
    expect(channelForFormat('mov-alpha')).toBe('rgba');
    expect(channelForFormat('mov')).toBe('rgb');
    expect(channelForFormat('mp4')).toBeNull();
  });

  it('forces the right extension without doubling it', () => {
    expect(withExtension('reel', 'mp4')).toBe('reel.mp4');
    expect(withExtension('reel.MOV', 'mov')).toBe('reel.MOV');
    expect(withExtension('  ', 'mp3')).toBe('export.mp3');
  });

  it('keeps output dimensions even like the renderer', () => {
    expect(outputSize(1920, 1080, null)).toEqual([1920, 1080]);
    expect(outputSize(1920, 1080, 720)).toEqual([1280, 720]);
    expect(outputSize(1080, 1920, 720)).toEqual([720, 1280]);
  });

  it('recommends like an editor would', () => {
    const wide = newComp({ name: 'Wide', width: 1920, height: 1080, fps: 30 });
    expect(recommendResolution(wide).note).toContain('YouTube');
    const uhd = newComp({ name: 'UHD', width: 3840, height: 2160, fps: 30 });
    expect(recommendResolution(uhd).short).toBe(2160);
    const vertical = newComp({ name: 'Reel', width: 1080, height: 1920, fps: 30 });
    expect(recommendResolution(vertical).note).toContain('Reels');
    expect(describeExport(wide, 'mov-alpha', null, null)).toContain('4444');
  });
});
