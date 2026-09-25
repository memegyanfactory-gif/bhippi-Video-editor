// The body of an assistant turn: its words and the work between them, in the order they happened.
//
// Turns saved before the words were kept in segments have no timestamps to interleave by, so they
// read the way they always did: the work first, folded, then the answer.
import { CornerDownRight } from 'lucide-react';
import { Markdown } from '../components/Markdown';
import { Activity, toTimeline, type Block, type Interjection, type Step, type TextSegment, type ToolRun } from './Activity';
import { foldToolEcho } from './toolEcho';
import '../styles/chat-messages.css';

type Props = {
  content: string;
  segments?: TextSegment[];
  steps: Step[];
  runs: ToolRun[];
  /** Messages the user sent while this turn worked. */
  steers?: Interjection[];
  streaming: boolean;
  /** The thinking toggle is already saying the model is busy; the dots would say it twice. */
  thinking: boolean;
  /** Takes back a message that has not reached the turn yet. */
  onDropSteer?: (id: string) => void;
};

export function blocksFor(content: string, segments: TextSegment[] | undefined, steps: Step[], runs: ToolRun[], steers: Interjection[] = []): Block[] {
  // Only the ones the model has read have a place in the timeline; the rest wait at the end.
  const read = steers.filter((item) => item.state === 'delivered');
  const blocks: Block[] = segments?.length ? toTimeline(segments, steps, runs, read) : [];
  if (!segments?.length) {
    if (steps.length || runs.length) blocks.push({ kind: 'work', key: 'w-all', steps, runs });
    if (content.trim()) blocks.push({ kind: 'text', key: 'x-all', text: content });
    blocks.push(...read.map((steer): Block => ({ kind: 'steer', key: `s-${steer.id}`, steer })));
  }
  return blocks;
}

const STEER_STATE: Record<Interjection['state'], string> = {
  waiting: 'Reaches Bhippi at its next step',
  delivered: 'Added to the plan',
  next: 'Sent as the next message',
};

function SteerNote({ steer, onDrop }: { steer: Interjection; onDrop?: (id: string) => void }) {
  return (
    <div className={`steer-note ${steer.state}`}>
      <div className="steer-bubble">{steer.text}</div>
      <div className="steer-state">
        <CornerDownRight size={11} />
        <span>{STEER_STATE[steer.state]}</span>
        {steer.state === 'waiting' && onDrop && (
          <button type="button" onClick={() => onDrop(steer.id)} title="Do not send this">Cancel</button>
        )}
      </div>
    </div>
  );
}

export function AnswerBody({ content, segments, steps, runs, steers = [], streaming, thinking, onDropSteer }: Props) {
  const blocks = blocksFor(content, segments, steps, runs, steers);
  const pending = steers.filter((item) => item.state !== 'delivered');
  const last = blocks[blocks.length - 1];
  const busy = runs.some((run) => run.status === 'running') || steps.some((step) => !step.done);
  // Waiting on the model between steps: nothing is running and no words are coming yet.
  const waiting = streaming && !busy && (!last || last.kind !== 'text') && !(thinking && !last);
  return (
    <div className="answer">
      {blocks.map((block, index) =>
        block.kind === 'work' ? (
          <Activity key={block.key} steps={block.steps} runs={block.runs} streaming={streaming} />
        ) : block.kind === 'steer' ? (
          <SteerNote key={block.key} steer={block.steer} />
        ) : (
          <div key={block.key} className={`answer-seg${streaming && index === blocks.length - 1 ? ' live' : ''}`}>
            <Markdown text={foldToolEcho(block.text.trim())} live={streaming && index === blocks.length - 1} />
          </div>
        ),
      )}
      {waiting && (
        <div className="typing" aria-label="Writing">
          <span />
          <span />
          <span />
        </div>
      )}
      {pending.map((steer) => <SteerNote key={steer.id} steer={steer} onDrop={onDropSteer} />)}
    </div>
  );
}
