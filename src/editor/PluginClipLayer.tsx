// A plugin clip in the Program monitor: the plugin's page draws each frame (clipRender.ts), and
// this canvas shows the newest one. One request is in flight at a time; while it is out, only the
// latest wanted frame waits, so a plugin slower than the playhead drops frames instead of lagging.
import { useEffect, useRef, useState } from 'react';
import type { AssetMap } from '../lib/timeline';
import type { Clip, Comp, Project } from '../lib/types';
import { renderPluginFrame } from '../plugins/bridge';
import { prepareAudio } from '../plugins/clipAudio';
import { frameInfo, pluginSourceOf } from '../plugins/clipRender';
import { usePlugins } from '../plugins/store';

type Props = { project: Project; comp: Comp; clip: Clip; assets: AssetMap; time: number; stageW: number; stageH: number };

export function PluginClipLayer({ project, comp, clip, assets, time, stageW, stageH }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const source = pluginSourceOf(clip);
  const width = Math.max(2, Math.round(stageW));
  const height = Math.max(2, Math.round(stageH));
  const [error, setError] = useState<string | null>(null);
  // Bumped when the sound finishes decoding or the plugin registers, so the frame is drawn again.
  const [ready, setReady] = useState(0);
  const { generators } = usePlugins();
  const registered = !!source && generators.some((item) => item.plugin === source.id && item.name === source.generator);

  // `source` is a new object each render; what it says is what matters.
  const sourceKey = JSON.stringify(source);
  const busy = useRef(false);
  const wanted = useRef<(() => Promise<void>) | null>(null);

  // Which files the comp plays: decoding starts again only when that changes, not on every edit.
  const files = comp.clips.map((item) => (item.source.type === 'media' ? item.source.assetId : item.source.type === 'comp' ? item.source.compId : '')).filter(Boolean).sort().join(',');
  const latest = useRef({ project, assets });
  latest.current = { project, assets };
  useEffect(() => {
    let alive = true;
    void prepareAudio(latest.current.project, comp.id, latest.current.assets).then(() => { if (alive) setReady((value) => value + 1); });
    return () => { alive = false; };
  }, [comp.id, files]);

  useEffect(() => {
    if (!source) return;
    const job = async () => {
      const bitmap = await renderPluginFrame(source, frameInfo(project, comp, clip, time, { width, height }, assets, false), 4000);
      const canvas = canvasRef.current;
      if (!canvas) return bitmap.close();
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      const context = canvas.getContext('2d')!;
      context.clearRect(0, 0, width, height);
      context.drawImage(bitmap, 0, 0, width, height);
      bitmap.close();
    };
    const pump = async () => {
      busy.current = true;
      while (wanted.current) {
        const next = wanted.current;
        wanted.current = null;
        try {
          await next();
          setError(null);
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure));
        }
      }
      busy.current = false;
    };
    wanted.current = job;
    if (!busy.current) void pump();
  }, [time, width, height, sourceKey, clip.start, clip.duration, project, comp, assets, ready, registered]);

  return (
    <>
      <canvas ref={canvasRef} className="plugin-clip-canvas" width={width} height={height} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
      {error && <div className="plugin-clip-error" title={error}>{error}</div>}
    </>
  );
}
