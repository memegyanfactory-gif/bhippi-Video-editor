// The motion kit: templates that build MotionScenes in the reference video's grammar. Each spec
// documents its params for the AI (create_motion_scene) and the Motion panel.
import type { MotionScene } from '../types';
import type { KitContext } from './common';
import { subjectReveal, type SubjectRevealParams } from './subjectReveal';
import { STAGE_TEMPLATES } from './stageTemplates';
import { OVERLAY_TEMPLATES } from './overlayTemplates';
import { STORY_TEMPLATES } from './storyTemplates';
import { BRAND_TEMPLATES } from './brandTemplates';
import { FUN_TEMPLATES } from './funTemplates';
import { DRAWN_TEMPLATES } from './drawnTemplates';
import { FILM_TEMPLATES } from './filmTemplates';

export type TemplateSpec = {
  id: string;
  label: string;
  /** Technique id(s) from docs/MOTION-DESIGN-MASTER-PLAN.md §1.2 (T1…T27). */
  technique: string;
  /** When to use it, one or two sentences for the AI. */
  use: string;
  /** Param name → description (type, default). Footage params take { asset, in?, matte? }. */
  params: Record<string, string>;
  /** Typical length in seconds. */
  seconds: number;
  /** Whether the scene covers the whole frame (true) or overlays footage below it (false). */
  fullFrame: boolean;
  build: (ctx: KitContext, params: Record<string, unknown>) => MotionScene;
};

const SUBJECT_REVEAL: TemplateSpec = {
  id: 'subject-reveal',
  label: 'Subject reveal (hook)',
  technique: 'T1 T2 T5 T7',
  use: 'The opening hook: the presenter appears out of an empty room through hot crimson cells cut from his own matte, seeded at the face; two title words sit behind him; the phrase lands word by word; optionally the frame shrinks into a card. Needs a roto matte on the subject clip; best with a clean plate from erase_subject_clip.',
  params: {
    subject: 'footage { asset, in, matte } — the talking-head clip with its roto matte (required)',
    plate: 'footage { asset } — the clean plate image/video (optional; without it the plain footage is the background)',
    title: 'string[2] — words left and right of the face (default ["Motion","Design"])',
    phrase: 'string — words under the face, landing one by one',
    phraseTimes: 'number[] — scene seconds each phrase word lands (from the transcript)',
    face: '[x, y] canvas px — the seed; default from the roto subject box',
    revealAt: 'number s (0.12)', revealDuration: 'number s (0.55)', cardAt: 'number s | null — frame-to-card moment', accent: 'colour',
  },
  seconds: 2.6,
  fullFrame: true,
  build: (ctx, params) => subjectReveal(ctx, params as unknown as SubjectRevealParams),
};

export const MOTION_TEMPLATES: TemplateSpec[] = [...BRAND_TEMPLATES, SUBJECT_REVEAL, ...STAGE_TEMPLATES, ...OVERLAY_TEMPLATES, ...STORY_TEMPLATES, ...FUN_TEMPLATES, ...DRAWN_TEMPLATES, ...FILM_TEMPLATES];

export const findTemplate = (id: string) => MOTION_TEMPLATES.find((spec) => spec.id === id);

export type { KitContext };
