// New Project (and the first save of an unsaved project): a name and a location, and the project
// gets a folder of its own there, `<location>/<name>/Project/<name>.bhippi`, before any work goes
// in. A folder already in use is refused, so two projects never share footage, downloads, the AI's
// documents or its work folder.
import { FolderOpen } from 'lucide-react';
import { useState } from 'react';
import { Modal } from '../components/ui';
import { api, errorText } from '../lib/ipc';
import { projectFolderName } from '../lib/storage';

/** The location the last new project went into, offered first next time. */
const LAST_PARENT = 'bhippi.newProjectParent';

export function rememberedProjectParent(): string | null {
  try {
    return localStorage.getItem(LAST_PARENT);
  } catch {
    return null;
  }
}

type Props = {
  title: string;
  /** The button that makes the folder: "Create", "Save". */
  action: string;
  name: string;
  /** Where the project folder goes, to start with. */
  parent: string;
  onClose: () => void;
  /** The .bhippi path made for it (its folder exists and is empty) and the project's name. */
  onCreate: (path: string, name: string) => void;
};

export function NewProjectDialog({ title, action, name: startName, parent: startParent, onClose, onCreate }: Props) {
  const [name, setName] = useState(startName);
  const [parent, setParent] = useState(startParent);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const folder = projectFolderName(name.trim());
  const separator = parent.includes('\\') || !parent.includes('/') ? '\\' : '/';

  const browse = async () => {
    const picked = await api.pickFolder('Choose where to keep the project', parent || null);
    if (!picked) return;
    setParent(picked);
    setError(null);
  };

  const submit = async () => {
    if (busy) return;
    if (!name.trim()) return setError('Give the project a name.');
    if (!parent) return setError('Choose where to keep it.');
    setBusy(true);
    try {
      const path = await api.storageNewProject(parent, name.trim());
      try {
        localStorage.setItem(LAST_PARENT, parent);
      } catch {
        // Storage blocked: next time starts from the storage root again.
      }
      onCreate(path, folder);
    } catch (reason) {
      setError(errorText(reason));
      setBusy(false);
    }
  };

  return (
    <Modal title={title} onClose={onClose} width={520} footer={
      <>
        <div className="toolbar-spacer" />
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void submit()}>{action}</button>
      </>
    }>
      <div className="dialog-body">
        <label className="field">
          <span>Project name</span>
          <input value={name} autoFocus onFocus={(event) => event.target.select()}
            onChange={(event) => { setName(event.target.value); setError(null); }}
            onKeyDown={(event) => event.key === 'Enter' && void submit()} />
        </label>
        <div className="field">
          <span>Location</span>
          <div className="field-inline">
            <div className="path" title={parent}>{parent || 'Choose a folder…'}</div>
            <button type="button" className="btn btn-small" onClick={() => void browse()}><FolderOpen size={13} /> Browse…</button>
          </div>
          <em className="field-hint">
            {parent && name.trim() ? `Its files go in ${parent.replace(/[\\/]+$/, '')}${separator}${folder}` : 'The project gets a folder of its own here.'}
          </em>
        </div>
        {error && <p className="field-error">{error}</p>}
      </div>
    </Modal>
  );
}
