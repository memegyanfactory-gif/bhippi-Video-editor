// One audio graph for everything the editor plays, so the meters show what you hear.
//
//   clip element → channels → [enhance speech] → gain ─┐
//   tone / beep generators ─────────────────────────────┼→ program bus ─┐
//   source monitor element ──────────────────────────────→ source bus ──┼→ master → speakers
//                                                                       └→ L/R analysers
//
// Media from Helios' asset protocol carries CORS headers, which is what lets Web Audio read it.
import type { Channels } from './types';

type Bus = {
  ctx: AudioContext;
  program: GainNode;
  source: GainNode;
  master: GainNode;
  left: AnalyserNode;
  right: AnalyserNode;
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
    left.fftSize = right.fftSize = 2048;
    program.connect(master);
    source.connect(master);
    master.connect(ctx.destination);
    master.connect(splitter);
    splitter.connect(left, 0);
    splitter.connect(right, 1);
    bus = { ctx, program, source, master, left, right };
    return bus;
  } catch {
    return null;
  }
}

export function resumeAudio() {
  const target = getBus();
  if (target && target.ctx.state === 'suspended') void target.ctx.resume().catch(() => undefined);
}

export type MuteState = { all: boolean; program: boolean; source: boolean };

export function setMutes(mutes: MuteState) {
  const target = getBus();
  if (!target) return;
  const now = target.ctx.currentTime;
  target.master.gain.setTargetAtTime(mutes.all ? 0 : 1, now, 0.01);
  target.program.gain.setTargetAtTime(mutes.program ? 0 : 1, now, 0.01);
  target.source.gain.setTargetAtTime(mutes.source ? 0 : 1, now, 0.01);
}

/** Per-clip processing between a media element and the program bus. */
export class ClipChain {
  private readonly input: AudioNode;
  private readonly gain: GainNode;
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
    this.gain.connect(output);
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

  configure({ channels, enhance, gain }: { channels: Channels; enhance: boolean; gain: number }) {
    const target = Math.max(0, Math.min(8, gain));
    if (Math.abs(this.gain.gain.value - target) > 1e-4) this.gain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.015);
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
