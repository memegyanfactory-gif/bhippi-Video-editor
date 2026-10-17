// The studio proper: a section nav on the left and one large canvas of artboards on the right.
// The nav jumps between artboards and follows the scroll; boards that the AI (or an outside edit)
// changed flash so you can see what moved.

import { BookOpen, Clapperboard, Film, GraduationCap, Image as ImageIcon, LayoutPanelTop, Music, Palette, Presentation, Shapes, Sparkles, Type as TypeIcon, Activity, MessageSquareQuote } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { type BrandKit, type BrandLogo } from '../../lib/brandKit';
import { personalityOf, personalityPhrase } from '../../lib/brandKit/studio';
import { KitLearnings } from '../KitLearnings';
import { BrandGuidelineView } from '../BrandGuidelineView';
import { BrandReel } from './reel/BrandReel';
import { MotionPack } from './reel/MotionPack';
import { useBrandHealth } from './HealthCard';
import { PromptBar } from './PromptBar';
import { BOARDS, changedBoards, type BoardId } from './helpers';
import { Artboard, ForceBoards, prefersReducedMotion, type Patch } from './shared';
import { ColourBoard } from './sections/Colour';
import { ImageryBoard } from './sections/Imagery';
import { InUseBoard } from './sections/InUse';
import { LayoutBoard } from './sections/Layout';
import { LogoBoard } from './sections/Logo';
import { MotionBoard } from './sections/Motion';
import { Overview } from './sections/Overview';
import { SoundBoard } from './sections/Sound';
import { TypeBoard } from './sections/Type';
import { VoiceBoard } from './sections/Voice';
import { tokenHex } from './shared';

const ICONS: Record<BoardId, ReactNode> = {
  overview: <Sparkles size={15} />, logo: <Shapes size={15} />, colour: <Palette size={15} />, type: <TypeIcon size={15} />, motion: <Activity size={15} />, voice: <MessageSquareQuote size={15} />,
  imagery: <ImageIcon size={15} />, layout: <LayoutPanelTop size={15} />, sound: <Music size={15} />, inuse: <Presentation size={15} />, pack: <Clapperboard size={15} />, learnings: <GraduationCap size={15} />, guideline: <BookOpen size={15} />,
};

const COPY: Record<BoardId, { title: string; blurb: string }> = {
  overview: { title: 'Overview', blurb: 'Who the brand is, how it feels and how healthy the kit is.' },
  logo: { title: 'Logo', blurb: 'Every mark on light, dark, brand colour and photography, with its clear space.' },
  colour: { title: 'Colour', blurb: 'Click a swatch to edit it. Scales, gradients and contrast update as you go.' },
  type: { title: 'Type', blurb: 'Click a line to edit its sample, a role to change its font.' },
  motion: { title: 'Motion', blurb: 'Drag the curve. Everything here moves the way this brand moves.' },
  voice: { title: 'Voice', blurb: 'How the brand talks, with the lines that prove it.' },
  imagery: { title: 'Imagery', blurb: 'The grade on real frames, the prompts and the icon style.' },
  layout: { title: 'Layout', blurb: 'Safe areas, logo bug, lower third and captions on every frame shape.' },
  sound: { title: 'Sound', blurb: 'The music, tempo and effects it cuts to.' },
  inuse: { title: 'Brand in use', blurb: 'Thumbnails, banners, vertical video, posts and slides, worn by the kit.' },
  pack: { title: 'Motion pack', blurb: 'Animated scenes built from the kit: intros, lower thirds, end cards.' },
  learnings: { title: 'Learnings', blurb: 'What the kit learned from references you trained it on.' },
  guideline: { title: 'Guideline', blurb: 'What the AI builds videos from: colour use, type scale, layouts and moves.' },
};

export type StudioBodyProps = {
  kit: BrandKit;
  onPatch: Patch;
  onReplace: (kit: BrandKit) => void;
  onAddLogo: (role: BrandLogo['role']) => void;
  onOpenStyles: (tab: 'styles' | 'colours') => void;
  /** Time of the user's last edit here, so only outside changes (the AI's) flash. */
  localEditAt: MutableRefObject<number>;
  jumpTo?: { id: BoardId; n: number } | null;
};

export function StudioBody({ kit, onPatch, onReplace, onAddLogo, onOpenStyles, localEditAt, jumpTo }: StudioBodyProps) {
  const health = useBrandHealth(kit);
  const canvas = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<BoardId>('overview');
  const [forced, setForced] = useState(false);
  const [flash, setFlash] = useState<string[]>([]);
  const [aiChanged, setAiChanged] = useState<{ boards: string[]; at: number } | null>(null);

  // Boards the AI touched flash for a moment. The user's own edits (within 2.5 s) do not.
  const prev = useRef(kit);
  useEffect(() => {
    const before = prev.current;
    prev.current = kit;
    const boards = changedBoards(before, kit);
    if (!boards.length || Date.now() - localEditAt.current < 2500) return;
    setFlash(boards);
    setAiChanged({ boards, at: Date.now() });
    const id = window.setTimeout(() => setFlash([]), 2200);
    return () => window.clearTimeout(id);
  }, [kit, localEditAt]);

  // Follow the scroll in the nav.
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const line = el.getBoundingClientRect().top + 160;
      let current: BoardId = 'overview';
      for (const b of BOARDS) {
        const node = document.getElementById(`bs-board-${b.id}`);
        if (node && node.getBoundingClientRect().top <= line) current = b.id;
      }
      setActive(current);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => { el.removeEventListener('scroll', onScroll); cancelAnimationFrame(frame); };
  }, []);

  const jump = (id: BoardId) => {
    setForced(true);
    setActive(id);
    const go = () => document.getElementById(`bs-board-${id}`)?.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    requestAnimationFrame(() => requestAnimationFrame(go));
    // Boards that mounted on the way change the page height: settle on the target again.
    for (const ms of [700, 1600]) window.setTimeout(() => document.getElementById(`bs-board-${id}`)?.scrollIntoView({ block: 'start', behavior: 'auto' }), ms);
  };
  const lastJump = useRef(0);
  useEffect(() => { if (jumpTo && jumpTo.n !== lastJump.current) { lastJump.current = jumpTo.n; jump(jumpTo.id); } }, [jumpTo]);

  const open = useMemo(() => { const m: Record<string, number> = {}; for (const c of health.checks) if (c.status !== 'pass') m[c.section] = (m[c.section] ?? 0) + 1; return m; }, [health]);
  const primary = tokenHex(kit, 'primary', '#2d8ceb');
  const accent = tokenHex(kit, 'accent', primary);
  const f = (id: string) => flash.includes(id);
  const personality = personalityOf(kit);
  const sections: Record<BoardId, ReactNode> = {
    overview: <Overview kit={kit} onPatch={onPatch} onReplace={onReplace} health={health} onJump={(s) => jump(s as BoardId)} />,
    logo: <LogoBoard kit={kit} onReplace={onReplace} onAddLogo={onAddLogo} />,
    colour: <ColourBoard kit={kit} onPatch={onPatch} onReplace={onReplace} onOpenStyles={() => onOpenStyles('colours')} />,
    type: <TypeBoard kit={kit} onPatch={onPatch} onReplace={onReplace} />,
    motion: <MotionBoard kit={kit} onPatch={onPatch} onReplace={onReplace} />,
    voice: <VoiceBoard kit={kit} onPatch={onPatch} onReplace={onReplace} />,
    imagery: <ImageryBoard kit={kit} onPatch={onPatch} onReplace={onReplace} />,
    layout: <LayoutBoard kit={kit} onPatch={onPatch} onReplace={onReplace} />,
    sound: <SoundBoard kit={kit} onPatch={onPatch} onReplace={onReplace} />,
    inuse: <InUseBoard kit={kit} />,
    pack: <MotionPack kit={kit} />,
    learnings: <KitLearnings kit={kit} onReplace={(next) => onReplace({ ...next, updatedAt: new Date().toISOString() })} />,
    guideline: <BrandGuidelineView kit={kit} onReset={() => onPatch('guideline', { guideline: null })} />,
  };

  return (
    <div className="bs-body" style={{ ['--bs-brand' as string]: primary, ['--bs-brand-2' as string]: accent }}>
      <nav className="bs-nav" aria-label="Brand sections">
        <ol>
          {BOARDS.map((b) => (
            <li key={b.id}>
              <button type="button" className={active === b.id ? 'on' : ''} aria-current={active === b.id ? 'location' : undefined} onClick={() => jump(b.id)}>
                <span className="bs-nav-ico">{ICONS[b.id]}</span>
                <span className="bs-nav-label">{b.label}</span>
                {open[b.id] ? <em className="bs-nav-dot" title={`${open[b.id]} to look at`}>{open[b.id]}</em> : null}
              </button>
            </li>
          ))}
        </ol>
        <div className="bs-nav-foot"><Film size={12} /><span>{kit.logos.length ? 'Brand ready' : 'Add a logo to finish'}</span></div>
      </nav>
      <div className="bs-canvas" ref={canvas}>
        <ForceBoards.Provider value={forced}>
          <div className="bs-canvas-in" key={kit.id}>
            <section className="bs-hero" aria-label="Brand film">
              <div className="bs-hero-head">
                <div>
                  <span className="bs-eyebrow">Brand Studio</span>
                  <h2 style={{ fontFamily: kit.typography.display.family }}>{kit.name}</h2>
                  <p>{kit.tagline || kit.voiceGuide.samples[0] || 'Your brand, alive.'}</p>
                </div>
                <div className="bs-hero-meta"><span>{kit.style}</span><span>Reads as {personalityPhrase(personality)}</span></div>
              </div>
              <div className="bs-hero-reel"><BrandReel kit={kit} /></div>
            </section>
            {BOARDS.map((b, i) => (
              <Artboard key={b.id} id={b.id} no={String(i + 1).padStart(2, '0')} title={COPY[b.id].title} blurb={COPY[b.id].blurb} flash={b.id === 'inuse' ? flash.length > 0 : f(b.id)} eager={i === 0}>
                {sections[b.id]}
              </Artboard>
            ))}
            <div className="bs-end">That is the whole brand. Ask the bar below to change any of it.</div>
          </div>
        </ForceBoards.Provider>
      </div>
      <PromptBar kit={kit} aiChanged={aiChanged} />
    </div>
  );
}
