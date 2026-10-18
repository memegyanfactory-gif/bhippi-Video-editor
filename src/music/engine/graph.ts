// The mixer, as a Web Audio graph built from the song (docs/MUSIC-STUDIO-PLAN.md §3.6, §5). The same code
// builds the live graph and the offline bounce's:
//
//   channel voices → strip (gain = volume, pan) → insert
//   insert: input → effect slots → fader → phase → pan → width → trim → out
//           out → master (unless toMaster is false) + sends (level; a sidechain send feeds the target's key bus)
//   master (insert 0): the same chain, trim = master volume, out → destination
//
// `update(song)` diffs by id: parameter changes are smoothed AudioParam moves (no rebuild); adding, removing
// or reordering effects rebuilds only that insert's chain; routing is rewired only when it changed. Sends that
// would form a loop are skipped (a loop silences a Web Audio graph).
import type { AutomationTarget, Effect, EffectType, MusicProject } from '../types';
import type { Meter } from './api';
import { createEffect, type EffectNode } from './effects';
import { audibleChannels } from './events';
import { dbToGain, faderGain, ramp, stereoGain, unplug, unplugAll, widthStage, type WidthStage } from './util';

export type GraphOptions = {
  /** Add per-insert peak/rms analysers (the live mixer's meters). */
  meters?: boolean;
  /** Send this insert's output (post-fader) to the destination instead of the master's: stem export. */
  tap?: number;
  /** Where the graph ends (default ctx.destination). */
  destination?: AudioNode;
};

type Slot = { id: string; type: EffectType; node: EffectNode; sig: string; effect: Effect; auto: Record<string, number> };

type Meters = { left: AnalyserNode; right: AnalyserNode };

type InsertNode = {
  id: string;
  index: number;
  input: GainNode;
  chainOut: GainNode;
  fader: GainNode;
  phase: GainNode;
  pan: StereoPannerNode;
  width: WidthStage;
  trim: GainNode;
  out: GainNode;
  keyBus: GainNode;
  slots: Slot[];
  meters: Meters | null;
  routeSig: string;
  sends: Map<string, GainNode>;
  keyed: boolean;
  audible: boolean;
};

type Strip = { id: string; input: GainNode; gain: GainNode; pan: StereoPannerNode; target: string; audible: boolean };

const FFT = 1024;

export class MixerGraph {
  private song!: MusicProject;
  private inserts: InsertNode[] = [];
  private strips = new Map<string, Strip>();
  private fresh = true;
  private force = false;
  /** The last static value written per param, so an unchanged value never cancels scheduled automation. */
  private readonly written = new WeakMap<object, number>();
  private readonly buffer = new Float32Array(FFT);

  constructor(private readonly ctx: BaseAudioContext, song: MusicProject, private readonly options: GraphOptions = {}) {
    this.update(song);
  }

  /** The node a channel's voices connect to. */
  channelInput(channelId: string): AudioNode | null {
    return this.strips.get(channelId)?.input ?? null;
  }

  /** The master insert's input (audio clips and the metronome-free direct sources feed it). */
  get masterInput(): AudioNode {
    return this.inserts[0].input;
  }

  /** Writes a param: outright while building, smoothly after; an unchanged value is left alone (unless forced). */
  private write(param: AudioParam, value: number): void {
    if (!this.force && this.written.get(param) === value) return;
    this.written.set(param, value);
    if (this.fresh) param.value = value;
    else ramp(this.ctx, param, value);
  }

  /**
   * Brings the graph in line with `song`. `reset` also drops automation values and re-applies everything
   * (transport start / stop).
   */
  update(song: MusicProject, update: { reset?: boolean } = {}): void {
    const previous = this.song;
    this.song = song;
    const reset = !!update.reset;
    this.force = reset;
    const inserts = song.mixer.inserts;
    if (!inserts.length) return;
    const retimed = !!previous && (previous.bpm !== song.bpm || previous.timeSig[0] !== song.timeSig[0] || previous.timeSig[1] !== song.timeSig[1]);

    // Insert nodes by id.
    const existing = new Map(this.inserts.map((n) => [n.id, n]));
    const keep = new Set<string>();
    const nodes = inserts.map((ins, index) => {
      let node = existing.get(ins.id);
      if (!node || keep.has(ins.id)) node = this.createInsert(ins.id, index);
      keep.add(ins.id);
      node.index = index;
      return node;
    });
    for (const old of this.inserts) if (!keep.has(old.id) || !nodes.includes(old)) this.disposeInsert(old);
    this.inserts = nodes;

    const anySolo = inserts.some((x, i) => i > 0 && x.solo);
    const keyed = new Set<number>();
    for (const ins of inserts) for (const send of ins.sends) if (send.sidechain) keyed.add(send.to);

    nodes.forEach((node, i) => {
      const ins = inserts[i];
      node.audible = i === 0 ? !ins.mute : !ins.mute && (!anySolo || ins.solo);
      this.syncEffects(node, ins.effects, song, retimed, reset, keyed.has(i));
      this.write(node.fader.gain, node.audible ? faderGain(ins.volume) : 0);
      this.write(node.phase.gain, ins.invert ? -1 : 1);
      this.write(node.pan.pan, ins.pan);
      this.write(node.trim.gain, i === 0 ? dbToGain(song.masterVolume) : 1);
      if (!this.fresh && (reset || this.written.get(node.width) !== ins.width)) {
        this.written.set(node.width, ins.width);
        node.width.set(ins.width);
      }
    });
    this.route(song);
    this.syncStrips(song);
    this.fresh = false;
    this.force = false;
  }

  private createInsert(id: string, index: number): InsertNode {
    const ctx = this.ctx;
    const insert = this.song.mixer.inserts[index];
    const input = stereoGain(ctx);
    const chainOut = stereoGain(ctx);
    const fader = ctx.createGain();
    const phase = ctx.createGain();
    const pan = ctx.createStereoPanner();
    const width = widthStage(ctx, insert?.width ?? 1);
    this.written.set(width, insert?.width ?? 1);
    const trim = ctx.createGain();
    const out = stereoGain(ctx);
    const keyBus = stereoGain(ctx);
    input.connect(chainOut);
    chainOut.connect(fader);
    fader.connect(phase);
    phase.connect(pan);
    pan.connect(width.input);
    width.output.connect(trim);
    trim.connect(out);
    let meters: Meters | null = null;
    if (this.options.meters) {
      const split = ctx.createChannelSplitter(2);
      const left = ctx.createAnalyser();
      const right = ctx.createAnalyser();
      left.fftSize = FFT;
      right.fftSize = FFT;
      trim.connect(split);
      split.connect(left, 0);
      split.connect(right, 1);
      meters = { left, right };
    }
    return { id, index, input, chainOut, fader, phase, pan, width, trim, out, keyBus, slots: [], meters, routeSig: '', sends: new Map(), keyed: false, audible: true };
  }

  private disposeInsert(node: InsertNode): void {
    for (const slot of node.slots) slot.node.dispose();
    unplugAll([node.input, node.chainOut, node.fader, node.phase, node.pan, node.trim, node.out, node.keyBus, ...node.sends.values()]);
    node.width.dispose();
  }

  private syncEffects(node: InsertNode, effects: Effect[], song: MusicProject, retimed: boolean, reset: boolean, keyed: boolean): void {
    const sameShape = effects.length === node.slots.length && effects.every((e, i) => e.id === node.slots[i].id && e.type === node.slots[i].type);
    if (!sameShape) {
      const reusable = new Map(node.slots.map((s) => [s.id, s]));
      const used = new Set<Slot>();
      const slots = effects.map((e) => {
        const prev = reusable.get(e.id);
        if (prev && prev.type === e.type && !used.has(prev)) {
          used.add(prev);
          return prev;
        }
        return { id: e.id, type: e.type, node: createEffect(this.ctx, e, song), sig: sigOf(e, song), effect: e, auto: {} } as Slot;
      });
      for (const old of node.slots) if (!used.has(old)) old.node.dispose();
      // Re-chain: input → slot 0 → … → chainOut.
      unplug(node.input);
      for (const old of node.slots) unplug(old.node.output);
      let tail: AudioNode = node.input;
      for (const slot of slots) {
        tail.connect(slot.node.input);
        tail = slot.node.output;
      }
      tail.connect(node.chainOut);
      node.slots = slots;
      // Key bus → every ducker's sidechain input.
      unplug(node.keyBus);
      for (const slot of slots) if (slot.node.sidechain) node.keyBus.connect(slot.node.sidechain);
      for (const slot of slots) slot.node.setSource?.(keyed);
    } else if (keyed !== node.keyed) for (const slot of node.slots) slot.node.setSource?.(keyed);
    node.keyed = keyed;

    effects.forEach((e, i) => {
      const slot = node.slots[i];
      const sig = sigOf(e, song);
      slot.effect = e;
      if (reset) slot.auto = {};
      if (sig !== slot.sig || retimed || reset) {
        slot.sig = sig;
        slot.node.set(Object.keys(slot.auto).length ? { ...e, params: { ...e.params, ...slot.auto } } : e, song);
      }
    });
  }

  private route(song: MusicProject): void {
    const ctx = this.ctx;
    const nodes = this.inserts;
    const destination = this.options.destination ?? ctx.destination;
    const tap = this.options.tap ?? 0;
    // Accepted edges (no loops): from → to.
    const edges: number[][] = nodes.map(() => []);
    const reaches = (from: number, to: number): boolean => {
      const seen = new Set<number>();
      const stack = [from];
      while (stack.length) {
        const at = stack.pop() as number;
        if (at === to) return true;
        if (seen.has(at)) continue;
        seen.add(at);
        stack.push(...edges[at]);
      }
      return false;
    };
    const accept = (from: number, to: number): boolean => {
      if (from === to || to < 0 || to >= nodes.length || reaches(to, from)) return false;
      edges[from].push(to);
      return true;
    };

    nodes.forEach((node, i) => {
      const ins = song.mixer.inserts[i];
      // A direct feed to master, unless the insert opted out (then a send to master is how it gets there, with a level).
      const direct = i > 0 && ins.toMaster !== false;
      const toMaster = direct && accept(i, 0);
      const sends = ins.sends.filter((s) => s.to !== 0 || s.sidechain || !direct).filter((s) => accept(i, s.to));
      const sig = [toMaster ? `m:${nodes[0].id}` : '-', i === tap ? 'd' : '-', ...sends.map((s) => `${s.to}:${nodes[s.to].id}:${s.sidechain ? 1 : 0}`)].join('|');
      if (sig !== node.routeSig) {
        node.routeSig = sig;
        unplug(node.out);
        for (const g of node.sends.values()) unplug(g);
        node.sends = new Map();
        if (i === tap) node.out.connect(destination);
        if (toMaster) node.out.connect(nodes[0].input);
        for (const s of sends) {
          const g = ctx.createGain();
          g.gain.value = s.level;
          node.out.connect(g);
          g.connect(s.sidechain ? nodes[s.to].keyBus : nodes[s.to].input);
          node.sends.set(`${s.to}:${s.sidechain ? 1 : 0}`, g);
        }
      }
      for (const s of sends) {
        const g = node.sends.get(`${s.to}:${s.sidechain ? 1 : 0}`);
        if (g) this.write(g.gain, s.level);
      }
    });
  }

  private syncStrips(song: MusicProject): void {
    const ctx = this.ctx;
    const heard = audibleChannels(song);
    const live = new Set<string>();
    for (const channel of song.channels) {
      live.add(channel.id);
      let strip = this.strips.get(channel.id);
      if (!strip) {
        const input = stereoGain(ctx);
        const gain = ctx.createGain();
        const pan = ctx.createStereoPanner();
        input.connect(gain);
        gain.connect(pan);
        strip = { id: channel.id, input, gain, pan, target: '', audible: true };
        this.strips.set(channel.id, strip);
      }
      const target = this.inserts[channel.insert] ?? this.inserts[0];
      if (strip.target !== target.id) {
        unplug(strip.pan);
        strip.pan.connect(target.input);
        strip.target = target.id;
      }
      strip.audible = heard.has(channel.id);
      this.write(strip.gain.gain, strip.audible ? channel.volume : 0);
      this.write(strip.pan.pan, channel.pan);
    }
    for (const strip of this.strips.values()) if (!live.has(strip.id)) unplugAll([strip.input, strip.gain, strip.pan]);
    this.strips = new Map([...this.strips].filter(([id]) => live.has(id)));
  }

  /** Applies an automated value (the target's real value, not 0–1) at `when` (context time). */
  automate(target: AutomationTarget, value: number, when: number): void {
    const ctx = this.ctx;
    switch (target.kind) {
      case 'channel': {
        const strip = this.strips.get(target.channelId);
        if (!strip) return;
        if (target.param === 'volume' && strip.audible) ramp(ctx, strip.gain.gain, value, when, 0.01);
        else if (target.param === 'pan') ramp(ctx, strip.pan.pan, value, when, 0.01);
        return;
      }
      case 'insert': {
        const node = this.inserts[target.insert];
        if (!node) return;
        if (target.param === 'volume') {
          if (node.audible) ramp(ctx, node.fader.gain, faderGain(value), when, 0.01);
        } else if (target.param === 'pan') ramp(ctx, node.pan.pan, value, when, 0.01);
        else node.width.set(value, when);
        return;
      }
      case 'effect': {
        const slot = this.inserts[target.insert]?.slots.find((s) => s.id === target.effectId);
        if (!slot) return;
        slot.auto[target.param] = value;
        slot.node.set({ ...slot.effect, params: { ...slot.effect.params, ...slot.auto } }, this.song, when);
        return;
      }
      case 'send': {
        const gain = this.inserts[target.insert]?.sends.get(`${target.to}:0`) ?? this.inserts[target.insert]?.sends.get(`${target.to}:1`);
        if (gain) ramp(ctx, gain.gain, value, when, 0.01);
        return;
      }
      case 'tempo':
        return;
    }
  }

  /** Aligns tempo-locked modulation (the ducker's pump) to a downbeat at `time`. */
  sync(time: number): void {
    for (const node of this.inserts) for (const slot of node.slots) slot.node.sync?.(time);
  }

  /** Peak and RMS per insert (index 0 = master) over the last ~23 ms. Needs `meters: true`. */
  meters(): Meter[] {
    const read = (analyser: AnalyserNode) => {
      analyser.getFloatTimeDomainData(this.buffer);
      let peak = 0;
      let sum = 0;
      for (let i = 0; i < FFT; i++) {
        const v = this.buffer[i];
        const a = Math.abs(v);
        if (a > peak) peak = a;
        sum += v * v;
      }
      return { peak, rms: Math.sqrt(sum / FFT) };
    };
    return this.inserts.map((node) => {
      if (!node.meters) return { peakL: 0, peakR: 0, rmsL: 0, rmsR: 0 };
      const l = read(node.meters.left);
      const r = read(node.meters.right);
      return { peakL: l.peak, peakR: r.peak, rmsL: l.rms, rmsR: r.rms };
    });
  }

  /** Tears the whole graph down. */
  dispose(): void {
    for (const node of this.inserts) this.disposeInsert(node);
    for (const strip of this.strips.values()) unplugAll([strip.input, strip.gain, strip.pan]);
    this.inserts = [];
    this.strips = new Map();
  }
}

/** What an effect slot's settings amount to; compared to skip no-op updates. */
const sigOf = (e: Effect, song: Pick<MusicProject, 'bpm' | 'timeSig'>): string => `${e.enabled ? 1 : 0}|${e.mix}|${song.bpm}|${song.timeSig[0]}/${song.timeSig[1]}|${JSON.stringify(e.params)}`;
