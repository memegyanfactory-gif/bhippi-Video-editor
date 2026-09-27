// The sound of the edit as numbers, at any moment: what a plugin clip (a visualizer) draws from,
// and what bhippi.audio.analyze returns.
//
// It is worked out from the decoded files, not tapped from the speakers, so it is the same at a
// moment whether the user is playing, scrubbing, parked or exporting — a render matches the
// preview frame for frame. The mix follows the preview's own rules (Compositor collectVoices):
// audible audio tracks (mute and solo), enabled clips, in point, speed and reverse, volume and its
// keyframes, audio transitions, and nested comps.

import { fileSrc } from '../lib/ipc';
import { animated } from '../lib/keyframes';
import { audible, clipEnd, sourceTimeAt, tracksOf, transitionWindow, type AssetMap } from '../lib/timeline';
import type { Asset, Clip, Comp, Project } from '../lib/types';

/** Every file is decoded to mono at this rate: enough for everything up to 11 kHz. */
export const ANALYSIS_RATE = 22050;
/** Samples per analysis window (~93 ms): the FFT size. */
const WINDOW = 2048;
/** Files longer than this are measured from the waveform only (level, no spectrum). */
const MAX_DECODE_SECONDS = 3 * 60 * 60;
const MAX_DEPTH = 6;
/** Spectrum range in dB, mapped to 0..1 (Web Audio's AnalyserNode defaults, a little wider). */
const MIN_DB = -90;
const MAX_DB = -20;

export type AudioFrame = {
  /** Loudness of the mix around this moment, 0..1 of full scale. */
  rms: number;
  peak: number;
  /** Log-spaced bands from 30 Hz to 11 kHz, each 0..1. */
  bands: number[];
  /** The same bands averaged with the two frames before (1/30 s apart): steadier bars. */
  smooth: number[];
  /** The mixed wave around this moment, 128 points, −1..1. */
  waveform: number[];
  /** True while some of the sound is still being decoded (the frame is quieter than it will be). */
  loading: boolean;
};

const decoded = new Map<string, Float32Array | null>();
const decoding = new Map<string, Promise<Float32Array | null>>();

/** A file's sound as mono samples at ANALYSIS_RATE, decoded once and kept. */
export function samplesFor(asset: Asset): Promise<Float32Array | null> {
  if (decoded.has(asset.id)) return Promise.resolve(decoded.get(asset.id) ?? null);
  const running = decoding.get(asset.id);
  if (running) return running;
  const job = (async () => {
    if (!asset.hasAudio || !(asset.duration > 0) || asset.duration > MAX_DECODE_SECONDS || typeof OfflineAudioContext === 'undefined') return null;
    const response = await fetch(fileSrc(asset.path));
    if (!response.ok) return null;
    const bytes = await response.arrayBuffer();
    const length = Math.max(1, Math.ceil(asset.duration * ANALYSIS_RATE));
    // An offline context decodes straight to its own rate.
    const context = new OfflineAudioContext(1, length, ANALYSIS_RATE);
    const buffer = await context.decodeAudioData(bytes);
    const mono = new Float32Array(buffer.length);
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const data = buffer.getChannelData(channel);
      for (let index = 0; index < mono.length; index++) mono[index] += data[index] / buffer.numberOfChannels;
    }
    return mono;
  })()
    .catch(() => null)
    .then((samples) => {
      decoded.set(asset.id, samples);
      decoding.delete(asset.id);
      return samples;
    });
  decoding.set(asset.id, job);
  return job;
}

/** For tests: hands in a file's samples without decoding anything. */
export function setSamples(assetId: string, samples: Float32Array | null) {
  decoded.set(assetId, samples);
}

type Voice = { assetId: string; sourceTime: number; rate: number; gain: number };

/** How loud each clip a transition touches is at `time`, as the preview mixes it. */
function transitionGains(comp: Comp, time: number): Map<string, number> {
  const gains = new Map<string, number>();
  for (const transition of comp.transitions) {
    const window = transitionWindow(comp, transition);
    if (!window || time < window.start || time >= window.end) continue;
    const progress = (time - window.start) / Math.max(1e-6, window.end - window.start);
    const shape = (toward: number) => (transition.kind === 'constant-gain' ? toward : transition.kind === 'exponential-fade' ? toward * toward : Math.sin((toward * Math.PI) / 2));
    if (transition.fromClip) gains.set(transition.fromClip, shape(1 - progress));
    if (transition.toClip) gains.set(transition.toClip, shape(progress));
  }
  return gains;
}

function sounding(comp: Comp, clip: Clip, time: number): boolean {
  if (time >= clip.start && time < clipEnd(clip)) return true;
  return comp.transitions.some((transition) => {
    if (transition.fromClip !== clip.id && transition.toClip !== clip.id) return false;
    const window = transitionWindow(comp, transition);
    return !!window && time >= window.start && time < window.end;
  });
}

/** Every file sounding at `time` of `comp`, nested comps flattened. */
export function voicesAt(project: Project, comp: Comp, time: number, gain = 1, depth = 0, out: Voice[] = []): Voice[] {
  if (depth > MAX_DEPTH) return out;
  const fades = transitionGains(comp, time);
  for (const track of tracksOf(comp, 'audio')) {
    if (!audible(comp, track)) continue;
    for (const clip of comp.clips) {
      if (clip.trackId !== track.id || !clip.enabled || clip.hold !== null || !sounding(comp, clip, time)) continue;
      const level = gain * (fades.get(clip.id) ?? 1) * animated(clip, 'volume', time, clip.volume);
      if (level <= 0) continue;
      const sourceTime = sourceTimeAt(clip, time) + (time < clip.start ? (time - clip.start) * clip.speed : time > clipEnd(clip) ? (time - clipEnd(clip)) * clip.speed : 0);
      if (clip.source.type === 'comp') {
        const compId = clip.source.compId;
        const child = project.comps.find((entry) => entry.id === compId);
        if (child) voicesAt(project, child, sourceTime, level, depth + 1, out);
      } else if (clip.source.type === 'media') {
        out.push({ assetId: clip.source.assetId, sourceTime, rate: clip.reverse ? -clip.speed : clip.speed, gain: level });
      }
    }
  }
  return out;
}

/** In-place radix-2 FFT of `re` / `im` (length a power of two). */
function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const angle = (-2 * Math.PI) / size;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    for (let start = 0; start < n; start += size) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < size / 2; k++) {
        const a = start + k;
        const b = a + size / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const next = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = next;
      }
    }
  }
}

const HANN = Float64Array.from({ length: WINDOW }, (_, index) => 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (WINDOW - 1)));

/** The mix of `voices` in a window centred on the moment, and whether any file is still decoding. */
function mixWindow(voices: Voice[], assets: AssetMap): { samples: Float64Array; loading: boolean } {
  const samples = new Float64Array(WINDOW);
  let loading = false;
  for (const voice of voices) {
    const asset = assets.get(voice.assetId);
    if (!asset) continue;
    const data = decoded.get(voice.assetId);
    if (data === undefined) {
      loading = true;
      void samplesFor(asset);
      continue;
    }
    if (!data) continue;
    for (let index = 0; index < WINDOW; index++) {
      const at = Math.round((voice.sourceTime + ((index - WINDOW / 2) / ANALYSIS_RATE) * voice.rate) * ANALYSIS_RATE);
      if (at >= 0 && at < data.length) samples[index] += data[at] * voice.gain;
    }
  }
  return { samples, loading };
}

/** Band edges, log-spaced 30 Hz – 11 kHz, as FFT bin indices. */
function bandEdges(count: number): number[] {
  const low = Math.log(30);
  const high = Math.log(ANALYSIS_RATE / 2);
  const hz = (index: number) => Math.exp(low + ((high - low) * index) / count);
  return Array.from({ length: count + 1 }, (_, index) => Math.max(1, Math.min(WINDOW / 2, Math.round((hz(index) * WINDOW) / ANALYSIS_RATE))));
}

function spectrum(samples: Float64Array, count: number): number[] {
  const re = new Float64Array(WINDOW);
  const im = new Float64Array(WINDOW);
  for (let index = 0; index < WINDOW; index++) re[index] = samples[index] * HANN[index];
  fft(re, im);
  const edges = bandEdges(count);
  const bands: number[] = [];
  for (let band = 0; band < count; band++) {
    const from = edges[band];
    const to = Math.max(from + 1, edges[band + 1]);
    let energy = 0;
    for (let bin = from; bin < to && bin < WINDOW / 2; bin++) energy = Math.max(energy, Math.hypot(re[bin], im[bin]));
    // Amplitude of a full-scale sine is ~WINDOW/4 after the Hann window.
    const db = 20 * Math.log10(Math.max(1e-12, energy / (WINDOW / 4)));
    bands.push(Math.round(Math.max(0, Math.min(1, (db - MIN_DB) / (MAX_DB - MIN_DB))) * 1000) / 1000);
  }
  return bands;
}

function measure(project: Project, comp: Comp, time: number, assets: AssetMap, count: number) {
  const { samples, loading } = mixWindow(voicesAt(project, comp, time), assets);
  let peak = 0;
  let energy = 0;
  for (const sample of samples) {
    peak = Math.max(peak, Math.abs(sample));
    energy += sample * sample;
  }
  const waveform: number[] = [];
  const step = WINDOW / 128;
  for (let index = 0; index < 128; index++) waveform.push(Math.round(Math.max(-1, Math.min(1, samples[Math.floor(index * step)])) * 1000) / 1000);
  return { rms: Math.min(1, Math.sqrt(energy / WINDOW)), peak: Math.min(1, peak), bands: spectrum(samples, count), waveform, loading };
}

/** The sound of `comp` at `time` seconds of its timeline, with `bands` spectrum bands (8–256). */
export function audioAt(project: Project, compId: string, time: number, assets: AssetMap, bands = 64): AudioFrame {
  const comp = project.comps.find((item) => item.id === compId);
  const count = Math.round(Math.max(8, Math.min(256, bands)));
  if (!comp) return { rms: 0, peak: 0, bands: new Array(count).fill(0), smooth: new Array(count).fill(0), waveform: new Array(128).fill(0), loading: false };
  const now = measure(project, comp, time, assets, count);
  const before = measure(project, comp, Math.max(0, time - 1 / 30), assets, count);
  const earlier = measure(project, comp, Math.max(0, time - 2 / 30), assets, count);
  const smooth = now.bands.map((value, index) => Math.round((value * 0.5 + before.bands[index] * 0.3 + earlier.bands[index] * 0.2) * 1000) / 1000);
  return { rms: Math.round(now.rms * 1000) / 1000, peak: Math.round(now.peak * 1000) / 1000, bands: now.bands, smooth, waveform: now.waveform, loading: now.loading || before.loading || earlier.loading };
}

/** Starts decoding every file `comp` plays, so frames are ready by the time they are asked for. */
export async function prepareAudio(project: Project, compId: string, assets: AssetMap): Promise<void> {
  const ids = new Set<string>();
  const walk = (comp: Comp, depth: number) => {
    if (depth > MAX_DEPTH) return;
    for (const clip of comp.clips) {
      if (clip.source.type === 'media' && assets.get(clip.source.assetId)?.hasAudio) ids.add(clip.source.assetId);
      else if (clip.source.type === 'comp') {
        const compId = clip.source.compId;
        const child = project.comps.find((entry) => entry.id === compId);
        if (child) walk(child, depth + 1);
      }
    }
  };
  const root = project.comps.find((item) => item.id === compId);
  if (root) walk(root, 0);
  await Promise.all([...ids].map((id) => samplesFor(assets.get(id)!)));
}
