// The welcome tour: five spotlights over the editor on a fresh install — the chat, the AI
// providers, the project area, the timeline and the Program monitor.
//
// Runs once, right after the first-run setup (Onboarding.tsx), and only on an install that
// started without Settings.onboarded; Settings › General can switch it off or replay it. Every
// step can be skipped. A panel the user has hidden is explained from a centred card instead.
import { ArrowLeft, ArrowRight, Bot, FolderOpen, MessageSquare, MonitorPlay, Rows3, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { PanelId } from '../lib/types';
import '../styles/tour.css';

export type TourStepId = 'chat' | 'providers' | 'project' | 'timeline' | 'program';

type Step = {
  id: TourStepId;
  panel: PanelId;
  icon: typeof Bot;
  title: string;
  body: string;
};

const STEPS: Step[] = [
  { id: 'chat', panel: 'chat', icon: MessageSquare, title: 'Bhippi AI chat', body: 'Tell Bhippi what you want in plain words — "make it a reel", "add captions", "tighten the cuts". It edits your timeline and explains every change it makes.' },
  { id: 'providers', panel: 'chat', icon: Bot, title: 'AI providers', body: 'Choose which AI does the work. Bhippi finds the AI tools you are signed into, API keys you add, and models running on this computer. Switch here any time, or manage them in Settings.' },
  { id: 'project', panel: 'project', icon: FolderOpen, title: 'Project area', body: 'Everything you import lands here — footage, audio and images. Double-click a file to preview it, or drag it onto the timeline. The tabs beside it hold effects, subtitles, graphics and audio.' },
  { id: 'timeline', panel: 'timeline', icon: Rows3, title: 'Timeline', body: 'Where your edit lives. Arrange clips on video and audio tracks, trim with the tools on the left and scrub to any moment. Changes the AI makes land here too, so you can fine-tune them by hand.' },
  { id: 'program', panel: 'program', icon: MonitorPlay, title: 'Preview and export', body: 'Watch the result in the Program monitor. When it looks right, choose Export at the top of the window to render your video.' },
];

type Props = {
  /** Called as each step opens, so the app can show what it points at (the Providers tab). */
  onStep: (id: TourStepId) => void;
  /** Closes the tour, whether finished or skipped. */
  onDone: (finished: boolean) => void;
};

type Box = { top: number; left: number; width: number; height: number };

const PAD = 6;
const GAP = 14;
const CARD_W = 340;
const EDGE = 12;

/** Where the card sits beside the spotlight: the side with room, else centred over it. */
function placeCard(box: Box | null, cardH: number): CSSProperties {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (!box) return { top: Math.max(EDGE, (vh - cardH) / 2), left: Math.max(EDGE, (vw - CARD_W) / 2) };
  const clampTop = (top: number) => Math.min(Math.max(EDGE, top), vh - cardH - EDGE);
  const clampLeft = (left: number) => Math.min(Math.max(EDGE, left), vw - CARD_W - EDGE);
  const midY = box.top + box.height / 2 - cardH / 2;
  const midX = box.left + box.width / 2 - CARD_W / 2;
  if (vw - (box.left + box.width) >= CARD_W + GAP + EDGE) return { top: clampTop(midY), left: box.left + box.width + GAP };
  if (box.left >= CARD_W + GAP + EDGE) return { top: clampTop(midY), left: box.left - GAP - CARD_W };
  if (box.top >= cardH + GAP + EDGE) return { top: box.top - GAP - cardH, left: clampLeft(midX) };
  if (vh - (box.top + box.height) >= cardH + GAP + EDGE) return { top: box.top + box.height + GAP, left: clampLeft(midX) };
  return { top: clampTop(midY), left: clampLeft(midX) };
}

export function Tour({ onStep, onDone }: Props) {
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [cardH, setCardH] = useState(220);
  const cardRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const step = STEPS[index];
  const last = index === STEPS.length - 1;

  const measure = useCallback(() => {
    const target = document.querySelector<HTMLElement>(`[data-panel="${step.panel}"]`);
    const rect = target?.getBoundingClientRect();
    if (!rect || rect.width < 4 || rect.height < 4) return setBox(null);
    setBox({ top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 });
  }, [step.panel]);

  useEffect(() => { onStep(step.id); }, [step.id, onStep]);

  // Measure after the app has had a frame to show the step's tab, then follow resizes.
  useLayoutEffect(() => {
    const frame = requestAnimationFrame(measure);
    const target = document.querySelector(`[data-panel="${step.panel}"]`);
    const observer = new ResizeObserver(measure);
    if (target) observer.observe(target);
    window.addEventListener('resize', measure);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [measure, step.panel]);

  useLayoutEffect(() => {
    if (cardRef.current) setCardH(cardRef.current.offsetHeight);
  }, [index]);

  useEffect(() => { nextRef.current?.focus(); }, [index]);

  const go = useCallback((next: number) => {
    if (next >= STEPS.length) return onDone(true);
    setIndex(Math.max(0, next));
  }, [onDone]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onDone(false); }
      else if (event.key === 'ArrowRight') { event.preventDefault(); go(index + 1); }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); go(index - 1); }
      else return;
      event.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [go, index, onDone]);

  const Icon = step.icon;
  return (
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-body">
      <div className={`tour-spot${box ? '' : ' none'}`} style={box ?? undefined} />
      <div ref={cardRef} className="tour-card" style={{ ...placeCard(box, cardH), width: CARD_W }}>
        <div className="tour-head">
          <span className="tour-icon"><Icon size={16} /></span>
          <span className="tour-count">Step {index + 1} of {STEPS.length}</span>
          <button type="button" className="tour-close" onClick={() => onDone(false)} aria-label="Skip tour" title="Skip tour (Esc)"><X size={14} /></button>
        </div>
        <div key={step.id} className="tour-content">
          <h3 id="tour-title">{step.title}</h3>
          <p id="tour-body">{step.body}</p>
        </div>
        <div className="tour-foot">
          <div className="tour-dots" aria-hidden>
            {STEPS.map((item, at) => <span key={item.id} className={at === index ? 'on' : at < index ? 'past' : ''} />)}
          </div>
          {index === 0
            ? <button type="button" className="btn btn-ghost btn-small" onClick={() => onDone(false)}>Skip</button>
            : <button type="button" className="btn btn-ghost btn-small" onClick={() => go(index - 1)}><ArrowLeft size={13} /> Back</button>}
          <button ref={nextRef} type="button" className="btn btn-primary btn-small" onClick={() => go(index + 1)}>
            {last ? 'Start editing' : <>Next <ArrowRight size={13} /></>}
          </button>
        </div>
      </div>
    </div>
  );
}
