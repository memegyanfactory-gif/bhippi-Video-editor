// The dialogs behind the menus: comp and item settings, Speed/Duration, Audio Gain, Audio
// Channels, Frame Hold, Field Options, Paste Attributes, markers, Synchronize, Scene Edit
// Detection, clip properties and the shortcut list.
import { useEffect, useState } from 'react';
import { Modal, ColorSwatches } from '../components/ui';
import { bytes, clamp, gainToDb, parseTimecode, timecode } from '../lib/editor';
import { CAPTION_STYLES } from '../lib/captionStyles';
import { COMP_PRESETS, FRAME_RATES, ITEM_LABEL, compDuration, tracksOf } from '../lib/timeline';
import type { AttributeSet } from '../lib/timeline';
import type { Asset, Clip, Comp, ItemKind, Marker, Project, ProjectItem } from '../lib/types';

const Field = ({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) => (
  <label className="field">
    <span>{label}</span>
    {children}
    {hint && <em className="field-hint">{hint}</em>}
  </label>
);

export type CompDraft = { name: string; width: number; height: number; fps: number };

export function CompDialog({ title, draft, onClose, onSubmit }: { title: string; draft: CompDraft; onClose: () => void; onSubmit: (draft: CompDraft) => void }) {
  const [value, setValue] = useState(draft);
  const preset = COMP_PRESETS.find((item) => item.width === value.width && item.height === value.height);
  return (
    <Modal title={title} onClose={onClose} width={460} footer={
      <>
        <div className="toolbar-spacer" />
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={() => onSubmit({ ...value, name: value.name.trim() || 'Comp' })}>OK</button>
      </>
    }>
      <div className="dialog-body">
        <Field label="Comp name"><input value={value.name} autoFocus onChange={(event) => setValue({ ...value, name: event.target.value })} onKeyDown={(event) => event.key === 'Enter' && onSubmit({ ...value, name: value.name.trim() || 'Comp' })} /></Field>
        <Field label="Frame size">
          <select value={preset?.id ?? 'custom'} onChange={(event) => {
            const chosen = COMP_PRESETS.find((item) => item.id === event.target.value);
            if (chosen) setValue({ ...value, width: chosen.width, height: chosen.height });
          }}>
            {COMP_PRESETS.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.width}×{item.height}</option>)}
            {!preset && <option value="custom">Custom</option>}
          </select>
        </Field>
        <div className="field-row">
          <Field label="Width"><input type="number" min={16} max={8192} value={value.width} onChange={(event) => setValue({ ...value, width: clamp(Number(event.target.value), 16, 8192) })} /></Field>
          <Field label="Height"><input type="number" min={16} max={8192} value={value.height} onChange={(event) => setValue({ ...value, height: clamp(Number(event.target.value), 16, 8192) })} /></Field>
          <Field label="Frame rate">
            <select value={value.fps} onChange={(event) => setValue({ ...value, fps: Number(event.target.value) })}>
              {FRAME_RATES.map((rate) => <option key={rate} value={rate}>{rate} fps</option>)}
            </select>
          </Field>
        </div>
      </div>
    </Modal>
  );
}

export type ItemDraft = { kind: ItemKind; name: string; color: string; duration: number; width: number; height: number };

export function ItemDialog({ draft, onClose, onSubmit }: { draft: ItemDraft; onClose: () => void; onSubmit: (draft: ItemDraft) => void }) {
  const [value, setValue] = useState(draft);
  const colored = value.kind === 'color-matte' || value.kind === 'countdown';
  return (
    <Modal title={`New ${ITEM_LABEL[value.kind]}`} onClose={onClose} width={440} footer={
      <>
        <div className="toolbar-spacer" />
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={() => onSubmit({ ...value, name: value.name.trim() || ITEM_LABEL[value.kind] })}>OK</button>
      </>
    }>
      <div className="dialog-body">
        <Field label="Name"><input value={value.name} autoFocus onChange={(event) => setValue({ ...value, name: event.target.value })} /></Field>
        {colored && <Field label={value.kind === 'countdown' ? 'Number colour' : 'Colour'}><ColorSwatches value={value.color} onChange={(color) => setValue({ ...value, color })} /></Field>}
        <div className="field-row">
          <Field label="Width"><input type="number" min={16} max={8192} value={value.width} onChange={(event) => setValue({ ...value, width: clamp(Number(event.target.value), 16, 8192) })} /></Field>
          <Field label="Height"><input type="number" min={16} max={8192} value={value.height} onChange={(event) => setValue({ ...value, height: clamp(Number(event.target.value), 16, 8192) })} /></Field>
          <Field label="Duration" hint={value.kind === 'countdown' ? 'counts down from here' : 'seconds when placed'}>
            <input type="number" min={0.1} max={3600} step={0.5} value={value.duration} onChange={(event) => setValue({ ...value, duration: clamp(Number(event.target.value), 0.1, 3600) })} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

export type SpeedDraft = { speed: number; duration: number; linked: boolean; reverse: boolean; maintainPitch: boolean; ripple: boolean; interpolation: Clip['interpolation'] };

export function SpeedDialog({ clip, comp, onClose, onSubmit }: { clip: Clip; comp: Comp; onClose: () => void; onSubmit: (draft: SpeedDraft) => void }) {
  const [value, setValue] = useState<SpeedDraft>({ speed: clip.speed * 100, duration: clip.duration, linked: true, reverse: clip.reverse, maintainPitch: clip.maintainPitch, ripple: false, interpolation: clip.interpolation });
  const sourceLength = clip.duration * clip.speed;
  const setSpeed = (percent: number) => {
    const speed = clamp(percent, 5, 2000);
    setValue((current) => ({ ...current, speed, duration: current.linked ? sourceLength / (speed / 100) : current.duration }));
  };
  const setDuration = (seconds: number) => {
    const duration = Math.max(1 / comp.fps, seconds);
    setValue((current) => ({ ...current, duration, speed: current.linked ? (sourceLength / duration) * 100 : current.speed }));
  };
  return (
    <Modal title="Speed / Duration" onClose={onClose} width={420} footer={
      <>
        <div className="toolbar-spacer" />
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={() => onSubmit(value)}>OK</button>
      </>
    }>
      <div className="dialog-body">
        <div className="field-row">
          <Field label="Speed"><input type="number" min={5} max={2000} step={5} value={Math.round(value.speed)} autoFocus onChange={(event) => setSpeed(Number(event.target.value))} /></Field>
          <Field label="Duration"><input value={timecode(value.duration, comp.fps)} onChange={(event) => { const parsed = parseTimecode(event.target.value, comp.fps); if (parsed !== null) setDuration(parsed); }} /></Field>
          <button type="button" className={`link-toggle${value.linked ? ' on' : ''}`} onClick={() => setValue({ ...value, linked: !value.linked })} title="Link speed and duration">⛓</button>
        </div>
        <label className="check"><input type="checkbox" checked={value.reverse} onChange={(event) => setValue({ ...value, reverse: event.target.checked })} /> Reverse Speed</label>
        <label className="check"><input type="checkbox" checked={value.maintainPitch} onChange={(event) => setValue({ ...value, maintainPitch: event.target.checked })} /> Maintain Audio Pitch</label>
        <label className="check"><input type="checkbox" checked={value.ripple} onChange={(event) => setValue({ ...value, ripple: event.target.checked })} /> Ripple Edit, Shifting Trailing Clips</label>
        <Field label="Time Interpolation">
          <select value={value.interpolation} onChange={(event) => setValue({ ...value, interpolation: event.target.value as Clip['interpolation'] })}>
            <option value="sampling">Frame Sampling</option>
            <option value="blending">Frame Blending</option>
            <option value="optical-flow">Optical Flow</option>
          </select>
        </Field>
      </div>
    </Modal>
  );
}

export type GainDraft = { mode: 'set' | 'adjust' | 'normalizeMax' | 'normalizeAll'; db: number };

export function AudioGainDialog({ clips, onClose, onSubmit }: { clips: Clip[]; onClose: () => void; onSubmit: (draft: GainDraft) => void }) {
  const [value, setValue] = useState<GainDraft>({ mode: 'set', db: clips.length === 1 ? Math.round(gainToDb(clips[0].volume) * 10) / 10 : 0 });
  const options: [GainDraft['mode'], string][] = [['set', 'Set Gain to'], ['adjust', 'Adjust Gain by'], ['normalizeMax', 'Normalize Max Peak to'], ['normalizeAll', 'Normalize All Peaks to']];
  return (
    <Modal title="Audio Gain" onClose={onClose} width={420} footer={
      <>
        <div className="toolbar-spacer" />
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={() => onSubmit(value)}>OK</button>
      </>
    }>
      <div className="dialog-body">
        {options.map(([mode, label]) => (
          <label key={mode} className="check radio">
            <input type="radio" checked={value.mode === mode} onChange={() => setValue({ ...value, mode })} /> {label}
            {value.mode === mode && <input className="inline-number" type="number" step={0.1} autoFocus value={value.db} onChange={(event) => setValue({ ...value, db: Number(event.target.value) })} />} dB
          </label>
        ))}
        <p className="dialog-note">{clips.length} clip{clips.length === 1 ? '' : 's'} selected. Normalizing measures the loudest peak of each clip's media and sets its gain to match.</p>
      </div>
    </Modal>
  );
}

export function ChannelsDialog({ clip, onClose, onSubmit }: { clip: Clip; onClose: () => void; onSubmit: (channels: Clip['channels']) => void }) {
  const [value, setValue] = useState(clip.channels);
  const options: [Clip['channels'], string][] = [['stereo', 'Stereo — left and right as recorded'], ['mono', 'Mono — both channels summed to the centre'], ['left', 'Left only on both sides'], ['right', 'Right only on both sides'], ['swap', 'Swap left and right']];
  return (
    <Modal title="Audio Channels" onClose={onClose} width={440} footer={
      <>
        <div className="toolbar-spacer" />
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={() => onSubmit(value)}>OK</button>
      </>
    }>
      <div className="dialog-body">
        {options.map(([mode, label]) => (
          <label key={mode} className="check radio"><input type="radio" checked={value === mode} onChange={() => setValue(mode)} /> {label}</label>
        ))}
      </div>
    </Modal>
  );
}

export type HoldDraft = { at: 'playhead' | 'in' | 'out'; filters: boolean };

export function FrameHoldDialog({ clip, comp, onClose, onSubmit }: { clip: Clip; comp: Comp; onClose: () => void; onSubmit: (draft: HoldDraft) => void }) {
  const [value, setValue] = useState<HoldDraft>({ at: clip.hold !== null ? 'in' : 'playhead', filters: true });
  return (
    <Modal title="Frame Hold Options" onClose={onClose} width={420} footer={
      <>
        <button type="button" className="btn btn-ghost" onClick={() => onSubmit({ at: 'playhead', filters: true })} disabled={clip.hold === null}>Remove hold</button>
        <div className="toolbar-spacer" />
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={() => onSubmit(value)}>OK</button>
      </>
    }>
      <div className="dialog-body">
        <p className="dialog-note">Freezes the whole clip on one frame. {clip.hold !== null ? `Currently held at ${timecode(clip.hold, comp.fps)}.` : ''}</p>
        {([['playhead', 'Playhead'], ['in', 'Source In'], ['out', 'Source Out']] as const).map(([mode, label]) => (
          <label key={mode} className="check radio"><input type="radio" checked={value.at === mode} onChange={() => setValue({ ...value, at: mode })} /> Hold On {label}</label>
        ))}
        <label className="check"><input type="checkbox" checked={value.filters} onChange={(event) => setValue({ ...value, filters: event.target.checked })} /> Hold Filters (keep effects and keyframes frozen too)</label>
      </div>
    </Modal>
  );
}

export function FieldOptionsDialog({ clip, onClose, onSubmit }: { clip: Clip; onClose: () => void; onSubmit: (deinterlace: boolean) => void }) {
  const [value, setValue] = useState(clip.deinterlace);
  return (
    <Modal title="Field Options" onClose={onClose} width={420} footer={
      <>
        <div className="toolbar-spacer" />
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={() => onSubmit(value)}>OK</button>
      </>
    }>
      <div className="dialog-body">
        <label className="check radio"><input type="radio" checked={!value} onChange={() => setValue(false)} /> None — the footage is progressive</label>
        <label className="check radio"><input type="radio" checked={value} onChange={() => setValue(true)} /> Always Deinterlace — split interlaced fields into frames on export</label>
      </div>
    </Modal>
  );
}

const ATTRIBUTES: [keyof AttributeSet, string][] = [
  ['motion', 'Motion (position, scale, rotation, fit)'], ['opacity', 'Opacity'], ['crop', 'Crop'], ['effects', 'Effects (colour, blur, flips)'], ['mask', 'Mask'], ['speed', 'Speed / Duration'], ['volume', 'Level'], ['audio', 'Audio channels and Enhance Speech'],
];

export function AttributesDialog({ title, action, onClose, onSubmit }: { title: string; action: string; onClose: () => void; onSubmit: (set: AttributeSet) => void }) {
  const [value, setValue] = useState<AttributeSet>({ motion: true, opacity: true, crop: true, effects: true, speed: false, volume: true, mask: true, audio: true });
  return (
    <Modal title={title} onClose={onClose} width={430} footer={
      <>
        <div className="toolbar-spacer" />
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={() => onSubmit(value)}>{action}</button>
      </>
    }>
      <div className="dialog-body">
        {ATTRIBUTES.map(([key, label]) => (
          <label key={key} className="check"><input type="checkbox" checked={value[key]} onChange={(event) => setValue({ ...value, [key]: event.target.checked })} /> {label}</label>
        ))}
      </div>
    </Modal>
  );
}

export function MarkerDialog({ marker, comp, onClose, onSubmit, onDelete }: { marker: Marker; comp: Comp; onClose: () => void; onSubmit: (marker: Marker) => void; onDelete: () => void }) {
  const [value, setValue] = useState(marker);
  return (
    <Modal title="Marker" onClose={onClose} width={420} footer={
      <>
        <button type="button" className="btn btn-ghost danger" onClick={onDelete}>Delete</button>
        <div className="toolbar-spacer" />
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={() => onSubmit(value)}>OK</button>
      </>
    }>
      <div className="dialog-body">
        <Field label="Name"><input value={value.name} autoFocus onChange={(event) => setValue({ ...value, name: event.target.value })} /></Field>
        <Field label="Time"><input value={timecode(value.time, comp.fps)} onChange={(event) => { const parsed = parseTimecode(event.target.value, comp.fps); if (parsed !== null) setValue({ ...value, time: parsed }); }} /></Field>
        <Field label="Colour"><ColorSwatches value={value.color} onChange={(color) => setValue({ ...value, color })} /></Field>
      </div>
    </Modal>
  );
}

export function RenameDialog({ title, name, onClose, onSubmit }: { title: string; name: string; onClose: () => void; onSubmit: (name: string) => void }) {
  const [value, setValue] = useState(name);
  return (
    <Modal title={title} onClose={onClose} width={400} footer={
      <>
        <div className="toolbar-spacer" />
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={() => onSubmit(value.trim() || name)}>OK</button>
      </>
    }>
      <div className="dialog-body">
        <Field label="Name"><input value={value} autoFocus onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && onSubmit(value.trim() || name)} /></Field>
      </div>
    </Modal>
  );
}

export function SynchronizeDialog({ onClose, onSubmit }: { onClose: () => void; onSubmit: (mode: 'start' | 'end' | 'source') => void }) {
  const [value, setValue] = useState<'start' | 'end' | 'source'>('start');
  return (
    <Modal title="Synchronize Clips" onClose={onClose} width={420} footer={
      <>
        <div className="toolbar-spacer" />
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={() => onSubmit(value)}>OK</button>
      </>
    }>
      <div className="dialog-body">
        <label className="check radio"><input type="radio" checked={value === 'start'} onChange={() => setValue('start')} /> Clip Start</label>
        <label className="check radio"><input type="radio" checked={value === 'end'} onChange={() => setValue('end')} /> Clip End</label>
        <label className="check radio"><input type="radio" checked={value === 'source'} onChange={() => setValue('source')} /> Source Timecode (line up the same moment of each source)</label>
        <p className="dialog-note">The clip on the lowest track stays put; the others move to line up with it. Audio-waveform sync needs an analysis pass Helios does not have yet.</p>
      </div>
    </Modal>
  );
}

export function SceneDetectionDialog({ onClose, onSubmit, busy }: { onClose: () => void; onSubmit: (action: 'cut' | 'markers', sensitivity: number) => void; busy: boolean }) {
  const [action, setAction] = useState<'cut' | 'markers'>('cut');
  const [sensitivity, setSensitivity] = useState(0.6);
  return (
    <Modal title="Scene Edit Detection" onClose={onClose} width={440} footer={
      <>
        <div className="toolbar-spacer" />
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={() => onSubmit(action, sensitivity)} disabled={busy}>{busy ? 'Analysing…' : 'Analyze'}</button>
      </>
    }>
      <div className="dialog-body">
        <label className="check radio"><input type="radio" checked={action === 'cut'} onChange={() => setAction('cut')} /> Apply cuts at detected cut points</label>
        <label className="check radio"><input type="radio" checked={action === 'markers'} onChange={() => setAction('markers')} /> Generate markers at detected cut points</label>
        <Field label={`Sensitivity — ${Math.round(sensitivity * 100)}%`} hint="Higher finds more cuts">
          <input type="range" min={0.1} max={0.95} step={0.05} value={sensitivity} onChange={(event) => setSensitivity(Number(event.target.value))} />
        </Field>
      </div>
    </Modal>
  );
}

export function ClipInfoDialog({ clip, comp, asset, item, nested, onClose }: { clip: Clip; comp: Comp; asset: Asset | undefined; item: ProjectItem | undefined; nested: Comp | undefined; onClose: () => void }) {
  const rows: [string, string][] = [
    ['Type', clip.source.type === 'media' ? `${asset?.kind ?? 'media'} clip` : clip.source.type],
    ['Track', comp.tracks.findIndex((track) => track.id === clip.trackId) >= 0 ? `${clip.trackId === comp.sourceVideo ? 'patched · ' : ''}${comp.tracks.find((track) => track.id === clip.trackId)?.kind}` : '—'],
    ['Start', timecode(clip.start, comp.fps)],
    ['End', timecode(clip.start + clip.duration, comp.fps)],
    ['Duration', timecode(clip.duration, comp.fps)],
    ['Source In', timecode(clip.in, comp.fps)],
    ['Speed', `${Math.round(clip.speed * 100)} %${clip.reverse ? ' reversed' : ''}`],
  ];
  if (asset) {
    rows.push(['File', asset.path], ['Size', bytes(asset.size)], ['Frame', `${asset.width}×${asset.height}`], ['Frame rate', asset.fps ? `${asset.fps.toFixed(2)} fps` : '—'], ['Video codec', asset.videoCodec ?? '—'], ['Audio codec', asset.audioCodec ?? '—'], ['Media duration', timecode(asset.duration, asset.fps ?? 30)]);
  }
  if (item) rows.push(['Item', ITEM_LABEL[item.kind]], ['Colour', item.color], ['Frame', `${item.width}×${item.height}`]);
  if (nested) rows.push(['Comp', nested.name], ['Frame', `${nested.width}×${nested.height}`], ['Frame rate', `${nested.fps} fps`], ['Clips', String(nested.clips.length)]);
  return (
    <Modal title="Properties" onClose={onClose} width={520} footer={<><div className="toolbar-spacer" /><button type="button" className="btn btn-primary" onClick={onClose}>Close</button></>}>
      <table className="info-table">
        <tbody>{rows.map(([label, value]) => <tr key={label}><th>{label}</th><td>{value}</td></tr>)}</tbody>
      </table>
    </Modal>
  );
}

export function ShortcutsDialog({ shortcuts, onClose }: { shortcuts: [string, string, string][]; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const rows = shortcuts.filter(([keys, action, group]) => !needle || `${keys} ${action} ${group}`.toLowerCase().includes(needle));
  const groups = [...new Set(rows.map(([, , group]) => group))];
  return (
    <Modal title="Keyboard Shortcuts" onClose={onClose} width={720} footer={<><span className="muted">{rows.length} shortcuts</span><div className="toolbar-spacer" /><button type="button" className="btn btn-primary" onClick={onClose}>Close</button></>}>
      <div className="shortcuts-search">
        <input placeholder="Search shortcuts" value={query} autoFocus onChange={(event) => setQuery(event.target.value)} />
      </div>
      <div className="shortcuts-table">
        {groups.map((group) => (
          <div key={group} className="shortcut-group">
            <h4>{group}</h4>
            {rows.filter(([, , item]) => item === group).map(([keys, action]) => (
              <div key={`${group}-${keys}-${action}`} className="shortcut"><kbd>{keys}</kbd><span>{action}</span></div>
            ))}
          </div>
        ))}
      </div>
    </Modal>
  );
}

/** Asks about unsaved work before closing or replacing the project. */
export function ConfirmDialog({ title, body, confirmLabel, discardLabel, onConfirm, onDiscard, onClose, top }: { title: string; body: string; confirmLabel: string; discardLabel?: string; onConfirm: () => void; onDiscard?: () => void; onClose: () => void; /** Show above everything (the sign-in gate included). */ top?: boolean }) {
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Enter') onConfirm();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onConfirm]);
  return (
    <Modal title={title} onClose={onClose} width={440} top={top} footer={
      <>
        {discardLabel && onDiscard && <button type="button" className="btn" onClick={onDiscard}>{discardLabel}</button>}
        <div className="toolbar-spacer" />
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={onConfirm}>{confirmLabel}</button>
      </>
    }>
      <p className="modal-text">{body}</p>
    </Modal>
  );
}

export type ProjectSettingsResult = {
  name: string;
  activeCompId: string | null;
  width: number;
  height: number;
  fps: number;
  captionStyle: string | null;
};

/** Trims the name and clamps the frame setup, so the dialog always submits a valid result. */
export function normalizeProjectSettings(project: Project, draft: ProjectSettingsResult): ProjectSettingsResult {
  return {
    ...draft,
    name: draft.name.trim() || project.name,
    width: clamp(Math.round(draft.width) || 16, 16, 8192),
    height: clamp(Math.round(draft.height) || 16, 16, 8192),
  };
}

/**
 * After Effects-style Project Settings: the current project's identity and
 * defaults plus the active composition's frame setup, all editable in one
 * place and styled like every other dialog.
 */
export function ProjectSettingsDialog({ project, comp, filePath, onClose, onSubmit }: {
  project: Project; comp: Comp | null; filePath: string | null; onClose: () => void; onSubmit: (result: ProjectSettingsResult) => void;
}) {
  const [name, setName] = useState(project.name);
  const [activeCompId, setActiveCompId] = useState<string | null>(comp?.id ?? project.activeCompId ?? project.comps[0]?.id ?? null);
  const shown = project.comps.find((item) => item.id === activeCompId) ?? comp ?? project.comps[0] ?? null;
  const [width, setWidth] = useState(shown?.width ?? 1920);
  const [height, setHeight] = useState(shown?.height ?? 1080);
  const [fps, setFps] = useState(shown?.fps ?? 30);
  const [captionStyle, setCaptionStyle] = useState<string | null>(project.captionStyle);
  const preset = COMP_PRESETS.find((item) => item.width === width && item.height === height);
  const clips = project.comps.reduce((total, item) => total + item.clips.length, 0);
  const submit = () => onSubmit(normalizeProjectSettings(project, {
    name,
    activeCompId,
    width,
    height,
    fps,
    captionStyle,
  }));
  return (
    <Modal title="Project Settings" onClose={onClose} width={520} footer={
      <>
        <div className="toolbar-spacer" />
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={submit}>OK</button>
      </>
    }>
      <div className="dialog-body">
        <h4 className="dialog-section">Project</h4>
        <Field label="Project name"><input value={name} autoFocus onChange={(event) => setName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && submit()} /></Field>
        <div className="field-row">
          <Field label="Compositions"><input value={String(project.comps.length)} disabled /></Field>
          <Field label="Clips"><input value={String(clips)} disabled /></Field>
          <Field label="Media"><input value={String(project.media.length)} disabled /></Field>
        </div>
        <Field label="Project file"><input value={filePath ?? 'Unsaved project'} disabled title={filePath ?? undefined} /></Field>
        <h4 className="dialog-section">Composition</h4>
        <Field label="Active comp">
          <select value={activeCompId ?? ''} onChange={(event) => {
            const next = project.comps.find((item) => item.id === event.target.value);
            setActiveCompId(event.target.value || null);
            if (next) { setWidth(next.width); setHeight(next.height); setFps(next.fps); }
          }}>
            {project.comps.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.width}×{item.height} @ {item.fps}fps</option>)}
          </select>
        </Field>
        <Field label="Frame size">
          <select value={preset?.id ?? 'custom'} onChange={(event) => {
            const chosen = COMP_PRESETS.find((item) => item.id === event.target.value);
            if (chosen) { setWidth(chosen.width); setHeight(chosen.height); }
          }}>
            {COMP_PRESETS.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.width}×{item.height}</option>)}
            {!preset && <option value="custom">Custom</option>}
          </select>
        </Field>
        <div className="field-row">
          <Field label="Width"><input type="number" min={16} max={8192} value={width} onChange={(event) => setWidth(clamp(Number(event.target.value), 16, 8192))} /></Field>
          <Field label="Height"><input type="number" min={16} max={8192} value={height} onChange={(event) => setHeight(clamp(Number(event.target.value), 16, 8192))} /></Field>
          <Field label="Frame rate">
            <select value={fps} onChange={(event) => setFps(Number(event.target.value))}>
              {FRAME_RATES.map((rate) => <option key={rate} value={rate}>{rate} fps</option>)}
            </select>
          </Field>
        </div>
        {shown && <p className="muted small">Duration {timecode(compDuration(shown), shown.fps)} · {tracksOf(shown, 'video').length} video tracks · {tracksOf(shown, 'audio').length} audio tracks</p>}
        <h4 className="dialog-section">Defaults</h4>
        <Field label="Caption style">
          <select value={captionStyle ?? ''} onChange={(event) => setCaptionStyle(event.target.value || null)}>
            <option value="">Project default</option>
            {CAPTION_STYLES.map((style) => <option key={style.id} value={style.id}>{style.label}</option>)}
          </select>
        </Field>
      </div>
    </Modal>
  );
}
