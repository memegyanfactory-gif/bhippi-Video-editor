// Settings › Connectors: cloud image and video generators on the user's own keys. Everything is
// off until the user turns the master switch on and saves a key; a saved key is checked against
// the service before it is trusted. Keys go to the OS credential store through Rust.
import { useEffect, useState } from 'react';
import { Check, ExternalLink, Film, Image as ImageIcon, KeyRound, LoaderCircle, PlugZap, TriangleAlert, Trash2 } from 'lucide-react';
import { Toggle } from '../components/ui';
import { api, errorText } from '../lib/ipc';
import { cloudPrefs, genApi, logoOf, type GenConnector } from '../lib/cloudGen';
import { QUALITY_LABELS } from '../lib/modelAdvisor';
import type { CloudGenerationPrefs, Settings } from '../lib/types';
import { Row, Section, SettingsHeader } from './SettingsLayout';
import '../styles/generation.css';

export function ConnectorLogo({ id, size = 36 }: { id: string; size?: number }) {
  return (
    <span className="gen-logo" style={{ width: size, height: size, background: id === 'luma' || id === 'minimax' ? '#111' : undefined }}>
      <img src={logoOf(id)} alt="" width={id === 'luma' || id === 'minimax' ? size * 0.7 : size} height={id === 'luma' || id === 'minimax' ? size * 0.7 : size} draggable={false} />
    </span>
  );
}

type Status = { state: 'idle' | 'testing' | 'ok' | 'error'; message?: string };

export function ConnectorsSettings({ settings, onSettings }: { settings: Settings; onSettings: (value: Settings) => void }) {
  const [rows, setRows] = useState<GenConnector[] | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<Record<string, Status>>({});
  const prefs = cloudPrefs(settings);

  useEffect(() => { void genApi.connectors().then(setRows).catch((e) => setError(errorText(e))); }, []);

  const save = (patch: CloudGenerationPrefs) => {
    const next = { ...settings, cloudGeneration: { ...prefs, ...patch } };
    void api.settingsSave(next).then(onSettings).catch((e) => setError(errorText(e)));
  };
  const setConnector = (id: string, patch: { enabled?: boolean; videoModel?: string | null; imageModel?: string | null }) =>
    save({ connectors: { ...prefs.connectors, [id]: { ...prefs.connectors[id], ...patch } } });

  const test = async (id: string) => {
    setStatus((s) => ({ ...s, [id]: { state: 'testing' } }));
    try {
      const result = await genApi.test(id);
      setStatus((s) => ({ ...s, [id]: { state: result.ok ? 'ok' : 'error', message: result.message } }));
    } catch (e) {
      setStatus((s) => ({ ...s, [id]: { state: 'error', message: errorText(e) } }));
    }
  };

  const saveKey = async (id: string, key: string, secret?: string) => {
    try {
      setRows(await genApi.setKey(id, key, secret));
      if (key.trim()) {
        // A fresh key is switched on for the AI and checked straight away.
        if (prefs.connectors[id]?.enabled === false) setConnector(id, { enabled: true });
        await test(id);
      } else {
        setStatus((s) => ({ ...s, [id]: { state: 'idle' } }));
      }
    } catch (e) { setStatus((s) => ({ ...s, [id]: { state: 'error', message: errorText(e) } })); }
  };

  const connected = rows?.filter((row) => row.saved) ?? [];
  const allModels = (kind: 'video' | 'image') => connected.flatMap((row) => row.models.filter((m) => m.kind === kind).map((m) => ({ ref: `${row.id}:${m.id}`, label: `${row.label} · ${m.label}` })));

  return (
    <div className="connectors-settings">
      <SettingsHeader title={<><PlugZap size={18} /> Connectors</>}>
        Generate video clips and images in the cloud with your own accounts — Higgsfield, Magnific (Freepik), Google Veo, Runway, Kling and more.
        Nothing here is required. Keys stay in this computer’s credential store and are only sent to the service they belong to.
      </SettingsHeader>

      <div className="conn-master">
        <div>
          <strong>Let the AI generate clips with connected services</strong>
          <span>{prefs.enabled
            ? `On · ${connected.length ? `${connected.length} connected` : 'add a key below'}. Generations spend credits on your account.`
            : 'Off · the AI never calls a cloud generator. Turn on, then add at least one key.'}</span>
        </div>
        <Toggle checked={prefs.enabled} onChange={(on) => save({ enabled: on })} label="Cloud generation" />
      </div>

      {prefs.enabled && (
        <Section title="How the AI uses them">
          <Row title="Show the plan before generating" hint="The AI lists every clip it wants — prompt, reference image, model and length — and waits for you to edit or approve it. Recommended: generations cost credits.">
            <Toggle checked={prefs.confirm} onChange={(on) => save({ confirm: on })} label="Confirm before generating" />
          </Row>
          <Row title="Default video model" hint="Used first when the AI needs a clip. Reference images route to a model that accepts them.">
            <select value={prefs.defaultVideo ?? ''} onChange={(event) => save({ defaultVideo: event.target.value || null })} aria-label="Default video model" disabled={!allModels('video').length}>
              <option value="">Best available</option>
              {allModels('video').map((m) => <option key={m.ref} value={m.ref}>{m.label}</option>)}
            </select>
          </Row>
          <Row title="Default image model">
            <select value={prefs.defaultImage ?? ''} onChange={(event) => save({ defaultImage: event.target.value || null })} aria-label="Default image model" disabled={!allModels('image').length}>
              <option value="">Best available</option>
              {allModels('image').map((m) => <option key={m.ref} value={m.ref}>{m.label}</option>)}
            </select>
          </Row>
        </Section>
      )}

      {!rows && !error && <p className="muted"><LoaderCircle size={12} className="spin" /> Loading connectors…</p>}
      {error && <p role="alert" className="field-hint error">{error}</p>}
      <div className="conn-grid">
        {rows?.map((row) => (
          <ConnectorCard key={row.id} row={row} status={status[row.id] ?? { state: 'idle' }}
            enabled={prefs.connectors[row.id]?.enabled !== false}
            videoModel={prefs.connectors[row.id]?.videoModel ?? null}
            imageModel={prefs.connectors[row.id]?.imageModel ?? null}
            onEnabled={(on) => setConnector(row.id, { enabled: on })}
            onModel={(kind, id) => setConnector(row.id, kind === 'video' ? { videoModel: id } : { imageModel: id })}
            onSave={(key, secret) => void saveKey(row.id, key, secret)}
            onTest={() => void test(row.id)} />
        ))}
      </div>
    </div>
  );
}

function ConnectorCard({ row, status, enabled, videoModel, imageModel, onEnabled, onModel, onSave, onTest }: {
  row: GenConnector; status: Status; enabled: boolean; videoModel: string | null; imageModel: string | null;
  onEnabled: (on: boolean) => void; onModel: (kind: 'video' | 'image', id: string | null) => void;
  onSave: (key: string, secret?: string) => void; onTest: () => void;
}) {
  const [key, setKey] = useState('');
  const [secret, setSecret] = useState('');
  const videos = row.models.filter((m) => m.kind === 'video');
  const images = row.models.filter((m) => m.kind === 'image');
  const submit = () => { if (key.trim() && (!row.secretLabel || secret.trim())) { onSave(key.trim(), row.secretLabel ? secret.trim() : undefined); setKey(''); setSecret(''); } };
  return (
    <div className={`conn-card${row.saved ? ' connected' : ''}${row.saved && !enabled ? ' off' : ''}`}>
      <div className="conn-head">
        <ConnectorLogo id={row.id} />
        <div className="conn-head-text">
          <strong>{row.label}</strong>
          <span>{row.tagline}</span>
        </div>
        {row.saved
          ? <Toggle checked={enabled} onChange={onEnabled} label={`Let the AI use ${row.label}`} />
          : <span className="pill tone-off">Not connected</span>}
      </div>
      <div className="conn-models">
        {videos.map((m) => <span key={m.id} className="conn-chip video" title={m.note ?? undefined}><Film size={10} /> {m.label}</span>)}
        {images.map((m) => <span key={m.id} className="conn-chip" title={m.note ?? undefined}><ImageIcon size={10} /> {m.label}</span>)}
      </div>

      {row.saved ? (
        <>
          <div className="conn-picks">
            {videos.length > 0 && (
              <label>Video model
                <select value={videoModel ?? ''} onChange={(event) => onModel('video', event.target.value || null)}>
                  <option value="">Best · {bestLabel(videos)}</option>
                  {videos.map((m) => <option key={m.id} value={m.id}>{m.label} · {QUALITY_LABELS[m.quality]}{m.modes.includes('image') ? ' · takes images' : ''}</option>)}
                </select>
              </label>
            )}
            {images.length > 0 && (
              <label>Image model
                <select value={imageModel ?? ''} onChange={(event) => onModel('image', event.target.value || null)}>
                  <option value="">Best · {bestLabel(images)}</option>
                  {images.map((m) => <option key={m.id} value={m.id}>{m.label} · {QUALITY_LABELS[m.quality]}</option>)}
                </select>
              </label>
            )}
          </div>
          <div className="conn-foot">
            <span className={`conn-status ${status.state === 'ok' ? 'ok' : status.state === 'error' ? 'error' : ''}`}>
              {status.state === 'testing' ? <><LoaderCircle size={11} className="spin" /> Checking the key…</>
                : status.state === 'ok' ? <><Check size={11} /> {status.message || 'Key works'}</>
                : status.state === 'error' ? <><TriangleAlert size={11} /> {status.message}</>
                : <><KeyRound size={11} /> Key saved</>}
            </span>
            <span>
              <button type="button" className="btn btn-small btn-ghost" onClick={onTest} disabled={status.state === 'testing'}>Test</button>
              <button type="button" className="btn btn-small btn-ghost" onClick={() => onSave('')} title="Remove the key"><Trash2 size={12} /></button>
            </span>
          </div>
        </>
      ) : (
        <>
          <form className="conn-key" onSubmit={(event) => { event.preventDefault(); submit(); }}>
            <input type="password" value={key} onChange={(event) => setKey(event.target.value)} placeholder={row.keyLabel} aria-label={`${row.label} ${row.keyLabel}`} autoComplete="off" spellCheck={false} />
            {row.secretLabel && <input type="password" value={secret} onChange={(event) => setSecret(event.target.value)} placeholder={row.secretLabel} aria-label={`${row.label} ${row.secretLabel}`} autoComplete="off" spellCheck={false} />}
            <button type="submit" className="btn btn-small btn-primary" disabled={!key.trim() || (!!row.secretLabel && !secret.trim())}>Connect</button>
          </form>
          {status.state === 'error' && <span className="conn-status error"><TriangleAlert size={11} /> {status.message}</span>}
          <div className="conn-foot">
            <span className="muted">{row.keyHint}</span>
            <a href={row.keyUrl} onClick={(event) => { event.preventDefault(); void api.openUrl(row.keyUrl); }}>Get a key <ExternalLink size={10} /></a>
          </div>
        </>
      )}
    </div>
  );
}

const bestLabel = (models: { label: string; quality: number }[]) => [...models].sort((a, b) => b.quality - a.quality)[0]?.label ?? '';
