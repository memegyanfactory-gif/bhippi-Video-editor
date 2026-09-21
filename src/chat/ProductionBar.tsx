// The production's place in the pipeline, and the one button the user presses next.
//
// PLAN ──[Start generating]──▶ GATHER ──[Start editing]──▶ EDIT ──▶ POLISH ──▶ DONE
//
// The model cannot press these; the workflow guard refuses gathering tools until the user has,
// and refuses timeline tools until they have again. Between the buttons the bar shows what the
// phase is producing: shots gathered, the QA verdict, what is still missing.
import { Check, ChevronRight, Clapperboard, LoaderCircle, Play, Search, Sparkles, Wand2 } from 'lucide-react';
import type { Comp, ProductionPhase } from '../lib/types';
import { PHASE_LABEL, gatherReport, userAdvance } from '../lib/production';

const STEPS: { key: 'plan' | 'gather' | 'edit' | 'polish'; label: string; icon: typeof Search; phases: ProductionPhase[] }[] = [
  { key: 'plan', label: 'Plan', icon: Search, phases: ['planning', 'plan-ready'] },
  { key: 'gather', label: 'Gather', icon: Sparkles, phases: ['gathering', 'gathered'] },
  { key: 'edit', label: 'Edit', icon: Clapperboard, phases: ['editing'] },
  { key: 'polish', label: 'Polish', icon: Wand2, phases: ['polishing', 'done'] },
];

const ORDER: ProductionPhase[] = ['planning', 'plan-ready', 'gathering', 'gathered', 'editing', 'polishing', 'done'];

export function ProductionBar({ comp, busy, onAdvance }: {
  comp: Comp;
  /** True while a turn is running, so the button waits for it. */
  busy: boolean;
  /** The user pressed the button: move the production to `phase` and tell the model. */
  onAdvance: (phase: ProductionPhase) => void;
}) {
  const production = comp.production;
  if (!production) return null;
  const phase = production.phase;
  const rank = ORDER.indexOf(phase);
  const next = userAdvance(phase);
  const report = gatherReport(comp);
  const pending = production.phase === 'gathering' || production.phase === 'gathered';
  const detail = phase === 'plan-ready'
    ? `${report.total} shot${report.total === 1 ? '' : 's'} to gather · music ${production.music?.source ?? 'none'}${production.research?.sources.length ? ` · ${production.research.sources.length} sources` : ''}`
    : pending
      ? `${report.ready}/${report.total} gathered${report.missing.length && phase === 'gathering' ? ` · next: ${report.missing[0]}` : ''}`
      : phase === 'editing'
        ? 'Assembling: cuts, levels, beats, graphics, roto, sound'
        : phase === 'polishing'
          ? production.qa ? (production.qa.clear ? `Frame QA clear (${production.qa.sampled} frames)` : `Frame QA: ${production.qa.issues} issue${production.qa.issues === 1 ? '' : 's'} to fix`) : 'Polishing'
          : phase === 'done' ? 'Verified' : 'Planning';
  const button = next === 'gathering'
    ? { label: 'Start generating', hint: 'Generate every planned shot, the voice-over and the music' }
    : next === 'editing'
      ? { label: 'Start editing', hint: 'Cut, level, place graphics, roto, sound design, polish' }
      : null;

  return (
    <div className={`production-bar phase-${phase}`} role="group" aria-label="Production phase">
      <ol className="production-steps">
        {STEPS.map((step, index) => {
          const first = ORDER.indexOf(step.phases[0]);
          const last = ORDER.indexOf(step.phases[step.phases.length - 1]);
          const state = rank > last || phase === 'done' ? 'done' : rank >= first ? 'current' : 'todo';
          const Icon = step.icon;
          return (
            <li key={step.key} className={`production-step ${state}`}>
              <span className="production-step-icon">{state === 'done' ? <Check size={11} /> : state === 'current' && busy ? <LoaderCircle size={11} className="spin" /> : <Icon size={11} />}</span>
              <span className="production-step-label">{step.label}</span>
              {index < STEPS.length - 1 && <ChevronRight size={11} className="production-step-arrow" />}
            </li>
          );
        })}
      </ol>
      <div className="production-status">
        <strong>{PHASE_LABEL[phase]}</strong>
        <span>{detail}</span>
      </div>
      {button && (
        <button type="button" className="production-go" disabled={busy} title={button.hint} onClick={() => next && onAdvance(next)}>
          <Play size={12} fill="currentColor" />
          <span>{busy ? 'Waiting for the assistant…' : button.label}</span>
        </button>
      )}
      {pending && report.total > 0 && (
        <div className="production-progress" aria-label={`${report.ready} of ${report.total} shots gathered`}>
          <span style={{ width: `${Math.round((report.ready / Math.max(1, report.total)) * 100)}%` }} />
        </div>
      )}
    </div>
  );
}
