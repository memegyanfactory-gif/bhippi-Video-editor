// Settings › Brand kit › Learnings: what the kit learned from the user's references (/train), by
// area, each with where it came from. A learning can be switched off, reworded or deleted, and a
// whole training undone; everything changes the kit the AI reads.
import { Trash2, Undo2 } from 'lucide-react';
import { AREA_LABEL, LEARNING_AREAS, forgetSource, updateLearning, type TrainedKit } from '../lib/brandKit/learnings';

export function KitLearnings({ kit, onReplace }: { kit: TrainedKit; onReplace: (kit: TrainedKit) => void }) {
  const learnings = kit.learnings ?? [];
  const sources = kit.sources ?? [];
  const optIn = (
    <label className="bk-learn-optin" title="After an AI turn, when you change what it made in a way that looks like a preference (another caption style, deleting its music bed, resizing its titles), Bhippi offers to remember it for this kit. It always asks first.">
      <input type="checkbox" checked={!!kit.learnFromCorrections} onChange={(event) => onReplace({ ...kit, learnFromCorrections: event.target.checked })} /> Offer to learn from my corrections to AI edits
    </label>
  );
  if (!learnings.length && !sources.length) {
    return <>{optIn}<p className="bk-learn-empty">Nothing learned yet. In the chat, <code>/train @{kit.name.replace(/\s+/g, '')}</code> with a link, a website, images or <code>this timeline</code> teaches this kit from a reference you like.</p></>;
  }
  const sourceLabel = (id: string) => sources.find((source) => source.id === id)?.label ?? 'a reference';
  return (
    <div className="bk-learn">
      {optIn}
      {LEARNING_AREAS.map((area) => {
        const inArea = learnings.filter((learning) => learning.area === area);
        if (!inArea.length) return null;
        return (
          <div key={area} className="bk-learn-area">
            <div className="bk-learn-area-name">{AREA_LABEL[area]}</div>
            {inArea.map((learning) => (
              <div key={learning.id} className={`bk-learn-row${learning.status === 'off' ? ' off' : ''}`}>
                <input type="checkbox" checked={learning.status === 'active'} title={learning.status === 'active' ? 'In use: the AI follows it' : 'Off: kept, but the AI does not see it'}
                  onChange={(event) => onReplace(updateLearning(kit, learning.id, { status: event.target.checked ? 'active' : 'off' }))} />
                <input className="bk-learn-text" defaultValue={learning.text} aria-label={`${AREA_LABEL[area]} rule`}
                  onBlur={(event) => { const text = event.target.value.trim(); if (text && text !== learning.text) onReplace(updateLearning(kit, learning.id, { text })); }} />
                <span className="bk-learn-meta" title={learning.sourceIds.map(sourceLabel).join('\n')}>
                  {Math.round(learning.confidence * 100)}% · {learning.sourceIds.length === 1 ? sourceLabel(learning.sourceIds[0]) : `${learning.sourceIds.length} references`}
                </span>
                <button type="button" className="icon-btn small" title="Delete this learning" onClick={() => onReplace(updateLearning(kit, learning.id, null))}><Trash2 size={12} /></button>
              </div>
            ))}
          </div>
        );
      })}
      {sources.length > 0 && (
        <div className="bk-learn-sources">
          <div className="bk-learn-area-name">Trained on</div>
          {[...sources].reverse().map((source) => (
            <div key={source.id} className="bk-learn-row">
              <span className="bk-learn-text static">{source.label}</span>
              <span className="bk-learn-meta">{source.kind} · {new Date(source.addedAt).toLocaleDateString()}</span>
              <button type="button" className="btn btn-small btn-ghost" title="Remove what only this reference taught" onClick={() => onReplace(forgetSource(kit, source.id))}><Undo2 size={12} /> Undo</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
