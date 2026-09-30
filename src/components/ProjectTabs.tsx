// The open projects as tabs across the middle of the header, the way a browser shows pages: one
// per project (up to 16), each its own window with its own undo history, chat and preview (the
// backend's tabs.rs). "+" opens an empty project in a new tab; the grid button shows every
// project's chat beside its preview at once.
import { LayoutGrid, LoaderCircle, Plus, X } from 'lucide-react';
import { useState } from 'react';
import type { ProjectTab, TabsState } from '../lib/types';

type Props = {
  state: TabsState;
  /** This window's own project, live (its tab reads it rather than the last report). */
  ownName: string;
  ownDirty: boolean;
  ownBusy: boolean;
  onNew: () => void;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onMove: (id: string, to: number) => void;
  onOverview: () => void;
};

/** What a tab reads: the project's name, or "New project" before it has one. */
export const tabName = (name: string) => name.trim() || 'New project';

export function ProjectTabs({ state, ownName, ownDirty, ownBusy, onNew, onActivate, onClose, onMove, onOverview }: Props) {
  const [dragging, setDragging] = useState<string | null>(null);
  const full = state.tabs.length >= state.max;
  const view = (tab: ProjectTab) => (tab.id === state.own ? { ...tab, name: ownName, dirty: ownDirty, busy: ownBusy } : tab);
  return (
    <div className="ptabs" role="tablist" aria-label="Open projects">
      {state.tabs.map((raw, index) => {
        const tab = view(raw);
        const active = tab.id === (state.own ?? state.active);
        const label = `${tabName(tab.name)}${tab.dirty ? ' — unsaved changes' : ''}${tab.busy ? ' — Bhippi AI is working' : ''}`;
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            className={`ptab${active ? ' active' : ''}${dragging === tab.id ? ' dragging' : ''}`}
            title={tab.projectPath ? `${label}\n${tab.projectPath}` : label}
            draggable
            onDragStart={(event) => {
              setDragging(tab.id);
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/x-bhippi-tab', tab.id);
            }}
            onDragEnd={() => setDragging(null)}
            onDragOver={(event) => {
              if (dragging && dragging !== tab.id) event.preventDefault();
            }}
            onDrop={(event) => {
              event.preventDefault();
              const id = event.dataTransfer.getData('text/x-bhippi-tab');
              if (id && id !== tab.id) onMove(id, index);
              setDragging(null);
            }}
            onClick={() => !active && onActivate(tab.id)}
            onAuxClick={(event) => {
              // Middle click closes, as in a browser.
              if (event.button === 1) {
                event.preventDefault();
                onClose(tab.id);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') onActivate(tab.id);
            }}
          >
            <span className="ptab-state" aria-hidden>
              {tab.busy ? <LoaderCircle size={12} className="spin" /> : <img src="/bhippi.png" alt="" width={13} height={13} />}
            </span>
            <span className="ptab-name">{tabName(tab.name)}</span>
            {tab.dirty && <span className="ptab-dirty" aria-hidden>•</span>}
            <button
              type="button"
              className="ptab-close"
              aria-label={`Close ${tabName(tab.name)}`}
              title="Close tab (Ctrl+W)"
              onClick={(event) => {
                event.stopPropagation();
                onClose(tab.id);
              }}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
      <button type="button" className="ptab-new" onClick={onNew} disabled={full} title={full ? `${state.max} projects are open, the most at once. Close one to open another.` : 'New project in a new tab (Ctrl+T)'} aria-label="New project tab">
        <Plus size={15} />
      </button>
      <button type="button" className={`ptab-overview${state.overview ? ' active' : ''}`} onClick={onOverview} title="See every open project's chat beside its preview, all at once" aria-label="Overview of all projects" aria-pressed={state.overview}>
        <LayoutGrid size={14} />
      </button>
    </div>
  );
}
