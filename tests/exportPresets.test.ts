import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  applyPreset, BUILT_IN_PRESETS, channelForFormat, describeExport, estimateBytes, findFormat, formatBytes, formatForChannel, matchesPreset, outputSize, recommendResolution, toOptions, withExtension, EXPORT_FORMATS,
} from '../src/lib/exportPresets';
import { newComp } from '../src/lib/timeline';

describe('export presets', () => {
  it('lists exactly the formats the renderer writes, with honest blurbs', () => {
    // render/codec.rs FORMATS is the other half of the catalogue.
    const rust = readFileSync('src-tauri/src/render/codec.rs', 'utf8');
    const listed = /pub const FORMATS: \[&str; \d+\] = \[([^\]]+)\]/.exec(rust)?.[1].match(/"([^"]+)"/g)?.map((id) => id.slice(1, -1)) ?? [];
    expect([...EXPORT_FORMATS.map((format) => format.id)].sort()).toEqual([...listed].sort());
    for (const format of EXPORT_FORMATS) expect(rust).toContain(`"${format.id}" => ("${format.ext}"`);
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

  it('applies presets over the defaults and notices when they are changed', () => {
    const youtube = BUILT_IN_PRESETS.find((preset) => preset.id === 'youtube-1080')!;
    const settings = applyPreset(youtube.settings);
    expect(settings).toMatchObject({ format: 'mp4', resolution: 1080, rateControl: 'vbr', bitrate: 16, loudness: -14, twoPass: false });
    expect(matchesPreset(settings, youtube.settings)).toBe(true);
    expect(matchesPreset({ ...settings, bitrate: 20 }, youtube.settings)).toBe(false);
    // A mastering format always has a profile; a delivery format never keeps one.
    expect(applyPreset({ format: 'prores' }).profile).toBe('hq');
    expect(applyPreset({ format: 'mp4', profile: 'hq' }).profile).toBeNull();
    // Every preset names a real format.
    for (const preset of BUILT_IN_PRESETS) expect(EXPORT_FORMATS.some((format) => format.id === applyPreset(preset.settings).format)).toBe(true);
  });

  it('sends only what the format uses', () => {
    const wav = toOptions(applyPreset({ format: 'wav', resolution: 1080, rateControl: 'vbr', bitrate: 9, audioBitrate: 320, loudness: -16 }), 'a.wav', 'c', false);
    expect(wav).toMatchObject({ resolution: null, rateControl: 'quality', bitrate: null, audioBitrate: null, loudness: -16 });
    const prores = toOptions(applyPreset({ format: 'prores', bitDepth: 10, keyframeInterval: 2 }), 'a.mov', 'c', false);
    expect(prores).toMatchObject({ profile: 'hq', bitDepth: null, keyframeInterval: null });
    const quality = toOptions(applyPreset({ format: 'mp4', rateControl: 'quality', bitrate: 12, twoPass: true }), 'a.mp4', 'c', true);
    expect(quality).toMatchObject({ bitrate: null, twoPass: false, inToOut: true });
    const webm = toOptions(applyPreset({ format: 'webm', alpha: true }), 'a.webm', 'c', false);
    expect(webm.alpha).toBe(true);
    expect(toOptions(applyPreset({ format: 'mp4', alpha: true }), 'a.mp4', 'c', false).alpha).toBe(false);
  });

  it('estimates sizes in the right ballpark', () => {
    // A minute of 1080p30 VBR 16 Mbit/s + 320k AAC ≈ 122 MB.
    const vbr = estimateBytes(applyPreset({ format: 'mp4', rateControl: 'vbr', bitrate: 16, audioBitrate: 320 }), 1920, 1080, 30, 60);
    expect(vbr / 1e6).toBeCloseTo(122.4, 0);
    // ProRes 422 HQ runs ≈220 Mbit/s at 1080p29.97: ≈1.7 GB a minute with 24-bit PCM.
    const prores = estimateBytes(applyPreset({ format: 'prores', profile: 'hq' }), 1920, 1080, 29.97, 60);
    expect(prores / 1e9).toBeGreaterThan(1.6);
    expect(prores / 1e9).toBeLessThan(1.8);
    // HEVC at the same quality is smaller than H.264.
    const h264 = estimateBytes(applyPreset({ format: 'mp4' }), 1920, 1080, 30, 60);
    expect(estimateBytes(applyPreset({ format: 'hevc' }), 1920, 1080, 30, 60)).toBeLessThan(h264);
    expect(formatBytes(1_700_000_000)).toBe('1.70 GB');
    expect(formatBytes(122_400_000)).toBe('122 MB');
    expect(formatBytes(4_200)).toBe('4 KB');
  });
});
