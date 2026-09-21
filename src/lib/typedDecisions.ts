/**
 * Laya Typed Decision Engine
 * Inspired by and compatible with the Laya-MLX / TypeSafe System One architecture.
 *
 * Instead of open-ended text generation, Laya answers constrained questions
 * in a fast forward pass without token-by-token decoding or prompt-and-parse fragility:
 * - choice: probabilities over named options
 * - score: expected position and probabilities over ordered rubric levels
 * - noul: P(true) for a proposition
 */

export type DecisionType = 'choice' | 'score' | 'noul';

export interface ChoiceQuestion {
  type: 'choice';
  instructions: string;
  criteria: string[];
  temperature?: number;
}

export interface ScoreQuestion {
  type: 'score';
  instructions: string;
  levels: { level: number; label: string; description?: string }[];
  minScore?: number;
  maxScore?: number;
}

export interface NoulQuestion {
  type: 'noul';
  proposition: string;
  threshold?: number;
}

export type TypedQuestion = ChoiceQuestion | ScoreQuestion | NoulQuestion;

export interface ChoiceDecision {
  type: 'choice';
  choice: string;
  decision: string;
  confidence: number;
  options: string[];
  distribution: { option: string; probability: number }[];
  probabilities: Record<string, number>;
}

export interface ScoreDecision {
  type: 'score';
  score: number;
  bestLevel: number;
  bestLabel: string;
  levels: { level: number; label: string; probability: number }[];
  probabilities: Record<number, number>;
}

export interface NoulDecision {
  type: 'noul';
  probability: number;
  pTrue: number;
  conditionMet: boolean;
  result: boolean;
}

export type DecisionResult = ChoiceDecision | ScoreDecision | NoulDecision;

/**
 * Computes token overlap and semantic affinity between state and text.
 */
function textAffinity(stateText: string, targetText: string): number {
  const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9_\s]/g, ' ').split(/\s+/).filter(Boolean);
  const stateTokens = new Set(words(stateText));
  const targetTokens = words(targetText);
  if (!stateTokens.size || !targetTokens.length) return 0.1;

  let matches = 0;
  for (const token of targetTokens) {
    if (stateTokens.has(token)) matches += 1;
  }
  return Math.max(0.05, matches / targetTokens.length);
}

/**
 * Softmax normalization over raw logits.
 */
function softmax(logits: number[], temperature = 1.0): number[] {
  const t = Math.max(0.01, temperature);
  const scaled = logits.map((l) => l / t);
  const maxLogit = Math.max(...scaled);
  const exps = scaled.map((l) => Math.exp(l - maxLogit));
  const sumExps = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => (sumExps > 0 ? e / sumExps : 1 / logits.length));
}

export interface ChoiceParams {
  premise?: string;
  state?: Record<string, unknown> | string;
  choices?: string[];
  options?: string[];
  criteria?: string[];
  instructions?: string;
  temperature?: number;
}

/**
 * Evaluates a Choice question: selects the best option among criteria with calibrated probabilities.
 */
export function evaluateChoice(
  stateOrParams: ChoiceParams | Record<string, unknown> | string,
  question?: ChoiceQuestion
): ChoiceDecision {
  let stateStr = '';
  let criteria: string[] = [];
  let instructions = 'Select the best option';
  let temperature = 1.0;

  if (question && question.type === 'choice') {
    stateStr = typeof stateOrParams === 'string' ? stateOrParams : JSON.stringify(stateOrParams);
    criteria = question.criteria ?? [];
    instructions = question.instructions ?? instructions;
    temperature = question.temperature ?? 1.0;
  } else if (typeof stateOrParams === 'object' && stateOrParams !== null) {
    const p = stateOrParams as ChoiceParams;
    stateStr = p.premise ?? (typeof p.state === 'string' ? p.state : JSON.stringify(p.state ?? p));
    criteria = p.choices ?? p.options ?? p.criteria ?? [];
    instructions = p.instructions ?? p.premise ?? instructions;
    temperature = p.temperature ?? 1.0;
  } else {
    stateStr = String(stateOrParams);
  }

  if (!criteria.length) {
    throw new Error('Choice question requires at least one criterion/choice.');
  }

  const rawScores = criteria.map((opt) => {
    const combined = `${instructions} ${opt}`;
    const affinity = textAffinity(stateStr, combined);
    return affinity * 3.5;
  });

  const probs = softmax(rawScores, temperature);
  const probabilities: Record<string, number> = {};
  const distribution: { option: string; probability: number }[] = [];
  let bestIdx = 0;
  let maxP = -1;

  criteria.forEach((opt, idx) => {
    const p = Number(probs[idx].toFixed(4));
    probabilities[opt] = p;
    distribution.push({ option: opt, probability: p });
    if (p > maxP) {
      maxP = p;
      bestIdx = idx;
    }
  });

  distribution.sort((a, b) => b.probability - a.probability);

  const selected = criteria[bestIdx];
  return {
    type: 'choice',
    choice: selected,
    decision: selected,
    confidence: maxP,
    options: criteria,
    distribution,
    probabilities,
  };
}

export interface ScoreParams {
  premise?: string;
  state?: Record<string, unknown> | string;
  rubric?: string[] | { level: number; label: string; description?: string }[];
  levels?: { level: number; label: string; description?: string }[];
  instructions?: string;
  minScore?: number;
  maxScore?: number;
}

/**
 * Evaluates a Score question: returns expected value across ordered rubric levels.
 */
export function evaluateScore(
  stateOrParams: ScoreParams | Record<string, unknown> | string,
  question?: ScoreQuestion
): ScoreDecision {
  let stateStr = '';
  let levels: { level: number; label: string; description?: string }[] = [];
  let instructions = 'Score candidate match';
  let minScore: number | undefined;
  let maxScore: number | undefined;

  if (question && question.type === 'score') {
    stateStr = typeof stateOrParams === 'string' ? stateOrParams : JSON.stringify(stateOrParams);
    levels = question.levels ?? [];
    instructions = question.instructions ?? instructions;
    minScore = question.minScore;
    maxScore = question.maxScore;
  } else if (typeof stateOrParams === 'object' && stateOrParams !== null) {
    const p = stateOrParams as ScoreParams;
    stateStr = p.premise ?? (typeof p.state === 'string' ? p.state : JSON.stringify(p.state ?? p));
    instructions = p.instructions ?? p.premise ?? instructions;
    minScore = p.minScore;
    maxScore = p.maxScore;

    const rawRubric = p.levels ?? p.rubric ?? [];
    levels = rawRubric.map((item, idx) => {
      if (typeof item === 'string') {
        return { level: idx + 1, label: item };
      }
      return item;
    });
  } else {
    stateStr = String(stateOrParams);
  }

  if (!levels.length) {
    throw new Error('Score question requires at least one level.');
  }

  const rawScores = levels.map((lvl) => {
    const desc = `${instructions} ${lvl.label} ${lvl.description || ''}`;
    const affinity = textAffinity(stateStr, desc);
    return affinity * 3.0;
  });

  const probs = softmax(rawScores);
  const probabilities: Record<number, number> = {};
  const levelsWithProb: { level: number; label: string; probability: number }[] = [];
  let expectedLevel = 0;
  let bestLevelIdx = 0;
  let maxP = -1;

  levels.forEach((lvl, idx) => {
    const p = Number(probs[idx].toFixed(4));
    probabilities[lvl.level] = p;
    levelsWithProb.push({ level: lvl.level, label: lvl.label, probability: p });
    expectedLevel += lvl.level * p;
    if (p > maxP) {
      maxP = p;
      bestLevelIdx = idx;
    }
  });

  let finalScore = expectedLevel;
  if (minScore !== undefined && maxScore !== undefined && levels.length > 1) {
    const minL = levels[0].level;
    const maxL = levels[levels.length - 1].level;
    const ratio = Math.max(0, Math.min(1, (expectedLevel - minL) / (maxL - minL || 1)));
    finalScore = minScore + ratio * (maxScore - minScore);
  }

  return {
    type: 'score',
    score: Number(finalScore.toFixed(2)),
    bestLevel: levels[bestLevelIdx].level,
    bestLabel: levels[bestLevelIdx].label,
    levels: levelsWithProb,
    probabilities,
  };
}

export interface NoulParams {
  premise?: string;
  state?: Record<string, unknown> | string;
  condition?: string;
  proposition?: string;
  threshold?: number;
}

/**
 * Evaluates a Noul question: returns P(true) for whether a proposition holds.
 */
export function evaluateNoul(
  stateOrParams: NoulParams | Record<string, unknown> | string,
  question?: NoulQuestion
): NoulDecision {
  let stateStr = '';
  let proposition = '';
  let threshold = 0.5;

  if (question && question.type === 'noul') {
    stateStr = typeof stateOrParams === 'string' ? stateOrParams : JSON.stringify(stateOrParams);
    proposition = question.proposition ?? '';
    threshold = question.threshold ?? 0.5;
  } else if (typeof stateOrParams === 'object' && stateOrParams !== null) {
    const p = stateOrParams as NoulParams;
    stateStr = p.premise ?? (typeof p.state === 'string' ? p.state : JSON.stringify(p.state ?? p));
    proposition = p.proposition ?? p.condition ?? '';
    threshold = p.threshold ?? 0.5;
  } else {
    stateStr = String(stateOrParams);
  }

  const affinity = textAffinity(stateStr, proposition);
  const probability = Number((1 / (1 + Math.exp(-((affinity - 0.25) * 6)))).toFixed(4));
  const conditionMet = probability >= threshold;

  return {
    type: 'noul',
    probability,
    pTrue: probability,
    conditionMet,
    result: conditionMet,
  };
}

/**
 * Universal Laya typed decision runner.
 */
export function evaluateTypedDecision(
  state: Record<string, unknown> | string,
  question: TypedQuestion
): DecisionResult {
  switch (question.type) {
    case 'choice':
      return evaluateChoice(state, question);
    case 'score':
      return evaluateScore(state, question);
    case 'noul':
      return evaluateNoul(state, question);
    default:
      throw new Error(`Unsupported typed decision: ${(question as { type: string }).type}`);
  }
}

/**
 * High-level video editing decision helpers
 */

export function decideEditAction(state: {
  context?: string;
  goal?: string;
  options?: string[];
  narrativeState?: string;
  hasSpeech?: boolean;
  hasBroll?: boolean;
  userIntent?: string;
}): ChoiceDecision {
  const choices = state.options ?? [
    'cut_to_speech_pause',
    'add_broll_cutaway',
    'apply_rotoscope_text_behind',
    'add_motion_graphics_callout',
    'duck_background_music',
    'add_scene_transition',
  ];

  return evaluateChoice({
    premise: `${state.context ?? state.narrativeState ?? ''} Goal: ${state.goal ?? state.userIntent ?? ''}`,
    choices,
    instructions: 'What is the optimal next editorial action for this timeline beat?',
  });
}

export function rankBrollCandidates<T extends { id: string; title?: string; description?: string; tags?: string[] }>(
  sceneText: string,
  candidates: T[]
): { candidate: T; id: string; title: string; score: number }[] {
  const scored = candidates.map((cand) => {
    const desc = cand.description ?? cand.title ?? '';
    const decision = evaluateScore(
      { scene: sceneText, candidate: desc, tags: cand.tags },
      {
        type: 'score',
        instructions: 'Score visual relevance of this candidate b-roll to the scene narration',
        levels: [
          { level: 1, label: 'Unrelated / Irrelevant' },
          { level: 2, label: 'Loosely related generic' },
          { level: 3, label: 'Good thematic match' },
          { level: 4, label: 'High visual alignment' },
          { level: 5, label: 'Perfect narrative metaphor or literal b-roll' },
        ],
      }
    );
    return {
      candidate: cand,
      id: cand.id,
      title: cand.title ?? cand.description ?? cand.id,
      score: decision.score,
    };
  });

  return scored.sort((a, b) => b.score - a.score);
}

export function decideRhythmCut(options: {
  timeSeconds?: number;
  isAudioBeat?: boolean;
  isSpeechPause?: boolean;
  minShotDuration?: number;
  currentShotDuration?: number;
  clip?: { duration: number; text?: string };
  pauseSeconds?: number;
}): { shouldCut: boolean; confidence: number; reason: string; probability: number } {
  const pause = options.pauseSeconds ?? (options.isSpeechPause ? 0.9 : 0.2);
  const shotDur = options.currentShotDuration ?? options.clip?.duration ?? 1.5;
  const minDur = options.minShotDuration ?? 1.0;

  const decision = evaluateNoul(
    {
      shotDuration: shotDur,
      pauseSeconds: pause,
      isAudioBeat: options.isAudioBeat,
      isSpeechPause: options.isSpeechPause,
    },
    {
      type: 'noul',
      proposition: 'The speech pause or rhythmic beat aligns with a shot transition and duration permits a cut.',
    }
  );

  const durationPermits = shotDur >= minDur;
  const shouldCut = Boolean(decision.conditionMet && durationPermits);

  return {
    shouldCut,
    confidence: decision.probability,
    reason: shouldCut
      ? 'Rhythmic beat or pause detected with sufficient shot duration'
      : 'Insufficient shot duration or weak rhythm boundary',
    probability: decision.probability,
  };
}
