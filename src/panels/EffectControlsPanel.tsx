import { cleanLegacy } from '../lib/effectState';
// Effect Controls / Effects Side Panel for Helios.
// Displays all applied effects on the selected clip or adjustment layer, with
// interactive parameter controls (sliders, scrubbers, options, colors), bypass toggles,
// reset, reorder, delete, and quick effect addition from all effect categories.

import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Layers,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { ScrubNumber } from '../components/workspace';
import { RENDERED_EFFECTS } from '../lib/effectSupport';
import { ColorWheels } from '../components/ColorWheels';
import { CurvesEditor } from '../components/CurvesEditor';
import { AVAILABLE_EFFECTS as ALL_EFFECTS, EFFECT_CATEGORIES, type EffectDefinition } from '../lib/effectsCatalog';
import { createAppliedEffect, getEffectSchema } from '../lib/effectFilters';
import { timecode } from '../lib/editor';
import type { History } from '../lib/history';
import { clipEnd, clipName, trackLabel, updateComp, type AssetMap } from '../lib/timeline';
import type { AppliedEffect, Comp, Project } from '../lib/types';

type Props = {
  project: Project;
  comp: Comp | undefined;
  assets: AssetMap;
  history: History;
  selection: string[];
  onOpenFXConsole?: () => void;
};

export function EffectControlsPanel({ project, comp, assets, history, selection, onOpenFXConsole }: Props) {
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCat, setSelectedCat] = useState<string>('All');
  const [collapsedMap, setCollapsedMap] = useState<Record<string, boolean>>({});

  const clip = useMemo(() => {
    if (!comp || selection.length === 0) return undefined;
    return comp.clips.find((c) => c.id === selection[0]);
  }, [comp, selection]);

  if (!comp) {
    return (
      <div className="props">
        <div className="props-note">Open a composition to view effects.</div>
      </div>
    );
  }

  if (!clip) {
    return (
      <div className="props fx-controls-empty">
        <div className="fx-empty-icon-box">
          <SlidersHorizontal size={28} style={{ opacity: 0.4 }} />
        </div>
        <div className="fx-empty-title">No Layer Selected</div>
        <div className="fx-empty-desc">
          Select a clip or adjustment layer on the timeline to inspect, adjust, and add effects.
        </div>
        {onOpenFXConsole && (
          <button type="button" className="btn btn-primary btn-small" onClick={onOpenFXConsole} style={{ marginTop: 12 }}>
            <Sparkles size={12} /> Open FX Console (Ctrl+Space)
          </button>
        )}
      </div>
    );
  }

  const appliedEffects = clip.appliedEffects || [];
  const isAdjustment = clip.adjustment || (clip.source.type === 'item' && project.items.find((i) => i.id === (clip.source as { itemId: string }).itemId)?.kind === 'adjustment-layer');

  const updateClipEffects = (nextEffects: AppliedEffect[], label = 'Edit Effect') => {
    history.commit((current) =>
      updateComp(current, comp.id, (target) => ({
        ...target,
        clips: target.clips.map((c) => (c.id === clip.id ? { ...c, effects: cleanLegacy(c.effects, c.appliedEffects || []), appliedEffects: nextEffects.map(fx => ({ ...fx, stackOnly: true })) } : c)),
      })),
      label
    );
  };

  const toggleEffect = (effectId: string) => {
    const next = appliedEffects.map((fx) => (fx.id === effectId ? { ...fx, enabled: !fx.enabled } : fx));
    updateClipEffects(next, 'Toggle Effect');
  };

  const removeEffect = (effectId: string) => {
    const next = appliedEffects.filter((fx) => fx.id !== effectId);
    updateClipEffects(next, 'Remove Effect');
  };

  const resetEffect = (effectId: string) => {
    const fx = appliedEffects.find((item) => item.id === effectId);
    if (!fx) return;
    const schema = getEffectSchema(fx.effectId, fx.category);
    const defaults: Record<string, number | boolean | string> = {};
    schema.params.forEach((p) => {
      defaults[p.id] = p.defaultValue;
    });
    const next = appliedEffects.map((item) => (item.id === effectId ? { ...item, params: defaults } : item));
    updateClipEffects(next, 'Reset Effect');
  };

  const updateParam = (effectId: string, paramId: string, value: number | boolean | string, commit = true) => {
    const apply = (current: Project) =>
      updateComp(current, comp.id, (target) => ({
        ...target,
        clips: target.clips.map((c) => {
          if (c.id !== clip.id) return c;
          const fxList = (c.appliedEffects || []).map((fx) => {
            if (fx.id !== effectId) return fx;
            return { ...fx, params: { ...fx.params, [paramId]: value } };
          });
          return { ...c, effects: cleanLegacy(c.effects, c.appliedEffects || []), appliedEffects: fxList.map(fx => ({ ...fx, stackOnly: true })) };
        }),
      }));

    if (commit) history.commit(apply, 'Edit Effect Parameter');
    else history.preview(apply);
  };

  const addEffectToClip = (effectDef: EffectDefinition) => {
    const newEffect = createAppliedEffect(effectDef);
    updateClipEffects([...appliedEffects, newEffect], `Apply ${effectDef.label}`);
    setAddModalOpen(false);
  };

  // Filter available effects for adding
  const filteredAvailableEffects = ALL_EFFECTS.filter((eff) => {
    if (selectedCat !== 'All' && eff.group !== selectedCat) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return eff.label.toLowerCase().includes(q) || eff.hint.toLowerCase().includes(q) || (eff.tags && eff.tags.some((t) => t.toLowerCase().includes(q)));
  });

  return (
    <div className="props fx-controls-panel">
      {/* Header with layer summary */}
      <div className="props-head fx-head">
        {isAdjustment ? <SlidersHorizontal size={14} style={{ color: '#00e5ff' }} /> : <Layers size={14} />}
        <div className="fx-title-block">
          <span className="props-name">{clipName(project, assets, clip)}</span>
          {isAdjustment && <span className="fx-adj-badge">Adjustment Layer</span>}
        </div>
        <button
          type="button"
          className="btn btn-primary btn-small fx-add-btn"
          onClick={() => setAddModalOpen(true)}
          title="Add new effect to this layer"
        >
          <Plus size={12} /> Add Effect
        </button>
      </div>

      <div className="props-sub">
        {trackLabel(comp, clip.trackId)} · {timecode(clip.start, comp.fps)} → {timecode(clipEnd(clip), comp.fps)}
        {appliedEffects.length > 0 && ` · ${appliedEffects.length} effect${appliedEffects.length > 1 ? 's' : ''}`}
      </div>

      {/* Applied effects list */}
      <div className="fx-stack-container">
        {appliedEffects.length === 0 ? (
          <div className="fx-stack-empty">
            <div style={{ opacity: 0.5, marginBottom: 8 }}>
              <Wand2 size={24} />
            </div>
            <div style={{ fontWeight: 600, color: '#cbd5e1', marginBottom: 4 }}>No Effects on This Layer</div>
            <div style={{ fontSize: 11, color: '#8c93a1', marginBottom: 14 }}>
              Add a distortion, blur, color grade, or stylize effect to start transforming this layer.
            </div>

            {/* Quick-add recommendations */}
            <div className="fx-quick-add-group">
              <span className="fx-quick-label">POPULAR EFFECTS:</span>
              <div className="fx-quick-chips">
                {[
                  { id: 'displacement-map', label: 'Displacement Map' },
                  { id: 'turbulent-displace', label: 'Turbulent Displace' },
                  { id: 'wave-warp', label: 'Wave Warp' },
                  { id: 'bulge', label: 'Bulge' },
                  { id: 'gaussian-blur', label: 'Gaussian Blur' },
                  { id: 'glow', label: 'Glow' },
                  { id: 'tint', label: 'Tint' },
                ].map((item) => {
                  const def = ALL_EFFECTS.find((e) => e.id === item.id);
                  if (!def) return null;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className="fx-quick-chip"
                      onClick={() => addEffectToClip(def)}
                    >
                      <Plus size={10} /> {item.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          appliedEffects.map((fx) => {
            const schema = getEffectSchema(fx.effectId, fx.category);
            const isCollapsed = !!collapsedMap[fx.id];

            return (
              <div key={fx.id} className={`fx-item-card${!fx.enabled ? ' bypassed' : ''}`}>
                {/* Effect Card Header */}
                <div className="fx-item-card-header">
                  <button
                    type="button"
                    className="fx-card-collapse-btn"
                    onClick={() => setCollapsedMap((prev) => ({ ...prev, [fx.id]: !prev[fx.id] }))}
                    title={isCollapsed ? 'Expand parameters' : 'Collapse parameters'}
                  >
                    {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                  </button>

                  {/* Eye visibility toggle (Helios style) */}
                  <button
                    type="button"
                    className={`fx-eye-btn${fx.enabled ? ' active' : ' muted'}`}
                    onClick={() => toggleEffect(fx.id)}
                    title={fx.enabled ? 'Turn off effect (Disable)' : 'Turn on effect (Enable)'}
                  >
                    {fx.enabled ? <Eye size={13} /> : <EyeOff size={13} />}
                  </button>

                  <button
                    type="button"
                    className={`fx-power-btn${fx.enabled ? ' on' : ''}`}
                    onClick={() => toggleEffect(fx.id)}
                    title={fx.enabled ? 'Disable effect (Bypass)' : 'Enable effect'}
                  >
                    <span className="fx-badge-text">fx</span>
                  </button>

                  <span className="fx-card-title">{fx.name}</span>
                  <span className="fx-card-cat">{fx.category}</span>

                  <div className="fx-card-actions">
                    <button
                      type="button"
                      className="icon-btn small"
                      onClick={() => resetEffect(fx.id)}
                      title="Reset effect to default parameters"
                    >
                      <RotateCcw size={11} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn small danger"
                      onClick={() => removeEffect(fx.id)}
                      title="Remove effect from layer"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>

                {/* Effect Parameters */}
                {!isCollapsed && !RENDERED_EFFECTS.has(fx.effectId) && <p className="field-hint">This legacy effect has no complete export implementation. Bypass or remove it before exporting.</p>}
                {!isCollapsed && RENDERED_EFFECTS.has(fx.effectId) && (
                  <div className="fx-card-params">
                    {fx.effectId === 'lumetri-color' && <><ColorWheels params={fx.params} onChange={(key,value,commit)=>updateParam(fx.id,key,value,commit)} onCommit={()=>history.settle('Color wheel')} /><CurvesEditor allowAlpha={false} params={fx.params} onChange={(key,value,commit)=>{if(typeof value==='string'||typeof value==='number'||typeof value==='boolean')updateParam(fx.id,key,value,commit);}} onCommit={()=>history.settle('Color curves')} /></>}
                    {fx.effectId === 'curves' ? (
                      <CurvesEditor
                        params={fx.params}
                        onChange={(paramId, value, commit) =>
                          (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') && updateParam(fx.id, paramId, value, commit)
                        }
                        onCommit={() => history.settle('Change Curves')}
                      />
                    ) : (
                      schema.params.filter(param => fx.effectId !== 'lumetri-color' || !/^(shadow|midtone|highlight)(Hue|Amount|Luma)$/.test(param.id)).map((param) => {
                        const val = fx.params[param.id] !== undefined ? fx.params[param.id] : param.defaultValue;

                      if (param.type === 'number') {
                        const numVal = Number(val);
                        return (
                          <div key={param.id} className="fx-param-row">
                            <span className="fx-param-label">{param.name}</span>
                            <div className="fx-param-control">
                              <input
                                type="range"
                                className="fx-slider"
                                min={param.min ?? 0}
                                max={param.max ?? 100}
                                step={param.step ?? 1}
                                value={numVal}
                                onChange={(e) => updateParam(fx.id, param.id, Number(e.target.value), false)}
                                onMouseUp={() => history.settle(`Change ${param.name}`)}
                                onKeyUp={() => history.settle(`Change ${param.name}`)}
                              />
                              <ScrubNumber
                                value={numVal}
                                min={param.min ?? -Infinity}
                                max={param.max ?? Infinity}
                                step={param.step ?? 1}
                                suffix={param.unit ? ` ${param.unit}` : ''}
                                onChange={(next) => updateParam(fx.id, param.id, next, false)}
                                onCommit={() => history.settle(`Change ${param.name}`)}
                              />
                            </div>
                          </div>
                        );
                      }

                      if (param.type === 'select' && param.options) {
                        return (
                          <div key={param.id} className="fx-param-row">
                            <span className="fx-param-label">{param.name}</span>
                            <div className="fx-param-control">
                              <select
                                className="prop-select"
                                value={String(val)}
                                onChange={(e) => updateParam(fx.id, param.id, e.target.value, true)}
                              >
                                {param.options.map((opt) => (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                        );
                      }

                      if (param.type === 'color') {
                        return (
                          <div key={param.id} className="fx-param-row">
                            <span className="fx-param-label">{param.name}</span>
                            <div className="fx-param-control" style={{ gap: 6 }}>
                              <input
                                type="color"
                                value={String(val)}
                                onChange={(e) => updateParam(fx.id, param.id, e.target.value, true)}
                                style={{ width: 26, height: 22, border: 'none', background: 'transparent', cursor: 'pointer' }}
                              />
                              <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#cbd5e1' }}>{String(val)}</span>
                            </div>
                          </div>
                        );
                      }

                      if (param.type === 'boolean') {
                        return (
                          <div key={param.id} className="fx-param-row">
                            <span className="fx-param-label">{param.name}</span>
                            <div className="fx-param-control" style={{ justifyContent: 'flex-start', paddingLeft: 2 }}>
                              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                                <input
                                  type="checkbox"
                                  checked={!!val}
                                  onChange={(e) => updateParam(fx.id, param.id, e.target.checked, true)}
                                  style={{ cursor: 'pointer', width: 14, height: 14, accentColor: '#00e5ff' }}
                                />
                                <span style={{ fontSize: 11, color: val ? '#00e5ff' : '#94a3b8' }}>
                                  {val ? 'Enabled' : 'Disabled'}
                                </span>
                              </label>
                            </div>
                          </div>
                        );
                      }

                      return null;
                    })
                  )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Add Effect Modal / Drawer */}
      {addModalOpen && (
        <div className="fx-add-overlay" onClick={() => setAddModalOpen(false)}>
          <div className="fx-add-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="fx-add-header">
              <span className="fx-add-title">Add Effect to {clipName(project, assets, clip)}</span>
              <button type="button" className="icon-btn small" onClick={() => setAddModalOpen(false)}>
                <X size={14} />
              </button>
            </div>

            {/* Search row */}
            <div className="fx-add-search-row">
              <Search size={14} style={{ color: '#00e5ff' }} />
              <input
                autoFocus
                className="fx-add-search-input"
                placeholder="Search all Helios effects..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            {/* Categories */}
            <div className="fx-add-cats">
              {['All', ...EFFECT_CATEGORIES].map((cat) => (
                <button
                  key={cat}
                  type="button"
                  className={`fx-cat-pill${selectedCat === cat ? ' active' : ''}`}
                  onClick={() => setSelectedCat(cat)}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Effects list */}
            <div className="fx-add-list">
              {filteredAvailableEffects.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>
                  No effects found matching "{searchQuery}"
                </div>
              ) : (
                filteredAvailableEffects.map((eff) => (
                  <div
                    key={eff.id}
                    className="fx-add-item"
                    onClick={() => addEffectToClip(eff)}
                  >
                    <div className="fx-add-item-left">
                      <span className="fx-add-item-name">{eff.label}</span>
                      <span className="fx-add-item-hint">{eff.hint}</span>
                    </div>
                    <span className="fx-add-item-group">{eff.group}</span>
                    <button type="button" className="btn btn-small btn-primary fx-add-apply-btn">
                      <Plus size={11} /> Add
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
