import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  Film,
  TriangleAlert,
  LoaderCircle,
} from 'lucide-react';
import { timecode } from '../lib/editor';
import { fileSrc } from '../lib/ipc';
import { useCardStates, type CardState } from '../lib/storyboardFrames';

export interface StoryboardScene {
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
  mediaSource?: 'generate' | 'download' | 'existing';
}

export type BlueprintAssetStatus = 'pending' | 'generating' | 'ready';

export interface BlueprintSceneView {
  start: number;
  end: number;
  narration: string;
  visual: string;
  mediaSource: 'generate' | 'download' | 'existing';
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
  /** 'panel' lays the cards out inline (the Storyboard panel); 'chat' is the strip above the chat. */
  variant?: 'chat' | 'panel';
}

/** A card's picture: the frame, its progress, its error, or the buttons that make one. */
function CardThumb({ scene, index, state, aspect, onRequest, onSeek, compact = false }: {
  scene: StoryboardScene;
  index: number;
  state: CardState | undefined;
  aspect: number;
  onRequest?: (kind: 'auto' | 'edit' | 'concept', indices?: number[]) => void;
  onSeek?: (seconds: number) => void;
  compact?: boolean;
}) {
  const busy = state && state.status !== 'error';
  const label = busy
    ? state.status === 'queued' ? 'Queued' : state.kind === 'edit' ? 'Rendering from the edit…' : `Generating concept… ${Math.round(state.progress * 100)}%`
    : null;
  const ask = (kind: 'auto' | 'edit' | 'concept') => (event: React.MouseEvent) => { event.stopPropagation(); onRequest?.(kind, [index]); };
  return (
    <div className={`sb-thumb${compact ? ' compact' : ''}`} style={{ aspectRatio: String(aspect) }}>
      {scene.thumbnail && <img src={fileSrc(scene.thumbnail)} alt={scene.title || `Scene ${index + 1}`} draggable={false} onClick={() => onSeek?.(scene.start)} />}
      {busy ? (
        <div className="sb-thumb-state working"><LoaderCircle size={compact ? 13 : 18} className="spin" /><span>{label}</span></div>
      ) : state?.status === 'error' ? (
        <div className="sb-thumb-state error" title={state.error}>
          <TriangleAlert size={compact ? 13 : 16} />
          <span>{state.kind === 'edit' ? 'Could not render this frame' : 'Could not generate a concept'}</span>
          {!compact && <small>{state.error.slice(0, 140)}</small>}
          <button type="button" className="sb-thumb-btn" onClick={ask(state.kind)}><RotateCw size={11} /> Retry</button>
        </div>
      ) : scene.thumbnail ? (
        <div className="sb-thumb-actions">
          <button type="button" className="sb-thumb-btn" onClick={(event) => { event.stopPropagation(); onSeek?.(scene.start); }} title="Move the playhead to this scene"><Play size={11} fill="currentColor" /> Seek</button>
          <button type="button" className="sb-thumb-btn" onClick={ask('edit')} title="Show this moment of the edit"><Film size={11} /> From edit</button>
          <button type="button" className="sb-thumb-btn" onClick={ask('concept')} title="Generate a concept frame with the local image model"><Sparkles size={11} /> Concept</button>
        </div>
      ) : (
        <div className="sb-thumb-empty">
          {!compact && <ImageIcon size={18} />}
          {!compact && <p>{scene.visual || scene.intent}</p>}
          <div className="sb-thumb-row">
            <button type="button" className="sb-thumb-btn primary" onClick={ask('auto')} title="From the edit where the scene has footage, otherwise a generated concept"><Sparkles size={11} /> Make frame</button>
            {!compact && <button type="button" className="sb-thumb-btn" onClick={ask('concept')} title="Generate a concept frame with the local image model"><ImageIcon size={11} /> Concept</button>}
          </div>
        </div>
      )}
    </div>
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
  variant = 'chat',
}: StoryboardViewerProps) {
  const [mode, setMode] = useState<ViewMode>('small');
  const [activeTab, setActiveTab] = useState<FullscreenTab>('storyboard');
  const [selectedSceneIndex, setSelectedSceneIndex] = useState<number>(0);
  const cardState = useCardStates(compId);

  const cardRefs = useRef<(HTMLElement | null)[]>([]);

  // Blueprint mode: scenes come from the production plan, with the narration
  // as the intent and per-scene asset status attached for progress display.
  const isBlueprint = !!blueprint && blueprint.scenes.length > 0;
  const displayScenes: StoryboardScene[] = isBlueprint && blueprint
    ? blueprint.scenes.map((s) => ({
        start: s.start,
        end: s.end,
        intent: s.narration,
        description: s.narration,
        visual: s.visual,
        audio: s.audio,
        evidence: s.mediaSource === 'generate' ? 'To generate' : s.mediaSource === 'download' ? 'To download' : 'Existing asset',
        thumbnail: s.thumbnail,
        refs: s.refs,
        status: s.status ?? 'pending',
        mediaSource: s.mediaSource,
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

  // Escape collapses from either chat-expanded or fullscreen to small
  useEffect(() => {
    if (mode === 'small') return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setMode('small');
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [mode]);

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
  const statusMessage = working ? `Making ${working} frame${working === 1 ? '' : 's'}…` : failed ? `${failed} frame${failed === 1 ? '' : 's'} failed — see the cards` : null;

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

  // 0. PANEL VIEW (the Storyboard panel beside the chat): every card inline, resizable with the panel.
  if (variant === 'panel' && mode !== 'fullscreen') {
    return (
      <div className={`sb-panel ${className}`}>
        <div className="sb-panel-bar">
          <strong>{isBlueprint ? 'Blueprint' : 'Storyboard'}</strong>
          <span className="storyboard-count-pill">{`${scenes.length} scene${scenes.length === 1 ? '' : 's'}`}</span>
          <span className="storyboard-time-range">{timecode(totalDuration, fps)}</span>
          {isBlueprint && progressLabel && <span className="storyboard-count-pill">{progressLabel}</span>}
          <div className="toolbar-spacer" />
          {statusMessage && <span className="sb-panel-status">{statusMessage}</span>}
          <button type="button" className="storyboard-action-btn inside-ai" onClick={generateAllFrames} disabled={!missing.length} title="Frames from the edit where scenes have footage, generated concepts where they do not">
            <Sparkles size={12} />
            <span>{missing.length ? `Make ${missing.length} frame${missing.length === 1 ? '' : 's'}` : 'All frames made'}</span>
          </button>
          <button type="button" className="storyboard-action-btn" onClick={() => setMode('fullscreen')} title="Full screen"><Maximize2 size={12} /></button>
        </div>
        {isBlueprint && onExecuteBlueprint && actionLabel && (
          <div className="sb-panel-action">
            <button type="button" className="storyboard-action-btn highlight" onClick={onExecuteBlueprint} disabled={executing}>
              <Play size={12} fill="currentColor" /><span>{executing ? 'Working…' : actionLabel}</span>
            </button>
          </div>
        )}
        <div className="sb-panel-grid">
          {scenes.map((scene, index) => (
            <article key={`panel-${index}`} className={`sb-panel-card${selectedSceneIndex === index ? ' selected' : ''}`} onClick={() => { setSelectedSceneIndex(index); onSeek?.(scene.start); }}>
              <div className="sb-panel-card-top">
                <span className="fs-scene-num-badge">{index + 1}</span>
                <h4 title={scene.title || scene.intent}>{scene.title || scene.intent}</h4>
                <span className="sb-panel-time">{timecode(scene.start, fps)} · {Math.max(0, scene.end - scene.start).toFixed(1)}s</span>
              </div>
              <CardThumb scene={scene} index={index} state={cardState(index)} aspect={aspect} onRequest={onRequestFrames} onSeek={onSeek} />
              <p className="sb-panel-intent">{scene.description || scene.intent}</p>
              {scene.visual && <p className="sb-panel-detail"><Eye size={11} /> {scene.visual}</p>}
              {scene.audio && <p className="sb-panel-detail"><Volume2 size={11} /> {scene.audio}</p>}
            </article>
          ))}
        </div>
      </div>
    );
  }

  // 1. SMALL VIEW (Compact widget in chat)
  if (mode === 'small') {
    return (
      <div
        className={`storyboard-widget small ${className}`}
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
        <div className="storyboard-small-left">
          <span className="storyboard-badge-icon" aria-hidden="true">
            <Clapperboard size={13} />
          </span>
          <strong className="storyboard-title">{isBlueprint ? 'Blueprint' : 'Storyboard'}</strong>
          <span className="storyboard-count-pill">{`${scenes.length} scene${scenes.length === 1 ? '' : 's'}`}</span>
          <span className="storyboard-time-range">{`${timecode(0, fps)} – ${timecode(totalDuration, fps)}`}</span>
          {isBlueprint && progressLabel && <span className="storyboard-count-pill">{progressLabel}</span>}
          {firstIntent && <span className="storyboard-preview-snippet">{firstIntent}</span>}
        </div>
        <div className="storyboard-small-right">
          <button
            type="button"
            className="storyboard-action-btn"
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
      </div>
    );
  }

  // 2. CHAT-EXPANDED VIEW (in chat panel, 1 click away from Full Screen)
  if (mode === 'chat-expanded') {
    return (
      <div className={`storyboard-widget expanded ${className}`} role="region" aria-label="Storyboard in chat">
        <div className="storyboard-expanded-header">
          <div
            className="storyboard-header-info"
            role="button"
            tabIndex={0}
            onClick={() => setMode('fullscreen')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setMode('fullscreen');
              }
            }}
            title="Click to open Full Screen"
          >
            <span className="storyboard-badge-icon" aria-hidden="true">
              <Clapperboard size={14} />
            </span>
            <strong className="storyboard-title">Storyboard</strong>
            <span className="storyboard-count-pill">{`${scenes.length} planned scene${scenes.length === 1 ? '' : 's'}`}</span>
            <span className="storyboard-time-range">{`${timecode(0, fps)} – ${timecode(totalDuration, fps)}`}</span>
            {isBlueprint && progressLabel && <span className="storyboard-count-pill">{progressLabel}</span>}
          </div>
          <div className="storyboard-header-actions">
            <button
              type="button"
              className="storyboard-action-btn highlight"
              onClick={() => setMode('fullscreen')}
              title="Click to view full screen (one more click)"
              aria-label="Make storyboard full screen"
            >
              <Maximize2 size={12} />
              <span>Full Screen</span>
            </button>
            <button
              type="button"
              className="storyboard-action-btn"
              onClick={() => setMode('small')}
              title="Collapse to small form (Esc)"
              aria-label="Collapse storyboard"
            >
              <ChevronUp size={13} />
              <span>Collapse</span>
            </button>
          </div>
        </div>

        <div className="storyboard-scenes-scroll" tabIndex={0} role="feed" aria-label="Planned scenes list">
          {isBlueprint && blueprint && (
            <div className="storyboard-blueprint-panel" role="region" aria-label="Video blueprint">
              <div className="storyboard-blueprint-title-row">
                <strong>{blueprint.title || 'Video Blueprint'}</strong>
                {blueprint.status && <span className="storyboard-count-pill">{blueprint.status}</span>}
              </div>
              <p className="storyboard-blueprint-script">{blueprint.script}</p>
              <div className="storyboard-blueprint-meta">
                {narratorLabel && <span>{narratorLabel}</span>}
                {progressLabel && <span>{progressLabel}</span>}
                {blueprint.style?.palette && blueprint.style.palette.length > 0 && (
                  <span>Palette: {blueprint.style.palette.join(', ')}</span>
                )}
              </div>
              {onExecuteBlueprint && actionLabel && (
                <button
                  type="button"
                  className="storyboard-action-btn highlight"
                  onClick={onExecuteBlueprint}
                  disabled={executing}
                  title={actionLabel}
                >
                  <Play size={12} fill="currentColor" />
                  <span>{executing ? 'Working…' : actionLabel}</span>
                </button>
              )}
            </div>
          )}
          {scenes.map((scene, index) => {
            const durationSec = Math.max(0, scene.end - scene.start);

            return (
              <article key={`${index}-${scene.start}`} className="storyboard-scene-card">
                <div className="storyboard-scene-top">
                  <span className="storyboard-scene-num">Scene {index + 1}</span>
                  {isBlueprint && scene.status && (
                    <span className="storyboard-count-pill" title="Asset status">{scene.status}</span>
                  )}
                  {isBlueprint && scene.mediaSource && (
                    <span className="storyboard-count-pill" title="Media source">{scene.mediaSource}</span>
                  )}
                  <button
                    type="button"
                    className="storyboard-timecode-btn"
                    onClick={() => onSeek?.(scene.start)}
                    title={`Seek timeline to ${timecode(scene.start, fps)}`}
                  >
                    <Play size={10} fill="currentColor" />
                    <span>{timecode(scene.start, fps)} – {timecode(scene.end, fps)}</span>
                    <span className="storyboard-scene-duration">({durationSec.toFixed(1)}s)</span>
                  </button>
                </div>

                {scene.title && <h5 className="storyboard-card-title">{scene.title}</h5>}

                <CardThumb scene={scene} index={index} state={cardState(index)} aspect={aspect} onRequest={onRequestFrames} onSeek={onSeek} compact />

                <p className="storyboard-intent">{scene.description || scene.intent}</p>
                <div className="storyboard-details-grid">
                  {scene.visual && (
                    <div className="storyboard-detail-row visual">
                      <span className="detail-icon" title="Visual direction"><Eye size={12} /></span>
                      <span className="detail-text"><strong>VISUAL:</strong> {scene.visual}</span>
                    </div>
                  )}
                  {scene.audio && (
                    <div className="storyboard-detail-row audio">
                      <span className="detail-icon" title="Sound cue"><Volume2 size={12} /></span>
                      <span className="detail-text"><strong>AUDIO:</strong> {scene.audio}</span>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>

        <div className="storyboard-expanded-footer">
          <span>Click <strong>Full Screen</strong> for full production view · Press <kbd className="storyboard-kbd">Esc</kbd> to collapse</span>
        </div>
      </div>
    );
  }

  // 3. FULLSCREEN VIEW (Matches user's screenshot exactly!)
  return createPortal(
    <div
      className="storyboard-fullscreen-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Storyboard Full Screen View"
    >
      <div className="storyboard-fullscreen-container">
        {/* Top Header Bar */}
        <header className="storyboard-fullscreen-header">
          {/* Left Title & Metadata */}
          <div className="fullscreen-header-left">
            <span className="storyboard-badge-icon large" aria-hidden="true">
              <Clapperboard size={18} />
            </span>
            <div className="fullscreen-title-group">
              <h2 className="fullscreen-title">
                Storyboard <span className="title-bullet">•</span> <span className="comp-name">{compName}</span>
              </h2>
              <div className="fullscreen-meta">
                <span className="storyboard-count-pill">{`${scenes.length} scenes`}</span>
                <span className="storyboard-time-range">{timecode(totalDuration, fps)}</span>
                <span className="fullscreen-saved-tag">☁ Saved just now</span>
                {isBlueprint && progressLabel && <span className="storyboard-count-pill">{progressLabel}</span>}
                {statusMessage && <span className="fullscreen-status-live">{statusMessage}</span>}
              </div>
            </div>
          </div>

          {/* Center Tabs: Storyboard | Timeline | List */}
          <div className="fullscreen-tabs" role="tablist">
            <button
              type="button"
              className={`fs-tab-btn ${activeTab === 'storyboard' ? 'active' : ''}`}
              onClick={() => setActiveTab('storyboard')}
              role="tab"
              aria-selected={activeTab === 'storyboard'}
            >
              <LayoutGrid size={13} />
              <span>Storyboard</span>
            </button>
            <button
              type="button"
              className={`fs-tab-btn ${activeTab === 'timeline' ? 'active' : ''}`}
              onClick={() => setActiveTab('timeline')}
              role="tab"
              aria-selected={activeTab === 'timeline'}
            >
              <Clock size={13} />
              <span>Timeline</span>
            </button>
            <button
              type="button"
              className={`fs-tab-btn ${activeTab === 'list' ? 'active' : ''}`}
              onClick={() => setActiveTab('list')}
              role="tab"
              aria-selected={activeTab === 'list'}
            >
              <List size={13} />
              <span>List</span>
            </button>
          </div>

          {/* Right Action Buttons */}
          <div className="fullscreen-header-right">
            <button
              type="button"
              className="storyboard-action-btn"
              onClick={onPlayToggle}
              title="Toggle timeline playback"
            >
              {isPlaying ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}
              <span>{isPlaying ? 'Pause' : 'Preview'}</span>
            </button>

            {onExecuteBlueprint && actionLabel && (
              <button
                type="button"
                className="storyboard-action-btn highlight"
                onClick={onExecuteBlueprint}
                disabled={executing}
                title={actionLabel}
              >
                <Play size={13} fill="currentColor" />
                <span>{executing ? 'Working…' : actionLabel}</span>
              </button>
            )}

            <button
              type="button"
              className="storyboard-action-btn inside-ai"
              onClick={generateAllFrames}
              disabled={!missing.length}
              title="Frames from the edit where scenes have footage, generated concepts where they do not"
            >
              <Sparkles size={13} />
              <span>{missing.length ? `Make ${missing.length} frame${missing.length === 1 ? '' : 's'}` : 'All frames made'}</span>
            </button>

            <button
              type="button"
              className="storyboard-action-btn export-btn"
              onClick={handleExport}
              title="Export storyboard as JSON"
            >
              <Download size={13} />
              <span>Export</span>
            </button>

            <button
              type="button"
              className="storyboard-close-btn"
              onClick={() => setMode('small')}
              title="Close full screen (Esc)"
              aria-label="Close full screen"
            >
              <X size={18} />
            </button>
          </div>
        </header>

        {/* Main Content Body */}
        <main className="storyboard-fullscreen-body" tabIndex={0}>
          {/* TAB 1: STORYBOARD (3x3 Grid of Scene Cards) */}
          {activeTab === 'storyboard' && (
            <div className="storyboard-fullscreen-grid">
              {scenes.map((scene, index) => {
                const durationSec = Math.max(0, scene.end - scene.start);
                const isSelected = selectedSceneIndex === index;

                return (
                  <article
                    key={`fs-card-${index}`}
                    ref={(el) => { cardRefs.current[index] = el; }}
                    className={`storyboard-fs-card ${isSelected ? 'selected' : ''}`}
                    onClick={() => setSelectedSceneIndex(index)}
                  >
                    {/* Card Header: Scene number, Title, Timecode, Duration */}
                    <div className="fs-card-top-bar">
                      <div className="fs-card-title-group">
                        <span className="fs-scene-num-badge">{index + 1}</span>
                        <h4 className="fs-scene-title" title={scene.title || scene.intent}>
                          {scene.title || scene.intent}
                        </h4>
                        {isBlueprint && scene.status && (
                          <span className="storyboard-count-pill" title="Asset status">{scene.status}</span>
                        )}
                        {isBlueprint && scene.mediaSource && (
                          <span className="storyboard-count-pill" title="Media source">{scene.mediaSource}</span>
                        )}
                      </div>
                      <div className="fs-card-time-group">
                        <button
                          type="button"
                          className="fs-timecode-pill"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSeek?.(scene.start);
                            setSelectedSceneIndex(index);
                          }}
                          title={`Seek timeline to ${timecode(scene.start, fps)}`}
                        >
                          {timecode(scene.start, fps)} – {timecode(scene.end, fps)}
                        </button>
                        <span className="fs-duration-text">{durationSec.toFixed(1)}s</span>
                      </div>
                    </div>

                    <CardThumb scene={scene} index={index} state={cardState(index)} aspect={aspect} onRequest={onRequestFrames} onSeek={onSeek} />

                    {/* Narrative Description */}
                    <p className="fs-card-description">
                      {scene.description || scene.intent}
                    </p>

                    {/* VISUAL & AUDIO Tag Rows */}
                    <div className="fs-card-tag-rows">
                      {scene.visual && (
                        <div className="fs-tag-row visual">
                          <span className="fs-tag-label">
                            <Eye size={11} />
                            <span>VISUAL</span>
                          </span>
                          <span className="fs-tag-value">{scene.visual}</span>
                        </div>
                      )}
                      {scene.audio && (
                        <div className="fs-tag-row audio">
                          <span className="fs-tag-label">
                            <Volume2 size={11} />
                            <span>AUDIO</span>
                          </span>
                          <span className="fs-tag-value">{scene.audio}</span>
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {/* TAB 2: TIMELINE (Proportional horizontal block view) */}
          {activeTab === 'timeline' && (
            <div className="storyboard-timeline-view">
              <div className="storyboard-timeline-ruler">
                <span>00:00:00</span>
                <span>{timecode(totalDuration / 2, fps)}</span>
                <span>{timecode(totalDuration, fps)}</span>
              </div>
              <div className="storyboard-timeline-track">
                {scenes.map((scene, index) => {
                  const durationSec = Math.max(0, scene.end - scene.start);
                  const pct = totalDuration > 0 ? (durationSec / totalDuration) * 100 : 100 / scenes.length;
                  const isSelected = selectedSceneIndex === index;

                  return (
                    <div
                      key={`tl-${index}`}
                      className={`timeline-scene-block ${isSelected ? 'active' : ''}`}
                      style={{ width: `${pct}%` }}
                      onClick={() => scrollToScene(index)}
                      title={`Scene ${index + 1}: ${scene.title || scene.intent} (${durationSec.toFixed(1)}s)`}
                    >
                      <span className="tl-block-num">{index + 1}</span>
                      <span className="tl-block-title">{scene.title || scene.intent}</span>
                      <span className="tl-block-time">{durationSec.toFixed(1)}s</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 3: LIST (Dense tabular view) */}
          {activeTab === 'list' && (
            <div className="storyboard-list-table-container">
              <table className="storyboard-list-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Scene Title & Narrative</th>
                    <th>Timecode</th>
                    <th>Duration</th>
                    <th>Visual Direction</th>
                    <th>Sound Design</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {scenes.map((scene, index) => {
                    const durationSec = Math.max(0, scene.end - scene.start);
                    return (
                      <tr
                        key={`row-${index}`}
                        className={selectedSceneIndex === index ? 'selected' : ''}
                        onClick={() => scrollToScene(index)}
                      >
                        <td className="row-num">{index + 1}</td>
                        <td className="row-title">
                          <strong>{scene.title || `Scene ${index + 1}`}</strong>
                          <p>{scene.description || scene.intent}</p>
                        </td>
                        <td className="row-time">{`${timecode(scene.start, fps)} – ${timecode(scene.end, fps)}`}</td>
                        <td className="row-dur">{durationSec.toFixed(1)}s</td>
                        <td className="row-vis">{scene.visual}</td>
                        <td className="row-aud">{scene.audio}</td>
                        <td className="row-action">
                          <button
                            type="button"
                            className="storyboard-action-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              onSeek?.(scene.start);
                            }}
                          >
                            <Play size={11} fill="currentColor" />
                            <span>Seek</span>
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

        {/* Bottom Filmstrip Navigation Bar */}
        <footer className="storyboard-fullscreen-filmstrip">
          <div className="filmstrip-scroll">
            {scenes.map((scene, index) => {
              const isSelected = selectedSceneIndex === index;
              return (
                <div
                  key={`filmstrip-${index}`}
                  className={`filmstrip-card ${isSelected ? 'active' : ''}`}
                  onClick={() => scrollToScene(index)}
                  title={`Scene ${index + 1}: ${scene.title || scene.intent}`}
                >
                  <span className="filmstrip-badge">{index + 1}</span>
                  {scene.thumbnail ? (
                    <img
                      src={fileSrc(scene.thumbnail)}
                      alt={`Scene ${index + 1}`}
                      className="filmstrip-thumb-img"
                    />
                  ) : (
                    <div className="filmstrip-thumb-placeholder">
                      <span>{index + 1}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
