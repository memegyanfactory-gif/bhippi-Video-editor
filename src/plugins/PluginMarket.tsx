// The plugin marketplace inside Bhippi (market.ts): browse what bhippi.com approved, read what a
// plugin may do before installing it, install and update (every download is signature-checked in
// Rust and lock-checked before it installs, and it arrives off until reviewed), see what is
// installed, and follow your own submissions through review.

import { ArrowLeft, BadgeCheck, Download, Flag, RefreshCw, Search, ShieldAlert, Star, Store } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { errorText } from '../lib/ipc';
import {
  browse, CATEGORIES, installFromMarket, listing, myPublisher, mySubmissions, rate, REPORT_REASONS, reportPlugin, reviewsOf, savePublisher, updateFor, withdraw,
  type MarketListing, type MarketPlugin, type Publisher, type Review, type Submission,
} from './market';
import { pluginGlyph } from './PluginsPanel';
import { isSensitiveTool } from './rules';
import { usePlugins } from './store';
import type { Plugin, PluginPermissions } from './types';

type View = 'browse' | 'installed' | 'mine';

const STATUS: Record<Submission['status'], string> = { in_review: 'In review', approved: 'Live', rejected: 'Rejected', revoked: 'Pulled', withdrawn: 'Withdrawn' };

/** What a plugin may do, in plain words, sensitive tools first and flagged. */
export function PermissionSheet({ permissions }: { permissions: PluginPermissions | null }) {
  if (!permissions) return <p className="pm-dim">Its permissions are not listed.</p>;
  const sensitive = permissions.tools.filter((tool) => tool !== '*' && isSensitiveTool(tool));
  const edits = permissions.tools.filter((tool) => tool !== '*' && !isSensitiveTool(tool));
  return (
    <ul className="mk-perms">
      <li>Reads your project (every plugin may).</li>
      {sensitive.map((tool) => <li key={tool} className="warn">Uses <code>{tool}</code>, a sensitive tool</li>)}
      {permissions.tools.includes('*') && <li>May use every editing tool on your project</li>}
      {!!edits.length && <li>Edits your project with {edits.map((tool) => <code key={tool}>{tool}</code>)}</li>}
      {permissions.network.map((host) => <li key={host}>Connects to <code>{host}</code></li>)}
      {permissions.chat && <li>Suggests messages for Bhippi AI (each needs your click)</li>}
      {!permissions.tools.length && !permissions.network.length && !permissions.chat && <li className="ok">Nothing else: it only reads.</li>}
    </ul>
  );
}

export function PluginMarket({ onClose, onOpenInMaker, known }: { onClose: () => void; onOpenInMaker: (id: string) => void; known: ReadonlySet<string> }) {
  const { plugins } = usePlugins();
  const [view, setView] = useState<View>('browse');
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [catalogue, setCatalogue] = useState<MarketPlugin[] | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const key = (event: KeyboardEvent) => event.key === 'Escape' && !(event.target instanceof HTMLInputElement) && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);

  useEffect(() => {
    let live = true;
    const timer = window.setTimeout(() => {
      setError('');
      browse(q, category).then((data) => live && setCatalogue(data.plugins), (failure) => {
        if (!live) return;
        setCatalogue([]);
        setError(errorText(failure));
      });
    }, q ? 250 : 0);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [q, category, refresh]);

  const installed = useMemo(() => new Map(plugins.map((plugin) => [plugin.id, plugin])), [plugins]);

  return (
    <div className="plugin-maker mk" role="dialog" aria-modal="true" aria-label="Plugin marketplace">
      <header className="pm-header">
        <button type="button" className="btn" onClick={onClose} title="Back to editor (Esc)"><ArrowLeft size={13} /> Editor</button>
        <h2><Store size={15} /> Plugin marketplace</h2>
        <nav className="pm-seg" aria-label="Marketplace">
          {([['browse', 'Browse'], ['installed', 'Installed'], ['mine', 'My submissions']] as const).map(([id, label]) => (
            <button key={id} type="button" className={view === id ? 'on' : ''} onClick={() => setView(id)}>{label}</button>
          ))}
        </nav>
        <span className="pm-header-note">Every plugin here was reviewed by Bhippi and is signed. Each one starts off until you read what it may do.</span>
      </header>
      {error && <p className="pm-error" role="alert">{error}<button type="button" onClick={() => setError('')} aria-label="Dismiss">×</button></p>}

      {view === 'browse' && (
        <div className="mk-body">
          <section className="mk-list">
            <div className="mk-filters">
              <label className="mk-search"><Search size={13} /><input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search plugins" aria-label="Search plugins" /></label>
              <div className="mk-chips">
                <button type="button" className={category === '' ? 'on' : ''} onClick={() => setCategory('')}>All</button>
                {CATEGORIES.map((item) => <button key={item} type="button" className={category === item ? 'on' : ''} onClick={() => setCategory(item)}>{item}</button>)}
              </div>
            </div>
            {catalogue === null ? <p className="pm-dim">Loading the marketplace…</p> : !catalogue.length ? (
              <p className="pm-dim">{error ? 'The marketplace could not be reached.' : q || category ? 'No plugins match.' : 'No plugins are published yet. Build one in the Plugin Maker and publish it!'}</p>
            ) : (
              <div className="mk-grid">
                {catalogue.map((item) => {
                  const have = installed.get(item.id);
                  const update = have ? updateFor(have, item) : null;
                  return (
                    <button key={item.id} type="button" className={`mk-card${open === item.id ? ' on' : ''}`} onClick={() => setOpen(item.id)}>
                      <span className="mk-icon">{item.icon ?? '🧩'}</span>
                      <span className="mk-card-text">
                        <strong>{item.name}</strong>
                        <em>{item.author}{item.publisher?.verified && <BadgeCheck size={11} className="mk-verified" aria-label="Verified publisher" />} · {item.installs} install{item.installs === 1 ? '' : 's'}{item.rating && <> · <Stars value={item.rating.average} /> {item.rating.average.toFixed(1)}</>}</em>
                        <span>{item.summary}</span>
                      </span>
                      {have && <span className={`mk-badge${update ? ' update' : ''}`}>{update ? `Update ${update}` : 'Installed'}</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </section>
          <aside className="mk-detail">
            {open ? <Detail key={`${open}:${refresh}`} id={open} installed={installed.get(open) ?? null} known={known} onOpenInMaker={onOpenInMaker} onChanged={() => setRefresh((n) => n + 1)} /> : <p className="pm-dim">Pick a plugin to see what it does and what it may do.</p>}
          </aside>
        </div>
      )}
      {view === 'installed' && <Installed plugins={plugins} catalogue={catalogue ?? []} known={known} onOpenInMaker={onOpenInMaker} onChanged={() => setRefresh((n) => n + 1)} />}
      {view === 'mine' && <Mine />}
    </div>
  );
}

function Detail({ id, installed, known, onOpenInMaker, onChanged }: { id: string; installed: Plugin | null; known: ReadonlySet<string>; onOpenInMaker: (id: string) => void; onChanged: () => void }) {
  const [data, setData] = useState<MarketListing | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  useEffect(() => {
    listing(id).then(setData, (failure) => setError(errorText(failure)));
  }, [id]);
  if (error) return <p className="pm-error">{error}</p>;
  if (!data) return <p className="pm-dim">Loading…</p>;
  const { plugin } = data;
  const update = installed ? updateFor(installed, plugin) : null;
  const local = installed && !installed.pkg;
  const install = async () => {
    if (!plugin.version) return;
    setBusy(true);
    setError('');
    try {
      const outcome = await installFromMarket(plugin.id, plugin.version, known);
      setDone(outcome.waitsForReview ? 'installed-review' : 'installed');
      onChanged();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mk-detail-body">
      <div className="mk-detail-head">
        <span className="mk-icon big">{plugin.icon ?? '🧩'}</span>
        <div>
          <h3>{plugin.name}</h3>
          <p className="pm-dim">by <PublisherName publisher={plugin.publisher} fallback={plugin.author} /> · version {plugin.version} · {plugin.installs} install{plugin.installs === 1 ? '' : 's'} · {plugin.category}</p>
          {plugin.rating && <p className="pm-dim"><Stars value={plugin.rating.average} /> {plugin.rating.average.toFixed(1)} from {plugin.rating.count} rating{plugin.rating.count === 1 ? '' : 's'}</p>}
        </div>
      </div>
      <p>{plugin.summary}</p>
      <h4><ShieldAlert size={13} /> What it may do</h4>
      <PermissionSheet permissions={plugin.permissions} />
      {plugin.background && <p className="pm-dim">It keeps running in the background once turned on.</p>}
      {error && <p className="pm-error">{error}</p>}
      {installed?.revoked && <p className="pm-error">Your copy was pulled from the marketplace: {installed.revoked.reason}</p>}
      <div className="pm-row">
        {local ? (
          <span className="pm-dim">You have your own plugin with this id, so this one cannot be installed alongside it.</span>
        ) : done ? (
          <>
            <span className="pm-dim">{done === 'installed-review' ? 'Installed. It is off until you review it.' : 'Updated. It asks for nothing new, so it stays on.'}</span>
            <button type="button" className="btn btn-primary" onClick={() => onOpenInMaker(plugin.id)}>{done === 'installed-review' ? 'Review and turn on' : 'Open'}</button>
          </>
        ) : installed && !update ? (
          <>
            <span className="pm-dim">Installed ({installed.pkg?.version}).</span>
            <button type="button" className="btn" onClick={() => onOpenInMaker(plugin.id)}>Open</button>
          </>
        ) : (
          <button type="button" className="btn btn-primary" disabled={busy || !plugin.version} onClick={() => void install()}>
            <Download size={13} /> {busy ? 'Checking the signature and installing…' : update ? `Update to ${update}` : 'Install'}
          </button>
        )}
      </div>
      <Reviews id={plugin.id} installedVersion={installed?.pkg?.version ?? null} />
      <ReportForm id={plugin.id} version={plugin.version ?? undefined} />
      <h4>Versions</h4>
      <ul className="mk-versions">
        {data.versions.map((item) => (
          <li key={item.version}>
            <strong>{item.version}</strong> {item.revoked && <span className="mk-badge danger">pulled</span>}
            <em>{item.approvedAt ? new Date(item.approvedAt * 1000).toLocaleDateString() : ''}{item.bhippi ? ` · needs Bhippi ${item.bhippi}` : ''}</em>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Installed({ plugins, catalogue, known, onOpenInMaker, onChanged }: { plugins: Plugin[]; catalogue: MarketPlugin[]; known: ReadonlySet<string>; onOpenInMaker: (id: string) => void; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const packaged = plugins.filter((plugin) => plugin.pkg);
  const update = async (plugin: Plugin, version: string) => {
    setBusy(plugin.id);
    setError('');
    try {
      await installFromMarket(plugin.id, version, known);
      onChanged();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="mk-page">
      {error && <p className="pm-error">{error}</p>}
      {!packaged.length ? <p className="pm-dim">No plugins installed from the marketplace or a package yet.</p> : (
        <table className="mk-table">
          <thead><tr><th>Plugin</th><th>Version</th><th>From</th><th>State</th><th /></tr></thead>
          <tbody>
            {packaged.map((plugin) => {
              const offered = updateFor(plugin, catalogue.find((item) => item.id === plugin.id));
              return (
                <tr key={plugin.id}>
                  <td>{pluginGlyph(plugin)} <strong>{plugin.name}</strong>{plugin.pkg?.author ? <em className="pm-dim"> by {plugin.pkg.author}</em> : null}</td>
                  <td>{plugin.pkg?.version}{offered && <span className="mk-badge update">{offered} available</span>}</td>
                  <td>{plugin.pkg?.source === 'marketplace' ? 'Marketplace' : 'Package file'}</td>
                  <td>{plugin.revoked ? <span className="mk-badge danger" title={plugin.revoked.reason}>Pulled: {plugin.revoked.reason}</span> : plugin.enabled ? 'On' : 'Off'}</td>
                  <td className="mk-actions">
                    {offered && <button type="button" className="btn btn-primary" disabled={busy === plugin.id} onClick={() => void update(plugin, offered)}><RefreshCw size={12} /> {busy === plugin.id ? 'Updating…' : 'Update'}</button>}
                    <button type="button" className="btn" onClick={() => onOpenInMaker(plugin.id)}>Open</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

function Mine() {
  const [data, setData] = useState<Awaited<ReturnType<typeof mySubmissions>> | null>(null);
  const [error, setError] = useState('');
  const [own, setOwn] = useState(0);
  const load = useCallback(() => mySubmissions().then(setData, (failure) => setError(errorText(failure))), []);
  useEffect(() => {
    void load();
  }, [load, own]);
  if (error) return <section className="mk-page"><p className="pm-error">{error}</p></section>;
  if (!data) return <section className="mk-page"><p className="pm-dim">Loading your submissions…</p></section>;
  return (
    <section className="mk-page">
      <PublisherProfile />
      <p className="pm-dim">Publish a plugin from the Plugin Maker (Details › Publish). Each version is checked automatically, then reviewed by Bhippi before it goes live.</p>
      {!data.versions.length ? <p className="pm-dim">You have not submitted anything yet.</p> : (
        <table className="mk-table">
          <thead><tr><th>Plugin</th><th>Version</th><th>Status</th><th>Reviewer's note</th><th /></tr></thead>
          <tbody>
            {data.versions.map((row) => (
              <tr key={row.id}>
                <td><strong>{data.listings.find((item) => item.id === row.plugin)?.name ?? row.plugin}</strong><em className="pm-dim"> {new Date(row.submittedAt * 1000).toLocaleDateString()}</em></td>
                <td>{row.version}</td>
                <td><span className={`mk-badge status-${row.status}`}>{STATUS[row.status]}</span></td>
                <td>{row.note ?? (row.warnings.length ? <em className="pm-dim">{row.warnings.join(' ')}</em> : '')}</td>
                <td className="mk-actions">{row.status === 'in_review' && <button type="button" className="btn" onClick={() => void withdraw(row.id).then(() => setOwn((n) => n + 1), (failure) => setError(errorText(failure)))}>Withdraw</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** Five stars, filled to the nearest half. */
function Stars({ value }: { value: number }) {
  return (
    <span className="mk-stars" aria-label={`${value.toFixed(1)} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => <Star key={n} size={11} className={value >= n - 0.25 ? 'on' : value >= n - 0.75 ? 'half' : ''} />)}
    </span>
  );
}

function PublisherName({ publisher, fallback }: { publisher: Publisher | null; fallback: string }) {
  if (!publisher) return <>{fallback}</>;
  return <>{publisher.name} <span className="mk-handle">@{publisher.handle}</span>{publisher.verified && <span className="mk-badge verified" title="Bhippi knows this publisher"><BadgeCheck size={10} /> Verified</span>}</>;
}

function Reviews({ id, installedVersion }: { id: string; installedVersion: string | null }) {
  const [data, setData] = useState<{ reviews: Review[]; mine: { stars: number; review: string } | null } | null>(null);
  const [stars, setStars] = useState(0);
  const [text, setText] = useState('');
  const [state, setState] = useState('');
  const [own, setOwn] = useState(0);
  useEffect(() => {
    reviewsOf(id).then((answer) => {
      setData(answer);
      if (answer.mine) {
        setStars(answer.mine.stars);
        setText(answer.mine.review);
      }
    }, () => setData({ reviews: [], mine: null }));
  }, [id, own]);
  const send = async () => {
    setState('sending');
    try {
      await rate(id, stars, text, installedVersion ?? undefined);
      setState('Thanks — your rating is in.');
      setOwn((n) => n + 1);
    } catch (failure) {
      setState(errorText(failure));
    }
  };
  return (
    <div className="mk-reviews">
      <h4>Ratings and reviews</h4>
      {installedVersion ? (
        <div className="mk-rate">
          <span className="mk-stars pick" role="radiogroup" aria-label="Your rating">
            {[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" role="radio" aria-checked={stars === n} aria-label={`${n} star${n === 1 ? '' : 's'}`} onClick={() => setStars(n)}><Star size={15} className={stars >= n ? 'on' : ''} /></button>)}
          </span>
          <textarea rows={2} value={text} maxLength={1000} onChange={(event) => setText(event.target.value)} placeholder={data?.mine ? 'Your review' : 'What did you think? (optional)'} />
          <div className="pm-row"><span className="pm-dim">{state === 'sending' ? '' : state}</span><span className="pm-grow" /><button type="button" className="btn" disabled={!stars || state === 'sending'} onClick={() => void send()}>{data?.mine ? 'Update my rating' : 'Rate it'}</button></div>
        </div>
      ) : <p className="pm-dim">Install it to rate it.</p>}
      {data?.reviews.filter((item) => item.review).slice(0, 8).map((item, index) => (
        <blockquote key={index} className="mk-review"><Stars value={item.stars} /> <strong>{item.by}</strong>{item.version && <em> · v{item.version}</em>}<p>{item.review}</p></blockquote>
      ))}
    </div>
  );
}

function ReportForm({ id, version }: { id: string; version?: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<(typeof REPORT_REASONS)[number]['id']>('malicious');
  const [details, setDetails] = useState('');
  const [state, setState] = useState('');
  if (!open) return <button type="button" className="btn mk-report-link" onClick={() => setOpen(true)}><Flag size={12} /> Report this plugin</button>;
  const send = async () => {
    setState('sending');
    try {
      await reportPlugin(id, reason, details, version);
      setState('Sent. Bhippi reviews every report; a harmful plugin is pulled from every app.');
    } catch (failure) {
      setState(errorText(failure));
    }
  };
  return (
    <div className="mk-report">
      <h4><Flag size={12} /> Report this plugin</h4>
      <select value={reason} onChange={(event) => setReason(event.target.value as typeof reason)}>{REPORT_REASONS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
      <textarea rows={3} value={details} maxLength={2000} onChange={(event) => setDetails(event.target.value)} placeholder="What happened? (optional, but it helps)" />
      <div className="pm-row"><span className="pm-dim">{state === 'sending' ? '' : state}</span><span className="pm-grow" /><button type="button" className="btn" onClick={() => setOpen(false)}>Close</button><button type="button" className="btn btn-primary" disabled={state === 'sending' || state.startsWith('Sent')} onClick={() => void send()}>Send report</button></div>
    </div>
  );
}

/** Your public name as an author: @handle, display name, a line about you, and the Verified badge Bhippi grants. */
function PublisherProfile() {
  const [profile, setProfile] = useState<Awaited<ReturnType<typeof myPublisher>> | null>(null);
  const [handle, setHandle] = useState('');
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [state, setState] = useState('');
  useEffect(() => {
    myPublisher().then((answer) => {
      setProfile(answer);
      setHandle(answer.publisher?.handle ?? '');
      setName(answer.publisher?.name ?? answer.suggestedName);
      setBio(answer.publisher?.bio ?? '');
    }, (failure) => setState(errorText(failure)));
  }, []);
  const save = async () => {
    setState('saving');
    try {
      const answer = await savePublisher(handle, name, bio);
      setProfile(answer);
      setState(answer.publisher?.verified ? 'Saved.' : profile?.publisher?.verified ? 'Saved. Changing your handle or name removes the Verified badge until Bhippi checks again.' : 'Saved.');
    } catch (failure) {
      setState(errorText(failure));
    }
  };
  const current = profile?.publisher;
  return (
    <div className="mk-profile">
      <h4>Your publisher profile {current?.verified && <span className="mk-badge verified"><BadgeCheck size={10} /> Verified</span>}</h4>
      <p className="pm-dim">How your plugins are credited. Verified publishers (granted by Bhippi) may ship sensitive tools, and their updates that ask for nothing new go live without waiting.</p>
      <div className="pm-row">
        <label>Handle<span className="mk-handle-input">@<input value={handle} onChange={(event) => setHandle(event.target.value.toLowerCase())} placeholder="your-name" maxLength={32} /></span></label>
        <label className="pm-grow">Display name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} /></label>
      </div>
      <label>About you<input value={bio} onChange={(event) => setBio(event.target.value)} maxLength={500} placeholder="One line" /></label>
      <div className="pm-row"><span className="pm-dim">{state === 'saving' ? '' : state}</span><span className="pm-grow" /><button type="button" className="btn btn-primary" disabled={state === 'saving' || !handle || !name.trim()} onClick={() => void save()}>{current ? 'Save profile' : 'Create profile'}</button></div>
    </div>
  );
}
