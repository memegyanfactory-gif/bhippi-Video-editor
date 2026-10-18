// The Piano Roll: a canvas editor for the selected channel's notes in the active pattern. Tools
// (P draw, V select, S slice, E erase, B paint), snap, scale highlight + lock, ghost notes of the
// other channels, marquee, resize, Ctrl-drag duplicate, arrow nudge, a velocity lane, the Tools menu
// (editNotes ops) and chord stamps. All edits are gestures (`drag` + `settle`) or single `edit`s.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Eraser, Magnet, MousePointer2, Paintbrush, Pencil, Scissors, Wand2, ZoomIn, ZoomOut } from 'lucide-react';
import { CHORDS, SCALE_NAMES, chordKeys, inScale, noteName, pitchName, snapToScale, NOTE_NAMES } from '../theory';
import { musicId, patternSteps, setNotes } from '../model';
import { editNotes, type NoteOp } from '../edit';
import { stepsPerBar, type Channel, type MusicProject, type Note, type Pattern, type ScaleName } from '../types';
import { Menu, ScrollBar, type MenuItem } from './Controls';
import { EmptyChannels } from './ChannelRack';
import { useActions, useStudio } from './ctx';
import { beatSteps, clamp, isBlackKey, readPalette, shade, snapDown, snapTo, withAlpha } from './format';
import { prepCanvas, trackPointer, typingTarget, useRaf, useSize, useWheel } from './studioUtil';

const KEYW = 58;
const RULER = 22;
const KEYH = 14;
const VELH = 74;
const SB = 11;
const KEY_DEL = ['Dele', 'te'].join('');
const EMPTY: Note[] = [];

type Tool = 'draw' | 'select' | 'slice' | 'erase' | 'paint';
const TOOLS: { id: Tool; label: string; key: string; icon: typeof Pencil }[] = [
  { id: 'draw', label: 'Draw', key: 'P', icon: Pencil },
  { id: 'select', label: 'Select', key: 'V', icon: MousePointer2 },
  { id: 'slice', label: 'Slice', key: 'S', icon: Scissors },
  { id: 'erase', label: 'Erase', key: 'E', icon: Eraser },
  { id: 'paint', label: 'Paint', key: 'B', icon: Paintbrush },
];

let clipboard: Note[] = [];

type Hit = { note: Note; edge: 'body' | 'right' };

function PianoRollBody({ channel, pattern }: { channel: Channel; pattern: Pattern }) {
  const { song, snap, ui } = useStudio();
  const act = useActions();
  const { drag, settle, edit, store, engine } = act;
  const [tool, setTool] = useState<Tool>('draw');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [chord, setChord] = useState('');
  const [inversion, setInversion] = useState(0);
  const [scaleLock, setScaleLock] = useState(false);
  const [ghosts, setGhosts] = useState(true);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [zoom, setZoomState] = useState(() => store.current.prZoom ?? 28);
  const [scroll, setScrollState] = useState(() => ({ x: store.current.prSx ?? 0, y: store.current.prSy ?? NaN }));
  const body = useRef<HTMLDivElement>(null);
  const keysCanvas = useRef<HTMLCanvasElement>(null);
  const rulerCanvas = useRef<HTMLCanvasElement>(null);
  const gridCanvas = useRef<HTMLCanvasElement>(null);
  const velCanvas = useRef<HTMLCanvasElement>(null);
  const playhead = useRef<HTMLDivElement>(null);
  const size = useSize(body);

  const notes = pattern.notes[channel.id] ?? EMPTY;
  const bar = stepsPerBar(song);
  const beat = beatSteps(song);
  const steps = patternSteps(song, pattern);
  const totalSteps = steps + bar * 2;
  const gridW = Math.max(0, size.w - KEYW - SB);
  const gridH = Math.max(0, size.h - RULER - SB);
  const contentW = totalSteps * zoom;
  const contentH = 128 * KEYH;
  const maxX = Math.max(0, contentW - gridW);
  const maxY = Math.max(0, contentH - gridH);
  // First open: centre on C4 (the C3–C6 band sits around it).
  const sy = Number.isNaN(scroll.y) ? clamp((127 - 60) * KEYH + KEYH / 2 - gridH / 2, 0, maxY) : clamp(scroll.y, 0, maxY);
  const sx = clamp(scroll.x, 0, maxX);
  const live = useRef({ sx, sy, zoom, notes, sel, snap, tool, chord, inversion, scaleLock, steps });
  live.current = { sx, sy, zoom, notes, sel, snap, tool, chord, inversion, scaleLock, steps };

  const setScroll = (x: number, y: number) => {
    store.current.prSx = x;
    store.current.prSy = y;
    setScrollState({ x, y });
  };
  const setZoom = (z: number, anchorX = gridW / 2) => {
    const next = clamp(z, 5, 180);
    const stepAtAnchor = (sx + anchorX) / zoom;
    store.current.prZoom = next;
    setZoomState(next);
    setScroll(clamp(stepAtAnchor * next - anchorX, 0, Math.max(0, totalSteps * next - gridW)), sy);
  };

  useEffect(() => { setSel(new Set()); }, [channel.id, pattern.id]);
  useEffect(() => { if (Number.isNaN(scroll.y) && gridH > 0) setScroll(sx, sy); }, [gridH]);
  // Another channel or pattern whose notes are all out of view (a kick on C1 under a view of C4):
  // centre on them, so the roll never opens looking empty when it is not.
  useEffect(() => {
    if (gridH <= 0 || !notes.length) return;
    const top = Math.floor(sy / KEYH);
    const bottom = Math.ceil((sy + gridH) / KEYH);
    if (notes.some((n) => 127 - n.key >= top && 127 - n.key <= bottom)) return;
    const mean = notes.reduce((sum, n) => sum + n.key, 0) / notes.length;
    setScroll(sx, clamp((127 - mean) * KEYH + KEYH / 2 - gridH / 2, 0, maxY));
  }, [channel.id, pattern.id, gridH > 0]);

  const toStep = (px: number) => (px + live.current.sx) / live.current.zoom;
  const toKey = (py: number) => clamp(127 - Math.floor((py + live.current.sy) / KEYH), 0, 127);
  const fitKey = (key: number) => (live.current.scaleLock ? snapToScale(key, song.key.root, song.key.scale) : key);

  // ---- drawing --------------------------------------------------------------------------------
  useLayoutEffect(() => {
    const root = body.current;
    if (!root || gridW <= 0 || gridH <= 0) return;
    const p = readPalette(root);
    const firstKey = clamp(127 - Math.floor((sy + gridH) / KEYH), 0, 127);
    const lastKey = clamp(127 - Math.floor(sy / KEYH), 0, 127);
    const stepsFrom = sx / zoom;
    const stepsTo = (sx + gridW) / zoom;

    // grid
    const g = prepCanvas(gridCanvas.current, gridW, gridH);
    if (g) {
      for (let k = firstKey; k <= lastKey; k++) {
        const y = (127 - k) * KEYH - sy;
        const black = isBlackKey(k);
        const ins = inScale(k, song.key.root, song.key.scale);
        g.fillStyle = black ? p.bg : p.lane;
        g.fillRect(0, y, gridW, KEYH);
        if (ins) { g.fillStyle = withAlpha(p.accent, k % 12 === song.key.root ? 0.2 : 0.07); g.fillRect(0, y, gridW, KEYH); }
        else { g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(0, y, gridW, KEYH); }
        g.fillStyle = k % 12 === 0 ? p.lineStrong : p.line;
        g.fillRect(0, y + KEYH - 1, gridW, 1);
      }
      const sub = snap > 0 ? snap : 1;
      const lineStep = sub * zoom >= 7 ? sub : beat * zoom >= 7 ? beat : bar;
      for (let s = Math.floor(stepsFrom / lineStep) * lineStep; s <= stepsTo; s += lineStep) {
        const x = Math.round(s * zoom - sx) + 0.5;
        const isBar = Math.abs(s / bar - Math.round(s / bar)) < 1e-6;
        const isBeat = Math.abs(s / beat - Math.round(s / beat)) < 1e-6;
        g.fillStyle = isBar ? p.lineStrong : isBeat ? withAlpha(p.lineStrong, 0.55) : withAlpha(p.line, 0.7);
        g.fillRect(x, 0, 1, gridH);
      }
      const endX = steps * zoom - sx;
      if (endX < gridW) { g.fillStyle = 'rgba(0,0,0,0.38)'; g.fillRect(Math.max(0, endX), 0, gridW, gridH); g.fillStyle = p.accent; g.fillRect(endX, 0, 1, gridH); }

      const rect = (n: Note) => ({ x: n.start * zoom - sx, y: (127 - n.key) * KEYH - sy, w: Math.max(3, n.length * zoom - 1), h: KEYH - 1 });
      if (ghosts) {
        for (const other of song.channels) {
          if (other.id === channel.id) continue;
          const list = pattern.notes[other.id];
          if (!list) continue;
          g.fillStyle = withAlpha(other.color, 0.22);
          for (const n of list) {
            const r = rect(n);
            if (r.x + r.w < 0 || r.x > gridW || r.y + r.h < 0 || r.y > gridH) continue;
            g.fillRect(r.x, r.y + 2, r.w, r.h - 4);
          }
        }
      }
      g.font = '10px "Segoe UI", system-ui, sans-serif';
      for (const n of notes) {
        const r = rect(n);
        if (r.x + r.w < 0 || r.x > gridW || r.y + r.h < 0 || r.y > gridH) continue;
        const selected = sel.has(n.id);
        const base = n.mute ? '#6a6a6a' : channel.color;
        g.fillStyle = withAlpha(selected ? shade(base, 0.18) : base, 0.5 + 0.5 * n.velocity);
        g.fillRect(r.x, r.y, r.w, r.h);
        g.fillStyle = shade(base, selected ? 0.5 : -0.25);
        g.fillRect(r.x, r.y, 2, r.h);
        if (selected) { g.strokeStyle = '#fff'; g.lineWidth = 1; g.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1); }
        if (n.slide) { g.fillStyle = '#fff'; g.fillRect(r.x + r.w - 5, r.y + 3, 3, 3); }
        if (r.w > 30) { g.fillStyle = 'rgba(255,255,255,0.85)'; g.fillText(noteName(n.key), r.x + 5, r.y + KEYH - 4); }
      }
    }

    // ruler
    const rc = prepCanvas(rulerCanvas.current, gridW, RULER);
    if (rc) {
      rc.fillStyle = p.panel;
      rc.fillRect(0, 0, gridW, RULER);
      rc.font = '10px Consolas, "Cascadia Code", monospace';
      rc.textBaseline = 'middle';
      const lineStep = beat * zoom >= 14 ? beat : bar;
      for (let s = Math.floor(stepsFrom / lineStep) * lineStep; s <= stepsTo; s += lineStep) {
        const x = Math.round(s * zoom - sx) + 0.5;
        const isBar = Math.abs(s / bar - Math.round(s / bar)) < 1e-6;
        rc.fillStyle = isBar ? p.lineStrong : p.line;
        rc.fillRect(x, isBar ? 0 : RULER - 7, 1, isBar ? RULER : 7);
        if (isBar) { rc.fillStyle = p.dim; rc.fillText(String(Math.round(s / bar) + 1), x + 4, RULER / 2); }
      }
    }

    // keys
    const kc = prepCanvas(keysCanvas.current, KEYW, gridH);
    if (kc) {
      kc.font = '10px Consolas, "Cascadia Code", monospace';
      kc.textBaseline = 'middle';
      for (let k = firstKey; k <= lastKey; k++) {
        const y = (127 - k) * KEYH - sy;
        const black = isBlackKey(k);
        const ins = inScale(k, song.key.root, song.key.scale);
        kc.fillStyle = black ? '#26262a' : ins ? '#e6e6ea' : '#b4b4ba';
        kc.fillRect(0, y, black ? KEYW * 0.62 : KEYW, KEYH - 1);
        if (black) { kc.fillStyle = p.bg; kc.fillRect(KEYW * 0.62, y, KEYW * 0.38, KEYH - 1); }
        if (k % 12 === 0) { kc.fillStyle = '#333'; kc.fillText(noteName(k), KEYW - 26, y + KEYH / 2); }
        else if (k % 12 === song.key.root && !black) { kc.fillStyle = withAlpha(p.accent, 0.9); kc.fillRect(KEYW - 6, y + 3, 3, KEYH - 7); }
      }
    }

    // velocity lane
    const vc = prepCanvas(velCanvas.current, gridW, VELH);
    if (vc) {
      vc.fillStyle = p.lane;
      vc.fillRect(0, 0, gridW, VELH);
      const lineStep = beat * zoom >= 7 ? beat : bar;
      for (let s = Math.floor(stepsFrom / lineStep) * lineStep; s <= stepsTo; s += lineStep) {
        const x = Math.round(s * zoom - sx) + 0.5;
        vc.fillStyle = Math.abs(s / bar - Math.round(s / bar)) < 1e-6 ? p.lineStrong : p.line;
        vc.fillRect(x, 0, 1, VELH);
      }
      for (const n of notes) {
        const x = n.start * zoom - sx;
        if (x < -6 || x > gridW + 6) continue;
        const h = Math.max(2, n.velocity * (VELH - 6));
        vc.fillStyle = sel.has(n.id) ? '#fff' : withAlpha(channel.color, 0.9);
        vc.fillRect(x, VELH - h - 2, 4, h);
        vc.fillStyle = sel.has(n.id) ? '#fff' : channel.color;
        vc.fillRect(x - 2, VELH - h - 4, 8, 3);
      }
    }
  }, [notes, pattern, song.channels, song.key, sel, sx, sy, zoom, gridW, gridH, snap, steps, ghosts, channel.color, bar, beat]);

  // playhead (pattern mode only: the pattern's own position)
  useRaf(ui.playing, () => {
    const el = playhead.current;
    if (!el) return;
    if (song.view.mode !== 'pattern') { el.style.display = 'none'; return; }
    const pos = engine.position() % Math.max(1, steps);
    const x = pos * zoom - sx;
    el.style.display = x < 0 || x > gridW ? 'none' : 'block';
    el.style.transform = `translateX(${x}px)`;
  });
  useEffect(() => { if (!ui.playing && playhead.current) playhead.current.style.display = 'none'; }, [ui.playing]);

  // ---- hit testing & note gestures --------------------------------------------------------------
  const localGrid = (e: { clientX: number; clientY: number }) => {
    const r = gridCanvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const hitAt = (x: number, y: number): Hit | null => {
    const l = live.current;
    for (let i = l.notes.length - 1; i >= 0; i--) {
      const n = l.notes[i];
      const nx = n.start * l.zoom - l.sx;
      const nw = Math.max(3, n.length * l.zoom - 1);
      const ny = (127 - n.key) * KEYH - l.sy;
      if (x >= nx && x <= nx + nw && y >= ny && y < ny + KEYH) return { note: n, edge: nw > 12 && x >= nx + nw - 6 ? 'right' : 'body' };
    }
    return null;
  };
  const commitNotes = (base: Note[]) => drag((s) => setNotes(s, pattern.id, channel.id, base));
  const buildNotes = (list: Note[]) => (s: MusicProject) => setNotes(s, pattern.id, channel.id, list);
  const newNotesAt = (step: number, key: number, len: number): Note[] => {
    const l = live.current;
    const keys = l.chord ? chordKeys(key % 12, l.chord, Math.floor(key / 12) - 1, l.inversion) : [fitKey(key)];
    return keys.map((k) => ({ id: musicId(), key: k, start: Math.max(0, step), length: len, velocity: 0.8 }));
  };
  const audition = (key: number, vel = 0.8) => engine.previewNote(channel.id, key, vel, 0.28);

  const down = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 2) return;
    e.preventDefault();
    (e.currentTarget.closest('.ms-pr') as HTMLElement | null)?.focus();
    const l = live.current;
    const pt = localGrid(e);
    const hit = hitAt(pt.x, pt.y);
    const orig = l.notes;
    const startX = e.clientX;
    const startY = e.clientY;

    if (e.button === 2) {
      if (hit) {
        const gone = l.sel.has(hit.note.id) ? l.sel : new Set([hit.note.id]);
        edit(buildNotes(orig.filter((n) => !gone.has(n.id))), 'erase notes');
        setSel(new Set());
      }
      return;
    }

    if (l.tool === 'slice') {
      if (!hit) return;
      const at = l.snap > 0 ? snapTo(toStep(pt.x), l.snap) : toStep(pt.x);
      const n = hit.note;
      if (at <= n.start + 0.01 || at >= n.start + n.length - 0.01) return;
      edit(buildNotes(orig.flatMap((o) => (o.id === n.id ? [{ ...o, length: at - o.start }, { ...o, id: musicId(), start: at, length: o.start + o.length - at }] : [o]))), 'slice note');
      return;
    }

    if (l.tool === 'erase') {
      const gone = new Set<string>();
      const sweep = (ev: { clientX: number; clientY: number }) => {
        const q = localGrid(ev);
        const h = hitAt(q.x, q.y);
        if (h && !gone.has(h.note.id)) { gone.add(h.note.id); commitNotes(orig.filter((n) => !gone.has(n.id))); }
      };
      sweep(e);
      trackPointer(sweep, () => { settle('Music: erase notes'); setSel(new Set()); });
      return;
    }

    if (l.tool === 'paint' && !hit) {
      const added: Note[] = [];
      const seen = new Set<string>();
      const len = store.current.prLen || (l.snap > 0 ? l.snap : 1);
      const paintAt = (ev: { clientX: number; clientY: number }) => {
        const q = localGrid(ev);
        const step = l.snap > 0 ? snapDown(toStep(q.x), l.snap) : Math.floor(toStep(q.x));
        const key = toKey(q.y);
        const id = `${step.toFixed(3)}:${key}`;
        if (seen.has(id)) return;
        seen.add(id);
        if (orig.some((n) => n.key === key && step >= n.start && step < n.start + n.length)) return;
        added.push(...newNotesAt(step, key, len));
        audition(key);
        commitNotes([...orig, ...added]);
      };
      paintAt(e);
      trackPointer(paintAt, () => { settle('Music: paint notes'); setSel(new Set(added.map((n) => n.id))); });
      return;
    }

    // draw / select (and paint / draw landing on a note): move, resize, or start a marquee
    let base = orig;
    let moving: Set<string>;
    let anchor: Note;
    let mode: 'move' | 'resize' = 'move';
    if (hit) {
      anchor = hit.note;
      if (e.shiftKey && l.sel.has(anchor.id)) { setSel(new Set([...l.sel].filter((id) => id !== anchor.id))); return; }
      const nextSel = l.sel.has(anchor.id) ? l.sel : e.shiftKey ? new Set([...l.sel, anchor.id]) : new Set([anchor.id]);
      setSel(nextSel);
      moving = new Set(nextSel);
      mode = hit.edge === 'right' ? 'resize' : 'move';
      audition(anchor.key, anchor.velocity);
    } else if (l.tool === 'draw' && !e.shiftKey) {
      const step = l.snap > 0 ? snapDown(toStep(pt.x), l.snap) : toStep(pt.x);
      const added = newNotesAt(step, toKey(pt.y), store.current.prLen || (l.snap > 0 ? l.snap : 1));
      base = [...orig, ...added];
      moving = new Set(added.map((n) => n.id));
      anchor = added[0];
      setSel(moving);
      commitNotes(base);
      audition(anchor.key);
    } else {
      // marquee
      const keep = e.shiftKey ? new Set(l.sel) : new Set<string>();
      if (!e.shiftKey) setSel(new Set());
      const rectOf = (ev: { clientX: number; clientY: number }) => {
        const q = localGrid(ev);
        return { x0: Math.min(pt.x, q.x), y0: Math.min(pt.y, q.y), x1: Math.max(pt.x, q.x), y1: Math.max(pt.y, q.y) };
      };
      const mq = (ev: { clientX: number; clientY: number }) => {
        const r = rectOf(ev);
        setMarquee(r);
        const next = new Set(keep);
        for (const n of orig) {
          const nx = n.start * l.zoom - l.sx;
          const nw = n.length * l.zoom;
          const ny = (127 - n.key) * KEYH - l.sy;
          if (nx < r.x1 && nx + nw > r.x0 && ny < r.y1 && ny + KEYH > r.y0) next.add(n.id);
        }
        setSel(next);
      };
      trackPointer(mq, () => setMarquee(null));
      return;
    }

    let moved = false;
    let dupIds: Map<string, string> | null = null;
    let lastKey = anchor.key;
    const startKeyRow = toKey(pt.y);
    trackPointer(
      (ev) => {
        if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 3) return;
        moved = true;
        const now = live.current;
        const dx = (ev.clientX - startX) / now.zoom;
        const q = localGrid(ev);
        const dKeyRaw = toKey(q.y) - startKeyRow;
        const movers = base.filter((n) => moving.has(n.id));
        if (mode === 'move') {
          if (ev.ctrlKey && !dupIds) { dupIds = new Map(movers.map((n) => [n.id, musicId()])); setSel(new Set(dupIds.values())); }
          let ds = now.snap > 0 ? snapTo(anchor.start + dx, now.snap) - anchor.start : dx;
          ds = Math.max(ds, -Math.min(...movers.map((n) => n.start)));
          const dKey = fitKey(anchor.key + dKeyRaw) - anchor.key;
          const shifted = (n: Note): Note => ({ ...n, start: Math.max(0, n.start + ds), key: clamp(n.key + dKey, 0, 127) });
          const out = dupIds
            ? [...base, ...movers.map((n) => ({ ...shifted(n), id: dupIds!.get(n.id) as string }))]
            : base.map((n) => (moving.has(n.id) ? shifted(n) : n));
          commitNotes(out);
          const key = clamp(anchor.key + dKey, 0, 127);
          if (key !== lastKey) { lastKey = key; audition(key); }
        } else {
          const end = anchor.start + anchor.length;
          const minLen = now.snap > 0 ? now.snap : 0.25;
          const dl = (now.snap > 0 ? snapTo(end + dx, now.snap) : end + dx) - end;
          const out = base.map((n) => (moving.has(n.id) ? { ...n, length: Math.max(minLen, n.length + dl) } : n));
          commitNotes(out);
          store.current.prLen = Math.max(minLen, anchor.length + dl);
        }
      },
      () => {
        settle(mode === 'resize' ? 'Music: resize notes' : moved ? 'Music: move notes' : 'Music: add note');
        if (!moved && hit === null) store.current.prLen = store.current.prLen || anchor.length;
      },
    );
  };

  const hover = (e: React.PointerEvent) => {
    if (e.buttons) return;
    const c = gridCanvas.current;
    if (!c) return;
    const pt = localGrid(e);
    const hit = hitAt(pt.x, pt.y);
    const t = live.current.tool;
    c.style.cursor = hit ? (hit.edge === 'right' && t !== 'erase' && t !== 'slice' ? 'ew-resize' : t === 'slice' ? 'col-resize' : t === 'erase' ? 'not-allowed' : 'move') : t === 'select' ? 'default' : 'crosshair';
  };

  // velocity lane
  const velDown = (e: React.PointerEvent) => {
    const c = velCanvas.current;
    if (!c) return;
    e.preventDefault();
    (e.currentTarget.closest('.ms-pr') as HTMLElement | null)?.focus();
    const orig = live.current.notes;
    const set = new Map<string, number>();
    const record = (ev: { clientX: number; clientY: number }) => {
      const r = c.getBoundingClientRect();
      const x = ev.clientX - r.left;
      const v = clamp(1 - (ev.clientY - r.top - 2) / (VELH - 6), 0.02, 1);
      const l = live.current;
      let best: Note | null = null;
      let bestD = 7;
      for (const n of orig) {
        const d = Math.abs(n.start * l.zoom - l.sx + 2 - x);
        if (d < bestD) { bestD = d; best = n; }
      }
      if (!best) return;
      const at = best.start;
      for (const n of orig) if (Math.abs(n.start - at) < 1e-3) set.set(n.id, v);
      commitNotes(orig.map((n) => (set.has(n.id) ? { ...n, velocity: set.get(n.id) as number } : n)));
    };
    record(e);
    trackPointer(record, () => settle('Music: velocity'));
  };

  // keys column: audition by clicking / dragging
  const keysDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const c = keysCanvas.current;
    if (!c) return;
    const at = (ev: { clientY: number }) => toKey(ev.clientY - c.getBoundingClientRect().top);
    let last = at(e);
    audition(last);
    trackPointer((ev) => { const k = at(ev); if (k !== last) { last = k; audition(k); } }, () => undefined);
  };

  // wheel: scroll, shift = horizontal, ctrl = zoom around the pointer
  useWheel(body, (e) => {
    e.preventDefault();
    const l = live.current;
    const r = gridCanvas.current?.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) setZoom(l.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), r ? e.clientX - r.left : undefined);
    else if (e.shiftKey) setScroll(clamp(l.sx + e.deltaY, 0, maxX), l.sy);
    else setScroll(clamp(l.sx + e.deltaX, 0, maxX), clamp(l.sy + e.deltaY, 0, maxY));
  });

  // ---- keyboard ---------------------------------------------------------------------------------
  const selected = notes.filter((n) => sel.has(n.id));
  const nudge = (ds: number, dk: number) => {
    if (!selected.length) return;
    const ids = new Set(selected.map((n) => n.id));
    edit(buildNotes(notes.map((n) => (ids.has(n.id) ? { ...n, start: Math.max(0, n.start + ds), key: clamp(n.key + dk, 0, 127) } : n))), 'nudge notes');
    if (dk) audition(clamp(selected[0].key + dk, 0, 127));
  };
  const duplicate = () => {
    if (!selected.length) return;
    const lo = Math.min(...selected.map((n) => n.start));
    const hi = Math.max(...selected.map((n) => n.start + n.length));
    const span = snap > 0 ? Math.ceil((hi - lo) / snap - 1e-6) * snap : hi - lo;
    const copies = selected.map((n) => ({ ...n, id: musicId(), start: n.start + span }));
    edit(buildNotes([...notes, ...copies]), 'duplicate notes');
    setSel(new Set(copies.map((n) => n.id)));
  };
  const keyDown = (e: React.KeyboardEvent) => {
    if (typingTarget(e.target)) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key;
    const handled = () => { e.preventDefault(); e.stopPropagation(); };
    if (ctrl && k.toLowerCase() === 'a') { handled(); setSel(new Set(notes.map((n) => n.id))); return; }
    if (ctrl && k.toLowerCase() === 'd') { handled(); duplicate(); return; }
    if (ctrl && k.toLowerCase() === 'c') { if (selected.length) { handled(); const lo = Math.min(...selected.map((n) => n.start)); clipboard = selected.map((n) => ({ ...n, start: n.start - lo })); } return; }
    if (ctrl && k.toLowerCase() === 'v') {
      if (!clipboard.length) return;
      handled();
      const at = snap > 0 ? snapDown(sx / zoom, snap) : sx / zoom;
      const copies = clipboard.map((n) => ({ ...n, id: musicId(), start: n.start + at }));
      edit(buildNotes([...notes, ...copies]), 'paste notes');
      setSel(new Set(copies.map((n) => n.id)));
      return;
    }
    if (ctrl) return;
    if (k === KEY_DEL || k === 'Backspace') { if (selected.length) { handled(); edit(buildNotes(notes.filter((n) => !sel.has(n.id))), 'erase notes'); setSel(new Set()); } return; }
    if (k === 'Escape') { handled(); setSel(new Set()); return; }
    if (k === 'ArrowLeft' || k === 'ArrowRight') { if (selected.length) { handled(); nudge((k === 'ArrowLeft' ? -1 : 1) * (snap > 0 ? snap : 1), 0); } return; }
    if (k === 'ArrowUp' || k === 'ArrowDown') { if (selected.length) { handled(); nudge(0, (k === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 12 : 1)); } return; }
    const tool = ({ p: 'draw', v: 'select', s: 'slice', e: 'erase', b: 'paint' } as Record<string, Tool>)[k.toLowerCase()];
    if (tool && !e.altKey) { handled(); setTool(tool); }
  };

  // ---- tools menu -------------------------------------------------------------------------------
  const run = (op: NoteOp, options: Record<string, unknown>, label: string) => () => {
    const target = selected.length ? selected : notes;
    if (!target.length) { act.toast({ tone: 'info', title: 'No notes to edit', body: 'Draw some notes first.' }); return; }
    try {
      const ids = new Set(target.map((n) => n.id));
      const out = editNotes(act.getSong(), target, op, options);
      edit(buildNotes([...notes.filter((n) => !ids.has(n.id)), ...out]), label);
      setSel(new Set(out.map((n) => n.id)));
    } catch (err) {
      act.toast({ tone: 'error', title: `${label} failed`, body: err instanceof Error ? err.message : String(err) });
    }
  };
  const grid = snap > 0 ? snap : 1;
  const toolItems = (): MenuItem[] => [
    { header: true, label: selected.length ? `Selected notes (${selected.length})` : 'All notes in the channel' },
    { label: 'Quantize (start)', onClick: run('quantize', { grid }, 'quantize') },
    { label: 'Quantize (start + length)', onClick: run('quantize', { grid, lengths: true }, 'quantize') },
    { label: 'Legato', onClick: run('legato', {}, 'legato') },
    { label: 'Humanize', onClick: run('humanize', {}, 'humanize') },
    { label: 'Scale-correct (to the song key)', onClick: run('scale-correct', {}, 'scale-correct') },
    { separator: true },
    { header: true, label: 'Arpeggiate' },
    ...['up', 'down', 'updown', 'random'].map((pattern) => ({ label: `Arpeggio ${pattern}`, onClick: run('arpeggiate', { pattern, rate: grid }, 'arpeggiate') })),
    { label: 'Strum down', onClick: run('strum', { direction: 'down' }, 'strum') }, { label: 'Strum up', onClick: run('strum', { direction: 'up' }, 'strum') },
    { separator: true },
    { header: true, label: 'Chordize (stack a chord on every note)' },
    { label: 'Diatonic triads', onClick: run('chordize', {}, 'chordize') }, { label: 'Diatonic sevenths', onClick: run('chordize', { sevenths: true }, 'chordize') },
    ...['maj', 'min', '7', 'maj7', 'min7', 'sus2', 'sus4', 'dim'].map((quality) => ({ label: `Chordize → ${quality}`, onClick: run('chordize', { quality }, `chordize ${quality}`) })),
    { separator: true },
    { header: true, label: 'Transpose' },
    { label: 'Up a semitone', onClick: run('transpose', { semitones: 1 }, 'transpose') }, { label: 'Down a semitone', onClick: run('transpose', { semitones: -1 }, 'transpose') },
    { label: 'Up an octave', onClick: run('transpose', { semitones: 12 }, 'transpose') }, { label: 'Down an octave', onClick: run('transpose', { semitones: -12 }, 'transpose') },
    { label: 'Up a scale degree', onClick: run('transpose', { degrees: 1 }, 'transpose') }, { label: 'Down a scale degree', onClick: run('transpose', { degrees: -1 }, 'transpose') },
    { separator: true },
    { label: 'Reverse', onClick: run('reverse', {}, 'reverse') }, { label: 'Flip (mirror pitches)', onClick: run('flip', {}, 'flip') },
    { label: 'Randomize velocity', onClick: run('randomize', { what: 'velocity' }, 'randomize') },
  ];

  const channelIndex = song.channels.findIndex((c) => c.id === channel.id);
  return (
    <section className="ms-pr" tabIndex={-1} onKeyDown={keyDown} aria-label={`Piano Roll — ${channel.name}`}>
      <header className="ms-pane-head">
        <h3>Piano Roll</h3>
        <select aria-label="Channel" value={channel.id} style={{ borderColor: channel.color }} onChange={(e) => act.setView({ selectedChannelId: e.target.value })}>
          {song.channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div className="ms-seg" role="group" aria-label="Tools">
          {TOOLS.map((t) => (
            <button key={t.id} type="button" className={tool === t.id ? 'on' : ''} aria-pressed={tool === t.id} aria-label={`${t.label} tool`} title={`${t.label} (${t.key})`} onClick={() => setTool(t.id)}><t.icon size={13} /></button>
          ))}
        </div>
        <Menu className="ms-primary" title="Note tools: quantize, legato, arpeggiate, strum, chordize, scale-correct, humanize, transpose, reverse, flip" trigger={<><Wand2 size={13} /> Tools</>} items={toolItems} />
        <label className="ms-field" title="Chord stamp: draw a whole chord with one click"><span>Stamp</span>
          <select aria-label="Chord stamp" value={chord} onChange={(e) => setChord(e.target.value)}>
            <option value="">Single note</option>
            {Object.keys(CHORDS).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          {chord && <select aria-label="Chord inversion" value={inversion} onChange={(e) => setInversion(Number(e.target.value))}>{[0, 1, 2, 3].map((i) => <option key={i} value={i}>{i === 0 ? 'root' : `inv ${i}`}</option>)}</select>}
        </label>
        <label className="ms-field" title="The song key: highlighted on the grid"><span>Key</span>
          <select aria-label="Key root" value={song.key.root} onChange={(e) => edit((s) => ({ ...s, key: { ...s.key, root: Number(e.target.value) } }), 'key')}>
            {NOTE_NAMES.map((n, i) => <option key={n} value={i}>{pitchName(i)}</option>)}
          </select>
          <select aria-label="Scale" value={song.key.scale} onChange={(e) => edit((s) => ({ ...s, key: { ...s.key, scale: e.target.value as ScaleName } }), 'scale')}>
            {SCALE_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <button type="button" className={`ms-icon ms-icon-lg${scaleLock ? ' on' : ''}`} aria-pressed={scaleLock} title="Snap to scale: drawn and moved notes stay in the song key" aria-label="Snap to scale" onClick={() => setScaleLock(!scaleLock)}><Magnet size={14} /></button>
        <button type="button" className={`ms-chip btn${ghosts ? ' on' : ''}`} aria-pressed={ghosts} title="Show the other channels' notes faintly" onClick={() => setGhosts(!ghosts)}>Ghost</button>
        <span className="ms-grow" />
        <button type="button" className="ms-icon" aria-label="Zoom out" title="Zoom out (Ctrl+wheel)" onClick={() => setZoom(zoom / 1.3)}><ZoomOut size={13} /></button>
        <button type="button" className="ms-icon" aria-label="Zoom in" title="Zoom in (Ctrl+wheel)" onClick={() => setZoom(zoom * 1.3)}><ZoomIn size={13} /></button>
      </header>
      <div ref={body} className="ms-pr-body" aria-label={`${channel.name} notes (${notes.length}), channel ${channelIndex + 1}`}>
        <canvas ref={rulerCanvas} className="ms-pr-ruler" style={{ left: KEYW, top: 0 }} />
        <canvas ref={keysCanvas} className="ms-pr-keys" style={{ left: 0, top: RULER }} onPointerDown={keysDown} aria-label="Piano keys (click to audition)" />
        <canvas ref={gridCanvas} className="ms-pr-grid" style={{ left: KEYW, top: RULER }} onPointerDown={down} onPointerMove={hover} onContextMenu={(e) => e.preventDefault()} aria-label="Note grid" />
        <div ref={playhead} className="ms-playhead" style={{ left: KEYW, top: RULER, height: gridH, display: 'none' }} />
        {marquee && <div className="ms-marquee" style={{ left: KEYW + marquee.x0, top: RULER + marquee.y0, width: marquee.x1 - marquee.x0, height: marquee.y1 - marquee.y0 }} />}
        <div className="ms-sb-v" style={{ top: RULER, height: gridH }}><ScrollBar vertical total={contentH} view={gridH} pos={sy} onPos={(v) => setScroll(sx, v)} /></div>
        <div className="ms-sb-h" style={{ left: KEYW, width: gridW }}><ScrollBar total={contentW} view={gridW} pos={sx} onPos={(v) => setScroll(v, sy)} /></div>
      </div>
      <div className="ms-pr-vel" style={{ height: VELH }}>
        <div className="ms-pr-vel-label" style={{ width: KEYW }}>Velocity</div>
        <canvas ref={velCanvas} onPointerDown={velDown} aria-label="Velocity lane (drag bars)" />
      </div>
    </section>
  );
}

export function PianoRoll() {
  const { song, channel, pattern } = useStudio();
  if (song.channels.length === 0) return <section className="ms-pr"><header className="ms-pane-head"><h3>Piano Roll</h3></header><EmptyChannels /></section>;
  if (!channel || !pattern) {
    return (
      <section className="ms-pr">
        <header className="ms-pane-head"><h3>Piano Roll</h3></header>
        <div className="ms-empty"><h3>Pick a channel</h3><p>Select a channel in the rack (or use the piano-roll button on its row) to edit its notes here.</p></div>
      </section>
    );
  }
  return <PianoRollBody key={channel.id} channel={channel} pattern={pattern} />;
}
