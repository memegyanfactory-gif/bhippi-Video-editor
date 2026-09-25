// Settings › Storage: where Bhippi keeps each project's files, and the folders inside one.
//
// Every project gets a folder under the storage root (Documents/Bhippi by default), sorted into
// categories — Downloads, Generated, Audio/Voice-overs, Roto, Exports… — so whatever the AI
// gathered or made is somewhere a person can find it. See src-tauri/src/storage.rs.
import { FolderOpen, FolderTree, HardDrive, LoaderCircle, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Toggle, useToast } from '../components/ui';
import { api, errorText, type StorageInfo } from '../lib/ipc';
import { formatBytes, registerStorageRoot, STORAGE_CATEGORIES } from '../lib/storage';
import type { Settings } from '../lib/types';

type Props = { settings: Settings; onSettings: (settings: Settings) => void };

/** Picks a new storage root and makes it the setting; answers the new info, or null if cancelled. */
export async function chooseStorageRoot(current: string | null): Promise<StorageInfo | null> {
  const picked = await api.pickFolder('Choose where Bhippi keeps your projects', current);
  if (!picked) return null;
  const info = await api.storageSetRoot(picked);
  registerStorageRoot(info.root);
  return info;
}

export function StorageSettings({ settings, onSettings }: Props) {
  const toast = useToast();
  const [info, setInfo] = useState<StorageInfo | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    void api.storageInfo().then((next) => { setInfo(next); registerStorageRoot(next.root); }).catch((error) => toast({ tone: 'error', title: 'Could not read the storage folders', body: errorText(error) }));
  }, [toast]);
  useEffect(() => refresh(), [refresh]);

  const apply = (next: StorageInfo) => {
    setInfo(next);
    onSettings({ ...settings, storageRoot: next.custom ? next.root : null });
  };

  const change = async () => {
    setBusy(true);
    try {
      const next = await chooseStorageRoot(info?.root ?? null);
      if (next) {
        apply(next);
        toast({ tone: 'success', title: 'Storage location changed', body: 'New files go there. Nothing already saved was moved.' });
      }
    } catch (error) {
      toast({ tone: 'error', title: 'Could not use that folder', body: errorText(error) });
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    try {
      const next = await api.storageSetRoot(null);
      registerStorageRoot(next.root);
      apply(next);
    } catch (error) {
      toast({ tone: 'error', title: 'Could not reset the location', body: errorText(error) });
    } finally {
      setBusy(false);
    }
  };

  const open = (category?: Parameters<typeof api.storageOpen>[0]) => {
    void api.storageOpen(category).then(refresh).catch((error) => toast({ tone: 'error', title: 'Could not open that folder', body: errorText(error) }));
  };

  const sizes = new Map(info?.categories.map((row) => [row.id, row]) ?? []);
  const total = info?.categories.reduce((sum, row) => sum + row.bytes, 0) ?? 0;

  return (
    <div className="storage-settings">
      <div className="settings-intro">
        <div>
          <h3>Storage</h3>
          <p>Each project gets its own folder, sorted by kind — everything Bhippi downloads, generates, records or exports lands in it. Settings, the media library, previews and models stay in the Bhippi data folder.</p>
        </div>
      </div>

      <section className="storage-card">
        <div className="storage-card-head">
          <HardDrive size={16} />
          <div className="storage-card-copy">
            <strong>Projects folder {info && <span className={`pill tone-${info.custom ? 'warn' : 'ok'}`}>{info.custom ? 'Custom' : 'Default'}</span>}</strong>
            <code className="path" title={info?.root}>{info?.root ?? '…'}</code>
          </div>
        </div>
        <div className="storage-card-actions">
          <button type="button" className="btn btn-primary" onClick={() => void change()} disabled={busy}>{busy ? <LoaderCircle size={14} className="spin" /> : <FolderOpen size={14} />} Change…</button>
          <button type="button" className="btn" onClick={() => open('root')}><FolderOpen size={14} /> Open</button>
          {info?.custom && <button type="button" className="btn btn-ghost" onClick={() => void reset()} disabled={busy} title={info.defaultRoot}><RotateCcw size={14} /> Use Documents\Bhippi</button>}
        </div>
      </section>

      <section className="storage-card">
        <div className="storage-card-head">
          <FolderTree size={16} />
          <div className="storage-card-copy">
            <strong>This project · {info?.projectName ?? '…'}</strong>
            <code className="path" title={info?.projectDir}>{info?.projectDir ?? '…'}</code>
          </div>
          <span className="muted small">{formatBytes(total)}</span>
          <button type="button" className="btn btn-small" onClick={() => open(null)}><FolderOpen size={12} /> Open</button>
        </div>
        <ul className="storage-tree">
          {STORAGE_CATEGORIES.map((category) => {
            const row = sizes.get(category.id);
            const depth = category.folder.split('/').length - 1;
            return (
              <li key={category.id} className={row?.exists ? 'present' : ''} style={{ paddingLeft: 10 + depth * 18 }}>
                <FolderOpen size={13} className="storage-tree-icon" />
                <span className="storage-tree-name">{category.folder.split('/').pop()}</span>
                <span className="storage-tree-blurb">{category.blurb}</span>
                <span className="storage-tree-size">{row?.exists ? formatBytes(row.bytes) : 'empty'}</span>
                <button type="button" className="icon-btn small" title={`Open ${category.folder}`} onClick={() => open(category.id)}><FolderOpen size={12} /></button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="storage-card storage-toggle">
        <div className="storage-card-copy">
          <strong>Copy imported media into the project folder</strong>
          <span className="muted small">Off: files are used where they are. On: each import is copied to Footage first, so the project folder holds everything and can be moved as one.</span>
        </div>
        <Toggle checked={settings.copyImports === true} onChange={(on) => onSettings({ ...settings, copyImports: on })} label="Copy imported media into the project folder" />
      </section>
    </div>
  );
}
