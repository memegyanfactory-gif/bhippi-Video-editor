// The right pane of the language-model browser: who made the model, its numbers, what it can do,
// the sizes to download (each with how it fits this PC) and its README.
import { ArrowDownToLine, ExternalLink, LoaderCircle, Pause, Play, Square, Star, Trash2, TriangleAlert, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '../../components/ui';
import { errorText } from '../../lib/ipc';
import {
  activeParamsIn, compact, contextLabel, displayName, entryCapabilities, helperLabel, hubCapabilities, hubEntryId, hubIdPart, looksMoe, paramsLabel, prettyMaker, quantFit, readmeText, recommendQuant, relativeDate,
  type HubFullDetail, type HubRow,
} from '../../lib/llmHub';
import { defaultVariant, fitOf, formatBytes, formatProgress, type FitResult } from '../../lib/modelFit';
import { libraryApi, type LibraryEntry, type LibraryView, type LlmPlan, type LlmRuntimeStatus } from '../../lib/modelLibrary';
import type { HardwareInfo } from '../../lib/ipc';
import type { Job } from '../../lib/types';
import { Markdown } from '../../components/Markdown';
import { statusOf, statusOfSize, useDownloadProgress, useQueueWatch } from '../libraryShared';
import { HfSignIn } from '../library/HfSignIn';
import { CapChips, CopyButton, FitPill, MakerLogo, VerifiedTick } from './parts';
import { RunningSpeeds, TuneControls } from './SpeedPanel';
import { STRATA_BADGE, StrataNotes, StrataStartConfirm, useStrataStatus } from './StrataPanel';

/** What the list has selected: one of Bhippi's own cards (picks and added models), or a Hugging Face result. */
export type Selection = { kind: 'card'; id: string } | { kind: 'hub'; row: HubRow };

/** The Hugging Face repository a library card was made from, from its first file's address. */
export const repoOfEntry = (entry: LibraryEntry): string | null => {
  const url = entry.publisher?.repo ?? entry.variants[0]?.files[0]?.url ?? '';
  const match = /^(?:https:\/\/huggingface\.co\/)?([\w.-]+\/[\w.-]+?)(?:\/resolve\/.*)?$/.exec(url);
  return match ? match[1] : null;
};

const detailCache = new Map<string, HubFullDetail>();

/** The Hugging Face page of a repository (sizes, README, stats), kept for the session. */
export function useHubDetail(repo: string | null) {
  const [state, setState] = useState<{ repo: string | null; detail: HubFullDetail | null; error: string; loading: boolean }>({ repo, detail: repo ? detailCache.get(repo) ?? null : null, error: '', loading: false });
  useEffect(() => {
    if (!repo) { setState({ repo, detail: null, error: '', loading: false }); return; }
    const cached = detailCache.get(repo);
    if (cached) { setState({ repo, detail: cached, error: '', loading: false }); return; }
    let live = true;
    setState({ repo, detail: null, error: '', loading: true });
    libraryApi.hubModel(repo)
      .then((detail) => { detailCache.set(repo, detail as HubFullDetail); if (live) setState({ repo, detail: detail as HubFullDetail, error: '', loading: false }); })
      .catch((failure) => { if (live) setState({ repo, detail: null, error: errorText(failure), loading: false }); });
    return () => { live = false; };
  }, [repo]);
  return state.repo === repo ? state : { repo, detail: null, error: '', loading: !!repo };
}

type Option = {
  key: string;
  title: string;
  subtitle: string | null;
  bits: number | null;
  bytes: number;
  projectorBytes: number;
  fit: FitResult;
  recommended: boolean;
  /** The library card that holds this size (a pick, or a Hugging Face size already added). */
  view: LibraryView | null;
  variantId: string | null;
  /** Set for a size not added yet. */
  quant: string | null;
  plan: LlmPlan | null;
};

const isProjector = (dest: string) => /(^|\/)mmproj/i.test(dest);

export type DetailContext = {
  hw: HardwareInfo | null;
  freeGb: number | null;
  views: LibraryView[];
  jobs: Job[];
  llm: LlmRuntimeStatus | null;
  /** Called after anything that changes the library. */
  refresh: () => void;
  onSelectCard: (id: string | null) => void;
};

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="lb-fact"><span className="lb-fact-label">{label}</span><span className="lb-fact-value">{value}</span></div>;
}

/** The live state of one running download: bar, "1.2 of 5.0 GB · 38 MB/s · 2 min left", Pause and Cancel. */
function DownloadStatus({ view, job, busy, onPause, onCancel }: { view: LibraryView; job: Job | undefined; busy: boolean; onPause: () => void; onCancel: () => void }) {
  const progress = useDownloadProgress(view, job);
  const pct = Math.round(progress.fraction * 100);
  const detail = [progress.speed > 0 ? `${formatBytes(progress.speed)}/s` : null, progress.eta ? `${progress.eta.replace(/^about /, '')} left` : null].filter(Boolean).join(' · ');
  return (
    <div className="lb-dl" aria-live="polite">
      <div className="lb-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <span className="lb-progress-bar"><span style={{ width: `${pct}%` }} /></span>
        <span className="lb-progress-text">{pct}%</span>
      </div>
      <div className="lb-dl-row">
        <span className="lb-dl-text">{progress.total > 0 ? formatProgress(progress.done, progress.total) : 'Starting…'}{detail ? ` · ${detail}` : progress.total > 0 ? ' · measuring speed…' : ''}</span>
        <button type="button" className="btn btn-small" disabled={busy} onClick={onPause}><Pause size={11} /> Pause</button>
        <button type="button" className="btn btn-small btn-ghost" disabled={busy} onClick={onCancel}><X size={11} /> Cancel</button>
      </div>
    </div>
  );
}

type Consent = { key: string; id: string; variant: string; entry: LibraryEntry; name: string; size: string };

export function LlmDetail({ selection, ctx }: { selection: Selection; ctx: DetailContext }) {
  const toast = useToast();
  useQueueWatch();
  const { hw, freeGb, views, jobs, llm, refresh } = ctx;
  const cardView = selection.kind === 'card' ? views.find((view) => view.entry.id === selection.id) ?? null : null;
  const repo = selection.kind === 'hub' ? selection.row.repo : cardView ? repoOfEntry(cardView.entry) : null;
  const { detail, error: hubError, loading } = useHubDetail(repo);
  const [busy, setBusy] = useState<string | null>(null);
  const [consent, setConsent] = useState<Consent | null>(null);
  /** Sizes whose Download was just clicked, with what Bhippi is doing for each, until their job shows. */
  const [starting, setStarting] = useState<Record<string, string>>({});
  const consentRef = useRef<HTMLDivElement>(null);
  const acceptRef = useRef<HTMLButtonElement>(null);
  const markStarting = (key: string, note: string) => setStarting((now) => ({ ...now, [key]: note }));
  const clearStarting = (key: string) => setStarting((now) => { if (!(key in now)) return now; const { [key]: _gone, ...rest } = now; return rest; });
  const [confirming, setConfirming] = useState<string | null>(null);
  const [plans, setPlans] = useState<Record<string, LlmPlan>>({});
  /** The Strata size waiting for the person to confirm a start (loading can freeze the PC for minutes). */
  const [confirmStart, setConfirmStart] = useState<string | null>(null);
  /** Whether the signed-in Hugging Face account may download this gated repository. */
  const [hfGranted, setHfGranted] = useState(false);

  const row: HubRow | null = selection.kind === 'hub' ? selection.row : null;
  const base = detail ?? row;
  /** Library cards made from this repository (sizes already added). */
  const added = useMemo(() => (repo ? views.filter((view) => view.entry.source === 'huggingface' && view.entry.publisher?.repo === repo) : []), [views, repo]);

  useEffect(() => { setConsent(null); setConfirming(null); setConfirmStart(null); setBusy(null); setStarting({}); }, [selection.kind, selection.kind === 'card' ? selection.id : selection.row.repo]);

  // The licence step opens right under the row that asked for it: bring it into view and put the keyboard on its button.
  useEffect(() => {
    if (!consent) return;
    consentRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    acceptRef.current?.focus({ preventScroll: true });
  }, [consent]);

  // How each size of a card would run on this PC, from llama.cpp's plan (a dry run).
  const planned = cardView ?? (added.length === 1 ? added[0] : null);
  const plannedId = planned?.entry.id ?? null;
  useEffect(() => {
    setPlans({});
    if (!planned) return;
    let live = true;
    void (async () => {
      for (const variant of planned.entry.variants) {
        try {
          const result = await libraryApi.llmStart(planned.entry.id, { dryRun: true, variant: variant.id });
          if (!live) return;
          setPlans((now) => ({ ...now, [variant.id]: result.plan }));
        } catch { /* the badge still tells */ }
      }
    })();
    return () => { live = false; };
  }, [plannedId]);

  const projectorBytes = detail?.mmproj?.bytes ?? 0;
  const moe = looksMoe(base?.architecture, base?.name ?? repo ?? '');

  const strata = cardView?.entry.runtime === 'strata';
  const strataStatus = useStrataStatus(strata ? `${llm?.running?.modelId ?? ''}|${jobs.filter((job) => job.kind === 'model').map((job) => `${job.id}:${job.status}`).join(',')}` : null);

  const options: Option[] = useMemo(() => {
    if (cardView) {
      const entry = cardView.entry;
      const flagged = defaultVariant(entry.variants, hw, entry.runtime)?.id;
      return entry.variants.map((variant) => {
        // A size another installer fetches (Strata) lists no files, only its estimate.
        const weights = variant.files.filter((file) => !isProjector(file.dest)).reduce((sum, file) => sum + file.bytes, 0) || (variant.approxBytes ?? 0);
        const projector = variant.files.filter((file) => isProjector(file.dest)).reduce((sum, file) => sum + file.bytes, 0);
        const params = variant.llm?.totalParamsB ?? 0;
        return {
          key: variant.id,
          title: variant.label,
          subtitle: variant.llm?.quant ?? null,
          bits: params > 0 ? Math.round(((weights * 8) / (params * 1e9)) * 10) / 10 : null,
          bytes: weights,
          projectorBytes: projector,
          fit: fitOf(variant, hw, { runtime: entry.runtime, freeGb }),
          recommended: variant.id === flagged,
          view: cardView,
          variantId: variant.id,
          quant: null,
          plan: plans[variant.id] ?? null,
        };
      });
    }
    if (!detail) return [];
    const fits = (quant: { bytes: number }) => quantFit(quant, projectorBytes, moe, hw, freeGb).fit;
    const best = recommendQuant(detail.quants, fits);
    return detail.quants.map((quant) => {
      // The card llm_hub.rs made for this size: found by its id (repo + size), never by a display label.
      const wantedId = repo ? hubEntryId(repo, quant.quant) : '';
      const match = added.find((view) => view.entry.id === wantedId) ?? added.find((view) => view.entry.variants[0]?.id === hubIdPart(quant.quant)) ?? added.find((view) => view.entry.variants[0]?.label === quant.quant) ?? null;
      return {
        key: quant.quant,
        title: quant.quant,
        subtitle: null,
        bits: quant.bits,
        bytes: quant.bytes,
        projectorBytes,
        fit: quantFit(quant, projectorBytes, moe, hw, freeGb),
        recommended: quant.quant === best,
        view: match,
        variantId: match?.entry.variants[0]?.id ?? null,
        quant: quant.quant,
        plan: match && added.length === 1 ? plans[match.entry.variants[0]?.id ?? ''] ?? null : null,
      };
    });
  }, [cardView, detail, hw, freeGb, added, plans, projectorBytes, moe, repo]);

  // A size stops being "starting" once its job shows (or it is already on disk).
  useEffect(() => {
    for (const option of options) {
      if (!(option.key in starting) || !option.view) continue;
      const job = option.view.state.download ? jobs.find((candidate) => candidate.id === option.view?.state.download?.jobId) : undefined;
      const id = (option.view.entry.runtime === 'strata' ? statusOfSize(option.view, job, option.variantId) : statusOf(option.view, job)).id;
      if (id === 'downloading' || id === 'queued' || id === 'ready' || id === 'on') clearStarting(option.key);
    }
  }, [options, jobs, starting]);

  /** Every size of this model is past what this PC can hold. */
  const allTooBig = !!hw && options.length > 0 && options.every((option) => option.fit.fit === 'no');
  /** Bhippi's own picks that do fit, largest first: where to point someone when nothing here fits. */
  const fittingPicks = useMemo(() => {
    if (!allTooBig) return [];
    return views
      .filter((view) => view.entry.kind === 'llm' && view.entry.source !== 'huggingface' && view.entry.runtime === 'llama-cpp' && view.entry.id !== cardView?.entry.id)
      .flatMap((view) => {
        const variant = defaultVariant(view.entry.variants, hw, view.entry.runtime);
        if (!variant) return [];
        const fit = fitOf(variant, hw, { runtime: view.entry.runtime, freeGb });
        return fit.fit === 'great' || fit.fit === 'ok' ? [{ view, bytes: variant.files.reduce((sum, file) => sum + file.bytes, 0) }] : [];
      })
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 3)
      .map((row) => row.view);
  }, [allTooBig, views, hw, freeGb, cardView]);

  const guard = async (key: string, work: () => Promise<unknown>, failure: string) => {
    setBusy(key);
    try {
      await work();
      return true;
    } catch (caught) {
      toast({ tone: 'error', title: failure, body: errorText(caught) });
      return false;
    } finally {
      setBusy(null);
      refresh();
    }
  };

  /** Tells the person the download began, and where to watch it. */
  const announce = (name: string, size: string) => {
    toast({ tone: 'success', title: `${name} (${size}) added to downloads`, body: 'It starts right away, or after the download ahead of it. Progress shows here and in Model Library → Downloads.' });
    // Safety net: if no job ever appears in the listing, do not leave the row "starting" forever.
    window.setTimeout(() => setStarting({}), 15_000);
  };

  /** Starts the download of a card's size, asking for the license first (right under its row) when the license needs accepting. */
  const startDownload = async (option: Option, id: string, variant: string) => {
    const listing = await libraryApi.list();
    const found = listing.models.find((view) => view.entry.id === id);
    if (!found) throw new Error('Bhippi added this size but could not find it in the library yet. Close this page, open it again and press Download once more.');
    const name = found.entry.name;
    const size = formatBytes(option.bytes + option.projectorBytes);
    if (found.entry.license.requiresAcceptance && !found.state.accepted) {
      clearStarting(option.key);
      setConsent({ key: option.key, id, variant, entry: found.entry, name, size });
      return;
    }
    markStarting(option.key, 'Starting download…');
    await libraryApi.download(id, variant);
    announce(name, size);
  };

  const download = async (option: Option) => {
    if (gated) {
      toast({ tone: 'error', title: 'Sign in to Hugging Face first', body: 'This model is gated. Sign in and accept its terms in the box above, then press Download again.' });
      return;
    }
    markStarting(option.key, option.view ? 'Starting download…' : 'Adding it to your library…');
    const ok = await guard(option.key, async () => {
      if (option.view && option.variantId) {
        await startDownload(option, option.view.entry.id, option.variantId);
      } else if (option.quant && repo) {
        const made = await libraryApi.hubAdd(repo, option.quant);
        markStarting(option.key, 'Starting download…');
        await startDownload(option, made.id, made.variant);
      } else {
        throw new Error('Bhippi could not tell which size this is. Reload the model page and try again.');
      }
    }, 'Could not start the download');
    if (!ok) clearStarting(option.key);
  };

  const accept = () => {
    if (!consent) return;
    const { key, id, variant, name, size } = consent;
    markStarting(key, 'Starting download…');
    void guard(`license:${id}`, async () => {
      await libraryApi.acceptLicense(id, true);
      setConsent(null);
      await libraryApi.download(id, variant);
      announce(name, size);
    }, 'Could not start the download').then((ok) => { if (!ok) clearStarting(key); });
  };

  const cancel = (view: LibraryView) => void guard(view.entry.id, () => libraryApi.cancel(view.entry.id, false), 'Could not stop the download');
  const pause = (view: LibraryView) => void guard(view.entry.id, () => libraryApi.cancel(view.entry.id, true), 'Could not pause the download');
  const start = (view: LibraryView, size: string | null) => void guard(view.entry.id, async () => {
    const result = await libraryApi.llmStart(view.entry.id, size ? { variant: size } : {});
    setConfirmStart(null);
    toast({ tone: 'success', title: `${view.entry.name} is ready`, body: result.running?.tokensPerSecond ? `About ${Math.round(result.running.tokensPerSecond * 0.75)} words a second. It is now a chat provider.` : 'It is now a chat provider.' });
  }, 'Could not start the model');
  const stop = () => void guard('stop', () => libraryApi.llmStop(), 'Could not stop the model');
  const remove = (view: LibraryView) => void guard(view.entry.id, async () => {
    if (view.entry.source === 'huggingface') {
      await libraryApi.hubRemove(view.entry.id);
      if (cardView && cardView.entry.id === view.entry.id) ctx.onSelectCard(null);
    } else {
      await libraryApi.delete(view.entry.id);
    }
    setConfirming(null);
  }, 'Could not delete the model');
  const installRuntime = () => void guard('runtime', () => libraryApi.llmInstall(), 'Could not install llama.cpp');

  const entry = cardView?.entry ?? null;
  const name = entry ? entry.name : displayName(base?.name ?? repo ?? '');
  const maker = entry ? (detail?.maker ?? entry.maker) : (detail?.maker ?? row?.maker ?? '');
  const makerLogo = detail?.makerAvatarPath ?? row?.makerAvatarPath ?? entry?.publisher?.avatarPath ?? null;
  const publisher = detail?.author ?? row?.author ?? entry?.publisher?.name ?? null;
  const verified = detail?.verified ?? row?.verified ?? false;
  const caps = entry
    ? (() => { const own = entryCapabilities(entry); const theirs = detail ? hubCapabilities(detail) : { vision: false, tools: false, reasoning: false }; return { vision: own.vision || theirs.vision || !!detail?.mmproj, tools: own.tools || theirs.tools, reasoning: own.reasoning || theirs.reasoning }; })()
    : { ...(base ? hubCapabilities(base) : { vision: false, tools: false, reasoning: false }), vision: (base ? hubCapabilities(base).vision : false) || !!detail?.mmproj };
  const shape = entry?.variants.find((variant) => variant.default)?.llm ?? entry?.variants[0]?.llm;
  const params = shape?.totalParamsB ?? base?.paramsB ?? null;
  const active = shape && shape.moe ? shape.activeParamsB : base ? activeParamsIn(base.name) : null;
  const context = shape?.contextMax ?? base?.contextMax ?? null;
  const isMoe = shape ? shape.moe : moe;
  const downloads = detail?.downloads ?? row?.downloads ?? null;
  const likes = detail?.likes ?? row?.likes ?? null;
  const updated = detail?.updatedAt ?? row?.updatedAt ?? null;
  const license = detail?.license ?? row?.license ?? null;
  const gatedRepo = !!(detail?.gated ?? row?.gated);
  /** Gated and not yet allowed: downloads wait for the sign-in steps. */
  const gated = gatedRepo && !hfGranted;
  const runningId = llm?.running?.modelId ?? null;
  const readme = detail?.summary ? readmeText(detail.summary) : '';

  const stat = (icon: React.ReactNode, text: string, title: string) => <span className="lb-stat" title={title}>{icon}{text}</span>;

  return (
    <div className="lb-detail-scroll">
      <article className="lb-detail">
        <header className="lb-head">
          <MakerLogo path={makerLogo} name={maker || name} size={52} />
          <div className="lb-head-text">
            <h3 className="lb-title">{name}{verified && <VerifiedTick maker={prettyMaker(maker)} />}</h3>
            <p className="lb-by">
              {maker && <span>{prettyMaker(maker)}</span>}
              {publisher && publisher !== maker && <span className="lb-faint"> · quantized by {publisher}</span>}
            </p>
          </div>
          <div className="lb-head-badges">
            {entry && entry.source !== 'huggingface' && <span className="lb-badge pick">Bhippi pick</span>}
            {strata && <span className="lb-badge engine" title="Needs the Strata engine, which Bhippi sets up for you">{STRATA_BADGE}</span>}
            {entry && entry.source === 'huggingface' && <span className="lb-badge">Added from Hugging Face</span>}
            {gatedRepo && <span className="lb-badge warn" title="Hugging Face asks for a login and acceptance of terms">{hfGranted ? 'Gated, unlocked' : 'Gated'}</span>}
          </div>
        </header>

        {repo && (
          <div className="lb-repo">
            <code className="lb-repo-id">{repo}</code>
            <CopyButton text={repo} label="Copy the repository name" />
            <a className="lb-icon-btn" href={`https://huggingface.co/${repo}`} target="_blank" rel="noreferrer" title="Open on Hugging Face" aria-label="Open on Hugging Face"><ExternalLink size={13} /></a>
          </div>
        )}
        <div className="lb-stats">
          {downloads != null && stat(<ArrowDownToLine size={13} />, compact(downloads), `${downloads.toLocaleString()} downloads`)}
          {likes != null && stat(<Star size={13} />, compact(likes), `${likes.toLocaleString()} likes`)}
          {updated && <span className="lb-stat" title={new Date(updated).toLocaleDateString()}>Updated {relativeDate(updated)}</span>}
        </div>

        {entry && <p className="lb-summary">{entry.summary}</p>}
        {entry && entry.description !== entry.summary && <p className="lb-desc">{entry.description}</p>}

        <div className="lb-facts">
          {params ? <Fact label="Params" value={`${paramsLabel(params)}${isMoe && active ? ` · ${paramsLabel(active)} active` : ''}`} /> : null}
          {base?.architecture ? <Fact label="Arch" value={base.architecture} /> : null}
          {context ? <Fact label="Context" value={contextLabel(context)} /> : null}
          <Fact label="Format" value="GGUF" />
          {isMoe ? <Fact label="Type" value="Mixture of experts" /> : null}
          {license ? <Fact label="License" value={license} /> : entry ? <Fact label="License" value={entry.license.name} /> : null}
        </div>

        <section className="lb-section">
          <h4 className="lb-h">Capabilities</h4>
          <div className="lb-chips"><CapChips caps={caps} /></div>
        </section>

        {strata && entry && <StrataNotes entry={entry} hw={hw} status={strataStatus} />}

        {llm && !llm.installed && !strata && (
          <div className="lb-note">
            <TriangleAlert size={14} />
            <span>Running a model needs llama.cpp, a one-time download of about 300 MB.</span>
            <button type="button" className="btn btn-small" disabled={busy === 'runtime' || jobs.some((job) => job.kind === 'install' && job.status === 'running' && /llama/i.test(job.label))} onClick={installRuntime}>
              {jobs.some((job) => job.kind === 'install' && job.status === 'running' && /llama/i.test(job.label)) ? 'Installing…' : 'Install'}
            </button>
          </div>
        )}

        <section className="lb-section">
          <h4 className="lb-h">Download options</h4>
          {loading && !options.length && <div className="lb-skeleton-rows" aria-label="Loading sizes">{[0, 1, 2, 3].map((index) => <span key={index} className="lb-skeleton row" />)}</div>}
          {!loading && hubError && !options.length && <div className="lb-note warn"><TriangleAlert size={14} /><span>{hubError}</span></div>}
          {allTooBig && (
            <div className="lb-note warn" role="status">
              <TriangleAlert size={14} />
              <div>
                <strong>Every size of this model needs more memory than this PC has.</strong>
                {fittingPicks.length > 0 ? (
                  <span> Smaller models that fit: {fittingPicks.map((pick, index) => (
                    <span key={pick.entry.id}>{index > 0 ? ', ' : ''}<button type="button" className="ml-link-btn" onClick={() => ctx.onSelectCard(pick.entry.id)}>{pick.entry.name}</button></span>
                  ))}.</span>
                ) : <span> Look for a smaller model, or one with fewer parameters.</span>}
              </div>
            </div>
          )}
          {gatedRepo && <HfSignIn repo={repo} modelName={name} onAccess={setHfGranted} />}
          <ul className="lb-options">
            {options.map((option) => {
              const view = option.view;
              const job = view?.state.download ? jobs.find((candidate) => candidate.id === view.state.download?.jobId) : undefined;
              // A Strata card keeps several sizes at once, so each size has its own status and its own running state.
              const status = view ? (view.entry.runtime === 'strata' ? statusOfSize(view, job, option.variantId) : statusOf(view, job)) : null;
              const running = !!view && runningId === view.entry.id && (view.entry.runtime !== 'strata' || llm?.running?.variant === option.variantId);
              const otherSetUp = !!view && view.entry.runtime === 'strata' && !!view.state.download && view.state.download.variant !== option.variantId;
              const startingNote = starting[option.key];
              const working = busy === option.key || (!!view && busy === view.entry.id) || !!startingNote;
              const total = option.bytes + option.projectorBytes;
              const askingLicense = consent?.key === option.key;
              return (
                <li key={option.key} className={`lb-option${option.recommended ? ' recommended' : ''}`}>
                  <div className="lb-option-main">
                    <div className="lb-option-title">
                      <strong>{option.title}</strong>
                      {option.subtitle && <span className="lb-faint">{option.subtitle}</span>}
                      {option.recommended && <span className="lb-badge rec">Recommended</span>}
                    </div>
                    <div className="lb-option-meta">
                      {option.bits != null && <span>{option.bits}-bit</span>}
                      <span>{formatBytes(total)}{option.projectorBytes > 0 && <span className="lb-faint"> incl. {formatBytes(option.projectorBytes)} for pictures</span>}</span>
                      <FitPill fit={option.fit} />
                    </div>
                    {option.plan && option.plan.verdict !== 'no' && !strata && <p className="lb-plan">{option.plan.note}</p>}
                    {option.plan && option.plan.verdict === 'no' && <p className="lb-plan bad">{option.plan.note}</p>}
                    {startingNote && status?.id !== 'downloading' && <p className="lb-starting" role="status" aria-live="polite"><LoaderCircle size={12} className="spin" /> {startingNote}</p>}
                    {status?.id === 'queued' && <p className="lb-starting" role="status" aria-live="polite">{status.label}: starts when the download ahead of it finishes.</p>}
                    {status?.id === 'downloading' && view && <DownloadStatus view={view} job={job} busy={busy === view.entry.id} onPause={() => pause(view)} onCancel={() => cancel(view)} />}
                    {status?.id === 'downloading' && job?.message && view?.entry.runtime === 'strata' && <p className="lb-plan" aria-live="polite">{job.message}</p>}
                    {(status?.id === 'ready' || status?.id === 'on') && view && view.entry.runtime === 'llama-cpp' && view.state.installedVariant === option.variantId && (
                      <>
                        {running && llm?.running && <RunningSpeeds running={llm.running} />}
                        <TuneControls view={view} runtimeInstalled={!!llm?.installed} onChanged={refresh} />
                        {(view.entry.addons ?? []).filter((addon) => !view.state.installedAddons.includes(addon.id)).map((addon) => {
                          const addonBytes = addon.files.reduce((sum, file) => sum + file.bytes, 0);
                          return (
                            <p key={addon.id} className="lb-plan">
                              <button type="button" className="ml-link-btn" disabled={working} onClick={() => {
                                markStarting(option.key, 'Starting download…');
                                void guard(option.key, async () => {
                                  await libraryApi.download(view.entry.id, option.variantId ?? view.state.installedVariant ?? '', [addon.id]);
                                  announce(`the speed-up helper for ${view.entry.name}`, formatBytes(addonBytes));
                                }, 'Could not start the download').then((ok) => { if (!ok) clearStarting(option.key); });
                              }}>Add the speed-up helper (about {formatBytes(addonBytes)})</button>
                              {' '}It drafts words ahead for this model. Bhippi uses it only if Tune for this PC measures that it helps.
                            </p>
                          );
                        })}
                      </>
                    )}
                  </div>
                  <div className="lb-option-action">
                    {(!status || status.id === 'none' || status.id === 'paused') && (
                      <button type="button" className={`btn btn-small${option.recommended ? ' btn-primary' : ''}`} disabled={working || otherSetUp || askingLicense} title={otherSetUp ? 'Another size is being set up. Wait for it, or stop it first.' : undefined} onClick={() => void download(option)}>
                        {working ? <LoaderCircle size={12} className="spin" /> : <ArrowDownToLine size={12} />}
                        {working ? 'Starting…' : status?.id === 'paused' ? 'Resume' : 'Download'}
                      </button>
                    )}
                    {status?.id === 'queued' && view && (
                      <button type="button" className="btn btn-small btn-ghost" disabled={working} onClick={() => void guard(view.entry.id, () => libraryApi.discard(view.entry.id), 'Could not remove it from the queue')}>Remove from queue</button>
                    )}
                    {(status?.id === 'ready' || status?.id === 'on') && view && (
                      <>
                        <span className="lb-done">{running ? 'In use' : 'Downloaded'}</span>
                        {running ? (
                          <button type="button" className="btn btn-small" disabled={busy === 'stop'} onClick={stop}><Square size={11} /> Stop</button>
                        ) : (
                          <button type="button" className="btn btn-small btn-primary" disabled={working || (!!llm && !llm.installed && view.entry.runtime !== 'strata')} onClick={() => (view.entry.runtime === 'strata' ? setConfirmStart(option.variantId) : start(view, null))}>
                            {working ? <LoaderCircle size={12} className="spin" /> : <Play size={11} />} Start
                          </button>
                        )}
                        {confirming === view.entry.id ? (
                          <button type="button" className="btn btn-small lb-danger" onClick={() => remove(view)} onBlur={() => setConfirming(null)} autoFocus>Delete?</button>
                        ) : (
                          <button type="button" className="lb-icon-btn" title="Delete the download" aria-label="Delete the download" disabled={running} onClick={() => setConfirming(view.entry.id)}><Trash2 size={13} /></button>
                        )}
                      </>
                    )}
                    {status?.id === 'problem' && view && (
                      <>
                        <span className="lb-done bad" title={view.state.broken ?? ''}>Problem</span>
                        <button type="button" className="btn btn-small" onClick={() => void remove(view)}>Delete</button>
                      </>
                    )}
                  </div>
                  {consent && askingLicense && (
                    <div className="lb-consent" role="group" aria-label="License" ref={consentRef}>
                      <strong>One step before {consent.name} downloads: {consent.entry.license.name}</strong>
                      <ul>{consent.entry.license.summary.map((line) => <li key={line}>{line}</li>)}</ul>
                      <div className="lb-consent-actions">
                        <a href={consent.entry.license.url} target="_blank" rel="noreferrer" className="lb-link">Read the license <ExternalLink size={11} /></a>
                        <span className="lb-spacer" />
                        <button type="button" className="btn btn-small" onClick={() => setConsent(null)}>Not now</button>
                        <button type="button" ref={acceptRef} className="btn btn-small btn-primary" disabled={busy === `license:${consent.id}`} onClick={accept}>Accept and download</button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {strata && confirmStart && cardView && (
            <StrataStartConfirm name={cardView.entry.name} busy={busy === cardView.entry.id} onCancel={() => setConfirmStart(null)} onStart={() => start(cardView, confirmStart)} />
          )}
          {(detail?.helpers?.length ?? 0) > 0 && (
            <div className="lb-helpers">
              <h5 className="lb-h2">Speed-up helper (optional, needs one of the sizes above)</h5>
              <ul>
                {detail?.helpers?.map((helper) => (
                  <li key={helper.path}><strong>{helperLabel(helper.kind)}</strong> <span className="lb-faint">{helper.path.split('/').pop()} · {formatBytes(helper.bytes)}</span></li>
                ))}
              </ul>
              <p className="lb-plan">Not a model on its own: it drafts words ahead for a full size. Download a size first, then add the helper from that size's row.</p>
            </div>
          )}
        </section>

        {(readme || (loading && !detail)) && (
          <section className="lb-section">
            <h4 className="lb-h">README</h4>
            {readme ? <div className="lb-readme"><Markdown text={readme} /></div> : <div className="lb-skeleton-rows"><span className="lb-skeleton line" /><span className="lb-skeleton line short" /><span className="lb-skeleton line" /></div>}
          </section>
        )}
      </article>
    </div>
  );
}
