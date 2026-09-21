// Dockable FX Console panel providing:
// 1. Effects Library (all 22 categories, searchable, drag to timeline, double-click)
// 2. FX Console & Shortcuts (Slots 1-9, Overrides, Settings import/export)
// 3. Snapshot Gallery (A/B split comparison, Eyedropper pixel color sampler, PNG/JPG export, Re-import to Project bin)

import { AudioLines, Camera, ChevronDown, ChevronRight, Copy, Download, Heart, Info, Layers, Palette, Plus, Search, Sparkles, Trash2, Upload, Wand2, Zap } from 'lucide-react';
import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { AVAILABLE_EFFECTS as ALL_EFFECTS, EFFECT_CATEGORIES, type EffectDefinition } from '../lib/effectsCatalog';
import { AUDIO_TRANSITIONS, VIDEO_TRANSITIONS } from '../lib/timeline';
import {
  captureStageSnapshot, downloadSnapshotFile, exportFxSettingsFile, importFxSettingsFile,
  loadFxSettings, loadFxSnapshots, resolveEffect, samplePixelColor, saveFxSettings, saveFxSnapshots,
  type ColorSample
} from '../lib/fxConsole';
import type { Comp, FxConsoleSettings, FxSnapshot } from '../lib/types';
import type { DragPayload } from './ProjectPanel';

type Props = {
  comp: Comp | undefined;
  playheadTime: number;
  selectedClipIds: string[];
  stageRef: React.RefObject<HTMLDivElement | null>;
  onApplyEffect: (effect: EffectDefinition) => void;
  onDragStart: (payload: DragPayload, event: ReactPointerEvent) => void;
  onOpenQuickModal: () => void;
  onReimportSnapshot: (snapshot: FxSnapshot) => void;
};

export function FXConsolePanel({
  comp,
  playheadTime,
  selectedClipIds,
  stageRef,
  onApplyEffect,
  onDragStart,
  onOpenQuickModal,
  onReimportSnapshot,
}: Props) {
  const [activeTab, setActiveTab] = useState<'library' | 'shortcuts' | 'snapshots'>('library');
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('All');
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [settings, setSettings] = useState<FxConsoleSettings>(loadFxSettings);
  const [snapshots, setSnapshots] = useState<FxSnapshot[]>(loadFxSnapshots);
  const [selectedSnapshot, setSelectedSnapshot] = useState<FxSnapshot | null>(null);
  const [splitPos, setSplitPos] = useState(50); // 0-100% for A/B comparison
  const [isSplitMode, setIsSplitMode] = useState(false);
  const [eyedropperActive, setEyedropperActive] = useState(false);
  const [colorSample, setColorSample] = useState<ColorSample | null>(null);
  const [toastText, setToastText] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const snapshotViewerRef = useRef<HTMLDivElement>(null);

  const showToast = (msg: string) => {
    setToastText(msg);
    setTimeout(() => setToastText((curr) => (curr === msg ? null : curr)), 2500);
  };

  const toggleGroup = (group: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [group]: !prev[group] }));
  };

  const filteredEffects = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ALL_EFFECTS.map((eff) => resolveEffect(eff, settings.overrides)).filter((eff) => {
      if (categoryFilter === 'Favorites' && !settings.favorites.includes(eff.id)) return false;
      if (categoryFilter !== 'All' && categoryFilter !== 'Favorites' && eff.group !== categoryFilter) return false;
      if (!q) return true;
      const inLabel = eff.label.toLowerCase().includes(q);
      const inGroup = eff.group.toLowerCase().includes(q);
      const inTags = (eff.tags || []).some((t) => t.toLowerCase().includes(q));
      return inLabel || inGroup || inTags;
    });
  }, [query, categoryFilter, settings.overrides, settings.favorites]);

  const groups = useMemo(() => {
    const unique = [...new Set(filteredEffects.map((e) => e.group))];
    return EFFECT_CATEGORIES.filter((c) => unique.includes(c));
  }, [filteredEffects]);

  const toggleFav = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const isFav = settings.favorites.includes(id);
    const updated = {
      ...settings,
      favorites: isFav ? settings.favorites.filter((f) => f !== id) : [...settings.favorites, id],
    };
    setSettings(updated);
    saveFxSettings(updated);
  };

  // ── Snapshot Handlers ───────────────────────────────────────────────────
  const handleTakeSnapshot = async () => {
    if (!comp) {
      showToast('Open a composition to capture snapshots');
      return;
    }
    const snap = await captureStageSnapshot(stageRef.current, comp.name, playheadTime, comp.width, comp.height);
    if (!snap) {
      showToast('Could not capture frame');
      return;
    }
    const updated = [snap, ...snapshots];
    setSnapshots(updated);
    saveFxSnapshots(updated);
    setSelectedSnapshot(snap);
    setActiveTab('snapshots');
    showToast(`Captured snapshot @ ${playheadTime.toFixed(2)}s`);
  };

  const handleDeleteSnapshot = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const updated = snapshots.filter((s) => s.id !== id);
    setSnapshots(updated);
    saveFxSnapshots(updated);
    if (selectedSnapshot?.id === id) {
      setSelectedSnapshot(updated[0] || null);
    }
  };

  const handleClearAllSnapshots = () => {
    if (confirm('Clear all captured snapshots?')) {
      setSnapshots([]);
      saveFxSnapshots([]);
      setSelectedSnapshot(null);
    }
  };

  const handleViewerPointerMove = async (e: React.PointerEvent<HTMLDivElement>) => {
    if (!eyedropperActive || !selectedSnapshot || !snapshotViewerRef.current) return;
    const rect = snapshotViewerRef.current.getBoundingClientRect();
    const normX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const normY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

    try {
      const sample = await samplePixelColor(selectedSnapshot.dataUrl, normX, normY);
      setColorSample(sample);
    } catch {
      // Ignored
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    showToast(`Copied ${label}: ${text}`);
  };

  return (
    <div className="fx-panel-root">
      {/* Top Header & Sub-Tab Bar */}
      <div className="fx-panel-nav">
        <div className="fx-nav-tabs">
          <button
            type="button"
            className={`fx-nav-tab${activeTab === 'library' ? ' active' : ''}`}
            onClick={() => setActiveTab('library')}
          >
            <Layers size={13} />
            <span>Library</span>
          </button>
          <button
            type="button"
            className={`fx-nav-tab${activeTab === 'shortcuts' ? ' active' : ''}`}
            onClick={() => setActiveTab('shortcuts')}
          >
            <Zap size={13} />
            <span>Shortcuts 1-9</span>
          </button>
          <button
            type="button"
            className={`fx-nav-tab${activeTab === 'snapshots' ? ' active' : ''}`}
            onClick={() => setActiveTab('snapshots')}
          >
            <Camera size={13} />
            <span>Snapshots {snapshots.length > 0 && `(${snapshots.length})`}</span>
          </button>
        </div>

        <button
          type="button"
          className="fx-launch-btn"
          title="Open FX Console Quick Spotlight (Ctrl+Space)"
          onClick={onOpenQuickModal}
        >
          <Zap size={12} className="fx-bolt-anim" />
          <span>Ctrl+Space</span>
        </button>
      </div>

      {toastText && <div className="fx-panel-toast">{toastText}</div>}

      {/* ── TAB 1: EFFECTS LIBRARY ────────────────────────────────────────── */}
      {activeTab === 'library' && (
        <div className="fx-tab-content">
          <div className="fx-search-bar">
            <Search size={13} />
            <input
              placeholder="Search 200+ effects across 22 categories…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button type="button" className="clear-search" onClick={() => setQuery('')}>
                ×
              </button>
            )}
          </div>

          <div className="fx-category-scroller">
            {['All', 'Favorites', ...EFFECT_CATEGORIES].map((cat) => (
              <button
                key={cat}
                type="button"
                className={`cat-pill${categoryFilter === cat ? ' active' : ''}`}
                onClick={() => setCategoryFilter(cat)}
              >
                {cat === 'Favorites' ? <Heart size={10} style={{ display: 'inline', marginRight: 3 }} /> : null}
                {cat}
              </button>
            ))}
          </div>

          <div className="fx-library-scroll">
            {/* Built-in Video & Audio Cut Transitions */}
            {(categoryFilter === 'All' || categoryFilter === 'Transition') && (
              <>
                <div className="fx-category-group">
                  <div className="fx-group-header" onClick={() => toggleGroup('Video Transitions (Cut)')}>
                    {collapsedGroups['Video Transitions (Cut)'] ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                    <span className="group-title">Video Transitions (Cut)</span>
                    <span className="group-count">{VIDEO_TRANSITIONS.length}</span>
                  </div>
                  {!collapsedGroups['Video Transitions (Cut)'] && (
                    <div className="fx-group-items">
                      {VIDEO_TRANSITIONS.filter((t) => !query || t.label.toLowerCase().includes(query.toLowerCase())).map((item) => (
                        <div
                          key={item.kind}
                          className="fx-item-row"
                          title={`${item.label} — Drag onto a cut between clips`}
                          onPointerDown={(e) =>
                            e.button === 0 &&
                            onDragStart({ kind: 'transition', transition: item.kind, label: item.label }, e)
                          }
                        >
                          <Wand2 size={12} className="fx-icon" />
                          <span className="fx-name">{item.label}</span>
                          <span className="fx-slot-tag">Cut</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="fx-category-group">
                  <div className="fx-group-header" onClick={() => toggleGroup('Audio Transitions (Cut)')}>
                    {collapsedGroups['Audio Transitions (Cut)'] ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                    <span className="group-title">Audio Transitions (Cut)</span>
                    <span className="group-count">{AUDIO_TRANSITIONS.length}</span>
                  </div>
                  {!collapsedGroups['Audio Transitions (Cut)'] && (
                    <div className="fx-group-items">
                      {AUDIO_TRANSITIONS.filter((t) => !query || t.label.toLowerCase().includes(query.toLowerCase())).map((item) => (
                        <div
                          key={item.kind}
                          className="fx-item-row"
                          title={`${item.label} — Drag onto an audio cut`}
                          onPointerDown={(e) =>
                            e.button === 0 &&
                            onDragStart({ kind: 'transition', transition: item.kind, label: item.label }, e)
                          }
                        >
                          <AudioLines size={12} className="fx-icon" />
                          <span className="fx-name">{item.label}</span>
                          <span className="fx-slot-tag">Audio</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}

            {groups.length === 0 ? (
              <div className="fx-no-results">No effects found matching "{query}"</div>
            ) : (
              groups.map((group) => {
                const isCollapsed = !!collapsedGroups[group];
                const items = filteredEffects.filter((e) => e.group === group);
                if (items.length === 0) return null;

                return (
                  <div key={group} className="fx-category-group">
                    <div className="fx-group-header" onClick={() => toggleGroup(group)}>
                      {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                      <span className="group-title">{group}</span>
                      <span className="group-count">{items.length}</span>
                    </div>

                    {!isCollapsed && (
                      <div className="fx-group-items">
                        {items.map((eff) => {
                          const isFav = settings.favorites.includes(eff.id);
                          const mappedSlot = Object.entries(settings.shortcuts).find(([, id]) => id === eff.id)?.[0];
                          const canApply = selectedClipIds.length > 0;

                          return (
                            <div
                              key={eff.id}
                              className={`fx-item-row${canApply ? '' : ' dim'}`}
                              title={`${eff.label} — ${eff.hint}. Drag to timeline clip, or double-click to apply.`}
                              onDoubleClick={() => onApplyEffect(eff)}
                              onPointerDown={(e) =>
                                e.button === 0 &&
                                onDragStart({ kind: 'effect', effect: eff, label: eff.label }, e)
                              }
                            >
                              <Sparkles size={12} className="fx-icon" />
                              <span className="fx-name">{eff.label}</span>
                              {mappedSlot && <span className="fx-slot-tag">[{mappedSlot}]</span>}

                              <button
                                type="button"
                                className={`fx-fav-icon${isFav ? ' active' : ''}`}
                                title={isFav ? 'Remove favorite' : 'Add favorite'}
                                onClick={(e) => toggleFav(eff.id, e)}
                              >
                                <Heart size={11} fill={isFav ? 'currentColor' : 'none'} />
                              </button>
                              <button
                                type="button"
                                className="fx-info-icon"
                                title={eff.hint}
                                onClick={(e) => { e.stopPropagation(); showToast(`${eff.label} — ${eff.hint}`); }}
                              >
                                <Info size={11} />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ── TAB 2: SHORTCUTS 1-9 & OVERRIDES ────────────────────────────────── */}
      {activeTab === 'shortcuts' && (
        <div className="fx-tab-content fx-shortcuts-tab">
          <div className="shortcuts-info">
            <Zap size={14} className="accent-color" />
            <div>
              <strong>Quick Number Slots 1–9</strong>
              <p>Press keys 1 to 9 inside FX Console (Ctrl+Space) to apply instantly to selected clips.</p>
            </div>
          </div>

          <div className="slots-list">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((slot) => {
              const currentId = settings.shortcuts[slot];

              return (
                <div key={slot} className="slot-item">
                  <div className="slot-badge">KEY {slot}</div>
                  <select
                    className="slot-dropdown"
                    value={currentId || ''}
                    onChange={(e) => {
                      const updated = {
                        ...settings,
                        shortcuts: { ...settings.shortcuts, [slot]: e.target.value },
                      };
                      setSettings(updated);
                      saveFxSettings(updated);
                      showToast(`Assigned slot ${slot}`);
                    }}
                  >
                    <option value="">(Unassigned)</option>
                    {ALL_EFFECTS.map((eff) => (
                      <option key={eff.id} value={eff.id}>
                        {eff.label} [{eff.group}]
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>

          <div className="fx-settings-footer">
            <div className="fx-io-title">Settings Backup & Restore</div>
            <div className="fx-io-buttons">
              <button
                type="button"
                className="btn btn-small"
                onClick={() => exportFxSettingsFile(settings)}
              >
                <Download size={12} /> Export JSON
              </button>
              <button
                type="button"
                className="btn btn-small"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload size={12} /> Import JSON
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                style={{ display: 'none' }}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    const loaded = await importFxSettingsFile(file);
                    setSettings(loaded);
                    showToast('Settings restored!');
                  }
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 3: SNAPSHOT GALLERY & COLOR SAMPLER ───────────────────────── */}
      {activeTab === 'snapshots' && (
        <div className="fx-tab-content fx-snapshots-tab">
          <div className="snapshot-toolbar">
            <button
              type="button"
              className="btn btn-small btn-primary"
              onClick={handleTakeSnapshot}
              title="Grab current frame from Program Monitor"
            >
              <Camera size={13} />
              <span>Capture Snapshot</span>
            </button>

            {snapshots.length > 0 && (
              <button
                type="button"
                className="btn btn-small"
                onClick={handleClearAllSnapshots}
                title="Clear all saved snapshots"
              >
                <Trash2 size={12} /> Clear All
              </button>
            )}
          </div>

          {snapshots.length === 0 ? (
            <div className="snapshot-empty">
              <Camera size={32} className="empty-icon" />
              <strong>No Snapshots Captured Yet</strong>
              <p>Click "Capture Snapshot" to grab frames for color sampling, A/B comparison, or re-importing into the bin.</p>
            </div>
          ) : (
            <div className="snapshot-layout">
              {/* Snapshot Viewer & Tools */}
              {selectedSnapshot && (
                <div className="snapshot-inspector">
                  <div className="inspector-head">
                    <div className="snapshot-title-row">
                      <strong>{selectedSnapshot.label || selectedSnapshot.compName}</strong>
                      <span className="snapshot-meta">
                        {selectedSnapshot.time.toFixed(2)}s • {selectedSnapshot.width}×{selectedSnapshot.height}
                      </span>
                    </div>

                    <div className="inspector-actions">
                      <button
                        type="button"
                        className={`btn btn-small${eyedropperActive ? ' btn-primary' : ''}`}
                        onClick={() => setEyedropperActive((v) => !v)}
                        title="Interactive Pixel Color Sampler / Eyedropper"
                      >
                        <Palette size={12} />
                        <span>Eyedropper</span>
                      </button>

                      <button
                        type="button"
                        className="btn btn-small"
                        onClick={() => downloadSnapshotFile(selectedSnapshot, 'png')}
                        title="Download as PNG"
                      >
                        <Download size={12} /> PNG
                      </button>

                      <button
                        type="button"
                        className="btn btn-small"
                        onClick={() => downloadSnapshotFile(selectedSnapshot, 'jpg')}
                        title="Download as JPG"
                      >
                        <Download size={12} /> JPG
                      </button>

                      <button
                        type="button"
                        className={`btn btn-small${isSplitMode ? ' btn-primary' : ''}`}
                        onClick={() => setIsSplitMode((v) => !v)}
                        title="Toggle A/B Split View comparison"
                      >
                        <span>A/B Split {isSplitMode ? `(${splitPos}%)` : ''}</span>
                      </button>

                      <button
                        type="button"
                        className="btn btn-small btn-success"
                        onClick={() => onReimportSnapshot(selectedSnapshot)}
                        title="Re-import this snapshot directly as an asset into the Project bin!"
                      >
                        <Plus size={12} /> Re-import to Bin
                      </button>
                    </div>
                  </div>

                  {/* Eyedropper Color Info Strip */}
                  {eyedropperActive && colorSample && (
                    <div className="eyedropper-strip">
                      <div className="swatch" style={{ background: colorSample.hex }} />
                      <div className="sample-text">
                        <span className="hex" onClick={() => copyToClipboard(colorSample.hex, 'HEX')}>
                          {colorSample.hex} <Copy size={10} />
                        </span>
                        <span className="rgb" onClick={() => copyToClipboard(colorSample.rgbStr, 'RGB')}>
                          {colorSample.rgbStr}
                        </span>
                        <span className="hsl">{colorSample.hslStr}</span>
                      </div>
                    </div>
                  )}

                  {isSplitMode && (
                    <div className="split-slider-bar">
                      <span>Snapshot</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={splitPos}
                        onChange={(e) => setSplitPos(Number(e.target.value))}
                      />
                      <span>Split: {splitPos}%</span>
                    </div>
                  )}

                  {/* Main Viewer Image */}
                  <div
                    ref={snapshotViewerRef}
                    className={`snapshot-viewer-stage${eyedropperActive ? ' eyedropper-cursor' : ''}`}
                    onPointerMove={handleViewerPointerMove}
                  >
                    <img
                      src={selectedSnapshot.dataUrl}
                      alt="Snapshot"
                      draggable={false}
                      style={isSplitMode ? { clipPath: `inset(0 ${100 - splitPos}% 0 0)` } : undefined}
                    />
                  </div>
                </div>
              )}

              {/* Thumbnail Strip Gallery */}
              <div className="snapshot-strip">
                {snapshots.map((snap) => {
                  const isSelected = selectedSnapshot?.id === snap.id;
                  return (
                    <div
                      key={snap.id}
                      className={`snapshot-thumb-card${isSelected ? ' active' : ''}`}
                      onClick={() => setSelectedSnapshot(snap)}
                    >
                      <img src={snap.dataUrl} alt="" className="thumb-img" />
                      <div className="thumb-info">
                        <span className="time">{snap.time.toFixed(2)}s</span>
                        <button
                          type="button"
                          className="thumb-del"
                          onClick={(e) => handleDeleteSnapshot(snap.id, e)}
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
