// The waveform inside an audio clip. It draws from numeric peaks onto a canvas at device
// resolution, so the shape stays sharp at any zoom instead of smearing a stretched bitmap. Only
// the visible slice of the clip is drawn — a ten-minute clip zoomed in is far wider than the
// largest canvas a browser will allocate.
import { useEffect, useRef } from 'react';
import type { Asset } from '../lib/types';
import { fileSrc } from '../lib/ipc';
import { sliceLevel, usePeaks } from '../lib/peaks';

type Props = {
  asset: Asset | undefined;
  /** Where the clip's source starts, in seconds, and how fast it plays. */
  in: number;
  speed: number;
  /** The slice to draw, in clip-local pixels. */
  left: number;
  width: number;
  height: number;
  zoom: number;
  /** The `showwavespic` PNG, drawn while the numeric peaks are still being generated. */
  fallback: string | null;
  /** The clip's whole width in pixels: the drawn span is widened to whole chunks, never past it. */
  total?: number;
};

/** The drawn span snaps out to multiples of this, so a scroll only repaints every CHUNK pixels. */
const CHUNK = 256;

// Tuned against the green audio clip body (--clip-audio): a pale outer envelope with a near-white
// core, which reads as "loud here" at a glance even in a 30px lane.
const ENVELOPE = 'rgba(214, 236, 220, 0.45)';
const CORE = 'rgba(240, 248, 242, 0.9)';
const CENTER = 'rgba(255, 255, 255, 0.18)';

export const ClipWave = ({ asset, in: inPoint, speed, left: sliceLeft, width: sliceWidth, height, zoom, fallback, total }: Props) => {
  const peaks = usePeaks(asset?.peaks);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const end = sliceLeft + sliceWidth;
  const left = total === undefined ? sliceLeft : Math.max(0, Math.floor(sliceLeft / CHUNK) * CHUNK);
  const width = total === undefined ? sliceWidth : Math.max(end, Math.min(total, Math.ceil(end / CHUNK) * CHUNK)) - left;

  useEffect(() => {
    const node = canvas.current;
    if (!node || !peaks || width <= 0 || height <= 0) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const columns = Math.max(1, Math.round(width));
    node.width = Math.round(columns * ratio);
    node.height = Math.round(height * ratio);
    const context = node.getContext('2d');
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, columns, height);

    const middle = height / 2;
    const reach = middle - 1;
    // One column per CSS pixel: read the loudest bucket the column covers, so nothing is missed.
    // Read once per column; both bands are drawn from it.
    const peak = new Float32Array(columns);
    const rms = new Float32Array(columns);
    for (let column = 0; column < columns; column++) {
      const level = sliceLevel(peaks, inPoint + ((left + column) / zoom) * speed, inPoint + ((left + column + 1) / zoom) * speed);
      peak[column] = Math.max(0.006, level.peak);
      rms[column] = Math.max(0.006, level.rms);
    }

    const band = (values: Float32Array, fill: string) => {
      context.beginPath();
      for (let column = 0; column < columns; column++) context.lineTo(column, middle - values[column] * reach);
      for (let column = columns - 1; column >= 0; column--) context.lineTo(column, middle + values[column] * reach);
      context.closePath();
      context.fillStyle = fill;
      context.fill();
    };

    band(peak, ENVELOPE);
    band(rms, CORE);

    context.fillStyle = CENTER;
    context.fillRect(0, Math.round(middle) - 0.5, columns, 1);
  }, [peaks, inPoint, speed, left, width, height, zoom]);

  if (!peaks) {
    // No numbers yet: the whole-file PNG, scaled so a pixel still means the same instant.
    const source = asset ? (asset.duration / speed) * zoom : 0;
    return fallback ? (
      <div
        className="clip-wave legacy"
        style={{ backgroundImage: `url("${fileSrc(fallback)}")`, ...(source > 0 && source < 60000 ? { backgroundSize: `${source}px 100%`, backgroundPositionX: -(inPoint / speed) * zoom } : {}) }}
      />
    ) : null;
  }
  return <canvas ref={canvas} className="clip-wave" style={{ left, width, height }} />;
};
