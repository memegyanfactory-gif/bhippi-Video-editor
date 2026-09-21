// What the assistant actually did during a turn, in one collapsible block.
//
// Two streams arrive while a turn runs: the steps the model announces ("Reading the comp", "Cutting
// the top") and the tool calls Helios runs on its behalf. Showing them as two flat lists meant a
// finished answer was buried under a wall of past activity, and — worse — a call that was still
// running looked exactly like one that had finished, because a row only appeared once it was over.
//
// So: one list, in the order things happened, each row carrying its own state. It opens itself
// while the turn is live so the work is visible, and folds away to a single line once the answer is
// there, the way Claude and Codex do it. Any row can be opened for what was asked and what came
// back; nothing is thrown away, it is only folded.
import { Check, ChevronRight, CircleSlash, LoaderCircle, TriangleAlert, Wrench } from 'lucide-react';
import { useEffect, useState } from 'react';

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
};

/** A step the model announced. */
export type Step = { id: string; verb: string; title: string; detail: string; done: boolean; at: number };

export type Item =
  | { kind: 'step'; key: string; at: number; label: string; detail: string; done: boolean }
  | { kind: 'tool'; key: string; at: number; label: string; detail: string; body: string; status: ToolRun['status']; ms: number | null };

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
      label: titleCase(run.name),
      detail: run.status === 'running' ? run.request : run.summary || run.request,
      body: [run.request && `Asked: ${run.request}`, run.summary && `Result: ${run.summary}`].filter(Boolean).join('\n'),
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
      label: 'Inspect clip frames', detail: `${completed} batches completed${active ? ' · inspecting…' : ''}${failed ? ` · ${failed} failed` : ''}`,
      body: inspections.map((run, index) => `${index + 1}. ${run.status}: ${run.request}\n${run.summary}`).join('\n\n'),
      status: active ? 'running' as const : failed ? 'failed' as const : 'done' as const,
      ms: inspections.reduce((sum, run) => sum + (run.ms ?? 0), 0),
    }].sort((one, two) => one.at - two.at);
  }
  return items.sort((one, two) => one.at - two.at);
}

const icon = (item: Item) => {
  if (item.kind === 'step') return item.done ? <Check size={11} /> : <LoaderCircle size={11} className="spin" />;
  if (item.status === 'running') return <LoaderCircle size={11} className="spin" />;
  if (item.status === 'failed') return <TriangleAlert size={11} />;
  if (item.status === 'denied') return <CircleSlash size={11} />;
  return <Check size={11} />;
};

const tone = (item: Item) =>
  item.kind === 'step' ? (item.done ? 'done' : 'running') : item.status;

export function Activity({ steps, runs, streaming }: { steps: Step[]; runs: ToolRun[]; streaming: boolean }) {
  const items = toItems(steps, runs);
  // Open while the turn is live, folded once it is done — unless the reader has said otherwise, in
  // which case their choice stands for the rest of the conversation.
  const [open, setOpen] = useState(streaming);
  const [touched, setTouched] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  useEffect(() => {
    if (!touched) setOpen(streaming);
  }, [streaming, touched]);

  if (items.length === 0) return null;

  const running = items.filter((item) => tone(item) === 'running').length;
  const failed = items.filter((item) => item.kind === 'tool' && (item.status === 'failed' || item.status === 'denied')).length;
  const tools = runs.length;
  const elapsed = runs.reduce((total, run) => total + (run.ms ?? 0), 0);
  const current = [...items].reverse().find((item) => tone(item) === 'running');

  const headline = running
    ? current?.label ?? 'Working'
    : `${tools > 0 ? `${tools} tool${tools === 1 ? '' : 's'}` : `${items.length} step${items.length === 1 ? '' : 's'}`}${elapsed > 400 ? ` · ${(elapsed / 1000).toFixed(1)}s` : ''}`;

  return (
    <div className={`activity${running ? ' busy' : ''}`}>
      <button
        type="button"
        className="act-head"
        aria-expanded={open}
        onClick={() => {
          setTouched(true);
          setOpen((value) => !value);
        }}
      >
        <span className="act-head-icon">{running ? <LoaderCircle size={12} className="spin" /> : <Wrench size={12} />}</span>
        <span className="act-headline">{headline}</span>
        {running > 0 && <span className="act-count">{items.length - running} of {items.length}</span>}
        {failed > 0 && <span className="act-bad">{failed} failed</span>}
        <ChevronRight size={12} className={`act-chevron${open ? ' rotate-90' : ''}`} />
      </button>

      {open && (
        <div className="act-list">
          {items.map((item) => {
            const body = item.kind === 'tool' ? item.body : '';
            const isOpen = expanded === item.key;
            return (
              <div key={item.key} className={`act-item ${tone(item)}`}>
                <button
                  type="button"
                  className="act-row"
                  disabled={!body}
                  aria-expanded={body ? isOpen : undefined}
                  onClick={() => setExpanded(isOpen ? null : item.key)}
                >
                  <span className="act-icon">{icon(item)}</span>
                  <span className="act-label">{item.label}</span>
                  <span className="act-detail">{item.detail}</span>
                  {item.kind === 'tool' && item.ms !== null && item.ms > 400 && <span className="act-ms">{(item.ms / 1000).toFixed(1)}s</span>}
                  {body && <ChevronRight size={10} className={`act-chevron${isOpen ? ' rotate-90' : ''}`} />}
                </button>
                {isOpen && body && <pre className="act-body">{body}</pre>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
