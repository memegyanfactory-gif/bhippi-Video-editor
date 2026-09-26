// The Histogram panel: live scopes in the Program monitor's top corner — Histogram, Waveform,
// RGB Parade and Vectorscope — of the graded picture under the playhead. It reads the top video
// or still on screen (the selected clip when it is on screen), small, and runs it through that
// clip's colour effects and the graded adjustment layers above it (lib/colorScopes.ts).

import { GripHorizontal, Maximize2, Minimize2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { applyChain, clipColorChain, drawScope, SCOPE_MODES, scopeClip, type ScopeMode } from '../lib/colorScopes';
import { syncProjectLuts } from '../lib/luts';
import { playhead } from '../lib/playhead';
import type { Comp, Project } from '../lib/types';
import { clipMedia, grabMedia } from './frameGrab';

const SIZES = [{ w: 300, h: 170 }, { w: 400, h: 226 }, { w: 540, h: 300 }];
const STORE = 'bhippi.scopes';

type Saved = { mode: ScopeMode; size: number; x: number; y: number };
const read = (): Saved => {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? '{}');
    return { mode: SCOPE_MODES.some((m) => m.id === raw.mode) ? raw.mode : 'histogram', size: [0, 1, 2].includes(raw.size) ? raw.size : 1, x: Number(raw.x) || 8, y: Number(raw.y) || 8 };
  } catch {
    return { mode: 'histogram', size: 1, x: 8, y: 8 };
  }
};

/** Whether the panel is showing: remembered between sessions. */
export function scopesVisible(): boolean {
  try { return localStorage.getItem(`${STORE}.on`) === '1'; } catch { return false; }
}
export function rememberScopes(on: boolean) {
  try { localStorage.setItem(`${STORE}.on`, on ? '1' : '0'); } catch { /* private mode */ }
}

export function ScopesPanel({ project, comp, selection, onClose }: { project: Project; comp: Comp | undefined; selection: string[]; onClose: () => void }) {
  const [saved, setSaved] = useState<Saved>(read);
  const [status, setStatus] = useState<string>('');
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef({ project, comp, selection, mode: saved.mode });
  latest.current = { project, comp, selection, mode: saved.mode };
  const size = SIZES[saved.size];

  const save = (patch: Partial<Saved>) => setSaved((current) => {
    const next = { ...current, ...patch };
    try { localStorage.setItem(STORE, JSON.stringify(next)); } catch { /* private mode */ }
    return next;
  });

  useEffect(() => {
    let frame = 0, last = 0, drawn = '';
    let shown = '';
    const say = (text: string) => { if (text !== shown) { shown = text; setStatus(text); } };
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      // About twelve updates a second is plenty for a scope, and keeps playback smooth.
      if (now - last < 80) return;
      last = now;
      const { project: proj, comp: current, selection: selected, mode } = latest.current;
      const output = canvas.current;
      if (!output) return;
      if (!current) { say('No comp open'); return; }
      const time = playhead.get();
      const clip = scopeClip(proj, current, time, selected);
      if (!clip) { say('No video or still under the playhead'); drawn = ''; clearCanvas(output); return; }
      const media = clipMedia(clip.id);
      if (!media) { say('Waiting for the picture…'); return; }
      syncProjectLuts(proj);
      const chain = clipColorChain(proj, current, clip, time);
      const stamp = media instanceof HTMLVideoElement ? media.currentTime : media.currentSrc;
      const key = `${clip.id}|${stamp}|${chain.key}|${mode}|${output.width}`;
      if (key === drawn) return;
      const image = grabMedia(media, mode === 'vectorscope' ? 200 : 320);
      if (image === 'blocked') { say('This media cannot be read for scopes'); return; }
      if (!image) return;
      applyChain(image.data, chain.fns);
      drawScope(output, mode, image, 2);
      drawn = key;
      say(clip.name || 'Clip');
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  const dragFrom = useRef<{ x0: number; y0: number; x: number; y: number } | null>(null);

  return (
    <div className="scopes-panel" style={{ right: saved.x, top: saved.y, width: size.w }} onPointerDown={(event) => event.stopPropagation()}>
      <div
        className="scopes-head"
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest('button')) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          dragFrom.current = { x0: event.clientX, y0: event.clientY, x: saved.x, y: saved.y };
        }}
        onPointerMove={(event) => {
          const from = dragFrom.current;
          if (!from) return;
          save({ x: Math.max(0, from.x - (event.clientX - from.x0)), y: Math.max(0, from.y + (event.clientY - from.y0)) });
        }}
        onPointerUp={() => { dragFrom.current = null; }}
      >
        <GripHorizontal size={12} className="scopes-grip" />
        <div className="scopes-modes" role="tablist" aria-label="Scope">
          {SCOPE_MODES.map((mode) => (
            <button key={mode.id} type="button" role="tab" aria-selected={saved.mode === mode.id} className={saved.mode === mode.id ? 'active' : ''} onClick={() => save({ mode: mode.id })}>{mode.label}</button>
          ))}
        </div>
        <span className="toolbar-spacer" />
        <button type="button" className="icon-btn small" onClick={() => save({ size: (saved.size + 1) % SIZES.length })} title="Scope size">{saved.size === 2 ? <Minimize2 size={11} /> : <Maximize2 size={11} />}</button>
        <button type="button" className="icon-btn small" onClick={onClose} title="Hide Histogram"><X size={12} /></button>
      </div>
      <canvas ref={canvas} className="scopes-canvas" width={size.w * 2} height={size.h * 2} style={{ width: size.w, height: size.h }} />
      <div className="scopes-foot" title="The scopes read this clip, graded, at the playhead">{status}</div>
    </div>
  );
}

function clearCanvas(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d');
  if (!context) return;
  context.fillStyle = '#060607';
  context.fillRect(0, 0, canvas.width, canvas.height);
}
