// Export: the comp, the range, the format, and where the file goes.
import { save } from '@tauri-apps/plugin-dialog';
import { videoDir } from '@tauri-apps/api/path';
import { Film, FolderOpen } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Modal } from '../components/ui';
import { safeFileName, timecode } from '../lib/editor';
import { compDuration } from '../lib/timeline';
import type { Comp, ExportOptions, ExportPrefs, Project } from '../lib/types';

const RESOLUTIONS = [
  { value: null, label: 'Comp size' },
  { value: 2160, label: '2160p · 4K' },
  { value: 1440, label: '1440p' },
  { value: 1080, label: '1080p' },
  { value: 720, label: '720p' },
  { value: 540, label: '540p' },
  { value: 480, label: '480p' },
  { value: 360, label: '360p' },
];

const RATES = [null, 24, 25, 30, 50, 60];

const QUALITIES: { id: ExportOptions['quality']; label: string; hint: string }[] = [
  { id: 'draft', label: 'Draft', hint: 'Fastest, larger artefacts' },
  { id: 'standard', label: 'Standard', hint: 'Good for social and YouTube' },
  { id: 'high', label: 'High', hint: 'Slowest, best detail' },
];

type Props = {
  project: Project;
  comp: Comp;
  prefs: ExportPrefs;
  onClose: () => void;
  onExport: (options: ExportOptions, folder: string) => void;
};

export function ExportDialog({ project, comp, prefs, onClose, onExport }: Props) {
  const [name, setName] = useState(`${safeFileName(comp.name || project.name)}.mp4`);
  const [folder, setFolder] = useState(prefs.folder ?? '');
  const [resolution, setResolution] = useState<number | null>(prefs.resolution ?? null);
  const [fps, setFps] = useState<number | null>(prefs.fps ?? null);
  const [quality, setQuality] = useState<ExportOptions['quality']>((prefs.quality as ExportOptions['quality']) ?? 'standard');
  const [inToOut, setInToOut] = useState(false);
  const ranged = comp.inPoint !== null && comp.outPoint !== null && comp.outPoint > comp.inPoint;
  const total = compDuration(comp);
  const length = inToOut && ranged ? (comp.outPoint ?? 0) - (comp.inPoint ?? 0) : total;

  useEffect(() => {
    if (folder) return;
    void videoDir().then(setFolder).catch(() => undefined);
  }, [folder]);

  const height = resolution ?? Math.min(comp.width, comp.height);
  const scale = height / Math.min(comp.width, comp.height);
  const outWidth = Math.round((comp.width * scale) / 2) * 2;
  const outHeight = Math.round((comp.height * scale) / 2) * 2;

  const submit = () => {
    const file = name.trim().toLowerCase().endsWith('.mp4') ? name.trim() : `${name.trim() || 'export'}.mp4`;
    const separator = folder.includes('/') && !folder.includes('\\') ? '/' : '\\';
    onExport({ output: folder ? `${folder.replace(/[\\/]+$/, '')}${separator}${file}` : file, compId: comp.id, resolution, fps, quality, inToOut: inToOut && ranged }, folder);
  };

  const pickFolder = async () => {
    const picked = await save({ title: 'Export video', defaultPath: folder ? `${folder}\\${name}` : name, filters: [{ name: 'MP4 video', extensions: ['mp4'] }] });
    if (!picked) return;
    const cut = Math.max(picked.lastIndexOf('\\'), picked.lastIndexOf('/'));
    setFolder(picked.slice(0, cut));
    setName(picked.slice(cut + 1));
  };

  return (
    <Modal title="Export Media" onClose={onClose} width={560} footer={
      <>
        <span className="muted">{timecode(length, comp.fps)} · {outWidth}×{outHeight} · {fps ?? comp.fps} fps</span>
        <div className="toolbar-spacer" />
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={submit} disabled={!name.trim() || total <= 0}><Film size={14} /> Export</button>
      </>
    }>
      <div className="export-form">
        <div className="field">
          <span>Comp</span>
          <div className="export-summary"><Film size={13} /> {comp.name} · {comp.width}×{comp.height} · {comp.fps} fps · {timecode(total, comp.fps)}</div>
        </div>
        <label className="field">
          <span>File name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <div className="field">
          <span>Location</span>
          <div className="field-inline">
            <div className="path" title={folder}>{folder || 'Choose a folder…'}</div>
            <button type="button" className="btn btn-small" onClick={() => void pickFolder()}><FolderOpen size={13} /> Browse…</button>
          </div>
        </div>
        <div className="field-row">
          <label className="field">
            <span>Format</span>
            <select value="h264" disabled><option value="h264">H.264 · MP4 (AAC audio)</option></select>
          </label>
          <label className="field">
            <span>Resolution</span>
            <select value={resolution ?? ''} onChange={(event) => setResolution(event.target.value ? Number(event.target.value) : null)}>
              {RESOLUTIONS.map((item) => <option key={item.label} value={item.value ?? ''}>{item.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Frame rate</span>
            <select value={fps ?? ''} onChange={(event) => setFps(event.target.value ? Number(event.target.value) : null)}>
              {RATES.map((rate) => <option key={rate ?? 'comp'} value={rate ?? ''}>{rate ? `${rate} fps` : `Comp rate (${comp.fps})`}</option>)}
            </select>
          </label>
        </div>
        <div className="field">
          <span>Quality</span>
          <div className="quality-options">
            {QUALITIES.map((item) => (
              <button key={item.id} type="button" className={`quality${quality === item.id ? ' active' : ''}`} onClick={() => setQuality(item.id)}>
                <strong>{item.label}</strong>
                <span>{item.hint}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span>Range</span>
          <div className="segmented wide">
            <button type="button" className={!inToOut ? 'active' : ''} onClick={() => setInToOut(false)}>Entire comp</button>
            <button type="button" className={inToOut ? 'active' : ''} onClick={() => setInToOut(true)} disabled={!ranged} title={ranged ? 'Only the In to Out range' : 'Mark In and Out in the timeline first'}>In to Out</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
