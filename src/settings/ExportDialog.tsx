// Export: any comp, in any delivery or mastering format, from a preset or by hand — the Export
// Settings of Premiere / Media Encoder. Presets on the left with the output and a live summary
// (size estimate included); the format's own settings on the right: codec profile, resolution and
// frame rate, bitrate mode, bit depth, keyframes, GPU or CPU, audio codec settings and loudness.
import { save } from '@tauri-apps/plugin-dialog';
import { videoDir } from '@tauri-apps/api/path';
import { Bookmark, Film, FolderOpen, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../components/ui';
import { api } from '../lib/ipc';
import { safeFileName, timecode, uid } from '../lib/editor';
import {
  applyPreset, BUILT_IN_PRESETS, estimateAudioKbps, estimateBytes, estimateVideoMbps, EXPORT_FORMATS, findFormat, FORMAT_GROUPS, formatBytes,
  LOUDNESS_TARGETS, matchesPreset, outputSize, recommendResolution, RESOLUTION_PRESETS, toOptions, withExtension,
} from '../lib/exportPresets';
import { compDuration } from '../lib/timeline';
import type { Comp, ExportFormat, ExportOptions, ExportPrefs, ExportSettings, Project, SavedExportPreset, ToolStatus } from '../lib/types';

const RATES = [null, 23.976, 24, 25, 29.97, 30, 50, 59.94, 60];
const KEYFRAMES = [null, 0.5, 1, 2, 5, 10];
const AUDIO_BITRATES = [96, 128, 160, 192, 256, 320];

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
  onExport: (options: ExportOptions, folder: string, preset: string | null) => void;
  /** Saves preset changes straight away (they outlive this export). */
  onPrefs?: (patch: Partial<ExportPrefs>) => void;
};

/** What the dialog opens with: the last export's settings, or the old single-field prefs. */
function initialSettings(prefs: ExportPrefs): ExportSettings {
  if (prefs.last) return applyPreset(prefs.last);
  return applyPreset({
    ...(prefs.format ? { format: prefs.format } : {}),
    ...(prefs.resolution !== undefined ? { resolution: prefs.resolution } : {}),
    ...(prefs.fps !== undefined ? { fps: prefs.fps } : {}),
    ...(prefs.quality ? { quality: prefs.quality as ExportOptions['quality'] } : {}),
    ...(prefs.encoder ? { encoder: prefs.encoder } : {}),
  });
}

export function ExportDialog({ project, comp: initial, prefs, onClose, onExport, onPrefs }: Props) {
  const [compId, setCompId] = useState(initial.id);
  const comp = project.comps.find((entry) => entry.id === compId) ?? initial;
  const [settings, setSettings] = useState<ExportSettings>(() => initialSettings(prefs));
  const [presetId, setPresetId] = useState<string>(prefs.preset ?? (prefs.last ? '' : 'match-high'));
  const [custom, setCustom] = useState<SavedExportPreset[]>(prefs.presets ?? []);
  const [naming, setNaming] = useState<string | null>(null);
  const def = findFormat(settings.format);
  const [name, setName] = useState(`${safeFileName(comp.name || project.name)}.${def.ext}`);
  const [folder, setFolder] = useState(prefs.folder ?? '');
  const [inToOut, setInToOut] = useState(false);
  // Read fresh: detection runs in the background at launch and may finish after the app loads.
  const [tools, setTools] = useState<ToolStatus | null>(null);
  useEffect(() => { void api.appInfo().then((info) => setTools(info.ffmpeg)).catch(() => undefined); }, []);

  useEffect(() => {
    if (folder) return;
    // The project's Exports folder by default; the system Videos folder if that is unavailable.
    void api.storageDir('exports').then(setFolder).catch(() => videoDir().then(setFolder)).catch(() => undefined);
  }, [folder]);

  const ranged = comp.inPoint !== null && comp.outPoint !== null && comp.outPoint > comp.inPoint;
  const total = compDuration(comp);
  const length = inToOut && ranged ? (comp.outPoint ?? 0) - (comp.inPoint ?? 0) : total;
  const [width, height] = outputSize(comp.width, comp.height, def.video ? settings.resolution : null);
  const fps = settings.fps ?? comp.fps;
  const recommendation = recommendResolution(comp);
  const available = (id: ExportFormat) => !tools?.formats || tools.formats.includes(id);
  const gpuFor = (format: ExportFormat): string | null => {
    const kind = findFormat(format).gpu;
    if (!kind || !tools?.gpuEncoderLabel) return null;
    if (kind === 'h264') return tools.gpuEncoderLabel;
    if (kind === 'hevc') return tools.gpuHevc ? tools.gpuEncoderLabel : null;
    return tools.gpuAv1 ? tools.gpuEncoderLabel : null;
  };
  const gpuLabel = gpuFor(settings.format);
  const onGpu = !!gpuLabel && settings.encoder !== 'cpu';
  const rate = def.rateControl ? settings.rateControl ?? 'quality' : 'quality';
  const twoPassable = rate === 'vbr' && ['mp4', 'mov', 'hevc', 'webm'].includes(settings.format);

  const update = (patch: Partial<ExportSettings>) => setSettings((current) => applyPreset({ ...current, ...patch }));
  const pickFormat = (id: ExportFormat) => {
    const next = findFormat(id);
    update({ format: id, ...(next.id === 'gif' && !settings.fps ? { fps: 15 } : {}) });
    setName((current) => withExtension(current.replace(/\.[a-z0-9]+$/i, ''), next.ext));
  };
  const pickPreset = (id: string) => {
    setPresetId(id);
    const preset = BUILT_IN_PRESETS.find((entry) => entry.id === id)?.settings ?? custom.find((entry) => `custom:${entry.id}` === id)?.settings;
    if (!preset) return;
    const next = applyPreset(preset);
    setSettings(next);
    setName((current) => withExtension(current.replace(/\.[a-z0-9]+$/i, ''), findFormat(next.format).ext));
  };
  const presetSettings = BUILT_IN_PRESETS.find((entry) => entry.id === presetId)?.settings ?? custom.find((entry) => `custom:${entry.id}` === presetId)?.settings;
  const modified = !!presetSettings && !matchesPreset(settings, presetSettings);
  const savePreset = () => {
    const label = (naming ?? '').trim();
    if (!label) return;
    const preset: SavedExportPreset = { id: uid(), label: label.slice(0, 60), settings: { ...settings } };
    const next = [...custom, preset];
    setCustom(next);
    setPresetId(`custom:${preset.id}`);
    setNaming(null);
    onPrefs?.({ presets: next });
  };
  const deletePreset = () => {
    const next = custom.filter((entry) => `custom:${entry.id}` !== presetId);
    setCustom(next);
    setPresetId('');
    onPrefs?.({ presets: next });
  };

  const pickComp = (id: string) => {
    const next = project.comps.find((entry) => entry.id === id);
    if (!next) return;
    setCompId(id);
    setName(`${safeFileName(next.name || project.name)}.${def.ext}`);
  };

  const bitrateError = rate === 'quality' ? null
    : !settings.bitrate || settings.bitrate < 0.1 || settings.bitrate > 500 ? 'Enter a bitrate of 0.1–500 Mbit/s'
    : rate === 'vbr' && settings.maxBitrate && settings.maxBitrate < settings.bitrate ? 'The maximum must be at least the target'
    : null;

  const submit = () => {
    const file = withExtension(name, def.ext);
    const separator = folder.includes('/') && !folder.includes('\\') ? '/' : '\\';
    const output = folder ? `${folder.replace(/[\\/]+$/, '')}${separator}${file}` : file;
    onExport(toOptions(settings, output, comp.id, inToOut && ranged), folder, presetId || null);
  };

  const pickFolder = async () => {
    const picked = await save({ title: 'Export media', defaultPath: folder ? `${folder}\\${name}` : name, filters: [{ name: `${def.label} (${def.ext})`, extensions: [def.ext] }] });
    if (!picked) return;
    const cut = Math.max(picked.lastIndexOf('\\'), picked.lastIndexOf('/'));
    setFolder(picked.slice(0, cut));
    setName(picked.slice(cut + 1));
  };

  const estimate = useMemo(() => estimateBytes(settings, width, height, fps, length), [settings, width, height, fps, length]);
  const videoLine = def.video
    ? `${def.profiles ? def.profiles.find((p) => p.id === settings.profile)?.label ?? def.label : def.label}${def.bitDepth && settings.bitDepth === 10 ? ' 10-bit' : ''} · ${width}×${height} · ${fps} fps · ${
      def.rateControl ? (rate === 'quality' ? `constant quality (${settings.quality})` : `${rate.toUpperCase()} ${settings.bitrate ?? '?'} Mbit/s${rate === 'vbr' && settings.twoPass ? ' · 2-pass' : ''}`) : `≈${Math.round(estimateVideoMbps(settings, width, height, fps))} Mbit/s`
    }${def.gpu ? (onGpu ? ` · GPU (${gpuLabel})` : ' · CPU') : ''}`
    : null;
  const audioLine = def.audio
    ? `${{ aac: 'AAC', opus: 'Opus', mp3: 'MP3', flac: 'FLAC', pcm16: 'PCM 16-bit', pcm24: 'PCM 24-bit' }[def.audio]}${['aac', 'opus', 'mp3'].includes(def.audio) ? ` ${Math.round(estimateAudioKbps(settings))} kbit/s` : ''} · ${((settings.sampleRate ?? 48000) / 1000).toFixed(1).replace('.0', '')} kHz${settings.loudness ? ` · normalised to ${settings.loudness} LUFS` : ''}`
    : 'No audio';
  const chaptersPossible = ['mp4', 'mov', 'webm', 'm4a'].includes(def.ext) && comp.markers.length > 0;

  return (
    <Modal title="Export Settings" onClose={onClose} width={900} footer={
      <>
        <span className="muted">{timecode(length, comp.fps)} · ≈{formatBytes(estimate)}</span>
        <div className="toolbar-spacer" />
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={submit} disabled={!name.trim() || total <= 0 || !!bitrateError || !available(settings.format)}><Film size={14} /> Export</button>
      </>
    }>
      <div className="export-cols">
        <div className="export-col">
          <div className="field">
            <span>Preset</span>
            <div className="field-inline">
              <select value={presetId} onChange={(event) => pickPreset(event.target.value)} aria-label="Preset">
                {!presetId && <option value="">Custom settings</option>}
                {(['Social & streaming', 'Masters', 'Web', 'Audio'] as const).map((group) => (
                  <optgroup key={group} label={group}>
                    {BUILT_IN_PRESETS.filter((preset) => preset.group === group).map((preset) => <option key={preset.id} value={preset.id} disabled={!available(applyPreset(preset.settings).format)}>{preset.label}</option>)}
                  </optgroup>
                ))}
                {custom.length > 0 && <optgroup label="My presets">{custom.map((preset) => <option key={preset.id} value={`custom:${preset.id}`}>{preset.label}</option>)}</optgroup>}
              </select>
              {presetId.startsWith('custom:') && <button type="button" className="icon-btn" title="Delete this preset" onClick={deletePreset}><Trash2 size={13} /></button>}
            </div>
            <small className="muted">{modified ? 'Modified — ' : ''}{BUILT_IN_PRESETS.find((preset) => preset.id === presetId)?.hint ?? (presetId.startsWith('custom:') ? 'Your saved preset.' : 'Settings of your last export.')}</small>
            {naming === null
              ? <button type="button" className="btn btn-small export-save-preset" onClick={() => setNaming('')}><Bookmark size={12} /> Save as preset…</button>
              : <div className="field-inline"><input autoFocus placeholder="Preset name" value={naming} maxLength={60} onChange={(event) => setNaming(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') savePreset(); if (event.key === 'Escape') setNaming(null); }} /><button type="button" className="btn btn-small" disabled={!naming.trim()} onClick={savePreset}>Save</button></div>}
          </div>
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
          <div className="export-summary" aria-label="Export summary">
            <div className="export-summary-row"><span>Format</span><strong>{def.label}</strong></div>
            {videoLine && <div className="export-summary-row"><span>Video</span><span>{videoLine}</span></div>}
            <div className="export-summary-row"><span>Audio</span><span>{audioLine}</span></div>
            <div className="export-summary-row"><span>Length</span><span>{timecode(length, comp.fps)}{inToOut && ranged ? ' (In to Out)' : ''}</span></div>
            <div className="export-summary-row"><span>Estimated size</span><strong>≈{formatBytes(estimate)}</strong></div>
            <small className="muted">{def.recommends}</small>
          </div>
        </div>

        <div className="export-col">
          <section className="export-section">
            <h3>{def.video ? 'Video' : 'Format'}</h3>
            <label className="field">
              <span>Format</span>
              <select value={settings.format} onChange={(event) => pickFormat(event.target.value as ExportFormat)}>
                {FORMAT_GROUPS.map((group) => (
                  <optgroup key={group} label={group}>
                    {EXPORT_FORMATS.filter((format) => format.group === group).map((format) => <option key={format.id} value={format.id} disabled={!available(format.id)}>{format.label}{available(format.id) ? '' : ' — not in this FFmpeg'}</option>)}
                  </optgroup>
                ))}
              </select>
              <small className="muted">{def.blurb}</small>
            </label>
            {def.profiles && (
              <label className="field">
                <span>Profile</span>
                <select value={settings.profile ?? def.profiles[0].id} onChange={(event) => update({ profile: event.target.value })}>
                  {def.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
                </select>
                <small className="muted">{def.profiles.find((profile) => profile.id === settings.profile)?.hint}</small>
              </label>
            )}
            {def.alphaOptional && (
              <label className="export-check"><input type="checkbox" checked={!!settings.alpha} onChange={(event) => update({ alpha: event.target.checked })} /> Keep transparency (alpha channel)</label>
            )}
            {def.video && (
              <>
                <div className="field-row">
                  <label className="field">
                    <span>Resolution</span>
                    <select value={settings.resolution ?? ''} onChange={(event) => update({ resolution: event.target.value ? Number(event.target.value) : null })}>
                      {RESOLUTION_PRESETS.map((item) => <option key={item.label} value={item.short ?? ''}>{item.short === null ? `Match source (${comp.width}×${comp.height})` : item.label}</option>)}
                    </select>
                  </label>
                  <label className="field">
                    <span>Frame rate</span>
                    <select value={settings.fps ?? ''} onChange={(event) => update({ fps: event.target.value ? Number(event.target.value) : null })}>
                      {RATES.map((value) => <option key={value ?? 'comp'} value={value ?? ''}>{value ? `${value} fps` : `Comp rate (${comp.fps})`}</option>)}
                    </select>
                  </label>
                </div>
                <small className="muted">{recommendation.note} Output: {width}×{height}.</small>
              </>
            )}
            {def.bitDepth && (
              <div className="field">
                <span>Bit depth</span>
                <div className="segmented">
                  <button type="button" className={settings.bitDepth !== 10 ? 'active' : ''} onClick={() => update({ bitDepth: 8 })}>8-bit</button>
                  <button type="button" className={settings.bitDepth === 10 ? 'active' : ''} onClick={() => update({ bitDepth: 10 })} title="Smoother gradients, no banding in skies and glows">10-bit</button>
                </div>
              </div>
            )}
            {def.gpu && (
              <div className="field">
                <span>Encoder</span>
                <div className="segmented wide">
                  <button type="button" className={onGpu ? 'active' : ''} onClick={() => update({ encoder: 'auto', twoPass: false })} disabled={!gpuLabel} title={gpuLabel ? `Hardware encoding on ${gpuLabel}; falls back to the CPU if it fails` : 'No GPU encoder for this codec on this machine'}>GPU{gpuLabel ? ` · ${gpuLabel}` : ''}</button>
                  <button type="button" className={!onGpu ? 'active' : ''} onClick={() => update({ encoder: 'cpu' })}>CPU · {{ h264: tools && !tools.x264 ? 'MPEG-4' : 'x264', hevc: 'x265', av1: 'SVT-AV1' }[def.gpu]}</button>
                </div>
                <small className="muted">{onGpu ? 'Several times faster; retried on the CPU automatically if the GPU encode fails.' : gpuLabel ? 'Slowest, and the smallest files at the same quality.' : tools ? 'No GPU encoder for this codec here; the CPU is used.' : 'Checking for a GPU encoder…'}</small>
              </div>
            )}
          </section>

          {def.video && (def.rateControl || def.id === 'gif' || def.id === 'avi') && (
            <section className="export-section">
              <h3>Bitrate</h3>
              {def.rateControl && (
                <div className="segmented wide">
                  <button type="button" className={rate === 'quality' ? 'active' : ''} onClick={() => update({ rateControl: 'quality' })} title="Every frame gets the bits it needs (CRF / CQ)">Constant quality</button>
                  <button type="button" className={rate === 'vbr' ? 'active' : ''} onClick={() => update({ rateControl: 'vbr', bitrate: settings.bitrate ?? 16, maxBitrate: settings.maxBitrate ?? 24 })} title="A target average, allowed to peak">VBR</button>
                  <button type="button" className={rate === 'cbr' ? 'active' : ''} onClick={() => update({ rateControl: 'cbr', bitrate: settings.bitrate ?? 12 })} title="The same bitrate throughout (live ingest, broadcast)">CBR</button>
                </div>
              )}
              {rate === 'quality' ? (
                <div className="quality-options">
                  {QUALITIES.map((item) => (
                    <button key={item.id} type="button" className={`quality${settings.quality === item.id ? ' active' : ''}`} onClick={() => update({ quality: item.id })}>
                      <strong>{item.label}</strong>
                      <span>{item.hint}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <>
                  <div className="field-row">
                    <label className="field">
                      <span>{rate === 'vbr' ? 'Target' : 'Bitrate'} (Mbit/s)</span>
                      <input type="number" min={0.1} max={500} step={0.5} value={settings.bitrate ?? ''} onChange={(event) => update({ bitrate: event.target.value ? Number(event.target.value) : null })} />
                    </label>
                    {rate === 'vbr' && (
                      <label className="field">
                        <span>Maximum (Mbit/s)</span>
                        <input type="number" min={0.1} max={500} step={0.5} value={settings.maxBitrate ?? ''} placeholder={settings.bitrate ? String(settings.bitrate * 1.5) : ''} onChange={(event) => update({ maxBitrate: event.target.value ? Number(event.target.value) : null })} />
                      </label>
                    )}
                  </div>
                  {bitrateError && <small className="field-error" role="alert">{bitrateError}</small>}
                  {twoPassable && (
                    <label className="export-check">
                      <input type="checkbox" checked={!!settings.twoPass} onChange={(event) => update({ twoPass: event.target.checked, ...(event.target.checked ? { encoder: 'cpu' as const } : {}) })} />
                      Two-pass encoding <span className="muted">— analyses first, then spends the bits where they show. Runs on the CPU, about twice as long.</span>
                    </label>
                  )}
                </>
              )}
              {def.rateControl && (
                <label className="field">
                  <span>Keyframe every</span>
                  <select value={settings.keyframeInterval ?? ''} onChange={(event) => update({ keyframeInterval: event.target.value ? Number(event.target.value) : null })}>
                    {KEYFRAMES.map((value) => <option key={value ?? 'auto'} value={value ?? ''}>{value ? `${value} s` : 'Automatic'}</option>)}
                  </select>
                  <small className="muted">Shorter makes scrubbing and streaming start faster; longer makes files smaller.</small>
                </label>
              )}
            </section>
          )}

          {def.audio && (
            <section className="export-section">
              <h3>Audio</h3>
              <div className="field-row">
                {['aac', 'opus', 'mp3'].includes(def.audio) && (
                  <label className="field">
                    <span>Bitrate</span>
                    <select value={settings.audioBitrate ?? ''} onChange={(event) => update({ audioBitrate: event.target.value ? Number(event.target.value) : null })}>
                      <option value="">By quality ({settings.quality === 'draft' ? 128 : settings.quality === 'standard' ? 192 : 320} kbit/s)</option>
                      {AUDIO_BITRATES.map((kbps) => <option key={kbps} value={kbps}>{kbps} kbit/s</option>)}
                    </select>
                  </label>
                )}
                <label className="field">
                  <span>Sample rate</span>
                  <select value={settings.sampleRate ?? 48000} onChange={(event) => update({ sampleRate: Number(event.target.value) as 44100 | 48000 | 96000 })}>
                    <option value={48000}>48 kHz (video)</option>
                    <option value={44100}>44.1 kHz (music, podcasts)</option>
                    {def.audio.startsWith('pcm') || def.audio === 'flac' ? <option value={96000}>96 kHz</option> : null}
                  </select>
                </label>
              </div>
              <div className="field">
                <span>Loudness normalisation</span>
                <div className="segmented wide export-loudness">
                  {LOUDNESS_TARGETS.map((target) => (
                    <button key={target.label} type="button" className={(settings.loudness ?? null) === target.value ? 'active' : ''} onClick={() => update({ loudness: target.value })} title={target.hint}>{target.label}</button>
                  ))}
                </div>
                <small className="muted">{settings.loudness ? `Measured first, then one linear gain to ${settings.loudness} LUFS with peaks under −1 dBTP — ${LOUDNESS_TARGETS.find((t) => t.value === settings.loudness)?.hint}.` : 'The mix plays exactly as you set it.'}</small>
              </div>
            </section>
          )}

          <section className="export-section">
            <h3>Range</h3>
            <div className="segmented wide">
              <button type="button" className={!inToOut ? 'active' : ''} onClick={() => setInToOut(false)}>Entire comp</button>
              <button type="button" className={inToOut ? 'active' : ''} onClick={() => setInToOut(true)} disabled={!ranged} title={ranged ? 'Only the In to Out range' : 'Mark In and Out in the timeline first'}>In to Out</button>
            </div>
            {chaptersPossible && (
              <label className="export-check"><input type="checkbox" checked={settings.chapters !== false} onChange={(event) => update({ chapters: event.target.checked })} /> Timeline markers as chapters ({comp.markers.length})</label>
            )}
          </section>
        </div>
      </div>
    </Modal>
  );
}

