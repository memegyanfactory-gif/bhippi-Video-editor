import { describe, expect, it } from 'vitest';
import {
  applyStyleToAllCaptions,
  buildWatchfiwnCues,
  ensureTopSubtitleTrack,
  assetsToTranscribe,
  generateProjectSubtitles,
  wordsOnTimeline,
  SUBTITLE_LANGUAGES,
  subtitleLangLabel,
  type TimedWord,
} from '../src/lib/subtitlesEngine';
import { newClip, newComp, textSource, tracksOf } from '../src/lib/timeline';
import type { Asset } from '../src/lib/types';

const mockAsset = (id: string, duration = 10, hasAudio = true): Asset => ({
  id,
  name: `${id}.mp4`,
  path: `C:/media/${id}.mp4`,
  kind: 'video',
  duration,
  width: 1920,
  height: 1080,
  fps: 30,
  hasAudio,
  videoCodec: 'h264',
  audioCodec: 'aac',
  size: 1000,
  importedAt: '2026-01-01',
  thumbnail: null,
  filmstrip: null,
  waveform: null,
  peaks: null,
  proxy: null,
  preview: 'ready',
  missing: false,
});

describe('subtitlesEngine: Language Support', () => {
  it('contains over 50 languages including Indian languages from WatchFIWN', () => {
    expect(SUBTITLE_LANGUAGES.length).toBeGreaterThan(50);
    const codes = SUBTITLE_LANGUAGES.map(([code]) => code);
    expect(codes).toContain('en');
    expect(codes).toContain('hi');
    expect(codes).toContain('hinglish');
    expect(codes).toContain('te');
    expect(codes).toContain('ta');
    expect(codes).toContain('es');
    expect(codes).toContain('ja');
  });

  it('resolves language labels correctly', () => {
    expect(subtitleLangLabel('en')).toBe('English');
    expect(subtitleLangLabel('hi')).toContain('Hindi');
    expect(subtitleLangLabel('hinglish')).toContain('Hinglish');
  });
});

describe('subtitlesEngine: WatchFIWN Cue Builder', () => {
  it('combines words into balanced subtitle cues', () => {
    const words: TimedWord[] = [
      { start: 0.1, end: 0.4, word: 'Welcome' },
      { start: 0.5, end: 0.8, word: 'to' },
      { start: 0.9, end: 1.4, word: 'Bhippi' },
      { start: 1.5, end: 2.1, word: 'Studio.' },
      { start: 2.8, end: 3.2, word: 'Next' },
      { start: 3.3, end: 3.7, word: 'sentence' },
    ];

    const cues = buildWatchfiwnCues(words);
    expect(cues.length).toBeGreaterThanOrEqual(2);
    expect(cues[0].text).toContain('Welcome');
    expect(cues[0].words).toBeDefined();
    expect(cues[0].words?.length).toBeGreaterThan(0);
  });

  it('splits cues on large pause gaps', () => {
    const words: TimedWord[] = [
      { start: 1.0, end: 1.5, word: 'First' },
      { start: 3.5, end: 4.0, word: 'AfterPause' }, // 2.0s gap > GAP_BREAK (0.65s)
    ];

    const cues = buildWatchfiwnCues(words);
    expect(cues).toHaveLength(2);
    expect(cues[0].text).toBe('First');
    expect(cues[1].text).toBe('AfterPause');
  });
});

describe('subtitlesEngine: Layer Creation and Placement', () => {
  it('captions audio-only voiceover and preserves rapid genuine repeats', () => {
    const comp = newComp({ name: 'Voiceover' });
    const asset = { ...mockAsset('voice'), kind: 'audio' as const };
    const clip = newClip({ trackId: tracksOf(comp, 'audio')[0].id, start: 0, duration: 2, source: { type: 'media', assetId: asset.id } });
    const words = wordsOnTimeline({ ...comp, clips: [clip] }, new Map([[asset.id, asset]]), new Map([[asset.id, [{ text: 'no', start: 0.1, end: 0.15 }, { text: 'no', start: 0.16, end: 0.21 }]]]));
    expect(words.map(word => word.word)).toEqual(['no', 'no']);
  });
  it('does not caption a muted linked audio track through its video partner', () => {
    const comp = newComp({ name: 'Muted dialogue' });
    const asset = mockAsset('voice');
    const audio = tracksOf(comp, 'audio')[0];
    const clips = [tracksOf(comp, 'video')[0].id, audio.id].map(trackId => newClip({ trackId, start: 0, duration: 2, source: { type: 'media', assetId: asset.id }, linkId: 'pair' }));
    const muted = { ...comp, clips, tracks: comp.tracks.map(track => track.id === audio.id ? { ...track, muted: true } : track) };
    expect(wordsOnTimeline(muted, new Map([[asset.id, asset]]), new Map([[asset.id, [{ text: 'hello', start: 0.1, end: 0.5 }]]]))).toEqual([]);
  });
  it('creates or reuses a dedicated top subtitle video track', () => {
    const comp = newComp({ name: 'Sequence 1' });
    const initialVideoTracks = tracksOf(comp, 'video');

    const { comp: updated, track } = ensureTopSubtitleTrack(comp);
    const updatedVideoTracks = tracksOf(updated, 'video');

    expect(updatedVideoTracks.length).toBe(initialVideoTracks.length + 1);
    expect(track.name).toContain('Subtitles');

    // Calling again should reuse the existing subtitles track
    const { comp: reused, track: reusedTrack } = ensureTopSubtitleTrack(updated);
    expect(tracksOf(reused, 'video').length).toBe(updatedVideoTracks.length);
    expect(reusedTrack.id).toBe(track.id);
  });

  it('puts transcribed words where their pictures are, through cuts and speed', () => {
    let comp = newComp({ name: 'Podcast Cut' });
    const videoTrack = tracksOf(comp, 'video')[0];
    const asset = mockAsset('interview', 60, true);
    const assets = new Map([[asset.id, asset]]);

    // Two clips of one file: the second starts later on the timeline and further into the source,
    // as a razor cut with the middle lifted out would leave them.
    const first = newClip({ trackId: videoTrack.id, start: 0, duration: 2, in: 10, source: { type: 'media', assetId: asset.id } });
    const second = newClip({ trackId: videoTrack.id, start: 2, duration: 2, in: 30, source: { type: 'media', assetId: asset.id } });
    comp = { ...comp, clips: [first, second] };

    const words = wordsOnTimeline(comp, assets, new Map([[asset.id, [
      { text: 'before', start: 5, end: 5.4 },     // outside either clip
      { text: 'hello', start: 10.5, end: 10.9 },  // inside the first clip
      { text: 'there', start: 11.2, end: 11.6 },
      { text: 'again', start: 30.5, end: 30.9 },  // inside the second
    ]]]));

    expect(words.map((word) => word.word)).toEqual(['hello', 'there', 'again']);
    // Source 10.5 sits half a second into a clip that starts at 0; source 30.5 half a second
    // into one that starts at 2.
    expect(words[0].start).toBeCloseTo(0.5, 3);
    expect(words[2].start).toBeCloseTo(2.5, 3);

    // Half speed stretches a clip's words out with its pictures.
    const slow = { ...comp, clips: [{ ...first, speed: 0.5, duration: 4 }] };
    const slowed = wordsOnTimeline(slow, assets, new Map([[asset.id, [{ text: 'hello', start: 10.5, end: 10.9 }]]]));
    expect(slowed[0].start).toBeCloseTo(1, 3);
  });

  it('maps linked media captions once from the video side and removes provider replay tokens', () => {
    const comp0 = newComp({ name: 'Linked A/V' });
    const video = tracksOf(comp0, 'video')[0];
    const audio = tracksOf(comp0, 'audio')[0];
    const asset = mockAsset('linked', 10, true);
    const linkId = 'link-1';
    const videoClip = newClip({ trackId: video.id, start: 0, duration: 2, source: { type: 'media', assetId: asset.id }, linkId });
    const audioClip = newClip({ trackId: audio.id, start: 0, duration: 2, source: { type: 'media', assetId: asset.id }, linkId });
    const words = wordsOnTimeline(
      { ...comp0, clips: [videoClip, audioClip] },
      new Map([[asset.id, asset]]),
      new Map([[asset.id, [
        { text: 'hello', start: 0.40, end: 0.70 },
        { text: 'hello', start: 0.41, end: 0.69 },
        { text: 'world', start: 0.80, end: 1.10 },
      ]]]),
    );
    expect(words.map((word) => word.word)).toEqual(['hello', 'world']);
  });

  it('keeps punctuation attached to the spoken wording', () => {
    const cues = buildWatchfiwnCues([
      { start: 0, end: 0.2, word: 'Hello' },
      { start: 0.2, end: 0.4, word: ',' },
      { start: 0.4, end: 0.7, word: 'world' },
      { start: 0.7, end: 0.9, word: '!' },
    ]);
    expect(cues[0].text).toBe('Hello, world!');
  });

  it('only transcribes each sounding file once, and skips muted tracks', () => {
    let comp = newComp({ name: 'Two Sources' });
    const [videoTrack] = tracksOf(comp, 'video');
    const audioTrack = tracksOf(comp, 'audio')[0];
    const speech = mockAsset('interview', 60, true);
    const silent = mockAsset('broll', 20, false);
    const assets = new Map([[speech.id, speech], [silent.id, silent]]);

    comp = { ...comp, clips: [
      newClip({ trackId: videoTrack.id, start: 0, duration: 2, source: { type: 'media', assetId: speech.id } }),
      newClip({ trackId: videoTrack.id, start: 2, duration: 2, in: 20, source: { type: 'media', assetId: speech.id } }),
      newClip({ trackId: videoTrack.id, start: 4, duration: 2, source: { type: 'media', assetId: silent.id } }),
    ] };
    expect(assetsToTranscribe(comp, assets).map((item) => item.id)).toEqual([speech.id]);

    const muted = { ...comp, tracks: comp.tracks.map((track) => (track.kind === 'video' ? { ...track, muted: true } : track)) };
    expect(assetsToTranscribe(muted, assets)).toEqual([]);
    expect(audioTrack).toBeTruthy();
  });

  it('lays given cues onto a caption track in the chosen style', () => {
    const comp = newComp({ name: 'Styled' });
    const result = generateProjectSubtitles(comp, {
      styleId: 'hormozi',
      customCues: [
        { id: 'c1', start: 0.5, end: 1.4, text: 'Make it' },
        { id: 'c2', start: 1.5, end: 2.4, text: 'POP' },
      ],
    });

    expect(result.count).toBe(2);
    expect(result.track.name).toContain('Subtitles');
    const captions = result.comp.clips.filter((clip) => clip.trackId === result.track.id);
    expect(captions.length).toBe(2);
    for (const caption of captions) {
      expect(caption.source.type).toBe('text');
      if (caption.source.type === 'text') {
        expect(caption.source.preset).toBe('caption');
        expect(caption.source.style).toBe('hormozi');
      }
    }
    // Nothing is invented: with no cues, nothing is written.
    expect(generateProjectSubtitles(comp, { styleId: 'hormozi' }).count).toBe(0);
  });

  it('never lets one caption run into the next, however short the words are', () => {
    const comp = newComp({ name: 'Tight' });
    // Whisper hands back words this close together all the time. Padding each of these out to
    // the 0.2 s minimum would overlap the next one, and an overlap makes the backend refuse to
    // save the whole project.
    const result = generateProjectSubtitles(comp, {
      customCues: [
        { id: 'c1', start: 0.00, end: 0.06, text: 'so' },
        { id: 'c2', start: 0.08, end: 0.14, text: 'we' },
        { id: 'c3', start: 0.15, end: 0.90, text: 'made an app' },
        { id: 'c4', start: 2.00, end: 2.05, text: 'yes' },
      ],
    });
    const captions = result.comp.clips
      .filter((clip) => clip.trackId === result.track.id)
      .sort((a, b) => a.start - b.start);
    expect(captions.length).toBe(4);
    for (let index = 1; index < captions.length; index++) {
      const previousEnd = captions[index - 1].start + captions[index - 1].duration;
      expect(captions[index].start).toBeGreaterThanOrEqual(previousEnd - 1e-9);
    }
    // The last one has nothing after it, so it still gets the readable minimum.
    expect(captions[3].duration).toBeCloseTo(0.2, 5);
    // The crowded ones are clipped to the room they have, not padded past it.
    expect(captions[0].duration).toBeCloseTo(0.08, 5);
    expect(captions[1].duration).toBeCloseTo(0.07, 5);
  });

  it('drops a cue that starts on top of the next one rather than overlapping it', () => {
    const comp = newComp({ name: 'Stacked' });
    const result = generateProjectSubtitles(comp, {
      customCues: [
        { id: 'a', start: 1, end: 2, text: 'first' },
        { id: 'b', start: 1, end: 3, text: 'second' },
      ],
    });
    const captions = result.comp.clips.filter((clip) => clip.trackId === result.track.id);
    expect(captions).toHaveLength(1);
    expect(captions[0].source.type === 'text' && captions[0].source.text).toBe('second');
  });

  it('updates all caption clips when applying a new style', () => {
    let comp = newComp({ name: 'Style Switch Test' });
    const track = tracksOf(comp, 'video')[0];

    const clip1 = newClip({
      trackId: track.id,
      start: 0,
      duration: 3,
      source: textSource('caption', { text: 'Line 1', style: 'karaoke' }),
    });

    const clip2 = newClip({
      trackId: track.id,
      start: 3.5,
      duration: 3,
      source: textSource('caption', { text: 'Line 2', style: 'karaoke' }),
    });

    comp = { ...comp, clips: [clip1, clip2] };

    const styledComp = applyStyleToAllCaptions(comp, 'beastone');
    const captions = styledComp.clips.filter((c) => c.source.type === 'text' && c.source.preset === 'caption');

    expect(captions).toHaveLength(2);
    expect((captions[0].source as { style?: string }).style).toBe('beastone');
    expect((captions[1].source as { style?: string }).style).toBe('beastone');
  });
});
