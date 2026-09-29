// Under an answer that trained a brand kit (/train → train_brand_kit): what the kit learned from
// that reference, to review. Each learning can be removed, and the whole training undone; the
// kit is read live, so the card always shows what is really in it now.
import { GraduationCap, Undo2, X } from 'lucide-react';
import { AREA_LABEL, forgetSource, updateLearning, type TrainedKit } from '../lib/brandKit/learnings';

export function TrainingCard({ kit, sourceId, onChange }: { kit: TrainedKit | undefined; sourceId: string; onChange: (kitId: string, change: (kit: TrainedKit) => TrainedKit) => void }) {
  if (!kit) return <div className="training-card muted">The brand kit this trained is gone.</div>;
  const source = (kit.sources ?? []).find((entry) => entry.id === sourceId);
  const taught = (kit.learnings ?? []).filter((learning) => learning.sourceIds.includes(sourceId));
  if (!source) return <div className="training-card muted"><GraduationCap size={13} /> Training undone: “{kit.name}” no longer learns from this reference.</div>;
  return (
    <div className="training-card">
      <div className="training-head">
        <GraduationCap size={13} />
        <span>“{kit.name}” learned {taught.length} thing{taught.length === 1 ? '' : 's'} from {source.label}</span>
        <button type="button" className="btn btn-small btn-ghost" onClick={() => onChange(kit.id, (current) => forgetSource(current, sourceId))} title="Remove everything this reference taught (rules other references also taught stay)">
          <Undo2 size={12} /> Undo training
        </button>
      </div>
      <ul>
        {taught.map((learning) => (
          <li key={learning.id} className={learning.status === 'off' ? 'off' : ''}>
            <span className="training-area">{AREA_LABEL[learning.area]}</span>
            <span className="training-text">{learning.text}{learning.sourceIds.length > 1 ? <em> · {learning.sourceIds.length} references agree</em> : null}</span>
            <button type="button" className="icon-btn small" title="Remove this learning" onClick={() => onChange(kit.id, (current) => updateLearning(current, learning.id, null))}><X size={12} /></button>
          </li>
        ))}
      </ul>
    </div>
  );
}
