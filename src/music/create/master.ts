// Makes a generated song release-ready: decoded in the webview, cleaned under 28 Hz, glued with a
// gentle bus compressor, given a 2.5 kHz pocket when it plays under a voice, normalised to
// -14 LUFS (streaming and YouTube) and held under -1 dBTP by a look-ahead limiter, then written as
// a 24-bit WAV. The beat grid is read from the result on the way out, so the song snaps to cuts
// without another analysis. Web Audio does the filtering; loudness and limiting are plain maths.
import { detectBeats, type BeatAnalysis } from '../../lib/beats';
import { BUCKETS_PER_SECOND, type Peaks } from '../../lib/peaks';
import { analyseBuffer } from '../engine/analyse';
import { encodeWav } from '../engine/wav';

export type MasterOptions = {
  /** A bed under a voice-over gets a presence pocket for the voice. */
  purpose: 'song' | 'score';
  /** Integrated loudness to land on (default -14 LUFS). */
  targetLufs?: number;
  /** True-peak ceiling, dBTP (default -1). */
  ceilingDb?: number;
  /** Cut to this many seconds with a fade, when the model ran long (a bed that must end with the video). */
  seconds?: number | null;
};

export type Mastered = {
  wav: Uint8Array;
  duration: number;
  lufs: number;
  peakDb: number;
  /** Gain the normaliser applied, dB. */
  gainDb: number;
  beats: BeatAnalysis;
};

type Pcm = { channels: Float32Array[]; sampleRate: number };

/** Linear-phase-free look-ahead peak limiter: gain never lets a sample (4x-interpolated) pass `ceiling`. */
export function limitPeaks(pcm: Pcm, ceiling: number, lookaheadMs = 5, releaseMs = 80): void {
  const { channels, sampleRate } = pcm;
  const n = channels[0]?.length ?? 0;
  if (!n) return;
  // Wanted gain per sample, from the larger of the sample and the inter-sample peak to its neighbour.
  const want = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let peak = 0;
    for (const c of channels) {
      const a = Math.abs(c[i]);
      const b = i + 1 < n ? Math.abs(c[i] + c[i + 1]) * 0.5 * 1.06 : 0;
      peak = Math.max(peak, a, b);
    }
    want[i] = peak > ceiling ? ceiling / peak : 1;
  }
  // The minimum over the look-ahead window (a monotonic deque), so gain is down before the peak arrives.
  const look = Math.max(1, Math.round((lookaheadMs / 1000) * sampleRate));
  const ahead = new Float32Array(n);
  const deque: number[] = [];
  let head = 0;
  for (let i = n - 1; i >= 0; i--) {
    while (deque.length > head && want[deque[deque.length - 1]] >= want[i]) deque.pop();
    deque.push(i);
    while (deque[head] > i + look) head++;
    ahead[i] = want[deque[head]];
  }
  // Instant attack (already early by the look-ahead), smooth release.
  const release = Math.exp(-1 / ((releaseMs / 1000) * sampleRate));
  let gain = 1;
  for (let i = 0; i < n; i++) {
    const target = ahead[i];
    gain = target < gain ? target : target + (gain - target) * release;
    for (const c of channels) c[i] *= gain;
  }
}

/** Waveform levels in the shape lib/peaks.ts keeps for assets: [peak, rms] bytes, 100 per second. */
export function peaksOf(pcm: Pcm): Peaks {
  const { channels, sampleRate } = pcm;
  const n = channels[0]?.length ?? 0;
  const size = sampleRate / BUCKETS_PER_SECOND;
  const buckets = Math.floor(n / size);
  const data = new Uint8Array(buckets * 2);
  for (let b = 0; b < buckets; b++) {
    const from = Math.floor(b * size);
    const to = Math.min(n, Math.floor((b + 1) * size));
    let peak = 0;
    let sum = 0;
    for (let i = from; i < to; i++) {
      let mix = 0;
      for (const c of channels) mix += c[i];
      mix /= channels.length || 1;
      peak = Math.max(peak, Math.abs(mix));
      sum += mix * mix;
    }
    data[b * 2] = Math.min(255, Math.round(peak * 255));
    data[b * 2 + 1] = Math.min(255, Math.round(Math.sqrt(sum / Math.max(1, to - from)) * 255));
  }
  return { data, buckets };
}

/** Cuts to `seconds` with a musical fade (3 s, or a tenth of a short cue). */
function trim(pcm: Pcm, seconds: number): void {
  const keep = Math.round(seconds * pcm.sampleRate);
  if (keep >= (pcm.channels[0]?.length ?? 0)) return;
  const fade = Math.round(Math.min(3, seconds * 0.1) * pcm.sampleRate);
  pcm.channels = pcm.channels.map((c) => {
    const out = c.slice(0, keep);
    for (let i = 0; i < fade; i++) out[keep - 1 - i] *= (i / fade) ** 2;
    return out;
  });
}

/** Encoded audio (mp3, flac, wav…) mastered for release. */
export async function masterAudio(encoded: ArrayBuffer, options: MasterOptions): Promise<Mastered> {
  const target = options.targetLufs ?? -14;
  const ceiling = 10 ** ((options.ceilingDb ?? -1) / 20);
  const probe = new OfflineAudioContext(2, 1, 48000);
  const decoded = await probe.decodeAudioData(encoded.slice(0));
  const rate = decoded.sampleRate;
  const ctx = new OfflineAudioContext(2, decoded.length, rate);
  const source = ctx.createBufferSource();
  source.buffer = decoded;
  const rumble = ctx.createBiquadFilter();
  rumble.type = 'highpass';
  rumble.frequency.value = 28;
  rumble.Q.value = Math.SQRT1_2;
  let tail: AudioNode = rumble;
  if (options.purpose === 'score') {
    // The voice's presence band, opened up for intelligibility; a softer top so it never fights sibilance.
    const pocket = ctx.createBiquadFilter();
    pocket.type = 'peaking';
    pocket.frequency.value = 2500;
    pocket.Q.value = 1;
    pocket.gain.value = -4;
    const air = ctx.createBiquadFilter();
    air.type = 'highshelf';
    air.frequency.value = 8000;
    air.gain.value = -1.5;
    tail.connect(pocket);
    pocket.connect(air);
    tail = air;
  }
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -18;
  glue.ratio.value = 2;
  glue.knee.value = 6;
  glue.attack.value = 0.02;
  glue.release.value = 0.25;
  source.connect(rumble);
  tail.connect(glue);
  glue.connect(ctx.destination);
  source.start();
  const rendered = await ctx.startRendering();
  const pcm: Pcm = { channels: [rendered.getChannelData(0).slice(), rendered.getChannelData(1).slice()], sampleRate: rate };
  if (options.seconds && options.seconds > 1) trim(pcm, options.seconds);

  // Normalise, limit, and correct once for what the limiter took away.
  let gainDb = 0;
  for (let pass = 0; pass < 2; pass++) {
    const measured = analyseBuffer(pcm).lufs;
    if (!Number.isFinite(measured) || measured <= -69) break;
    const step = Math.max(-24, Math.min(24, target - measured));
    if (Math.abs(step) < 0.15) break;
    const gain = 10 ** (step / 20);
    for (const c of pcm.channels) for (let i = 0; i < c.length; i++) c[i] *= gain;
    gainDb += step;
    limitPeaks(pcm, ceiling);
  }
  const final = analyseBuffer(pcm);
  const peaks = peaksOf(pcm);
  const beats = detectBeats(peaks);
  return { wav: encodeWav(pcm, 24), duration: pcm.channels[0].length / rate, lufs: Math.round(final.lufs * 10) / 10, peakDb: Math.round(final.peakDb * 10) / 10, gainDb: Math.round(gainDb * 10) / 10, beats };
}
