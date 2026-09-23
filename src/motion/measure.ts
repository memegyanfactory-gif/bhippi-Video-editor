// A motion scene resolved with its text measured, without the GPU: layout checks (safe area, frame
// QA) and the AI tools see the boxes the renderer draws. Where no canvas exists (the tests) text
// width is estimated from the font size instead.
import { defaultSize, evaluateScene, type ResolvedFrame } from './evaluate';
import { canvasMeasure } from './gl/raster';
import { layoutText, type Measure } from './text';
import type { Layer, MotionScene } from './types';

const estimate: Measure = (text, font) => text.length * (parseFloat(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? '64') || 64) * 0.55;

let measure: Measure | null = null;
function textMeasure(): Measure {
  if (measure) return measure;
  try {
    canvasMeasure('M', '16px sans-serif');
    measure = canvasMeasure;
  } catch {
    measure = estimate;
  }
  return measure;
}

/** `scene` at scene time `t`, laid out the way the renderer lays it out (text measured, anchored at its alignment edge). */
export function evaluateMeasured(scene: MotionScene, t: number, fps = 30): ResolvedFrame {
  const sizeOf = (layer: Layer, time: number): [number, number] => {
    if (layer.type !== 'text') return defaultSize(scene, layer, time);
    const index = scene.layers.indexOf(layer);
    const frame = layoutText(layer.text, time, textMeasure(), { seed: scene.seed ?? 1, index, duration: scene.duration, width: scene.width, height: scene.height });
    return [Math.max(1, frame.width - frame.pad * 2), Math.max(1, frame.height - frame.pad * 2)];
  };
  const anchorOf = (layer: Layer, size: [number, number]) => {
    if (layer.type !== 'text' || !layer.text.align || layer.text.align === 'center') return null;
    return [layer.text.align === 'left' ? 0 : size[0], size[1] / 2, 0];
  };
  return evaluateScene(scene, t, { sizeOf, anchorOf, fps, motionBlur: false });
}
