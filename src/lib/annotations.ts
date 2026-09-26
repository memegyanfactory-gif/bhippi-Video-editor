// Notes pinned on the Program monitor for the chat. The monitor adds them; the main chat shows
// how many are waiting, and sends them — words, place in the timeline, the layers under the
// pointed-at area and a snapshot of the frame — with the next message. The bar stays open, so the
// user can keep pinning and sending as long as they like; the numbering runs on through the
// conversation until it is cleared.
import { useSyncExternalStore } from 'react';

/** A layer under an annotation, as the AI needs it to find and change that exact clip. */
export type AnnotationLayer = {
  clipId: string;
  name: string;
  /** media, text, shape, html, motion, comp… */
  kind: string;
  trackId: string;
  /** "V2 (Titles)" */
  track: string;
  /** Timeline seconds the clip starts and ends. */
  start: number;
  end: number;
  /** Seconds into the clip at the annotated frame, and the source second shown there (media). */
  localTime: number;
  sourceTime: number | null;
  /** The file or source behind it, when there is one. */
  source: string | null;
  text: string | null;
  /** Motion values at the annotated frame. */
  transform: { x: number; y: number; scale: number; rotation: number; opacity: number };
  effects: string[];
  adjustment: boolean;
  /** Where the layer is on screen, comp pixels. */
  box: { x: number; y: number; width: number; height: number } | null;
  /** Share of the annotated area this layer covers, 0–1. */
  coverage: number;
};

export type Annotation = {
  id: string;
  /** Running number in this conversation: #1, #2… */
  n: number;
  note: string;
  compId: string;
  compName: string;
  compSize: { width: number; height: number };
  fps: number;
  /** Timeline seconds, its timecode and frame number. */
  time: number;
  timecode: string;
  frame: number;
  /** A whole layer picked by clicking, an area dragged out, a spot with no layer under it, or the whole frame. */
  kind: 'layer' | 'area' | 'point' | 'frame';
  /** The annotated area, comp pixels and fractions of the frame (0–1). */
  region: { x: number; y: number; width: number; height: number };
  regionFraction: { x: number; y: number; width: number; height: number };
  /** The layer the user pointed at (the topmost one under the area), then every layer under it. */
  target: AnnotationLayer | null;
  layers: AnnotationLayer[];
  /** Audio playing at that moment, by name, so "the music here" can be resolved. */
  audio: { clipId: string; name: string; track: string }[];
  /** Timeline selection, In/Out and markers within a second, for context. */
  selection: string[];
  inOut: { in: number | null; out: number | null };
  markers: { name: string; time: number }[];
  /** The frame with the area outlined (JPEG data URL); null when the picture could not be read. */
  snapshot: string | null;
  at: number;
};

/** What a sent user message keeps of its annotations, for the transcript. */
export type SentAnnotation = { n: number; note: string; timecode: string; label: string };

let pending: Annotation[] = [];
let counter = 0;
const listeners = new Set<() => void>();
const sendListeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export const annotations = {
  list: () => pending,
  /** The number the next annotation will get. */
  next: () => counter + 1,
  add(entry: Omit<Annotation, 'n'>) {
    counter += 1;
    pending = [...pending, { ...entry, n: counter }];
    emit();
    return counter;
  },
  remove(id: string) {
    pending = pending.filter((item) => item.id !== id);
    emit();
  },
  clear() {
    pending = [];
    emit();
  },
  /** Hands every waiting annotation to the message being sent. */
  take(): Annotation[] {
    const taken = pending;
    pending = [];
    emit();
    return taken;
  },
  /** A new conversation starts counting from one again. */
  reset() {
    pending = [];
    counter = 0;
    emit();
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  /** The monitor's "Send to chat": the main chat sends what is waiting, with its draft. */
  requestSend() {
    sendListeners.forEach((listener) => listener());
  },
  onSendRequest(listener: () => void) {
    sendListeners.add(listener);
    return () => { sendListeners.delete(listener); };
  },
};

export function usePendingAnnotations(): Annotation[] {
  return useSyncExternalStore(annotations.subscribe, annotations.list, annotations.list);
}

export const layerLabel = (layer: AnnotationLayer | null) => (layer ? `${layer.track.split(' ')[0]} · ${layer.name}` : null);

export const annotationLabel = (item: Pick<Annotation, 'kind' | 'target'>) =>
  layerLabel(item.target) ?? (item.kind === 'point' ? 'a spot' : item.kind === 'frame' ? 'whole frame' : 'an area');

export const sentAnnotation = (item: Annotation): SentAnnotation => ({ n: item.n, note: item.note, timecode: item.timecode, label: annotationLabel(item) });

const r = (value: number, places = 2) => +value.toFixed(places);
const box = (b: { x: number; y: number; width: number; height: number }) => `x ${Math.round(b.x)}, y ${Math.round(b.y)}, ${Math.round(b.width)}×${Math.round(b.height)} px`;

function layerLines(layer: AnnotationLayer, indent: string): string[] {
  const t = layer.transform;
  return [
    `${indent}- clipId ${layer.clipId} · "${layer.name}" · ${layer.kind} on ${layer.track} (trackId ${layer.trackId})`,
    `${indent}  timeline ${r(layer.start)}s–${r(layer.end)}s · ${r(layer.localTime)}s into the clip${layer.sourceTime !== null ? ` · source ${r(layer.sourceTime)}s` : ''}`,
    ...(layer.source ? [`${indent}  source: ${layer.source}`] : []),
    ...(layer.text ? [`${indent}  text: "${layer.text.slice(0, 200)}"`] : []),
    `${indent}  on screen: ${layer.box ? box(layer.box) : 'not measurable'} · covers ${Math.round(layer.coverage * 100)}% of the annotated area`,
    `${indent}  transform now: x ${r(t.x, 3)}, y ${r(t.y, 3)}, scale ${r(t.scale, 1)}%, rotation ${r(t.rotation, 1)}°, opacity ${r(t.opacity, 1)}%${layer.adjustment ? ' · adjustment layer' : ''}`,
    ...(layer.effects.length ? [`${indent}  effects: ${layer.effects.join(', ')}`] : []),
  ];
}

/**
 * The annotations as the model reads them, sent under the user's words. Positions are in comp
 * pixels from the top-left corner and as fractions of the frame; clip ids are the ones the edit
 * tools take.
 */
export function annotationBrief(list: Annotation[]): string {
  if (!list.length) return '';
  const blocks = list.map((item) => {
    const f = item.regionFraction;
    return [
      `Annotation #${item.n}: "${item.note || '(no note — the user pointed at this)'}"`,
      `- where: comp "${item.compName}" (compId ${item.compId}, ${item.compSize.width}×${item.compSize.height} @ ${item.fps} fps) at ${item.timecode} = ${r(item.time, 3)}s, frame ${item.frame}`,
      `- pointed at: ${item.kind === 'layer' ? 'a whole layer (clicked)' : item.kind === 'area' ? 'an area dragged out' : item.kind === 'frame' ? 'the whole frame' : 'a spot with no layer under it'} — ${box(item.region)} (fractions x ${r(f.x, 3)}, y ${r(f.y, 3)}, w ${r(f.width, 3)}, h ${r(f.height, 3)})`,
      `- target layer: ${item.target ? '' : 'none'}`,
      ...(item.target ? layerLines(item.target, '  ') : []),
      ...(item.layers.length > (item.target ? 1 : 0) ? ['- every visible layer under the area, topmost first:', ...item.layers.filter((layer) => layer.clipId !== item.target?.clipId).flatMap((layer) => layerLines(layer, '  '))] : []),
      ...(item.audio.length ? [`- audio playing: ${item.audio.map((a) => `"${a.name}" on ${a.track} (clipId ${a.clipId})`).join('; ')}`] : []),
      ...(item.selection.length ? [`- timeline selection: ${item.selection.join(', ')}`] : []),
      ...(item.inOut.in !== null || item.inOut.out !== null ? [`- In/Out: ${item.inOut.in ?? '—'}s to ${item.inOut.out ?? '—'}s`] : []),
      ...(item.markers.length ? [`- markers nearby: ${item.markers.map((m) => `"${m.name}" at ${r(m.time)}s`).join('; ')}`] : []),
      ...(item.snapshot ? ['- a snapshot of this frame with the area outlined is attached'] : []),
    ].join('\n');
  });
  return [
    `The user annotated the Program monitor (${list.length} annotation${list.length === 1 ? '' : 's'}). Apply each note to exactly the place, time and layer it points at; use the clip ids given.`,
    ...blocks,
  ].join('\n\n');
}
