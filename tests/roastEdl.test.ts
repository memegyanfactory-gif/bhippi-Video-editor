import { describe, expect, it } from 'vitest';
import { applyEdl, normalizeEvents, validateEdl } from '../src/lib/roast/edl';
import { roastIdOf, traceDna } from '../src/lib/roast/dna';
import { MOVE_KINDS } from '../src/lib/roast/moves';
import { findStyle } from '../src/lib/captionStyles';
import { valueAt } from '../src/lib/keyframes';
import { newClip, newComp, tracksOf, type AssetMap } from '../src/lib/timeline';
import type { Asset, Clip, Comp, Project } from '../src/lib/types';
import type { RoastEdl, RoastEvent, RoastToolContext } from '../src/lib/roast/types';
import { runPlanTool } from '../src/lib/roast/plan';

const asset = (id: string, kind: Asset['kind'], seconds: number, over: Partial<Asset> = {}): Asset => ({
  id, name: `${id}.${kind === 'image' ? 'png' : kind === 'audio' ? 'mp3' : 'mp4'}`, path: `C:/${id}`, kind, duration: seconds, width: 1920, height: 1080, fps: 30, hasAudio: kind !== 'image', videoCodec: 'h264', audioCodec: 'aac',
  size: 1, importedAt: '2026-01-01', thumbnail: null, filmstrip: null, waveform: null, proxy: null, preview: 'native', missing: false, peaks: null, ...over,
});

const assets: AssetMap = new Map([
  asset('host', 'video', 120),
  asset('husky', 'video', 5),
  asset('still', 'image', 0, { width: 1080, height: 1080 }),
  asset('vertical', 'video', 8, { width: 1080, height: 1920 }),
  asset('podcast', 'video', 60),
  asset('person', 'image', 0, { width: 800, height: 1200, name: 'person cutout.png' }),
  asset('bg', 'image', 0),
  asset('sting', 'audio', 20),
  asset('head', 'image', 0, { width: 400, height: 400 }),
].map((item) => [item.id, item]));

/** Host on V1 (0–10 s and 10–30 s) with linked dialogue on A1; the rest of newComp's tracks empty. */
function setup(matte = false): { comp: Comp; project: Project; host: [string, string]; voice: [string, string] } {
  const base = newComp({ name: 'Roast', fps: 30 });
  const [v1] = tracksOf(base, 'video').map((track) => track.id);
  const [a1] = tracksOf(base, 'audio').map((track) => track.id);
  const clips: Clip[] = [];
  for (const [start, duration] of [[0, 10], [10, 20]] as const) {
    const linkId = `l${start}`;
    clips.push(newClip({ trackId: v1, start, duration, in: start, source: { type: 'media', assetId: 'host' }, linkId, ...(matte ? { rotoMatte: 'C:/roto/matte.mp4' } : {}) }));
    clips.push(newClip({ trackId: a1, start, duration, in: start, source: { type: 'media', assetId: 'host' }, linkId }));
  }
  const comp = { ...base, clips };
  const project: Project = { version: 3, name: 'P', comps: [comp], items: [], media: [], folders: [], activeCompId: comp.id, openCompIds: [comp.id], captionStyle: null };
  return { comp, project, host: [clips[0].id, clips[2].id], voice: [clips[1].id, clips[3].id] };
}

const edl = (comp: Comp, events: Partial<RoastEvent>[]): RoastEdl => {
  const normalized = normalizeEvents(events, { assets });
  expect(normalized.errors).toEqual([]);
  return { version: 1, compId: comp.id, style: 'funny', events: normalized.events };
};

const madeBy = (comp: Comp, id: string) => comp.clips.filter((clip) => roastIdOf(clip) === id);
const trackName = (comp: Comp, clip: Clip) => comp.tracks.find((track) => track.id === clip.trackId)?.name;
const trackKind = (comp: Comp, clip: Clip) => comp.tracks.find((track) => track.id === clip.trackId)?.kind;
const videoIndex = (comp: Comp, name: string) => tracksOf(comp, 'video').findIndex((track) => track.name === name);
const sfxOf = (comp: Comp, id: string) => madeBy(comp, id).filter((clip) => trackKind(comp, clip) === 'audio' && trackName(comp, clip) === 'SFX');
const kindOf = (clip: Clip | undefined) => (clip?.source.type === 'sfx' ? clip.source.kind : null);

function apply(events: Partial<RoastEvent>[], matte = false) {
  const { comp, project, host, voice } = setup(matte);
  const result = applyEdl(comp, project, assets, edl(comp, events));
  return { ...result, before: comp, project, host, voice };
}

describe('the moves', () => {
  it('covers every move kind in these tests', () => {
    expect(MOVE_KINDS).toHaveLength(20);
  });

  it('meme_cutaway: a full-frame clip with its own sound on Memes, the host muted under it with 10 ms ramps', () => {
    const { comp, report, voice } = apply([{ move: 'meme_cutaway', assetId: 'husky', at: 4, duration: 2, why: 'he called him a German shepherd' } as Partial<RoastEvent>]);
    expect(report.errors).toEqual([]);
    const made = madeBy(comp, 'e1');
    const picture = made.find((clip) => trackKind(comp, clip) === 'video') as Clip;
    const sound = made.find((clip) => trackKind(comp, clip) === 'audio' && trackName(comp, clip) === 'Memes') as Clip;
    expect(picture).toMatchObject({ start: 4, duration: 2, transform: expect.objectContaining({ fit: 'fill' }) });
    expect(trackName(comp, picture)).toBe('Memes');
    // The empty V2 of a new comp is taken over rather than adding a track.
    expect(videoIndex(comp, 'Memes')).toBe(1);
    expect(sound.linkId).toBe(picture.linkId);
    const dialogue = comp.clips.find((clip) => clip.id === voice[0]) as Clip;
    expect(dialogue.keyframes.volume).toEqual([
      { time: 3.99, value: 1, easing: 'linear' }, { time: 4, value: 0, easing: 'linear' },
      { time: 6, value: 0, easing: 'linear' }, { time: 6.01, value: 1, easing: 'linear' },
    ]);
    // A meme with its own sound needs no SFX.
    expect(sfxOf(comp, 'e1')).toEqual([]);
  });

  it('meme_cutaway: a square still is blur-filled over its own darkened copy, with a boom', () => {
    const { comp, report, voice } = apply([{ move: 'meme_cutaway', assetId: 'still', at: 2, duration: 1.5, why: 'poison echo' } as Partial<RoastEvent>]);
    expect(report.errors).toEqual([]);
    const made = madeBy(comp, 'e1').filter((clip) => trackKind(comp, clip) === 'video');
    const backdrop = made.find((clip) => trackName(comp, clip) === 'Memes BG') as Clip;
    const front = made.find((clip) => trackName(comp, clip) === 'Memes') as Clip;
    expect(backdrop.effects).toMatchObject({ blur: 36, brightness: -28 });
    expect(backdrop.transform.fit).toBe('fill');
    expect(front.transform.fit).toBe('fit');
    expect(videoIndex(comp, 'Memes BG')).toBeLessThan(videoIndex(comp, 'Memes'));
    expect(kindOf(sfxOf(comp, 'e1')[0])).toBe('boom');
    // A silent still does not duck the host.
    expect((comp.clips.find((clip) => clip.id === voice[0]) as Clip).keyframes.volume).toEqual([]);
    expect(report.dna.memes).toBe(1);
  });

  it('meme_cutaway: warns outside 0.6–4 s', () => {
    const { report } = apply([{ move: 'meme_cutaway', assetId: 'vertical', at: 2, duration: 5, why: 'x' } as Partial<RoastEvent>]);
    expect(report.warnings.some((line) => line.includes('0.6–4'))).toBe(true);
  });

  it('receipt: the target’s clip, word-by-word captions, a *NAME label, the host silent', () => {
    const { comp, report, voice } = apply([{
      move: 'receipt', assetId: 'podcast', in: 30, at: 12, duration: 3, why: 'his own words',
      words: [{ text: 'MODI', start: 30.2, end: 30.6 }, { text: 'SE', start: 30.6, end: 30.8 }, { text: 'ACHCHA', start: 30.8, end: 31.4 }], label: 'Dhruv',
    } as Partial<RoastEvent>]);
    expect(report.errors).toEqual([]);
    const text = madeBy(comp, 'e1').filter((clip) => clip.source.type === 'text');
    const captions = text.filter((clip) => clip.source.type === 'text' && clip.source.style === 'roundedPop');
    expect(captions.map((clip) => [clip.start, clip.duration].map((n) => Math.round(n * 100) / 100))).toEqual([[12.2, 0.4], [12.6, 0.2], [12.8, 0.85]]);
    expect(captions.every((clip) => trackName(comp, clip) === 'Roast Text')).toBe(true);
    const label = text.find((clip) => clip.source.type === 'text' && clip.source.style === 'labelStar') as Clip;
    expect(label.source).toMatchObject({ text: '*DHRUV' });
    const picture = madeBy(comp, 'e1').find((clip) => trackName(comp, clip) === 'Memes' && trackKind(comp, clip) === 'video') as Clip;
    expect(picture.in).toBe(30);
    const dialogue = comp.clips.find((clip) => clip.id === voice[1]) as Clip;
    expect(valueAt(dialogue.keyframes.volume, 13 - 10)).toBe(0);
  });

  it('side_cutout: 55 % of the frame tall, bottom-anchored 4 % from the side, sliding in with overshoot and out, with a swish', () => {
    const { comp, report } = apply([{ move: 'side_cutout', assetId: 'person', side: 'left', at: 5, duration: 3, why: 'the producer' } as Partial<RoastEvent>]);
    expect(report.errors).toEqual([]);
    const clip = madeBy(comp, 'e1').find((item) => trackKind(comp, item) === 'video') as Clip;
    expect(trackName(comp, clip)).toBe('Roast Cards');
    // 800×1200 fitted into 1080 p is 1080 px tall at 100 %; 55 % of the frame is 594 px.
    expect(clip.transform.scale).toBeCloseTo(55, 5);
    const width = (800 * 594) / 1200;
    expect(clip.transform.x).toBeCloseTo(-(0.5 - 0.04 - width / 2 / 1920), 5);
    expect(clip.transform.y).toBeCloseTo(0.5 - 594 / 2 / 1080, 5);
    const x = clip.keyframes.x;
    expect(x[0]).toMatchObject({ time: 0, easing: 'overshoot' });
    expect(x[0].value).toBeLessThan(-0.5);
    expect(x[1]).toMatchObject({ time: 0.18 });
    expect(x[2].time).toBeCloseTo(2.85, 5);
    expect(x[3]).toMatchObject({ time: 3, value: x[0].value });
    const swish = sfxOf(comp, 'e1')[0];
    expect(kindOf(swish)).toBe('swish');
    expect(swish.start).toBeCloseTo(4.92, 5);
  });

  it('host_on_bg: refused without a matte; with one, the background goes on a track under the host', () => {
    const refused = apply([{ move: 'host_on_bg', color: '#00FF00', at: 1, duration: 2, why: '' } as Partial<RoastEvent>]);
    expect(refused.report.ok).toBe(false);
    expect(refused.report.errors[0]).toMatch(/roto matte or key/);
    expect(madeBy(refused.comp, 'e1')).toEqual([]);
    const { comp, report, host } = apply([{ move: 'host_on_bg', bgAssetId: 'bg', at: 1, duration: 2, why: '' } as Partial<RoastEvent>], true);
    expect(report.errors).toEqual([]);
    const bg = madeBy(comp, 'e1')[0];
    expect(trackName(comp, bg)).toBe('Roast BG');
    const hostClip = comp.clips.find((clip) => clip.id === host[0]) as Clip;
    const video = tracksOf(comp, 'video');
    expect(video.findIndex((track) => track.id === bg.trackId)).toBe(video.findIndex((track) => track.id === hostClip.trackId) - 1);
    // A keyed host counts as matted too.
    const keyed = setup();
    const withKey = { ...keyed.comp, clips: keyed.comp.clips.map((clip) => (clip.id === keyed.host[0] ? { ...clip, appliedEffects: [{ id: 'k', effectId: 'keylight', name: 'Keylight', category: 'Keying', enabled: true, params: {} }] } : clip)) };
    expect(applyEdl(withKey, keyed.project, assets, edl(withKey, [{ move: 'host_on_bg', color: '#00FF00', at: 1, duration: 2, why: '' } as Partial<RoastEvent>])).report.ok).toBe(true);
  });

  it('keyword_pop: text in the roast style, scale 0 → 108 → 100 over 120 ms, with a pop', () => {
    const { comp, report } = apply([{ move: 'keyword_pop', text: 'HYPOCRISY', style: 'memeImpact', position: 'top', at: 3, duration: 1.2, why: '' } as Partial<RoastEvent>]);
    expect(report.errors).toEqual([]);
    const clip = madeBy(comp, 'e1').find((item) => item.source.type === 'text') as Clip;
    expect(clip.source).toMatchObject({ type: 'text', preset: 'caption', text: 'HYPOCRISY', style: 'memeImpact' });
    expect(trackName(comp, clip)).toBe('Roast Text');
    expect(clip.keyframes.scale.map((key) => [key.time, key.value])).toEqual([[0, 0], [0.06, 108], [0.12, 100]]);
    expect(clip.transform.y).toBeCloseTo(0.2 - (findStyle('memeImpact')?.posY ?? 91) / 100, 5);
    expect(kindOf(sfxOf(comp, 'e1')[0])).toBe('pop');
  });

  it('keyword_pop behind: the text sits between the host and its matted copy', () => {
    const { comp, report } = apply([{ move: 'keyword_pop', text: 'ALRIGHT', style: 'memeImpact', position: 'behind', at: 2, duration: 2, why: '' } as Partial<RoastEvent>], true);
    expect(report.errors).toEqual([]);
    const made = madeBy(comp, 'e1').filter((clip) => trackKind(comp, clip) === 'video');
    const text = made.find((clip) => clip.source.type === 'text') as Clip;
    const front = made.find((clip) => clip.source.type === 'media') as Clip;
    expect(front.rotoMatte).toBe('C:/roto/matte.mp4');
    expect(front).toMatchObject({ start: 2, duration: 2, in: 2, volume: 0 });
    const video = tracksOf(comp, 'video');
    expect(video.findIndex((track) => track.id === front.trackId)).toBeGreaterThan(video.findIndex((track) => track.id === text.trackId));
  });

  it('keyword_pop behind: refused without a matte', () => {
    expect(apply([{ move: 'keyword_pop', text: 'X', style: 'memeImpact', position: 'behind', at: 2, duration: 2, why: '' } as Partial<RoastEvent>]).report.ok).toBe(false);
  });

  it('emoji_pop: a colour html sticker (libass would export the emoji as a flat outline), with a pop', () => {
    const { comp, report } = apply([{ move: 'emoji_pop', emoji: '🫡', at: 6, duration: 1, x: 0.8, y: 0.3, why: '' } as Partial<RoastEvent>]);
    expect(report.errors).toEqual([]);
    const clip = madeBy(comp, 'e1').find((item) => item.source.type === 'html') as Clip;
    expect(clip.source).toMatchObject({ template: 'roast-sticker-badge' });
    const html = (clip.source as { html: string }).html;
    expect(html).toContain('🫡');
    expect(html).toContain('pop em');
    expect(clip.start).toBe(6);
    expect(kindOf(sfxOf(comp, 'e1')[0])).toBe('pop');
  });

  it('sticker, card, title card and CTA: html cards on Roast Cards with swish / ding', () => {
    const { comp, report } = apply([
      { move: 'sticker', text: 'NO HATE', shape: 'heart', at: 1, duration: 2, why: '' },
      { move: 'card', template: 'roast-fact-strip', params: { text: 'runtime 2h 54m' }, at: 4, duration: 3, why: '' },
      { move: 'title_card', text: 'THE REAL REASON', at: 8, duration: 2, why: '' },
      { move: 'cta', text: 'COMMENT DOWN BELOW', at: 20, duration: 3, why: '' },
    ] as Partial<RoastEvent>[]);
    expect(report.errors).toEqual([]);
    for (const [id, sound] of [['e1', 'swish'], ['e2', 'swish'], ['e3', 'swish'], ['e4', 'ding']] as const) {
      const card = madeBy(comp, id).find((clip) => trackKind(comp, clip) === 'video') as Clip;
      expect(card.source.type).toBe('html');
      expect(trackName(comp, card)).toBe('Roast Cards');
      expect(kindOf(sfxOf(comp, id)[0])).toBe(sound);
    }
  });

  it('overlay_fx: the FX template as a motion scene over the span on Roast FX', () => {
    const { comp, report } = apply([{ move: 'overlay_fx', fx: 'fx-money-rain', at: 3, duration: 2.5, why: '' } as Partial<RoastEvent>]);
    expect(report.errors).toEqual([]);
    const clip = madeBy(comp, 'e1')[0];
    expect(clip.source.type).toBe('motion');
    expect(clip).toMatchObject({ start: 3, duration: 2.5 });
    expect(trackName(comp, clip)).toBe('Roast FX');
  });

  it('zoom_punch: snaps to the scale in two frames, holds, and snaps back; slow pushes over the beat', () => {
    const { comp, host } = apply([{ move: 'zoom_punch', scale: 125, at: 12, duration: 1.5, why: '' } as Partial<RoastEvent>]);
    const clip = comp.clips.find((item) => item.id === host[1]) as Clip;
    expect(clip.keyframes.scale.map((key) => [Math.round(key.time * 1000) / 1000, key.value, key.easing])).toEqual([[2, 100, 'ease-out'], [2.067, 125, 'hold'], [3.5, 100, 'linear']]);
    const slow = apply([{ move: 'zoom_punch', scale: 120, ease: 'slow', at: 2, duration: 3, why: '' } as Partial<RoastEvent>]);
    const pushed = slow.comp.clips.find((item) => item.id === slow.host[0]) as Clip;
    expect(pushed.keyframes.scale[0]).toMatchObject({ time: 2, value: 100, easing: 'ease-in-out' });
    expect(pushed.keyframes.scale[1].value).toBe(120);
    // One motion event, in a 30 s comp: 2 a minute.
    expect(traceDna(slow.comp, assets).events.map((event) => [event.start, event.end])).toEqual([[2, 5]]);
    expect(slow.report.dna.eventsPerMinute).toEqual([2]);
  });

  it('shake: seeded jitter over the frames, back to rest, with an impact', () => {
    const run = () => apply([{ id: 'boom1', move: 'shake', intensityPx: 19.2, frames: 4, at: 5, duration: 0.2, why: '' } as Partial<RoastEvent>]);
    const first = run();
    const clip = first.comp.clips.find((item) => item.id === first.host[0]) as Clip;
    expect(clip.keyframes.x).toHaveLength(5);
    expect(clip.keyframes.x[0].time).toBe(5);
    expect(clip.keyframes.x.at(-1)).toMatchObject({ value: 0 });
    expect(Math.max(...clip.keyframes.x.map((key) => Math.abs(key.value)))).toBeLessThanOrEqual(0.01);
    expect(clip.keyframes.scale.length).toBeGreaterThan(0);
    const again = run();
    expect((again.comp.clips.find((item) => item.id === again.host[0]) as Clip).keyframes.x).toEqual(clip.keyframes.x);
    expect(kindOf(sfxOf(first.comp, 'boom1')[0])).toBe('impact');
  });

  it('whip: across the nearest host cut, out to the left and in from the right over 4 frames, with blur and a swish', () => {
    const { comp, report, host } = apply([{ move: 'whip', at: 10.3, duration: 0.15, why: '' } as Partial<RoastEvent>]);
    expect(report.errors).toEqual([]);
    const out = comp.clips.find((clip) => clip.id === host[0]) as Clip;
    const incoming = comp.clips.find((clip) => clip.id === host[1]) as Clip;
    expect(out.keyframes.x.map((key) => [Math.round(key.time * 1000) / 1000, key.value])).toEqual([[9.933, 0], [10, -0.6]]);
    expect(incoming.keyframes.x.map((key) => [Math.round(key.time * 1000) / 1000, key.value])).toEqual([[0, 0.6], [0.067, 0]]);
    expect(comp.transitions).toHaveLength(1);
    expect(comp.transitions[0]).toMatchObject({ kind: 'cross-zoom', fromClip: host[0], toClip: host[1] });
    expect(kindOf(sfxOf(comp, 'e1')[0])).toBe('swish');
    expect(apply([{ move: 'whip', at: 25, duration: 0.15, why: '' } as Partial<RoastEvent>]).report.ok).toBe(false);
  });

  it('bw_freeze: a desaturated, frozen copy of the host over the beat, with a scratch', () => {
    const { comp, report, host } = apply([{ move: 'bw_freeze', freeze: true, at: 14, duration: 2, why: '' } as Partial<RoastEvent>]);
    expect(report.errors).toEqual([]);
    const copy = madeBy(comp, 'e1').find((clip) => trackKind(comp, clip) === 'video') as Clip;
    expect(copy).toMatchObject({ start: 14, duration: 2, hold: 14, volume: 0 });
    expect(copy.effects.saturation).toBe(0);
    expect(trackName(comp, copy)).toBe('Roast Grade');
    // The host itself is untouched.
    const hostClip = comp.clips.find((clip) => clip.id === host[1]) as Clip;
    expect(hostClip).toMatchObject({ start: 10, duration: 20, hold: null });
    expect(hostClip.effects.saturation).toBe(100);
    expect(kindOf(sfxOf(comp, 'e1')[0])).toBe('scratch');
  });

  it('label and head_paste follow their paths', () => {
    const { comp, report } = apply([
      { move: 'label', text: '*DHRUV', at: 2, duration: 2, path: [{ t: 0, x: 0.3, y: 0.4 }, { t: 2, x: 0.6, y: 0.4 }], why: '' },
      { move: 'head_paste', headAssetId: 'head', at: 5, duration: 2, path: [{ t: 0, x: 0.5, y: 0.3, scale: 0.25 }, { t: 1, x: 0.55, y: 0.32, scale: 0.3, rotation: 5 }], why: '' },
    ] as Partial<RoastEvent>[]);
    expect(report.errors).toEqual([]);
    const label = madeBy(comp, 'e1')[0];
    expect(label.source).toMatchObject({ style: 'labelStar', text: '*DHRUV' });
    expect(label.keyframes.x.map((key) => [key.time, Math.round(key.value * 1000) / 1000])).toEqual([[0, -0.2], [2, 0.1]]);
    const head = madeBy(comp, 'e2').find((clip) => clip.source.type === 'media') as Clip;
    expect(trackName(comp, head)).toBe('Roast Cards');
    // 400×400 fitted into 1080 p is 1080 px tall; a head a quarter of the frame is 25 %.
    expect(head.keyframes.scale.map((key) => key.value)).toEqual([25, 30]);
    expect(head.keyframes.rotation.map((key) => key.value)).toEqual([0, 5]);
  });

  it('bleep: the voice drops to silence over the word with 10 ms ramps, a bleep trimmed to the word', () => {
    const { comp, report, voice } = apply([{ move: 'bleep', from: 12.4, to: 12.8, why: '' } as Partial<RoastEvent>]);
    expect(report.errors).toEqual([]);
    const dialogue = comp.clips.find((clip) => clip.id === voice[1]) as Clip;
    expect(dialogue.keyframes.volume.map((key) => [Math.round(key.time * 1000) / 1000, key.value])).toEqual([[2.39, 1], [2.4, 0], [2.8, 0], [2.81, 1]]);
    const tone = sfxOf(comp, 'e1')[0];
    expect(kindOf(tone)).toBe('bleep');
    expect(tone.start).toBeCloseTo(12.4, 6);
    expect(tone.duration).toBeCloseTo(0.4, 6);
  });

  it('music_sting: on the Music track at its level with a fade, snapped to the nearest downbeat', () => {
    const { comp: base, project } = setup();
    const result = applyEdl(base, project, assets, edl(base, [{ move: 'music_sting', assetId: 'sting', at: 7.9, duration: 4, db: -14, fadeOut: 0.5, snapToBeat: true, why: '' } as Partial<RoastEvent>]), { downbeats: [4, 8.1, 12] });
    expect(result.report.errors).toEqual([]);
    const sting = madeBy(result.comp, 'e1')[0];
    expect(trackName(result.comp, sting)).toBe('Music');
    expect(sting).toMatchObject({ start: 8.1, duration: 4, audioType: 'music' });
    expect(sting.volume).toBeCloseTo(10 ** (-14 / 20), 5);
    expect(sting.keyframes.volume.map((key) => [key.time, key.value === 0])).toEqual([[3.5, false], [4, true]]);
    expect(result.report.dna.musicCoverage).toBeCloseTo(4 / 30, 3);
  });

  it('sfx: a sound on its own', () => {
    const { comp, report } = apply([{ move: 'sfx', cue: { kind: 'glitch' }, at: 9, duration: 1, why: '' } as Partial<RoastEvent>]);
    expect(report.errors).toEqual([]);
    expect(kindOf(sfxOf(comp, 'e1')[0])).toBe('glitch');
  });

  it('sfx: null keeps a move silent', () => {
    const { comp } = apply([{ move: 'keyword_pop', text: 'WOW', style: 'roundedPop', at: 3, duration: 1, why: '', sfx: null } as Partial<RoastEvent>]);
    expect(sfxOf(comp, 'e1')).toEqual([]);
  });
});

describe('applying a plan', () => {
  const plan: Partial<RoastEvent>[] = [
    { move: 'meme_cutaway', assetId: 'husky', at: 4, duration: 2, why: 'dog' },
    { move: 'zoom_punch', at: 12, duration: 1.5, why: '' },
    { move: 'keyword_pop', text: 'GOLD', style: 'memeImpact', at: 16, duration: 1, why: '' },
    { move: 'whip', at: 10, duration: 0.15, why: '' },
    { move: 'bleep', from: 20, to: 20.5, why: '' },
  ] as Partial<RoastEvent>[];

  it('is idempotent: applying the same plan again changes nothing', () => {
    const { comp, project } = setup();
    const first = applyEdl(comp, project, assets, edl(comp, plan));
    expect(first.report.errors).toEqual([]);
    const second = applyEdl(first.comp, project, assets, edl(first.comp, plan));
    expect(second.report.errors).toEqual([]);
    const shape = (c: Comp) => ({
      clips: c.clips.map((clip) => ({ name: clip.name, start: clip.start, duration: clip.duration, track: c.tracks.findIndex((t) => t.id === clip.trackId), keyframes: clip.keyframes })).sort((a, b) => `${a.name}${a.start}${a.track}`.localeCompare(`${b.name}${b.start}${b.track}`)),
      tracks: c.tracks.map((track) => [track.kind, track.name]),
      transitions: c.transitions.map((t) => t.kind),
    });
    expect(shape(second.comp)).toEqual(shape(first.comp));
    expect(second.comp.roast?.applied?.map((entry) => entry.eventId)).toEqual(['e1', 'e4', 'e2', 'e3', 'e5']);
    expect(second.comp.roast?.applied?.map((entry) => entry.eventId)).toEqual(first.comp.roast?.applied?.map((entry) => entry.eventId));
    expect(second.comp.roast?.edl?.events).toHaveLength(5);
  });

  it('replace takes the whole previous plan back; merging keeps events not resent', () => {
    const { comp, project, voice } = setup();
    const first = applyEdl(comp, project, assets, edl(comp, plan));
    const merged = applyEdl(first.comp, project, assets, { version: 1, compId: comp.id, style: 'funny', events: [{ id: 'e3', move: 'keyword_pop', text: 'SILVER', style: 'memeImpact', at: 17, duration: 1, why: '' }] });
    expect(merged.comp.roast?.edl?.events).toHaveLength(5);
    expect(madeBy(merged.comp, 'e3').find((clip) => clip.source.type === 'text')?.source).toMatchObject({ text: 'SILVER' });
    expect(madeBy(merged.comp, 'e1').length).toBeGreaterThan(0);
    const cleared = applyEdl(merged.comp, project, assets, { version: 1, compId: comp.id, style: 'funny', events: [] }, { replace: true });
    expect(cleared.comp.clips.filter((clip) => roastIdOf(clip))).toEqual([]);
    expect(cleared.comp.transitions).toEqual([]);
    const hostClips = cleared.comp.clips.filter((clip) => !roastIdOf(clip));
    expect(hostClips.every((clip) => clip.keyframes.scale.length === 0 && clip.keyframes.x.length === 0)).toBe(true);
    expect((hostClips.find((clip) => clip.id === voice[0]) as Clip).keyframes.volume).toEqual([]);
    expect(cleared.comp.roast?.applied).toEqual([]);
  });
});

describe('validation', () => {
  it('reports unknown ids, events outside the comp, missing reasons, overlapping cutaways and overused sounds', () => {
    const { comp, project } = setup();
    const report = validateEdl(comp, project, assets, edl(comp, [
      { move: 'meme_cutaway', assetId: 'nope', at: 2, duration: 2, why: 'x' },
      { move: 'meme_cutaway', assetId: 'husky', at: 5, duration: 2, why: '' },
      { move: 'receipt', assetId: 'podcast', at: 6, duration: 3, why: 'quote' },
      { move: 'keyword_pop', text: 'A', style: 'memeImpact', at: 40, duration: 1, why: '' },
      { move: 'zoom_punch', clipId: 'missing', at: 3, duration: 1, why: '' },
      ...[1, 3, 8, 11].map((at) => ({ move: 'emoji_pop', emoji: '😂', at, duration: 9, why: '' })),
    ] as Partial<RoastEvent>[]));
    expect(report.ok).toBe(false);
    const all = report.errors.join('\n');
    expect(all).toMatch(/e1 \(meme_cutaway\): assetId nope is not in the project/);
    expect(all).toMatch(/e2 \(meme_cutaway\): why is required/);
    expect(all).toMatch(/e3 \(receipt\) overlaps e2 \(meme_cutaway\)/);
    expect(all).toMatch(/e4 \(keyword_pop\): at 40s is outside the comp/);
    expect(all).toMatch(/e5 \(zoom_punch\): clipId missing is not on this comp/);
    expect(report.warnings.join('\n')).toMatch(/"pop" sound is used 5 times/);
    expect(report.warnings.join('\n')).toMatch(/9s is outside 0.3–3 s/);
    // The dry run leaves the comp alone.
    expect(comp.clips).toHaveLength(4);
  });

  it('predicts the DNA of the result and its dead zones', () => {
    const { comp, project } = setup();
    const report = validateEdl(comp, project, assets, edl(comp, [{ move: 'keyword_pop', text: 'GOLD', style: 'memeImpact', at: 16, duration: 1, why: '' } as Partial<RoastEvent>]));
    expect(report.ok).toBe(true);
    expect(report.dna.textEvents).toBe(1);
    expect(report.deadZones).toEqual([{ start: 0, end: 10 }, { start: 10, end: 16 }, { start: 17, end: 30 }].filter((zone) => zone.end - zone.start > 8));
  });

  it('gives events ids and default durations', () => {
    const { events, errors } = normalizeEvents([{ move: 'zoom_punch', at: 3 }, { id: 'e1', move: 'shake', at: 4 }, { move: 'bleep', from: 2, to: 2.3 }, { move: 'nope', at: 1 }], { assets });
    expect(errors).toEqual(['event 4: unknown move "nope" (one of meme_cutaway, receipt, side_cutout, host_on_bg, keyword_pop, emoji_pop, sticker, overlay_fx, card, title_card, cta, zoom_punch, shake, whip, bw_freeze, label, head_paste, bleep, music_sting, sfx)']);
    expect(events.map((event) => [event.id, event.at, event.duration])).toEqual([['e2', 3, 1.2], ['e1', 4, 0.2], ['e3', 2, 0.3]]);
  });
});

describe('the plan tools', () => {
  function context(start: Project) {
    let project = start;
    let commits = 0;
    const ctx: RoastToolContext = {
      project,
      assets,
      commit: (change) => { project = change(project); commits++; },
      editComp: (comp, change) => { project = { ...project, comps: project.comps.map((item) => (item.id === comp.id ? change(item) : item)) }; commits++; },
      pickComp: (p, args) => p.comps.find((comp) => comp.id === args.compId) ?? p.comps[0],
      current: () => project,
      importFiles: async () => [],
    };
    return { ctx, get: () => project, commits: () => commits };
  }

  it('save_beat_sheet keeps the tidied sheet on the comp and reports profanity', async () => {
    const { project } = setup();
    const { ctx, get, commits } = context(project);
    const result = await runPlanTool('save_beat_sheet', {
      beats: [{ start: 1, end: 3, kinds: ['punchline'], text: 'yeh banda chutiya hai' }],
      words: [{ text: 'yeh', start: 1, end: 1.2 }, { text: 'banda', start: 1.2, end: 1.6 }, { text: 'chutiya', start: 1.7, end: 2.2 }, { text: 'hai', start: 2.2, end: 2.5 }],
    }, ctx);
    expect(result.ok).toBe(true);
    expect(commits()).toBe(1);
    expect(get().comps[0].roast?.beatSheet?.beats[0]).toMatchObject({ id: 'b1', punchAt: 2.5, kinds: ['punchline', 'profanity'] });
    expect(result).toMatchObject({ counts: { punchline: 1, profanity: 1 }, profanity: [{ beatId: 'b1', word: 'chutiya', start: 1.7, end: 2.2 }] });
  });

  it('apply_roast_edl applies in one commit, refuses a plan with errors, and roast_move appends', async () => {
    const { project } = setup();
    const { ctx, get, commits } = context(project);
    const refused = await runPlanTool('apply_roast_edl', { events: [{ move: 'meme_cutaway', assetId: 'husky', at: 4, duration: 2 }] }, ctx);
    expect(refused.ok).toBe(false);
    expect(commits()).toBe(0);
    const applied = await runPlanTool('apply_roast_edl', { events: [{ move: 'meme_cutaway', assetId: 'husky', at: 4, duration: 2, why: 'dog' }, { move: 'zoom_punch', at: 12, duration: 1 }] }, ctx);
    expect(applied.ok).toBe(true);
    expect(commits()).toBe(1);
    const moved = await runPlanTool('roast_move', { event: { move: 'keyword_pop', text: 'GOLD', style: 'memeImpact', at: 16, duration: 1 } }, ctx);
    expect(moved).toMatchObject({ ok: true, eventId: 'e3' });
    expect(commits()).toBe(2);
    expect(get().comps[0].roast?.edl?.events.map((event) => event.id)).toEqual(['e1', 'e2', 'e3']);
    expect(get().comps[0].roast?.applied?.map((entry) => entry.eventId)).toEqual(['e1', 'e2', 'e3']);
    const checked = await runPlanTool('validate_roast_edl', { events: [{ move: 'receipt', assetId: 'podcast', at: 5, duration: 3, why: 'quote' }] }, ctx);
    expect(checked.ok).toBe(true);
    expect((checked as unknown as { report: { ok: boolean; errors: string[] } }).report.errors[0]).toMatch(/overlaps e1/);
    expect(commits()).toBe(2);
    const dna = await runPlanTool('edit_dna', {}, ctx);
    expect(dna).toMatchObject({ ok: true, dna: { memes: 1, textEvents: 1 } });
  });
});
