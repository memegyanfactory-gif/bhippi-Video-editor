// The card the AI's generate_cloud_media call waits on: every clip it wants, with the prompt, the
// reference image (or "from this prompt"), the service and model, length and shape — all editable.
// Nothing is generated or charged until the editor presses Generate.
import { useEffect, useMemo, useState } from 'react';
import { Film, Image as ImageIcon, ImagePlus, Sparkles, Undo2, X } from 'lucide-react';
import { fileSrc } from '../lib/ipc';
import { genApi, sourceLine, type GenConnector, type GenPlan, type GenPlanItem } from '../lib/cloudGen';
import { QUALITY_LABELS } from '../lib/modelAdvisor';
import type { Asset } from '../lib/types';
import { ConnectorLogo } from '../settings/ConnectorsSettings';
import '../styles/generation.css';

export function GenerationPlanCard({ plan, assets, onDone }: {
  plan: GenPlan;
  assets: Map<string, Asset>;
  /** The edited plan to run, or null to cancel the whole request. */
  onDone: (plan: GenPlan | null) => void;
}) {
  const [items, setItems] = useState<GenPlanItem[]>(plan.items);
  const [connectors, setConnectors] = useState<GenConnector[]>([]);
  const [picking, setPicking] = useState<string | null>(null);
  useEffect(() => { void genApi.connectors().then((rows) => setConnectors(rows.filter((row) => row.saved))).catch(() => undefined); }, []);
  const images = useMemo(() => [...assets.values()].filter((asset) => asset.kind === 'image' && !asset.missing).slice(-40).reverse(), [assets]);
  const update = (key: string, patch: Partial<GenPlanItem>) => setItems((list) => list.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  const live = items.filter((item) => !item.skip && item.prompt.trim());
  const seconds = live.filter((item) => item.kind === 'video').reduce((sum, item) => sum + (item.duration ?? 5), 0);
  const allImages = items.every((item) => item.kind === 'image');
  const noun = allImages ? (items.length === 1 ? 'image' : 'images') : items.length === 1 ? 'clip' : 'clips';

  return (
    <div className="genplan-card" role="group" aria-label="Generation plan">
      <div className="genplan-head">
        <Sparkles size={13} />
        <strong>Bhippi AI wants to generate {items.length === 1 ? 'this' : `these ${items.length}`} {noun}</strong>
        <span className="genplan-cost">Uses your connector credits</span>
      </div>
      {plan.reason && <p className="ask-context">{plan.reason}</p>}
      {items.map((item, index) => {
        const connector = connectors.find((row) => row.id === item.connector);
        const model = connector?.models.find((m) => m.id === item.model);
        const withRef = item.referenceAssetIds.length > 0;
        const options = connectors.flatMap((row) => row.models
          .filter((m) => m.kind === item.kind && (withRef ? m.modes.includes('image') : m.modes.includes('text')))
          .map((m) => ({ row, m })));
        const ref = item.referenceAssetIds[0] ? assets.get(item.referenceAssetIds[0]) : undefined;
        return (
          <div key={item.key} className={`genplan-item${item.skip ? ' skipped' : ''}`}>
            <div className="genplan-ref" title={ref ? `Reference: ${ref.name}` : 'No reference image — generated from the prompt'}>
              {ref ? (
                <>
                  <img src={fileSrc(ref.thumbnail ?? ref.path)} alt={ref.name} />
                  {!item.skip && <button type="button" aria-label="Remove reference image" onClick={() => update(item.key, { referenceAssetIds: [] })}><X size={10} /></button>}
                </>
              ) : (
                <>{item.kind === 'video' ? <Film size={16} /> : <ImageIcon size={16} />}<span>Prompt only</span></>
              )}
            </div>
            <div className="genplan-body">
              <div className="genplan-meta">
                <strong>{index + 1}. {item.kind === 'video' ? 'Clip' : 'Image'}</strong>
                {item.purpose && <span>· {item.purpose}</span>}
              </div>
              <span className="genplan-source">{sourceLine(item, (id) => assets.get(id)?.name)}</span>
              <textarea value={item.prompt} disabled={item.skip} aria-label={`Prompt ${index + 1}`} onChange={(event) => update(item.key, { prompt: event.target.value })} />
              <div className="genplan-meta">
                {connector && <ConnectorLogo id={connector.id} size={18} />}
                <select aria-label={`Model ${index + 1}`} disabled={item.skip} value={`${item.connector}:${item.model}`}
                  onChange={(event) => { const [c, ...m] = event.target.value.split(':'); update(item.key, { connector: c, model: m.join(':') }); }}>
                  {!options.some(({ row, m }) => row.id === item.connector && m.id === item.model) && <option value={`${item.connector}:${item.model}`}>{connector?.label ?? item.connector} · {model?.label ?? item.model}</option>}
                  {options.map(({ row, m }) => <option key={`${row.id}:${m.id}`} value={`${row.id}:${m.id}`}>{row.label} · {m.label} ({QUALITY_LABELS[m.quality]})</option>)}
                </select>
                {item.kind === 'video' && model && model.durations.length > 0 && (
                  <select aria-label={`Length ${index + 1}`} disabled={item.skip} value={model.durations.includes(item.duration ?? -1) ? item.duration : model.durations[0]} onChange={(event) => update(item.key, { duration: Number(event.target.value) })}>
                    {model.durations.map((d) => <option key={d} value={d}>{d} s</option>)}
                  </select>
                )}
                {model && (
                  <select aria-label={`Shape ${index + 1}`} disabled={item.skip} value={model.aspects.includes(item.aspect ?? '') ? item.aspect : model.aspects[0]} onChange={(event) => update(item.key, { aspect: event.target.value })}>
                    {model.aspects.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                )}
                {!item.skip && (
                  <button type="button" className="btn btn-small btn-ghost" onClick={() => setPicking(picking === item.key ? null : item.key)}>
                    <ImagePlus size={12} /> {ref ? 'Change image' : 'Use an image'}
                  </button>
                )}
                <button type="button" className="btn btn-small btn-ghost" onClick={() => update(item.key, { skip: !item.skip })}>{item.skip ? <><Undo2 size={12} /> Keep</> : 'Skip'}</button>
              </div>
              {picking === item.key && (
                <div className="genplan-refs-pick" role="listbox" aria-label="Reference image">
                  {images.length ? images.map((asset) => (
                    <button key={asset.id} type="button" title={asset.name} role="option" aria-selected={item.referenceAssetIds[0] === asset.id}
                      onClick={() => {
                        // A reference needs a model that takes images; switch to one if the current model is text-only.
                        const takes = model?.modes.includes('image');
                        const alt = takes ? null : connectors.flatMap((row) => row.models.filter((m) => m.kind === item.kind && m.modes.includes('image')).map((m) => ({ row, m })))[0];
                        update(item.key, { referenceAssetIds: [asset.id], ...(alt ? { connector: alt.row.id, model: alt.m.id } : {}) });
                        setPicking(null);
                      }}>
                      <img src={fileSrc(asset.thumbnail ?? asset.path)} alt={asset.name} />
                    </button>
                  )) : <span className="muted small">Import an image into the project first (Ctrl+I), then pick it here.</span>}
                </div>
              )}
            </div>
          </div>
        );
      })}
      <div className="genplan-actions">
        <button type="button" className="btn btn-ghost" onClick={() => onDone(null)}>Cancel, don’t generate</button>
        <span className="spacer" />
        <span className="genplan-cost">{live.length} to generate{seconds ? ` · ${seconds} s of video` : ''}</span>
        <button type="button" className="btn btn-primary" disabled={!live.length} onClick={() => onDone({ ...plan, items })}>
          <Sparkles size={13} /> Generate{live.length > 1 ? ` ${live.length}` : ''}
        </button>
      </div>
    </div>
  );
}
