// Reverb: a ConvolverNode with a stereo impulse response generated in code, seeded so it is identical every
// time. The IR is exponentially decaying noise (−60 dB at `decay`) that starts with a size-dependent build-up
// and a few early reflections, and gets darker as it rings (`damping`: a one-pole low-pass whose cutoff falls
// over the tail). Pre-delay is a DelayNode, low cut a high-pass on the wet signal. Changing size / decay /
// damping builds a new IR and cross-fades to it, so a knob drag never clicks.
import { mulberry32 } from '../random';
import { cached, stereoGain, unplugAll, unplug } from '../util';
import { put, resolveEffect, type CreateEffect } from './types';

function impulse(ctx: BaseAudioContext, size: number, decay: number, damping: number): AudioBuffer {
  const key = `reverb:${size.toFixed(2)}:${decay.toFixed(2)}:${damping.toFixed(2)}`;
  return cached(ctx, key, () => {
    const fs = ctx.sampleRate;
    const length = Math.max(64, Math.ceil(Math.min(decay + 0.15, 12.5) * fs));
    const buffer = ctx.createBuffer(2, length, fs);
    const grow = 0.004 + size * 0.05;
    const slope = 6.91 / decay;
    for (let ch = 0; ch < 2; ch++) {
      const rand = mulberry32(0x9e3779b1 + ch * 7919 + Math.round(size * 100) * 31 + Math.round(decay * 100));
      const data = buffer.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < length; i++) {
        const t = i / fs;
        const k = 1 - damping * 0.93 * (1 - Math.exp(-t / (decay * 0.3 + 0.05)));
        lp += k * (rand() * 2 - 1 - lp);
        data[i] = lp * Math.exp(-t * slope) * (1 - Math.exp(-t / grow));
      }
      // A handful of early reflections: the room announcing itself.
      const taps = 6 + Math.round(size * 10);
      for (let j = 0; j < taps; j++) {
        const t = 0.003 + rand() * (0.012 + size * 0.09);
        const at = Math.min(length - 1, Math.floor(t * fs));
        data[at] += (rand() * 2 - 1) * 0.9 * Math.exp(-t * 4);
      }
    }
    return buffer;
  });
}

export const create: CreateEffect = (ctx, params) => {
  const input = stereoGain(ctx);
  const pre = ctx.createDelay(0.3);
  const lowcut = ctx.createBiquadFilter();
  lowcut.type = 'highpass';
  lowcut.Q.value = 0.5;
  const output = stereoGain(ctx);
  input.connect(pre);
  lowcut.connect(output);

  type Slot = { conv: ConvolverNode; gain: GainNode };
  const mount = (buffer: AudioBuffer, level: number): Slot => {
    const conv = ctx.createConvolver();
    conv.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = level;
    pre.connect(conv);
    conv.connect(gain);
    gain.connect(lowcut);
    return { conv, gain };
  };
  let slot: Slot | null = null;
  let shape = '';
  let first = true;

  const apply = (raw: Record<string, number>, time?: number) => {
    const p = resolveEffect('reverb', raw);
    put(ctx, pre.delayTime, p.predelay, first, time);
    put(ctx, lowcut.frequency, p.lowcut, first, time);
    const next = `${p.size.toFixed(2)}:${Math.round(p.decay * 20)}:${p.damping.toFixed(2)}`;
    if (next !== shape) {
      shape = next;
      const buffer = impulse(ctx, p.size, Math.round(p.decay * 20) / 20, p.damping);
      if (!slot) slot = mount(buffer, 1);
      else {
        const old = slot;
        slot = mount(buffer, 0);
        slot.gain.gain.setTargetAtTime(1, ctx.currentTime, 0.02);
        old.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
        if (typeof setTimeout === 'function') {
          setTimeout(() => {
            unplug(pre, old.conv);
            unplugAll([old.conv, old.gain]);
          }, 400);
        }
      }
    }
    first = false;
  };
  apply(params);
  return {
    input, output, set: (next, time) => apply(next, time),
    dispose: () => unplugAll([input, pre, lowcut, output, slot?.conv, slot?.gain]),
  };
};
