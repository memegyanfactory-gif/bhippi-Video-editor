// Edit › History…: every undo step of the session, oldest first, with the present marked. Clicking a
// step goes back (or forward) to just after it, as Premiere's History panel does. AI turns show as
// one step each, named after what was asked.
import { Bot } from 'lucide-react';
import { Modal } from '../components/ui';

type Steps = { past: string[]; present: string; future: string[] };

export function HistoryDialog({ steps, onJump, onClose }: { steps: Steps; onJump: (steps: number) => void; onClose: () => void }) {
  const rows = [...steps.past, steps.present, ...steps.future];
  const now = steps.past.length;
  return (
    <Modal title="History" onClose={onClose} width={420}>
      <ol className="history-list">
        {rows.map((label, index) => (
          <li key={index}>
            <button type="button" className={`history-step${index === now ? ' current' : ''}${index > now ? ' undone' : ''}`}
              disabled={index === now}
              onClick={() => onJump(index - now)}
              title={index < now ? 'Go back to just after this step' : index > now ? 'Redo up to this step' : 'Where the project is now'}>
              {label.startsWith('AI: ') ? <Bot size={12} /> : <span className="history-dot" />}
              <span>{label.startsWith('AI: ') ? label.slice(4) : label}</span>
            </button>
          </li>
        ))}
      </ol>
    </Modal>
  );
}
