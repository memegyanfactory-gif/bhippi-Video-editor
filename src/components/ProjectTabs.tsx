// The open projects, stacked down the left side of Bhippi: the first project at the top, the next
// below it, and so on (up to 16), each a whole editor of its own inside the window (its own undo
// history, chat, AI turns and preview: src-tauri/src/tabs.rs). Under the list, "+" starts an
// empty project and Organize shows every project at once, its chat beside its preview, inside the
// window. The column folds to icons for more room.
import { emit, listen } from '@tauri-apps/api/event';
import { ChevronsLeft, ChevronsRight, LayoutGrid, LoaderCircle, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ProjectTab, ProviderInfo, TabsState } from '../lib/types';
import { ProviderLogo } from './ProviderLogo';

type Props = {
  state: TabsState;
  /** This project's own name and state, live (its row reads them rather than the last report). */
  ownName: string;
  ownDirty: boolean;
  ownBusy: boolean;
  /** How Bhippi AI's last turn in this window's project ended, until it is looked at. */
  ownResult?: 'done' | 'error' | null;
  /** This project's AI, live, and the providers (for each row's AI name). */
  ownProvider?: string | null;
  ownModel?: string | null;
  providers?: ProviderInfo[];
  onNew: () => void;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onMove: (id: string, to: number) => void;
  onOverview: () => void;
  /** What sits at the foot of the panel (an update to download, Settings, the profile); `folded` says it is icons only. */
  footer?: (folded: boolean) => ReactNode;
};

/** One status per project, as a small dot by its AI's logo: at work, finished, or stopped by an error. */
type Status = 'working' | 'done' | 'error';
const STATUS_TEXT: Record<Status, string> = { working: 'Bhippi AI is working', done: 'Bhippi AI finished', error: 'Bhippi AI stopped with an error' };
export const tabStatus = (tab: Pick<ProjectTab, 'busy' | 'result'>): Status | null => (tab.busy ? 'working' : tab.result ?? null);

/** What a project's row reads: its name, or "New project" before it has one. */
export const tabName = (name: string) => name.trim() || 'New project';

/**
 * Folded or not is one choice for the whole app, not each project's: the list is the same list in
 * every project, so folding it in one folds it in all of them (now and next launch).
 */
const FOLDED = 'bhippi.projectsFolded';
const FOLDED_EVENT = 'bhippi://projects-folded';
const readFolded = () => {
  try {
    return localStorage.getItem(FOLDED) === 'true';
  } catch {
    return false;
  }
};

export function ProjectTabs({ state, ownName, ownDirty, ownBusy, ownResult, ownProvider, ownModel, providers = [], onNew, onActivate, onClose, onMove, onOverview, footer }: Props) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [folded, setFolded] = useState(readFolded);
  // Another project folded or unfolded the list: this one follows.
  useEffect(() => {
    const pending = listen<boolean>(FOLDED_EVENT, (event) => setFolded(event.payload));
    return () => void pending.then((unlisten) => unlisten());
  }, []);
  // Coming on screen, this project's keys go to its editor, not to a row of the list still
  // holding the keyboard from the click that left it (Space on that row would switch away again).
  const nav = useRef<HTMLElement>(null);
  const onScreen = state.own === state.active;
  useEffect(() => {
    const focused = document.activeElement;
    if (onScreen && focused instanceof HTMLElement && nav.current?.contains(focused)) focused.blur();
  }, [onScreen]);
  const full = state.tabs.length >= state.max;
  const view = (tab: ProjectTab) => (tab.id === state.own ? { ...tab, name: ownName, dirty: ownDirty, busy: ownBusy, ...(ownResult !== undefined ? { result: ownResult } : {}), ...(ownProvider !== undefined ? { providerId: ownProvider, model: ownModel ?? null } : {}) } : tab);
  /** Whose work a project is: its AI, by name and model. */
  const aiOf = (tab: ProjectTab) => (tab.providerId ? `${providers.find((row) => row.id === tab.providerId)?.label ?? tab.providerId}${tab.model ? ` · ${tab.model}` : ''}` : null);
  const fold = (value: boolean) => {
    setFolded(value);
    try {
      localStorage.setItem(FOLDED, String(value));
    } catch {
      // Without storage the column opens unfolded next time.
    }
    void emit(FOLDED_EVENT, value).catch(() => undefined);
  };
  return (
    <nav ref={nav} className={`prail${folded ? ' folded' : ''}`} aria-label="Open projects">
      <div className="prail-head">
        {!folded && <span>Projects</span>}
        <button type="button" className="prail-fold" onClick={() => fold(!folded)} title={folded ? 'Show project names' : 'Fold to icons'} aria-label={folded ? 'Show project names' : 'Fold the project list'}>
          {folded ? <ChevronsRight size={14} /> : <ChevronsLeft size={14} />}
        </button>
      </div>
      <div className="prail-list" role="tablist" aria-orientation="vertical">
        {state.tabs.map((raw, index) => {
          const tab = view(raw);
          const active = tab.id === (state.own ?? state.active);
          const ai = aiOf(tab);
          const status = tabStatus(tab);
          const label = `${tabName(tab.name)}${ai ? ` — AI: ${ai}` : ''}${tab.loading ? ' — opening…' : ''}${tab.dirty ? ' — unsaved changes' : ''}${status ? ` — ${STATUS_TEXT[status]}` : ''}`;
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              className={`prail-item${active ? ' active' : ''}${dragging === tab.id ? ' dragging' : ''}`}
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
              onClick={(event) => {
                // The row does not keep the keyboard: Space is play/pause, for the project on screen.
                event.currentTarget.blur();
                if (!active) onActivate(tab.id);
              }}
              onAuxClick={(event) => {
                // Middle click closes, as in a browser.
                if (event.button === 1) {
                  event.preventDefault();
                  onClose(tab.id);
                }
              }}
              onKeyDown={(event) => {
                // Enter opens the project; Space stays play/pause (it used to switch projects).
                if (event.key === 'Enter' && !active) onActivate(tab.id);
              }}
            >
              <span className="prail-state" aria-hidden>
                {tab.loading ? <LoaderCircle size={13} className="spin" /> : <span className="prail-number">{index + 1}</span>}
                {/* Corner marks never take room of their own, so nothing in the row moves when they come and go. */}
                {tab.dirty && <span className="prail-unsaved" />}
                {folded && status && <span className={`prail-dot ${status}`} />}
              </span>
              {!folded && <span className="prail-name">{tabName(tab.name)}</span>}
              {!folded && (
                <span className="prail-ai" aria-hidden>
                  {tab.providerId && <ProviderLogo id={tab.providerId} size={13} />}
                  {status && <span className={`prail-dot ${status}`} />}
                </span>
              )}
              {!folded && (
                <button
                  type="button"
                  className="prail-close"
                  aria-label={`Close ${tabName(tab.name)}`}
                  title="Close project (Ctrl+W)"
                  onClick={(event) => {
                    event.stopPropagation();
                    onClose(tab.id);
                  }}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <button type="button" className="prail-action" onClick={onNew} disabled={full} title={full ? `${state.max} projects are open, the most at once. Close one to open another.` : 'New empty project (Ctrl+Shift+N)'} aria-label="New project">
        <Plus size={15} />
        {!folded && <span>New project</span>}
      </button>
      <button type="button" className={`prail-action${state.overview ? ' active' : ''}`} onClick={onOverview} title="Organize: every open project at once, its chat beside its preview (Ctrl+Alt+O)" aria-label="Organize all projects" aria-pressed={state.overview}>
        <LayoutGrid size={14} />
        {!folded && <span>Organize</span>}
      </button>
      {footer && <div className="prail-foot">{footer(folded)}</div>}
    </nav>
  );
}
