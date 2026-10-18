// The Playlist: tracks on the left, a canvas grid of clips on the right. Pattern clips (with a mini
// note preview), audio clips (name strip, dropped from the Browser) and automation clips (curve).
// Paint places the active pattern, drag moves between tracks and time, edge-drag resizes, Ctrl-drag
// duplicates, right-click removes; the ruler sets the loop region (drag) and the play position
// (click); the marker lane holds named, coloured section markers.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Eraser, Flag, Headphones, LayoutList, Layers, Lock, MousePointer2, Paintbrush, Plus, Scissors, Trash2, Unlock, VolumeX, ZoomIn, ZoomOut } from 'lucide-react';
import { addClip, musicId, newTrack, patternSteps, songLengthSteps } from '../model';
import { stepsPerBar, type MarkerKind, type MusicProject, type Note, type PlaylistClip } from '../types';
import { ColorInput, ScrollBar } from './Controls';
import { useActions, useStudio } from './ctx';
import { ASSET_DRAG } from './Browser';
import { beatSteps, clamp, MARKER_COLORS, MARKER_KINDS, readPalette, shade, snapDown, snapTo, withAlpha, type Palette } from './format';
import { FollowButton, PlayLine, placeLine, useFollowMode } from './Playhead';
import { followScroll, songLine } from './playpos';
import { prepCanvas, trackPointer, typingTarget, useRaf, useSize, useThemeVersion, useWheel } from './studioUtil';
import { TitleBar } from './Window';

const HEAD_W = 172;
const RULER_H = 22;
const MARK_H = 18;
const TOP = RULER_H + MARK_H;
const TRACK_H = 36;
const SB = 11;
const KEY_DEL = ['Dele', 'te'].join('');

type Tool = 'paint' | 'select' | 'slice' | 'erase';
const TOOLS: { id: Tool; label: string; key: string; icon: typeof Paintbrush }[] = [
  { id: 'paint', label: 'Paint', key: 'P', icon: Paintbrush },
  { id: 'select', label: 'Select', key: 'V', icon: MousePointer2 },
  { id: 'slice', label: 'Slice', key: 'S', icon: Scissors },
  { id: 'erase', label: 'Erase', key: 'E', icon: Eraser },
];

const withClips = (s: MusicProject, clips: PlaylistClip[]): MusicProject => ({ ...s, playlist: { ...s.playlist, clips } });

/** One clip, LMMS-style: vertical gradient, darker border, a label strip on top. `dim` for muted clips. */
function paintClip(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, dim: boolean, selected: boolean): void {
  const grad = g.createLinearGradient(0, y, 0, y + h);
  grad.addColorStop(0, shade(color, 0.1));
  grad.addColorStop(1, shade(color, -0.18));
  g.globalAlpha = dim ? 0.38 : 1;
  g.fillStyle = grad;
  g.fillRect(x, y, w, h);
  g.fillStyle = 'rgba(0,0,0,0.24)';
  g.fillRect(x, y, w, 13);
  g.strokeStyle = shade(color, -0.4);
  g.lineWidth = 1;
  g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  g.fillStyle = 'rgba(255,255,255,0.07)';
  g.fillRect(x + 1, y + 1, Math.max(0, w - 2), 1);
  g.globalAlpha = 1;
  if (selected) { g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.strokeRect(x + 0.75, y + 0.75, w - 1.5, h - 1.5); }
}

/** Alternating darker / lighter bar bands over the track rows, then 2 px bar lines, 1 px beat lines and faint step lines. */
function paintBands(g: CanvasRenderingContext2D, p: Palette, w: number, h: number, sx: number, zoom: number, bar: number, beat: number, snap: number, rowsH: number): void {
  const from = sx / zoom;
  const to = (sx + w) / zoom;
  for (let b = Math.floor(from / bar); b * bar <= to; b++) {
    const x0 = Math.round(b * bar * zoom - sx);
    const x1 = Math.round((b + 1) * bar * zoom - sx);
    g.fillStyle = b % 2 ? p.bandB : p.bandA;
    g.fillRect(x0, 0, x1 - x0, rowsH);
  }
  const unit = snap > 0 && snap * zoom >= 9 ? snap : beat * zoom >= 9 ? beat : bar * zoom >= 9 ? bar : bar * Math.ceil(9 / (bar * zoom));
  for (let s = Math.floor(from / unit) * unit; s <= to; s += unit) {
    const x = Math.round(s * zoom - sx);
    const isBar = Math.abs(s / bar - Math.round(s / bar)) < 1e-6;
    const isBeat = Math.abs(s / beat - Math.round(s / beat)) < 1e-6;
    if (isBar) { g.fillStyle = p.lineHi; g.fillRect(x - 1, 0, 2, h); }
    else if (isBeat) { g.fillStyle = withAlpha(p.lineHi, 0.55); g.fillRect(x, 0, 1, h); }
    else { g.fillStyle = withAlpha(p.line, 0.5); g.fillRect(x, 0, 1, h); }
  }
}

export function Playlist() {
  const { song, snap, ui, assets, pattern } = useStudio();
  const act = useActions();
  const { drag, settle, edit, store, engine } = act;
  const [tool, setTool] = useState<Tool>('paint');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [zoom, setZoomState] = useState(() => store.current.plZoom ?? 5);
  const [scroll, setScrollState] = useState(() => ({ x: store.current.plSx ?? 0, y: store.current.plSy ?? 0 }));
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [marker, setMarker] = useState<{ id: string; x: number; y: number } | null>(null);
  const [renamingTrack, setRenamingTrack] = useState<number | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLCanvasElement>(null);
  const top = useRef<HTMLCanvasElement>(null);
  const playline = useRef<HTMLDivElement>(null);
  const userScroll = useRef(0);
  const [follow, cycleFollow] = useFollowMode('plFollow');
  const size = useSize(body);
  const theme = useThemeVersion();

  const clips = song.playlist.clips;
  const tracks = song.playlist.tracks;
  const bar = stepsPerBar(song);
  const beat = beatSteps(song);
  const totalSteps = songLengthSteps(song) + bar * 8;
  const gridW = Math.max(0, size.w - HEAD_W - SB);
  const gridH = Math.max(0, size.h - TOP - SB);
  const contentW = totalSteps * zoom;
  const contentH = tracks.length * TRACK_H;
  const maxX = Math.max(0, contentW - gridW);
  const maxY = Math.max(0, contentH - gridH);
  const sx = clamp(scroll.x, 0, maxX);
  const sy = clamp(scroll.y, 0, maxY);
  const live = useRef({ sx, sy, zoom, clips, sel, snap, tool });
  live.current = { sx, sy, zoom, clips, sel, snap, tool };

  const setScroll = (x: number, y: number, auto?: boolean) => {
    if (!auto) userScroll.current = performance.now();
    store.current.plSx = x;
    store.current.plSy = y;
    setScrollState({ x, y });
  };
  const setZoom = (z: number, anchorX = gridW / 2) => {
    const next = clamp(z, 0.6, 60);
    const at = (sx + anchorX) / zoom;
    store.current.plZoom = next;
    setZoomState(next);
    setScroll(clamp(at * next - anchorX, 0, Math.max(0, (songLengthSteps(song) + bar * 8) * next - gridW)), sy);
  };
  const stepAt = (px: number) => (px + live.current.sx) / live.current.zoom;
  const trackAt = (py: number) => clamp(Math.floor((py + live.current.sy) / TRACK_H), 0, Math.max(0, tracks.length - 1));
  const snapStart = (v: number) => (snap > 0 ? snapDown(v, snap) : Math.max(0, v));

  useEffect(() => { setSel((cur) => { const ids = new Set(clips.map((c) => c.id)); const next = new Set([...cur].filter((id) => ids.has(id))); return next.size === cur.size ? cur : next; }); }, [clips]);

  // ---- drawing --------------------------------------------------------------------------------
  useLayoutEffect(() => {
    const root = body.current;
    if (!root || gridW <= 0 || gridH <= 0) return;
    const p = readPalette(root);
    const stepsFrom = sx / zoom;
    const stepsTo = (sx + gridW) / zoom;
    const loop = song.playlist.loop;
    const g = prepCanvas(grid.current, gridW, gridH);
    const patInfo = new Map<string, { notes: Note[]; lo: number; hi: number; len: number }>();
    for (const pt of song.patterns) {
      const all = Object.values(pt.notes).flat();
      patInfo.set(pt.id, { notes: all, lo: all.length ? Math.min(...all.map((n) => n.key)) : 60, hi: all.length ? Math.max(...all.map((n) => n.key)) : 60, len: Math.max(1, patternSteps(song, pt)) });
    }
    if (g) {
      const rowsH = Math.min(gridH, tracks.length * TRACK_H - sy);
      g.fillStyle = p.bg0;
      g.fillRect(0, 0, gridW, gridH);
      paintBands(g, p, gridW, gridH, sx, zoom, bar, beat, snap, Math.max(0, rowsH));
      const firstT = Math.floor(sy / TRACK_H);
      const lastT = Math.min(tracks.length - 1, Math.floor((sy + gridH) / TRACK_H));
      for (let t = firstT; t <= lastT; t++) {
        const y = t * TRACK_H - sy;
        g.fillStyle = withAlpha(tracks[t].color, 0.05);
        g.fillRect(0, y, gridW, TRACK_H);
        g.fillStyle = p.lineDark;
        g.fillRect(0, y + TRACK_H - 1, gridW, 1);
        g.fillStyle = 'rgba(255,255,255,0.025)';
        g.fillRect(0, y + TRACK_H, gridW, 1);
      }
      if (loop) {
        g.fillStyle = withAlpha(p.accent2, 0.1);
        g.fillRect(loop.start * zoom - sx, 0, (loop.end - loop.start) * zoom, gridH);
      }
      for (const m of song.playlist.markers) {
        g.fillStyle = withAlpha(MARKER_COLORS[m.kind], 0.45);
        g.fillRect(Math.round(m.at * zoom - sx), 0, 1, gridH);
      }
      g.font = '10px "Segoe UI", system-ui, sans-serif';
      g.textBaseline = 'alphabetic';
      for (const c of clips) {
        const x = c.start * zoom - sx;
        const w = Math.max(3, c.length * zoom - 1);
        const y = c.trackIndex * TRACK_H - sy + 2;
        const h = TRACK_H - 5;
        if (x + w < 0 || x > gridW || y + h < 0 || y > gridH) continue;
        const pat = c.kind === 'pattern' ? song.patterns.find((q) => q.id === c.patternId) : undefined;
        const asset = c.kind === 'audio' && c.assetId ? assets.get(c.assetId) : undefined;
        const auto = c.kind === 'automation' ? song.automations.find((a) => a.id === c.automationId) : undefined;
        const color = c.kind === 'pattern' ? (pat?.color ?? p.pattern) : c.kind === 'audio' ? p.bg3 : p.violet;
        const dim = !!(c.muted || tracks[c.trackIndex]?.mute);
        paintClip(g, x, y, w, h, color, dim, sel.has(c.id));
        g.save();
        g.beginPath();
        g.rect(x + 1, y + 1, w - 2, h - 2);
        g.clip();
        if (w > 24) {
          const label = pat?.name ?? asset?.name ?? auto?.name ?? (c.kind === 'audio' ? 'Audio' : 'Automation');
          g.fillStyle = c.kind === 'audio' ? p.orange : 'rgba(255,255,255,0.95)';
          g.fillText(label, Math.max(x, 0) + 5, y + 10);
        }
        const bodyY = y + 15;
        const bodyH = h - 17;
        if (pat) {
          const info = patInfo.get(pat.id);
          if (info && info.notes.length) {
            const range = info.hi - info.lo + 1;
            const nh = Math.max(1, Math.min(4, bodyH / range));
            g.fillStyle = 'rgba(255,255,255,0.85)';
            for (let r = Math.floor(c.offset / info.len); r <= Math.floor((c.offset + c.length) / info.len); r++) {
              for (const n of info.notes) {
                const s0 = n.start + r * info.len - c.offset;
                const e = s0 + n.length;
                if (e <= 0 || s0 >= c.length) continue;
                const nx = x + Math.max(0, s0) * zoom;
                if (nx > gridW || nx + (e - s0) * zoom < 0) continue;
                g.fillRect(nx, bodyY + ((info.hi - n.key) / range) * (bodyH - nh), Math.max(1, (Math.min(e, c.length) - Math.max(s0, 0)) * zoom - 0.5), nh);
              }
            }
            // a faint tick where the pattern repeats
            g.fillStyle = 'rgba(0,0,0,0.3)';
            for (let s0 = info.len - (c.offset % info.len); s0 < c.length; s0 += info.len) g.fillRect(x + s0 * zoom, y + 13, 1, h - 13);
          }
        } else if (auto && auto.points.length) {
          const pts = [...auto.points].sort((a, b) => a.t - b.t);
          const at = (t: number, v: number): [number, number] => [x + (t - c.offset) * zoom, bodyY + (1 - v) * (bodyH - 2) + 1];
          const trace = () => {
            const [x0, y0] = at(pts[0].t, pts[0].v);
            g.moveTo(Math.min(x0, x), y0);
            g.lineTo(x0, y0);
            for (let i = 1; i < pts.length; i++) {
              const [px, py] = at(pts[i].t, pts[i].v);
              if (pts[i - 1].curve === 'hold') g.lineTo(px, at(pts[i - 1].t, pts[i - 1].v)[1]);
              g.lineTo(px, py);
            }
            g.lineTo(x + w, at(pts[pts.length - 1].t, pts[pts.length - 1].v)[1]);
          };
          g.beginPath();
          trace();
          g.lineTo(x + w, bodyY + bodyH);
          g.lineTo(Math.min(at(pts[0].t, 0)[0], x), bodyY + bodyH);
          g.closePath();
          g.fillStyle = 'rgba(255,255,255,0.14)';
          g.fill();
          g.strokeStyle = 'rgba(255,255,255,0.92)';
          g.lineWidth = 1.5;
          g.beginPath();
          trace();
          g.stroke();
        } else if (asset) {
          g.fillStyle = withAlpha(p.orange, 0.35);
          g.fillRect(x, bodyY + bodyH / 2, w, 1);
        }
        g.restore();
      }
    }

    const t = prepCanvas(top.current, gridW, TOP);
    if (t) {
      const grad = t.createLinearGradient(0, 0, 0, RULER_H);
      grad.addColorStop(0, p.bg4);
      grad.addColorStop(1, p.bg3);
      t.fillStyle = grad;
      t.fillRect(0, 0, gridW, RULER_H);
      t.fillStyle = p.bg0;
      t.fillRect(0, RULER_H, gridW, MARK_H);
      t.fillStyle = p.lineDark;
      t.fillRect(0, RULER_H - 1, gridW, 1);
      if (loop) {
        t.fillStyle = withAlpha(p.accent2, 0.38);
        t.fillRect(loop.start * zoom - sx, 0, (loop.end - loop.start) * zoom, RULER_H - 1);
        t.fillStyle = p.accent2;
        t.fillRect(loop.start * zoom - sx, 0, 2, RULER_H - 1);
        t.fillRect(loop.end * zoom - sx - 2, 0, 2, RULER_H - 1);
      }
      t.font = '10px Consolas, "Cascadia Code", monospace';
      t.textBaseline = 'middle';
      const lineStep = beat * zoom >= 16 ? beat : bar * zoom >= 16 ? bar : bar * Math.ceil(16 / (bar * zoom));
      for (let s = Math.floor(stepsFrom / lineStep) * lineStep; s <= stepsTo; s += lineStep) {
        const x = Math.round(s * zoom - sx);
        const isBar = Math.abs(s / bar - Math.round(s / bar)) < 1e-6;
        t.fillStyle = isBar ? p.dim : p.bg4;
        t.fillRect(x, isBar ? 3 : RULER_H - 6, 1, isBar ? RULER_H - 4 : 5);
        if (isBar) { t.fillStyle = p.text; t.fillText(String(Math.round(s / bar) + 1), x + 4, RULER_H / 2 - 1); }
      }
      t.font = '10px "Segoe UI", system-ui, sans-serif';
      for (const m of song.playlist.markers) {
        const x = m.at * zoom - sx;
        if (x < -120 || x > gridW) continue;
        const wText = Math.min(110, t.measureText(m.name).width + 12);
        t.fillStyle = MARKER_COLORS[m.kind];
        t.fillRect(x, RULER_H + 1, wText, MARK_H - 3);
        t.fillRect(x, RULER_H, 2, MARK_H);
        t.fillStyle = 'rgba(0,0,0,0.85)';
        t.fillText(m.name, x + 6, RULER_H + MARK_H / 2, 100);
      }
    }
  }, [song.playlist, song.patterns, song.automations, song.view.mode, clips, tracks, sel, sx, sy, zoom, gridW, gridH, snap, assets, bar, beat, theme]);

  // The playhead glides from the engine's position; stopped, it rests on the play-from mark (song mode).
  useRaf(true, () => {
    const pos = songLine(engine, ui, song);
    if (pos === null) { placeLine(playline.current, null, gridW); return; }
    if (engine.playing && follow && performance.now() - userScroll.current > 1500) {
      const to = followScroll(follow, pos * zoom, gridW, sx, maxX);
      if (to !== null) { setScroll(to, sy, true); placeLine(playline.current, pos * zoom - to, gridW); return; }
    }
    placeLine(playline.current, pos * zoom - sx, gridW);
  });

  // ---- clip gestures ----------------------------------------------------------------------------
  const local = (e: { clientX: number; clientY: number }) => {
    const r = grid.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const hitAt = (x: number, y: number): { clip: PlaylistClip; edge: 'left' | 'right' | 'body' } | null => {
    const l = live.current;
    const t = Math.floor((y + l.sy) / TRACK_H);
    const step = (x + l.sx) / l.zoom;
    for (let i = l.clips.length - 1; i >= 0; i--) {
      const c = l.clips[i];
      if (c.trackIndex !== t || step < c.start || step >= c.start + c.length) continue;
      const w = c.length * l.zoom;
      const px = x - (c.start * l.zoom - l.sx);
      return { clip: c, edge: w > 16 && px <= 6 ? 'left' : w > 16 && px >= w - 6 ? 'right' : 'body' };
    }
    return null;
  };
  const locked = (t: number) => !!tracks[t]?.locked;

  const down = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 2) return;
    e.preventDefault();
    (e.currentTarget.closest('.ms-pl') as HTMLElement | null)?.focus();
    const l = live.current;
    const pt = local(e);
    const hit = hitAt(pt.x, pt.y);
    const orig = l.clips;
    const startX = e.clientX;
    const startY = e.clientY;

    if (e.button === 2) {
      if (hit && !locked(hit.clip.trackIndex)) {
        const gone = l.sel.has(hit.clip.id) ? l.sel : new Set([hit.clip.id]);
        edit((s) => withClips(s, s.playlist.clips.filter((c) => !gone.has(c.id))), 'remove clips');
      }
      return;
    }
    if (l.tool === 'slice') {
      if (!hit || locked(hit.clip.trackIndex)) return;
      const at = l.snap > 0 ? snapTo(stepAt(pt.x), l.snap) : stepAt(pt.x);
      const c = hit.clip;
      if (at <= c.start + 0.01 || at >= c.start + c.length - 0.01) return;
      edit((s) => withClips(s, s.playlist.clips.flatMap((o) => (o.id === c.id ? [{ ...o, length: at - o.start }, { ...o, id: musicId(), start: at, length: o.start + o.length - at, offset: o.offset + (at - o.start) }] : [o]))), 'slice clip');
      return;
    }
    if (l.tool === 'erase') {
      const gone = new Set<string>();
      const sweep = (ev: { clientX: number; clientY: number }) => {
        const q = local(ev);
        const h = hitAt(q.x, q.y);
        if (h && !locked(h.clip.trackIndex) && !gone.has(h.clip.id)) { gone.add(h.clip.id); drag((s) => withClips(s, orig.filter((c) => !gone.has(c.id)))); }
      };
      sweep(e);
      trackPointer(sweep, () => { settle('Music: remove clips'); setSel(new Set()); });
      return;
    }

    let base = orig;
    let moving: Set<string>;
    let anchor: PlaylistClip;
    let mode: 'move' | 'left' | 'right' = 'move';
    if (hit) {
      anchor = hit.clip;
      if (locked(anchor.trackIndex)) return;
      if (e.shiftKey && l.sel.has(anchor.id)) { setSel(new Set([...l.sel].filter((id) => id !== anchor.id))); return; }
      const next = l.sel.has(anchor.id) ? l.sel : e.shiftKey ? new Set([...l.sel, anchor.id]) : new Set([anchor.id]);
      setSel(next);
      moving = new Set(next);
      mode = hit.edge === 'body' ? 'move' : hit.edge;
    } else if (l.tool === 'paint') {
      const pat = song.patterns.find((q) => q.id === song.view.activePatternId);
      const t = trackAt(pt.y);
      if (!pat || locked(t)) { if (!pat) act.toast({ tone: 'info', title: 'No pattern selected', body: 'Pick or create a pattern in the toolbar first.' }); return; }
      const start = snapStart(stepAt(pt.x));
      if (orig.some((c) => c.trackIndex === t && c.start <= start && c.start + c.length > start)) return;
      const next = orig.filter((c) => c.trackIndex === t && c.start > start).reduce((m, c) => Math.min(m, c.start), Infinity);
      const length = Math.min(patternSteps(song, pat), next - start);
      if (length <= 0) return;
      anchor = { id: musicId(), trackIndex: t, start, length, offset: 0, kind: 'pattern', patternId: pat.id };
      base = [...orig, anchor];
      moving = new Set([anchor.id]);
      setSel(moving);
      drag((s) => withClips(s, base));
    } else {
      const keep = e.shiftKey ? new Set(l.sel) : new Set<string>();
      if (!e.shiftKey) setSel(new Set());
      const mq = (ev: { clientX: number; clientY: number }) => {
        const q = local(ev);
        const r = { x0: Math.min(pt.x, q.x), y0: Math.min(pt.y, q.y), x1: Math.max(pt.x, q.x), y1: Math.max(pt.y, q.y) };
        setMarquee(r);
        const next = new Set(keep);
        for (const c of orig) {
          const cx = c.start * l.zoom - l.sx;
          const cy = c.trackIndex * TRACK_H - l.sy;
          if (cx < r.x1 && cx + c.length * l.zoom > r.x0 && cy < r.y1 && cy + TRACK_H > r.y0) next.add(c.id);
        }
        setSel(next);
      };
      trackPointer(mq, () => setMarquee(null));
      return;
    }

    let moved = false;
    let dups: Map<string, string> | null = null;
    const startTrack = trackAt(pt.y);
    const minLen = snap > 0 ? snap : 1;
    trackPointer(
      (ev) => {
        if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 3) return;
        moved = true;
        const now = live.current;
        const dx = (ev.clientX - startX) / now.zoom;
        const movers = base.filter((c) => moving.has(c.id));
        if (mode === 'move') {
          if (ev.ctrlKey && !dups) { dups = new Map(movers.map((c) => [c.id, musicId()])); setSel(new Set(dups.values())); }
          let ds = now.snap > 0 ? snapTo(anchor.start + dx, now.snap) - anchor.start : dx;
          ds = Math.max(ds, -Math.min(...movers.map((c) => c.start)));
          const dt = trackAt(local(ev).y) - startTrack;
          const lo = Math.min(...movers.map((c) => c.trackIndex));
          const hi = Math.max(...movers.map((c) => c.trackIndex));
          const dTrack = clamp(dt, -lo, tracks.length - 1 - hi);
          const shifted = (c: PlaylistClip): PlaylistClip => ({ ...c, start: Math.max(0, c.start + ds), trackIndex: c.trackIndex + dTrack });
          drag((s) => withClips(s, dups ? [...base, ...movers.map((c) => ({ ...shifted(c), id: dups!.get(c.id) as string }))] : base.map((c) => (moving.has(c.id) ? shifted(c) : c))));
        } else if (mode === 'right') {
          const end = anchor.start + anchor.length;
          const dl = (now.snap > 0 ? snapTo(end + dx, now.snap) : end + dx) - end;
          drag((s) => withClips(s, base.map((c) => (moving.has(c.id) ? { ...c, length: Math.max(minLen, c.length + dl) } : c))));
        } else {
          let ds = now.snap > 0 ? snapTo(anchor.start + dx, now.snap) - anchor.start : dx;
          ds = clamp(ds, -Math.min(anchor.start, anchor.offset), anchor.length - minLen);
          drag((s) => withClips(s, base.map((c) => (moving.has(c.id) ? { ...c, start: c.start + ds, length: c.length - ds, offset: c.offset + ds } : c))));
        }
      },
      () => settle(mode === 'move' ? (moved ? 'Music: move clips' : 'Music: add clip') : 'Music: resize clips'),
    );
  };

  const hover = (e: React.PointerEvent) => {
    if (e.buttons || !grid.current) return;
    const pt = local(e);
    const hit = hitAt(pt.x, pt.y);
    const t = live.current.tool;
    grid.current.style.cursor = hit ? (t === 'slice' ? 'col-resize' : t === 'erase' ? 'not-allowed' : hit.edge === 'body' ? 'move' : 'ew-resize') : t === 'paint' ? 'copy' : 'default';
  };

  const dblClip = (e: React.MouseEvent) => {
    const pt = local(e);
    const hit = hitAt(pt.x, pt.y);
    if (hit?.clip.kind === 'pattern' && hit.clip.patternId) {
      act.setView({ activePatternId: hit.clip.patternId });
      act.setUi({ win: 'rack' });
    }
  };

  // ---- ruler & markers --------------------------------------------------------------------------
  const topDown = (e: React.PointerEvent) => {
    if (!top.current) return;
    e.preventDefault();
    (e.currentTarget.closest('.ms-pl') as HTMLElement | null)?.focus();
    const r = top.current.getBoundingClientRect();
    const x0 = e.clientX - r.left;
    const y0 = e.clientY - r.top;
    const raw = (x: number) => (x + live.current.sx) / live.current.zoom;
    const gridSnap = snap > 0 ? snap : 1;
    if (y0 >= RULER_H) {
      const l = live.current;
      const hit = [...song.playlist.markers].reverse().find((m) => {
        const x = m.at * l.zoom - l.sx;
        return x0 >= x && x0 <= x + Math.min(110, m.name.length * 6 + 12);
      });
      if (hit && e.button === 0) {
        setMarker({ id: hit.id, x: e.clientX, y: e.clientY });
        const startAt = hit.at;
        let moved = false;
        trackPointer((ev) => {
          const at = Math.max(0, snapTo(raw(ev.clientX - r.left), gridSnap));
          if (Math.abs(at - startAt) < 1e-6 && !moved) return;
          moved = true;
          setMarker(null);
          drag((s) => ({ ...s, playlist: { ...s.playlist, markers: s.playlist.markers.map((m) => (m.id === hit.id ? { ...m, at } : m)) } }));
        }, () => settle('Music: move marker'));
      }
      return;
    }
    if (e.button === 2) { edit((s) => ({ ...s, playlist: { ...s.playlist, loop: null } }), 'clear loop'); return; }
    let moved = false;
    trackPointer(
      (ev) => {
        if (!moved && Math.abs(ev.clientX - e.clientX) < 4) return;
        moved = true;
        const a = Math.max(0, snapTo(raw(x0), gridSnap));
        const b = Math.max(0, snapTo(raw(ev.clientX - r.left), gridSnap));
        if (Math.abs(b - a) < gridSnap) return;
        drag((s) => ({ ...s, playlist: { ...s.playlist, loop: { start: Math.min(a, b), end: Math.max(a, b) } } }));
      },
      () => {
        if (moved) { settle('Music: loop region'); return; }
        const from = Math.max(0, snapTo(raw(x0), gridSnap));
        act.setUi({ playFrom: from });
        if (engine.playing) act.play(from);
      },
    );
  };
  const topDouble = (e: React.MouseEvent) => {
    if (!top.current) return;
    const r = top.current.getBoundingClientRect();
    if (e.clientY - r.top < RULER_H) return;
    const x = e.clientX - r.left;
    const l = live.current;
    if (song.playlist.markers.some((m) => x >= m.at * l.zoom - l.sx && x <= m.at * l.zoom - l.sx + Math.min(110, m.name.length * 6 + 12))) return;
    const at = Math.max(0, snapTo((x + l.sx) / l.zoom, snap > 0 ? snap : bar));
    const id = musicId();
    edit((s) => ({ ...s, playlist: { ...s.playlist, markers: [...s.playlist.markers, { id, at, name: 'Section', kind: 'marker' }] } }), 'add marker');
    setMarker({ id, x: e.clientX, y: e.clientY });
  };
  const editingMarker = marker ? song.playlist.markers.find((m) => m.id === marker.id) : undefined;
  const patchMarker = (id: string, change: (m: { name: string; kind: MarkerKind }) => Partial<{ name: string; kind: MarkerKind }>) =>
    edit((s) => ({ ...s, playlist: { ...s.playlist, markers: s.playlist.markers.map((m) => (m.id === id ? { ...m, ...change(m) } : m)) } }), 'edit marker');

  // ---- drops, wheel, keys -----------------------------------------------------------------------
  const drop = (e: React.DragEvent) => {
    const id = e.dataTransfer.getData(ASSET_DRAG);
    const asset = id ? assets.get(id) : undefined;
    if (!asset || !grid.current) return;
    e.preventDefault();
    const pt = local(e);
    const t = trackAt(pt.y);
    const length = Math.max(1, (asset.duration * song.bpm * song.stepsPerBeat) / 60);
    edit((s) => addClip(s, { trackIndex: t, start: snapStart(stepAt(pt.x)), length, offset: 0, kind: 'audio', assetId: asset.id, gain: 0 }), `add ${asset.name}`);
  };
  useWheel(body, (e) => {
    e.preventDefault();
    const l = live.current;
    const r = grid.current?.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) setZoom(l.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), r ? e.clientX - r.left : undefined);
    else if (e.shiftKey) setScroll(clamp(l.sx + e.deltaY, 0, maxX), l.sy);
    else setScroll(clamp(l.sx + e.deltaX, 0, maxX), clamp(l.sy + e.deltaY, 0, maxY));
  });

  const selected = clips.filter((c) => sel.has(c.id));
  const keyDown = (e: React.KeyboardEvent) => {
    if (typingTarget(e.target)) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key;
    const handled = () => { e.preventDefault(); e.stopPropagation(); };
    if (ctrl && k.toLowerCase() === 'a') { handled(); setSel(new Set(clips.map((c) => c.id))); return; }
    if (ctrl && k.toLowerCase() === 'd') {
      if (!selected.length) return;
      handled();
      const lo = Math.min(...selected.map((c) => c.start));
      const hi = Math.max(...selected.map((c) => c.start + c.length));
      const copies = selected.map((c) => ({ ...c, id: musicId(), start: c.start + (hi - lo) }));
      edit((s) => withClips(s, [...s.playlist.clips, ...copies]), 'duplicate clips');
      setSel(new Set(copies.map((c) => c.id)));
      return;
    }
    if (ctrl) return;
    if (k === KEY_DEL || k === 'Backspace') { if (selected.length) { handled(); edit((s) => withClips(s, s.playlist.clips.filter((c) => !sel.has(c.id))), 'remove clips'); setSel(new Set()); } return; }
    if (k === 'Escape') { handled(); setSel(new Set()); return; }
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      if (!selected.length) return;
      handled();
      const d = (k === 'ArrowLeft' ? -1 : 1) * (snap > 0 ? snap : 1);
      edit((s) => withClips(s, s.playlist.clips.map((c) => (sel.has(c.id) ? { ...c, start: Math.max(0, c.start + d) } : c))), 'nudge clips');
      return;
    }
    if (k.toLowerCase() === 'm' && selected.length) { handled(); edit((s) => withClips(s, s.playlist.clips.map((c) => (sel.has(c.id) ? { ...c, muted: !c.muted } : c))), 'mute clips'); return; }
    const next = ({ p: 'paint', v: 'select', s: 'slice', e: 'erase' } as Record<string, Tool>)[k.toLowerCase()];
    if (next && !e.altKey) { handled(); setTool(next); }
  };

  const firstT = Math.floor(sy / TRACK_H);
  const lastT = Math.min(tracks.length - 1, Math.floor((sy + gridH) / TRACK_H));
  const patch = (i: number, change: (t: MusicProject['playlist']['tracks'][number]) => MusicProject['playlist']['tracks'][number]) =>
    drag((s) => ({ ...s, playlist: { ...s.playlist, tracks: s.playlist.tracks.map((t, j) => (j === i ? change(t) : t)) } }));

  return (
    <section className="ms-pl ms-win" tabIndex={-1} onKeyDown={keyDown} aria-label="Playlist">
      <TitleBar icon={<LayoutList size={13} />} title="Playlist" onClose={() => act.setUi({ playlist: false })} closeLabel="Hide the playlist (F5)">
        <FollowButton mode={follow} onCycle={cycleFollow} />
        <button type="button" className="ms-win-btn" aria-label="Zoom out" title="Zoom out (Ctrl+wheel)" onClick={() => setZoom(zoom / 1.3)}><ZoomOut size={13} /></button>
        <button type="button" className="ms-win-btn" aria-label="Zoom in" title="Zoom in (Ctrl+wheel)" onClick={() => setZoom(zoom * 1.3)}><ZoomIn size={13} /></button>
      </TitleBar>
      <div className="ms-tools">
        <div className="ms-seg" role="group" aria-label="Tools">
          {TOOLS.map((t) => <button key={t.id} type="button" className={tool === t.id ? 'on' : ''} aria-pressed={tool === t.id} aria-label={`${t.label} tool`} title={`${t.label} (${t.key})`} onClick={() => setTool(t.id)}><t.icon size={13} /></button>)}
        </div>
        {pattern && <span className="ms-chip" title="Paint places this pattern"><i className="ms-swatch" style={{ background: pattern.color }} /> {pattern.name}</span>}
        <button type="button" className="ms-btn" title="Add a track" onClick={() => edit((s) => ({ ...s, playlist: { ...s.playlist, tracks: [...s.playlist.tracks, newTrack(s.playlist.tracks.length)] } }), 'add track')}><Plus size={12} /> Track</button>
        {selected.length > 0 && <button type="button" className="ms-btn" onClick={() => edit((s) => withClips(s, s.playlist.clips.filter((c) => !sel.has(c.id))), 'remove clips')}><Trash2 size={12} /> Remove {selected.length}</button>}
        <span className="ms-dim ms-hint">Ruler: drag = loop · click = play from · double-click marker lane = section</span>
      </div>
      <div ref={body} className="ms-pl-body" onDragOver={(e) => { if (e.dataTransfer.types.includes(ASSET_DRAG)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }} onDrop={drop}>
        <div className="ms-pl-corner" style={{ width: HEAD_W, height: TOP }}><Flag size={12} /> Tracks</div>
        <canvas ref={top} className="ms-pl-top" style={{ left: HEAD_W, top: 0 }} onPointerDown={topDown} onDoubleClick={topDouble} onContextMenu={(e) => e.preventDefault()} aria-label="Ruler, loop region and section markers" />
        <div className="ms-pl-heads" style={{ top: TOP, width: HEAD_W, height: gridH }}>
          {Array.from({ length: Math.max(0, lastT - firstT + 1) }, (_, k) => {
            const i = firstT + k;
            const t = tracks[i];
            return (
              <div key={t.id} className={`ms-pl-head${t.mute ? ' muted' : ''}`} style={{ top: i * TRACK_H - sy, height: TRACK_H, ['--ch' as string]: t.color }}>
                <span className="ms-pl-tn">{i + 1}</span>
                <ColorInput label={`Colour of ${t.name}`} value={t.color} onChange={(color) => patch(i, (x) => ({ ...x, color }))} onEnd={() => settle('Music: track colour')} className="ms-color sm" />
                {renamingTrack === i ? (
                  <input
                    className="ms-input ms-name" autoFocus defaultValue={t.name} aria-label="Track name"
                    onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenamingTrack(null); }}
                    onBlur={(e) => { const name = e.target.value.trim(); setRenamingTrack(null); if (name && name !== t.name) edit((s) => ({ ...s, playlist: { ...s.playlist, tracks: s.playlist.tracks.map((x, j) => (j === i ? { ...x, name } : x)) } }), 'rename track'); }}
                  />
                ) : <span className="ms-name" title={`${t.name} (double-click to rename)`} onDoubleClick={() => setRenamingTrack(i)}>{t.name}</span>}
                <button type="button" className={`ms-mini mute${t.mute ? ' on' : ''}`} aria-pressed={t.mute} aria-label={`Mute ${t.name}`} title="Mute track" onClick={() => edit((s) => ({ ...s, playlist: { ...s.playlist, tracks: s.playlist.tracks.map((x, j) => (j === i ? { ...x, mute: !x.mute } : x)) } }), 'mute track')}><VolumeX size={10} /></button>
                <button type="button" className={`ms-mini solo${t.solo ? ' on' : ''}`} aria-pressed={t.solo} aria-label={`Solo ${t.name}`} title="Solo track" onClick={() => edit((s) => ({ ...s, playlist: { ...s.playlist, tracks: s.playlist.tracks.map((x, j) => (j === i ? { ...x, solo: !x.solo } : x)) } }), 'solo track')}><Headphones size={10} /></button>
                <button type="button" className={`ms-mini${t.locked ? ' on' : ''}`} aria-pressed={!!t.locked} aria-label={`${t.locked ? 'Unlock' : 'Lock'} ${t.name}`} title={t.locked ? 'Locked' : 'Lock track'} onClick={() => edit((s) => ({ ...s, playlist: { ...s.playlist, tracks: s.playlist.tracks.map((x, j) => (j === i ? { ...x, locked: !x.locked } : x)) } }), 'lock track')}>{t.locked ? <Lock size={10} /> : <Unlock size={10} />}</button>
              </div>
            );
          })}
        </div>
        <canvas ref={grid} className="ms-pl-grid" style={{ left: HEAD_W, top: TOP }} onPointerDown={down} onPointerMove={hover} onDoubleClick={dblClip} onContextMenu={(e) => e.preventDefault()} aria-label="Playlist clips" />
        {gridW > 0 && gridH > 0 && <PlayLine lineRef={playline} left={HEAD_W} top={0} width={gridW} height={TOP + gridH} />}
        {clips.length === 0 && gridW > 120 && gridH > 60 && (
          <div className="ms-pl-empty" style={{ left: HEAD_W, top: TOP, width: gridW, height: gridH }}>
            <div className="ms-empty-card">
              <div className="ms-empty-icon"><Layers size={22} /></div>
              <strong>The arrangement is empty</strong>
              <span>{pattern ? 'Paint patterns on the grid, or start with the active one.' : 'Create a pattern in the toolbar, then paint it here.'}</span>
              {pattern && (
                <button type="button" className="ms-btn ms-primary" onClick={() => edit((s) => withClips(s, [...s.playlist.clips, { id: musicId(), trackIndex: 0, start: 0, length: patternSteps(s, pattern), offset: 0, kind: 'pattern', patternId: pattern.id }]), 'add clip')}>
                  <Plus size={12} /> Place {pattern.name} at bar 1
                </button>
              )}
            </div>
          </div>
        )}
        {marquee && <div className="ms-marquee" style={{ left: HEAD_W + marquee.x0, top: TOP + marquee.y0, width: marquee.x1 - marquee.x0, height: marquee.y1 - marquee.y0 }} />}
        <div className="ms-sb-v" style={{ top: TOP, height: gridH }}><ScrollBar vertical total={contentH} view={gridH} pos={sy} onPos={(v) => setScroll(sx, v)} /></div>
        <div className="ms-sb-h" style={{ left: HEAD_W, width: gridW }}><ScrollBar total={contentW} view={gridW} pos={sx} onPos={(v) => setScroll(v, sy)} /></div>
      </div>
      {marker && editingMarker && (
        <div className="ms-pop" style={{ left: clamp(marker.x - 40, 8, window.innerWidth - 240), top: clamp(marker.y + 12, 8, window.innerHeight - 140) }} role="dialog" aria-label="Section marker">
          <input className="ms-input" autoFocus aria-label="Marker name" defaultValue={editingMarker.name} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') { patchMarker(editingMarker.id, () => ({ name: e.currentTarget.value.trim() || 'Section' })); setMarker(null); } if (e.key === 'Escape') setMarker(null); }} onBlur={(e) => { const name = e.target.value.trim(); if (name && name !== editingMarker.name) patchMarker(editingMarker.id, () => ({ name })); }} />
          <select aria-label="Marker kind" value={editingMarker.kind} onChange={(e) => patchMarker(editingMarker.id, (m) => ({ kind: e.target.value as MarkerKind, name: m.name === 'Section' || MARKER_KINDS.includes(m.name as MarkerKind) ? e.target.value : m.name }))}>
            {MARKER_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <div className="ms-pop-row">
            <button type="button" className="ms-btn" onClick={() => { edit((s) => ({ ...s, playlist: { ...s.playlist, markers: s.playlist.markers.filter((m) => m.id !== editingMarker.id) } }), 'remove marker'); setMarker(null); }}><Trash2 size={12} /> Remove</button>
            <button type="button" className="ms-btn" onClick={() => setMarker(null)}>Done</button>
          </div>
        </div>
      )}
    </section>
  );
}
