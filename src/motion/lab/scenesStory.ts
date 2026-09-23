// Lab scenes for the Story template group (dev-only harness).
import { STORY_TEMPLATES } from '../kit/storyTemplates';
import type { MotionScene } from '../types';

const land = { width: 1280, height: 720 };
const port = { width: 1080, height: 1920 };
// talk.mp4 is 2.4 s long: slowed so a 4 s scene keeps moving.
const talk = { path: 'talk.mp4', in: 0, speed: 0.6 };
const talkMatte = { path: 'talk.mp4', in: 0, matte: 'matte@29.97@72' };
const plate = { path: 'erase/clean_plate.png', kind: 'image' as const };
const still = (i: number) => ({ path: `stills/still${i}.jpg`, kind: 'image' as const });

const build = (id: string, ctx: { width: number; height: number }, params: Record<string, unknown>) => () => {
  const spec = STORY_TEMPLATES.find((s) => s.id === id);
  if (!spec) throw new Error(`no template ${id}`);
  return spec.build(ctx, params);
};

const sentence = {
  footage: talk,
  sentence: "because you don't know what to make",
  keywords: [],
  strike: { words: "you don't know what to make", at: 1.3, replaceWith: 'you keep losing the thread between tools', replaceAt: 2.0 },
};
const social = {
  thumbnail: still(5),
  title: 'I made a motion design video in 4 weeks. Here is everything I learned',
  channel: { name: 'Meme Gyan', subscribers: '1.2M subscribers' },
  views: { from: 0, to: 2400000 },
  word: 'entire ~world~',
};
const demo = {
  screen: still(3),
  boxes: [
    { rect: [0.46, 0.38, 0.33, 0.12], label: 'Agent gives choices to proceed', at: 0.8 },
    { rect: [0.36, 0.62, 0.36, 0.2], label: 'Timeline stays in sync', at: 2.4 },
  ],
  push: 1.3,
  duration: 4.2,
};
const compare = { left: { media: still(2), label: 'Rockstar Games' }, right: { media: still(4), label: 'Luma AI' }, divider: 'line' };
const tunnel = { images: Array.from({ length: 12 }, (_, i) => still(i + 1)), title: 'Luma', at: 1.3 };
const number = { subject: talkMatte, plate, text: '45', suffix: 'Sec', suffixStyle: 'split', position: [657, 288], at: 0.2 };
const broll = { footage: talk, lines: ['obviously,', 'a beginner', 'is *going to*', 'get ~scared~'], grade: 'crimson', at: 0.3 };

export const STORY_LAB_SCENES: Record<string, () => MotionScene> = {
  'story-sentence': build('blurred-sentence', land, sentence),
  'story-sentence-plain': build('blurred-sentence', land, { footage: talk, sentence: 'Motion design taste lives in your hands, not on the internet', keywords: ['taste', 'hands'] }),
  'story-sentence-portrait': build('blurred-sentence', port, sentence),
  'story-tunnel': build('zoom-tunnel', land, tunnel),
  'story-tunnel-portrait': build('zoom-tunnel', port, tunnel),
  'story-social': build('social-card', land, social),
  'story-social-portrait': build('social-card', port, social),
  'story-demo': build('demo-callouts', land, demo),
  'story-demo-portrait': build('demo-callouts', port, demo),
  'story-compare': build('comparison-pair', land, compare),
  'story-compare-vs': build('comparison-pair', land, { ...compare, divider: 'vs' }),
  'story-compare-portrait': build('comparison-pair', port, { ...compare, divider: 'vs' }),
  'story-grade': build('grade-hit', land, { preset: 'bw', at: 0.5, duration: 1.2, footage: talk }),
  'story-grade-duotone': build('grade-hit', land, { preset: 'duotone', at: 0.5, duration: 1.2, footage: talk }),
  'story-grade-crush': build('grade-hit', land, { preset: 'crush', at: 0.5, duration: 1.2, footage: talk }),
  'story-number': build('big-number-behind', land, number),
  'story-number-counter': build('big-number-behind', land, { subject: talkMatte, plate, counter: { from: 0, to: 12917 }, suffix: 'AED', at: 0.2 }),
  'story-number-portrait': build('big-number-behind', port, { subject: talkMatte, plate, text: '2026', at: 0.2 }),
  'story-broll': build('stylized-broll', land, broll),
  'story-broll-pink': build('stylized-broll', land, { footage: talk, lines: ['Motion Design ~taste~', "doesn't live on *internet*"], grade: 'pink', at: 0.3 }),
  'story-broll-portrait': build('stylized-broll', port, broll),
};
