// The storyboard's hand-drawing canvas: a small Paint for one card. Draws a vector document
// (lib/sketch) at the comp's aspect — brush, eraser, line, arrow, rectangle, ellipse, text and
// photos — with undo, and saves it back to the card as an editable sketch plus a PNG thumbnail.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import {
  MousePointer2, Brush, Eraser, Slash, MoveUpRight, Square, Circle, Type, ImagePlus, Undo2, Redo2, Trash2, X, Film, PaintBucket, LoaderCircle,
} from 'lucide-react';
import { api, errorText, fileSrc } from '../lib/ipc';
import {
  bounds, drawSketch, fitContain, fitCover, historyOf, moveShape, newSketch, normRect, record, redo, resizable, resizeShape, shapeId,
  smoothStroke, textSize, topHit, undo, SKETCH_PALETTE, SKETCH_WIDTHS, TEXT_LINE, type Pt, type SketchDoc, type SketchHistory, type SketchShape,
} from '../lib/sketch';

type Tool = 'select' | 'brush' | 'eraser' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'text';

const TOOLS: { id: Tool; label: string; key: string; icon: typeof Brush }[] = [
  { id: 'select', label: 'Select and move', key: 'V', icon: MousePointer2 },
  { id: 'brush', label: 'Brush', key: 'B', icon: Brush },
  { id: 'eraser', label: 'Eraser', key: 'E', icon: Eraser },
  { id: 'line', label: 'Line', key: 'L', icon: Slash },
  { id: 'arrow', label: 'Arrow', key: 'A', icon: MoveUpRight },
  { id: 'rect', label: 'Rectangle (Shift for a square)', key: 'R', icon: Square },
  { id: 'ellipse', label: 'Ellipse (Shift for a circle)', key: 'O', icon: Circle },
  { id: 'text', label: 'Text', key: 'T', icon: Type },
];
const TEXT_SIZES = [24, 36, 56, 80, 120];
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'];

/** A path or URL as something an <img> can load (paths go through the asset protocol). */
const imageUrl = (src: string) => (/^(data:|blob:|https?:)/.test(src) ? src : fileSrc(src));

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous'; // before src: the asset protocol is another origin
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not load that picture.'));
    image.src = imageUrl(src);
  });
}

type Drag =
  | { kind: 'draw'; shape: SketchShape; origin: Pt }
  | { kind: 'move'; id: string; origin: Pt; base: SketchShape[] }
  | { kind: 'resize'; id: string; base: SketchShape[] };

type TextEdit = { id: string | null; x: number; y: number; text: string; size: number; color: string };

export interface StoryboardSketchProps {
  /** The card's saved sketch, if any. */
  sketch?: SketchDoc | null;
  /** The card's current picture: offered as the background ("Start from current frame"). */
  frame?: string;
  /** width / height of the comp. */
  aspect: number;
  title: string;
  compId: string;
  sceneIndex: number;
  /** Stores the finished sketch: the document and its PNG. */
  onSave: (doc: SketchDoc, png: Uint8Array) => Promise<void>;
  onClose: () => void;
}

export function StoryboardSketch({ sketch, frame, aspect, title, compId, sceneIndex, onSave, onClose }: StoryboardSketchProps) {
  // The frame is "current" when it is not this sketch's own saved PNG.
  const freshFrame = frame && frame !== sketch?.output ? frame : undefined;
  const initial = useMemo<SketchDoc>(() => {
    if (sketch) return sketch;
    const doc = newSketch(aspect);
    return doc;
  }, [sketch, aspect]);
  const [paper, setPaper] = useState(initial.background);
  const [history, setHistory] = useState<SketchHistory>(() => historyOf(initial.shapes));
  const [live, setLive] = useState<SketchShape[] | null>(null);
  const [tool, setTool] = useState<Tool>('brush');
  const [color, setColor] = useState(SKETCH_PALETTE[1]);
  const [widthIndex, setWidthIndex] = useState(1);
  const [fill, setFill] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [textEdit, setTextEdit] = useState<TextEdit | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [, setTick] = useState(0); // repaints while a stroke is in progress

  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layerRef = useRef<HTMLCanvasElement | null>(null);
  const images = useRef(new Map<string, HTMLImageElement>());
  const drag = useRef<Drag | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const doc: SketchDoc = { ...initial, background: paper, shapes: live ?? history.present };
  const dirty = history.past.length > 0 || paper !== initial.background;
  const strokeWidth = SKETCH_WIDTHS[widthIndex];
  const selectedShape = selected ? doc.shapes.find((shape) => shape.id === selected) ?? null : null;
  const frameShape = doc.shapes.find((shape) => shape.kind === 'image' && shape.background) as Extract<SketchShape, { kind: 'image' }> | undefined;
  const hasFrame = !!frameShape;

  const commit = useCallback((shapes: SketchShape[]) => setHistory((current) => record(current, shapes)), []);

  // Pictures the document uses, loaded once each.
  useEffect(() => {
    for (const shape of doc.shapes) {
      if (shape.kind !== 'image' || images.current.has(shape.src)) continue;
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => setTick((v) => v + 1);
      image.onerror = () => setError('A picture in this sketch could not be loaded.');
      image.src = imageUrl(shape.src);
      images.current.set(shape.src, image);
    }
  });

  // A new sketch on a card that already has a picture starts on that picture.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!sketch && frame) void placeFrame(frame, false);
  }, []);

  // The page fits the stage at the comp's aspect.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const fit = () => {
      const rect = stage.getBoundingClientRect();
      const pad = 24;
      const k = Math.min((rect.width - pad * 2) / initial.width, (rect.height - pad * 2) / initial.height);
      setBox({ w: Math.max(40, Math.floor(initial.width * k)), h: Math.max(40, Math.floor(initial.height * k)) });
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [initial.width, initial.height]);

  // Paint.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !box.w) return;
    const ratio = window.devicePixelRatio || 1;
    const pw = Math.round(box.w * ratio);
    const ph = Math.round(box.h * ratio);
    if (canvas.width !== pw) canvas.width = pw;
    if (canvas.height !== ph) canvas.height = ph;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const scale = pw / doc.width;
    layerRef.current ??= document.createElement('canvas');
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    const shapes = drag.current?.kind === 'draw' ? [...doc.shapes, drag.current.shape] : doc.shapes;
    const hidden = textEdit?.id;
    drawSketch(ctx, { ...doc, shapes: hidden ? shapes.filter((shape) => shape.id !== hidden) : shapes }, images.current, layerRef.current, scale);
    if (selectedShape && !textEdit) {
      const b = bounds(selectedShape);
      const pad = 6 / (scale / ratio);
      ctx.save();
      ctx.lineWidth = 1.5 / (scale / ratio);
      ctx.setLineDash([5 / (scale / ratio), 4 / (scale / ratio)]);
      ctx.strokeStyle = getComputedStyle(canvas).getPropertyValue('--blue').trim() || '#2d8ceb';
      ctx.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
      if (resizable(selectedShape)) {
        ctx.setLineDash([]);
        const size = 9 / (scale / ratio);
        ctx.fillStyle = '#fff';
        ctx.fillRect(b.x + b.w + pad - size / 2, b.y + b.h + pad - size / 2, size, size);
        ctx.strokeRect(b.x + b.w + pad - size / 2, b.y + b.h + pad - size / 2, size, size);
      }
      ctx.restore();
    }
  });

  const cssScale = box.w / initial.width;
  const toDoc = (event: { clientX: number; clientY: number }): Pt => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return [((event.clientX - rect.left) / rect.width) * initial.width, ((event.clientY - rect.top) / rect.height) * initial.height];
  };

  // ── pictures ───────────────────────────────────────────────────────────
  async function placeImage(src: string, at?: Pt) {
    const image = await loadImage(src);
    images.current.set(src, image);
    const fit = fitContain(image.naturalWidth, image.naturalHeight, { w: initial.width, h: initial.height }, 0.6);
    const x = at ? at[0] - fit.w / 2 : fit.x;
    const y = at ? at[1] - fit.h / 2 : fit.y;
    const shape: SketchShape = { kind: 'image', id: shapeId(), src, x, y, w: fit.w, h: fit.h };
    setHistory((current) => record(current, [...current.present, shape]));
    setSelected(shape.id);
    setTool('select');
  }

  async function placeFrame(src: string, undoable = true) {
    try {
      const image = await loadImage(src);
      images.current.set(src, image);
      const cover = fitCover(image.naturalWidth, image.naturalHeight, { w: initial.width, h: initial.height });
      const shape: SketchShape = { kind: 'image', id: shapeId(), src, ...cover, background: true };
      setHistory((current) => {
        const shapes = [shape, ...current.present.filter((entry) => !(entry.kind === 'image' && entry.background))];
        return undoable ? record(current, shapes) : historyOf(shapes);
      });
    } catch (reason) {
      setError(errorText(reason));
    }
  }

  const removeFrame = () => commit(history.present.filter((shape) => !(shape.kind === 'image' && shape.background)));

  async function withBusy(label: string, work: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await work();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(null);
    }
  }

  const uploadPhoto = () => withBusy('Adding photo…', async () => {
    const picked = await openDialog({ multiple: false, directory: false, filters: [{ name: 'Images', extensions: IMAGE_EXTENSIONS }] });
    if (!picked || Array.isArray(picked)) return;
    const path = await api.storyboardImageImport(compId, sceneIndex, picked);
    await placeImage(path);
  });

  // Photos dropped from Explorer: the desktop webview reports paths, not File objects.
  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    void import('@tauri-apps/api/webview').then(({ getCurrentWebview }) => getCurrentWebview().onDragDropEvent((event) => {
      const payload = event.payload;
      const ratio = window.devicePixelRatio || 1;
      const inside = (point: { x: number; y: number }) => {
        const rect = stageRef.current?.getBoundingClientRect();
        return !!rect && point.x / ratio >= rect.left && point.x / ratio <= rect.right && point.y / ratio >= rect.top && point.y / ratio <= rect.bottom;
      };
      if (payload.type === 'over') setDropping(inside(payload.position));
      else if (payload.type === 'leave') setDropping(false);
      else if (payload.type === 'drop') {
        setDropping(false);
        if (!inside(payload.position)) return;
        const paths = payload.paths.filter((path) => IMAGE_EXTENSIONS.includes(path.split('.').pop()?.toLowerCase() ?? ''));
        if (!paths.length) { setError('Drop a PNG, JPEG, WebP, GIF or BMP picture.'); return; }
        const at = toDoc({ clientX: payload.position.x / ratio, clientY: payload.position.y / ratio });
        void withBusy('Adding photo…', async () => {
          for (const path of paths) await placeImage(await api.storyboardImageImport(compId, sceneIndex, path), at);
        });
      }
    })).then((off) => { if (cancelled) off(); else stop = off; }).catch(() => undefined);
    return () => { cancelled = true; stop?.(); };
  }, [compId, sceneIndex]);

  // Browser drops (File objects) — the fallback outside the desktop webview.
  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDropping(false);
    const files = [...event.dataTransfer.files].filter((file) => file.type.startsWith('image/'));
    if (!files.length) return;
    const at = toDoc(event);
    void withBusy('Adding photo…', async () => {
      for (const file of files) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        await placeImage(await api.storyboardImageSave(compId, sceneIndex, bytes), at);
      }
    });
  };

  // ── pointer ────────────────────────────────────────────────────────────
  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0 || busy) return;
    if (textEdit) { commitText(); return; }
    const p = toDoc(event);
    const slop = 6 / Math.max(0.01, cssScale);
    event.currentTarget.setPointerCapture(event.pointerId);
    setError(null);
    if (tool === 'select') {
      if (selectedShape && resizable(selectedShape)) {
        const b = bounds(selectedShape);
        const pad = 6 / cssScale;
        const hx = b.x + b.w + pad;
        const hy = b.y + b.h + pad;
        if (Math.abs(p[0] - hx) <= 8 / cssScale && Math.abs(p[1] - hy) <= 8 / cssScale) {
          drag.current = { kind: 'resize', id: selectedShape.id, base: history.present };
          return;
        }
      }
      const hit = topHit(history.present, p, slop);
      setSelected(hit?.id ?? null);
      if (hit) drag.current = { kind: 'move', id: hit.id, origin: p, base: history.present };
      return;
    }
    if (tool === 'text') {
      event.preventDefault(); // keep focus off the page so the text box keeps it
      const hit = topHit(history.present, p, slop);
      if (hit?.kind === 'text') setTextEdit({ id: hit.id, x: hit.x, y: hit.y, text: hit.text, size: hit.size, color: hit.color });
      else setTextEdit({ id: null, x: p[0], y: p[1] - TEXT_SIZES[widthIndex] * 0.6, text: '', size: TEXT_SIZES[widthIndex], color });
      return;
    }
    setSelected(null);
    const id = shapeId();
    let shape: SketchShape;
    if (tool === 'brush' || tool === 'eraser') shape = { kind: 'path', id, color, width: tool === 'eraser' ? strokeWidth * 3 : strokeWidth, points: [p], ...(tool === 'eraser' ? { erase: true } : {}) };
    else if (tool === 'line' || tool === 'arrow') shape = { kind: tool, id, color, width: strokeWidth, a: p, b: p };
    else shape = { kind: tool, id, color, width: strokeWidth, fill, x: p[0], y: p[1], w: 0, h: 0 };
    drag.current = { kind: 'draw', shape, origin: p };
    setTick((v) => v + 1);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const current = drag.current;
    if (!current) return;
    const p = toDoc(event);
    if (current.kind === 'move') {
      const dx = p[0] - current.origin[0];
      const dy = p[1] - current.origin[1];
      setLive(current.base.map((shape) => (shape.id === current.id ? moveShape(shape, dx, dy) : shape)));
      return;
    }
    if (current.kind === 'resize') {
      const pad = 6 / cssScale;
      setLive(current.base.map((shape) => (shape.id === current.id ? resizeShape(shape, [p[0] - pad, p[1] - pad]) : shape)));
      return;
    }
    const shape = current.shape;
    if (shape.kind === 'path') {
      const events = 'getCoalescedEvents' in event.nativeEvent ? event.nativeEvent.getCoalescedEvents() : [];
      const points = events.length ? events.map((e) => toDoc(e)) : [p];
      current.shape = { ...shape, points: [...shape.points, ...points] };
    } else if (shape.kind === 'line' || shape.kind === 'arrow') {
      let b = p;
      if (event.shiftKey) {
        // Shift snaps to 45°.
        const angle = Math.round(Math.atan2(p[1] - shape.a[1], p[0] - shape.a[0]) / (Math.PI / 4)) * (Math.PI / 4);
        const length = Math.hypot(p[0] - shape.a[0], p[1] - shape.a[1]);
        b = [shape.a[0] + Math.cos(angle) * length, shape.a[1] + Math.sin(angle) * length];
      }
      current.shape = { ...shape, b };
    } else if (shape.kind === 'rect' || shape.kind === 'ellipse') {
      current.shape = { ...shape, ...normRect(current.origin, p, event.shiftKey) };
    }
    setTick((v) => v + 1);
  };

  const onPointerUp = () => {
    const current = drag.current;
    drag.current = null;
    if (!current) return;
    if (current.kind !== 'draw') {
      if (live) commit(live);
      setLive(null);
      return;
    }
    let shape = current.shape;
    if (shape.kind === 'path') shape = { ...shape, points: smoothStroke(shape.points, shape.width) };
    if ((shape.kind === 'rect' || shape.kind === 'ellipse') && (shape.w < 2 || shape.h < 2)) { setTick((v) => v + 1); return; }
    if ((shape.kind === 'line' || shape.kind === 'arrow') && Math.hypot(shape.b[0] - shape.a[0], shape.b[1] - shape.a[1]) < 2) { setTick((v) => v + 1); return; }
    commit([...history.present, shape]);
  };

  // ── text ───────────────────────────────────────────────────────────────
  function commitText() {
    const edit = textEdit;
    setTextEdit(null);
    if (!edit) return;
    const text = edit.text.replace(/\s+$/, '');
    if (edit.id) {
      commit(text ? history.present.map((shape) => (shape.id === edit.id && shape.kind === 'text' ? { ...shape, text } : shape)) : history.present.filter((shape) => shape.id !== edit.id));
    } else if (text) {
      const shape: SketchShape = { kind: 'text', id: shapeId(), color: edit.color, size: edit.size, x: edit.x, y: edit.y, text };
      commit([...history.present, shape]);
    }
  }
  useEffect(() => {
    if (!textEdit) return;
    textRef.current?.focus();
    const frame = requestAnimationFrame(() => textRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [textEdit?.id, textEdit?.x, textEdit?.y]);

  const onDoubleClick = (event: React.MouseEvent) => {
    if (tool !== 'select') return;
    const hit = topHit(history.present, toDoc(event), 6 / cssScale);
    if (hit?.kind === 'text') setTextEdit({ id: hit.id, x: hit.x, y: hit.y, text: hit.text, size: hit.size, color: hit.color });
  };

  // ── style changes apply to the selection too ───────────────────────────
  const restyle = (change: (shape: SketchShape) => SketchShape) => {
    if (!selectedShape) return;
    commit(history.present.map((shape) => (shape.id === selectedShape.id ? change(shape) : shape)));
  };
  const pickColor = (next: string) => {
    setColor(next);
    if (textEdit) setTextEdit({ ...textEdit, color: next });
    restyle((shape) => ('color' in shape ? { ...shape, color: next } : shape));
  };
  const pickWidth = (index: number) => {
    setWidthIndex(index);
    if (textEdit) setTextEdit({ ...textEdit, size: TEXT_SIZES[index] });
    restyle((shape) => (shape.kind === 'text' ? { ...shape, size: TEXT_SIZES[index] } : 'width' in shape ? { ...shape, width: SKETCH_WIDTHS[index] } : shape));
  };
  const toggleFill = () => {
    setFill(!fill);
    restyle((shape) => (shape.kind === 'rect' || shape.kind === 'ellipse' ? { ...shape, fill: !fill } : shape));
  };

  const deleteSelected = () => {
    if (!selected) return;
    commit(history.present.filter((shape) => shape.id !== selected));
    setSelected(null);
  };
  const clearAll = () => {
    commit(history.present.filter((shape) => shape.kind === 'image' && shape.background));
    setSelected(null);
  };
  const doUndo = () => { setSelected(null); setHistory(undo); };
  const doRedo = () => { setSelected(null); setHistory(redo); };

  // ── save ───────────────────────────────────────────────────────────────
  const save = () => withBusy('Saving…', async () => {
    const finalDoc: SketchDoc = { ...initial, background: paper, shapes: history.present };
    await Promise.all(finalDoc.shapes.filter((shape): shape is Extract<SketchShape, { kind: 'image' }> => shape.kind === 'image').map(async (shape) => {
      const image = images.current.get(shape.src);
      if (!image?.complete || !image.naturalWidth) images.current.set(shape.src, await loadImage(shape.src));
    }));
    const canvas = document.createElement('canvas');
    canvas.width = finalDoc.width;
    canvas.height = finalDoc.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not draw the sketch.');
    drawSketch(ctx, finalDoc, images.current, document.createElement('canvas'), 1);
    let blob: Blob | null;
    try {
      blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    } catch {
      throw new Error('A picture in the sketch cannot be read back; remove it and save again.');
    }
    if (!blob) throw new Error('Could not encode the sketch as PNG.');
    await onSave(finalDoc, new Uint8Array(await blob.arrayBuffer()));
  });

  // ── keyboard (the app's shortcuts wait while the sketch is open) ───────
  const keyState = useRef({ doUndo, doRedo, deleteSelected, save, onClose, dirty, selected, textEdit });
  keyState.current = { doUndo, doRedo, deleteSelected, save, onClose, dirty, selected, textEdit };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) return;
      event.stopPropagation();
      const s = keyState.current;
      const ctrl = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (ctrl && key === 'z' && !event.shiftKey) { event.preventDefault(); s.doUndo(); }
      else if (ctrl && (key === 'y' || (key === 'z' && event.shiftKey))) { event.preventDefault(); s.doRedo(); }
      else if (ctrl && key === 's') { event.preventDefault(); void s.save(); }
      else if (key === 'delete' || key === 'backspace') { event.preventDefault(); s.deleteSelected(); }
      else if (key === 'escape') {
        event.preventDefault();
        if (s.selected) setSelected(null);
        else if (!s.dirty) s.onClose();
      } else if (!ctrl && !event.altKey) {
        const match = TOOLS.find((entry) => entry.key.toLowerCase() === key);
        if (match) { setTool(match.id); if (match.id !== 'select') setSelected(null); }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const cursor = tool === 'select' ? 'default' : tool === 'text' ? 'text' : 'crosshair';
  const textStyle = textEdit ? {
    left: textEdit.x * cssScale,
    top: textEdit.y * cssScale,
    fontSize: textEdit.size * cssScale,
    lineHeight: TEXT_LINE,
    color: textEdit.color,
    width: Math.max(textSize({ size: textEdit.size, text: textEdit.text || 'W' }).w * cssScale + textEdit.size * cssScale, 60),
    height: textSize({ size: textEdit.size, text: textEdit.text || 'W' }).h * cssScale + 6,
  } : undefined;

  return createPortal(
    <div className="modal-backdrop sketch-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget && !dirty) onClose(); }}>
      <div className="modal sketch-editor" role="dialog" aria-modal="true" aria-label={`Sketch for ${title}`}>
        <header className="modal-head sketch-head">
          <h2>Sketch <span className="sketch-head-sub">{title}</span></h2>
          <button type="button" className="icon-btn" onClick={onClose} title="Close without saving"><X size={16} /></button>
        </header>

        <div className="sketch-options">
          <div className="sketch-swatches" role="group" aria-label="Colour">
            {SKETCH_PALETTE.map((swatch) => (
              <button key={swatch} type="button" className={`sketch-swatch${color === swatch ? ' active' : ''}`} style={{ background: swatch }} onClick={() => pickColor(swatch)} title={swatch} aria-label={`Colour ${swatch}`} />
            ))}
            <label className={`sketch-swatch custom${SKETCH_PALETTE.includes(color) ? '' : ' active'}`} title="Custom colour" style={SKETCH_PALETTE.includes(color) ? undefined : { background: color }}>
              <input type="color" value={color} onChange={(event) => pickColor(event.target.value)} aria-label="Custom colour" />
            </label>
          </div>
          <span className="sketch-sep" />
          <div className="segmented sketch-widths" role="group" aria-label={tool === 'text' ? 'Text size' : 'Stroke width'}>
            {SKETCH_WIDTHS.map((width, index) => (
              <button key={width} type="button" className={widthIndex === index ? 'active' : ''} onClick={() => pickWidth(index)} title={tool === 'text' ? `${TEXT_SIZES[index]} px text` : `${width} px`}>
                <i style={{ width: Math.min(14, 2 + width * 0.6), height: Math.min(14, 2 + width * 0.6) }} />
              </button>
            ))}
          </div>
          <button type="button" className={`btn btn-small sketch-toggle${fill ? ' on' : ''}`} onClick={toggleFill} title="Fill rectangles and ellipses">
            <PaintBucket size={12} /> {fill ? 'Filled' : 'Outline'}
          </button>
          <span className="sketch-sep" />
          <div className="segmented" role="group" aria-label="Paper">
            <button type="button" className={paper === '#f5f5f5' ? 'active' : ''} onClick={() => setPaper('#f5f5f5')}>Light</button>
            <button type="button" className={paper === '#1a1a1a' ? 'active' : ''} onClick={() => setPaper('#1a1a1a')}>Dark</button>
          </div>
          <div className="toolbar-spacer" />
          <button type="button" className="icon-btn small" onClick={doUndo} disabled={!history.past.length} title="Undo (Ctrl+Z)"><Undo2 size={14} /></button>
          <button type="button" className="icon-btn small" onClick={doRedo} disabled={!history.future.length} title="Redo (Ctrl+Y)"><Redo2 size={14} /></button>
          <button type="button" className="icon-btn small danger" onClick={clearAll} disabled={!history.present.some((shape) => !(shape.kind === 'image' && shape.background))} title="Clear the drawing (keeps the frame)"><Trash2 size={14} /></button>
        </div>

        <div className="sketch-body">
          <nav className="sketch-tools" aria-label="Tools">
            {TOOLS.map(({ id, label, key, icon: Icon }) => (
              <button key={id} type="button" className={`icon-btn${tool === id ? ' active' : ''}`} onClick={() => { setTool(id); if (id !== 'select') setSelected(null); }} title={`${label} (${key})`} aria-pressed={tool === id}>
                <Icon size={16} />
              </button>
            ))}
            <span className="sketch-tools-sep" />
            <button type="button" className="icon-btn" onClick={() => void uploadPhoto()} title="Add a photo from disk (or drop one on the page)"><ImagePlus size={16} /></button>
          </nav>

          <div
            ref={stageRef}
            className={`sketch-stage${dropping ? ' dropping' : ''}`}
            onDragOver={(event) => { event.preventDefault(); setDropping(true); }}
            onDragLeave={() => setDropping(false)}
            onDrop={onDrop}
          >
            <div className="sketch-page" style={{ width: box.w, height: box.h }}>
              <canvas
                ref={canvasRef}
                style={{ width: box.w, height: box.h, cursor }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onDoubleClick={onDoubleClick}
              />
              {textEdit && (
                <textarea
                  ref={textRef}
                  className="sketch-text-input"
                  style={textStyle}
                  value={textEdit.text}
                  placeholder="Type…"
                  spellCheck={false}
                  onChange={(event) => setTextEdit({ ...textEdit, text: event.target.value })}
                  onBlur={commitText}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === 'Escape') { event.preventDefault(); setTextEdit(null); }
                    else if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); commitText(); }
                  }}
                />
              )}
            </div>
            {dropping && <div className="sketch-drop-hint">Drop a photo to add it</div>}
          </div>
        </div>

        <footer className="modal-foot sketch-foot">
          {freshFrame && frameShape?.src !== freshFrame ? (
            <button type="button" className="btn btn-small" onClick={() => void placeFrame(freshFrame)} title="Put the card's current picture under the drawing"><Film size={12} /> Start from current frame</button>
          ) : null}
          {hasFrame && <button type="button" className="btn btn-small btn-ghost" onClick={removeFrame} title="Take the frame out from under the drawing">Remove frame</button>}
          <span className={`sketch-status${error ? ' error' : ''}`}>
            {busy ? <><LoaderCircle size={12} className="spin" /> {busy}</> : error ?? 'Draw with the mouse · Shift keeps lines at 45° and shapes square · Enter places text · Delete removes the selection'}
          </span>
          <div className="toolbar-spacer" />
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={!!busy}>Save to card</button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
