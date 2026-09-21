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
} from 'lucide-react';
import { timecode } from '../lib/editor';
import { api, errorText, fileSrc } from '../lib/ipc';

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
}

export interface StoryboardViewerProps {
  scenes: StoryboardScene[];
  fps?: number;
  compName?: string;
  onSeek?: (seconds: number) => void;
  onUpdateScenes?: (updatedScenes: StoryboardScene[]) => void;
  onPlayToggle?: () => void;
  isPlaying?: boolean;
  className?: string;
}

type ViewMode = 'small' | 'chat-expanded' | 'fullscreen';
type FullscreenTab = 'storyboard' | 'timeline' | 'list';

export function StoryboardViewer({
  scenes,
  fps = 30,
  compName = 'Main Composition',
  onSeek,
  onUpdateScenes,
  onPlayToggle,
  isPlaying = false,
  className = '',
}: StoryboardViewerProps) {
  const [mode, setMode] = useState<ViewMode>('small');
  const [activeTab, setActiveTab] = useState<FullscreenTab>('storyboard');
  const [selectedSceneIndex, setSelectedSceneIndex] = useState<number>(0);
  const [generatingIndices, setGeneratingIndices] = useState<Set<number>>(new Set());
  const [progressMap, setProgressMap] = useState<Map<number, number>>(new Map());
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const cardRefs = useRef<(HTMLElement | null)[]>([]);

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
    ? `“${(scenes[0]?.title || scenes[0]?.intent).slice(0, 36)}${(scenes[0]?.title || scenes[0]?.intent).length > 36 ? '…' : ''}”`
    : '';

  // Trigger inside text-to-image model for a specific scene
  const generateFrameForScene = async (index: number) => {
    const scene = scenes[index];
    if (!scene) return;
    const prompt = scene.prompt || `16:9 video frame concept, cinematic lighting: ${scene.visual || scene.intent}`;
    setGeneratingIndices((prev) => new Set(prev).add(index));
    setStatusMessage(`Generating Scene ${index + 1} with inside model…`);

    try {
      const jobId = await api.localMediaGenerate({
        task: 'image',
        prompt,
        width: 1024,
        height: 576, // 16:9 compatible with SDXL (multiple of 64, >= 512)
        steps: 20,
      });

      const poll = setInterval(async () => {
        try {
          const jobs = await api.jobsList();
          const job = jobs.find((j) => j.id === jobId);
          if (job) {
            if (job.progress > 0) {
              setProgressMap((prev) => new Map(prev).set(index, Math.round(job.progress * 100)));
            }
            if (job.status === 'done') {
              clearInterval(poll);
              const path = (job.result as { path?: string })?.path;
              if (path) {
                const next = scenes.map((s, i) => (i === index ? { ...s, thumbnail: path } : s));
                onUpdateScenes?.(next);
              }
              setGeneratingIndices((prev) => {
                const updated = new Set(prev);
                updated.delete(index);
                return updated;
              });
              setProgressMap((prev) => {
                const updated = new Map(prev);
                updated.delete(index);
                return updated;
              });
              setStatusMessage(null);
            } else if (job.status === 'error' || job.status === 'cancelled') {
              clearInterval(poll);
              setGeneratingIndices((prev) => {
                const updated = new Set(prev);
                updated.delete(index);
                return updated;
              });
              setStatusMessage(`Scene ${index + 1} generation error: ${job.message || 'error'}`);
            }
          }
        } catch {
          clearInterval(poll);
          setGeneratingIndices((prev) => {
            const updated = new Set(prev);
            updated.delete(index);
            return updated;
          });
        }
      }, 1500);
    } catch (error) {
      setGeneratingIndices((prev) => {
        const updated = new Set(prev);
        updated.delete(index);
        return updated;
      });
      setStatusMessage(errorText(error));
    }
  };

  // Generate missing frames for all scenes sequentially
  const generateAllFrames = async () => {
    for (let i = 0; i < scenes.length; i++) {
      if (!scenes[i].thumbnail && !generatingIndices.has(i)) {
        await generateFrameForScene(i);
      }
    }
  };

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
          <strong className="storyboard-title">Storyboard</strong>
          <span className="storyboard-count-pill">{`${scenes.length} scene${scenes.length === 1 ? '' : 's'}`}</span>
          <span className="storyboard-time-range">{`${timecode(0, fps)} – ${timecode(totalDuration, fps)}`}</span>
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
          {scenes.map((scene, index) => {
            const durationSec = Math.max(0, scene.end - scene.start);
            const isGenerating = generatingIndices.has(index);
            const genProgress = progressMap.get(index) ?? 0;

            return (
              <article key={`${index}-${scene.start}`} className="storyboard-scene-card">
                <div className="storyboard-scene-top">
                  <span className="storyboard-scene-num">Scene {index + 1}</span>
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

                {/* Thumbnail Preview in Chat-Expanded View */}
                <div className="storyboard-chat-thumb-container">
                  {scene.thumbnail ? (
                    <img
                      src={fileSrc(scene.thumbnail)}
                      alt={scene.title || `Scene ${index + 1}`}
                      className="storyboard-chat-thumb"
                      onClick={() => onSeek?.(scene.start)}
                    />
                  ) : isGenerating ? (
                    <div className="storyboard-thumb-generating">
                      <Sparkles size={14} className="spin-icon" />
                      <span>Inside AI: {genProgress}%</span>
                    </div>
                  ) : (
                    <div
                      className="storyboard-thumb-placeholder chat"
                      onClick={() => generateFrameForScene(index)}
                      title="Generate frame with inside text-to-image model"
                    >
                      <Sparkles size={13} />
                      <span>Generate frame (inside model)</span>
                    </div>
                  )}
                </div>

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

            <button
              type="button"
              className="storyboard-action-btn inside-ai"
              onClick={generateAllFrames}
              title="Generate missing frames using the inside text-to-image model"
            >
              <Sparkles size={13} />
              <span>Generate Frames</span>
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
                const isGenerating = generatingIndices.has(index);
                const genProgress = progressMap.get(index) ?? 0;
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

                    {/* 16:9 Thumbnail Frame Area */}
                    <div className="fs-card-thumbnail-container">
                      {scene.thumbnail ? (
                        <div className="fs-thumb-img-wrapper">
                          <img
                            src={fileSrc(scene.thumbnail)}
                            alt={scene.title || `Scene ${index + 1}`}
                            className="fs-card-img"
                            onClick={() => onSeek?.(scene.start)}
                          />
                          <div className="fs-thumb-hover-overlay">
                            <button
                              type="button"
                              className="fs-thumb-action-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                onSeek?.(scene.start);
                              }}
                              title="Seek playhead to this scene"
                            >
                              <Play size={12} fill="currentColor" />
                              <span>Seek</span>
                            </button>
                            <button
                              type="button"
                              className="fs-thumb-action-btn regen"
                              onClick={(e) => {
                                e.stopPropagation();
                                generateFrameForScene(index);
                              }}
                              title="Regenerate frame with inside text-to-image model"
                            >
                              <RotateCw size={11} />
                              <span>Inside AI</span>
                            </button>
                          </div>
                        </div>
                      ) : isGenerating ? (
                        <div className="fs-thumb-generating">
                          <div className="fs-gen-spinner">
                            <Sparkles size={20} className="spin-icon" />
                          </div>
                          <span className="fs-gen-text">Inside model generating…</span>
                          {genProgress > 0 && <span className="fs-gen-sub">{genProgress}% complete</span>}
                        </div>
                      ) : (
                        <div
                          className="fs-thumb-placeholder"
                          onClick={() => generateFrameForScene(index)}
                          title="Generate frame concept with inside text-to-image model"
                        >
                          <div className="fs-placeholder-icon">
                            <ImageIcon size={22} />
                          </div>
                          <p className="fs-placeholder-intent">{scene.visual || scene.intent}</p>
                          <button
                            type="button"
                            className="fs-generate-frame-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              generateFrameForScene(index);
                            }}
                          >
                            <Sparkles size={12} />
                            <span>Generate with inside model</span>
                          </button>
                        </div>
                      )}
                    </div>

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
