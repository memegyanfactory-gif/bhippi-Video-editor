// The brand wizard: a conversation with a creative director.
//
// It opens on one big prompt ("Describe your brand"). What the sentence says is parsed locally into
// a brief (name, industry, audience, feeling sliders, colour hints, a city's character) and the
// wizard jumps straight to three directions, drawn large and animated. The step-by-step questions are
// there as "Fine-tune the answers" (name, audience, feel, what you already have), then the chosen
// direction is refined (palette, type pairing, motion energy) and handed to `onCreate` as a BrandKit.

import { ArrowLeft, ArrowRight, Sparkles, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '../../../fonts/bundled.css';
import '../../../styles/brand-wizard.css';
import type { BrandKit } from '../../../lib/brandKit';
import { applyParsed, emptyBrief, parseBrief, type Brief } from '../../../lib/brandKit/brief';
import { generateDirections, type Direction, type RefineChoice } from '../../../lib/brandKit/directions';
import type { WebsiteBrand } from '../../../lib/brandKit/fromWebsite';
import { DEFAULT_CHOICE, DirectionsStep, RefineStep } from './Directions';
import { prefersReducedMotion } from './Stage';
import { AudienceStep, BringStep, DescribeStep, FeelStep, NameStep, type PickedImage } from './Steps';
import { StylesGrid } from './StylesGrid';

export type WizardStep = 'describe' | 'name' | 'audience' | 'feel' | 'bring' | 'directions' | 'refine';
const STEPS: { id: WizardStep; label: string }[] = [
  { id: 'describe', label: 'Describe' }, { id: 'name', label: 'Name' }, { id: 'audience', label: 'Audience' }, { id: 'feel', label: 'Feel' },
  { id: 'bring', label: 'Bring' }, { id: 'directions', label: 'Directions' }, { id: 'refine', label: 'Refine' },
];

export type BrandWizardProps = {
  onCreate: (kit: BrandKit) => void;
  onCancel: () => void;
  /** Start with these answers filled in (previews and tests). */
  initialBrief?: Partial<Brief>;
  initialText?: string;
  initialStep?: WizardStep;
};

export function BrandWizard({ onCreate, onCancel, initialBrief, initialText = '', initialStep = 'describe' }: BrandWizardProps) {
  const [brief, setBrief] = useState<Brief>(() => ({ ...emptyBrief(), ...initialBrief }));
  const [text, setText] = useState(initialText);
  const [step, setStep] = useState<WizardStep>(initialStep === 'directions' || initialStep === 'refine' ? 'describe' : initialStep);
  const [forward, setForward] = useState(true);
  const [mode, setMode] = useState<'flow' | 'styles'>('flow');
  const [images, setImages] = useState<PickedImage[]>([]);
  const [site, setSite] = useState<WebsiteBrand | null>(null);
  const [directions, setDirections] = useState<Direction[]>([]);
  const [selected, setSelected] = useState(0);
  const [phase, setPhase] = useState<'reading' | 'ready'>('ready');
  const [choice, setChoice] = useState<RefineChoice>({ palette: 0, pairing: 0, energy: 0.5 });
  const [finalName, setFinalName] = useState('');
  const [notes, setNotes] = useState<string[]>([]);
  const history = useRef<WizardStep[]>([]);
  const timer = useRef<number | undefined>(undefined);
  const pane = useRef<HTMLDivElement>(null);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const go = useCallback((next: WizardStep, back = false) => {
    window.clearTimeout(timer.current);
    setForward(!back);
    if (!back) history.current.push(step);
    setStep(next);
  }, [step]);

  const back = useCallback(() => {
    const prev = history.current.pop();
    if (prev) { window.clearTimeout(timer.current); setForward(false); setStep(prev); } else if (step !== 'describe') { setForward(false); setStep(STEPS[Math.max(0, STEPS.findIndex((s) => s.id === step) - 1)].id); }
  }, [step]);

  const showDirections = useCallback((b: Brief, push = true) => {
    const list = generateDirections(b);
    setDirections(list);
    setSelected(0);
    setChoice(DEFAULT_CHOICE(list[0]));
    setFinalName(b.name);
    const found = parseBrief(text).notes;
    setNotes(found.length ? found : [b.industry, b.audience, b.city].filter(Boolean).map((n) => n.toLowerCase()));
    if (push) go('directions');
    if (prefersReducedMotion()) setPhase('ready');
    else {
      setPhase('reading');
      timer.current = window.setTimeout(() => setPhase('ready'), 1250);
    }
  }, [go, text]);

  // Previews and tests can open straight on the directions or the refine screen.
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    if (initialStep === 'directions' || initialStep === 'refine') {
      const b = initialText ? applyParsed({ ...emptyBrief(), ...initialBrief }, parseBrief(initialText)) : { ...emptyBrief(), ...initialBrief };
      setBrief(b);
      const list = generateDirections(b);
      setDirections(list);
      setChoice(DEFAULT_CHOICE(list[0]));
      setFinalName(b.name);
      setNotes(parseBrief(initialText).notes);
      setPhase('ready');
      history.current = ['describe'];
      setStep(initialStep);
    }
  }, []);  

  const canGenerate = !!text.trim() || !!(brief.name || brief.makes || brief.industry || brief.audience);

  const generate = () => {
    const b = text.trim() ? applyParsed(brief, parseBrief(text)) : brief;
    setBrief(b);
    showDirections(b);
  };

  const fineTune = () => {
    if (text.trim()) setBrief((b) => applyParsed(b, parseBrief(text)));
    go('name');
  };

  const next = () => {
    if (step === 'name') go('audience');
    else if (step === 'audience') go('feel');
    else if (step === 'feel') go('bring');
    else if (step === 'bring') showDirections(brief);
    else if (step === 'directions') {
      if (phase !== 'ready') return;
      setChoice(DEFAULT_CHOICE(directions[selected]));
      go('refine');
    }
  };

  const choose = (i: number) => { setSelected(i); setChoice(DEFAULT_CHOICE(directions[i])); };

  const index = STEPS.findIndex((s) => s.id === step);
  const chosen = directions[selected];

  const jump = (target: WizardStep) => {
    const at = history.current.lastIndexOf(target);
    if (at < 0) return;
    history.current = history.current.slice(0, at);
    window.clearTimeout(timer.current);
    setForward(false);
    setStep(target);
  };

  useEffect(() => {
    if (pane.current && !pane.current.contains(document.activeElement)) pane.current.focus({ preventScroll: true });
  }, [step, mode]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (mode === 'styles') setMode('flow');
      else if (step === 'describe') onCancel();
      else back();
      return;
    }
    if (e.key !== 'Enter' || e.defaultPrevented || e.nativeEvent.isComposing) return;
    const el = e.target as HTMLElement;
    if (/^(INPUT|TEXTAREA|BUTTON|SELECT|A)$/.test(el.tagName) || el.getAttribute('role') === 'radio') return;
    if (mode === 'flow' && (step === 'feel' || step === 'bring' || step === 'directions')) { e.preventDefault(); next(); }
  };

  const visited = useMemo(() => new Set<WizardStep>([...history.current, step]), [step]);  

  if (mode === 'styles') {
    return (
      <div className="bw" role="region" aria-label="New brand" onKeyDown={onKeyDown}>
        <div className="bw-top"><span className="bw-brand"><Sparkles size={15} />New brand</span><button type="button" className="bw-close" onClick={onCancel} aria-label="Cancel"><X size={16} /></button></div>
        <div className="bw-main bw-main-wide" ref={pane} tabIndex={-1}>
          <StylesGrid name={brief.name} setName={(n) => setBrief((b) => ({ ...b, name: n }))} onBack={() => setMode('flow')} onCreate={onCreate} />
        </div>
      </div>
    );
  }

  const wide = step === 'directions' || step === 'refine';
  const showFoot = step !== 'describe' && step !== 'refine' && !(step === 'directions' && phase !== 'ready');
  const skippable = step === 'name' || step === 'audience' || step === 'feel' || step === 'bring';

  return (
    <div className="bw" role="region" aria-label="New brand" onKeyDown={onKeyDown}>
      <div className="bw-top">
        <span className="bw-brand"><Sparkles size={15} />New brand</span>
        <ol className="bw-dots" aria-label="Progress">
          {STEPS.map((s, i) => {
            const state = i < index ? 'done' : i === index ? 'now' : 'todo';
            const can = visited.has(s.id) && i < index;
            return (
              <li key={s.id} className={`bw-dot is-${state}`}>
                <button type="button" disabled={!can} aria-current={i === index ? 'step' : undefined} aria-label={`${s.label}${i === index ? ' (current step)' : ''}`} title={s.label} onClick={() => jump(s.id)} />
              </li>
            );
          })}
        </ol>
        <button type="button" className="bw-close" onClick={onCancel} aria-label="Cancel"><X size={16} /></button>
      </div>

      <div className={`bw-main${wide ? ' bw-main-wide' : ''}`}>
        <div key={step} ref={pane} tabIndex={-1} className={`bw-pane ${forward ? 'is-fwd' : 'is-back'}`}>
          {step === 'describe' && <DescribeStep text={text} setText={setText} onGenerate={generate} onFineTune={fineTune} onStyles={() => setMode('styles')} canGenerate={canGenerate} />}
          {step === 'name' && <NameStep brief={brief} setBrief={setBrief} onEnter={next} />}
          {step === 'audience' && <AudienceStep brief={brief} setBrief={setBrief} onEnter={next} />}
          {step === 'feel' && <FeelStep brief={brief} setBrief={setBrief} />}
          {step === 'bring' && <BringStep brief={brief} setBrief={setBrief} images={images} setImages={setImages} site={site} setSite={setSite} />}
          {step === 'directions' && <DirectionsStep directions={directions} selected={selected} setSelected={choose} onContinue={next} phase={phase} notes={notes} name={brief.name} />}
          {step === 'refine' && chosen && <RefineStep d={chosen} choice={choice} setChoice={setChoice} name={finalName} setName={setFinalName} onCreate={onCreate} />}
        </div>
      </div>

      {(showFoot || step === 'refine') && (
        <footer className="bw-foot">
          <button type="button" className="bw-back" onClick={back}><ArrowLeft size={15} />Back</button>
          <span className="bw-foot-hint">{step === 'directions' ? 'Enter to refine the chosen one' : step === 'refine' ? '' : 'Press Enter to continue'}</span>
          {skippable && step !== 'feel' && <button type="button" className="bw-skip" onClick={next}>Skip</button>}
          {step !== 'refine' && (
            <button type="button" className="bw-next" onClick={next}>
              {step === 'bring' ? 'Show directions' : step === 'directions' ? 'Refine this direction' : 'Next'}<ArrowRight size={15} />
            </button>
          )}
        </footer>
      )}
    </div>
  );
}
