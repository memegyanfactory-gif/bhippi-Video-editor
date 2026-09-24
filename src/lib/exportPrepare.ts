// What Export and Export Frame hand the backend: the project with its HTML graphics and motion
// scenes rendered to frames first. The backend composites only frames for those, so a project
// sent without them exports as if the graphics were not there.
import { motionClipsForExport, renderMotionScenesForExport, renderMotionStill } from '../motion/exportFrames';
import { prepareEffectExport } from './effectExport';
import { htmlClipsForExport, renderHtmlStill, renderMotionGraphicsForExport } from './htmlFrames';
import type { Asset, Comp, Project } from './types';

type Hooks = {
  /** The export's frame rate (the comp's when unset): graphics animate at it, up to 60. */
  fps?: number;
  /** Above 1, graphics are drawn that much larger than the comp (an export above the comp's size). */
  scale?: number;
  signal?: AbortSignal;
  onStage?: (stage: 'graphics' | 'scenes') => void;
  onItem?: (title: string, index: number, count: number, frames: number) => void;
  onFrame?: (done: number, total: number) => void;
  onCanvas?: (canvas: HTMLCanvasElement | OffscreenCanvas) => void;
};

/** Export: every graphic and scene of `compId` rendered as frames, the whole length. */
export async function prerenderForExport(project: Project, compId: string, assets: Asset[], hooks: Hooks = {}): Promise<Project> {
  // An effect the export cannot draw fails the export now, not minutes into the pre-render.
  prepareEffectExport(project, compId);
  if (htmlClipsForExport(project, compId).length) hooks.onStage?.('graphics');
  const graphics = await renderMotionGraphicsForExport(project, compId, hooks);
  if (motionClipsForExport(project, compId).length) hooks.onStage?.('scenes');
  return renderMotionScenesForExport(graphics, compId, assets, hooks);
}

/**
 * How much larger than the comp an export's graphics are drawn: the output's short side over the
 * comp's when the export is bigger (a 4K export of a 1080p comp draws them at 2×, sharp rather than
 * upscaled), and 1 otherwise — a smaller export is scaled down by FFmpeg from full size.
 */
export function exportScale(comp: Pick<Comp, 'width' | 'height'>, resolution: number | null | undefined): number {
  const short = Math.min(comp.width, comp.height);
  if (!resolution || !short || resolution <= short) return 1;
  return Math.min(4, resolution / short);
}

/** Export Frame: the graphics and scenes of `compId` rendered at `at` only, as the preview shows them there. */
export async function prerenderStill(project: Project, compId: string, at: number, assets: Asset[]): Promise<Project> {
  return renderHtmlStill(await renderMotionStill(project, compId, [at], assets), compId, [at]);
}
