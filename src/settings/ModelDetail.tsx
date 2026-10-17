// The Model Library's detail panel. It lives inside the library's main area (beside the grid when
// there is room, over it with a back arrow when there is not), never against the window. A sticky
// header names the model, the body scrolls through About, what it makes, sizes, add-ons, licence and
// links, and a sticky footer carries the one action that matters now: download, progress, or use.
import { ArrowLeft, Cloud, ExternalLink, LoaderCircle, Pause, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type HardwareInfo } from '../lib/ipc';
import { useLiveJobs } from '../lib/jobsStore';
import { defaultVariant, fitOf, formatBytes, formatGb, formatProgress, taskLabel, totalBytes, variantBytes } from '../lib/modelFit';
import { libraryApi, type CapabilityChoice, type ComfyStatus, type LibraryStorage, type LibraryView, type LlmRuntimeStatus } from '../lib/modelLibrary';
import { localTaskOf, needsHfToken } from '../lib/modelUse';
import type { Settings } from '../lib/types';
import type { SettingsTab } from './SettingsModal';
import { LocalFolderPick } from './library/DetailExtras';
import { HfSignIn } from './library/HfSignIn';
import { hfRepoOf } from '../lib/hfSteps';
import { UseToggle } from './library/UseToggle';
import { ComfyEngine, LlmControls } from './ModelEngine';
import { CATEGORY_BY_KIND, FitDot, Thumb, statusOf, useDownloadProgress, useQueueWatch } from './libraryShared';

type Run = (work: () => Promise<unknown>, failure: string) => Promise<boolean>;

type Props = {
  view: LibraryView;
  hw: HardwareInfo | null;
  storage: LibraryStorage | null;
  comfy: ComfyStatus | null;
  comfyError: string;
  llm: LlmRuntimeStatus | null;
  /** The jobs this model is in use for (empty when none). */
  inUse: string[];
  /** What is in use for each job: the Use button reads it. */
  choices: CapabilityChoice[];
  settings: Settings;
  onSettings: (settings: Settings) => void;
  run: Run;
  onClose: () => void;
  onChanged: () => void;
  onTab?: (tab: SettingsTab) => void;
};

const external = (url: string) => (event: React.MouseEvent) => { event.preventDefault(); void api.openUrl(url); };

/** What a generation model makes, as label/value pairs. */
const outputRows = (view: LibraryView): [string, string][] => {
  const out = view.entry.output;
  if (!out) return [];
  const rows: [string, string][] = [];
  if (out.minSeconds != null || out.maxSeconds != null) rows.push(['Length', out.minSeconds && out.maxSeconds ? `${out.minSeconds} to ${out.maxSeconds} seconds` : `Up to ${out.maxSeconds ?? out.minSeconds} seconds`]);
  if (out.shortEdge) rows.push(['Resolution', `${out.shortEdge}p`]);
  if (out.fps) rows.push(['Frame rate', `${out.fps} fps`]);
  if (out.audio != null) rows.push(['Sound', out.audio ? 'Included' : 'None']);
  if (out.aspects?.length) rows.push(['Shapes', out.aspects.join(', ')]);
  return rows;
};

const llmFacts = (variant: LibraryView['entry']['variants'][number]): string | null => {
  if (!variant.llm) return null;
  return `${variant.llm.quant} · ${variant.llm.moe ? `${variant.llm.totalParamsB}B total, ${variant.llm.activeParamsB}B active` : `${variant.llm.totalParamsB}B`}`;
};

export function ModelDetail({ view, hw, storage, comfy, comfyError, llm, inUse, choices, settings, onSettings, run, onClose, onChanged, onTab }: Props) {
  const { entry, state } = view;
  const jobs = useLiveJobs();
  const job = state.download ? jobs.find((row) => row.id === state.download?.jobId) : undefined;
  const installJob = (pattern: RegExp) => jobs.find((row) => row.kind === 'install' && row.status === 'running' && pattern.test(row.label));
  useQueueWatch();
  const status = statusOf(view, job, inUse.length > 0);
  const progress = useDownloadProgress(view, job);
  const category = CATEGORY_BY_KIND[entry.kind];

  const [variantId, setVariantId] = useState(() => state.installedVariant ?? defaultVariant(entry.variants, hw, entry.runtime)?.id ?? entry.variants[0]?.id ?? '');
  const [addonIds, setAddonIds] = useState<string[]>(state.installedAddons);
  const [hfGranted, setHfGranted] = useState(false);
  const [gate, setGate] = useState(false);
  const [read, setRead] = useState(false);
  const [territory, setTerritory] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** Download was just pressed and its job is not listed yet. */
  const [starting, setStarting] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const licenceRef = useRef<HTMLElement>(null);

  // A default is picked once the hardware is known, unless the user (or an install) already chose.
  const chosen = useRef(!!state.installedVariant);
  useEffect(() => {
    if (chosen.current || !hw) return;
    const best = defaultVariant(entry.variants, hw, entry.runtime);
    if (best) setVariantId(best.id);
  }, [hw, entry]);

  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
    // Escape closes this panel only: capture it before the Settings window's own handler sees it.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const variant = entry.variants.find((row) => row.id === variantId) ?? entry.variants[0];
  const addons = useMemo(() => (entry.addons ?? []).filter((addon) => addonIds.includes(addon.id)), [entry.addons, addonIds]);
  const installed = !!state.installedVariant;
  const addonBytes = totalBytes({ files: [] }, addons);
  const bytes = variant ? variantBytes(variant) + addonBytes : 0;
  const remaining = Math.max(0, bytes - state.partialBytes);
  const fit = variant ? fitOf(variant, hw, { runtime: entry.runtime, freeGb: storage?.freeGb ?? null, extraBytes: addonBytes }) : null;
  const territories = entry.license.excludedTerritories ?? [];
  const needsGate = entry.license.requiresAcceptance && !state.accepted;
  const downloading = status.id === 'downloading';
  const resumable = !installed && !downloading && state.partialBytes > 0;
  const rows = outputRows(view);
  const tasks = entry.tasks.map(taskLabel);
  const afterFree = storage && bytes > 0 ? storage.freeGb - remaining / 1e9 : null;

  const task = localTaskOf(entry, variant);
  const gated = needsHfToken(task);
  // A gated model downloads through the local-media installer, which uses the Hugging Face sign-in kept by Bhippi.
  const gatedRepo = hfRepoOf(entry.links?.find((link) => /huggingface\.co/.test(link.url))?.url);
  const startDownload = () => {
    if (gated && !hfGranted) {
      return run(() => Promise.reject(new Error('Sign in to Hugging Face and accept this model\'s terms first. The steps are just above.')), 'This model is gated');
    }
    const work = gated && task ? () => api.localMediaInstall(task) : () => libraryApi.download(entry.id, variantId, addonIds);
    // Show "Starting…" at once; the live progress takes over when the job appears.
    setStarting(true);
    window.setTimeout(() => setStarting(false), 15_000);
    return run(work, 'Could not start the download').then((ok) => { if (ok) onChanged(); else setStarting(false); return ok; });
  };
  const accept = async () => {
    const ok = await run(() => libraryApi.acceptLicense(entry.id, territories.length === 0 || territory), 'Could not record your acceptance');
    if (ok) { setGate(false); await startDownload(); }
  };
  const cloud = () => { onTab?.('connectors'); onClose(); };
  const openGate = () => { setGate(true); licenceRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); };

  const footer = (() => {
    if (confirmDelete) {
      return (
        <div className="ml-foot-row" role="alert">
          <span className="ml-foot-text"><strong>Delete {entry.name}?</strong><span>It leaves this PC. You can download it again.</span></span>
          <span className="ml-foot-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>Keep</button>
            <button type="button" className="btn btn-danger" onClick={() => void run(() => libraryApi.delete(entry.id), 'Could not delete').then((ok) => { setConfirmDelete(false); if (ok) onChanged(); })}>Delete</button>
          </span>
        </div>
      );
    }
    if (downloading) {
      return (
        <div className="ml-foot-col" aria-live="polite">
          <div className="ml-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress.fraction * 100)}><i style={{ width: `${Math.round(progress.fraction * 100)}%` }} /></div>
          <div className="ml-foot-row">
            <span className="ml-foot-text ml-nums">
              <strong>{progress.total > 0 ? formatProgress(progress.done, progress.total) : `${Math.round(progress.fraction * 100)}%`}</strong>
              <span>{[progress.speed > 0 ? `${formatBytes(progress.speed)}/s` : null, progress.eta ? `${progress.eta.replace(/^about /, '')} left` : null].filter(Boolean).join(' · ') || 'Starting…'}</span>
            </span>
            <span className="ml-foot-actions">
              <button type="button" className="btn" onClick={() => void run(() => libraryApi.cancel(entry.id, true), 'Could not pause').then(onChanged)}><Pause size={13} /> Pause</button>
              <button type="button" className="btn btn-ghost" onClick={() => void run(() => libraryApi.cancel(entry.id, false), 'Could not cancel').then(onChanged)}>Cancel</button>
            </span>
          </div>
        </div>
      );
    }
    if (status.id === 'queued') {
      return (
        <div className="ml-foot-row" aria-live="polite">
          <span className="ml-foot-text"><strong>{status.label}</strong><span>Starts when the download ahead of it finishes. Model Library → Downloads shows the line.</span></span>
          <span className="ml-foot-actions">
            <button type="button" className="btn" onClick={() => void run(() => libraryApi.moveToTop(entry.id), 'Could not move it up').then(onChanged)}>Download next</button>
            <button type="button" className="btn btn-ghost" onClick={() => void run(() => libraryApi.discard(entry.id), 'Could not remove it').then(onChanged)}>Remove</button>
          </span>
        </div>
      );
    }
    if (gate && needsGate) {
      return (
        <div className="ml-foot-col">
          <div className="ml-gate">
            <strong>Before you download</strong>
            <span>Read the licence summary above, then confirm.</span>
            <label className="ml-check"><input type="checkbox" checked={read} onChange={(event) => setRead(event.target.checked)} /><span>I have read and accept the {entry.license.name}</span></label>
            {territories.length > 0 && (
              <label className="ml-check"><input type="checkbox" checked={territory} onChange={(event) => setTerritory(event.target.checked)} /><span>I am not in {territories.join(', ')}; I will not use the open weights there</span></label>
            )}
          </div>
          <div className="ml-foot-actions end">
            {entry.cloudAlternative && <button type="button" className="btn btn-ghost" onClick={cloud}><Cloud size={13} /> Use the cloud version</button>}
            <button type="button" className="btn btn-ghost" onClick={() => setGate(false)}>Cancel</button>
            <button type="button" className="btn btn-primary" disabled={!read || (territories.length > 0 && !territory)} onClick={() => void accept()}>Accept and download</button>
          </div>
        </div>
      );
    }
    if (installed) {
      return (
        <div className="ml-foot-col">
          <div className="ml-foot-row">
            <span className="ml-foot-text">
              <strong>Downloaded</strong>
              <span className="ml-nums">{[variant && entry.variants.length > 1 ? variant.label : null, bytes > 0 ? `${formatBytes(bytes)} on disk` : null].filter(Boolean).join(' · ') || 'On this PC'}</span>
            </span>
            <button type="button" className="btn btn-ghost ml-icon-btn" onClick={() => setConfirmDelete(true)} aria-label={`Delete ${entry.name}`} title="Delete"><Trash2 size={14} /></button>
          </div>
          <UseToggle view={view} choices={choices} run={run} onChanged={onChanged} className="wide" />
        </div>
      );
    }
    const reason = fit && !fit.diskShort && fit.fit !== 'great' && fit.fit !== 'ok' ? fit.reasons[0] : null;
    return (
      <div className="ml-foot-col">
        <div className="ml-foot-row">
          <span className="ml-foot-text ml-nums">
            <strong>{variant ? `${variant.label}${bytes > 0 ? ` · ${formatBytes(remaining || bytes)}` : ''}` : entry.name}</strong>
            <span className={fit?.diskShort ? 'bad' : undefined}>
              {fit?.diskShort ? fit.reasons[fit.reasons.length - 1] : resumable ? `${formatBytes(state.partialBytes)} already downloaded` : reason ? reason : afterFree != null ? `${formatGb(Math.max(0, afterFree))} free afterwards` : 'Runs on this computer'}
            </span>
          </span>
          <span className="ml-foot-actions">
            {resumable && <button type="button" className="btn btn-ghost" onClick={() => void run(() => libraryApi.cancel(entry.id, false), 'Could not cancel').then(onChanged)}>Discard</button>}
            <button type="button" className="btn btn-primary" disabled={!variant || fit?.diskShort || starting} onClick={() => (needsGate ? openGate() : void startDownload())}>{starting ? <><LoaderCircle size={13} className="spin" /> Starting…</> : resumable ? 'Resume' : 'Download'}</button>
          </span>
        </div>
        {entry.cloudAlternative && <p className="ml-foot-reason">Prefer not to download? <a href="#cloud" onClick={(event) => { event.preventDefault(); cloud(); }}>Use the cloud version</a>.</p>}
      </div>
    );
  })();

  return (
    <aside className="ml-detail" aria-label={`${entry.name} details`}>
      <header className="ml-detail-head">
        <button type="button" className="ml-back btn btn-ghost" onClick={onClose} aria-label="Back"><ArrowLeft size={15} /></button>
        <Thumb view={view} />
        <div className="ml-detail-title">
          <h3>{entry.name}</h3>
          <span>{[entry.maker, category.label].join(' · ')}</span>
        </div>
        <button ref={closeRef} type="button" className="ml-x btn btn-ghost" onClick={onClose} aria-label="Close"><X size={15} /></button>
      </header>

      <div className="ml-detail-body">
        {state.broken && <p className="ml-warn">This model has a problem: {state.broken}. Delete it and download again.</p>}

        <section className="ml-sec">
          <h4>About</h4>
          <p className="ml-desc">{entry.description}</p>
          {tasks.length > 0 && <p className="ml-tasks">{tasks.join('  ·  ')}</p>}
        </section>

        {rows.length > 0 && (
          <section className="ml-sec">
            <h4>What it makes</h4>
            <dl className="ml-facts">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
          </section>
        )}

        {(entry.runtime === 'comfyui' || entry.runtime === 'llama-cpp') && (
          <section className="ml-sec">
            <h4>Runs on</h4>
            {entry.runtime === 'comfyui' && <ComfyEngine view={view} status={comfy} error={comfyError} job={installJob(/comfy/i)} run={run} />}
            {entry.runtime === 'llama-cpp' && <LlmControls view={view} status={llm} job={installJob(/llama|llm/i)} run={run} onChanged={onChanged} />}
          </section>
        )}

        {entry.variants.length > 0 && (
          <section className="ml-sec">
            <h4>{installed ? 'Installed size' : entry.variants.length > 1 ? 'Sizes' : 'Size'}</h4>
            <div className="ml-variants" role="radiogroup" aria-label="Size">
              {entry.variants.map((row) => {
                const rowFit = fitOf(row, hw, { runtime: entry.runtime, freeGb: storage?.freeGb ?? null });
                const selected = row.id === variantId;
                const rowBytes = variantBytes(row);
                const facts = llmFacts(row);
                const locked = installed || downloading;
                return (
                  <label key={row.id} className={`ml-variant${selected ? ' selected' : ''}${locked && !selected ? ' dim' : ''}`}>
                    <input type="radio" name="ml-variant" value={row.id} checked={selected} hidden={entry.variants.length === 1} disabled={locked || entry.variants.length === 1}
                      onChange={() => { chosen.current = true; setVariantId(row.id); }} />
                    <span className="ml-variant-main">
                      <span className="ml-variant-top"><strong>{row.label}</strong>{rowBytes > 0 && <span className="ml-variant-size">{formatBytes(rowBytes)}</span>}</span>
                      {row.detail && <span className="ml-variant-detail">{row.detail}</span>}
                      <span className="ml-variant-meta">
                        <FitDot fit={rowFit} />
                        <span>{[row.minVramGb > 0 ? `${row.minVramGb} GB VRAM` : null, row.minRamGb > 0 ? `${row.minRamGb} GB RAM` : null, facts].filter(Boolean).join(' · ')}</span>
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </section>
        )}

        {(entry.addons?.length ?? 0) > 0 && (
          <section className="ml-sec">
            <h4>Add-ons</h4>
            <div className="ml-variants">
              {entry.addons!.map((addon) => {
                const on = addonIds.includes(addon.id);
                const size = totalBytes({ files: [] }, [addon]);
                return (
                  <label key={addon.id} className={`ml-variant${on ? ' selected' : ''}`}>
                    <input type="checkbox" checked={on} disabled={installed || downloading}
                      onChange={(event) => setAddonIds((ids) => event.target.checked ? [...ids, addon.id] : ids.filter((id) => id !== addon.id))} />
                    <span className="ml-variant-main">
                      <span className="ml-variant-top"><strong>{addon.label}</strong>{size > 0 && <span className="ml-variant-size">{formatBytes(size)}</span>}</span>
                      {addon.detail && <span className="ml-variant-detail">{addon.detail}</span>}
                    </span>
                  </label>
                );
              })}
            </div>
          </section>
        )}

                {!installed && !downloading && gated && <HfSignIn repo={gatedRepo} modelName={entry.name} onAccess={setHfGranted} />}
        {!installed && !downloading && task && <LocalFolderPick task={task} settings={settings} onSettings={onSettings} run={run} />}

        <section className="ml-sec" ref={licenceRef}>
          <h4>Licence</h4>
          <p className="ml-lic-name">{entry.license.name}</p>
          <ul className="ml-license">{entry.license.summary.map((line) => <li key={line}>{line}</li>)}</ul>
          {entry.license.notice && <p className="ml-faint">{entry.license.notice}</p>}
          <p className="ml-links"><a href={entry.license.url} onClick={external(entry.license.url)}><ExternalLink size={12} /> Full licence text</a>{entry.license.applyUrl && <a href={entry.license.applyUrl} onClick={external(entry.license.applyUrl)}><ExternalLink size={12} /> Apply for a licence</a>}</p>
        </section>

        {((entry.links?.length ?? 0) > 0 || entry.thumbnail?.credit) && (
          <section className="ml-sec">
            <h4>Links</h4>
            {(entry.links?.length ?? 0) > 0 && <p className="ml-links">{entry.links!.map((link) => <a key={link.url} href={link.url} onClick={external(link.url)}><ExternalLink size={12} /> {link.label}</a>)}</p>}
            {entry.thumbnail?.credit && <p className="ml-faint">Picture: {entry.thumbnail.credit}</p>}
          </section>
        )}
      </div>

      <footer className="ml-detail-foot">{footer}</footer>
    </aside>
  );
}
