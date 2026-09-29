// The production's place in the pipeline, and the one button the user presses next.
//
// PLAN ──[Start generating]──▶ GATHER ──[Start editing]──▶ EDIT ──▶ POLISH ──▶ DONE
//
// The model cannot press these; the workflow guard refuses gathering tools until the user has,
// and refuses timeline tools until they have again. Rendered as a compact glass dock docked
// right above the composer: icons carry the state, hover/focus (title + aria-label) carries the
// sentence — the phase names and progress detail used to sit in the panel as running text and
// crowded whatever the model had just written above them.
import { Check, Clapperboard, LoaderCircle, Play, Search, Sparkles, Wand2 } from 'lucide-react';
import type { Comp, ProductionPhase } from '../lib/types';
import { PHASE_LABEL, gatherReport, userAdvance } from '../lib/production';

const STEPS: { key: 'plan' | 'gather' | 'edit' | 'polish'; label: string; icon: typeof Search; phases: ProductionPhase[] }[] = [
  { key: 'plan', label: 'Plan', icon: Search, phases: ['planning', 'plan-ready'] },
  { key: 'gather', label: 'Gather', icon: Sparkles, phases: ['gathering', 'gathered'] },
  { key: 'edit', label: 'Edit', icon: Clapperboard, phases: ['editing'] },
  { key: 'polish', label: 'Polish', icon: Wand2, phases: ['polishing', 'done'] },
];

const ORDER: ProductionPhase[] = ['planning', 'plan-ready', 'gathering', 'gathered', 'editing', 'polishing', 'done'];

export function ProductionBar({ comp, busy, onAdvance, onPolish }: {
  comp: Comp;
  /** True while a turn is running, so the button waits for it. */
  busy: boolean;
  /** The user pressed the button: move the production to `phase` and tell the model. */
  onAdvance: (phase: ProductionPhase) => void;
  /** The polish pass over the whole timeline (or the in/out selection), offered once the edit is on the timeline. */
  onPolish?: () => void;
}) {
  const production = comp.production;
  if (!production) return null;
  const phase = production.phase;
  const rank = ORDER.indexOf(phase);
  const next = userAdvance(phase);
  const report = gatherReport(comp);
  const pending = phase === 'gathering' || phase === 'gathered';
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
    <div className={`production-dock phase-${phase}`} role="group" aria-label="Production phase" title={`${PHASE_LABEL[phase]} — ${detail}`}>
      <span className="production-glint tl" aria-hidden="true" />
      <span className="production-glint br" aria-hidden="true" />
      <span className="production-sheen" aria-hidden="true" />
      <ol className="production-orbits">
        {STEPS.map((step) => {
          const first = ORDER.indexOf(step.phases[0]);
          const last = ORDER.indexOf(step.phases[step.phases.length - 1]);
          const state = rank > last || phase === 'done' ? 'done' : rank >= first ? 'current' : 'todo';
          const Icon = step.icon;
          const showRing = state === 'current' && step.key === 'gather' && pending && report.total > 0;
          const tip = state === 'current' ? `${step.label} — ${detail}` : step.label;
          return (
            <li key={step.key} className={`production-orbit ${state}`} title={tip} aria-label={tip}>
              <span className="orbit-icon">
                {state === 'done' ? <Check size={13} /> : state === 'current' && busy ? <LoaderCircle size={13} className="spin" /> : <Icon size={13} />}
              </span>
              {showRing && <span className="orbit-badge">{report.ready}/{report.total}</span>}
            </li>
          );
        })}
      </ol>
      {!button && onPolish && (phase === 'editing' || phase === 'polishing') && (
        <button
          type="button"
          className={`production-go${busy ? ' busy' : ''}`}
          disabled={busy}
          title={busy ? 'Waiting for the assistant…' : 'Polish — check every frame and fix what is off: panels outside the frame, blank or white frames, black edges, overlaps (the in/out selection when one is set)'}
          aria-label={busy ? 'Waiting for the assistant' : 'Polish'}
          onClick={onPolish}
        >
          {busy ? <LoaderCircle size={14} className="spin" /> : <Wand2 size={14} />}
        </button>
      )}
      {button && (
        // Named, not just an icon: this is the one thing the user has to press to move on, and a
        // bare ▶ read as decoration (people typed "do it" into the chat instead).
        <button
          type="button"
          className={`production-go labelled${busy ? ' busy' : ''}`}
          disabled={busy}
          title={busy ? 'Waiting for the assistant…' : `${button.label} — ${button.hint}`}
          aria-label={busy ? 'Waiting for the assistant' : button.label}
          onClick={() => next && onAdvance(next)}
        >
          {busy ? <LoaderCircle size={14} className="spin" /> : <Play size={13} fill="currentColor" />}
          <span>{busy ? 'Working…' : button.label}</span>
        </button>
      )}
    </div>
  );
}
