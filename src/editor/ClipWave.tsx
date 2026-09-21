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
};

// Tuned against the audio clip body (--clip-audio): a soft outer envelope with a brighter core,
// which reads as "loud here" at a glance even in a 30px lane.
const ENVELOPE = 'rgba(190, 245, 255, 0.42)';
const CORE = 'rgba(225, 252, 255, 0.92)';
const CENTER = 'rgba(255, 255, 255, 0.22)';

export const ClipWave = ({ asset, in: inPoint, speed, left, width, height, zoom, fallback }: Props) => {
  const peaks = usePeaks(asset?.peaks);
  const canvas = useRef<HTMLCanvasElement | null>(null);

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
    const level = (column: number) => {
      const from = inPoint + ((left + column) / zoom) * speed;
      const to = inPoint + ((left + column + 1) / zoom) * speed;
      return sliceLevel(peaks, from, to);
    };

    const band = (pick: (column: number) => number, fill: string) => {
      context.beginPath();
      for (let column = 0; column < columns; column++) {
        const value = Math.max(0.006, pick(column));
        context.lineTo(column, middle - value * reach);
      }
      for (let column = columns - 1; column >= 0; column--) {
        const value = Math.max(0.006, pick(column));
        context.lineTo(column, middle + value * reach);
      }
      context.closePath();
      context.fillStyle = fill;
      context.fill();
    };

    band((column) => level(column).peak, ENVELOPE);
    band((column) => level(column).rms, CORE);

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
