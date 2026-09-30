// How much of the craft a model carries itself. A frontier model (Opus, GPT-5, Gemini Pro) runs
// the whole production — plans, builds scene by scene, looks at frames, fixes, verifies — and
// gets everything at full detail. A weaker or free model does better *guided*: the one-call build
// (build_edit_from_brief) and Bhippi's own music and backgrounds are sent whole and put first,
// tool results come back compact, and frames as words. Nothing is taken away from either tier:
// every tool stays reachable, only what leads and how much is sent changes.
import { tierOf } from './modelTiers';

export type ModelTier = 'full' | 'guided';
/** The user's choice in Settings → General: automatic, or always one tier. */
export type GuidedSetting = 'auto' | ModelTier;

/** Local servers run whatever small model is loaded; they are guided unless the user says otherwise. */
const LOCAL_PROVIDERS = /^(ollama|lmstudio|lm-studio|llamacpp|llama-cpp|local|localai|jan|vllm|koboldcpp|gpt4all)/i;
/** Families that run a long agentic production well at their full size. */
const FRONTIER = /(claude|opus|sonnet|fable|gpt-5|gpt-4\.1|\bo3\b|\bo4\b|codex|astra|gemini-[\d.]+-pro|gemini-pro|gemini-3|grok-4|kimi-k2|deepseek-(v3|r1)(?!.*distill)|qwen3-(coder|max|235b)|glm-4\.[5-9]|glm-[5-9])/i;
/** Ids that say "small, free or distilled" outright. */
const WEAK_WORDS = /(free|distill|nemotron|gemma|phi-?\d|tinyllama|smollm|olmo|granite|mistral-small|ministral|llama-?3\.?[12]?[-:]?(1b|3b|8b)|qwen2\.5-(0\.5|1\.5|3|7|14)b)/i;

/** The parameter count an id names ("…-32b", ":8b", "70B"), in billions. */
function paramsOf(id: string): number | null {
  const match = /(?:^|[-_:./])(\d+(?:\.\d+)?)b(?:$|[-_:./])/i.exec(id);
  return match ? Number(match[1]) : null;
}

/**
 * The tier a provider's model runs on, and why. The provider's own default (no model picked) of a
 * frontier CLI is full; unknown cloud models are full too, so nothing strong is held back by a guess.
 */
export function modelTier(providerId: string | null | undefined, model: string | null | undefined, setting: GuidedSetting | null | undefined = 'auto'): { tier: ModelTier; why: string } {
  if (setting === 'full' || setting === 'guided') return { tier: setting, why: 'set in Settings' };
  const provider = (providerId ?? '').toLowerCase();
  const id = (model ?? '').toLowerCase();
  if (WEAK_WORDS.test(id)) return { tier: 'guided', why: `${model} is a small, free or distilled model` };
  const size = paramsOf(id);
  if (size !== null && size < 60) return { tier: 'guided', why: `${model} is a ${size}B model` };
  if (LOCAL_PROVIDERS.test(provider) && !FRONTIER.test(id)) return { tier: 'guided', why: 'a local model server' };
  if (id && tierOf(id).rank <= 1 && tierOf(id).sized) return { tier: 'guided', why: `${model} is a fast, small tier` };
  return { tier: 'full', why: id ? (FRONTIER.test(id) ? `${model} is a frontier model` : 'no sign it is a small model') : 'the provider’s default model' };
}

/** The standing brief a guided turn leads with: the reliable path, in a few lines. */
export const GUIDED_BRIEF = [
  'GUIDED MODE (this model gets Bhippi\'s strongest defaults): keep your own work to the words and the feel; let the tools do the craft.',
  '- A video from scratch, a promo, a reel, a showreel, an explainer made of titles: plan the beats (one idea each, 2–7 words), then ONE build_edit_from_brief call builds it — templates, timing on the beat, transitions with sound, a composed score and a background. Do not build scenes, keyframes or sound one by one.',
  '- One graphic on an existing edit (a title, lower third, stat, list, quote, timeline…): add_graphic {kind, text, points?, value?, at}. It picks the template and fits the words; read its "Auto-fixed" note.',
  '- No music, or music generation/download failed: compose_music. Flat or black background: make_background. Never fake music with sound effects.',
  '- Fix what run_frame_qa lists with small, specific calls; do not hand-edit keyframe paths; if a beat is wrong, rebuild with new beats. Then judge_edit and verify_edit_workflow.',
  '- Read tool results by their summary; do not re-read whole scenes to look for problems.',
].join('\n');

/**
 * Why a guided turn may not make this call, or null. A weaker model's raw HTML or hand-written
 * scene is where graphics break (docs/TRAIN-AND-TEMPLATES-PLAN.md Part B), so on the guided tier
 * graphics come from templates, which are checked and fitted; the user can switch to Full.
 */
export function guidedRefusal(name: string, args: Record<string, unknown>): string | null {
  const raw = (value: unknown) => typeof value === 'string' && value.trim().length > 0;
  const nudge = 'Use add_graphic {kind, text, …} (it picks and fits the template), or a template id with create_motion_graphic / create_motion_scene. The user can allow raw authoring by setting the AI to Full in Settings → General.';
  if (name === 'create_motion_graphic' && (args.template === 'custom' || raw(args.html) || raw(args.css) || raw(args.js))) return `Guided mode: this model builds graphics from templates, not raw HTML/CSS/JS. ${nudge}`;
  if (name === 'create_motion_scene' && !raw(args.template) && args.scene && typeof args.scene === 'object') return `Guided mode: this model builds scenes from templates, not a hand-written scene. ${nudge}`;
  if (name === 'create_motion_sequence' && Array.isArray(args.beats) && args.beats.some((beat) => !!beat && typeof beat === 'object' && 'scene' in (beat as object) && !raw((beat as Record<string, unknown>).template))) return `Guided mode: each beat is a template ({template, params}), not a hand-written scene. For a whole video use build_edit_from_brief. ${nudge}`;
  // A "render" scene is one the model renders itself with its own code: a frontier model does that
  // well, but a smaller one that plans it has nothing to deliver when gathering starts.
  if (name === 'save_video_blueprint' && Array.isArray(args.scenes) && args.scenes.some((scene) => !!scene && typeof scene === 'object' && (scene as Record<string, unknown>).mediaSource === 'render')) {
    return 'Guided mode: a "render" scene means writing your own renderer, which this model does not do. Give each such scene mediaSource "generate", "download" or "existing" and carry its look with a template graphic (the scene\'s mogrt), or build the whole video with build_edit_from_brief.';
  }
  return null;
}
