// The Properties panel's view of a motion scene (src/motion): its template params (edit words,
// times, colours and rebuild), its layers (visibility, blend, motion blur, effects on/off), scene
// motion blur, and the raw scene JSON for anything else. Every change is one undo step.
import { Eye, EyeOff, Layers3, Sparkles, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { findTemplate } from '../motion/kit';
import { BLEND_MODES, type BlendMode, type Layer, type MotionScene } from '../motion/types';
import { validateScene } from '../motion/validate';
import type { History } from '../lib/history';
import { updateComp } from '../lib/timeline';
import type { Clip, Comp } from '../lib/types';
import { buildInBrand } from '../motion/kit/brandify';
import { brandKitById } from '../lib/brandKit/activeStore';
import { motionBrandFromKit } from '../lib/brandKit/motionBrand';

type MotionSource = Extract<Clip['source'], { type: 'motion' }>;

const LAYER_ICON: Record<Layer['type'], string> = { footage: '🎞', solid: '■', procedural: '◈', shape: '◆', text: 'T', null: '⌖', camera: '🎥', precomp: '▣' };

/** A param's value as editable text: strings as-is, string/number lists comma-separated, the rest JSON. */
function toText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value) && value.every((v) => typeof v === 'string' || typeof v === 'number')) return value.join(', ');
  return JSON.stringify(value);
}

function fromText(text: string, previous: unknown): unknown {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  if (typeof previous === 'number') return Number.isFinite(Number(trimmed)) ? Number(trimmed) : previous;
  if (typeof previous === 'boolean') return trimmed === 'true';
  if (Array.isArray(previous) && previous.every((v) => typeof v === 'string' || typeof v === 'number')) {
    const parts = trimmed.split(',').map((part) => part.trim()).filter(Boolean);
    return previous.every((v) => typeof v === 'number') && previous.length ? parts.map(Number) : parts;
  }
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try { return JSON.parse(trimmed); } catch { return previous; }
  }
  if (/^-?\d+(\.\d+)?$/.test(trimmed) && previous === undefined) return Number(trimmed);
  return trimmed;
}

export function MotionInspector({ clip, comp, history, disabled, Section, Row }: {
  clip: Clip;
  comp: Comp;
  history: History;
  disabled: boolean;
  Section: (props: { title: string; icon?: ReactNode; children: ReactNode; defaultOpen?: boolean }) => ReactNode;
  Row: (props: { label: string; children: ReactNode }) => ReactNode;
}) {
  const source = clip.source as MotionSource;
  const scene = source.scene;
  const spec = scene.template ? findTemplate(scene.template.id) : undefined;
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [json, setJson] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    setDraft(Object.fromEntries(Object.keys(spec?.params ?? {}).map((key) => [key, toText(scene.template?.params[key])])));
    setJson(JSON.stringify(scene, null, 2));
    setProblem(null);
  }, [clip.id, scene, spec]);

  const commitScene = (next: MotionScene, label: string) => {
    const problems = validateScene(next);
    if (problems.length) { setProblem(problems.slice(0, 3).join(' ')); return; }
    setProblem(null);
    history.commit((current) => updateComp(current, comp.id, (c) => ({ ...c, clips: c.clips.map((entry) => (entry.id === clip.id ? { ...entry, source: { ...source, scene: next, frames: undefined } } : entry)) })), label);
  };

  const patchLayer = (id: string, change: Partial<Layer>, label: string) => {
    commitScene({ ...scene, layers: scene.layers.map((layer) => (layer.id === id ? ({ ...layer, ...change } as Layer) : layer)) }, label);
  };

  const rebuild = () => {
    if (!spec || !scene.template) return;
    const params: Record<string, unknown> = { ...scene.template.params };
    for (const [key, text] of Object.entries(draft)) {
      const value = fromText(text, scene.template.params[key]);
      if (value === undefined) delete params[key]; else params[key] = value;
    }
    try {
      const kit = brandKitById(scene.brand?.kitId);
      commitScene(buildInBrand(spec, { width: scene.width, height: scene.height }, params, kit ? motionBrandFromKit(kit) : scene.brand?.snapshot ?? null), `Motion: ${spec.label}`);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  };

  const layerCount = useMemo(() => {
    let n = 0;
    const walk = (s: MotionScene) => { for (const layer of s.layers) { n++; if (layer.type === 'precomp') walk(layer.scene); } };
    walk(scene);
    return n;
  }, [scene]);

  return (
    <>
      <Section title="Motion Scene" icon={<Sparkles size={12} />}>
        <Row label="Template"><span className="prop-readout">{spec ? `${spec.label} (${spec.technique})` : 'Custom scene'}</span></Row>
        <Row label="Canvas"><span className="prop-readout">{scene.width}×{scene.height} · {scene.duration.toFixed(2)} s · {layerCount} layers</span></Row>
        <Row label="Motion blur">
          <select className="prop-select" disabled={disabled} value={String(scene.motionBlur?.samples ?? 8)} onChange={(event) => commitScene({ ...scene, motionBlur: { ...(scene.motionBlur ?? {}), samples: Number(event.target.value) } }, 'Motion Blur')}>
            {[1, 4, 8, 12, 16].map((n) => <option key={n} value={n}>{n === 1 ? 'Off' : `${n} samples`}</option>)}
          </select>
        </Row>
        <Row label="Shutter">
          <select className="prop-select" disabled={disabled} value={String(scene.motionBlur?.shutter ?? 180)} onChange={(event) => commitScene({ ...scene, motionBlur: { ...(scene.motionBlur ?? {}), shutter: Number(event.target.value) } }, 'Shutter Angle')}>
            {[90, 180, 270, 360].map((n) => <option key={n} value={n}>{n}°</option>)}
          </select>
        </Row>
      </Section>

      {spec && (
        <Section title="Template Params" icon={<Wand2 size={12} />}>
          {Object.entries(spec.params).map(([key, help]) => (
            <Row key={key} label={key}>
              <input className="prop-input" title={help} placeholder={help} value={draft[key] ?? ''} disabled={disabled}
                onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))}
                onKeyDown={(event) => { if (event.key === 'Enter') rebuild(); }} />
            </Row>
          ))}
          <button type="button" className="btn btn-small btn-primary" disabled={disabled} onClick={rebuild}><Wand2 size={12} /> Rebuild scene</button>
        </Section>
      )}

      <Section title="Layers" icon={<Layers3 size={12} />} defaultOpen={false}>
        {[...scene.layers].reverse().map((layer) => (
          <div key={layer.id} className="motion-layer-row" style={{ display: 'grid', gridTemplateColumns: '18px 1fr auto auto auto', gap: 6, alignItems: 'center', padding: '2px 0' }}>
            <span title={layer.type}>{LAYER_ICON[layer.type]}</span>
            <span className="prop-readout" title={`${layer.id}${layer.effects?.length ? ` · ${layer.effects.map((e) => e.type).join(', ')}` : ''}`}>{layer.name ?? layer.id}</span>
            <select className="prop-select" style={{ width: 92 }} disabled={disabled || layer.type === 'null' || layer.type === 'camera'} value={layer.blend ?? 'normal'} onChange={(event) => patchLayer(layer.id, { blend: event.target.value as BlendMode }, 'Blend Mode')}>
              {BLEND_MODES.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
            </select>
            <button type="button" className={`icon-btn small${layer.motionBlur ? ' active' : ''}`} title="Motion blur" disabled={disabled} onClick={() => patchLayer(layer.id, { motionBlur: !layer.motionBlur }, 'Layer Motion Blur')}>◍</button>
            <button type="button" className="icon-btn small" title={layer.hidden ? 'Show layer' : 'Hide layer'} disabled={disabled} onClick={() => patchLayer(layer.id, { hidden: !layer.hidden }, layer.hidden ? 'Show Layer' : 'Hide Layer')}>{layer.hidden ? <EyeOff size={12} /> : <Eye size={12} />}</button>
            {!!layer.effects?.length && (
              <div style={{ gridColumn: '2 / -1', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {layer.effects.map((effect, index) => (
                  <button key={index} type="button" className={`btn btn-small${effect.enabled === false ? '' : ' btn-primary'}`} disabled={disabled}
                    onClick={() => patchLayer(layer.id, { effects: layer.effects!.map((e, i) => (i === index ? { ...e, enabled: e.enabled === false } : e)) }, 'Toggle Effect')}>
                    {effect.type}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </Section>

      <Section title="Scene JSON" defaultOpen={false}>
        <textarea className="prop-textarea" rows={12} spellCheck={false} value={json} disabled={disabled} onChange={(event) => setJson(event.target.value)} style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11 }} />
        <button type="button" className="btn btn-small" disabled={disabled} onClick={() => {
          try { commitScene(JSON.parse(json) as MotionScene, 'Edit Motion Scene'); } catch (error) { setProblem(`Not JSON: ${error instanceof Error ? error.message : String(error)}`); }
        }}>Apply JSON</button>
      </Section>
      {problem && <div className="props-note" role="alert">{problem}</div>}
    </>
  );
}
