// Export: any comp, in any container, at a recommended size — Premiere-style.
import { save } from '@tauri-apps/plugin-dialog';
import { videoDir } from '@tauri-apps/api/path';
import { Film, FolderOpen } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Modal } from '../components/ui';
import { api } from '../lib/ipc';
import { safeFileName, timecode } from '../lib/editor';
import { channelForFormat, describeExport, findFormat, formatForChannel, outputSize, recommendResolution, withExtension, EXPORT_FORMATS, RESOLUTION_PRESETS } from '../lib/exportPresets';
import { compDuration } from '../lib/timeline';
import type { Comp, ExportEncoder, ExportFormat, ExportOptions, ExportPrefs, Project, ToolStatus } from '../lib/types';

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

export function ExportDialog({ project, comp: initial, prefs, onClose, onExport }: Props) {
  const [compId, setCompId] = useState(initial.id);
  const comp = project.comps.find((entry) => entry.id === compId) ?? initial;
  const [format, setFormat] = useState<ExportFormat>((prefs.format as ExportFormat) ?? 'mp4');
  const [channel, setChannel] = useState<'rgb' | 'rgba'>(prefs.channel ?? channelForFormat((prefs.format as ExportFormat) ?? 'mp4') ?? 'rgb');
  const [name, setName] = useState(`${safeFileName(comp.name || project.name)}.${findFormat((prefs.format as ExportFormat) ?? 'mp4').ext}`);
  const [folder, setFolder] = useState(prefs.folder ?? '');
  const [resolution, setResolution] = useState<number | null>(prefs.resolution ?? recommendResolution(comp).short);
  const [fps, setFps] = useState<number | null>(prefs.fps ?? null);
  const [quality, setQuality] = useState<ExportOptions['quality']>((prefs.quality as ExportOptions['quality']) ?? 'standard');
  const [inToOut, setInToOut] = useState(false);
  const [encoder, setEncoder] = useState<ExportEncoder>(prefs.encoder ?? 'auto');
  // Read fresh: detection runs in the background at launch and may finish after the app loads.
  const [tools, setTools] = useState<ToolStatus | null>(null);
  useEffect(() => { void api.appInfo().then((info) => setTools(info.ffmpeg)).catch(() => undefined); }, []);
  const gpuLabel = tools?.gpuEncoderLabel ?? null;
  const h264 = format === 'mp4' || format === 'mov';
  const ranged = comp.inPoint !== null && comp.outPoint !== null && comp.outPoint > comp.inPoint;
  const total = compDuration(comp);
  const length = inToOut && ranged ? (comp.outPoint ?? 0) - (comp.inPoint ?? 0) : total;
  const def = findFormat(format);
  const recommendation = recommendResolution(comp);
  const [width, height] = outputSize(comp.width, comp.height, resolution);

  useEffect(() => {
    if (folder) return;
    // The project's Exports folder by default; the system Videos folder if that is unavailable.
    void api.storageDir('exports').then(setFolder).catch(() => videoDir().then(setFolder)).catch(() => undefined);
  }, [folder]);

  const pickFormat = (id: ExportFormat) => {
    setFormat(id);
    const next = channelForFormat(id);
    if (next) setChannel(next);
    setName((current) => withExtension(current.replace(/\.[a-z0-9]+$/i, ''), findFormat(id).ext));
  };

  const pickChannel = (next: 'rgb' | 'rgba') => {
    setChannel(next);
    pickFormat(formatForChannel(next));
  };

  const pickComp = (id: string) => {
    const next = project.comps.find((entry) => entry.id === id);
    if (!next) return;
    setCompId(id);
    setResolution(recommendResolution(next).short);
    setName(`${safeFileName(next.name || project.name)}.${def.ext}`);
  };

  const submit = () => {
    const file = withExtension(name, def.ext);
    const separator = folder.includes('/') && !folder.includes('\\') ? '/' : '\\';
    onExport({ output: folder ? `${folder.replace(/[\\/]+$/, '')}${separator}${file}` : file, compId: comp.id, resolution, fps, quality, inToOut: inToOut && ranged, format, encoder }, folder);
  };

  const pickFolder = async () => {
    const picked = await save({ title: 'Export media', defaultPath: folder ? `${folder}\\${name}` : name, filters: [{ name: `${def.label} (${def.ext})`, extensions: [def.ext] }] });
    if (!picked) return;
    const cut = Math.max(picked.lastIndexOf('\\'), picked.lastIndexOf('/'));
    setFolder(picked.slice(0, cut));
    setName(picked.slice(cut + 1));
  };

  return (
    <Modal title="Export Media" onClose={onClose} width={600} footer={
      <>
        <span className="muted">{timecode(length, comp.fps)} · {describeExport(comp, format, resolution, fps)}</span>
        <div className="toolbar-spacer" />
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={submit} disabled={!name.trim() || total <= 0}><Film size={14} /> Export</button>
      </>
    }>
      <div className="export-form">
        <label className="field">
          <span>Comp to render</span>
          <select value={compId} onChange={(event) => pickComp(event.target.value)}>
            {project.comps.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · {entry.width}×{entry.height} · {entry.fps} fps</option>)}
          </select>
        </label>
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
        <div className="field">
          <span>Format</span>
          <select value={format} onChange={(event) => pickFormat(event.target.value as ExportFormat)}>
            {EXPORT_FORMATS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          <small className="muted">{def.blurb} — {def.recommends}</small>
        </div>
        {(format === 'mov' || format === 'mov-alpha') && (
          <div className="field">
            <span>Channel</span>
            <div className="segmented">
              <button type="button" className={channel === 'rgb' ? 'active' : ''} onClick={() => pickChannel('rgb')}>RGB</button>
              <button type="button" className={channel === 'rgba' ? 'active' : ''} onClick={() => pickChannel('rgba')} title="ProRes 4444 — transparency in the comp survives the export">RGB + Alpha</button>
            </div>
            {channel === 'rgba' && <small className="muted">ProRes 4444 keeps transparency. Plain footage has none — build the comp over empty space (or a transparent item) for see-through MOVs.</small>}
          </div>
        )}
        <div className="field-row">
          <label className="field">
            <span>Resolution</span>
            <select value={resolution ?? ''} onChange={(event) => setResolution(event.target.value ? Number(event.target.value) : null)}>
              {RESOLUTION_PRESETS.map((item) => <option key={item.label} value={item.short ?? ''}>{item.short === null ? `Match source (${width}×${height})` : item.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Frame rate</span>
            <select value={fps ?? ''} onChange={(event) => setFps(event.target.value ? Number(event.target.value) : null)}>
              {RATES.map((rate) => <option key={rate ?? 'comp'} value={rate ?? ''}>{rate ? `${rate} fps` : `Comp rate (${comp.fps})`}</option>)}
            </select>
          </label>
        </div>
        <small className="muted">{recommendation.note} Output: {width}×{height}.</small>
        {!def.video && <small className="muted">Audio-only: no picture is rendered; length follows the comp.</small>}
        <div className="field">
          <span>Quality</span>
          <div className="quality-options">
            {QUALITIES.map((item) => (
              <button key={item.id} type="button" className={`quality${quality === item.id ? ' active' : ''}`} onClick={() => setQuality(item.id)}>
                <strong>{item.label}</strong>
                <span>{format === 'mp3' ? `MP3 ${item.id === 'draft' ? '128' : item.id === 'standard' ? '192' : '320'} kbps` : item.hint}</span>
              </button>
            ))}
          </div>
        </div>
        {h264 && (
          <div className="field">
            <span>Encoder</span>
            <div className="segmented wide">
              <button type="button" className={encoder !== 'cpu' ? 'active' : ''} onClick={() => setEncoder('auto')} disabled={!gpuLabel} title={gpuLabel ? `Hardware H.264 on ${gpuLabel}; falls back to the CPU if the GPU encode fails` : 'No working GPU encoder was found'}>GPU{gpuLabel ? ` · ${gpuLabel}` : ''}</button>
              <button type="button" className={encoder === 'cpu' || !gpuLabel ? 'active' : ''} onClick={() => setEncoder('cpu')}>CPU · {tools && !tools.x264 ? 'MPEG-4' : 'x264'}</button>
            </div>
            <small className="muted">{gpuLabel ? (encoder === 'cpu' ? 'x264 on the processor: slowest, smallest files at the same quality.' : `Encodes on the graphics card (${tools?.gpuEncoder}) — several times faster; retried on the CPU automatically if it fails.`) : tools ? 'No GPU encoder works on this machine; x264 on the processor is used.' : 'Checking for a GPU encoder…'}</small>
          </div>
        )}
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
