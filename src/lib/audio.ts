// One audio graph for everything the editor plays, so the meters show what you hear.
//
//   clip element → channels → [enhance speech] → gain ─┐
//   tone / beep generators ─────────────────────────────┼→ program bus ─┐
//   source monitor element ──────────────────────────────→ source bus ──┼→ master → speakers
//                                                                       └→ L/R analysers
//
// Media from Bhippi's asset protocol carries CORS headers, which is what lets Web Audio read it.
import type { Channels } from './types';

type Bus = {
  ctx: AudioContext;
  program: GainNode;
  source: GainNode;
  master: GainNode;
  left: AnalyserNode;
  right: AnalyserNode;
  /** The master, K-weighted (EBU R128), per channel: what the LUFS meter reads. */
  loud: [AnalyserNode, AnalyserNode];
  /** Per-ear gains after the meters, for the meters' solo buttons. */
  ears: [GainNode, GainNode];
};

let bus: Bus | null = null;

function getBus(): Bus | null {
  if (bus) return bus;
  try {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    const program = ctx.createGain();
    const source = ctx.createGain();
    const master = ctx.createGain();
    const splitter = ctx.createChannelSplitter(2);
    const left = ctx.createAnalyser();
    const right = ctx.createAnalyser();
    // A short window (about 20 ms) so the meters fall the moment playback stops.
    left.fftSize = right.fftSize = 1024;
    // Always two channels: a mono source (a voice recording, a tone) is spread to both before the
    // L/R split, as the speakers play it. Left to follow its input, a mono mix stayed one channel
    // and the right meter read −∞ while the right speaker played it.
    master.channelCount = 2;
    master.channelCountMode = 'explicit';
    master.channelInterpretation = 'speakers';
    program.connect(master);
    source.connect(master);
    master.connect(splitter);
    splitter.connect(left, 0);
    splitter.connect(right, 1);
    // Each ear gets its own gain on the way to the speakers, so soloing one channel silences the
    // other in place (left stays in the left ear) while both meters keep reading the mix.
    const ears: [GainNode, GainNode] = [ctx.createGain(), ctx.createGain()];
    const merger = ctx.createChannelMerger(2);
    splitter.connect(ears[0], 0);
    splitter.connect(ears[1], 1);
    ears[0].connect(merger, 0, 0);
    ears[1].connect(merger, 0, 1);
    merger.connect(ctx.destination);
    // Loudness: the master through the K-weighting (a +4 dB shelf above ~1.7 kHz, then a ~38 Hz
    // high-pass), read over ~400 ms windows — EBU R128's momentary loudness.
    const shelf = ctx.createBiquadFilter();
    shelf.type = 'highshelf';
    shelf.frequency.value = 1681.97;
    shelf.gain.value = 4;
    const rumble = ctx.createBiquadFilter();
    rumble.type = 'highpass';
    rumble.frequency.value = 38.13;
    rumble.Q.value = 0.5;
    const weighted = ctx.createChannelSplitter(2);
    const loud: [AnalyserNode, AnalyserNode] = [ctx.createAnalyser(), ctx.createAnalyser()];
    for (const analyser of loud) analyser.fftSize = 32768;
    master.connect(shelf);
    shelf.connect(rumble);
    rumble.connect(weighted);
    weighted.connect(loud[0], 0);
    weighted.connect(loud[1], 1);
    bus = { ctx, program, source, master, left, right, ears, loud };
    // Created before the user has clicked anything (the mute state is applied at startup), the
    // context starts suspended and every clip routed through it is silent while its element
    // "plays". Any click or key is a gesture that may start it; Windows also suspends it on an
    // audio-device change or sleep, which the same listeners recover from.
    const wake = () => {
      if (ctx.state !== 'running') void ctx.resume().catch(() => undefined);
    };
    window.addEventListener('pointerdown', wake, true);
    window.addEventListener('keydown', wake, true);
    return bus;
  } catch {
    return null;
  }
}

export function resumeAudio() {
  const target = getBus();
  // 'interrupted' (Safari/WebKit) is the same condition as 'suspended' for our purposes.
  if (target && target.ctx.state !== 'running' && target.ctx.state !== 'closed') void target.ctx.resume().catch(() => undefined);
}

/**
 * What the speakers play. `solo` is the meters' S buttons, left then right: with none on both ears
 * play; with any on, only the soloed channels are heard, each in its own ear (Premiere's Solo in Place).
 */
export type MuteState = { all: boolean; program: boolean; source: boolean; solo: [boolean, boolean] };

export const NO_MUTES: MuteState = { all: false, program: false, source: false, solo: [false, false] };

export function setMutes(mutes: MuteState) {
  const target = getBus();
  if (!target) return;
  const now = target.ctx.currentTime;
  target.master.gain.setTargetAtTime(mutes.all ? 0 : 1, now, 0.01);
  target.program.gain.setTargetAtTime(mutes.program ? 0 : 1, now, 0.01);
  target.source.gain.setTargetAtTime(mutes.source ? 0 : 1, now, 0.01);
  const soloing = mutes.solo[0] || mutes.solo[1];
  target.ears.forEach((ear, channel) => ear.gain.setTargetAtTime(!soloing || mutes.solo[channel] ? 1 : 0, now, 0.01));
}

/** Per-clip processing between a media element and the program bus. */
export class ClipChain {
  private readonly input: AudioNode;
  private readonly gain: GainNode;
  /** The track's balance: each side's own gain (the far side stays at full level). */
  private readonly balance: [GainNode, GainNode];
  private readonly highpass: BiquadFilterNode;
  private readonly compressor: DynamicsCompressorNode;
  private channels: Channels | null = null;
  private enhance: boolean | null = null;
  private mapping: AudioNode[] = [];

  private constructor(private readonly ctx: AudioContext, input: AudioNode, output: AudioNode) {
    this.input = input;
    this.gain = ctx.createGain();
    this.highpass = ctx.createBiquadFilter();
    this.highpass.type = 'highpass';
    this.highpass.frequency.value = 80;
    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -18;
    this.compressor.ratio.value = 3;
    this.compressor.attack.value = 0.005;
    this.compressor.release.value = 0.12;
    // gain → split → per-side balance → merge → out (balance law, as the export's `pan` filter).
    const split = ctx.createChannelSplitter(2);
    const merge = ctx.createChannelMerger(2);
    this.balance = [ctx.createGain(), ctx.createGain()];
    this.gain.channelCount = 2;
    this.gain.channelCountMode = 'explicit';
    this.gain.channelInterpretation = 'speakers';
    this.gain.connect(split);
    split.connect(this.balance[0], 0);
    split.connect(this.balance[1], 1);
    this.balance[0].connect(merge, 0, 0);
    this.balance[1].connect(merge, 0, 1);
    merge.connect(output);
  }

  private static elements = new WeakMap<HTMLMediaElement, ClipChain>();

  /** The chain for an element (created once; an element can only ever have one source node). */
  static for(element: HTMLMediaElement, target: 'program' | 'source' = 'program'): ClipChain | null {
    const existing = ClipChain.elements.get(element);
    if (existing) return existing;
    const graph = getBus();
    if (!graph) return null;
    try {
      const node = graph.ctx.createMediaElementSource(element);
      const chain = new ClipChain(graph.ctx, node, target === 'program' ? graph.program : graph.source);
      chain.configure({ channels: 'stereo', enhance: false, gain: 1 });
      ClipChain.elements.set(element, chain);
      return chain;
    } catch {
      return null;
    }
  }

  /** A generator (tone, beep) routed like a clip. */
  static forNode(node: AudioNode): ClipChain | null {
    const graph = getBus();
    if (!graph) return null;
    const chain = new ClipChain(graph.ctx, node, graph.program);
    chain.configure({ channels: 'stereo', enhance: false, gain: 1 });
    return chain;
  }

  configure({ channels, enhance, gain, pan = 0 }: { channels: Channels; enhance: boolean; gain: number; pan?: number }) {
    const target = Math.max(0, Math.min(8, gain));
    if (Math.abs(this.gain.gain.value - target) > 1e-4) this.gain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.015);
    const side = Math.max(-1, Math.min(1, pan));
    const [left, right] = [Math.min(1, 1 - side), Math.min(1, 1 + side)];
    if (Math.abs(this.balance[0].gain.value - left) > 1e-4) this.balance[0].gain.setTargetAtTime(left, this.ctx.currentTime, 0.015);
    if (Math.abs(this.balance[1].gain.value - right) > 1e-4) this.balance[1].gain.setTargetAtTime(right, this.ctx.currentTime, 0.015);
    if (channels === this.channels && enhance === this.enhance) return;
    this.channels = channels;
    this.enhance = enhance;
    try {
      this.input.disconnect();
    } catch {
      // Nothing connected yet.
    }
    for (const node of this.mapping) node.disconnect();
    this.highpass.disconnect();
    this.compressor.disconnect();
    const tail: AudioNode = enhance ? this.highpass : this.gain;
    if (enhance) {
      this.highpass.connect(this.compressor);
      this.compressor.connect(this.gain);
    }
    if (channels === 'stereo') {
      this.mapping = [];
      this.input.connect(tail);
      return;
    }
    const splitter = this.ctx.createChannelSplitter(2);
    const merger = this.ctx.createChannelMerger(2);
    this.input.connect(splitter);
    if (channels === 'mono') {
      const sum = this.ctx.createGain();
      sum.gain.value = 0.5;
      splitter.connect(sum, 0);
      splitter.connect(sum, 1);
      sum.connect(merger, 0, 0);
      sum.connect(merger, 0, 1);
      this.mapping = [splitter, merger, sum];
    } else {
      const [toLeft, toRight] = channels === 'left' ? [0, 0] : channels === 'right' ? [1, 1] : [1, 0];
      splitter.connect(merger, toLeft, 0);
      splitter.connect(merger, toRight, 1);
      this.mapping = [splitter, merger];
    }
    merger.connect(tail);
  }
}

/** Sends a Source-monitor element through the source bus (once per element). */
export const routeSource = (element: HTMLMediaElement) => ClipChain.for(element, 'source');

/** Starts a sine generator on the program bus; returns a stop function. */
export function startTone(frequency: number, gain: number): (() => void) | null {
  const graph = getBus();
  if (!graph) return null;
  const oscillator = graph.ctx.createOscillator();
  oscillator.frequency.value = frequency;
  const level = graph.ctx.createGain();
  level.gain.value = gain;
  oscillator.connect(level);
  level.connect(graph.program);
  oscillator.start();
  return () => {
    try {
      oscillator.stop();
    } catch {
      // Already stopped.
    }
    level.disconnect();
  };
}

/** A short beep (countdown leaders). */
export function beep(frequency = 1000, seconds = 0.08, gain = 0.25) {
  const graph = getBus();
  if (!graph) return;
  const oscillator = graph.ctx.createOscillator();
  oscillator.frequency.value = frequency;
  const level = graph.ctx.createGain();
  level.gain.value = gain;
  oscillator.connect(level);
  level.connect(graph.program);
  oscillator.start();
  oscillator.stop(graph.ctx.currentTime + seconds);
  oscillator.onended = () => level.disconnect();
}

export type Levels = { peak: [number, number]; valley: [number, number]; rms: [number, number] };

let scratch: Float32Array<ArrayBuffer> | null = null;

const measure = (analyser: AnalyserNode, buffer: Float32Array<ArrayBuffer>) => {
  analyser.getFloatTimeDomainData(buffer);
  let max = 0;
  let sum = 0;
  let min = Infinity;
  // Valleys: the quietest short window in the buffer, which is what Premiere's valley marks show.
  const window = 128;
  for (let offset = 0; offset + window <= buffer.length; offset += window) {
    let local = 0;
    for (let index = offset; index < offset + window; index++) {
      const value = Math.abs(buffer[index]);
      if (value > local) local = value;
      sum += buffer[index] * buffer[index];
    }
    if (local > max) max = local;
    if (local < min) min = local;
  }
  const db = (value: number) => (value > 0 ? 20 * Math.log10(value) : -Infinity);
  return { peak: db(max), valley: db(min === Infinity ? 0 : min), rms: db(Math.sqrt(sum / buffer.length)) };
};

/** Levels of the master bus in dBFS (−∞ when silent). */
export function levels(): Levels {
  if (!bus) return { peak: [-Infinity, -Infinity], valley: [-Infinity, -Infinity], rms: [-Infinity, -Infinity] };
  scratch ??= new Float32Array(bus.left.fftSize);
  const left = measure(bus.left, scratch);
  const right = measure(bus.right, scratch);
  return { peak: [left.peak, right.peak], valley: [left.valley, right.valley], rms: [left.rms, right.rms] };
}

let loudScratch: Float32Array | null = null;
/** Momentary loudness readings (energy, time), for the short-term (3 s) average. */
const momentaryHistory: { at: number; energy: number }[] = [];

/**
 * Loudness of the master in LUFS (EBU R128): momentary (the last ~400 ms) and short-term (the
 * last 3 s), −∞ when silent. What export normalisation targets (−14 for YouTube, −16 podcasts…).
 */
export function loudness(): { momentary: number; shortTerm: number } {
  if (!bus) return { momentary: -Infinity, shortTerm: -Infinity };
  const window = Math.min(bus.loud[0].fftSize, Math.round(bus.ctx.sampleRate * 0.4));
  loudScratch ??= new Float32Array(bus.loud[0].fftSize);
  let energy = 0;
  for (const analyser of bus.loud) {
    analyser.getFloatTimeDomainData(loudScratch);
    let sum = 0;
    for (let index = loudScratch.length - window; index < loudScratch.length; index++) sum += loudScratch[index] * loudScratch[index];
    energy += sum / window;
  }
  const now = performance.now();
  momentaryHistory.push({ at: now, energy });
  while (momentaryHistory.length && now - momentaryHistory[0].at > 3000) momentaryHistory.shift();
  const shortEnergy = momentaryHistory.reduce((sum, item) => sum + item.energy, 0) / Math.max(1, momentaryHistory.length);
  const lufs = (value: number) => (value > 1e-10 ? -0.691 + 10 * Math.log10(value) : -Infinity);
  return { momentary: lufs(energy), shortTerm: lufs(shortEnergy) };
}

