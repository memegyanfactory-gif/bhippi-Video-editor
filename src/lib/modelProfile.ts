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
  '- No music, or music generation/download failed: compose_music. Flat or black background: make_background. Never fake music with sound effects.',
  '- Fix what run_frame_qa lists with small, specific calls; do not hand-edit keyframe paths; if a beat is wrong, rebuild with new beats. Then judge_edit and verify_edit_workflow.',
  '- Read tool results by their summary; do not re-read whole scenes to look for problems.',
].join('\n');
