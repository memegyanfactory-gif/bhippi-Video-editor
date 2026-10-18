// Automation (docs/MUSIC-STUDIO-PLAN.md §3.9): evaluating a point curve, mapping its 0–1 value onto the
// target's real range, and sampling the playlist's automation clips for the scheduler and the bounce.
//
// A clip plays its automation from `clip.offset` for `clip.length` steps; outside any clip a parameter keeps
// whatever it last held. Automation only runs in song mode (the playlist is the timeline it lives on).
import { EFFECT_SPECS, INSTRUMENT_SPECS, type Automation, type AutomationCurve, type AutomationTarget, type MusicProject, type ParamSpec, type PlaylistClip } from '../types';

/** What 0 and 1 mean for a tempo automation, in BPM. */
export const TEMPO_RANGE = { min: 20, max: 300 } as const;

const ease = (curve: AutomationCurve | undefined, u: number): number => {
  switch (curve) {
    case 'hold': return 0;
    case 'smooth': return u * u * (3 - 2 * u);
    case 'exp': return (Math.exp(3 * u) - 1) / (Math.exp(3) - 1);
    default: return u;
  }
};

/**
 * The curve's value (0–1) at a step. Before the first point it holds the first value, after the last it
 * holds the last; each point's `curve` shapes the segment that starts at it. An empty curve is 0.
 */
export function automationValueAt(automation: Pick<Automation, 'points'>, step: number): number {
  let points = automation.points;
  if (!points.length) return 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i].t < points[i - 1].t) {
      points = [...points].sort((a, b) => a.t - b.t);
      break;
    }
  }
  const last = points.length - 1;
  if (step <= points[0].t) return clamp01(points[0].v);
  if (step >= points[last].t) return clamp01(points[last].v);
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t <= step) lo = mid;
    else hi = mid;
  }
  const a = points[lo];
  const b = points[hi];
  const span = b.t - a.t;
  if (span < 1e-9) return clamp01(b.v);
  return clamp01(a.v + (b.v - a.v) * ease(a.curve, (step - a.t) / span));
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

export type AutomationRange = { min: number; max: number; /** Quantise to multiples of this (discrete params). */ quant?: number };

const specRange = (spec: ParamSpec | undefined): AutomationRange => (spec ? { min: spec.min, max: spec.max, ...(spec.step ? { quant: spec.step } : {}) } : { min: 0, max: 1 });

/** The real range a target's 0–1 automation value spans. */
export function automationRange(song: MusicProject, target: AutomationTarget): AutomationRange {
  switch (target.kind) {
    case 'tempo': return { ...TEMPO_RANGE };
    case 'send': return { min: 0, max: 1.25 };
    case 'insert': return target.param === 'volume' ? { min: -60, max: 6 } : target.param === 'pan' ? { min: -1, max: 1 } : { min: 0, max: 2 };
    case 'effect': {
      const effect = song.mixer.inserts[target.insert]?.effects.find((e) => e.id === target.effectId);
      return effect ? specRange(EFFECT_SPECS[effect.type]?.params.find((s) => s.name === target.param)) : { min: 0, max: 1 };
    }
    case 'channel': {
      if (target.param === 'volume') return { min: 0, max: 1.25 };
      if (target.param === 'pan') return { min: -1, max: 1 };
      const channel = song.channels.find((c) => c.id === target.channelId);
      return channel ? specRange(INSTRUMENT_SPECS[channel.instrument].params.find((s) => s.name === target.param)) : { min: 0, max: 1 };
    }
  }
}

/** A 0–1 automation value as the target's real value. */
export function automationDenormalise(range: AutomationRange, v: number): number {
  const value = range.min + clamp01(v) * (range.max - range.min);
  return range.quant ? Math.min(range.max, Math.max(range.min, Math.round(value / range.quant) * range.quant)) : value;
}

export const targetKey = (t: AutomationTarget): string => {
  switch (t.kind) {
    case 'tempo': return 'tempo';
    case 'send': return `send:${t.insert}:${t.to}`;
    case 'insert': return `insert:${t.insert}:${t.param}`;
    case 'effect': return `effect:${t.insert}:${t.effectId}:${t.param}`;
    case 'channel': return `channel:${t.channelId}:${t.param}`;
  }
};

export type AutomationPlan = Array<{ clip: PlaylistClip; automation: Automation; key: string; range: AutomationRange }>;
export type AutoSample = { key: string; target: AutomationTarget; /** The real value (not 0–1). */ value: number };

/** The song's automation clips joined to their curves and ranges (built once per song, sampled many times). */
export function planAutomation(song: MusicProject): AutomationPlan {
  const plan: AutomationPlan = [];
  for (const clip of song.playlist.clips) {
    if (clip.kind !== 'automation' || clip.muted || !clip.automationId) continue;
    const automation = song.automations.find((a) => a.id === clip.automationId);
    if (automation) plan.push({ clip, automation, key: targetKey(automation.target), range: automationRange(song, automation.target) });
  }
  return plan.sort((a, b) => a.clip.start - b.clip.start);
}

const valueIn = (item: AutomationPlan[number], step: number): number => automationDenormalise(item.range, automationValueAt(item.automation, Math.min(step, item.clip.start + item.clip.length) - item.clip.start + item.clip.offset));

/** Every automated target's value at a step (only clips covering the step; a later clip wins a clash). */
export function sampleAutomation(plan: AutomationPlan, step: number): AutoSample[] {
  const best = new Map<string, AutoSample>();
  for (const item of plan) {
    if (step < item.clip.start || step > item.clip.start + item.clip.length) continue;
    best.set(item.key, { key: item.key, target: item.automation.target, value: valueIn(item, step) });
  }
  return [...best.values()];
}

/** The instrument params automated on a channel at a step (volume / pan live on the mixer strip, not here). */
export function channelParamsAt(plan: AutomationPlan, channelId: string, step: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of plan) {
    const t = item.automation.target;
    if (t.kind !== 'channel' || t.channelId !== channelId || t.param === 'volume' || t.param === 'pan') continue;
    if (step < item.clip.start) continue;
    out[t.param] = valueIn(item, step);
  }
  return out;
}

/** The tempo at a step: the latest tempo clip that has started (holding its end value after it), else the song's. */
export function tempoAt(plan: AutomationPlan, baseBpm: number, step: number): number {
  let bpm = baseBpm;
  for (const item of plan) {
    if (item.automation.target.kind !== 'tempo' || step < item.clip.start) continue;
    bpm = valueIn(item, step);
  }
  return bpm;
}

/**
 * Applies the automation that falls in [from, to) to the mixer, sampled at 1/8 step: `timeOf` maps a step
 * to the context time it plays at. Only changed values are written. Instrument params and tempo are not
 * written here (notes read them when they are scheduled, the tempo map reads the tempo).
 */
export function scheduleAutomation(
  plan: AutomationPlan,
  graph: { automate(target: AutomationTarget, value: number, when: number): void },
  from: number,
  to: number,
  timeOf: (step: number) => number,
  last: Map<string, number>,
): void {
  if (!plan.length) return;
  for (let s = from; s < to - 1e-9; s += 0.125) {
    for (const sample of sampleAutomation(plan, s)) {
      const t = sample.target;
      if (t.kind === 'tempo' || (t.kind === 'channel' && t.param !== 'volume' && t.param !== 'pan')) continue;
      if (last.get(sample.key) === sample.value) continue;
      last.set(sample.key, sample.value);
      graph.automate(t, sample.value, timeOf(s));
    }
  }
}
