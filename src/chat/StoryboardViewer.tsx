import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import {
  Clapperboard,
  Maximize2,
  ChevronDown,
  ChevronUp,
  Play,
  Pause,
  Eye,
  Volume2,
  X,
  Sparkles,
  Download,
  LayoutGrid,
  List,
  Clock,
  RotateCw,
  Image as ImageIcon,
  ImageUp,
  Film,
  TriangleAlert,
  LoaderCircle,
  PenLine,
  Layers,
  ArrowRightLeft,
  AudioLines,
} from 'lucide-react';
import { timecode } from '../lib/editor';
import { api, errorText, fileSrc } from '../lib/ipc';
import { parseSketch, type SketchDoc } from '../lib/sketch';
import { useCardStates, type CardState } from '../lib/storyboardFrames';
import { StoryboardSketch } from './StoryboardSketch';
import '../styles/storyboard.css';

/** Per-beat production detail the cards show as chips (mirrors lib/types ProductionBeat, loosely). */
type BeatDetail = {
  mogrt?: { template: string; headline?: string; layout?: string } | null;
  transition?: { kind: string; duration?: number; onBeat?: boolean } | null;
  sfx?: string[];
  framing?: string;
  /** The card's hand-drawn sketch (lib/sketch SketchDoc), kept editable. */
  sketch?: unknown;
};

export interface StoryboardScene extends BeatDetail {
  start: number;
  end: number;
  title?: string;
  intent: string;
  description?: string;
  visual: string;
  audio: string;
  evidence: string;
  prompt?: string;
  thumbnail?: string;
  refs?: string[];
  /** Blueprint asset state for this scene (blueprint mode only). */
  status?: 'pending' | 'generating' | 'ready';
  /** Where this scene's visual comes from (blueprint mode only). */
  mediaSource?: 'generate' | 'download' | 'existing' | 'render';
}

export type BlueprintAssetStatus = 'pending' | 'generating' | 'ready';

export interface BlueprintSceneView extends BeatDetail {
  start: number;
  end: number;
  title?: string;
  narration: string;
  visual: string;
  mediaSource: 'generate' | 'download' | 'existing' | 'render';
  audio: string;
  status?: BlueprintAssetStatus;
  thumbnail?: string;
  refs?: string[];
}

export interface BlueprintView {
  title?: string;
  script: string;
  narrator?: { voice?: string; speed?: number; mode?: string };
  scenes: BlueprintSceneView[];
  assets?: { kind: string; description: string; status?: BlueprintAssetStatus; assetId?: string }[];
  style?: { palette?: string[]; typography?: string; lighting?: string };
  status?: string;
}

/** A hand-made card picture: a sketch's PNG (with its document) or an uploaded photo (sketch null). */
export type CardPicture = { thumbnail: string; sketch?: SketchDoc | null };

export interface StoryboardViewerProps {
  scenes: StoryboardScene[];
  fps?: number;
  compName?: string;
  onSeek?: (seconds: number) => void;
  onPlayToggle?: () => void;
  isPlaying?: boolean;
  className?: string;
  /** Blueprint-first production plan (from-scratch creation). When present, the viewer shows script + asset status + a Generate Video button. */
  blueprint?: BlueprintView | null;
  /** Fires the "Generate Video" approval — the host sends an execute prompt to the AI. */
  onExecuteBlueprint?: () => void;
  /** True while the blueprint execution turn is running. */
  executing?: boolean;
  /** The phase button's label ('Start generating', 'Start editing'); null hides the button. */
  actionLabel?: string | null;
  /** The comp these scenes belong to: card pictures are queued and tracked per comp. */
  compId?: string;
  /** width / height of the comp, so card pictures keep its shape. */
  aspect?: number;
  /**
   * Asks the app for card pictures: 'edit' renders the timeline at the scene, 'concept' generates
   * one with the local image model, 'auto' picks by whether the scene has footage yet. No indices
   * means every card without a picture.
   */
  onRequestFrames?: (kind: 'auto' | 'edit' | 'concept', indices?: number[]) => void;
  /** Stores a picture the user made by hand (sketch or photo) on a card. Absent hides Draw / Photo. */
  onCardPicture?: (index: number, picture: CardPicture) => void;
  /** 'panel' lays the cards out inline (the Storyboard panel); 'chat' is the strip above the chat. */
  variant?: 'chat' | 'panel';
}

type Ask = (kind: 'auto' | 'edit' | 'concept', indices?: number[]) => void;

/** A card's picture: the frame, its progress, its error, or the buttons that make one. */
function CardThumb({ scene, index, state, aspect, onRequest, onSeek, onDraw, onPhoto, compact = false }: {
  scene: StoryboardScene;
  index: number;
  state: CardState | undefined;
  aspect: number;
  onRequest?: Ask;
  onSeek?: (seconds: number) => void;
  onDraw?: (index: number) => void;
  onPhoto?: (index: number) => void;
  compact?: boolean;
}) {
  const busy = state && state.status !== 'error';
  const label = busy
    ? state.status === 'queued' ? 'Queued' : state.kind === 'edit' ? 'Rendering from the edit…' : `Generating concept… ${Math.round(state.progress * 100)}%`
    : null;
  const stop = (run: () => void) => (event: React.MouseEvent) => { event.stopPropagation(); run(); };
  const ask = (kind: 'auto' | 'edit' | 'concept') => stop(() => onRequest?.(kind, [index]));
  const duration = Math.max(0, scene.end - scene.start);
  // Portrait comps get a squarer box with the whole picture inside, so a card stays readable.
  const hand = (
    <>
      {onDraw && <button type="button" className="sb-thumb-btn" onClick={stop(() => onDraw(index))} title="Draw this card by hand"><PenLine size={11} />{!compact && <span className="sb-btn-label">Draw</span>}</button>}
      {onPhoto && <button type="button" className="sb-thumb-btn" onClick={stop(() => onPhoto(index))} title="Use a photo from disk as this card's picture"><ImageUp size={11} />{!compact && <span className="sb-btn-label">Photo</span>}</button>}
    </>
  );
  return (
    <div className={`sb-thumb${compact ? ' compact' : ''}${aspect < 1 ? ' portrait' : ''}`} style={{ aspectRatio: String(aspect < 1 ? Math.max(aspect, 0.8) : aspect) }}>
      {scene.thumbnail && <img src={fileSrc(scene.thumbnail)} alt={scene.title || `Scene ${index + 1}`} draggable={false} onClick={() => onSeek?.(scene.start)} />}
      <span className="sb-thumb-num">{String(index + 1).padStart(2, '0')}</span>
      <span className="sb-thumb-dur">{duration.toFixed(1)}s</span>
      {!!scene.sketch && <span className="sb-thumb-tag" title="Drawn by hand — Draw to edit"><PenLine size={9} /></span>}
      {busy ? (
        <div className="sb-thumb-state working"><LoaderCircle size={compact ? 13 : 16} className="spin" /><span>{label}</span></div>
      ) : state?.status === 'error' ? (
        <div className="sb-thumb-state error" title={state.error}>
          <TriangleAlert size={compact ? 13 : 15} />
          <span>{state.kind === 'edit' ? 'Could not render this frame' : 'Could not generate a concept'}</span>
          {!compact && <small>{state.error.slice(0, 140)}</small>}
          <div className="sb-thumb-row">
            <button type="button" className="sb-thumb-btn" onClick={ask(state.kind)}><RotateCw size={11} /> Retry</button>
            {hand}
          </div>
        </div>
      ) : scene.thumbnail ? (
        <div className="sb-thumb-actions">
          <button type="button" className="sb-thumb-btn" onClick={stop(() => onSeek?.(scene.start))} title="Move the playhead to this scene"><Play size={11} fill="currentColor" />{!compact && <span className="sb-btn-label">Seek</span>}</button>
          <button type="button" className="sb-thumb-btn" onClick={ask('edit')} title="Show this moment of the edit"><Film size={11} />{!compact && <span className="sb-btn-label">Edit</span>}</button>
          <button type="button" className="sb-thumb-btn" onClick={ask('concept')} title="Generate a concept frame with the local image model"><Sparkles size={11} />{!compact && <span className="sb-btn-label">Concept</span>}</button>
          {hand}
        </div>
      ) : (
        <div className="sb-thumb-empty">
          {!compact && <ImageIcon size={16} />}
          {!compact && <p>{scene.visual || scene.intent}</p>}
          <div className="sb-thumb-row">
            <button type="button" className="sb-thumb-btn primary" onClick={ask('auto')} title="From the edit where the scene has footage, otherwise a generated concept"><Sparkles size={11} /> Make frame</button>
            {!compact && <button type="button" className="sb-thumb-btn" onClick={ask('concept')} title="Generate a concept frame with the local image model"><ImageIcon size={11} /><span className="sb-btn-label">Concept</span></button>}
            {hand}
          </div>
        </div>
      )}
    </div>
  );
}

const statusTone = (status?: string) => (status === 'ready' ? 'tone-ok' : status === 'generating' ? 'tone-warn' : 'tone-off');

/** The beat's production chips: status, source, motion graphic, transition, sound effects. */
function SceneChips({ scene, blueprint }: { scene: StoryboardScene; blueprint: boolean }) {
  const chips: React.ReactNode[] = [];
  if (blueprint && scene.status) chips.push(<span key="status" className={`pill ${statusTone(scene.status)}`} title="Asset status">{scene.status}</span>);
  if (blueprint && scene.mediaSource) chips.push(<span key="source" className="sb-chip" title="Media source">{scene.mediaSource}</span>);
  if (scene.mogrt?.template) chips.push(<span key="mogrt" className="sb-chip mogrt" title={scene.mogrt.headline ? `Motion graphic: ${scene.mogrt.headline}` : 'Motion graphic'}><Layers size={10} />{scene.mogrt.template}</span>);
  if (scene.transition?.kind && scene.transition.kind !== 'cut') chips.push(<span key="transition" className="sb-chip transition" title="Transition into this scene"><ArrowRightLeft size={10} />{scene.transition.kind}{scene.transition.onBeat ? ' · beat' : ''}</span>);
  (scene.sfx ?? []).slice(0, 3).forEach((sfx, i) => chips.push(<span key={`sfx-${i}`} className="sb-chip sfx" title={sfx}><AudioLines size={10} />{sfx}</span>));
  if ((scene.sfx?.length ?? 0) > 3) chips.push(<span key="more" className="sb-chip">+{scene.sfx!.length - 3}</span>);
  return chips.length ? <div className="sb-chips">{chips}</div> : null;
}

/** One scene card — the same layout in the chat strip, the side panel and full screen. */
function SceneCard({ scene, index, fps, compact, blueprint, onSelect, onSeek, thumb }: {
  scene: StoryboardScene;
  index: number;
  fps: number;
  compact?: boolean;
  blueprint: boolean;
  onSelect: () => void;
  onSeek?: (seconds: number) => void;
  thumb: React.ReactNode;
}) {
  const title = scene.title || scene.intent;
  const body = scene.description || scene.intent;
  return (
    <>
      {thumb}
      <div className="sb-card-body">
        <div className="sb-card-head">
          <h4 title={title}>{title || `Scene ${index + 1}`}</h4>
          <button
            type="button"
            className="sb-tc"
            onClick={(event) => { event.stopPropagation(); onSelect(); onSeek?.(scene.start); }}
            title={`Seek to ${timecode(scene.start, fps)}`}
          >
            {timecode(scene.start, fps)}
          </button>
        </div>
        {body && body !== title && <p className={`sb-card-intent${compact ? ' clamp' : ''}`}>{body}</p>}
        {(scene.visual || scene.audio) && (
          <div className="sb-card-lines">
            {scene.visual && <p title={scene.visual}><Eye size={11} /><span>{scene.visual}</span></p>}
            {scene.audio && <p title={scene.audio}><Volume2 size={11} /><span>{scene.audio}</span></p>}
          </div>
        )}
        <SceneChips scene={scene} blueprint={blueprint} />
      </div>
    </>
  );
}

type ViewMode = 'small' | 'chat-expanded' | 'fullscreen';
type FullscreenTab = 'storyboard' | 'timeline' | 'list';

export function StoryboardViewer({
  scenes: scenesProp,
  fps = 30,
  compName = 'Main Composition',
  onSeek,
  onPlayToggle,
  isPlaying = false,
  className = '',
  blueprint = null,
  onExecuteBlueprint,
  executing = false,
  actionLabel = 'Generate Video',
  compId,
  aspect = 16 / 9,
  onRequestFrames,
  onCardPicture,
  variant = 'chat',
}: StoryboardViewerProps) {
  const [mode, setMode] = useState<ViewMode>('small');
  const [activeTab, setActiveTab] = useState<FullscreenTab>('storyboard');
  const [selectedSceneIndex, setSelectedSceneIndex] = useState<number>(0);
  const [sketchIndex, setSketchIndex] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const cardState = useCardStates(compId);

  const cardRefs = useRef<(HTMLElement | null)[]>([]);

  // Blueprint mode: scenes come from the production plan, with the narration
  // as the intent and per-scene asset status attached for progress display.
  const isBlueprint = !!blueprint && blueprint.scenes.length > 0;
  const displayScenes: StoryboardScene[] = isBlueprint && blueprint
    ? blueprint.scenes.map((s) => ({
        start: s.start,
        end: s.end,
        title: s.title,
        intent: s.narration,
        description: s.narration,
        visual: s.visual,
        audio: s.audio,
        evidence: s.mediaSource === 'generate' ? 'To generate' : s.mediaSource === 'download' ? 'To download' : 'Existing asset',
        thumbnail: s.thumbnail,
        refs: s.refs,
        status: s.status ?? 'pending',
        mediaSource: s.mediaSource,
        mogrt: s.mogrt,
        transition: s.transition,
        sfx: s.sfx,
        framing: s.framing,
        sketch: s.sketch,
      }))
    : scenesProp;
  const readyCount = isBlueprint && blueprint
    ? (blueprint.assets?.length
        ? blueprint.assets.filter((a) => a.status === 'ready').length
        : blueprint.scenes.filter((s) => s.status === 'ready').length)
    : 0;
  const totalAssets = isBlueprint && blueprint
    ? (blueprint.assets?.length ?? blueprint.scenes.length)
    : 0;
  const progressLabel = isBlueprint ? `${readyCount}/${totalAssets} assets ready` : null;
  const narratorLabel = blueprint?.narrator?.voice
    ? `Voice: ${blueprint.narrator.voice}${blueprint.narrator.speed ? ` · ${blueprint.narrator.speed}x` : ''}`
    : null;
  // The single array every view below renders. In blueprint mode it is derived
  // from the production plan; otherwise it is the saved storyboard as before.
  const scenes: StoryboardScene[] = displayScenes;

  // Escape collapses from either chat-expanded or fullscreen to small (the sketch editor handles its own).
  useEffect(() => {
    if (mode === 'small' || sketchIndex !== null) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setMode('small');
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [mode, sketchIndex]);

  if (!scenes || !scenes.length) return null;

  const totalDuration = scenes[scenes.length - 1]?.end ?? 0;
  const firstIntent = scenes[0]?.title || scenes[0]?.intent
    ? `“${(scenes[0]?.title || scenes[0]?.intent || '').slice(0, 36)}${(scenes[0]?.title || scenes[0]?.intent || '').length > 36 ? '…' : ''}”`
    : '';

  // Card pictures come from the app's frame queue (lib/storyboardFrames): one at a time, written
  // into the current project per scene, with progress and errors per card.
  const missing = scenes.map((scene, index) => (scene.thumbnail ? -1 : index)).filter((index) => index >= 0);
  const generateAllFrames = () => onRequestFrames?.('auto', missing);
  const states = scenes.map((_, index) => cardState(index));
  const working = states.filter((state) => state && state.status !== 'error').length;
  const failed = states.filter((state) => state?.status === 'error').length;
  const statusMessage = notice ?? (working ? `Making ${working} frame${working === 1 ? '' : 's'}…` : failed ? `${failed} frame${failed === 1 ? '' : 's'} failed — see the cards` : null);

  // Hand-made pictures: a sketch drawn in the editor, or a photo copied in from disk.
  const handMade = !!(onCardPicture && compId);
  const openSketch = handMade ? (index: number) => { setSelectedSceneIndex(index); setSketchIndex(index); } : undefined;
  const uploadPhoto = handMade ? (index: number) => {
    setNotice(null);
    void (async () => {
      try {
        const picked = await openDialog({ multiple: false, directory: false, filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }] });
        if (!picked || Array.isArray(picked)) return;
        const path = await api.storyboardImageImport(compId!, index, picked);
        onCardPicture!(index, { thumbnail: path, sketch: null });
      } catch (error) {
        setNotice(`Photo not added: ${errorText(error)}`);
      }
    })();
  } : undefined;
  const saveSketch = async (index: number, doc: SketchDoc, png: Uint8Array) => {
    const path = await api.storyboardImageSave(compId!, index, png);
    onCardPicture!(index, { thumbnail: path, sketch: { ...doc, output: path } });
    setSketchIndex(null);
  };
  const sketchScene = sketchIndex !== null ? scenes[sketchIndex] : undefined;
  const sketchEditor = sketchScene && sketchIndex !== null && handMade ? (
    <StoryboardSketch
      key={`${compId}-${sketchIndex}`}
      sketch={parseSketch(sketchScene.sketch)}
      frame={sketchScene.thumbnail}
      aspect={aspect}
      title={`Scene ${sketchIndex + 1}${sketchScene.title ? ` · ${sketchScene.title}` : ''}`}
      compId={compId!}
      sceneIndex={sketchIndex}
      onSave={(doc, png) => saveSketch(sketchIndex, doc, png)}
      onClose={() => setSketchIndex(null)}
    />
  ) : null;

  const thumbFor = (scene: StoryboardScene, index: number, compact = false) => (
    <CardThumb scene={scene} index={index} state={cardState(index)} aspect={aspect} onRequest={onRequestFrames} onSeek={onSeek} onDraw={openSketch} onPhoto={uploadPhoto} compact={compact} />
  );

  // Export storyboard as JSON
  const handleExport = () => {
    const data = JSON.stringify({ compName, totalDuration, scenes }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `storyboard-${compName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const scrollToScene = (index: number) => {
    setSelectedSceneIndex(index);
    const scene = scenes[index];
    if (scene) onSeek?.(scene.start);
    const el = cardRefs.current[index];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  };

  const countLabel = `${scenes.length} scene${scenes.length === 1 ? '' : 's'}`;
  const makeFramesButton = (
    <button type="button" className="btn btn-small" onClick={generateAllFrames} disabled={!missing.length} title="Frames from the edit where scenes have footage, generated concepts where they do not">
      <Sparkles size={12} />
      <span>{missing.length ? `Make ${missing.length} frame${missing.length === 1 ? '' : 's'}` : 'All frames made'}</span>
    </button>
  );
  const executeButton = (size: number) => onExecuteBlueprint && actionLabel ? (
    <button type="button" className="btn btn-small btn-primary" onClick={onExecuteBlueprint} disabled={executing} title={actionLabel}>
      <Play size={size} fill="currentColor" /><span>{executing ? 'Working…' : actionLabel}</span>
    </button>
  ) : null;

  const cardList = (keyPrefix: string, compact: boolean, withRefs = false) => scenes.map((scene, index) => (
    <article
      key={`${keyPrefix}-${index}`}
      ref={withRefs ? (el) => { cardRefs.current[index] = el; } : undefined}
      className={`sb-card${selectedSceneIndex === index ? ' selected' : ''}${compact ? ' compact' : ''}`}
      onClick={() => { setSelectedSceneIndex(index); if (keyPrefix === 'panel') onSeek?.(scene.start); }}
    >
      <SceneCard scene={scene} index={index} fps={fps} compact={compact} blueprint={isBlueprint} onSelect={() => setSelectedSceneIndex(index)} onSeek={onSeek} thumb={thumbFor(scene, index, compact)} />
    </article>
  ));

  // 0. PANEL VIEW (the Storyboard panel beside the chat): every card inline, resizable with the panel.
  if (variant === 'panel' && mode !== 'fullscreen') {
    return (
      <div className={`sb-panel ${className}`}>
        <div className="sb-bar">
          <Clapperboard size={13} className="sb-bar-icon" />
          <strong>{isBlueprint ? 'Blueprint' : 'Storyboard'}</strong>
          <span className="sb-meta">{countLabel}</span>
          <span className="sb-meta sb-mono">{timecode(totalDuration, fps)}</span>
          {isBlueprint && progressLabel && <span className="sb-meta">{progressLabel}</span>}
          <div className="toolbar-spacer" />
          {makeFramesButton}
          <button type="button" className="icon-btn small" onClick={() => setMode('fullscreen')} title="Full screen"><Maximize2 size={13} /></button>
        </div>
        {statusMessage && <div className={`sb-status${notice ? ' error' : ''}`}>{statusMessage}</div>}
        {isBlueprint && onExecuteBlueprint && actionLabel && <div className="sb-action-row">{executeButton(12)}</div>}
        <div className="sb-grid panel">{cardList('panel', false)}</div>
        {sketchEditor}
      </div>
    );
  }

  // 1. SMALL VIEW (Compact widget in chat)
  if (mode === 'small') {
    return (
      <div
        className={`sb-strip small ${className}`}
        role="button"
        tabIndex={0}
        onClick={() => setMode('chat-expanded')}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setMode('chat-expanded');
          }
        }}
        title="Click to expand storyboard in chat"
        aria-label={`Storyboard with ${scenes.length} planned scenes. Click to expand.`}
      >
        <Clapperboard size={13} className="sb-bar-icon" />
        <strong>{isBlueprint ? 'Blueprint' : 'Storyboard'}</strong>
        <span className="sb-meta">{countLabel}</span>
        <span className="sb-meta sb-mono">{`${timecode(0, fps)} – ${timecode(totalDuration, fps)}`}</span>
        {isBlueprint && progressLabel && <span className="sb-meta">{progressLabel}</span>}
        {firstIntent && <span className="sb-snippet">{firstIntent}</span>}
        <div className="toolbar-spacer" />
        <button
          type="button"
          className="btn btn-small btn-ghost"
          onClick={(e) => {
            e.stopPropagation();
            setMode('chat-expanded');
          }}
          title="Expand storyboard in chat"
          aria-label="Expand storyboard in chat"
        >
          <span>Expand</span>
          <ChevronDown size={13} />
        </button>
      </div>
    );
  }

  // 2. CHAT-EXPANDED VIEW (in chat panel, 1 click away from Full Screen)
  if (mode === 'chat-expanded') {
    return (
      <div className={`sb-strip expanded ${className}`} role="region" aria-label="Storyboard in chat">
        <div className="sb-bar">
          <button type="button" className="sb-bar-title" onClick={() => setMode('fullscreen')} title="Open full screen">
            <Clapperboard size={13} className="sb-bar-icon" />
            <strong>Storyboard</strong>
            <span className="sb-meta">{countLabel}</span>
            <span className="sb-meta sb-mono">{`${timecode(0, fps)} – ${timecode(totalDuration, fps)}`}</span>
            {isBlueprint && progressLabel && <span className="sb-meta">{progressLabel}</span>}
          </button>
          <div className="toolbar-spacer" />
          <button type="button" className="icon-btn small" onClick={() => setMode('fullscreen')} title="Full screen" aria-label="Make storyboard full screen"><Maximize2 size={13} /></button>
          <button type="button" className="icon-btn small" onClick={() => setMode('small')} title="Collapse (Esc)" aria-label="Collapse storyboard"><ChevronUp size={14} /></button>
        </div>
        {statusMessage && <div className={`sb-status${notice ? ' error' : ''}`}>{statusMessage}</div>}

        <div className="sb-strip-scroll" tabIndex={0} role="feed" aria-label="Planned scenes list">
          {isBlueprint && blueprint && (
            <div className="sb-blueprint" role="region" aria-label="Video blueprint">
              <div className="sb-blueprint-head">
                <strong>{blueprint.title || 'Video Blueprint'}</strong>
                {blueprint.status && <span className="pill tone-off">{blueprint.status}</span>}
              </div>
              <p className="sb-blueprint-script">{blueprint.script}</p>
              <div className="sb-blueprint-meta">
                {narratorLabel && <span>{narratorLabel}</span>}
                {progressLabel && <span>{progressLabel}</span>}
                {blueprint.style?.palette && blueprint.style.palette.length > 0 && (
                  <span className="sb-palette">
                    {blueprint.style.palette.slice(0, 6).map((colour) => <i key={colour} style={{ background: colour }} title={colour} />)}
                  </span>
                )}
              </div>
              {executeButton(12)}
            </div>
          )}
          <div className="sb-grid strip">{cardList('chat', true)}</div>
        </div>
        {sketchEditor}
      </div>
    );
  }

  // 3. FULLSCREEN VIEW
  return createPortal(
    <div className="sb-fs" role="dialog" aria-modal="true" aria-label="Storyboard Full Screen View">
      <header className="sb-fs-head">
        <div className="sb-fs-title">
          <Clapperboard size={15} className="sb-bar-icon" />
          <h2>Storyboard <span>· {compName}</span></h2>
          <span className="sb-meta">{countLabel}</span>
          <span className="sb-meta sb-mono">{timecode(totalDuration, fps)}</span>
          {isBlueprint && progressLabel && <span className="sb-meta">{progressLabel}</span>}
          {statusMessage && <span className={`sb-fs-status${notice ? ' error' : ''}`}>{statusMessage}</span>}
        </div>

        <div className="segmented sb-fs-tabs" role="tablist">
          <button type="button" className={activeTab === 'storyboard' ? 'active' : ''} onClick={() => setActiveTab('storyboard')} role="tab" aria-selected={activeTab === 'storyboard'}>
            <LayoutGrid size={12} /><span>Storyboard</span>
          </button>
          <button type="button" className={activeTab === 'timeline' ? 'active' : ''} onClick={() => setActiveTab('timeline')} role="tab" aria-selected={activeTab === 'timeline'}>
            <Clock size={12} /><span>Timeline</span>
          </button>
          <button type="button" className={activeTab === 'list' ? 'active' : ''} onClick={() => setActiveTab('list')} role="tab" aria-selected={activeTab === 'list'}>
            <List size={12} /><span>List</span>
          </button>
        </div>

        <div className="sb-fs-actions">
          <button type="button" className="btn btn-small" onClick={onPlayToggle} title="Toggle timeline playback">
            {isPlaying ? <Pause size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" />}
            <span>{isPlaying ? 'Pause' : 'Preview'}</span>
          </button>
          {executeButton(12)}
          {makeFramesButton}
          <button type="button" className="btn btn-small" onClick={handleExport} title="Export storyboard as JSON">
            <Download size={12} /><span>Export</span>
          </button>
          <button type="button" className="icon-btn" onClick={() => setMode('small')} title="Close full screen (Esc)" aria-label="Close full screen">
            <X size={16} />
          </button>
        </div>
      </header>

      <main className="sb-fs-body" tabIndex={0}>
        {activeTab === 'storyboard' && <div className="sb-grid fullscreen">{cardList('fs', false, true)}</div>}

        {activeTab === 'timeline' && (
          <div className="sb-tl">
            <div className="sb-tl-ruler">
              <span>{timecode(0, fps)}</span>
              <span>{timecode(totalDuration / 2, fps)}</span>
              <span>{timecode(totalDuration, fps)}</span>
            </div>
            <div className="sb-tl-track">
              {scenes.map((scene, index) => {
                const durationSec = Math.max(0, scene.end - scene.start);
                const pct = totalDuration > 0 ? (durationSec / totalDuration) * 100 : 100 / scenes.length;
                return (
                  <div
                    key={`tl-${index}`}
                    className={`sb-tl-block${selectedSceneIndex === index ? ' active' : ''}`}
                    style={{ width: `${pct}%` }}
                    onClick={() => scrollToScene(index)}
                    title={`Scene ${index + 1}: ${scene.title || scene.intent} (${durationSec.toFixed(1)}s)`}
                  >
                    {scene.thumbnail && <img src={fileSrc(scene.thumbnail)} alt="" draggable={false} />}
                    <span className="sb-tl-num">{index + 1}</span>
                    <span className="sb-tl-title">{scene.title || scene.intent}</span>
                    <span className="sb-tl-time">{durationSec.toFixed(1)}s</span>
                  </div>
                );
              })}
            </div>
            {scenes[selectedSceneIndex] && (
              <article className="sb-card sb-tl-detail">
                <SceneCard scene={scenes[selectedSceneIndex]} index={selectedSceneIndex} fps={fps} blueprint={isBlueprint} onSelect={() => undefined} onSeek={onSeek} thumb={thumbFor(scenes[selectedSceneIndex], selectedSceneIndex)} />
              </article>
            )}
          </div>
        )}

        {activeTab === 'list' && (
          <div className="sb-list">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Scene</th>
                  <th>Timecode</th>
                  <th>Duration</th>
                  <th>Visual</th>
                  <th>Audio</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {scenes.map((scene, index) => {
                  const durationSec = Math.max(0, scene.end - scene.start);
                  return (
                    <tr key={`row-${index}`} className={selectedSceneIndex === index ? 'selected' : ''} onClick={() => scrollToScene(index)}>
                      <td className="sb-list-num">{index + 1}</td>
                      <td className="sb-list-title">
                        <strong>{scene.title || `Scene ${index + 1}`}</strong>
                        <p>{scene.description || scene.intent}</p>
                      </td>
                      <td className="sb-mono sb-list-tc">{`${timecode(scene.start, fps)} – ${timecode(scene.end, fps)}`}</td>
                      <td className="sb-mono">{durationSec.toFixed(1)}s</td>
                      <td className="sb-list-dim">{scene.visual}</td>
                      <td className="sb-list-dim">{scene.audio}</td>
                      <td>
                        <button type="button" className="btn btn-small btn-ghost" onClick={(e) => { e.stopPropagation(); onSeek?.(scene.start); }}>
                          <Play size={11} fill="currentColor" /><span>Seek</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>

      <footer className="sb-fs-strip">
        {scenes.map((scene, index) => (
          <button
            type="button"
            key={`filmstrip-${index}`}
            className={`sb-fs-frame${selectedSceneIndex === index ? ' active' : ''}`}
            style={{ aspectRatio: String(aspect) }}
            onClick={() => scrollToScene(index)}
            title={`Scene ${index + 1}: ${scene.title || scene.intent}`}
          >
            {scene.thumbnail ? <img src={fileSrc(scene.thumbnail)} alt={`Scene ${index + 1}`} draggable={false} /> : null}
            <span>{index + 1}</span>
          </button>
        ))}
      </footer>
      {sketchEditor}
    </div>,
    document.body,
  );
}
