// The plugin marketplace inside Bhippi (market.ts), shaped like an app store: a window over the
// editor with a sidebar (Discover, categories, Installed, My submissions), rounded app icons,
// Get / Open / Update buttons, and a detail page with ratings, "What it may do", reviews and
// versions. Every download is signature-checked in Rust and lock-checked before it installs, and
// it arrives off until reviewed. While bhippi.com has no marketplace yet, a clearly marked preview
// shelf of sample plugins stands in (marketSamples.ts) — they can't be installed.
//
// Getting, rating and reviewing are tied to the person's Google account (the same sign-in as
// Settings › Account): one install per account, one rating per account, and every review shows
// its writer's name and photo. With no account connected, the store says so and offers the
// Google button right there.

import {
  AudioWaveform, BadgeCheck, ChevronLeft, Compass, Download, FileText, Flag, Gauge, Laugh, Layers, ListVideo, Music, Package, Pencil, Trash2,
  Palette, Scissors, Search, Share2, ShieldCheck, Sparkles, SquareKanban, Star, Subtitles, Type, Wand2, X, type LucideIcon,
} from 'lucide-react';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, errorText } from '../lib/ipc';
import { GoogleMark, SignIn } from '../license/LicenseGate';
import { useLicense } from '../license/licenseStore';
import {
  browse, CATEGORIES, installFromMarket, isClosed, isSignedOut, listing, myPublisher, mySubmissions, publish, rate, REPORT_REASONS, reportPlugin, reviewsOf, savePublisher, updateFor, withdraw,
  type Category, type MarketListing, type MarketPlugin, type MyAccount, type Publisher, type PublishStep, type Reviews as ReviewsAnswer, type Submission,
} from './market';
import { pluginChecker } from './testRunner';
import { isSample, SAMPLE_PLUGINS, type SamplePlugin } from './marketSamples';
import { isSensitiveTool } from './rules';
import { loadPlugins, removePlugin, usePlugins } from './store';
import type { Plugin, PluginPermissions } from './types';
import { isPluginService, PLUGIN_SERVICES } from './capabilities';
import '../styles/market.css';

type View = { kind: 'discover' } | { kind: 'category'; id: string } | { kind: 'search' } | { kind: 'installed' } | { kind: 'mine' };

const ICONS: Record<string, LucideIcon> = { ListVideo, Subtitles, AudioWaveform, Palette, Scissors, Type, Share2, Laugh, FileText, Gauge, ShieldCheck, SquareKanban };
const CATEGORY: Record<string, { label: string; icon: LucideIcon; hue: number }> = {
  editing: { label: 'Editing', icon: Scissors, hue: 140 },
  automation: { label: 'Automation', icon: Wand2, hue: 225 },
  integration: { label: 'Integrations', icon: Share2, hue: 190 },
  motion: { label: 'Motion', icon: Sparkles, hue: 45 },
  audio: { label: 'Audio', icon: Music, hue: 328 },
  captions: { label: 'Captions', icon: Subtitles, hue: 200 },
  utility: { label: 'Utilities', icon: Layers, hue: 262 },
  fun: { label: 'Fun', icon: Laugh, hue: 290 },
};
const STATUS: Record<Submission['status'], string> = { in_review: 'In review', approved: 'Live', rejected: 'Rejected', revoked: 'Pulled', withdrawn: 'Withdrawn' };

const hueOf = (id: string) => [...id].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 360, 7);
/** Installs the way an app store shows them: exact below a thousand, then rounded down with a plus (12K+, 1.5M+). */
const installsLabel = (n: number) => {
  if (n < 1000) return n.toLocaleString();
  const [unit, size] = n >= 1e6 ? (['M', 1e6] as const) : (['K', 1e3] as const);
  const value = n / size;
  return `${value >= 10 ? Math.floor(value) : Math.floor(value * 10) / 10}${unit}+`;
};
const dateOf = (seconds: number | undefined) => (seconds ? new Date(seconds * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : '');
const SIGN_IN_WHY = 'Connect your Google account to get, rate and review plugins. Your installs, ratings and reviews are tied to it.';

/** The Google account behind the store: who installs, rates and reviews. `ask` opens the Connect sheet. */
type Account = { signedIn: boolean; name: string; picture: string | null; ask: (why?: string) => void };
const AccountContext = createContext<Account>({ signedIn: false, name: '', picture: null, ask: () => undefined });

/** A rounded-square app icon: a gradient tile with the plugin's glyph (a sample's icon, or a published plugin's emoji). */
export function AppIcon({ plugin, size = 56 }: { plugin: MarketPlugin; size?: number }) {
  const hue = isSample(plugin) ? plugin.hue : hueOf(plugin.id);
  const Glyph = isSample(plugin) ? ICONS[plugin.icon] ?? Package : null;
  return (
    <span className="mk-appicon" style={{ width: size, height: size, borderRadius: size * 0.225, background: `linear-gradient(145deg, hsl(${hue} 85% 64%), hsl(${(hue + 38) % 360} 72% 44%))` }} aria-hidden="true">
      {plugin.logo && /^(data:image\/(png|jpeg);base64,|https:\/\/)/.test(plugin.logo) ? <img src={plugin.logo} alt="" draggable={false} style={{ width: '100%', height: '100%', borderRadius: 'inherit', objectFit: 'cover' }} />
        : Glyph ? <Glyph size={size * 0.5} strokeWidth={2.2} /> : <span style={{ fontSize: size * 0.5 }}>{plugin.icon ?? '🧩'}</span>}
    </span>
  );
}

/** Five stars, filled to the nearest half. */
function Stars({ value, size = 11 }: { value: number; size?: number }) {
  return (
    <span className="mk-stars" aria-label={`${value.toFixed(1)} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => <Star key={n} size={size} className={value >= n - 0.25 ? 'on' : value >= n - 0.75 ? 'half' : ''} />)}
    </span>
  );
}

function PublisherName({ publisher, fallback }: { publisher: Publisher | null; fallback: string }) {
  if (!publisher) return <>{fallback}</>;
  return (
    <span className="mk-publisher">
      <PersonPhoto picture={publisher.picture ?? null} name={publisher.name} size={18} />
      {publisher.name}{publisher.verified && <BadgeCheck size={12} className="mk-verified" aria-label="Verified publisher" />}
      <span className="mk-dim">@{publisher.handle}</span>
    </span>
  );
}

/** What a plugin may do, in plain words, sensitive tools first and flagged. */
export function PermissionSheet({ permissions }: { permissions: PluginPermissions | null }) {
  if (!permissions) return <p className="mk-dim">Its permissions are not listed.</p>;
  const sensitive = permissions.tools.filter((tool) => tool !== '*' && isSensitiveTool(tool));
  const edits = permissions.tools.filter((tool) => tool !== '*' && !isSensitiveTool(tool));
  return (
    <ul className="mk-perms">
      <li>Reads your project (every plugin may)</li>
      {sensitive.map((tool) => <li key={tool} className="warn">Uses <code>{tool}</code>, a sensitive tool</li>)}
      {permissions.tools.includes('*') && <li>May use every editing tool on your project</li>}
      {!!edits.length && <li>Edits your project with {edits.map((tool) => <code key={tool}>{tool}</code>)}</li>}
      {permissions.network.map((host) => <li key={host}>Connects to <code>{host}</code></li>)}
      {permissions.chat && <li>Suggests messages for Bhippi AI (each needs your click)</li>}
      {(permissions.services ?? []).filter(isPluginService).map((name) => <li key={name}>{PLUGIN_SERVICES[name].risk}</li>)}
      {!permissions.tools.length && !permissions.network.length && !permissions.chat && !permissions.services?.length && <li className="ok">Nothing else: it only reads</li>}
    </ul>
  );
}

// ─────────────────────────────── the window ───────────────────────────────

export function PluginMarket({ onClose, onOpenInMaker, onOpenCharacters, known }: {
  onClose: () => void;
  onOpenInMaker: (id: string) => void;
  /** Opens Bhippi's built-in Characters studio, which the Discover banner features. */
  onOpenCharacters: () => void;
  known: ReadonlySet<string>;
}) {
  const { plugins } = usePlugins();
  const [view, setView] = useState<View>({ kind: 'discover' });
  const [detail, setDetail] = useState<MarketPlugin | null>(null);
  const [q, setQ] = useState('');
  const [catalogue, setCatalogue] = useState<MarketPlugin[] | null>(null);
  const [closed, setClosed] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const { status } = useLicense();
  const user = status?.account?.user ?? null;
  const [asking, setAsking] = useState<string | null>(null);
  // Connected: the sheet has done its job.
  useEffect(() => {
    if (user) setAsking(null);
  }, [user]);
  const account = useMemo<Account>(
    () => ({ signedIn: !!user, name: user?.name || user?.email.split('@')[0] || '', picture: user?.picture ?? null, ask: (why) => setAsking(why ?? SIGN_IN_WHY) }),
    [user],
  );

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (asking) setAsking(null);
      else if (detail) setDetail(null);
      else onClose();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose, detail, asking]);

  useEffect(() => {
    let live = true;
    browse('', '').then(
      (data) => {
        if (!live) return;
        setCatalogue(data.plugins);
        setClosed(false);
      },
      (failure) => {
        if (!live) return;
        setCatalogue([]);
        // Not open yet is the store's normal state before launch: show the preview shelf, no alarm.
        if (isClosed(failure)) setClosed(true);
        else setError(errorText(failure));
      },
    );
    return () => {
      live = false;
    };
  }, [refresh]);

  const installed = useMemo(() => new Map(plugins.map((plugin) => [plugin.id, plugin])), [plugins]);
  // The shelf: real plugins, or the preview samples while there are none.
  const preview = catalogue !== null && catalogue.length === 0;
  const shelf: MarketPlugin[] = preview ? SAMPLE_PLUGINS : catalogue ?? [];
  const found = useMemo(() => {
    const words = q.trim().toLowerCase();
    return words ? shelf.filter((item) => `${item.name} ${item.summary} ${item.category} ${item.author}`.toLowerCase().includes(words)) : shelf;
  }, [q, shelf]);

  const go = (next: View) => {
    setDetail(null);
    setView(next);
  };
  const open = (item: MarketPlugin) => setDetail(item);
  const changed = () => setRefresh((n) => n + 1);
  const title = detail ? '' : view.kind === 'discover' ? 'Discover' : view.kind === 'category' ? CATEGORY[view.id]?.label ?? view.id : view.kind === 'search' ? `Results for “${q}”` : view.kind === 'installed' ? 'Installed' : 'My plugins';

  return (
    <AccountContext.Provider value={account}>
    <div className="mk-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="mk-window" role="dialog" aria-modal="true" aria-label="Plugin store">
        <aside className="mk-side">
          <label className="mk-search">
            <Search size={13} />
            <input value={q} onChange={(event) => { setQ(event.target.value); if (event.target.value.trim()) go({ kind: 'search' }); }} placeholder="Search" aria-label="Search plugins" />
          </label>
          <nav>
            <SideItem icon={Compass} label="Discover" on={!detail && view.kind === 'discover'} onClick={() => go({ kind: 'discover' })} />
            <p className="mk-side-head">Categories</p>
            {CATEGORIES.map((id) => <SideItem key={id} icon={CATEGORY[id].icon} label={CATEGORY[id].label} on={!detail && view.kind === 'category' && view.id === id} onClick={() => go({ kind: 'category', id })} />)}
            <p className="mk-side-head">Yours</p>
            <SideItem icon={Download} label="Installed" on={!detail && view.kind === 'installed'} onClick={() => go({ kind: 'installed' })} />
            <SideItem icon={Package} label="My plugins" on={!detail && view.kind === 'mine'} onClick={() => go({ kind: 'mine' })} />
          </nav>
        </aside>

        <main className="mk-main">
          <header className="mk-top">
            {detail ? <button type="button" className="mk-back" onClick={() => setDetail(null)}><ChevronLeft size={16} /> Back</button> : <h2>{title}</h2>}
            <button type="button" className="mk-close" onClick={onClose} aria-label="Close the store (Esc)"><X size={15} /></button>
          </header>
          <div className="mk-scroll">
            {closed && !detail && (view.kind === 'discover' || view.kind === 'category' || view.kind === 'search') && (
              <p className="mk-preview-note"><Sparkles size={13} /> The plugin store opens soon. These are previews of the kind of plugins coming — build your own in the Plugin Maker and publish it here.</p>
            )}
            {error && <p className="mk-error">{error}<button type="button" onClick={() => { setError(''); changed(); }}>Try again</button></p>}
            {!user && view.kind !== 'mine' && (
              <div className="mk-connect-bar">
                <GoogleMark />
                <span><strong>Connect your Google account</strong> to get plugins, rate them and write reviews.</span>
                <button type="button" className="mk-get primary" onClick={() => account.ask()}>Connect</button>
              </div>
            )}

            {detail ? (
              <Detail item={detail} installed={installed.get(detail.id) ?? null} known={known} onOpenInMaker={onOpenInMaker} onChanged={changed} />
            ) : catalogue === null && (view.kind === 'discover' || view.kind === 'category' || view.kind === 'search') ? (
              <div className="mk-loading" />
            ) : view.kind === 'discover' ? (
              <Discover shelf={shelf} installed={installed} known={known} onOpen={open} onOpenCharacters={onOpenCharacters} onCategory={(id) => go({ kind: 'category', id })} onOpenInMaker={onOpenInMaker} onChanged={changed} />
            ) : view.kind === 'category' ? (
              <Shelf items={shelf.filter((item) => item.category === view.id)} empty="Nothing in this category yet." installed={installed} known={known} onOpen={open} onOpenInMaker={onOpenInMaker} onChanged={changed} />
            ) : view.kind === 'search' ? (
              <Shelf items={found} empty="No plugins match." installed={installed} known={known} onOpen={open} onOpenInMaker={onOpenInMaker} onChanged={changed} />
            ) : view.kind === 'installed' ? (
              <Installed plugins={plugins} catalogue={catalogue ?? []} known={known} onOpenInMaker={onOpenInMaker} onChanged={changed} />
            ) : (
              <MyPlugins known={known} onOpenInMaker={onOpenInMaker} />
            )}
          </div>
        </main>
        {asking && (
          <div className="mk-sheet-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setAsking(null)}>
            <div className="mk-sheet" role="dialog" aria-modal="true" aria-label="Connect your Google account">
              <button type="button" className="mk-close mk-sheet-close" onClick={() => setAsking(null)} aria-label="Not now"><X size={15} /></button>
              <h3>Connect your Google account</h3>
              <p className="mk-dim">{asking}</p>
              <SignIn compact />
              <p className="mk-dim mk-sheet-fine">Reviews are public and show your first name and Google photo. Your email is never shown.</p>
            </div>
          </div>
        )}
      </div>
    </div>
    </AccountContext.Provider>
  );
}

function SideItem({ icon: Icon, label, on, onClick }: { icon: LucideIcon; label: string; on: boolean; onClick: () => void }) {
  return <button type="button" className={`mk-side-item${on ? ' on' : ''}`} onClick={onClick}><Icon size={15} /> {label}</button>;
}

// ─────────────────────────────── shelves ───────────────────────────────

type ShelfProps = { installed: Map<string, Plugin>; known: ReadonlySet<string>; onOpen: (item: MarketPlugin) => void; onOpenInMaker: (id: string) => void; onChanged: () => void };

function Discover({ shelf, onCategory, onOpenCharacters, ...props }: ShelfProps & { shelf: MarketPlugin[]; onCategory: (id: string) => void; onOpenCharacters: () => void }) {
  const byInstalls = [...shelf].sort((a, b) => b.installs - a.installs);
  const byRating = [...shelf].filter((item) => item.rating).sort((a, b) => (b.rating?.average ?? 0) - (a.rating?.average ?? 0));
  const fresh = [...shelf].sort((a, b) => b.updatedAt - a.updatedAt);
  return (
    <>
      {/* The featured banner is Bhippi's own Characters plugin: the cast banner above its app icon, name and Open button. */}
      <button type="button" className="mk-hero mk-hero-art" onClick={onOpenCharacters} aria-label="Open Characters: 2D and 3D characters for your videos">
        <img className="mk-hero-banner" src="characters/characters-market-banner.webp" alt="" width={1800} height={600} draggable={false} />
        <span className="mk-hero-bar">
          <img className="mk-hero-logo" src="characters/character-plugin-icon.png" alt="" width={52} height={52} draggable={false} />
          <span className="mk-hero-text">
            <small>Built in</small>
            <strong>Characters</strong>
            <em>Make 2D and 3D characters for your videos.</em>
          </span>
          <span className="mk-hero-open">Open</span>
        </span>
      </button>
      {!shelf.length && <p className="mk-dim">No other plugins yet.</p>}
      <Section title="Top plugins">
        <div className="mk-rows">{byInstalls.slice(0, 6).map((item, index) => <AppRow key={item.id} item={item} rank={index + 1} {...props} />)}</div>
      </Section>
      {byRating.length > 2 && (
        <Section title="Loved by editors">
          <div className="mk-cards">{byRating.slice(0, 4).map((item) => <AppCard key={item.id} item={item} onOpen={props.onOpen} />)}</div>
        </Section>
      )}
      <Section title="Browse by category">
        <div className="mk-cats">
          {CATEGORIES.map((id) => {
            const { label, icon: Icon, hue } = CATEGORY[id];
            return <button key={id} type="button" className="mk-cat" style={{ background: `linear-gradient(145deg, hsl(${hue} 70% 48%), hsl(${(hue + 40) % 360} 65% 34%))` }} onClick={() => onCategory(id)}><Icon size={18} /> {label}</button>;
          })}
        </div>
      </Section>
      <Section title="New and updated">
        <div className="mk-rows">{fresh.slice(0, 6).map((item) => <AppRow key={item.id} item={item} {...props} />)}</div>
      </Section>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="mk-section"><h3>{title}</h3>{children}</section>;
}

function Shelf({ items, empty, ...props }: ShelfProps & { items: MarketPlugin[]; empty: string }) {
  if (!items.length) return <p className="mk-dim">{empty}</p>;
  return <div className="mk-rows">{items.map((item) => <AppRow key={item.id} item={item} {...props} />)}</div>;
}

/** One line of a shelf: icon, name, what it is, rating, and its Get / Open / Update button. */
function AppRow({ item, rank, ...props }: ShelfProps & { item: MarketPlugin; rank?: number }) {
  return (
    <div className="mk-row" role="button" tabIndex={0} onClick={() => props.onOpen(item)} onKeyDown={(event) => event.key === 'Enter' && props.onOpen(item)}>
      {rank !== undefined && <span className="mk-rank">{rank}</span>}
      <AppIcon plugin={item} size={48} />
      <span className="mk-row-text">
        <strong>{item.name}</strong>
        <em>{item.summary}</em>
        <small>{CATEGORY[item.category]?.label ?? item.category}{item.rating && <> · {item.rating.average.toFixed(1)} <Star size={9} className="mk-star-on" /></>}{item.installs > 0 && <> · {installsLabel(item.installs)} installs</>}</small>
      </span>
      <span onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
        <GetButton item={item} installed={props.installed.get(item.id) ?? null} known={props.known} onOpenInMaker={props.onOpenInMaker} onChanged={props.onChanged} />
      </span>
    </div>
  );
}

/** A tall card: icon, name and rating, for a highlighted shelf. */
function AppCard({ item, onOpen }: { item: MarketPlugin; onOpen: (item: MarketPlugin) => void }) {
  return (
    <button type="button" className="mk-card" onClick={() => onOpen(item)}>
      <AppIcon plugin={item} size={64} />
      <strong>{item.name}</strong>
      <em>{CATEGORY[item.category]?.label ?? item.category}</em>
      {item.rating && <small><Stars value={item.rating.average} size={10} /> {item.rating.average.toFixed(1)}</small>}
    </button>
  );
}

/** Get / Open / Update / Soon: installs through the verified path and says what happened. */
function GetButton({ item, installed, known, onOpenInMaker, onChanged, big }: { item: MarketPlugin; installed: Plugin | null; known: ReadonlySet<string>; onOpenInMaker: (id: string) => void; onChanged: () => void; big?: boolean }) {
  const account = useContext(AccountContext);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const className = `mk-get${big ? ' big' : ''}`;
  if (isSample(item)) return <button type="button" className={`${className} soon`} disabled title="A preview: not available yet">Soon</button>;
  const update = installed ? updateFor(installed, item) : null;
  if (installed && !installed.pkg) return <button type="button" className={className} disabled title="You have your own plugin with this id">Yours</button>;
  if (installed && !update) return <button type="button" className={className} onClick={() => onOpenInMaker(item.id)}>{installed.enabled ? 'Open' : 'Review'}</button>;
  const get = async () => {
    if (!item.version) return;
    if (!account.signedIn) {
      account.ask(`Connect your Google account to get “${item.name}”. Plugins are tied to your account, so your installs, ratings and reviews follow you.`);
      return;
    }
    setBusy(true);
    setProblem('');
    try {
      await installFromMarket(item.id, item.version, known);
      onChanged();
    } catch (failure) {
      if (isSignedOut(failure)) account.ask();
      else setProblem(errorText(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="mk-get-wrap">
      <button type="button" className={`${className} primary`} disabled={busy || !item.version} onClick={() => void get()} title={problem || undefined}>{busy ? '…' : update ? 'Update' : 'Get'}</button>
      {problem && big && <span className="mk-get-problem">{problem}</span>}
    </span>
  );
}

// ─────────────────────────────── the detail page ───────────────────────────────

function Detail({ item, installed, known, onOpenInMaker, onChanged }: { item: MarketPlugin; installed: Plugin | null; known: ReadonlySet<string>; onOpenInMaker: (id: string) => void; onChanged: () => void }) {
  const [data, setData] = useState<MarketListing | null>(null);
  const [rated, setRated] = useState(0);
  useEffect(() => {
    if (!isSample(item)) listing(item.id).then(setData, () => setData(null));
  }, [item, rated]);
  const plugin = data?.plugin ?? item;
  const sample: SamplePlugin | null = isSample(item) ? item : null;
  return (
    <article className="mk-detail">
      <header className="mk-detail-head">
        <AppIcon plugin={item} size={104} />
        <div className="mk-detail-title">
          <h2>{plugin.name}</h2>
          <p>{sample?.tagline ?? plugin.summary}</p>
          <p className="mk-dim"><PublisherName publisher={plugin.publisher} fallback={plugin.author} /></p>
          <div className="mk-detail-actions">
            <GetButton big item={plugin} installed={installed} known={known} onOpenInMaker={onOpenInMaker} onChanged={onChanged} />
            {installed?.revoked && <span className="mk-bad">Pulled from the store: {installed.revoked.reason}</span>}
            {installed && !installed.enabled && !installed.revoked && installed.pkg && <span className="mk-dim">Installed and off until you review it.</span>}
          </div>
        </div>
      </header>
      {/* Like a phone app store: value on top, what it is underneath. */}
      <dl className="mk-stats">
        <div>
          <dd>{plugin.rating ? <>{plugin.rating.average.toFixed(1)} <Star size={14} className="mk-star-on" /></> : '—'}</dd>
          <dt>{plugin.rating ? `${plugin.rating.count.toLocaleString()} review${plugin.rating.count === 1 ? '' : 's'}` : 'No ratings yet'}</dt>
        </div>
        <div title={`${plugin.installs.toLocaleString()} ${plugin.installs === 1 ? 'person has' : 'people have'} installed it`}>
          <dd>{installsLabel(plugin.installs)}</dd>
          <dt>Installs</dt>
        </div>
        <div>
          <dd className="mk-stat-icon">{(() => { const Icon = CATEGORY[plugin.category]?.icon ?? Package; return <Icon size={18} />; })()}</dd>
          <dt>{CATEGORY[plugin.category]?.label ?? plugin.category}</dt>
        </div>
        <div>
          <dd>{plugin.size ? `${Math.max(1, Math.round(plugin.size / 1024))} KB` : '—'}</dd>
          <dt>Size</dt>
        </div>
      </dl>
      {sample && <p className="mk-preview-note"><Sparkles size={13} /> A preview of what’s coming to the store. It can’t be installed yet.</p>}
      <section className="mk-section">
        <h3>About</h3>
        <p>{sample?.about ?? plugin.summary}</p>
        {plugin.background && <p className="mk-dim">Keeps running in the background once turned on.</p>}
      </section>
      <section className="mk-section mk-privacy">
        <h3><ShieldCheck size={15} /> What it may do</h3>
        <PermissionSheet permissions={plugin.permissions} />
        {!sample && <p className="mk-dim">Reviewed by Bhippi and signed. It installs turned off until you read this.</p>}
      </section>
      <Reviews plugin={plugin} sample={!!sample} installed={installed} onRated={() => setRated((n) => n + 1)} />
      {!!data?.versions.length && (
        <section className="mk-section">
          <h3>Version history</h3>
          <ul className="mk-versions">
            {data.versions.map((version) => (
              <li key={version.version}><strong>{version.version}</strong>{version.revoked && <span className="mk-bad"> pulled</span>}<em>{version.approvedAt ? new Date(version.approvedAt * 1000).toLocaleDateString() : ''}{version.bhippi ? ` · needs Bhippi ${version.bhippi}` : ''}</em></li>
            ))}
          </ul>
        </section>
      )}
      {!sample && <ReportForm id={plugin.id} version={plugin.version ?? undefined} />}
    </article>
  );
}

/**
 * A preview sample's 5-to-1 split, shaped to its average: most at 5 and 4, a thin tail below. Real
 * plugins use bhippi.com's counts.
 */
function sampleBreakdown({ average, count }: { average: number; count: number }): number[] {
  const five = Math.min(0.94, Math.max(0, average - 3.89));
  return [five, 0.94 - five, 0.03, 0.01, 0.02].map((share) => Math.round(share * count));
}

/**
 * Ratings and reviews, laid out like a phone app store: the average with its 5-to-1 bars, "Rate
 * this plugin" (tap a star to start a review), your own review, then everyone's, each with the
 * writer's Google name and photo. Rating needs a connected Google account and the plugin installed.
 */
function Reviews({ plugin, sample, installed, onRated }: { plugin: MarketPlugin; sample: boolean; installed: Plugin | null; onRated: () => void }) {
  const account = useContext(AccountContext);
  const [data, setData] = useState<ReviewsAnswer | null>(null);
  const [own, setOwn] = useState(0);
  const [writing, setWriting] = useState<number | null>(null);
  const [all, setAll] = useState(false);
  useEffect(() => {
    if (sample) return;
    let live = true;
    reviewsOf(plugin.id).then((answer) => live && setData(answer), () => live && setData({ reviews: [], mine: null }));
    return () => {
      live = false;
    };
  }, [plugin.id, sample, own, account.signedIn]);

  const rating = plugin.rating;
  const breakdown = data?.breakdown
    ?? (data ? [5, 4, 3, 2, 1].map((stars) => data.reviews.filter((item) => item.stars === stars).length) : sample && rating ? sampleBreakdown(rating) : [0, 0, 0, 0, 0]);
  const most = Math.max(1, ...breakdown);
  const written = data?.reviews.filter((item) => item.review.trim()) ?? [];
  const shown = all ? written : written.slice(0, 3);
  const mine = data?.mine ?? null;
  const yours = !!installed && !installed.pkg;

  const rateBlock = (() => {
    if (sample) return <p className="mk-dim">Ratings and reviews open when this plugin is in the store.</p>;
    if (writing !== null) {
      return <ReviewComposer id={plugin.id} version={installed?.pkg?.version} initialStars={writing} initialText={mine?.review ?? ''} editing={!!mine}
        onCancel={() => setWriting(null)} onSent={() => { setWriting(null); setOwn((n) => n + 1); onRated(); }} />;
    }
    if (!account.signedIn) {
      return (
        <div className="mk-rate-card">
          <strong>Rate this plugin</strong>
          <span className="mk-dim">Connect your Google account to rate it and write a review. Reviews show your name and photo.</span>
          <StarPicker value={0} onPick={() => account.ask('Connect your Google account to rate and review plugins. Your review shows your first name and Google photo.')} />
          <button type="button" className="mk-connect" onClick={() => account.ask()}><GoogleMark /> Connect with Google</button>
        </div>
      );
    }
    if (yours) return <p className="mk-dim">This is your plugin, so you can’t rate it. Other people’s reviews show here.</p>;
    if (mine) {
      return (
        <div className="mk-review mk-review-mine">
          <span className="mk-review-label">Your review</span>
          <ReviewHead by={account.name || 'You'} picture={account.picture} stars={mine.stars} at={mine.at} />
          {mine.review ? <p>{mine.review}</p> : <p className="mk-dim">You rated it without a review.</p>}
          <button type="button" className="mk-link mk-inline" onClick={() => setWriting(mine.stars)}><Pencil size={12} /> Edit your review</button>
        </div>
      );
    }
    if (!installed) return <p className="mk-dim">Install it to rate it and write a review.</p>;
    return (
      <div className="mk-rate-card">
        <strong>Rate this plugin</strong>
        <span className="mk-dim">Tell others what you think</span>
        <StarPicker value={0} onPick={(stars) => setWriting(stars)} />
        <button type="button" className="mk-link mk-inline" onClick={() => setWriting(0)}>Write a review</button>
      </div>
    );
  })();

  return (
    <section className="mk-section mk-ratings">
      <h3>Ratings and reviews</h3>
      <div className="mk-rating-summary">
        <div className="mk-rating-big">
          <strong>{rating ? rating.average.toFixed(1) : '—'}</strong>
          <Stars value={rating?.average ?? 0} size={12} />
          <span className="mk-dim">{rating ? `${rating.count.toLocaleString()} review${rating.count === 1 ? '' : 's'}` : 'No ratings yet'}</span>
        </div>
        <div className="mk-bars" aria-label="How people rated it">
          {breakdown.map((n, index) => (
            <div key={index} className="mk-bar" title={`${5 - index} stars: ${n.toLocaleString()}`}>
              <span>{5 - index}</span>
              <i><b style={{ width: `${(n / most) * 100}%` }} /></i>
            </div>
          ))}
        </div>
      </div>
      {rateBlock}
      {!!shown.length && (
        <div className="mk-review-list">
          {shown.map((item, index) => (
            <article key={`${item.by}-${item.at}-${index}`} className="mk-review">
              <ReviewHead by={item.by} picture={item.picture ?? null} stars={item.stars} at={item.at} handle={item.handle} />
              <p>{item.review}</p>
              {item.version && <em>For version {item.version}</em>}
            </article>
          ))}
        </div>
      )}
      {written.length > 3 && (
        <button type="button" className="mk-link mk-inline" onClick={() => setAll((value) => !value)}>{all ? 'Show fewer reviews' : `See all ${written.length} reviews`}</button>
      )}
      {!sample && data && !written.length && !mine && <p className="mk-dim">No written reviews yet.</p>}
    </section>
  );
}

/** The writer's Google photo and name, their stars and the date. */
function ReviewHead({ by, picture, stars, at, handle }: { by: string; picture: string | null; stars: number; at?: number; handle?: string | null }) {
  return (
    <div className="mk-review-head">
      <PersonPhoto picture={picture} name={by} size={32} />
      <span className="mk-review-who">
        <strong>{by}{handle && <span className="mk-dim"> @{handle}</span>}</strong>
        <span><Stars value={stars} size={10} /> <span className="mk-dim">{dateOf(at)}</span></span>
      </span>
    </div>
  );
}

/** Five big tap-to-rate stars. */
function StarPicker({ value, onPick }: { value: number; onPick: (stars: number) => void }) {
  const [hover, setHover] = useState(0);
  const lit = hover || value;
  return (
    <span className="mk-stars pick" role="radiogroup" aria-label="Your rating" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} star${n === 1 ? '' : 's'}`} onMouseEnter={() => setHover(n)} onClick={() => onPick(n)}>
          <Star size={26} className={lit >= n ? 'on' : ''} />
        </button>
      ))}
    </span>
  );
}

const STAR_WORDS = ['', 'Hated it', 'Disliked it', 'It’s OK', 'Liked it', 'Loved it'];

/** Writing (or editing) your review: stars, text, and Post — sent as your Google account. */
function ReviewComposer({ id, version, initialStars, initialText, editing, onCancel, onSent }: { id: string; version?: string; initialStars: number; initialText: string; editing: boolean; onCancel: () => void; onSent: () => void }) {
  const account = useContext(AccountContext);
  const [stars, setStars] = useState(initialStars);
  const [text, setText] = useState(initialText);
  const [state, setState] = useState('');
  const send = async () => {
    setState('sending');
    try {
      await rate(id, stars, text, version);
      onSent();
    } catch (failure) {
      if (isSignedOut(failure)) {
        setState('');
        account.ask();
      } else setState(errorText(failure));
    }
  };
  return (
    <div className="mk-composer">
      <div className="mk-review-head">
        <PersonPhoto picture={account.picture} name={account.name || 'You'} size={32} />
        <span className="mk-review-who">
          <strong>{account.name || 'You'}</strong>
          <span className="mk-dim">Reviews are public and show your first name and Google photo.</span>
        </span>
      </div>
      <div className="mk-composer-stars"><StarPicker value={stars} onPick={setStars} /><span className="mk-dim">{STAR_WORDS[stars]}</span></div>
      <textarea rows={4} value={text} maxLength={1000} autoFocus onChange={(event) => setText(event.target.value)} placeholder="Describe your experience (optional)" />
      <div className="mk-line">
        <span className="mk-dim">{state === 'sending' ? '' : state || `${text.length}/1000`}</span>
        <button type="button" className="mk-link mk-inline" onClick={onCancel}>Cancel</button>
        <button type="button" className="mk-get primary" disabled={!stars || state === 'sending'} onClick={() => void send()}>{state === 'sending' ? '…' : editing ? 'Update' : 'Post'}</button>
      </div>
    </div>
  );
}

function ReportForm({ id, version }: { id: string; version?: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<(typeof REPORT_REASONS)[number]['id']>('malicious');
  const [details, setDetails] = useState('');
  const [state, setState] = useState('');
  if (!open) return <button type="button" className="mk-link" onClick={() => setOpen(true)}><Flag size={12} /> Report a problem with this plugin</button>;
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
    <section className="mk-section mk-form">
      <h3><Flag size={14} /> Report a problem</h3>
      <select value={reason} onChange={(event) => setReason(event.target.value as typeof reason)}>{REPORT_REASONS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
      <textarea rows={3} value={details} maxLength={2000} onChange={(event) => setDetails(event.target.value)} placeholder="What happened? (optional, but it helps)" />
      <div className="mk-line"><span className="mk-dim">{state === 'sending' ? '' : state}</span><button type="button" className="mk-link" onClick={() => setOpen(false)}>Cancel</button><button type="button" className="mk-get primary" disabled={state === 'sending' || state.startsWith('Sent')} onClick={() => void send()}>Send</button></div>
    </section>
  );
}

// ─────────────────────────────── yours ───────────────────────────────

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
  if (!packaged.length) return <p className="mk-dim">Nothing installed from the store yet. Plugins you get here show up in this list, with their updates.</p>;
  return (
    <>
      {error && <p className="mk-error">{error}</p>}
      <div className="mk-rows">
        {packaged.map((plugin) => {
          const market = catalogue.find((item) => item.id === plugin.id);
          const offered = updateFor(plugin, market);
          const asMarket: MarketPlugin = market ?? { id: plugin.id, name: plugin.name, summary: plugin.description, icon: plugin.icon ?? null, category: 'utility', author: plugin.pkg?.author ?? '', version: plugin.pkg?.version ?? null, bhippi: null, size: null, updatedAt: 0, installs: 0, permissions: plugin.permissions, background: plugin.background, publisher: null, rating: null };
          return (
            <div key={plugin.id} className="mk-row">
              <AppIcon plugin={asMarket} size={48} />
              <span className="mk-row-text">
                <strong>{plugin.name}</strong>
                <em>Version {plugin.pkg?.version}{plugin.pkg?.author ? ` · ${plugin.pkg.author}` : ''} · {plugin.pkg?.source === 'marketplace' ? 'from the store' : 'from a package file'}</em>
                <small>{plugin.revoked ? <span className="mk-bad">Pulled: {plugin.revoked.reason}</span> : plugin.enabled ? 'On' : 'Off'}{offered && <> · <strong>{offered} available</strong></>}</small>
              </span>
              <RemoveButton label="Uninstall" what={`Uninstall “${plugin.name}”? Its saved data and every version kept on this PC go too. You can get it again from the store.`} onRemove={() => removePlugin(plugin.id)} />
              {offered
                ? <button type="button" className="mk-get primary" disabled={busy === plugin.id} onClick={() => void update(plugin, offered)}>{busy === plugin.id ? '…' : 'Update'}</button>
                : <button type="button" className="mk-get" onClick={() => onOpenInMaker(plugin.id)}>Open</button>}
            </div>
          );
        })}
      </div>
    </>
  );
}

/** The next patch version after `version`. */
const bump = (version: string | null | undefined) => {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version ?? '');
  return match ? `${match[1]}.${match[2]}.${Number(match[3]) + 1}` : '1.0.0';
};

const STEP_LABEL: Record<PublishStep, string> = { checking: 'Checking it…', testing: 'Testing it against a copy of your project…', packing: 'Packing it…', sending: 'Sending it to Bhippi…' };

/**
 * Yours: who you publish as (your Bhippi sign-in — photo, name, @handle), the plugins you made
 * with a Publish button each, and the history of what you sent.
 */
function MyPlugins({ known, onOpenInMaker }: { known: ReadonlySet<string>; onOpenInMaker: (id: string) => void }) {
  const { plugins } = usePlugins();
  const [account, setAccount] = useState<MyAccount | null>(null);
  const { signedIn } = useContext(AccountContext);
  const [profile, setProfile] = useState<(Publisher & { bio: string }) | null>(null);
  const [subs, setSubs] = useState<Awaited<ReturnType<typeof mySubmissions>> | null>(null);
  const [storeClosed, setStoreClosed] = useState(false);
  const [own, setOwn] = useState(0);

  // The library may not be loaded yet when the store is the first thing opened.
  useEffect(() => {
    void loadPlugins();
  }, []);

  useEffect(() => {
    // Who is signed in comes from this copy's own sign-in, so it shows even before the store opens.
    api.licenseStatus().then((status) => {
      const user = status.account?.user;
      if (user) setAccount((current) => current ?? { name: user.name ?? '', email: user.email, picture: user.picture });
    }, () => undefined);
  }, [signedIn]);
  useEffect(() => {
    if (!signedIn) return;
    myPublisher().then((answer) => {
      setProfile(answer.publisher);
      if (answer.account) setAccount(answer.account);
    }, (failure) => setStoreClosed(isClosed(failure)));
    mySubmissions().then(setSubs, (failure) => setStoreClosed((closed) => closed || isClosed(failure)));
  }, [own, signedIn]);

  // Made here: built in the Maker or by hand, not installed from someone else's package.
  const mine = plugins.filter((plugin) => !plugin.pkg || plugin.pkg.source === 'local');
  const latest = (id: string) => subs?.versions.filter((row) => row.plugin === id).sort((x, y) => y.submittedAt - x.submittedAt)[0] ?? null;

  if (signedIn === false) {
    return (
      <section className="mk-section mk-profile mk-signin">
        <h3>Connect your Google account</h3>
        <p className="mk-dim">Publishing, installing and reviewing plugins use your Google account: your photo and name show on every plugin and review you share.</p>
        <SignIn compact />
      </section>
    );
  }
  return (
    <>
      <ProfileCard account={account} profile={profile} storeClosed={storeClosed} onSaved={(next) => setProfile(next)} />

      <section className="mk-section">
        <h3>Plugins you made</h3>
        {!mine.length ? (
          <p className="mk-dim">You haven’t made a plugin yet. Open the Plugin Maker, describe what you want, and it appears here ready to publish.</p>
        ) : (
          <div className="mk-mine">
            {mine.map((plugin) => (
              <MinePlugin key={plugin.id} plugin={plugin} submission={latest(plugin.id)} known={known} storeClosed={storeClosed} onOpenInMaker={onOpenInMaker} onPublished={() => setOwn((n) => n + 1)} />
            ))}
          </div>
        )}
      </section>

      {!!subs?.versions.length && (
        <section className="mk-section">
          <h3>Everything you sent</h3>
          <div className="mk-rows">
            {subs.versions.map((row) => (
              <div key={row.id} className="mk-row">
                <span className="mk-row-text">
                  <strong>{subs.listings.find((item) => item.id === row.plugin)?.name ?? plugins.find((item) => item.id === row.plugin)?.name ?? row.plugin} <span className="mk-dim">{row.version}</span></strong>
                  <em>{row.note ?? `Sent ${new Date(row.submittedAt * 1000).toLocaleDateString()}`}</em>
                </span>
                <span className={`mk-status status-${row.status}`}>{STATUS[row.status]}</span>
                {row.status === 'in_review' && <button type="button" className="mk-link" onClick={() => void withdraw(row.id).then(() => setOwn((n) => n + 1))}>Withdraw</button>}
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

/** Who you publish as: your Google photo, a display name and an @handle you can change, and the Verified badge. */
function ProfileCard({ account, profile, storeClosed, onSaved }: { account: MyAccount | null; profile: (Publisher & { bio: string }) | null; storeClosed: boolean; onSaved: (next: (Publisher & { bio: string }) | null) => void }) {
  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [state, setState] = useState('');
  useEffect(() => {
    setName(profile?.name ?? account?.name ?? '');
    setHandle(profile?.handle ?? '');
  }, [profile, account]);
  const changed = !!profile && (name.trim() !== profile.name || handle !== profile.handle);
  const save = async () => {
    setState('saving');
    try {
      const answer = await savePublisher(handle || (name || account?.email.split('@')[0] || 'maker').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''), name, profile?.bio ?? '');
      onSaved(answer.publisher);
      setState(profile?.verified && !answer.publisher?.verified ? 'Saved. A new name or handle waits for Bhippi to verify it again.' : 'Saved.');
    } catch (failure) {
      setState(errorText(failure));
    }
  };
  const shown = name.trim() || account?.name || 'You';
  return (
    <section className="mk-section mk-profile mk-me">
      <PersonPhoto picture={profile?.picture ?? account?.picture ?? null} name={shown} size={64} />
      <div className="mk-me-text">
        <input className="mk-me-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={60} placeholder="Your name" aria-label="Display name" />
        <span className="mk-me-handle">
          @<input value={handle} size={Math.max(8, (handle || 'made-when-you-publish').length + 1)} onChange={(event) => setHandle(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} maxLength={32} placeholder={profile ? '' : 'made-when-you-publish'} aria-label="Handle" />
          {profile?.verified && <span className="mk-badge"><BadgeCheck size={11} /> Verified</span>}
        </span>
        <span className="mk-dim">{account?.email}{' · '}{storeClosed ? 'Your plugins will show with this photo and name.' : profile ? 'Shown with your photo on every plugin you publish.' : 'Your profile is made from this the first time you publish.'}</span>
      </div>
      {!storeClosed && (profile ? changed : !!name.trim()) && (
        <button type="button" className="mk-get primary" disabled={state === 'saving' || !name.trim()} onClick={() => void save()}>{profile ? 'Save' : 'Create'}</button>
      )}
      {state && state !== 'saving' && <p className="mk-dim mk-me-state">{state}</p>}
    </section>
  );
}

/** Your Google photo, or your initial on a colour when there is none. */
function PersonPhoto({ picture, name, size }: { picture: string | null; name: string; size: number }) {
  const [broken, setBroken] = useState(false);
  if (picture && !broken) return <img className="mk-photo" src={picture} alt="" width={size} height={size} referrerPolicy="no-referrer" onError={() => setBroken(true)} style={{ width: size, height: size }} />;
  return <span className="mk-photo mk-photo-letter" style={{ width: size, height: size, fontSize: size * 0.42, background: `hsl(${hueOf(name)} 55% 45%)` }}>{(name.trim()[0] ?? '?').toUpperCase()}</span>;
}

/** One plugin you made: where it stands in the store, and Publish (or update) with its version and category. */
function MinePlugin({ plugin, submission, known, storeClosed, onOpenInMaker, onPublished }: { plugin: Plugin; submission: Submission | null; known: ReadonlySet<string>; storeClosed: boolean; onOpenInMaker: (id: string) => void; onPublished: () => void }) {
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState(bump(submission?.version ?? plugin.pkg?.version ?? null));
  const [category, setCategory] = useState<Category>('utility');
  const [step, setStep] = useState<PublishStep | null>(null);
  const [result, setResult] = useState<{ ok: boolean; lines: string[] } | null>(null);
  const icon: MarketPlugin = { id: plugin.id, name: plugin.name, summary: plugin.description, icon: plugin.icon ?? null, category, author: '', version: null, bhippi: null, size: null, updatedAt: 0, installs: 0, permissions: plugin.permissions, background: plugin.background, publisher: null, rating: null };
  const status = submission ? `${STATUS[submission.status]} · ${submission.version}` : 'Not published';
  const go = async () => {
    setResult(null);
    try {
      const outcome = await publish(plugin.id, { version: version.trim(), category, known, checker: pluginChecker, onStep: setStep });
      setResult(outcome.ok ? { ok: true, lines: [`Version ${outcome.version} is with Bhippi for review. You’ll see it here when it’s live.`] } : { ok: false, lines: outcome.problems });
      if (outcome.ok) {
        setOpen(false);
        onPublished();
      }
    } catch (failure) {
      setResult({ ok: false, lines: [errorText(failure)] });
    } finally {
      setStep(null);
    }
  };
  return (
    <div className="mk-mine-item">
      <div className="mk-row">
        <AppIcon plugin={icon} size={48} />
        <span className="mk-row-text">
          <strong>{plugin.name}</strong>
          <em>{plugin.description || 'No description yet'}</em>
          <small><span className={`mk-status status-${submission?.status ?? 'none'}`}>{status}</span>{submission?.note && <span className="mk-bad"> {submission.note}</span>}</small>
        </span>
        <RemoveButton
          label="Remove"
          what={submission?.status === 'approved'
            ? `Delete “${plugin.name}” from this PC? Its code, spec and saved data go. The version in the store stays for people who installed it.`
            : `Delete “${plugin.name}” for good? Its code, spec, saved data and versions go, and it can’t be undone.`}
          onRemove={() => removePlugin(plugin.id)}
        />
        <button type="button" className="mk-link mk-inline" onClick={() => onOpenInMaker(plugin.id)}>Open in Maker</button>
        {submission?.status !== 'in_review' && (
          <button type="button" className="mk-get primary" disabled={storeClosed} title={storeClosed ? 'Publishing opens with the store' : undefined} onClick={() => setOpen((value) => !value)}>
            {submission?.status === 'approved' ? 'Update' : 'Publish'}
          </button>
        )}
      </div>
      {open && (
        <div className="mk-publish">
          <div className="mk-line">
            <label>Version<input value={version} onChange={(event) => setVersion(event.target.value)} placeholder="1.0.0" /></label>
            <label className="grow">Category<select value={category} onChange={(event) => setCategory(event.target.value as Category)}>{CATEGORIES.map((id) => <option key={id} value={id}>{CATEGORY[id].label}</option>)}</select></label>
          </div>
          <p className="mk-dim">It’s tested here first and must pass the quality check, then Bhippi reviews it before anyone can install it. It will show with your photo and name.</p>
          <div className="mk-line"><span className="mk-dim">{step ? STEP_LABEL[step] : ''}</span><button type="button" className="mk-link" disabled={!!step} onClick={() => setOpen(false)}>Cancel</button><button type="button" className="mk-get primary" disabled={!!step || !version.trim()} onClick={() => void go()}>Publish</button></div>
        </div>
      )}
      {result && <ul className={result.ok ? 'mk-result ok' : 'mk-result bad'}>{result.lines.map((line) => <li key={line}>{line}</li>)}</ul>}
    </div>
  );
}

/**
 * Remove with a second look: the first click asks, in place, what exactly goes; only "Yes" removes.
 * (No browser confirm box: the app's window may not show one.)
 */
function RemoveButton({ label, what, onRemove }: { label: string; what: string; onRemove: () => Promise<unknown> }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  if (!asking) {
    return <button type="button" className="mk-remove" onClick={(event) => { event.stopPropagation(); setAsking(true); }} title={label} aria-label={label}><Trash2 size={14} /></button>;
  }
  const go = async () => {
    setBusy(true);
    setProblem('');
    try {
      await onRemove();
    } catch (failure) {
      setProblem(errorText(failure));
      setBusy(false);
    }
  };
  return (
    <span className="mk-confirm" role="alertdialog" aria-label={what} onClick={(event) => event.stopPropagation()}>
      <span>{problem || what}</span>
      <button type="button" className="mk-link mk-inline" disabled={busy} onClick={() => setAsking(false)}>Cancel</button>
      <button type="button" className="mk-get danger" disabled={busy} onClick={() => void go()}>{busy ? '…' : label}</button>
    </span>
  );
}
