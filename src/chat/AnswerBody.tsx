// The body of an assistant turn: its words and the work between them, in the order they happened.
//
// Turns saved before the words were kept in segments have no timestamps to interleave by, so they
// read the way they always did: the work first, folded, then the answer.
import { Markdown } from '../components/Markdown';
import { Activity, toTimeline, type Block, type Step, type TextSegment, type ToolRun } from './Activity';
import { foldToolEcho } from './toolEcho';
import '../styles/chat-messages.css';

type Props = {
  content: string;
  segments?: TextSegment[];
  steps: Step[];
  runs: ToolRun[];
  streaming: boolean;
  /** The thinking toggle is already saying the model is busy; the dots would say it twice. */
  thinking: boolean;
};

export function blocksFor(content: string, segments: TextSegment[] | undefined, steps: Step[], runs: ToolRun[]): Block[] {
  if (segments?.length) return toTimeline(segments, steps, runs);
  const blocks: Block[] = [];
  if (steps.length || runs.length) blocks.push({ kind: 'work', key: 'w-all', steps, runs });
  if (content.trim()) blocks.push({ kind: 'text', key: 'x-all', text: content });
  return blocks;
}

export function AnswerBody({ content, segments, steps, runs, streaming, thinking }: Props) {
  const blocks = blocksFor(content, segments, steps, runs);
  const last = blocks[blocks.length - 1];
  const busy = runs.some((run) => run.status === 'running') || steps.some((step) => !step.done);
  // Waiting on the model between steps: nothing is running and no words are coming yet.
  const waiting = streaming && !busy && (!last || last.kind === 'work') && !(thinking && !last);
  return (
    <div className="answer">
      {blocks.map((block, index) =>
        block.kind === 'work' ? (
          <Activity key={block.key} steps={block.steps} runs={block.runs} streaming={streaming} />
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
    </div>
  );
}
