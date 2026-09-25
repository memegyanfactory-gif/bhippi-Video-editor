// Effect Controls › Magic Masks: the objects picked on this clip with the Magic Mask tool, their
// edge settings, tracking, and one-click looks that put an effect inside or outside a mask.
import { Crosshair, Loader2, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { clipFps } from '../editor/MagicMaskBar';
import { createAppliedEffect } from '../lib/effectFilters';
import { AVAILABLE_EFFECTS } from '../lib/effectsCatalog';
import type { History } from '../lib/history';
import { maskColor, maskStatus, patchMask, setMagicMaskView, trackMaskInProject, useMagicMaskView } from '../lib/magicMask';
import { updateComp, type AssetMap } from '../lib/timeline';
import type { AppliedEffect, Clip, Comp, MagicMask } from '../lib/types';

const LOOKS: { label: string; effectId: string; side: 'inside' | 'outside'; params: Record<string, number> }[] = [
  { label: 'Blur background', effectId: 'gaussian-blur', side: 'outside', params: { blurriness: 24 } },
  { label: 'Pop subject', effectId: 'black-white', side: 'outside', params: { amount: 100 } },
  { label: 'Brighten subject', effectId: 'hue-saturation', side: 'inside', params: { masterLightness: 12, masterSaturation: 10 } },
];

const STATUS = { empty: 'No clicks', untracked: 'Not tracked', stale: 'Changed · track again', tracked: 'Tracked' } as const;

export function MagicMaskSection({ comp, clip, assets, history }: { comp: Comp; clip: Clip; assets: AssetMap; history: History }) {
  const view = useMagicMaskView();
  const [open, setOpen] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const masks = clip.magicMasks ?? [];
  const fps = clipFps(clip, assets, comp);
  const tracking = !!view.busy?.startsWith('Tracking');

  if (!masks.length) {
    return (
      <div className="magic-mask-section empty">
        <Crosshair size={13} />
        <span>Magic Mask: pick the Magic Mask tool, click an object in the Program monitor, then limit any effect to it.</span>
      </div>
    );
  }

  const change = (mask: MagicMask, patch: Partial<MagicMask>, label: string) => history.commit((current) => patchMask(current, comp.id, clip.id, mask.id, (entry) => ({ ...entry, ...patch })), label);
  const remove = (mask: MagicMask) => history.commit((current) => patchMask(current, comp.id, clip.id, mask.id, () => null), `Delete ${mask.name}`);
  const track = (mask: MagicMask) => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    void trackMaskInProject(history, comp.id, clip.id, mask.id, fps, controller.signal).catch(() => undefined).finally(() => { if (abort.current === controller) abort.current = null; });
  };
  const addLook = (mask: MagicMask, look: (typeof LOOKS)[number]) => {
    const definition = AVAILABLE_EFFECTS.find((effect) => effect.id === look.effectId);
    if (!definition) return;
    const base = createAppliedEffect(definition);
    const effect: AppliedEffect = { ...base, name: `${definition.label} · ${look.side} ${mask.name}`, params: { ...base.params, ...look.params }, maskId: mask.id, maskSide: look.side, stackOnly: true };
    history.commit((current) => updateComp(current, comp.id, (entry) => ({ ...entry, clips: entry.clips.map((c) => (c.id === clip.id ? { ...c, appliedEffects: [...(c.appliedEffects ?? []), effect] } : c)) })), `${look.label} (${mask.name})`);
    if (maskStatus(mask, clip) !== 'tracked' && !tracking) track(mask);
  };

  return (
    <div className="magic-mask-section">
      <div className="magic-mask-section-head"><Crosshair size={13} /> Magic Masks</div>
      {masks.map((mask, order) => {
        const status = maskStatus(mask, clip);
        const expanded = open === mask.id;
        return (
          <div key={mask.id} className="magic-mask-card">
            <div className="magic-mask-card-head">
              <span className="magic-mask-swatch" style={{ background: maskColor(mask, order) }} />
              <button type="button" className="magic-mask-name" onClick={() => { setOpen(expanded ? null : mask.id); setMagicMaskView((current) => ({ active: { ...current.active, [clip.id]: mask.id } })); }} aria-expanded={expanded}>{mask.name}</button>
              <span className={`magic-mask-status ${status}`}>{STATUS[status]}</span>
              {tracking && view.busy?.includes(mask.name)
                ? <button type="button" className="btn btn-small" onClick={() => abort.current?.abort()}><Loader2 size={11} className="spin" /> Stop</button>
                : <button type="button" className={`btn btn-small${status === 'untracked' || status === 'stale' ? ' btn-primary' : ''}`} disabled={status === 'empty' || tracking} onClick={() => track(mask)}>Track</button>}
              <button type="button" className="icon-btn small danger" onClick={() => remove(mask)} title={`Delete ${mask.name} (effects limited to it are switched off)`}><Trash2 size={11} /></button>
            </div>
            {expanded && (
              <div className="magic-mask-card-body">
                <label className="fx-param-row"><span className="fx-param-label">Name</span><input className="fx-text" value={mask.name} maxLength={40} onChange={(event) => history.preview((current) => patchMask(current, comp.id, clip.id, mask.id, (entry) => ({ ...entry, name: event.target.value })))} onBlur={() => history.settle('Rename mask')} /></label>
                <label className="fx-param-row"><span className="fx-param-label">Invert</span><input type="checkbox" checked={mask.invert} onChange={(event) => change(mask, { invert: event.target.checked }, 'Invert mask')} /></label>
                <Slider label="Expand" min={-20} max={20} step={1} value={mask.expand} suffix="px" onPreview={(value) => history.preview((current) => patchMask(current, comp.id, clip.id, mask.id, (entry) => ({ ...entry, expand: value })))} onCommit={() => history.settle('Mask expand')} />
                <Slider label="Feather" min={0} max={40} step={1} value={mask.feather} suffix="px" onPreview={(value) => history.preview((current) => patchMask(current, comp.id, clip.id, mask.id, (entry) => ({ ...entry, feather: value })))} onCommit={() => history.settle('Mask feather')} />
                <Slider label="Consistency" min={0} max={1} step={0.05} value={mask.consistency} hint="Steadies a shimmering edge; applies on the next Track" onPreview={(value) => history.preview((current) => patchMask(current, comp.id, clip.id, mask.id, (entry) => ({ ...entry, consistency: value })))} onCommit={() => history.settle('Mask consistency')} />
                <label className="fx-param-row">
                  <span className="fx-param-label">Quality</span>
                  <select value={mask.quality} onChange={(event) => change(mask, { quality: event.target.value as MagicMask['quality'] }, 'Mask quality')}>
                    <option value="fast">Fast · SAM edge</option>
                    <option value="better">Better · ViTMatte edge (hair)</option>
                  </select>
                </label>
                <div className="magic-mask-looks">
                  {LOOKS.map((look) => <button key={look.label} type="button" className="fx-quick-chip" onClick={() => addLook(mask, look)}>{look.label}</button>)}
                </div>
              </div>
            )}
          </div>
        );
      })}
      {view.busy && <div className="magic-mask-busy"><Loader2 size={12} className="spin" /> {view.busy}</div>}
      {view.error && !view.busy && <div className="magic-mask-error" role="alert">{view.error}</div>}
    </div>
  );
}

function Slider({ label, min, max, step, value, suffix = '', hint, onPreview, onCommit }: { label: string; min: number; max: number; step: number; value: number; suffix?: string; hint?: string; onPreview: (value: number) => void; onCommit: () => void }) {
  return (
    <label className="fx-param-row" title={hint}>
      <span className="fx-param-label">{label}</span>
      <div className="fx-param-control">
        <input type="range" className="fx-slider" min={min} max={max} step={step} value={value} onChange={(event) => onPreview(Number(event.target.value))} onPointerUp={onCommit} onKeyUp={onCommit} />
        <span className="fx-param-value">{Number.isInteger(step) ? value : value.toFixed(2)}{suffix}</span>
      </div>
    </label>
  );
}

/** The "Limit to" row of an effect card on a clip with Magic Masks. */
export function EffectMaskRow({ clip, fx, onChange }: { clip: Clip; fx: AppliedEffect; onChange: (patch: Pick<AppliedEffect, 'maskId' | 'maskSide'>) => void }) {
  const masks = clip.magicMasks ?? [];
  if (!masks.length && !fx.maskId) return null;
  const value = fx.maskId ? `${fx.maskId}:${fx.maskSide ?? 'inside'}` : '';
  const mask = masks.find((entry) => entry.id === fx.maskId);
  const note = fx.maskId && !mask ? 'That mask was deleted' : mask && !mask.matte ? `Track ${mask.name} to see this effect` : null;
  return (
    <div className="fx-param-row fx-mask-row">
      <span className="fx-param-label">Limit to</span>
      <div className="fx-param-control">
        <select value={value} onChange={(event) => {
          const [maskId, side] = event.target.value.split(':');
          onChange(maskId ? { maskId, maskSide: side === 'outside' ? 'outside' : 'inside' } : { maskId: null, maskSide: undefined });
        }}>
          <option value="">Whole clip</option>
          {masks.flatMap((entry) => [
            <option key={`${entry.id}:inside`} value={`${entry.id}:inside`}>Inside {entry.name}</option>,
            <option key={`${entry.id}:outside`} value={`${entry.id}:outside`}>Outside {entry.name}</option>,
          ])}
        </select>
        {note && <span className="field-hint">{note}</span>}
      </div>
    </div>
  );
}
