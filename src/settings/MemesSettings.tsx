// Settings › Memes: the @funny meme brain (src-tauri/src/memes.rs). Optional keys for the keyed
// trend providers, what the library holds, and a manual trend refresh. The keyless providers
// (Know Your Meme, Imgflip, Reddit, YouTube through yt-dlp) run without any of this.
import { Check, FolderOpen, Laugh, LoaderCircle, RefreshCw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useToast } from '../components/ui';
import { api, errorText, type ServiceKey } from '../lib/ipc';
import { memesApi, type MemeStats, type TrendReport } from '../lib/roast/memes';

/** The @funny keys, kept in the OS credential store like every other service key (lib.rs SERVICE_KEYS). */
const MEME_SERVICES = ['klipy', 'giphy', 'freesound'];

const when = (iso: string | null) => {
  if (!iso) return 'never';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
};

/** A key that is filed here and never shown again: paste to set, the bin to remove. */
function MemeKeyField({ label, blurb, saved, onSave }: { label: string; blurb: string; saved: boolean; onSave: (key: string | null) => void }) {
  const [value, setValue] = useState('');
  const save = (key: string | null) => {
    onSave(key);
    setValue('');
  };
  return (
    <label className="field">
      <span>
        {label} API key
        {saved && <span className="key-saved"><Check size={11} /> saved</span>}
      </span>
      <div className="key-row">
        <input
          type="password"
          value={value}
          spellCheck={false}
          autoComplete="off"
          placeholder={saved ? 'A saved key is in place — paste a new one to replace it' : `Paste your ${label} key (optional)`}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && value.trim()) {
              event.preventDefault();
              save(value.trim());
            }
          }}
        />
        <button type="button" className="btn btn-small" disabled={!value.trim()} onClick={() => save(value.trim())}><Check size={12} /> Save</button>
        {saved && <button type="button" className="btn btn-small btn-ghost" title={`Remove the ${label} key`} onClick={() => save(null)}><Trash2 size={12} /></button>}
      </div>
      <span className="field-hint">{blurb}</span>
    </label>
  );
}

export function MemesSettings() {
  const toast = useToast();
  const [stats, setStats] = useState<MemeStats | null>(null);
  const [services, setServices] = useState<ServiceKey[]>([]);
  useEffect(() => {
    void api.serviceKeys().then(setServices).catch(() => undefined);
  }, []);
  const saveKey = (id: string, key: string | null) => {
    void api.serviceSetKey(id, key ?? '').then(setServices).catch((error) => toast({ tone: 'error', title: 'Could not save the key', body: errorText(error) }));
  };
  const [report, setReport] = useState<TrendReport | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    void memesApi.stats().then(setStats).catch((error) => toast({ tone: 'error', title: 'Could not read the meme library', body: errorText(error) }));
  }, [toast]);
  useEffect(() => load(), [load]);

  const refresh = async () => {
    setBusy(true);
    try {
      const next = await memesApi.refresh(true);
      setReport(next);
      load();
      toast({ tone: next.problems.length ? 'info' : 'success', title: `${next.candidates.length} trending candidates`, body: next.problems.length ? `${next.problems.length} provider problem(s) — see below.` : 'Every provider answered.' });
    } catch (error) {
      toast({ tone: 'error', title: 'Trend refresh failed', body: errorText(error) });
    } finally {
      setBusy(false);
    }
  };

  const counts = report?.counts ?? stats?.trendCounts ?? {};
  const problems = report?.problems ?? stats?.trendProblems ?? [];
  const candidates = report?.candidates.length ?? stats?.trendCandidates ?? 0;
  const lastRefresh = report?.fetchedAt ?? stats?.lastRefresh ?? null;

  return (
    <div className="storage-settings memes-settings">
      <div className="settings-intro">
        <div>
          <h3>Memes</h3>
          <p>The @funny edit style picks memes for what they mean: a library of Indian and global memes with their meaning, when to use them and when not to, refreshed from what is trending. Every key here is optional.</p>
        </div>
      </div>

      <section className="storage-card">
        <div className="storage-card-head">
          <Laugh size={16} />
          <div className="storage-card-copy">
            <strong>Library</strong>
            <span className="muted small">
              {stats ? `${stats.total} memes — ${stats.seed} shipped, ${stats.user} saved by Helios AI${stats.overrides ? `, ${stats.overrides} shipped ones updated` : ''} · ${stats.verified} verified · ${stats.cachedMedia} clips downloaded` : '…'}
            </span>
            {stats && <code className="path" title={stats.folder}>{stats.folder}</code>}
          </div>
          {stats && <button type="button" className="btn btn-small" onClick={() => void api.openPath(stats.folder).catch((error) => toast({ tone: 'error', title: 'Could not open the folder', body: errorText(error) }))}><FolderOpen size={12} /> Open</button>}
        </div>
      </section>

      <section className="storage-card">
        <div className="storage-card-head">
          <RefreshCw size={16} />
          <div className="storage-card-copy">
            <strong>Trends {lastRefresh && <span className="pill tone-ok">{candidates} candidates</span>}</strong>
            <span className="muted small">Last refresh: {when(lastRefresh)}. Helios AI refreshes at the start of every @funny edit (at most every 6 hours).</span>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => void refresh()} disabled={busy}>{busy ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />} Refresh trends now</button>
        </div>
        {Object.keys(counts).length > 0 && (
          <span className="muted small">{Object.entries(counts).map(([provider, count]) => `${provider} ${count}`).join(' · ')}</span>
        )}
        {problems.length > 0 && (
          <ul className="field-hint warn">
            {problems.map((problem) => <li key={problem}>{problem}</li>)}
          </ul>
        )}
      </section>

      <h4>Keys</h4>
      {services.filter((service) => MEME_SERVICES.includes(service.id)).map((service) => (
        <MemeKeyField
          key={service.id}
          label={service.label}
          blurb={service.blurb}
          saved={service.saved}
          onSave={(value) => saveKey(service.id, value)}
        />
      ))}
    </div>
  );
}
