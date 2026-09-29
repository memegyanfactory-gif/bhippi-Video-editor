import { describe, expect, it } from 'vitest';
import { bpmFromText, moodFromText, placeMusicBed, placePlate } from '../src/lib/builtinMedia';
import { beatTemplate, planBuild } from '../src/lib/guidedBuild';
import { modelTier } from '../src/lib/modelProfile';
import { playbook } from '../src/lib/motionDirection';
import { findTemplate } from '../src/motion/kit';
import { newClip, newProject, tracksOf } from '../src/lib/timeline';
import { GUIDED_TOOLS, routeTools } from '../src/lib/toolRouter';

describe('which models run guided', () => {
  it('guides small, free and local models and leaves frontier models on full', () => {
    expect(modelTier('opencode', 'opencode/nemotron-3-ultra-free').tier).toBe('guided');
    expect(modelTier('ollama', 'qwen2.5:14b').tier).toBe('guided');
    expect(modelTier('groq', 'llama-3.1-8b-instant').tier).toBe('guided');
    expect(modelTier('openai', 'gpt-5-mini').tier).toBe('guided');
    expect(modelTier('claude', 'claude-opus-5-5').tier).toBe('full');
    expect(modelTier('claude', null).tier).toBe('full');
    expect(modelTier('openai', 'gpt-5').tier).toBe('full');
    expect(modelTier('gemini', 'gemini-2.5-pro').tier).toBe('full');
    expect(modelTier('ollama', 'deepseek-v3').tier).toBe('full');
    // The user's setting wins.
    expect(modelTier('claude', 'claude-opus-5-5', 'guided').tier).toBe('guided');
    expect(modelTier('opencode', 'opencode/nemotron-3-ultra-free', 'full').tier).toBe('full');
  });

  it('sends a guided model the build and Bhippi\'s own media whole, and a full model its usual set', () => {
    const guided = routeTools('make a hype reel for my app launch', [], null, null, true);
    for (const tool of GUIDED_TOOLS) expect(guided.full).toContain(tool);
    const full = routeTools('make a hype reel for my app launch', [], null, null, false);
    expect(full.full).not.toContain('build_edit_from_brief');
    // Motion and SaaS videos get the score and plate tools whole either way.
    expect(full.full).toContain('compose_music');
  });
});

describe('the guided build plan', () => {
  const brief = [
    { text: 'Edit video with AI' },
    { text: 'Type what you want. Watch it happen.' },
    { text: 'faster first cut', value: 10, suffix: 'x' },
    { text: 'What you get', points: ['Motion graphics', 'Music on the beat', 'Captions'] },
    { text: 'Try Bhippi free', cta: 'bhippi.com' },
  ];

  it('holds every beat long enough to read, on whole beats of the music', () => {
    const plan = planBuild(brief, { mood: 'energetic', pacing: playbook('kinetic-type')?.pacing });
    const beat = 60 / plan.bpm;
    for (const [i, planned] of plan.beats.entries()) {
      expect(planned.hold / beat).toBeCloseTo(Math.round(planned.hold / beat), 2);
      expect(planned.hold).toBeGreaterThanOrEqual(planned.words / 3.3 + 0.6 - 1e-9);
      expect(findTemplate(planned.template), `beat ${i}: ${planned.template}`).toBeTruthy();
    }
    expect(plan.beats.map((b) => b.template)).toEqual(['brand-title', 'brand-title', 'brand-stat', 'brand-panel', 'brand-end-card']);
    expect(plan.transitions).toHaveLength(4);
    expect(plan.transitions[3]).toBe('white-out');
    // The music drops on the stat.
    expect(plan.dropBeat).toBe(2);
  });

  it('stretches towards a target length and leaves calm moods without a drop', () => {
    const short = planBuild(brief, { mood: 'chill' });
    const long = planBuild(brief, { mood: 'chill', targetSeconds: short.seconds * 2 });
    expect(long.seconds).toBeGreaterThan(short.seconds * 1.8);
    expect(short.dropBeat).toBeNull();
  });

  it('builds template params every template accepts, over a plate', () => {
    const stat = beatTemplate({ text: 'uptime', value: '99.9', suffix: '%' }, 'stat', 2);
    expect(stat.params).toMatchObject({ value: 99.9, decimals: 1, suffix: '%', label: 'uptime', background: 'none' });
    const params = Object.keys(findTemplate('brand-stat')!.params);
    for (const key of Object.keys(stat.params)) expect(params).toContain(key);
  });

  it('reads a mood and tempo from words', () => {
    expect(moodFromText('Bespoke electronic music, 120 BPM, four-on-the-floor, pumping sub')).toBe('energetic');
    expect(moodFromText('Restrained electronic ambient bed')).toBe('chill');
    expect(moodFromText('dark tense true crime')).toBe('dark');
    expect(moodFromText('')).toBeNull();
    expect(bpmFromText('hard drop, 120 BPM')).toBe(120);
    expect(bpmFromText('no tempo')).toBeNull();
  });
});

describe('Bhippi\'s own media on the timeline', () => {
  it('lays the score on a free audio track with fades and the plate on V1', () => {
    const project = newProject();
    const comp = project.comps[0];
    const a1 = tracksOf(comp, 'audio')[0].id;
    comp.clips = [newClip({ trackId: a1, start: 0, duration: 10, source: { type: 'media', assetId: 'voice' } })];
    const bed = placeMusicBed(comp, 'score', 0, 12);
    const clip = bed.comp.clips.find((c) => c.id === bed.clipId)!;
    expect(clip.trackId).not.toBe(a1);
    expect(clip.audioType).toBe('music');
    expect(bed.comp.transitions.filter((t) => t.trackId === bed.trackId)).toHaveLength(2);
    const plate = placePlate(bed.comp, 'plate', 0, 12);
    expect(plate.comp.clips.find((c) => c.id === plate.clipId)?.trackId).toBe(tracksOf(comp, 'video')[0].id);
  });
});

describe('files attached to a chat message', () => {
  it('tells the model what each file is and how to use it', async () => {
    const { filesBrief } = await import('../src/chat/attachments');
    const brief = filesBrief([
      { name: 'demo.mp4', kind: 'video', path: 'C:/v/demo.mp4', assetId: 'a1', duration: 12.4, times: [1, 4.5], frames: 2 },
      { name: 'logo.png', kind: 'image', path: 'C:/v/logo.png', frames: 0 },
      { name: 'song.mp3', kind: 'audio', path: 'C:/v/song.mp3', frames: 0 },
    ]);
    expect(brief).toContain('demo.mp4: a video file, 12.4 s, imported into the project as media a1');
    expect(brief).toContain('"mediaId":"a1"');
    expect(brief).toContain('2 frames from it attached above, at 1.0 s, 4.5 s');
    expect(brief).toContain('logo.png: a picture');
    expect(brief).toContain('song.mp3: an audio file');
    expect(filesBrief([])).toBe('');
  });
});
