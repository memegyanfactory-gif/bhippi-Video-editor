// The Project panel: comps, folders, generated items and imported media, with Premiere's icon and
// list views — plus the Effects, Graphics and Audio tabs you drag onto the timeline.
import { renderHtmlCompStill } from '../lib/htmlFrames';
import {
  AudioLines, Captions, ChevronRight, Clapperboard, Folder, FolderOpen, Grid2x2, Image as ImageIcon, LayoutTemplate, List, LoaderCircle, Play, Plus, RotateCw, Search, SlidersHorizontal, Trash2,
  TriangleAlert, Type, Upload, Video,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useToast } from '../components/ui';
import { StyledCaptionText } from '../editor/StyledCaption';
import { CAPTION_STYLES, STYLE_CATEGORIES, type CaptionStyle } from '../lib/captionStyles';
import { bytes, capitalize, timecode } from '../lib/editor';
import type { History } from '../lib/history';
import { api, fileSrc } from '../lib/ipc';
import { playSfx } from '../lib/sfx';
import { compDuration, ITEM_LABEL, tracksOf, usage } from '../lib/timeline';
import type { Asset, ClipSource, Comp, FxSnapshot, ItemKind, Preset, Project, ProjectItem, SfxKind, TransitionKind } from '../lib/types';
import { AVAILABLE_EFFECTS as ALL_EFFECTS, type EffectDefinition } from '../lib/effectsCatalog';
import { FXConsolePanel } from './FXConsolePanel';
import { SubtitleTab } from './SubtitleTab';
import { MotionTemplates } from './MotionTemplates';
import { ErrorBoundary } from '../components/ErrorBoundary';

export type EffectPreset = EffectDefinition;

export type ProjectTab = 'project' | 'effects' | 'graphics' | 'audio' | 'subtitles';

/** What the panel hands the timeline when something is dragged out of it. */
export type DragPayload =
  | { kind: 'source'; source: ClipSource; label: string; in?: number; duration?: number }
  | { kind: 'transition'; transition: TransitionKind; label: string }
  | { kind: 'effect'; effect: EffectPreset; label: string };

export type BinEntry =
  | { type: 'folder'; id: string; name: string }
  | { type: 'comp'; id: string; name: string; comp: Comp }
  | { type: 'item'; id: string; name: string; item: ProjectItem }
  | { type: 'media'; id: string; name: string; asset: Asset | undefined; offline: boolean };

type Props = {
  tab: ProjectTab;
  project: Project;
  assets: Asset[];
  history: History;
  folder: string | null;
  onFolder: (id: string | null) => void;
  selection: string[];
  onSelect: (ids: string[]) => void;
  clipSelection: string[];
  onDragStart: (payload: DragPayload, event: ReactPointerEvent) => void;
  onOpenComp: (id: string) => void;
  onOpenInSource: (assetId: string) => void;
  onEntryMenu: (event: React.MouseEvent, ids: string[]) => void;
  onPanelMenu: (event: React.MouseEvent) => void;
  onImport: () => void;
  onNewComp: () => void;
  onNewFolder: () => void;
  onNewItem: (kind: ItemKind) => void;
  onDelete: (ids: string[]) => void;
  onRename: (id: string, name: string) => void;
  onAddText: (preset: Preset) => void;
  onAddSfx: (kind: SfxKind) => void;
  onCaptionStyle: (style: CaptionStyle) => void;
  onImportCaptions: (file: File) => void;
  onApplyEffect: (effect: EffectPreset) => void;
  comp?: Comp;
  playheadTime?: number;
  stageRef?: React.RefObject<HTMLDivElement | null>;
  onOpenQuickModal?: () => void;
  onReimportSnapshot?: (snapshot: FxSnapshot) => void;
  onSeek?: (seconds: number) => void;
};

export function ProjectPanel(props: Props) {
  if (props.tab === 'effects') {
    return (
      <FXConsolePanel
        comp={props.comp}
        playheadTime={props.playheadTime ?? 0}
        selectedClipIds={props.clipSelection}
        stageRef={props.stageRef ?? { current: null }}
        onApplyEffect={props.onApplyEffect}
        onDragStart={props.onDragStart}
        onOpenQuickModal={props.onOpenQuickModal ?? (() => {})}
        onReimportSnapshot={props.onReimportSnapshot ?? (() => {})}
      />
    );
  }
  if (props.tab === 'subtitles') {
    return (
      <SubtitleTab
        project={props.project}
        comp={props.comp}
        assets={props.assets}
        history={props.history}
        clipSelection={props.clipSelection}
        playheadTime={props.playheadTime}
        onCaptionStyle={props.onCaptionStyle}
        onImportCaptions={props.onImportCaptions}
        onSeek={props.onSeek}
      />
    );
  }
  if (props.tab === 'graphics') return <GraphicsTab {...props} />;
  if (props.tab === 'audio') return <AudioTab {...props} />;
  return <BinTab {...props} />;
}

const ITEM_ICON: Record<ItemKind, typeof Video> = {
  'color-matte': LayoutTemplate, 'black-video': LayoutTemplate, 'transparent-video': LayoutTemplate, 'bars-and-tone': LayoutTemplate, 'adjustment-layer': SlidersHorizontal, countdown: Clapperboard,
};

function BinTab({ project, history, assets, folder, onFolder, selection, onSelect, onDragStart, onOpenComp, onOpenInSource, onEntryMenu, onPanelMenu, onImport, onNewComp, onNewFolder, onDelete, onRename }: Props) {
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'icon' | 'list'>('icon');
  const [size, setSize] = useState(132);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [posters, setPosters] = useState<Record<string, string>>({});
  const posterDone = useRef<Set<string>>(new Set());
  const counts = useMemo(() => usage(project), [project]);
  const assetMap = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);

  const entries: BinEntry[] = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const inFolder = <T extends { folderId?: string | null; parentId?: string | null }>(item: T) => (needle ? true : (item.folderId ?? item.parentId ?? null) === folder);
    const list: BinEntry[] = [
      ...project.folders.filter((item) => inFolder(item)).map((item): BinEntry => ({ type: 'folder', id: item.id, name: item.name })),
      ...project.comps.filter((comp) => inFolder(comp)).map((comp): BinEntry => ({ type: 'comp', id: comp.id, name: comp.name, comp })),
      ...project.items.filter((item) => inFolder(item)).map((item): BinEntry => ({ type: 'item', id: item.id, name: item.name, item })),
      ...project.media.filter((ref) => inFolder(ref)).map((ref): BinEntry => {
        const asset = assetMap.get(ref.assetId);
        return { type: 'media', id: ref.assetId, name: asset?.name ?? 'Media Offline', asset, offline: ref.offline || !asset || asset.missing };
      }),
    ];
    return needle ? list.filter((entry) => entry.name.toLowerCase().includes(needle)) : list;
  }, [project, assetMap, folder, query]);

  const path = useMemo(() => {
    const trail: { id: string | null; name: string }[] = [{ id: null, name: project.name }];
    let current = folder;
    const seen = new Set<string>();
    const stack: { id: string; name: string }[] = [];
    while (current && !seen.has(current)) {
      seen.add(current);
      const entry = project.folders.find((item) => item.id === current);
      if (!entry) break;
      stack.unshift({ id: entry.id, name: entry.name });
      current = entry.parentId;
    }
    return [...trail, ...stack];
  }, [project.folders, project.name, folder]);

  const pick = (entry: BinEntry, event: React.PointerEvent | React.MouseEvent) => {
    if (event.shiftKey || event.ctrlKey) onSelect(selection.includes(entry.id) ? selection.filter((id) => id !== entry.id) : [...selection, entry.id]);
    else if (!selection.includes(entry.id)) onSelect([entry.id]);
  };

  const payloadFor = (entry: BinEntry): DragPayload | null => {
    if (entry.type === 'comp') return { kind: 'source', source: { type: 'comp', compId: entry.id }, label: entry.name };
    if (entry.type === 'item') return { kind: 'source', source: { type: 'item', itemId: entry.id }, label: entry.name, duration: entry.item.duration };
    if (entry.type === 'media' && entry.asset && !entry.offline) return { kind: 'source', source: { type: 'media', assetId: entry.id }, label: entry.name };
    return null;
  };

  const open = (entry: BinEntry) => {
    if (entry.type === 'folder') onFolder(entry.id);
    else if (entry.type === 'comp') onOpenComp(entry.id);
    else if (entry.type === 'media' && !entry.offline) onOpenInSource(entry.id);
  };

  // Comp posters: what is inside each comp, rendered once per session plus on
  // demand. Rendering every comp on every edit would stall the panel, so a
  // stale poster stays until its refresh button is pressed.
  const refreshPoster = (compId: string) => {
    posterDone.current.add(compId);
    const comp = history.current().comps.find((entry) => entry.id === compId);
    // A motion-graphic comp (HTML only) is drawn here, as the preview draws it: the FFmpeg poster
    // has no frames for HTML and rendered those cards black.
    if (comp && comp.clips.some((clip) => clip.source.type === 'html') && !comp.clips.some((clip) => clip.source.type === 'media')) {
      void renderHtmlCompStill(comp)
        .then((still) => { if (still) setPosters((current) => ({ ...current, [compId]: still })); })
        .catch(() => undefined);
      return;
    }
    void api.compPoster(history.current(), compId)
      .then((path) => setPosters((current) => ({ ...current, [compId]: path })))
      .catch(() => undefined);
  };

  useEffect(() => {
    for (const item of project.comps) {
      if (!posterDone.current.has(item.id) && compDuration(item) > 0) refreshPoster(item.id);
    }
    // Posters follow comp identity: they refresh when the project (and only
    // then) is swapped or rebuilt.
  }, [project.comps.length, project.name]);

  // Delete and Ctrl+A work on the visible bin entries when the panel has
  // focus. Handled here (with propagation stopped) so Delete never also hits
  // timeline clips and Ctrl+A never also selects them.
  const deleteSelection = () => {
    if (!selection.length) return;
    onDelete(selection);
  };
  const onBinKeyDown = (event: React.KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if ((event.key === 'Delete' || event.key === 'Backspace') && selection.length) {
      event.preventDefault();
      event.stopPropagation();
      deleteSelection();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      event.stopPropagation();
      onSelect(entries.map((entry) => entry.id));
    }
  };

  const detail = (entry: BinEntry) => {
    if (entry.type === 'folder') return 'Folder';
    if (entry.type === 'comp') return `${entry.comp.width}×${entry.comp.height} · ${timecode(compDuration(entry.comp), entry.comp.fps)}`;
    if (entry.type === 'item') return ITEM_LABEL[entry.item.kind];
    if (entry.offline) return 'Offline';
    return entry.asset ? (entry.asset.kind === 'image' ? 'Still' : timecode(entry.asset.duration, entry.asset.fps ?? 30)) : '';
  };

  return (
    <div className="bin" tabIndex={0} onKeyDown={onBinKeyDown}
      onPointerDown={(event) => {
        const target = event.target as HTMLElement;
        if (!target.closest('input, textarea, select, [contenteditable="true"]')) event.currentTarget.focus({ preventScroll: true });
      }}
      onContextMenu={(event) => { if (!(event.target as HTMLElement).closest('.tile, .bin-row')) { event.preventDefault(); onPanelMenu(event); } }}>
      <div className="bin-head">
        {path.map((step, index) => (
          <span key={step.id ?? 'root'} className="bin-crumb">
            {index > 0 && <ChevronRight size={11} />}
            <button type="button" onClick={() => onFolder(step.id)}>{index === 0 ? <FolderOpen size={12} /> : <Folder size={12} />} {step.name}</button>
          </span>
        ))}
      </div>
      <div className="bin-tools">
        <label className="bin-search">
          <Search size={13} />
          <input placeholder="Search (Ctrl+F)" value={query} onChange={(event) => setQuery(event.target.value)} data-role="bin-search" />
        </label>
        <button type="button" className="icon-btn small" onClick={onNewComp} title="New Comp (Ctrl+N)"><Plus size={14} /></button>
        <button type="button" className="icon-btn small" onClick={onImport} title="Import (Ctrl+I)"><Upload size={14} /></button>
        <span className="bin-count">{entries.length} items</span>
      </div>
      <div className="bin-body">
        {entries.length === 0 ? (
          <button type="button" className="dropzone" onClick={onImport}>
            <Upload size={24} />
            <strong>{query ? 'Nothing matches' : 'Import media to start'}</strong>
            <span>Drop video, audio or images here — or click to browse. Files stay where they are.</span>
          </button>
        ) : view === 'icon' ? (
          <div className={`bin-grid${size < 95 ? ' compact' : ''}`} style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${size}px, 1fr))` }}>
            {entries.map((entry) => {
              const payload = payloadFor(entry);
              const used = counts.get(entry.id) ?? 0;
              return (
                <div
                  key={entry.id}
                  className={`tile${entry.type === 'folder' ? ' folder' : ''}${selection.includes(entry.id) ? ' picked' : ''}${entry.type === 'media' && entry.offline ? ' missing' : ''}`}
                  onPointerDown={(event) => {
                    pick(entry, event);
                    if (event.button === 0 && payload) onDragStart(payload, event);
                  }}
                  onDoubleClick={() => open(entry)}
                  onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); pick(entry, event); onEntryMenu(event, selection.includes(entry.id) ? selection : [entry.id]); }}
                  title={entry.type === 'media' && entry.asset ? `${entry.name}\n${entry.asset.path}` : entry.name}
                >
                  <div className="tile-thumb">
                    <EntryThumb entry={entry} poster={entry.type === 'comp' ? posters[entry.id] : undefined} onPoster={entry.type === 'comp' ? () => refreshPoster(entry.id) : undefined} />
                    {used > 0 && <span className="tile-used" title={`Used ${used}×`}>{used}×</span>}
                    {entry.type === 'media' && entry.asset?.preview === 'pending' && !entry.offline && <span className="tile-status"><LoaderCircle size={13} className="spin" /> Preparing</span>}
                    {entry.type === 'media' && (entry.asset?.preview === 'failed' || thumbMissing(entry)) && !entry.offline && (
                      <button type="button" className="tile-status warn" title="Render the thumbnail and preview again"
                        onPointerDown={(event) => event.stopPropagation()} onClick={() => entry.asset && void api.libraryRetry(entry.asset.id)}><RotateCw size={12} /> Retry preview</button>
                    )}
                    {entry.type === 'media' && entry.offline && <span className="tile-status error"><TriangleAlert size={12} /> Offline</span>}
                  </div>
                  <div className="tile-meta">
                    {renaming === entry.id ? (
                      <input className="tile-rename" autoFocus defaultValue={entry.name} onPointerDown={(event) => event.stopPropagation()}
                        onBlur={(event) => { onRename(entry.id, event.target.value); setRenaming(null); }}
                        onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); if (event.key === 'Escape') setRenaming(null); }} />
                    ) : (
                      <span className="tile-name" onDoubleClick={(event) => { event.stopPropagation(); if (entry.type !== 'media') setRenaming(entry.id); }}>{entry.name}</span>
                    )}
                    <span className="tile-duration">{detail(entry)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <table className="bin-list">
            <thead>
              <tr><th>Name</th><th>Kind</th><th>Duration</th><th>Info</th><th>Used</th></tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const payload = payloadFor(entry);
                return (
                  <tr key={entry.id} className={`bin-row${selection.includes(entry.id) ? ' picked' : ''}`}
                    onPointerDown={(event) => { pick(entry, event); if (event.button === 0 && payload) onDragStart(payload, event); }}
                    onDoubleClick={() => open(entry)}
                    onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); pick(entry, event); onEntryMenu(event, selection.includes(entry.id) ? selection : [entry.id]); }}>
                    <td><EntryIcon entry={entry} /> {entry.name}</td>
                    <td>{entry.type === 'comp' ? 'Comp' : entry.type === 'folder' ? 'Folder' : entry.type === 'item' ? ITEM_LABEL[entry.item.kind] : capitalize(entry.asset?.kind ?? 'media')}</td>
                    <td>{entry.type === 'comp' ? timecode(compDuration(entry.comp), entry.comp.fps) : entry.type === 'media' && entry.asset && entry.asset.kind !== 'image' ? timecode(entry.asset.duration, entry.asset.fps ?? 30) : entry.type === 'item' ? timecode(entry.item.duration) : '—'}</td>
                    <td>{entry.type === 'media' && entry.asset ? (entry.asset.kind === 'audio' ? entry.asset.audioCodec : `${entry.asset.width}×${entry.asset.height}`) : entry.type === 'comp' ? `${entry.comp.width}×${entry.comp.height} · ${tracksOf(entry.comp, 'video').length}V/${tracksOf(entry.comp, 'audio').length}A` : ''}</td>
                    <td>{counts.get(entry.id) ? `${counts.get(entry.id)}×` : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <div className="bin-foot">
        <button type="button" className={`icon-btn small${view === 'list' ? ' active' : ''}`} onClick={() => setView('list')} title="List View"><List size={14} /></button>
        <button type="button" className={`icon-btn small${view === 'icon' ? ' active' : ''}`} onClick={() => { setView('icon'); setSize((prev) => Math.max(prev, 96)); }} title="Icon View"><Grid2x2 size={14} /></button>
        <div className="bin-slider-wrap" title="Adjust view & thumbnail size (Premiere Pro)">
          <ImageIcon size={11} className="bin-slider-icon small" />
          <input
            type="range"
            min={50}
            max={240}
            value={view === 'list' ? 50 : Math.max(70, size)}
            onChange={(event) => {
              const val = Number(event.target.value);
              if (val <= 60) {
                setView('list');
              } else {
                setView('icon');
                setSize(val);
              }
            }}
            aria-label="Thumbnail size & view mode"
            className="bin-zoom"
          />
          <ImageIcon size={16} className="bin-slider-icon large" />
        </div>
        <div className="toolbar-spacer" />
        <button type="button" className="icon-btn small" onClick={onNewFolder} title="New Folder (Ctrl+/)"><Folder size={14} /></button>
        <button type="button" className="icon-btn small" onClick={() => { const media = project.media.find((ref) => ref.assetId === selection[0]); const asset = media && assetMap.get(media.assetId); if (asset) void api.revealPath(asset.path); }} disabled={!selection.length} title="Reveal in Explorer"><FolderOpen size={13} /></button>
        <button type="button" className="icon-btn small danger" onClick={deleteSelection} disabled={!selection.length} title="Delete (files are never deleted)"><Trash2 size={13} /></button>
      </div>
    </div>
  );
}

function EntryIcon({ entry }: { entry: BinEntry }) {
  if (entry.type === 'folder') return <Folder size={12} />;
  if (entry.type === 'comp') return <Clapperboard size={12} />;
  if (entry.type === 'item') {
    const Icon = ITEM_ICON[entry.item.kind];
    return <Icon size={12} />;
  }
  const Icon = entry.asset?.kind === 'audio' ? AudioLines : entry.asset?.kind === 'image' ? ImageIcon : Video;
  return <Icon size={12} />;
}

/**
 * A video or still with no usable thumbnail outside an active derive run.
 * Native files derive silently in the background, so without this the tile
 * would sit on the empty placeholder forever when that run failed — with no
 * way to retry. (While a derive is still running the button may show briefly;
 * re-running it is idempotent.)
 */
function thumbMissing(entry: BinEntry): boolean {
  if (entry.type !== 'media' || entry.offline || !entry.asset) return false;
  if (entry.asset.preview === 'pending') return false;
  return (entry.asset.kind === 'video' || entry.asset.kind === 'image') && !entry.asset.thumbnail;
}

/**
 * A folder tile with actual depth: a back shell with its tab, two papers tucked inside, and a
 * front pocket that covers them at rest. `.tile:hover`/`.tile.picked` (app.css) tip the front
 * pocket open and let the papers slide up past it — CSS transforms only, so it costs nothing
 * extra to keep dozens of these on screen in a busy bin.
 */
function Folder3D() {
  return (
    <div className="folder3d" aria-hidden="true">
      <span className="folder3d-back" />
      <span className="folder3d-paper p2" />
      <span className="folder3d-paper p1" />
      <span className="folder3d-front" />
    </div>
  );
}

export function EntryThumb({ entry, poster, onPoster }: { entry: BinEntry; poster?: string; onPoster?: () => void }) {
  if (entry.type === 'folder') return <Folder3D />;
  if (entry.type === 'comp') {
    return (
      <div className="tile-comp">
        {poster ? (
          <img src={poster.startsWith('data:') ? poster : fileSrc(poster)} alt="" draggable={false} className="tile-poster" />
        ) : (
          <>
            <Clapperboard size={20} />
            <span>{tracksOf(entry.comp, 'video').length}V · {tracksOf(entry.comp, 'audio').length}A · {entry.comp.clips.length} clips</span>
          </>
        )}
        {onPoster && (
          <button type="button" className="tile-status poster-refresh" title={poster ? 'Refresh poster frame' : 'Render poster frame'}
            onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onPoster(); }}>
            <RotateCw size={12} /> {poster ? '' : 'Poster'}
          </button>
        )}
      </div>
    );
  }
  if (entry.type === 'item') {
    const item = entry.item;
    if (item.kind === 'color-matte') return <div className="tile-matte" style={{ background: item.color }} />;
    if (item.kind === 'black-video') return <div className="tile-matte" style={{ background: '#000' }} />;
    if (item.kind === 'transparent-video') return <div className="tile-matte transparent" />;
    if (item.kind === 'bars-and-tone') return <div className="tile-bars" />;
    if (item.kind === 'countdown') return <div className="tile-countdown">8</div>;
    return <SlidersHorizontal size={22} className="tile-placeholder" />;
  }
  const asset = entry.asset;
  return <MediaThumb asset={asset} />;
}

/**
 * A library thumbnail that never shows the browser's broken-image glyph: when
 * the recorded file cannot be served (stale path, interrupted derive), the
 * kind icon renders instead — the same empty state as a pending thumbnail.
 */
export function MediaThumb({ asset }: { asset: Asset | undefined }) {
  const src = asset?.thumbnail ?? (asset?.kind === 'audio' ? asset.waveform : undefined);
  const [dead, setDead] = useState(false);
  useEffect(() => setDead(false), [src]);
  const Icon = asset?.kind === 'audio' ? AudioLines : asset?.kind === 'image' ? ImageIcon : Video;
  if (src && !dead) {
    return <img src={fileSrc(src)} alt="" draggable={false} className={asset?.thumbnail ? undefined : 'wave'} onError={() => setDead(true)} />;
  }
  return <Icon size={22} className="tile-placeholder" />;
}

// ───────────────────────────── effects ─────────────────────────────

export const VIDEO_EFFECTS: EffectPreset[] = ALL_EFFECTS;


// ───────────────────────────── graphics ─────────────────────────────

const PRESETS: { preset: Preset; hint: string }[] = [
  { preset: 'title', hint: 'Big centred headline that pops in' },
  { preset: 'kinetic', hint: 'Words land one by one' },
  { preset: 'lower-third', hint: 'Name tag that slides in' },
  { preset: 'caption', hint: 'Subtitle line in the caption style' },
];

function GraphicsTab({ project, assets, history, clipSelection, onAddText, onCaptionStyle, onImportCaptions }: Props) {
  const toast = useToast();
  const [category, setCategory] = useState('All');
  const [query, setQuery] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const comp = project.comps.find((item) => item.id === project.activeCompId) ?? project.comps[0];
  const captionClips = comp ? comp.clips.filter((clip) => clip.source.type === 'text' && clip.source.preset === 'caption') : [];
  const selectedCaption = comp?.clips.find((clip) => clipSelection.includes(clip.id) && clip.source.type === 'text' && clip.source.preset === 'caption');
  const current = selectedCaption?.source.type === 'text' ? (selectedCaption.source.style ?? project.captionStyle) : project.captionStyle;
  const styles = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return CAPTION_STYLES.filter((style) => (category === 'All' || style.category === category) && (!needle || `${style.label} ${style.tags.join(' ')} ${style.category}`.toLowerCase().includes(needle)));
  }, [category, query]);

  return (
    <div className="effects">
      <div className="effects-section">
        <div className="effects-title">Titles <span className="muted">— adds at the playhead on a free track</span></div>
        <div className="title-presets">
          {PRESETS.map(({ preset, hint }) => (
            <button key={preset} type="button" className={`title-preset preset-${preset}`} onClick={() => onAddText(preset)} title={hint}>
              <span className="title-sample">
                {preset === 'title' && <b className="sample-title">Title</b>}
                {preset === 'kinetic' && <span className="sample-kinetic"><b>Make</b> <b>it</b> <b>pop</b></span>}
                {preset === 'lower-third' && <span className="sample-lower"><b>Aarav</b><i>Creator</i></span>}
                {preset === 'caption' && <span className="sample-caption">Caption line</span>}
              </span>
              <span className="title-label"><Type size={11} /> {preset === 'lower-third' ? 'Lower Third' : capitalize(preset)}</span>
            </button>
          ))}
        </div>
      </div>
      <ErrorBoundary scope="Motion templates"><MotionTemplates history={history} assets={assets} clipSelection={clipSelection} /></ErrorBoundary>
      <div className="effects-section grow">
        <div className="effects-title">
          Caption styles
          <div className="toolbar-spacer" />
          <button type="button" className="btn btn-small" onClick={() => fileInput.current?.click()} title="Import .srt or .vtt"><Captions size={12} /> Import captions</button>
          <input ref={fileInput} type="file" accept=".srt,.vtt" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) onImportCaptions(file); event.target.value = ''; }} />
        </div>
        <div className="style-current">
          {selectedCaption ? 'Selected caption' : 'Default for new captions'}: <strong>{CAPTION_STYLES.find((style) => style.id === current)?.label ?? 'Bhippi basic'}</strong>
          {captionClips.length > 0 && current && (
            <button type="button" className="btn btn-small btn-ghost" onClick={() => {
              const style = CAPTION_STYLES.find((item) => item.id === current);
              if (style) {
                onCaptionStyle(style);
                toast({ tone: 'success', title: `${style.label} applied to ${captionClips.length} captions`, timeout: 2500 });
              }
            }}>Apply to all {captionClips.length} captions</button>
          )}
        </div>
        <div className="style-filters">
          <label className="bin-search">
            <Search size={12} />
            <input placeholder="Search styles (karaoke, box, glow…)" value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          <div className="chips">
            {['All', ...STYLE_CATEGORIES].map((name) => (
              <button key={name} type="button" className={`chip${category === name ? ' active' : ''}`} onClick={() => setCategory(name)}>{name}</button>
            ))}
          </div>
        </div>
        <div className="style-grid">
          {styles.map((style) => (
            <button key={style.id} type="button" className={`style-card${current === style.id ? ' active' : ''}`} onClick={() => onCaptionStyle(style)} title={`${style.label} · ${style.category}${style.tags.length ? ` · ${style.tags.join(', ')}` : ''}`}>
              <span className="style-sample" style={{ ['--h' as string]: `${1500 / style.size}px` }}>
                <StyledCaptionText style={style} elapsed={null} words={['Make', 'it', 'POP'].map((text, index) => ({ text: style.uppercase ? text.toUpperCase() : text, index, active: index === 1, lit: !!style.highlight && (style.progressive ? index <= 1 : index === 1) }))} />
              </span>
              <span className="style-label">{style.label}</span>
            </button>
          ))}
          {styles.length === 0 && <div className="panel-empty">No styles match.</div>}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────── audio ─────────────────────────────

const EFFECTS: { kind: SfxKind; hint: string }[] = [
  { kind: 'whoosh', hint: 'Fast transitions — place just before a cut' },
  { kind: 'impact', hint: 'Deep hit for titles and reveals' },
  { kind: 'pop', hint: 'Light tick for text and stickers' },
  { kind: 'chime', hint: 'Bright accent for wins and endings' },
  { kind: 'riser', hint: 'Builds tension into a drop' },
  { kind: 'boom', hint: 'Vine boom — lands a punchline' },
  { kind: 'scratch', hint: 'Record scratch — freeze frame, wait what' },
  { kind: 'bleep', hint: 'Censor bleep — trim it to the word' },
  { kind: 'swish', hint: 'Short bright swoosh for slides and pops' },
  { kind: 'ding', hint: 'Bell — correct, idea, notification' },
  { kind: 'glitch', hint: 'Digital stutter for glitch cuts' },
];

function AudioTab({ onAddSfx, onDragStart, project, assets }: Props) {
  const music = assets.filter((asset) => asset.kind === 'audio' && project.media.some((ref) => ref.assetId === asset.id));
  return (
    <div className="effects">
      <div className="effects-section">
        <div className="effects-title">Sound effects <span className="muted">— adds at the playhead on a free audio track</span></div>
        <div className="sfx-list">
          {EFFECTS.map(({ kind, hint }) => (
            <div key={kind} className="sfx-card" onPointerDown={(event) => event.button === 0 && onDragStart({ kind: 'source', source: { type: 'sfx', kind }, label: capitalize(kind) }, event)}>
              <button type="button" className="icon-btn small solid" onPointerDown={(event) => event.stopPropagation()} onClick={() => playSfx(kind)} title={`Preview ${kind}`}><Play size={12} fill="currentColor" /></button>
              <div className="sfx-text"><strong>{capitalize(kind)}</strong><span>{hint}</span></div>
              <button type="button" className="btn btn-small" onPointerDown={(event) => event.stopPropagation()} onClick={() => onAddSfx(kind)}><Plus size={12} /> Add</button>
            </div>
          ))}
        </div>
      </div>
      <div className="effects-section grow">
        <div className="effects-title">Music and voice <span className="muted">— imported audio</span></div>
        {music.length === 0 ? (
          <p className="panel-note">Import music or record a voice-over from the microphone button in an audio track header.</p>
        ) : (
          <div className="sfx-list">
            {music.map((asset) => (
              <div key={asset.id} className="sfx-card" onPointerDown={(event) => event.button === 0 && onDragStart({ kind: 'source', source: { type: 'media', assetId: asset.id }, label: asset.name }, event)}>
                <AudioLines size={14} />
                <div className="sfx-text"><strong>{asset.name}</strong><span>{timecode(asset.duration)} · {bytes(asset.size)}</span></div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

