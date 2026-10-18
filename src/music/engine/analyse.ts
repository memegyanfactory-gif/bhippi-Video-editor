// Measures a rendered buffer for the mix analyser (docs/MUSIC-STUDIO-PLAN.md §3.11): peak, RMS, approximate
// loudness (ITU-R BS.1770 K-weighting with 400 ms blocks and the two gates), the share of energy in five
// bands, left/right correlation and a per-second RMS list. Works on an AudioBuffer or a plain
// `{ channels, sampleRate }`, so it runs (and is tested) without any Web Audio.
import type { BufferAnalysis } from './api';
import { channelsOf, type PcmSource } from './wav';

const FLOOR_DB = -120;
const db = (amplitude: number): number => (amplitude <= 0 ? FLOOR_DB : Math.max(FLOOR_DB, 20 * Math.log10(amplitude)));

/** A biquad as [b0, b1, b2, a1, a2] (a0 normalised to 1). */
type Biquad = [number, number, number, number, number];

/** The K-weighting filter pair for a sample rate (BS.1770: a high shelf, then the RLB high-pass). */
function kWeighting(fs: number): Biquad[] {
  const shelf = ((): Biquad => {
    const A = Math.pow(10, 3.99984385397 / 40);
    const w0 = (2 * Math.PI * 1681.9744509555319) / fs;
    const alpha = Math.sin(w0) / (2 * 0.7071752369554193);
    const cos = Math.cos(w0);
    const sq = 2 * Math.sqrt(A) * alpha;
    const a0 = A + 1 - (A - 1) * cos + sq;
    return [
      (A * (A + 1 + (A - 1) * cos + sq)) / a0, (-2 * A * (A - 1 + (A + 1) * cos)) / a0, (A * (A + 1 + (A - 1) * cos - sq)) / a0,
      (2 * (A - 1 - (A + 1) * cos)) / a0, (A + 1 - (A - 1) * cos - sq) / a0,
    ];
  })();
  const high = ((): Biquad => {
    const w0 = (2 * Math.PI * 38.13547087613982) / fs;
    const alpha = Math.sin(w0) / (2 * 0.5003270373238773);
    const cos = Math.cos(w0);
    const a0 = 1 + alpha;
    return [(1 + cos) / 2 / a0, -(1 + cos) / a0, (1 + cos) / 2 / a0, (-2 * cos) / a0, (1 - alpha) / a0];
  })();
  return [shelf, high];
}

/** A Butterworth-style 2-pole low-pass at `fc`. */
function lowpass(fs: number, fc: number): Biquad {
  const w0 = (2 * Math.PI * Math.min(fc, fs * 0.45)) / fs;
  const alpha = Math.sin(w0) / (2 * Math.SQRT1_2);
  const cos = Math.cos(w0);
  const a0 = 1 + alpha;
  return [(1 - cos) / 2 / a0, (1 - cos) / a0, (1 - cos) / 2 / a0, (-2 * cos) / a0, (1 - alpha) / a0];
}

/** A 2-pole high-pass at `fc`. */
function highpass(fs: number, fc: number): Biquad {
  const w0 = (2 * Math.PI * Math.min(fc, fs * 0.45)) / fs;
  const alpha = Math.sin(w0) / (2 * Math.SQRT1_2);
  const cos = Math.cos(w0);
  const a0 = 1 + alpha;
  return [(1 + cos) / 2 / a0, -(1 + cos) / a0, (1 + cos) / 2 / a0, (-2 * cos) / a0, (1 - alpha) / a0];
}

class Filter {
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  constructor(private readonly c: Biquad) {}
  run(x: number): number {
    const c = this.c;
    const y = c[0] * x + c[1] * this.x1 + c[2] * this.x2 - c[3] * this.y1 - c[4] * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** Mean square of the K-weighted channel in consecutive segments of `seg` samples. */
function segmentEnergies(x: Float32Array, coefs: Biquad[], seg: number): number[] {
  const filters = coefs.map((c) => new Filter(c));
  const out: number[] = [];
  let acc = 0;
  let count = 0;
  for (let i = 0; i < x.length; i++) {
    let v = x[i];
    for (const f of filters) v = f.run(v);
    acc += v * v;
    if (++count === seg) {
      out.push(acc / seg);
      acc = 0;
      count = 0;
    }
  }
  if (count >= seg / 2 || (!out.length && count > 0)) out.push(acc / count);
  return out;
}

/** Integrated loudness (LUFS), approximate: K-weighted, 400 ms blocks every 100 ms, absolute -70 and relative -10 gates. */
function loudness(channels: Float32Array[], fs: number): number {
  const seg = Math.max(1, Math.round(fs * 0.1));
  const coefs = kWeighting(fs);
  const perChannel = channels.map((c) => segmentEnergies(c, coefs, seg));
  const segs = Math.min(...perChannel.map((s) => s.length));
  if (!Number.isFinite(segs) || segs <= 0) return -70;
  const blocks: number[] = [];
  const span = Math.min(4, segs);
  for (let j = 0; j + span <= segs; j++) {
    let z = 0;
    for (const s of perChannel) {
      let sum = 0;
      for (let k = 0; k < span; k++) sum += s[j + k];
      z += sum / span;
    }
    blocks.push(z);
  }
  const lufs = (z: number) => -0.691 + 10 * Math.log10(z);
  const absolute = blocks.filter((z) => z > 0 && lufs(z) > -70);
  if (!absolute.length) return -70;
  const mean = (zs: number[]) => zs.reduce((a, b) => a + b, 0) / zs.length;
  const threshold = lufs(mean(absolute)) - 10;
  const gated = absolute.filter((z) => lufs(z) > threshold);
  return gated.length ? lufs(mean(gated)) : lufs(mean(absolute));
}

/** Share of energy in sub (<60 Hz), low (60–250), low-mid (250–2k), mid (2k–6k) and high (>6k): band-pass cascades on the mono sum. */
function bandEnergies(channels: Float32Array[], fs: number): BufferAnalysis['bands'] {
  const frames = channels[0]?.length ?? 0;
  const edges = [60, 250, 2000, 6000];
  // Band b runs from edges[b - 1] up to edges[b]: a high-pass (except the lowest) then a low-pass (except the highest).
  const bands = Array.from({ length: 5 }, (_, b) => ({
    high: b > 0 ? new Filter(highpass(fs, edges[b - 1])) : null,
    low: b < 4 ? new Filter(lowpass(fs, edges[b])) : null,
  }));
  const energy = [0, 0, 0, 0, 0];
  for (let i = 0; i < frames; i++) {
    let x = 0;
    for (const c of channels) x += c[i];
    x /= channels.length;
    bands.forEach((band, b) => {
      let v = x;
      if (band.high) v = band.high.run(v);
      if (band.low) v = band.low.run(v);
      energy[b] += v * v;
    });
  }
  const total = energy.reduce((a, b) => a + b, 0);
  const share = (e: number) => (total > 0 ? e / total : 0);
  return { sub: share(energy[0]), low: share(energy[1]), lowMid: share(energy[2]), mid: share(energy[3]), high: share(energy[4]) };
}

export function analyseBuffer(buffer: PcmSource): BufferAnalysis {
  const { channels, sampleRate } = channelsOf(buffer);
  const frames = channels.reduce((n, c) => Math.max(n, c.length), 0);
  if (!channels.length || !frames) {
    return { peakDb: FLOOR_DB, rmsDb: FLOOR_DB, lufs: -70, clipped: false, bands: { sub: 0, low: 0, lowMid: 0, mid: 0, high: 0 }, correlation: 1, windows: [] };
  }
  let peak = 0;
  let sumSquares = 0;
  for (const c of channels) {
    for (let i = 0; i < c.length; i++) {
      const a = Math.abs(c[i]);
      if (a > peak) peak = a;
      sumSquares += c[i] * c[i];
    }
  }
  let correlation = 1;
  if (channels.length > 1) {
    const [l, r] = channels;
    let lr = 0;
    let ll = 0;
    let rr = 0;
    for (let i = 0; i < frames; i++) {
      lr += l[i] * r[i];
      ll += l[i] * l[i];
      rr += r[i] * r[i];
    }
    correlation = ll > 0 && rr > 0 ? Math.max(-1, Math.min(1, lr / Math.sqrt(ll * rr))) : 1;
  }
  const windows: number[] = [];
  const size = Math.max(1, Math.round(sampleRate));
  for (let start = 0; start < frames; start += size) {
    const end = Math.min(frames, start + size);
    if (end - start < size / 4 && windows.length) break;
    let sum = 0;
    for (const c of channels) for (let i = start; i < end; i++) sum += c[i] * c[i];
    windows.push(db(Math.sqrt(sum / ((end - start) * channels.length))));
  }
  return {
    peakDb: db(peak), rmsDb: db(Math.sqrt(sumSquares / (frames * channels.length))), lufs: loudness(channels, sampleRate),
    clipped: peak >= 0.999, bands: bandEnergies(channels, sampleRate), correlation, windows,
  };
}
