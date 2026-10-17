// The library's left rail: the two overviews (In use, Downloaded), the categories with counts, and
// at the bottom where models are stored and what this PC can run.
import { Check, Cpu, Download, FolderOpen, HardDrive, LoaderCircle, Sparkles, Wrench } from 'lucide-react';
import type { HardwareInfo } from '../../lib/ipc';
import { formatGb, primaryVramGb } from '../../lib/modelFit';
import type { LibraryStorage } from '../../lib/modelLibrary';
import { CATEGORIES } from '../libraryShared';
import type { LibraryPage } from './shared';

type Props = {
  page: LibraryPage;
  onPage: (page: LibraryPage) => void;
  counts: Record<string, number>;
  downloaded: number;
  /** Downloads running or waiting: shown as a badge on "Downloads". */
  active?: number;
  storage: LibraryStorage | null;
  hw: HardwareInfo | null;
  changing: boolean;
  onChangeFolder: () => void;
};

export function Rail({ page, onPage, counts, downloaded, active = 0, storage, hw, changing, onChangeFolder }: Props) {
  const gpu = primaryVramGb(hw);
  const gpuName = hw ? (gpu ? gpu.name.replace(/^NVIDIA\s+(GeForce\s+)?/i, '') : 'No NVIDIA GPU') : 'This PC';
  const specs = hw ? [gpu ? `${Math.round(gpu.vramGb)} GB VRAM` : null, hw.ramGb != null ? `${Math.round(hw.ramGb)} GB RAM` : null].filter(Boolean).join(' · ') : 'Reading this computer…';
  const pcLine = `${gpuName} · ${specs}`;
  const item = (id: LibraryPage, label: string, icon: React.ReactNode, count?: number, live = false) => (
    <button key={id} type="button" className={`ml-rail-item${page === id ? ' active' : ''}`} aria-current={page === id ? 'page' : undefined} title={label} onClick={() => onPage(id)}>
      {icon}
      <span className="ml-rail-label">{label}</span>
      {count != null && <span className={`ml-rail-count${live ? ' live' : ''}`}>{count}</span>}
    </button>
  );
  return (
    <nav className="ml-rail" aria-label="Model library">
      <div className="ml-rail-list">
        {item('inuse', 'In use', <Sparkles size={15} />)}
        {item('downloaded', 'Downloaded', <Check size={15} />, downloaded)}
        {item('downloads', 'Downloads', <Download size={15} />, active > 0 ? active : undefined, true)}
        {item('engines', 'Engines', <Wrench size={15} />)}
        <hr className="ml-rail-rule" />
        {CATEGORIES.map((row) => item(row.id, row.short, <row.icon size={15} />, counts[row.id] ?? 0))}
      </div>
      <div className="ml-rail-foot">
        <div className="ml-rail-info" title={storage ? `${storage.dir}\n${formatGb(storage.freeGb)} free` : undefined}>
          <HardDrive size={14} />
          <span className="ml-rail-info-text">
            <strong>{storage ? storage.dir : 'Model storage'}</strong>
            <span>{storage ? `${formatGb(storage.freeGb)} free` : 'Reading the folder…'}</span>
          </span>
        </div>
        <button type="button" className="ml-rail-link" disabled={changing || !storage} onClick={onChangeFolder} title="Change folder">
          {changing ? <LoaderCircle size={12} className="spin" /> : <FolderOpen size={12} />}<span>Change folder</span>
        </button>
        <div className="ml-rail-info" title={pcLine}>
          <Cpu size={14} />
          <span className="ml-rail-info-text">
            <strong>{gpuName}</strong>
            <span>{specs}</span>
          </span>
        </div>
      </div>
    </nav>
  );
}
