// Onboarding › Generation: how (or whether) Bhippi AI may make clips and images. Three answers,
// none required — cloud connectors on the user's own keys, models downloaded to this PC (with an
// honest verdict of what this PC can run), or neither. Cloud and local can both be picked.
import { useEffect, useState } from 'react';
import { Check, Cloud, Cpu, LoaderCircle, TriangleAlert, X } from 'lucide-react';
import { api, errorText } from '../lib/ipc';
import { genApi, type GenConnector } from '../lib/cloudGen';
import { LOCAL_MODELS, assess, recommend } from '../lib/modelAdvisor';
import { ConnectorLogo } from '../settings/ConnectorsSettings';
import { HardwareCard, ModelFitRow, useHardware } from '../settings/LocalModelAdvisor';
import '../styles/generation.css';

export type GenChoice = { cloud: boolean; local: boolean };

const FEATURED = ['higgsfield', 'magnific', 'google', 'runway', 'kling'];

export function GenerationStep({ choice, onChoice, localTasks, onLocalTasks, installed }: {
  choice: GenChoice;
  onChoice: (next: GenChoice) => void;
  /** Local generation models ticked for download. */
  localTasks: Set<string>;
  onLocalTasks: (next: Set<string>) => void;
  /** Local model tasks already on disk. */
  installed: Set<string>;
}) {
  const { hw, error } = useHardware();
  const [rows, setRows] = useState<GenConnector[]>([]);
  const [keys, setKeys] = useState<Record<string, { key: string; secret: string }>>({});
  const [status, setStatus] = useState<Record<string, { state: 'busy' | 'ok' | 'error'; message?: string }>>({});
  useEffect(() => { void genApi.connectors().then(setRows).catch(() => undefined); }, []);

  // Tick the recommended local models the first time Local is chosen.
  useEffect(() => {
    if (!choice.local || localTasks.size || !hw) return;
    // Gated models (FLUX) need a Hugging Face token, so onboarding never ticks them for the user.
    const picks = (['video', 'image'] as const).map((kind) => {
      const best = recommend(kind, hw);
      if (!best?.gated) return best?.task;
      const fallback = LOCAL_MODELS.find((m) => m.kind === kind && m.downloadable && !m.gated && ['great', 'ok'].includes(assess(m, hw).fit));
      return fallback?.task;
    }).filter((task): task is string => !!task && !installed.has(task));
    if (picks.length) onLocalTasks(new Set(picks));
  }, [choice.local, hw]);

  const connect = async (row: GenConnector) => {
    const entry = keys[row.id];
    if (!entry?.key.trim()) return;
    setStatus((s) => ({ ...s, [row.id]: { state: 'busy' } }));
    try {
      setRows(await genApi.setKey(row.id, entry.key.trim(), row.secretLabel ? entry.secret.trim() : undefined));
      const result = await genApi.test(row.id);
      setStatus((s) => ({ ...s, [row.id]: { state: result.ok ? 'ok' : 'error', message: result.message } }));
    } catch (e) {
      setStatus((s) => ({ ...s, [row.id]: { state: 'error', message: errorText(e) } }));
    }
  };

  const none = !choice.cloud && !choice.local;
  const ordered = [...rows].sort((a, b) => (FEATURED.indexOf(a.id) + 1 || 99) - (FEATURED.indexOf(b.id) + 1 || 99));

  return (
    <div className="onboarding-body">
      <h2>Should the AI generate clips?</h2>
      <p className="onboarding-lead">When a shot can’t be found as real footage, Bhippi AI can generate it — always showing you the prompt and reference image first. All optional; change it any time in Settings.</p>
      <div className="gen-choice" role="group" aria-label="Generation choice">
        <button type="button" role="checkbox" aria-checked={choice.cloud} onClick={() => onChoice({ ...choice, cloud: !choice.cloud })}>
          <span className="gen-choice-logos">{['higgsfield', 'magnific', 'google', 'runway', 'kling'].map((id) => <ConnectorLogo key={id} id={id} size={20} />)}</span>
          <strong><Cloud size={13} /> Online models</strong>
          <span>Higgsfield, Magnific (Freepik), Veo, Runway, Kling and more on your own account. Best quality; uses your credits.</span>
        </button>
        <button type="button" role="checkbox" aria-checked={choice.local} onClick={() => onChoice({ ...choice, local: !choice.local })}>
          <span className="gen-choice-logos"><Cpu size={20} /></span>
          <strong><Cpu size={13} /> On this computer</strong>
          <span>Free and private. Quality depends on your GPU — see what yours can run below.</span>
        </button>
        <button type="button" role="radio" aria-checked={none} onClick={() => onChoice({ cloud: false, local: false })}>
          <span className="gen-choice-logos"><X size={20} /></span>
          <strong>Neither for now</strong>
          <span>The AI uses real footage from the web and animated graphics instead.</span>
        </button>
      </div>

      {choice.cloud && (
        <div className="gen-onb-list" aria-label="Online connectors">
          {ordered.map((row) => {
            const st = status[row.id];
            return (
              <div key={row.id} className="gen-onb-conn">
                <ConnectorLogo id={row.id} size={28} />
                <div className="conn-head-text">
                  <strong>{row.label}</strong>
                  <span>{row.tagline}</span>
                  {st?.state === 'error' && <span className="conn-status error"><TriangleAlert size={11} /> {st.message}</span>}
                </div>
                {row.saved && st?.state !== 'error' ? (
                  <span className="pill tone-ok"><Check size={11} /> {st?.message ?? 'Connected'}</span>
                ) : (
                  <>
                    <input type="password" placeholder={row.keyLabel} aria-label={`${row.label} ${row.keyLabel}`} autoComplete="off" spellCheck={false}
                      value={keys[row.id]?.key ?? ''} onChange={(event) => setKeys((k) => ({ ...k, [row.id]: { key: event.target.value, secret: k[row.id]?.secret ?? '' } }))} />
                    {row.secretLabel && (
                      <input type="password" placeholder={row.secretLabel} aria-label={`${row.label} ${row.secretLabel}`} autoComplete="off" spellCheck={false}
                        value={keys[row.id]?.secret ?? ''} onChange={(event) => setKeys((k) => ({ ...k, [row.id]: { key: k[row.id]?.key ?? '', secret: event.target.value } }))} />
                    )}
                    <button type="button" className="btn btn-small" disabled={!keys[row.id]?.key.trim() || (!!row.secretLabel && !keys[row.id]?.secret.trim()) || st?.state === 'busy'} onClick={() => void connect(row)}>
                      {st?.state === 'busy' ? <LoaderCircle size={12} className="spin" /> : 'Connect'}
                    </button>
                    <button type="button" className="btn btn-small btn-ghost" onClick={() => void api.openUrl(row.keyUrl)}>Get key</button>
                  </>
                )}
              </div>
            );
          })}
          <p className="muted small">Skip any you don’t use. Keys are stored in Windows’ credential store and only sent to that service.</p>
        </div>
      )}

      {choice.local && (
        <div className="gen-onb-list" aria-label="Local models">
          <HardwareCard hw={hw} error={error} />
          {LOCAL_MODELS.filter((model) => model.downloadable && !model.gated).map((model) => (
            <ModelFitRow key={model.task} model={model} hw={hw} compact
              install={{ configured: installed.has(model.task), downloading: false, active: false }}
              selected={localTasks.has(model.task)}
              onSelect={(on) => { const next = new Set(localTasks); if (on) next.add(model.task); else next.delete(model.task); onLocalTasks(next); }} />
          ))}
          <p className="muted small">Ticked models download in the background with the AI pack (Python + PyTorch). FLUX.1 needs a free Hugging Face token, so it is offered in Settings › Local generation instead.</p>
        </div>
      )}
    </div>
  );
}
