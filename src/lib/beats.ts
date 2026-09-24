// Beat detection from the waveform peaks Helios already keeps per asset (see peaks.ts): an onset
// envelope from the per-bucket levels, tempo by autocorrelation with a log-Gaussian prior around
// 120 BPM, then a beat grid phase-locked to the strongest transients. Everything is plain,
// deterministic arithmetic — no audio decoding, no dependencies — so it runs instantly in the
// webview on a 10-minute song (60 000 buckets × at most a few hundred lags).
import { BUCKETS_PER_SECOND, type Peaks } from './peaks';
import { clipEnd, neighbour, trimEdge } from './timeline';
import type { Clip, Comp } from './types';

export type TempoEstimate = { bpm: number; confidence: number; lag: number };
export type BeatGrid = { beats: number[]; phase: number; score: number };
export type BeatAnalysis = { bpm: number; confidence: number; beats: number[]; downbeats: number[]; duration: number };
export type BeatSnap = { time: number; snapped: number | null; delta: number };
export type BeatOptions = { minBpm?: number; maxBpm?: number; start?: number; end?: number };

/** Gain before log compression: levels below ~1/k of full scale are treated as quiet. */
const LOG_GAIN = 20;
/** The local-mean window subtracted from the onset strength, in seconds. */
const LOCAL_MEAN_WINDOW = 0.5;
/** How far a grid beat may move to sit on a real transient. */
const BEAT_REFINE_WINDOW = 0.035;
/** Centre and width (in octaves) of the tempo prior, as in librosa's tempo estimator. */
const PRIOR_BPM = 120;
const PRIOR_OCTAVES = 1;

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);

const compress = (byte: number) => Math.log1p((byte / 255) * LOG_GAIN) / Math.log1p(LOG_GAIN);

/**
 * Per-bucket onset strength, ≥ 0: how much louder each bucket is than the one before it, with
 * the slow level of the surrounding half second removed so sustained notes do not count and a
 * quiet passage's hits count as much as a loud one's. Both bytes contribute — rms for weight,
 * peak so that short sharp transients (a rimshot inside a pad) still register.
 */
export const onsetEnvelope = (peaks: Peaks): Float32Array => {
  const n = peaks.buckets;
  const raw = new Float32Array(n);
  let previousPeak = 0;
  let previousRms = 0;
  for (let index = 0; index < n; index++) {
    const peak = compress(peaks.data[index * 2]);
    const rms = compress(peaks.data[index * 2 + 1]);
    const risePeak = peak - previousPeak;
    const riseRms = rms - previousRms;
    raw[index] = Math.max(0, risePeak, riseRms);
    previousPeak = peak;
    previousRms = rms;
  }
  // Light 3-tap smoothing keeps a transient that straddles two buckets from reading as two.
  const smooth = new Float32Array(n);
  for (let index = 0; index < n; index++) {
    const before = index > 0 ? raw[index - 1] : raw[index];
    const after = index + 1 < n ? raw[index + 1] : raw[index];
    smooth[index] = 0.25 * before + 0.5 * raw[index] + 0.25 * after;
  }
  const half = Math.max(1, Math.round((LOCAL_MEAN_WINDOW * BUCKETS_PER_SECOND) / 2));
  const prefix = new Float64Array(n + 1);
  for (let index = 0; index < n; index++) prefix[index + 1] = prefix[index] + smooth[index];
  const envelope = new Float32Array(n);
  for (let index = 0; index < n; index++) {
    const from = Math.max(0, index - half);
    const to = Math.min(n, index + half + 1);
    const mean = (prefix[to] - prefix[from]) / (to - from);
    envelope[index] = Math.max(0, smooth[index] - mean);
  }
  return envelope;
};

/** Normalised autocorrelation (a correlation coefficient, −1..1) of `x` at every lag in [from, to]. */
const autocorrelate = (x: Float32Array, from: number, to: number): Float32Array => {
  const n = x.length;
  const acf = new Float32Array(to + 1);
  let variance = 0;
  for (let index = 0; index < n; index++) variance += x[index] * x[index];
  variance /= n;
  if (variance <= 0) return acf;
  for (let lag = from; lag <= to; lag++) {
    let sum = 0;
    for (let index = lag; index < n; index++) sum += x[index] * x[index - lag];
    acf[lag] = sum / (n - lag) / variance;
  }
  return acf;
};

const priorWeight = (bpm: number) => {
  const octaves = Math.log2(bpm / PRIOR_BPM) / PRIOR_OCTAVES;
  return Math.exp(-0.5 * octaves * octaves);
};

/** `acf` read at a fractional lag (linear), or 0 outside [from, to]. */
const acfAt = (acf: Float32Array, lag: number, from: number, to: number): number => {
  if (lag < from || lag > to) return 0;
  const low = Math.floor(lag);
  const high = Math.min(to, low + 1);
  const t = lag - low;
  return Math.max(0, acf[low] * (1 - t) + acf[high] * t);
};

/**
 * The tempo of an onset envelope sampled at `hz`, by autocorrelation over the lags that fall in
 * the BPM range. A log-Gaussian prior centred on 120 BPM breaks the usual half/double-time tie
 * the way a listener would, and a candidate whose octave partner is also strong is preferred
 * over a lone spike. The winning lag is refined by parabolic interpolation, so tempos whose
 * period is not a whole number of buckets come back accurately.
 */
export const estimateTempo = (envelope: Float32Array, hz: number, range = { min: 60, max: 190 }): TempoEstimate => {
  const n = envelope.length;
  const minBpm = Math.max(1, Math.min(range.min, range.max));
  const maxBpm = Math.max(range.min, range.max);
  const minLag = Math.max(1, Math.floor((hz * 60) / maxBpm));
  const maxLag = Math.max(minLag, Math.ceil((hz * 60) / minBpm));
  if (n < maxLag * 2 || maxLag < 2) return { bpm: 0, confidence: 0, lag: 0 };

  let mean = 0;
  for (let index = 0; index < n; index++) mean += envelope[index];
  mean /= n;
  const centred = new Float32Array(n);
  for (let index = 0; index < n; index++) centred[index] = envelope[index] - mean;
  const acf = autocorrelate(centred, minLag, maxLag);

  let bestLag = 0;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const strength = Math.max(0, acf[lag]) * priorWeight((hz * 60) / lag);
    // Octave support: the same pulse read at half or double speed, when that speed is in range.
    const support = Math.max(acfAt(acf, lag * 2, minLag, maxLag), acfAt(acf, lag / 2, minLag, maxLag));
    const score = strength * (1 + 0.5 * support);
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  if (bestLag === 0 || !(bestScore > 0)) return { bpm: 0, confidence: 0, lag: 0 };

  // Triplet aliases. A dotted-8th figure (3 sixteenths) over a 4/4 beat autocorrelates at 3/4 of
  // the beat, so a 90 BPM track reads as 120 (the aflow reference film did exactly that). The beat
  // has to divide the bar: find the strongest bar-length period (3–4 beats of the range) and, when
  // the pick does not fit it a whole number of times but its ×4/3 or ×3/4 alias does, take the alias.
  const wideTo = Math.min(Math.floor(n / 2), maxLag * 4);
  if (wideTo >= minLag * 3) {
    const wide = autocorrelate(centred, minLag, wideTo);
    let bar = 0;
    let barScore = 0;
    for (let l = Math.max(minLag * 3, Math.round((hz * 60 * 3) / maxBpm)); l <= wideTo; l++) {
      const peak = wide[l] >= wide[l - 1] && wide[l] >= (l + 1 <= wideTo ? wide[l + 1] : -1);
      if (peak && wide[l] > barScore) { barScore = wide[l]; bar = l; }
    }
    // A bar or two: 3, 4, 6 or 8 beats.
    const fits = (beat: number) => [3, 4, 6, 8].some((k) => Math.abs(bar / beat - k) < 0.04 * k);
    if (bar > 0 && barScore > 0.1 && !fits(bestLag) && !fits(bestLag * 2) && !fits(bestLag / 2)) {
      for (const ratio of [4 / 3, 3 / 4]) {
        const alias = bestLag * ratio;
        if (alias >= minLag && alias <= maxLag && fits(alias)) { bestLag = Math.round(alias); break; }
      }
    }
  }

  let lag = bestLag;
  if (bestLag > minLag && bestLag < maxLag) {
    const a = acf[bestLag - 1];
    const b = acf[bestLag];
    const c = acf[bestLag + 1];
    const denominator = a - 2 * b + c;
    if (denominator < 0) lag = bestLag + Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denominator));
  }
  let bandMean = 0;
  for (let index = minLag; index <= maxLag; index++) bandMean += acf[index];
  bandMean /= maxLag - minLag + 1;
  // The winning lag's correlation, less what the rest of the band shares: a lone spike over a
  // flat autocorrelation is a confident tempo, a broad hump is not.
  const confidence = clamp01(acf[bestLag] - Math.max(0, bandMean));
  return { bpm: (hz * 60) / lag, confidence, lag };
};

/**
 * A beat grid at `bpm` phase-locked to the envelope: the offset (in buckets, 0..period) whose
 * grid points collect the most onset strength, each beat then nudged onto the nearest local
 * maximum within ±35 ms so it sits on the transient rather than beside it. Beat times are in
 * seconds from the start of the envelope.
 */
export const beatGrid = (envelope: Float32Array, hz: number, bpm: number): BeatGrid => {
  const n = envelope.length;
  if (!(bpm > 0) || n === 0) return { beats: [], phase: 0, score: 0 };
  const period = (hz * 60) / bpm;
  const steps = Math.max(1, Math.ceil(period));
  // ±1 bucket of tolerance, with the exact bucket worth more so a dead-on phase beats a near miss.
  const nearby = (index: number) => {
    let best = envelope[index];
    if (index > 0 && 0.75 * envelope[index - 1] > best) best = 0.75 * envelope[index - 1];
    if (index + 1 < n && 0.75 * envelope[index + 1] > best) best = 0.75 * envelope[index + 1];
    return best;
  };
  let phase = 0;
  let bestSum = -1;
  for (let candidate = 0; candidate < steps; candidate++) {
    let sum = 0;
    for (let at = candidate; at < n; at += period) sum += nearby(Math.round(at));
    if (sum > bestSum) {
      bestSum = sum;
      phase = candidate;
    }
  }
  let top = 0;
  for (let index = 0; index < n; index++) if (envelope[index] > top) top = envelope[index];
  const reach = Math.round(BEAT_REFINE_WINDOW * hz);
  const count = Math.max(1, Math.ceil((n - phase) / period));
  // A beat only moves onto a maximum worth moving to; where the grid meets nothing (a break, the
  // tail of the clip) it stays put rather than chasing noise.
  const worthwhile = 0.2 * (bestSum / count);
  const beats: number[] = [];
  for (let at = phase; at < n; at += period) {
    const grid = Math.round(at);
    let bucket = grid;
    for (let probe = Math.max(0, grid - reach); probe <= Math.min(n - 1, grid + reach); probe++) {
      if (envelope[probe] < worthwhile) continue;
      if (envelope[probe] > envelope[bucket] || (envelope[probe] === envelope[bucket] && Math.abs(probe - grid) < Math.abs(bucket - grid))) bucket = probe;
    }
    if (beats.length === 0 || bucket / hz > beats[beats.length - 1]) beats.push(bucket / hz);
  }
  const score = top > 0 ? clamp01(bestSum / count / top) : 0;
  return { beats, phase, score };
};

/**
 * Re-estimates the beat period from where the beats actually landed: a weighted least-squares
 * line through (index, time), weighted by onset strength so beats that fell on nothing do not
 * pull it. Corrects the coarse lag resolution (a tenth of a bucket per beat adds up over a song).
 */
const fitPeriod = (beats: number[], envelope: Float32Array, hz: number): number | null => {
  if (beats.length < 4) return null;
  let sw = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let index = 0; index < beats.length; index++) {
    const bucket = Math.min(envelope.length - 1, Math.round(beats[index] * hz));
    const w = envelope[bucket] + 1e-6;
    sw += w;
    sx += w * index;
    sy += w * beats[index];
    sxx += w * index * index;
    sxy += w * index * beats[index];
  }
  const denominator = sw * sxx - sx * sx;
  if (!(denominator > 0)) return null;
  const slope = (sw * sxy - sx * sy) / denominator;
  return slope > 0 ? slope : null;
};

const sliceOf = (peaks: Peaks, start: number, end: number): Peaks => {
  const first = Math.max(0, Math.min(peaks.buckets, Math.floor(start * BUCKETS_PER_SECOND)));
  const last = Math.max(first, Math.min(peaks.buckets, Math.ceil(end * BUCKETS_PER_SECOND)));
  return { data: peaks.data.subarray(first * 2, last * 2), buckets: last - first };
};

/**
 * Tempo, beats and downbeats of `peaks` (or of the [start, end] seconds of it). Beat times are in
 * source seconds. Downbeats are every fourth beat, counted from the strongest of the first four.
 */
export const detectBeats = (peaks: Peaks, options: BeatOptions = {}): BeatAnalysis => {
  const hz = BUCKETS_PER_SECOND;
  const start = Math.max(0, options.start ?? 0);
  const end = Math.min(peaks.buckets / hz, options.end ?? peaks.buckets / hz);
  const slice = sliceOf(peaks, start, end);
  const offset = Math.floor(start * hz) / hz;
  const duration = slice.buckets / hz;
  const range = { min: options.minBpm ?? 60, max: options.maxBpm ?? 190 };
  const empty = { bpm: 0, confidence: 0, beats: [], downbeats: [], duration };
  if (slice.buckets === 0) return empty;

  const envelope = onsetEnvelope(slice);
  const tempo = estimateTempo(envelope, hz, range);
  if (!(tempo.bpm > 0)) return empty;

  let bpm = tempo.bpm;
  let grid = beatGrid(envelope, hz, bpm);
  const fitted = fitPeriod(grid.beats, envelope, hz);
  if (fitted !== null) {
    const refined = 60 / fitted;
    // Only trust the fit when it is a small correction to the autocorrelation tempo.
    if (Math.abs(refined - bpm) / bpm < 0.08 && refined >= range.min && refined <= range.max) {
      bpm = refined;
      grid = beatGrid(envelope, hz, bpm);
    }
  }
  const strengthAt = (time: number) => envelope[Math.min(envelope.length - 1, Math.round(time * hz))];
  let first = 0;
  for (let index = 1; index < Math.min(4, grid.beats.length); index++) {
    if (strengthAt(grid.beats[index]) > strengthAt(grid.beats[first])) first = index;
  }
  const beats = grid.beats.map((time) => time + offset);
  const downbeats = beats.filter((_, index) => index >= first && (index - first) % 4 === 0);
  return { bpm, confidence: tempo.confidence, beats, downbeats, duration };
};

/** The index of the first beat at or after `t` (or `beats.length`). */
const lowerBound = (beats: number[], t: number): number => {
  let low = 0;
  let high = beats.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (beats[mid] < t) low = mid + 1;
    else high = mid;
  }
  return low;
};

/**
 * Each time moved to the nearest beat within `tolerance` seconds, or left alone (`snapped` null).
 * `delta` is the signed distance to that nearest beat either way (0 when there are no beats).
 */
export const snapTimesToBeats = (times: number[], beats: number[], tolerance: number): BeatSnap[] =>
  times.map((time) => {
    if (beats.length === 0) return { time, snapped: null, delta: 0 };
    const after = lowerBound(beats, time);
    const candidates = [beats[after - 1], beats[after]].filter((beat): beat is number => beat !== undefined);
    let nearest = candidates[0];
    for (const beat of candidates) if (Math.abs(beat - time) < Math.abs(nearest - time)) nearest = beat;
    const delta = nearest - time;
    return { time, snapped: Math.abs(delta) <= tolerance ? nearest : null, delta };
  });

/** The first beat at least `minGap` seconds after `t`, or null when none is left. */
export const nearestBeatAfter = (beats: number[], t: number, minGap = 0): number | null => {
  const index = lowerBound(beats, t + Math.max(0, minGap));
  return index < beats.length ? beats[index] : null;
};

/**
 * The downbeat (bar line) nearest `t`, for landing a music stinger: `grid` is a BeatAnalysis or
 * its downbeat times. Null when there are none, or none within `maxDistance` seconds.
 */
export const nearestDownbeat = (t: number, grid: number[] | Pick<BeatAnalysis, 'downbeats'>, maxDistance = Infinity): number | null => {
  const downbeats = Array.isArray(grid) ? grid : grid.downbeats;
  if (!downbeats.length) return null;
  return snapTimesToBeats([t], downbeats, maxDistance)[0].snapped;
};

/** One edit point that moved onto a beat. `roll`: a butt cut, both sides moved together. */
export type CutSnap = { clipId: string; name: string; edge: 'start' | 'end'; from: number; to: number; mode: 'roll' | 'trim' | 'move'; partnerId?: string };

export type SnapCutsOptions = {
  /** How far (seconds) an edge may move to reach a beat. */
  tolerance: number;
  /** Clips whose edges may move (every clip when omitted); a butt cut moves when either side is listed. */
  only?: ReadonlySet<string> | null;
  /** Seconds of source each clip has (timeline `sourceLimit`), so an edge never runs past its media. */
  limit: (clip: Clip) => number;
  /** Shortest a clip may become (default 0.2 s). */
  minDuration?: number;
};

/**
 * Moves the cuts on unlocked video tracks onto the nearest beat within `tolerance` (the fix for
 * WORLD-CLASS-PLAN C1, where every snapped butt cut opened a 1–4-frame black gap because the two
 * clips' edges were trimmed independently against a stale snapshot). Here:
 * - a butt cut is ONE edit point and is rolled — the outgoing tail and the incoming head move
 *   together (`trimEdge` 'rolling', alone), so the clips stay joined; linked audio stays put and
 *   the cut becomes a short J/L split;
 * - a free edge (beside a gap) is trimmed ('normal': never over a neighbour, never past its media);
 * - a non-media overlay whose edges are both free is moved whole, never onto a neighbour;
 * - an edge at 0, already within a frame of its beat, or whose move would not land on the beat
 *   (media too short, a neighbour in the way) stays where it is.
 * Every edit is applied to the live comp, one edit point at a time.
 */
export function snapCutsToBeats(comp: Comp, beats: number[], options: SnapCutsOptions): { comp: Comp; changes: CutSnap[] } {
  const frame = 1 / (comp.fps || 30);
  const minDuration = options.minDuration ?? 0.2;
  const may = (id: string) => !options.only || options.only.has(id);
  const target = (time: number): number | null => {
    const snap = snapTimesToBeats([time], beats, options.tolerance)[0];
    return snap.snapped !== null && Math.abs(snap.delta) > frame ? snap.snapped : null;
  };
  const lands = (value: number | undefined, beat: number) => value !== undefined && Math.abs(value - beat) < 1e-6;
  const find = (state: Comp, id: string) => state.clips.find((clip) => clip.id === id);
  let next = comp;
  const changes: CutSnap[] = [];
  for (const track of comp.tracks.filter((t) => t.kind === 'video' && !t.locked)) {
    const order = comp.clips.filter((clip) => clip.trackId === track.id && clip.enabled).sort((a, b) => a.start - b.start).map((clip) => clip.id);
    for (const id of order) {
      const clip = find(next, id);
      if (!clip) continue;
      const name = clip.name ?? clip.id;
      const previous = neighbour(next.clips, clip, 'before');
      const after = neighbour(next.clips, clip, 'after');
      // The head: a roll when it butts the clip before, else a trim or (overlays) a move.
      const head = clip.start > 1e-6 ? target(clip.start) : null;
      if (head !== null && previous && (may(clip.id) || may(previous.id))) {
        const trial = trimEdge(next, previous.id, 'out', head, 'rolling', options.limit, { alone: true, minDuration });
        const outgoing = find(trial, previous.id);
        if (outgoing && lands(clipEnd(outgoing), head) && lands(find(trial, clip.id)?.start, head)) {
          next = trial;
          changes.push({ clipId: clip.id, name, edge: 'start', from: clip.start, to: head, mode: 'roll', partnerId: previous.id });
        }
      } else if (head !== null && !previous && may(clip.id)) {
        if (clip.source.type !== 'media' && !after) {
          const others = next.clips.filter((other) => other.trackId === clip.trackId && other.id !== clip.id);
          const clear = others.every((other) => clipEnd(other) <= head + 1e-6 || other.start >= head + clip.duration - 1e-6);
          if (clear) {
            next = { ...next, clips: next.clips.map((c) => (c.id === clip.id ? { ...c, start: head } : c)) };
            changes.push({ clipId: clip.id, name, edge: 'start', from: clip.start, to: head, mode: 'move' });
          }
        } else {
          const trial = trimEdge(next, clip.id, 'in', head, 'normal', options.limit, { alone: true, minDuration });
          if (lands(find(trial, clip.id)?.start, head)) {
            next = trial;
            changes.push({ clipId: clip.id, name, edge: 'start', from: clip.start, to: head, mode: 'trim' });
          }
        }
      }
      // The tail, only when free (a butted tail is the next clip's head) and only for media.
      const current = find(next, id);
      if (!current || current.source.type !== 'media' || neighbour(next.clips, current, 'after') || !may(current.id)) continue;
      const end = clipEnd(current);
      const tail = target(end);
      if (tail === null) continue;
      const trial = trimEdge(next, current.id, 'out', tail, 'normal', options.limit, { alone: true, minDuration });
      const trimmed = find(trial, current.id);
      if (trimmed && lands(clipEnd(trimmed), tail)) {
        next = trial;
        changes.push({ clipId: current.id, name, edge: 'end', from: end, to: tail, mode: 'trim' });
      }
    }
  }
  return { comp: next, changes };
}

export type MusicStructure = {
  /** Bar lines (the downbeats), source seconds. */
  bars: number[];
  /** Every 4th bar line, phased to where the energy changes most: where big world changes land. */
  phrases: number[];
  /** Bars that come in ≥ 4 dB louder than the two before them (the drop). */
  drops: number[];
  /** Bars that fall ≥ 8 dB below the two before them (a break or the music stopping). */
  stops: number[];
  /** Mean loudness of each bar, dBFS (rms). */
  barLoudness: number[];
};

/**
 * Bars, 4-bar phrases, drops and stops from the beat analysis and the waveform: what the
 * reference films cut to (aflow: the three biggest events sit on phrase lines within 2 frames;
 * Virgil: the dark world starts on the drop).
 */
export function musicStructure(peaks: Peaks, analysis: BeatAnalysis, start = 0): MusicStructure {
  const bars = analysis.downbeats;
  const empty: MusicStructure = { bars, phrases: [], drops: [], stops: [], barLoudness: [] };
  if (bars.length < 2) return empty;
  const hz = BUCKETS_PER_SECOND;
  const rmsAt = (t: number) => { const i = Math.floor(t * hz); return i >= 0 && i < peaks.buckets ? peaks.data[i * 2 + 1] / 255 : 0; };
  const barLen = bars[1] - bars[0];
  const loud = bars.map((b) => {
    let sum = 0, n = 0;
    for (let t = b; t < b + barLen; t += 1 / hz) { const v = rmsAt(t - start); sum += v * v; n++; }
    return 20 * Math.log10(Math.sqrt(sum / Math.max(1, n)) + 1e-6);
  });
  const change = loud.map((l, i) => (i ? Math.abs(l - loud[i - 1]) : 0));
  // Phrase phase: of the four ways to group bars in fours, the one whose lines see the most change.
  let phase = 0, best = -1;
  for (let p = 0; p < 4; p++) { let s = 0; for (let i = p; i < bars.length; i += 4) s += change[i]; if (s > best) { best = s; phase = p; } }
  const phrases = bars.filter((_, i) => i >= phase && (i - phase) % 4 === 0);
  const drops: number[] = [];
  const stops: number[] = [];
  for (let i = 2; i < bars.length; i++) {
    const before = (loud[i - 1] + loud[i - 2]) / 2;
    if (loud[i] - before >= 4 && (i + 1 >= bars.length || loud[i + 1] - before >= 2)) drops.push(bars[i]);
    if (before - loud[i] >= 8) stops.push(bars[i]);
  }
  return { bars, phrases, drops, stops, barLoudness: loud.map((l) => Math.round(l * 10) / 10) };
}
