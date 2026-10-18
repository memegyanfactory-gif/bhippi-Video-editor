// Sampler: plays the channel's audio from the bin, pitched by key against the channel's root key (+ tune and
// fine), with start / end, loop, reverse, ADSR and filter. One-shot mode (the default) plays the sample to
// its end whatever the note length; with it off the note length gates the sound and the release applies.
// A cutoff left at its 12 kHz default means "open" here, so samples keep their top end.
import { INSTRUMENT_SPECS, resolveParams } from '../../types';
import { pitchRamp } from '../util';
import { silentVoice } from '../voice';
import { buildVoice, shapeOf } from './shape';
import type { PlayFn } from './types';

const mirrored = new WeakMap<AudioBuffer, AudioBuffer>();

function reversed(ctx: BaseAudioContext, buffer: AudioBuffer): AudioBuffer {
  let copy = mirrored.get(buffer);
  if (!copy) {
    copy = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const from = buffer.getChannelData(c);
      const to = copy.getChannelData(c);
      for (let i = 0; i < from.length; i++) to[i] = from[from.length - 1 - i];
    }
    mirrored.set(buffer, copy);
  }
  return copy;
}

export const play: PlayFn = (ctx, out, ev, channel, song, sample) => {
  if (!sample) return silentVoice(ev.time);
  const p = resolveParams(INSTRUMENT_SPECS.sampler.params, channel.params);
  const t0 = ev.time;
  const loop = p.loop >= 0.5;
  const oneShot = p.oneShot >= 0.5 && !loop;
  const backwards = p.reverse >= 0.5;
  const length = sample.duration;
  const start = Math.min(p.start, p.end - 0.001);
  const end = Math.max(p.end, start + 0.001);
  // A reversed sample plays the mirrored region of the mirrored buffer.
  const a0 = backwards ? 1 - end : start;
  const a1 = backwards ? 1 - start : end;
  const region = (a1 - a0) * length;
  const rate = Math.pow(2, (ev.key - channel.rootKey + p.tune + ev.fine / 100) / 12);
  const fromRate = ev.slideFromKey === undefined ? undefined : Math.pow(2, (ev.slideFromKey - channel.rootKey + p.tune + ev.fine / 100) / 12);
  const glide = ev.slideFromKey !== undefined ? (channel.glide > 0 ? channel.glide : 0.06) : 0;

  const shape = shapeOf(p, {}, { ...(oneShot ? { decay: 0, sustain: 1 } : {}), ...(p.cutoff >= 12000 && p.filterType < 0.5 ? { cutoff: 20000 } : {}) });
  const { voice, input, pitchMod } = buildVoice(ctx, out, ev, shape, song, { hold: oneShot ? Math.max(ev.duration, region / rate) : ev.duration });

  const src = voice.track(ctx.createBufferSource());
  src.buffer = backwards ? reversed(ctx, sample) : sample;
  pitchRamp(src.playbackRate, t0, rate, fromRate, glide);
  pitchMod?.connect(src.detune);
  if (loop) {
    src.loop = true;
    src.loopStart = a0 * length;
    src.loopEnd = a1 * length;
    src.start(t0, a0 * length);
  } else {
    src.start(t0, a0 * length, region);
  }
  src.connect(input);
  return voice.finish();
};
