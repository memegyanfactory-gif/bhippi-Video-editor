// "In use": the AI selection. One row per job Bhippi's AI does with a local model, showing the
// model it reaches for, a quiet picker over what is downloaded, and one plain sentence on what that
// means right now. Language models also show their start / stop controls here.
import { TriangleAlert } from 'lucide-react';
import { useLiveJobs } from '../../lib/jobsStore';
import { variantBytes, formatBytes } from '../../lib/modelFit';
import { libraryApi, type CapabilityChoice, type LibraryView } from '../../lib/modelLibrary';
import { jobSummary } from '../../lib/modelUse';
import { ComfyEngine, LlmControls } from '../ModelEngine';
import { CATEGORIES, CATEGORY_BY_CAPABILITY, Thumb } from '../libraryShared';
import type { LibraryContext } from './shared';

const keyOf = (modelId: string | null, variant: string | null) => (modelId ? `${modelId}|${variant ?? ''}` : '');

function Row({ choice, ctx }: { choice: CapabilityChoice; ctx: LibraryContext }) {
  const jobs = useLiveJobs();
  const category = CATEGORY_BY_CAPABILITY[choice.capability];
  const Icon = category.icon;
  const view: LibraryView | undefined = choice.modelId ? ctx.views.find((row) => row.entry.id === choice.modelId) : undefined;
  const variant = view?.entry.variants.find((row) => row.id === (choice.variant ?? view.state.installedVariant));
  const bytes = variant ? variantBytes(variant) : 0;
  const meta = [view?.entry.maker, variant && view && view.entry.variants.length > 1 ? variant.label : null, bytes > 0 ? formatBytes(bytes) : null].filter(Boolean).join(' · ');
  const current = keyOf(choice.modelId, choice.variant);
  const known = choice.candidates.some((row) => keyOf(row.modelId, row.variant) === current);
  const chosenName = choice.modelId ? (choice.candidates.find((row) => keyOf(row.modelId, row.variant) === current)?.name ?? view?.entry.name ?? choice.modelId) : null;
  const summary = jobSummary(choice.capability, chosenName);
  const nothingDownloaded = choice.candidates.length === 0;
  const installJob = (pattern: RegExp) => jobs.find((row) => row.kind === 'install' && row.status === 'running' && pattern.test(row.label));

  const change = (value: string) => {
    const [modelId, variantId] = value ? value.split('|') : [null, ''];
    void ctx.run(() => libraryApi.setDefault(choice.capability, modelId, variantId || null), 'Could not change that').then(ctx.refresh);
  };

  return (
    <section className={`ml-use-row${summary.on ? ' is-on' : ' is-none'}`} aria-label={category.label}>
      <header className="ml-use-head">
        <span className="ml-use-job"><Icon size={15} />{category.label}</span>
        <label className="ml-select">
          <span className="ml-sr">Model used for {category.label}</span>
          <select value={current} onChange={(event) => change(event.target.value)} disabled={nothingDownloaded && !current}>
            <option value="">None</option>
            {!known && choice.modelId && <option value={current}>{view?.entry.name ?? choice.modelId}</option>}
            {choice.candidates.map((row) => (
              <option key={keyOf(row.modelId, row.variant)} value={keyOf(row.modelId, row.variant)}>{row.name}{row.variantLabel ? ` · ${row.variantLabel}` : ''}</option>
            ))}
          </select>
        </label>
      </header>

      <div className="ml-use-state">
        <span className={`ml-state ${summary.on ? 'on' : 'none'}`}><i aria-hidden="true" />{summary.text}</span>
        {nothingDownloaded && !summary.on && (
          <button type="button" className="ml-link-btn" onClick={() => ctx.goto(category.id)}>Download one</button>
        )}
      </div>

      {view && (
        <button type="button" className="ml-use-model" onClick={() => ctx.open(view.entry.id)} title="Open details">
          <Thumb view={view} />
          <span className="ml-use-model-text">
            <strong>{view.entry.name}</strong>
            {meta && <span>{meta}</span>}
          </span>
        </button>
      )}

      {choice.note && <p className="ml-use-note">{choice.note}</p>}

      {view && choice.capability === 'llm' && (
        <LlmControls view={view} status={ctx.llm} job={installJob(/llama|llm/i)} run={ctx.run} onChanged={ctx.refresh} variant={choice.variant} />
      )}
      {view && view.entry.runtime === 'comfyui' && (
        <ComfyEngine view={view} status={ctx.comfy} error={ctx.comfyError} job={installJob(/comfy/i)} run={ctx.run} />
      )}
    </section>
  );
}

export function InUsePage({ ctx }: { ctx: LibraryContext }) {
  const order = CATEGORIES.map((row) => row.capability);
  const rows = [...ctx.defaults].sort((a, b) => order.indexOf(a.capability) - order.indexOf(b.capability));
  return (
    <div className="ml-use">
      {ctx.defaultsGuessed && (
        <p className="ml-inline-note"><TriangleAlert size={13} /> Could not read which models the AI uses, so this shows what is downloaded.</p>
      )}
      {rows.map((choice) => <Row key={choice.capability} choice={choice} ctx={ctx} />)}
    </div>
  );
}
