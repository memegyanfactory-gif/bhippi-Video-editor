// A reference film's measured motion (workers/reference_motion.py) turned into what the AI plans
// with: the tempo grid from its audio (the app's own beat tracker, beats.ts), how many cuts land on
// a beat against the chance baseline, and a pacing target (±25% of what was measured) that
// check_pacing holds a new edit to. docs/REFERENCE-FILMS-PLAN.md P10, B4.
import { detectBeats, musicStructure } from './beats';
import type { Peaks } from './peaks';
import type { PacingTarget } from './pacing';

export type MotionProfile = {
  fps: number;
  seconds: number;
  cuts: { t: number; kind: 'hard' | 'white-out' | 'black' | 'blur-bridge' | 'whip' }[];
  hiddenCuts: number;
  swaps: number[];
  cadence: { events: number; medianGap: number; meanGap: number };
  moves: { t: number; frames: number; ease: number[]; named: string; fitError: number; basis: 'camera' | 'energy'; twos: boolean }[];
  moveFrames: { median: number; p25: number; p75: number };
  eases: Record<string, number>;
  twosShare: number;
  camera: { share: number; track: number[][] };
  stillShare: number;
};

export type ProfileSummary = {
  tempo: { bpm: number; confidence: number; phrases: number[]; drops: number[] } | null;
  cutSync: { onBeat: number; events: number; share: number; chance: number } | null;
  pacingTarget: PacingTarget;
  headline: string;
};

/** Share of `times` within `tolerance` of a beat, and the share chance alone would give. */
export function beatSync(times: number[], beats: number[], tolerance: number): { onBeat: number; share: number; chance: number } {
  if (!times.length || beats.length < 2) return { onBeat: 0, share: 0, chance: 0 };
  const period = (beats[beats.length - 1] - beats[0]) / (beats.length - 1);
  let onBeat = 0;
  for (const t of times) {
    let lo = 0;
    let hi = beats.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (beats[mid] < t) lo = mid + 1; else hi = mid; }
    const near = Math.min(Math.abs(beats[lo] - t), lo > 0 ? Math.abs(beats[lo - 1] - t) : Infinity);
    if (near <= tolerance) onBeat++;
  }
  return { onBeat, share: onBeat / times.length, chance: Math.min(1, (2 * tolerance) / Math.max(1e-3, period)) };
}

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export function summarizeProfile(profile: MotionProfile, peaks: Peaks | null): ProfileSummary {
  const events = [...profile.cuts.map((c) => c.t), ...profile.swaps].sort((a, b) => a - b);
  let tempo: ProfileSummary['tempo'] = null;
  let cutSync: ProfileSummary['cutSync'] = null;
  if (peaks && peaks.buckets > 400) {
    const analysis = detectBeats(peaks);
    if (analysis.bpm > 0 && analysis.beats.length > 4) {
      const structure = musicStructure(peaks, analysis);
      tempo = { bpm: round(analysis.bpm, 1), confidence: round(analysis.confidence), phrases: structure.phrases.map((p) => round(p)), drops: structure.drops.map((d) => round(d)) };
      const sync = beatSync(events, analysis.beats, 2 / profile.fps);
      cutSync = { ...sync, events: events.length, share: round(sync.share), chance: round(sync.chance) };
    }
  }
  const gap = profile.cadence.medianGap;
  const topEases = Object.entries(profile.eases).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name]) => name);
  const pacingTarget: PacingTarget = {
    swapGap: [round(gap * 0.75), round(gap * 1.25)],
    entrance: [Math.max(2, Math.round(profile.moveFrames.p25 * 0.75)), Math.round(profile.moveFrames.p75 * 1.25)],
    ...(cutSync && cutSync.share > cutSync.chance * 1.5 ? { beatSync: round(cutSync.share * 0.75) } : {}),
    ...(topEases.length ? { eases: topEases } : {}),
  };
  const kinds = profile.cuts.filter((c) => c.kind !== 'hard').map((c) => c.kind);
  const headline = [
    `${profile.seconds.toFixed(1)} s: ${profile.cuts.length} cut${profile.cuts.length === 1 ? '' : 's'} (${profile.hiddenCuts} hidden${kinds.length ? `: ${[...new Set(kinds)].join(', ')}` : ''}) and ${profile.swaps.length} foreground swap${profile.swaps.length === 1 ? '' : 's'}, something new every ${gap.toFixed(2)} s (median).`,
    `Moves last ${profile.moveFrames.p25}–${profile.moveFrames.p75} frames (median ${profile.moveFrames.median})${topEases.length ? `; camera moves ease like ${topEases.join(', ')}` : ''}.`,
    `The camera moves ${Math.round(profile.camera.share * 100)}% of the time; ${Math.round(profile.stillShare * 100)}% of frames are still${profile.twosShare > 0.3 ? `; ${Math.round(profile.twosShare * 100)}% of moves are animated on twos` : ''}.`,
    tempo ? `Music ${tempo.bpm} BPM (confidence ${tempo.confidence})${cutSync ? `; ${cutSync.onBeat}/${cutSync.events} cuts and swaps land within 2 frames of a beat (${Math.round(cutSync.share * 100)}% vs ${Math.round(cutSync.chance * 100)}% by chance)` : ''}.` : 'No music tempo measured.',
  ].join(' ');
  return { tempo, cutSync, pacingTarget, headline };
}
