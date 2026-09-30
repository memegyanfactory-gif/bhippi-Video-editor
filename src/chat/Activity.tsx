// What the assistant actually did during a turn, folded into one quiet line per stretch of work.
//
// Two streams arrive while a turn runs: the steps the model announces ("Reading the comp", "Cutting
// the top") and the tool calls Bhippi runs on its behalf. They are merged into one list, in the
// order things happened, each row carrying its own state — a call that is still running must never
// look like one that has finished.
//
// The list sits between the words it belongs to (see `toTimeline`): a turn that says something,
// works, and says something else reads in that order rather than as a wall of activity with every
// sentence glued together underneath it. Each stretch of work folds to a single summary line —
// "Worked for 3.1s · 13 steps · 1 failed" — and, while it is live, that line names the step that
// is running right now. Opening it shows a small timeline; any row opens again for what was asked
// and what came back. Nothing is thrown away, it is only folded.
import { Brain, ChevronRight, Download, Eye, FileText, Film, Music, Pencil, Scissors, Search, Sparkles, Wrench, type LucideIcon } from 'lucide-react';
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { toolLabel } from '../lib/toolLabels';
import { StatusDot, type DotState } from './BhippiMark';

/** A tool call, from the moment it starts rather than when it finishes. */
export type ToolRun = {
  changedProject?: boolean;
  callId: string;
  name: string;
  /** What it was asked to do, read off the arguments. Shown while it runs. */
  request: string;
  /** What came back — the summary, or the reason it failed. Empty while it is running. */
  summary: string;
  status: 'running' | 'done' | 'failed' | 'denied';
  /** When it started, so steps and calls interleave in the order they happened. */
  at: number;
  /** How long it took, once it is over. */
  ms: number | null;
  /** A brand kit training (train_brand_kit): the kit and source, for the review card. */
  training?: { kitId: string; sourceId: string };
};

/** A step the model announced. */
export type Step = { id: string; verb: string; title: string; detail: string; done: boolean; at: number };

/**
 * One stretch of the answer's words: when it began and when its last chunk arrived. A turn's text
 * is split wherever work happened in between, so the words and the work can be shown in order.
 */
export type TextSegment = { at: number; end: number; text: string };

export type Item =
  | { kind: 'step'; key: string; at: number; label: string; detail: string; done: boolean }
  | {
      kind: 'tool';
      key: string;
      at: number;
      label: string;
      detail: string;
      body: string;
      /** The two halves of `body`, kept apart so the opened row can lay them out. */
      request?: string;
      result?: string;
      status: ToolRun['status'] | 'warning';
      ms: number | null;
    };

/** A step the model announced is already in words; only its first letter is raised. */
const titleCase = (name: string) => name.replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase());

/**
 * Conversations saved before this block existed have steps with no timestamp. They keep the order
 * they were written in rather than being shuffled to the front by a missing number.
 */
const when = (value: number | undefined, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

export function toItems(steps: Step[], runs: ToolRun[]): Item[] {
  const items: Item[] = [
    ...steps.map((step, index) => ({
      kind: 'step' as const,
      key: `s-${step.id}`,
      at: when(step.at, index),
      label: step.verb ? titleCase(step.verb) : 'Step',
      detail: step.detail || step.title,
      done: step.done,
    })),
    ...runs.map((run, index) => ({
      kind: 'tool' as const,
      key: `t-${run.callId}`,
      at: when(run.at, steps.length + index),
      label: toolLabel(run.name),
      detail: run.status === 'running' ? run.request : run.summary || run.request,
      body: [run.request && `Asked: ${run.request}`, run.summary && `Result: ${run.summary}`].filter(Boolean).join('\n'),
      request: run.request,
      result: run.summary,
      status: run.status,
      ms: run.ms,
    })),
  ];
  const inspections = runs.filter(run => ['inspect_clip_frames', 'inspect_source_frames'].includes(run.name));
  if (inspections.length > 1) {
    const ids = new Set(inspections.map(run => `t-${run.callId}`));
    const completed = inspections.filter(run => run.status === 'done').length;
    const failed = inspections.filter(run => run.status === 'failed' || run.status === 'denied').length;
    const active = inspections.some(run => run.status === 'running');
    return [...items.filter(item => !ids.has(item.key)), {
      kind: 'tool' as const, key: 'frame-inspections', at: inspections[0].at,
      label: toolLabel('inspect_clip_frames'), detail: `${completed} batches completed${active ? ' · inspecting…' : ''}${failed ? ` · ${failed} failed` : ''}`,
      body: inspections.map((run, index) => `${index + 1}. ${run.status}: ${run.request}\n${run.summary}`).join('\n\n'),
      status: active ? 'running' as const : failed === inspections.length ? 'failed' as const : failed ? 'warning' as const : 'done' as const,
      ms: inspections.reduce((sum, run) => sum + (run.ms ?? 0), 0),
    }].sort((one, two) => one.at - two.at);
  }
  return items.sort((one, two) => one.at - two.at);
}

/** A row of the opened list: one item, or several identical calls in a row folded into one. */
export type Row = { key: string; lead: Item; members: Item[] };

const isOver = (item: Item) => (item.kind === 'tool' ? item.status !== 'running' : item.done);

/**
 * Folds runs of the same tool called back to back ("Online research ×3"). Only finished calls
 * fold, so the one that is running keeps its own row and its own spinner.
 */
export function groupRows(items: Item[]): Row[] {
  const rows: Row[] = [];
  for (const item of items) {
    const last = rows[rows.length - 1];
    if (last && item.kind === 'tool' && last.lead.kind === 'tool' && last.lead.label === item.label && isOver(item) && last.members.every(isOver)) {
      last.members.push(item);
    } else {
      rows.push({ key: item.key, lead: item, members: [item] });
    }
  }
  return rows;
}

/** What a stretch of the turn was: some words, or some work. */
/** A message the user sent while the turn was working (src/chat/steer.ts). */
export type Interjection = { id: string; text: string; at: number; state: 'waiting' | 'delivered' | 'next' };

export type Block =
  | { kind: 'text'; key: string; text: string }
  | { kind: 'work'; key: string; steps: Step[]; runs: ToolRun[] }
  | { kind: 'steer'; key: string; steer: Interjection };

/**
 * Puts the answer's words and the work between them in the order they happened. A step or call
 * that started at the same moment as a stretch of words goes first: the words were split *because*
 * that work had started.
 */
export function toTimeline(segments: TextSegment[], steps: Step[], runs: ToolRun[], steers: Interjection[] = []): Block[] {
  type Event = { at: number; order: number } & ({ kind: 'text'; segment: TextSegment } | { kind: 'step'; step: Step } | { kind: 'run'; run: ToolRun } | { kind: 'steer'; steer: Interjection });
  const events: Event[] = [
    ...steps.map((step, index): Event => ({ kind: 'step', step, at: when(step.at, index), order: 0 })),
    ...runs.map((run, index): Event => ({ kind: 'run', run, at: when(run.at, steps.length + index), order: 0 })),
    ...segments.map((segment): Event => ({ kind: 'text', segment, at: segment.at, order: 1 })),
    // Where the model read it, which is where it starts to show in the answer.
    ...steers.map((steer): Event => ({ kind: 'steer', steer, at: steer.at, order: 2 })),
  ].sort((one, two) => one.at - two.at || one.order - two.order);
  const blocks: Block[] = [];
  for (const event of events) {
    if (event.kind === 'steer') {
      blocks.push({ kind: 'steer', key: `s-${event.steer.id}`, steer: event.steer });
      continue;
    }
    if (event.kind === 'text') {
      if (event.segment.text.trim()) blocks.push({ kind: 'text', key: `x-${blocks.length}-${event.at}`, text: event.segment.text });
      continue;
    }
    let work = blocks[blocks.length - 1];
    if (!work || work.kind !== 'work') {
      work = { kind: 'work', key: `w-${event.at}`, steps: [], runs: [] };
      blocks.push(work);
    }
    if (event.kind === 'step') work.steps.push(event.step);
    else work.runs.push(event.run);
  }
  return blocks;
}

/** "3.1s", "42s", "2m 05s". */
export function duration(ms: number): string {
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

/** How long a stretch of work took on the wall clock, rather than the sum of its calls. */
export function wallTime(runs: ToolRun[]): number {
  const timed = runs.filter((run) => run.ms !== null && Number.isFinite(run.at));
  if (timed.length === 0) return 0;
  const start = Math.min(...timed.map((run) => run.at));
  const end = Math.max(...timed.map((run) => run.at + (run.ms ?? 0)));
  return Math.max(end - start, Math.max(...timed.map((run) => run.ms ?? 0)));
}

/** The collapsed line: what the stretch amounted to. */
export function summarize(items: Item[], runs: ToolRun[], steps: Step[]) {
  const count = runs.length + steps.length;
  // Count the original receipts: folded inspection batches can contain several failures.
  const failed = runs.filter((run) => run.status === 'failed' || run.status === 'denied').length;
  const running = items.filter((item) => !isOver(item)).length;
  const span = wallTime(runs);
  const headline = span >= 1000 ? `Worked for ${duration(span)}` : 'Worked';
  const tally = `${count} step${count === 1 ? '' : 's'}`;
  const completed = runs.filter((run) => run.status !== 'running').length + steps.filter((step) => step.done).length;
  const state: DotState = failed ? (failed === completed ? 'failed' : 'warning') : 'done';
  return { count, failed, running, headline, tally, state };
}

/** Paths and file names in a detail line are set in the code face; the prose around them is not. */
export function renderDetail(detail: unknown): ReactNode {
  // A detail is text; anything else (a tool that returned an object) is shown as JSON, not a crash.
  const text = typeof detail === 'string' ? detail : detail === undefined || detail === null ? '' : JSON.stringify(detail) ?? String(detail);
  const parts = text.split(/(\S*[\\/]\S*|[\w-]*[A-Za-z_][\w-]*\.[a-z][a-z0-9]{0,4}(?=$|[\s,;:)]))/);
  if (parts.length === 1) return text;
  return parts.map((part, index) =>
    index % 2 === 1 && part ? <code key={index} className="wk-path">{part}</code> : <Fragment key={index}>{part}</Fragment>,
  );
}

/** A small picture of what kind of work a row was, read off its label: reading, editing, cutting… */
const KINDS: [RegExp, LucideIcon][] = [
  [/\b(think|plan|decid|reason|consider)/i, Brain],
  [/\b(search|research|find|look ?up|query|browse)/i, Search],
  [/\b(inspect|watch|look|view|preview|check|review|verify|analy[sz])/i, Eye],
  [/\b(read|open|load|list|get|scan|transcri)/i, FileText],
  [/\b(cut|trim|split|ripple|splice|slice)/i, Scissors],
  [/\b(render|export|encode|frame)/i, Film],
  [/\b(audio|music|sound|sfx|voice|beat)/i, Music],
  [/\b(generat|creat|make|design|animat|compose)/i, Sparkles],
  [/\b(download|fetch|gather|import|pull)/i, Download],
  [/\b(edit|writ|updat|set|add|apply|change|move|insert|replace|fix|save|remov|delet)/i, Pencil],
];
export const kindIcon = (label: string): LucideIcon => KINDS.find(([pattern]) => pattern.test(label))?.[1] ?? Wrench;

/** A row's state as its circle shows it (src/chat/BhippiMark.tsx). */
const dotState = (state: string): DotState => (state === 'running' || state === 'failed' || state === 'denied' || state === 'warning' ? state : 'done');

/** Seconds since `from`, ticking once a second while `on`. */
function useElapsed(from: number, on: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [on]);
  // Old saves carry list positions, not clock times; those never tick.
  return on && from > 1e12 ? Math.max(0, now - from) : 0;
}

const tone = (item: Item) => (item.kind === 'step' ? (item.done ? 'done' : 'running') : item.status);

/** Folded rows use the same partial-failure rule as the stretch summary. */
export const rowTone = (row: Row) => {
  const tones = row.members.map(tone);
  if (tones.includes('running')) return 'running';
  if (tones.includes('warning')) return 'warning';
  const failed = tones.filter((state) => state === 'failed' || state === 'denied').length;
  if (failed && failed < tones.length) return 'warning';
  if (failed) return tones.length === 1 && tones[0] === 'denied' ? 'denied' : 'failed';
  return tones[0];
};

function Detail({ item }: { item: Item }) {
  if (item.kind !== 'tool') return null;
  const failed = item.status === 'failed' || item.status === 'denied';
  if (item.request === undefined && item.result === undefined) return <pre className="wk-body-raw">{item.body}</pre>;
  return (
    <div className="wk-body">
      {item.request && (
        <div className="wk-body-part">
          <span className="wk-body-label">Asked</span>
          <pre className="wk-body-code">{item.request}</pre>
        </div>
      )}
      {item.result && (
        <div className={`wk-body-part${failed ? ' bad' : ''}`}>
          <span className="wk-body-label">{failed ? (item.status === 'denied' ? 'Not allowed' : 'Error') : 'Result'}</span>
          <div className="wk-body-text">{item.result}</div>
        </div>
      )}
    </div>
  );
}

function RowView({ row, expanded, toggle }: { row: Row; expanded: Set<string>; toggle: (key: string) => void }) {
  const { lead, members } = row;
  const folded = members.length > 1;
  const last = members[members.length - 1];
  const hasBody = folded || (lead.kind === 'tool' && !!lead.body);
  const isOpen = expanded.has(row.key);
  const state = rowTone(row);
  const ms = members.reduce((sum, item) => sum + (item.kind === 'tool' ? item.ms ?? 0 : 0), 0);
  return (
    <li className={`wk-row ${state}${isOpen ? ' open' : ''}`}>
      <span className="wk-dot"><StatusDot state={dotState(state)} /></span>
      <div className="wk-row-main">
        <button
          type="button"
          className="wk-line"
          disabled={!hasBody}
          aria-expanded={hasBody ? isOpen : undefined}
          onClick={() => toggle(row.key)}
        >
          <span className="wk-label">
            {lead.label}
            {folded && <span className="wk-times">×{members.length}</span>}
          </span>
          <span className="wk-detail">{renderDetail(last.detail)}</span>
          {ms > 400 && <span className="wk-ms">{duration(ms)}</span>}
          {hasBody && <ChevronRight size={11} className={`wk-chevron${isOpen ? ' rotate-90' : ''}`} />}
        </button>
        {isOpen && (folded ? (
          <ul className="wk-sub">
            {members.map((member) => (
              <RowView key={member.key} row={{ key: member.key, lead: member, members: [member] }} expanded={expanded} toggle={toggle} />
            ))}
          </ul>
        ) : <Detail item={lead} />)}
      </div>
    </li>
  );
}

/**
 * One stretch of work. `live` is whether the turn is still streaming *and* this is where it is
 * happening — earlier stretches of a live turn are over and read as such.
 */
export function Activity({ steps, runs, streaming }: { steps: Step[]; runs: ToolRun[]; streaming: boolean }) {
  const items = toItems(steps, runs);
  // Open while the stretch is live, so each step shows up as it starts; folded to one line once it
  // is over, so the answer comes first. A click decides it from then on.
  const [chosen, setChosen] = useState<boolean | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const running = items.filter((item) => !isOver(item)).length;
  const live = streaming && running > 0;
  const open = chosen ?? live;
  const elapsed = useElapsed(items[0]?.at ?? 0, live);
  if (items.length === 0) return null;

  const { count, failed, headline, tally, state } = summarize(items, runs, steps);
  const current = live ? [...items].reverse().find((item) => !isOver(item)) : undefined;
  const toggle = (key: string) =>
    setExpanded((keys) => {
      const next = new Set(keys);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const progress = (
    <span className="wk-head-meta">
      {count > 1 && <>{count - running} of {count}</>}
      {elapsed >= 1000 && <>{count > 1 ? ' · ' : ''}{duration(elapsed)}</>}
    </span>
  );

  return (
    <div className={`work${live ? ' live' : ''}${open ? ' open' : ''}${failed ? ' has-failed' : ''}`}>
      <button type="button" className="wk-head" aria-expanded={open} onClick={() => setChosen(!open)}>
        <StatusDot state={live ? 'running' : state} size={14} />
        {live && open ? (
          <>
            <span className="wk-headline ai-shimmer">Working</span>
            {progress}
          </>
        ) : current ? (
          <>
            <span key={current.key} className="wk-now-wrap">
              <span className="wk-now ai-shimmer">{current.label}</span>
              {current.detail && <span className="wk-now-detail">{current.detail}</span>}
            </span>
            {progress}
          </>
        ) : (
          <>
            <span className="wk-headline">{headline}</span>
            <span className="wk-head-meta">· {tally}</span>
            {failed > 0 && <span className="wk-failed">· {failed} failed</span>}
          </>
        )}
        <ChevronRight size={12} className={`wk-chevron${open ? ' rotate-90' : ''}`} />
      </button>
      <div className="wk-collapse" aria-hidden={!open}>
        <div className="wk-collapse-inner">
          <ul className="wk-list">
            {groupRows(items).map((row) => (
              <RowView key={row.key} row={row} expanded={expanded} toggle={toggle} />
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
