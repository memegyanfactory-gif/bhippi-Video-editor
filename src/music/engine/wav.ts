// RIFF/WAVE PCM encoder (docs/MUSIC-STUDIO-PLAN.md §3.10): 16- or 24-bit little-endian, interleaved. 16-bit
// output is dithered with seeded TPDF noise (exact digital silence stays silent), so a bounce repeats bit
// for bit. Also the one place that turns an AudioBuffer or a plain `{ channels, sampleRate }` into arrays.
import { mulberry32 } from './random';

export type PcmSource = AudioBuffer | { channels: Float32Array[]; sampleRate: number };

/** Channel data + sample rate from either shape. */
export function channelsOf(buffer: PcmSource): { channels: Float32Array[]; sampleRate: number } {
  if ('channels' in buffer) return buffer;
  return { channels: Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i)), sampleRate: buffer.sampleRate };
}

/** A complete .wav file. */
export function encodeWav(buffer: PcmSource, bits: 16 | 24 = 16): Uint8Array {
  const { channels, sampleRate } = channelsOf(buffer);
  const frames = channels.reduce((n, c) => Math.max(n, c.length), 0);
  const count = Math.max(1, channels.length);
  const width = bits / 8;
  const dataSize = frames * count * width;
  const out = new Uint8Array(44 + dataSize);
  const view = new DataView(out.buffer);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i);
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, count, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * count * width, true);
  view.setUint16(32, count * width, true);
  view.setUint16(34, bits, true);
  text(36, 'data');
  view.setUint32(40, dataSize, true);

  const rand = mulberry32(0x5eed);
  let at = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < count; c++) {
      const raw = channels[c]?.[i] ?? 0;
      const x = Number.isFinite(raw) ? Math.min(1, Math.max(-1, raw)) : 0;
      if (bits === 16) {
        const scaled = x * 32767 + (x !== 0 ? rand() - rand() : 0);
        view.setInt16(at, Math.min(32767, Math.max(-32768, Math.round(scaled))), true);
      } else {
        const v = Math.round(x * 8388607);
        out[at] = v & 255;
        out[at + 1] = (v >> 8) & 255;
        out[at + 2] = (v >> 16) & 255;
      }
      at += width;
    }
  }
  return out;
}
