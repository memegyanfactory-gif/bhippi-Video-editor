// File › Restore from Backup…: the open project's autosaved versions (a new one at most every five
// minutes, the newest 20 kept, plus the rolling last-minute copy), newest first. Restoring loads
// one into the open project as a single undo step; the project file itself is untouched until saved.
import { History, LoaderCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Modal } from '../components/ui';
import { api } from '../lib/ipc';

type Backup = { path: string; savedAt: string; size: number; rolling: boolean };

const when = (iso: string) => {
  const date = new Date(iso);
  const minutes = Math.round((Date.now() - date.getTime()) / 60000);
  const ago = minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : minutes < 1440 ? `${Math.round(minutes / 60)} h ago` : `${Math.round(minutes / 1440)} days ago`;
  return `${date.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${ago}`;
};

export function RestoreBackupDialog({ projectName, onRestore, onClose }: { projectName: string; onRestore: (path: string) => void; onClose: () => void }) {
  const [backups, setBackups] = useState<Backup[] | null>(null);
  useEffect(() => {
    void api.projectBackups(projectName).then(setBackups).catch(() => setBackups([]));
  }, [projectName]);
  return (
    <Modal title="Restore from backup" onClose={onClose} width={460}>
      <div className="dialog-body">
        {backups === null ? (
          <div className="backup-empty"><LoaderCircle size={14} className="spin" /> Looking for backups…</div>
        ) : backups.length === 0 ? (
          <div className="backup-empty">No backups of “{projectName}” yet. Bhippi keeps one every five minutes while you work.</div>
        ) : (
          <ol className="backup-list">
            {backups.map((backup) => (
              <li key={backup.path}>
                <History size={13} />
                <span className="backup-when">{when(backup.savedAt)}{backup.rolling ? ' (latest autosave)' : ''}</span>
                <button type="button" className="btn btn-small" onClick={() => onRestore(backup.path)} title="Load this version into the project (Ctrl+Z undoes it)">Restore</button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Modal>
  );
}
