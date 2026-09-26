// Floating FX Console search bar. Appears at the mouse cursor with effect search,
// snapshot capture, snapshot gallery, frame export, and quick-slot settings.

import {
  Camera,
  Download,
  Film,
  Heart,
  Image as ImageIcon,
  Plus,
  Search,
  Settings,
  Upload,
} from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { AVAILABLE_EFFECTS as ALL_EFFECTS, EFFECT_CATEGORIES, type EffectDefinition } from '../lib/effectsCatalog';
import {
  captureStageSnapshot,
  DEFAULT_FX_SETTINGS,
  exportFxSettingsFile,
  importFxSettingsFile,
  loadFxSettings,
  loadFxSnapshots,
  saveFxSettings,
  saveFxSnapshots,
  searchEffects,
} from '../lib/fxConsole';
import { timecode } from '../lib/editor';
import { getLiveMousePos } from '../lib/mouseTracker';
import type { Comp, FxConsoleSettings, FxSnapshot } from '../lib/types';

type Props = {
  open: boolean;
  anchorPos?: { x: number; y: number } | null;
  onClose: () => void;
  onApplyEffect: (effect: EffectDefinition) => void;
  comp: Comp | undefined;
  playheadTime: number;
  selectedClipIds: string[];
  stageRef: React.RefObject<HTMLDivElement | null>;
  onSnapshotCaptured?: (snapshot: FxSnapshot) => void;
  onExportFrame?: () => void;
  onReimportSnapshot?: (snapshot: FxSnapshot) => void;
};

export function FXConsoleModal({
  open,
  anchorPos,
  onClose,
  onApplyEffect,
  comp,
  playheadTime,
  selectedClipIds,
  stageRef,
  onSnapshotCaptured,
  onExportFrame,
  onReimportSnapshot,
}: Props) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [settings, setSettings] = useState<FxConsoleSettings>(loadFxSettings);
  const [snapshots, setSnapshots] = useState<FxSnapshot[]>(loadFxSnapshots);
  const [activeDrawer, setActiveDrawer] = useState<'none' | 'gallery' | 'settings'>('none');
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [isDropUp, setIsDropUp] = useState(false);

  // Position accurately at mouse cursor
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 200, y: 150 });

  const inputRef = useRef<HTMLInputElement>(null);
  const resultsListRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      setActiveDrawer('none');
      setSettings(loadFxSettings());
      setSnapshots(loadFxSnapshots());

      // Accurately center bar directly over the live mouse cursor
      const live = getLiveMousePos();
      const mouseX = anchorPos && anchorPos.x > 0 ? anchorPos.x : live.x;
      const mouseY = anchorPos && anchorPos.y > 0 ? anchorPos.y : live.y;

      const barWidth = 400;
      const barHeight = 42;
      const targetX = mouseX - Math.round(barWidth / 2);
      const targetY = mouseY - Math.round(barHeight / 2);

      const clampedX = Math.max(10, Math.min(window.innerWidth - barWidth - 10, targetX));
      const clampedY = Math.max(10, Math.min(window.innerHeight - barHeight - 10, targetY));

      setPos({ x: clampedX, y: clampedY });
      setIsDropUp(mouseY > window.innerHeight * 0.52);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open, anchorPos]);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg((curr) => (curr === msg ? null : curr)), 2500);
  };

  const results = searchEffects(query, category, settings.overrides, settings.favorites);

  // Scroll active item into view
  useEffect(() => {
    const container = resultsListRef.current;
    if (!container) return;
    const activeEl = container.querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`);
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  // Handle number shortcuts (1-9) or navigation
  const handleKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (activeDrawer !== 'none') {
        setActiveDrawer('none');
        inputRef.current?.focus();
      } else {
        onClose();
      }
      return;
    }

    // Number keys 1-9 without Ctrl/Alt/Meta trigger the shortcut slot
    if (/^[1-9]$/.test(e.key) && !e.ctrlKey && !e.altKey && !e.metaKey && !query.trim() && activeDrawer === 'none') {
      const slot = Number(e.key);
      const targetId = settings.shortcuts[slot];
      if (targetId) {
        const found = ALL_EFFECTS.find((eff) => eff.id === targetId);
        if (found) {
          e.preventDefault();
          apply(found);
          return;
        }
      }
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, results.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + results.length) % Math.max(1, results.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[selectedIndex]) {
        apply(results[selectedIndex]);
      }
    }
  };

  const apply = (effect: EffectDefinition) => {
    onApplyEffect(effect);
    const updatedRecents = [effect.label, ...settings.recentSearches.filter((s) => s !== effect.label)].slice(0, 12);
    const updated = { ...settings, recentSearches: updatedRecents };
    setSettings(updated);
    saveFxSettings(updated);
    showToast(`Applied ${effect.label}`);
    setTimeout(onClose, 150);
  };

  const toggleFavorite = (effectId: string, e: ReactMouseEvent) => {
    e.stopPropagation();
    const exists = settings.favorites.includes(effectId);
    const updatedFavorites = exists
      ? settings.favorites.filter((id) => id !== effectId)
      : [...settings.favorites, effectId];
    const updated = { ...settings, favorites: updatedFavorites };
    setSettings(updated);
    saveFxSettings(updated);
  };

  const assignShortcut = (slot: number, effectId: string) => {
    const updated = { ...settings, shortcuts: { ...settings.shortcuts, [slot]: effectId } };
    setSettings(updated);
    saveFxSettings(updated);
    showToast(`Slot [${slot}] → ${ALL_EFFECTS.find((e) => e.id === effectId)?.label || 'Unassigned'}`);
  };

  const handleCaptureSnapshot = async () => {
    if (!comp) return;
    const snap = await captureStageSnapshot(stageRef.current, comp.name, playheadTime, comp.width, comp.height);
    if (snap) {
      const updated = [snap, ...snapshots];
      setSnapshots(updated);
      saveFxSnapshots(updated);
      onSnapshotCaptured?.(snap);
      showToast(`Snapshot captured @ ${playheadTime.toFixed(2)}s`);
    } else {
      showToast('Could not capture frame');
    }
  };

  const handleExportFrame = () => {
    if (onExportFrame) {
      onExportFrame();
    } else if (snapshots.length > 0) {
      const latest = snapshots[0];
      const tc = timecode(latest.time, comp?.fps ?? 30);
      const a = document.createElement('a');
      a.href = latest.dataUrl;
      a.download = `snapshot_${latest.compName}_${tc.replace(/:/g, '-')}.png`;
      a.click();
      showToast('Snapshot exported');
    } else {
      handleCaptureSnapshot();
    }
  };

  const handleImportSettings = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const imported = await importFxSettingsFile(file);
      setSettings(imported);
      showToast('Settings imported');
    } catch {
      showToast('Failed to import settings');
    }
  };

  if (!open) return null;

  const showDropdown = activeDrawer !== 'none' || query.trim().length > 0 || selectedIndex > 0;

  return (
    <div
      className="fx-console-overlay"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`fx-console-bar-container${showDropdown ? ' has-dropdown' : ''}${isDropUp ? ' drop-up' : ''}`}
        style={{ left: pos.x, top: pos.y }}
        onKeyDown={handleKeyDown}
      >
        {/* ── Main search bar ── */}
        <div className="fx-console-main-bar">
          {/* Left: Search Magnifying Glass Icon */}
          <Search size={15} className="fx-bar-search-icon" />

          {/* Search input */}
          <input
            ref={inputRef}
            type="text"
            className="fx-bar-input"
            placeholder="Search effects…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
              if (activeDrawer !== 'none') setActiveDrawer('none');
            }}
            spellCheck={false}
            autoFocus
          />

          {/* Toast feedback pill inside the bar */}
          {toastMsg && <span className="fx-bar-toast">{toastMsg}</span>}

          {/* Right Action Icons */}
          <div className="fx-bar-actions">
            {/* 1. Camera snapshot icon */}
            <button
              type="button"
              className="fx-bar-btn"
              title="Capture Snapshot (Program Monitor)"
              onClick={handleCaptureSnapshot}
            >
              <Camera size={15} />
            </button>

            {/* 2. Gallery strip icon */}
            <button
              type="button"
              className={`fx-bar-btn${activeDrawer === 'gallery' ? ' active' : ''}`}
              title="Snapshot Gallery"
              onClick={() => {
                setActiveDrawer((curr) => (curr === 'gallery' ? 'none' : 'gallery'));
              }}
            >
              <Film size={15} />
            </button>

            {/* 3. Export / Download frame icon */}
            <button
              type="button"
              className="fx-bar-btn"
              title="Export Current Frame as PNG"
              onClick={handleExportFrame}
            >
              <Download size={15} />
            </button>

            {/* 4. Settings gear icon */}
            <button
              type="button"
              className={`fx-bar-btn${activeDrawer === 'settings' ? ' active' : ''}`}
              title="Console Shortcuts (1–9) & Settings"
              onClick={() => {
                setActiveDrawer((curr) => (curr === 'settings' ? 'none' : 'settings'));
              }}
            >
              <Settings size={15} />
            </button>
          </div>
        </div>

        {/* ── Dropdown Tray (Results, Gallery, or Settings) ─────────────── */}
        {showDropdown && (
          <div className="fx-console-dropdown">
            {/* Gallery Drawer */}
            {activeDrawer === 'gallery' && (
              <div className="fx-drawer-content">
                <div className="fx-drawer-head">
                  <span>Snapshots ({snapshots.length})</span>
                  <button
                    type="button"
                    className="btn btn-small"
                    onClick={handleCaptureSnapshot}
                  >
                    <Camera size={11} /> New Snapshot
                  </button>
                </div>

                {snapshots.length === 0 ? (
                  <div className="fx-empty-state">
                    <ImageIcon size={24} style={{ opacity: 0.4 }} />
                    <span>No snapshots yet. Use the camera button to capture one.</span>
                  </div>
                ) : (
                  <div className="fx-gallery-grid">
                    {snapshots.map((snap) => {
                      const tc = timecode(snap.time, comp?.fps ?? 30);
                      return (
                        <div key={snap.id} className="fx-gallery-item">
                          <img src={snap.dataUrl} alt={snap.compName} className="fx-snap-thumb" />
                          <div className="fx-snap-info">
                            <span className="fx-snap-time">{tc}</span>
                            <span className="fx-snap-comp">{snap.compName}</span>
                          </div>
                          <div className="fx-snap-actions">
                            {onReimportSnapshot && (
                              <button
                                type="button"
                                className="btn btn-small"
                                onClick={() => {
                                  onReimportSnapshot(snap);
                                  onClose();
                                }}
                                title="Add snapshot to project bin"
                              >
                                <Plus size={10} /> Bin
                              </button>
                            )}
                            <button
                              type="button"
                              className="btn btn-small"
                              onClick={() => {
                                const a = document.createElement('a');
                                a.href = snap.dataUrl;
                                a.download = `snapshot_${tc.replace(/:/g, '-')}.png`;
                                a.click();
                              }}
                              title="Download PNG"
                            >
                              <Download size={10} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Settings Drawer */}
            {activeDrawer === 'settings' && (
              <div className="fx-drawer-content">
                <div className="fx-drawer-head">
                  <span>Quick slots</span>
                  <span style={{ fontWeight: 400, color: 'var(--text-faint)' }}>Press 1–9 to apply</span>
                </div>

                <div className="fx-shortcuts-list">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((slot) => {
                    const targetId = settings.shortcuts[slot];
                    const eff = targetId ? ALL_EFFECTS.find((e) => e.id === targetId) : null;
                    return (
                      <div key={slot} className="fx-shortcut-row">
                        <span className="slot-num-badge">[{slot}]</span>
                        <span className="slot-name-label">{eff ? eff.label : '— Unassigned —'}</span>
                        <select
                          className="prop-select"
                          value={targetId || ''}
                          onChange={(e) => assignShortcut(slot, e.target.value)}
                          style={{ fontSize: 11, padding: '2px 6px', maxWidth: 180 }}
                        >
                          <option value="">Unassigned</option>
                          {ALL_EFFECTS.map((e) => (
                            <option key={e.id} value={e.id}>
                              {e.label} ({e.group})
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>

                <div className="fx-settings-footer">
                  <button
                    type="button"
                    className="btn btn-small"
                    onClick={() => exportFxSettingsFile(settings)}
                  >
                    <Download size={11} /> Export JSON
                  </button>
                  <button
                    type="button"
                    className="btn btn-small"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload size={11} /> Import JSON
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json"
                    hidden
                    onChange={handleImportSettings}
                  />
                  <button
                    type="button"
                    className="btn btn-small"
                    onClick={() => {
                      setSettings({ ...DEFAULT_FX_SETTINGS });
                      saveFxSettings(DEFAULT_FX_SETTINGS);
                      showToast('Defaults restored');
                    }}
                  >
                    Reset
                  </button>
                </div>
              </div>
            )}

            {/* Results List (Normal Search Mode) */}
            {activeDrawer === 'none' && (
              <>
                {/* Category Filter Pills (if results or browsing) */}
                <div className="fx-categories-strip">
                  {['All', 'Favorites', ...EFFECT_CATEGORIES].map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      className={`fx-cat-pill${category === cat ? ' active' : ''}`}
                      onClick={() => {
                        setCategory(cat);
                        setSelectedIndex(0);
                      }}
                    >
                      {cat === 'Favorites' ? <Heart size={10} /> : null}
                      {cat}
                    </button>
                  ))}
                </div>

                {/* Effects list */}
                <div className="fx-results-list" ref={resultsListRef}>
                  {results.length === 0 ? (
                    <div className="fx-empty-state">
                      <span>No effects match “{query}”</span>
                    </div>
                  ) : (
                    results.map((eff, index) => {
                      const isSelected = index === selectedIndex;
                      const isFav = settings.favorites.includes(eff.id);
                      const mappedSlot = Object.entries(settings.shortcuts).find(([, id]) => id === eff.id)?.[0];

                      return (
                        <div
                          key={eff.id}
                          data-index={index}
                          className={`fx-result-row${isSelected ? ' selected' : ''}`}
                          onClick={() => apply(eff)}
                          onMouseEnter={() => setSelectedIndex(index)}
                        >
                          <div className="fx-item-body">
                            <div className="fx-item-title">
                              <span className="fx-item-name">{eff.label}</span>
                              {mappedSlot && <span className="fx-slot-tag">[{mappedSlot}]</span>}
                              <span className="fx-cat-tag">{eff.group}</span>
                            </div>
                            <div className="fx-item-hint">{eff.hint}</div>
                          </div>

                          <div className="fx-item-actions">
                            <button
                              type="button"
                              className={`fav-btn${isFav ? ' active' : ''}`}
                              title={isFav ? 'Remove from favorites' : 'Add to favorites'}
                              onClick={(e) => toggleFavorite(eff.id, e)}
                            >
                              <Heart size={12} fill={isFav ? 'currentColor' : 'none'} />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Footer hint */}
                <div className="fx-dropdown-footer">
                  <span><kbd>↑↓</kbd>Navigate</span>
                  <span><kbd>Enter</kbd>Apply</span>
                  <span><kbd>Esc</kbd>Close</span>
                  {selectedClipIds.length > 0 && (
                    <span className="fx-footer-target">
                      Target: {selectedClipIds.length} clip{selectedClipIds.length > 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
