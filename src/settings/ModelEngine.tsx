// The engines models run on, shown inside a model's panel: the ComfyUI engine for generation
// models, and the llama.cpp runtime for local LLMs, with the plan preview that says how an LLM
// will be split between the GPU and system RAM before anything starts.
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { CircleStop, Download, FolderOpen, LoaderCircle, Play, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { errorText } from '../lib/ipc';
import { libraryApi, type ComfyStatus, type LibraryView, type LlmPlan, type LlmRuntimeStatus } from '../lib/modelLibrary';
import type { Job } from '../lib/types';
import { DownloadProgress } from './DownloadProgress';
import { RunningSpeeds, TuneControls } from './llm/SpeedPanel';
import { StrataStartConfirm } from './llm/StrataPanel';

type Run = (work: () => Promise<unknown>, failure: string) => Promise<boolean>;

const comfyHeadline = (status: ComfyStatus): string => {
  if (status.source === 'external') return status.running ? `Your ComfyUI is running at ${status.url ?? 'your address'}` : `Your ComfyUI${status.url ? ` at ${status.url}` : ''}: stopped`;
  if (!status.installed) return 'ComfyUI engine: not installed';
  return status.running ? 'ComfyUI engine: running' : 'ComfyUI engine: installed, stopped';
};

/** ComfyUI status with Install / Start / Stop and "use my own ComfyUI", plus any nodes this ComfyUI lacks. */
export function ComfyEngine({ view, status, job, run, error }: { /** Optional: only names the model in the "too old" warning. */ view?: LibraryView; status: ComfyStatus | null; job: Job | undefined; run: Run; error: string }) {
  const [own, setOwn] = useState(false);
  const [target, setTarget] = useState('');
  const installing = !!job && job.status === 'running';
  if (!status) return <div className="ml-engine"><span className="ml-engine-line">{error ? `ComfyUI engine: ${error}` : 'ComfyUI engine: checking…'}</span></div>;
  const browse = async () => {
    const picked = await openDialog({ directory: true, title: 'Your ComfyUI folder' });
    if (typeof picked === 'string') setTarget(picked);
  };
  return (
    <div className={`ml-engine${status.running ? ' running' : ''}`}>
      <div className="ml-engine-row">
        <span className="ml-engine-dot" aria-hidden="true" />
        <div className="ml-engine-text">
          <strong>{comfyHeadline(status)}</strong>
          {status.message && <span>{status.message}</span>}
        </div>
        <div className="ml-engine-actions">
          {!status.installed && status.source !== 'external' && <button type="button" className="btn btn-small btn-primary" disabled={installing} onClick={() => void run(() => libraryApi.comfyInstall(), 'Could not install ComfyUI')}><Download size={12} /> Install</button>}
          {status.installed && !status.running && <button type="button" className="btn btn-small" onClick={() => void run(() => libraryApi.comfyStart(), 'Could not start ComfyUI')}><Play size={12} /> Start</button>}
          {status.running && <button type="button" className="btn btn-small" onClick={() => void run(() => libraryApi.comfyStop(), 'Could not stop ComfyUI')}><CircleStop size={12} /> Stop</button>}
          {status.source === 'external'
            ? <button type="button" className="btn btn-small btn-ghost" onClick={() => void run(() => libraryApi.comfyUseExternal(null), 'Could not switch back')}>Use Bhippi’s</button>
            : <button type="button" className="btn btn-small btn-ghost" aria-expanded={own} onClick={() => setOwn((value) => !value)}>Use my own ComfyUI…</button>}
        </div>
      </div>
      {installing && job && <DownloadProgress job={job} />}
      {own && (
        <div className="ml-engine-own">
          <input value={target} onChange={(event) => setTarget(event.target.value)} placeholder="A ComfyUI folder, or an address like http://127.0.0.1:8188" spellCheck={false} aria-label="Your ComfyUI folder or address" />
          <button type="button" className="btn btn-small" onClick={() => void browse()}><FolderOpen size={12} /> Browse</button>
          <button type="button" className="btn btn-small btn-primary" disabled={!target.trim()} onClick={() => void run(() => libraryApi.comfyUseExternal(target.trim()), 'Could not use that ComfyUI').then((ok) => ok && setOwn(false))}>Use it</button>
        </div>
      )}
      {status.missingNodes.length > 0 && (
        <p className="ml-warn"><TriangleAlert size={13} /> Your ComfyUI is too old for {view?.entry.name ?? 'the models here'}: update it, or use Bhippi’s. Missing: {status.missingNodes.join(', ')}.</p>
      )}
    </div>
  );
}

const VERDICT: Record<LlmPlan['verdict'], { text: string; tone: string }> = {
  great: { text: 'Runs well on this PC', tone: 'ok' },
  ok: { text: 'Runs fine on this PC', tone: 'ok' },
  slow: { text: 'Will run, but slowly', tone: 'warn' },
  no: { text: 'Too big for this PC', tone: 'bad' },
};

/** Context lengths as people say them: 32768 -> "32K". */
const contextText = (tokens: number) => (tokens >= 1024 ? `${Math.round(tokens / 1024)}K` : String(tokens));

/** A plan in words: the verdict, where the weights go, the context and the speed. */
export function PlanPreview({ plan }: { plan: LlmPlan }) {
  const verdict = VERDICT[plan.verdict];
  const words = plan.estTokensPerSecond ? plan.estTokensPerSecond.map((tps) => Math.max(1, Math.round(tps * 0.75))) : null;
  return (
    <div className="ml-plan">
      <span className={`ml-fit tone-${verdict.tone}`}><i aria-hidden="true" />{verdict.text}</span>
      <ul>
        <li>{plan.cpuMoeBlocks > 0 ? `Experts of ${plan.cpuMoeBlocks} blocks stay in system RAM; the rest runs on the GPU.` : 'The whole model fits on the GPU.'}</li>
        <li>Uses about {plan.vramGb.toFixed(1)} GB of VRAM and {plan.ramGb.toFixed(1)} GB of system RAM.</li>
        <li>Remembers {contextText(plan.contextTokens)} tokens of conversation.</li>
        <li>{words ? `About ${words[0]}–${words[1]} words per second.` : 'Speed cannot be estimated on this PC.'}</li>
      </ul>
      {plan.note && <p className="ml-plan-note">{plan.note}</p>}
    </div>
  );
}

/** Runtime install, the Start preview, Start / Stop and the running state for one local LLM. A Strata model (`variant`: the size in use) needs no llama.cpp and asks before it loads. */
export function LlmControls({ view, status, job, run, onChanged, variant }: { view: LibraryView; status: LlmRuntimeStatus | null; job: Job | undefined; run: Run; onChanged: () => void; variant?: string | null }) {
  const strata = view.entry.runtime === 'strata';
  const [confirming, setConfirming] = useState(false);
  const [plan, setPlan] = useState<LlmPlan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [problem, setProblem] = useState('');
  const installed = !!view.state.installedVariant && !view.state.broken;
  const running = status?.running?.modelId === view.entry.id ? status.running : null;
  const installing = !!job && job.status === 'running';

  const preview = async () => {
    setPlanning(true);
    setProblem('');
    try {
      setPlan((await libraryApi.llmStart(view.entry.id, { dryRun: true })).plan);
    } catch (error) {
      setProblem(errorText(error));
    } finally {
      setPlanning(false);
    }
  };

  if (!status) return null;
  return (
    <div className="ml-engine llm">
      <div className="ml-engine-row">
        <span className="ml-engine-dot" aria-hidden="true" />
        <div className="ml-engine-text">
          <strong>{strata ? (running ? `${view.entry.name} is running` : status.running ? 'Another local model is running' : 'Runs through Strata') : !status.installed ? 'Local LLM runtime: not installed' : running ? `${view.entry.name} is running` : status.running ? 'Another local model is running' : 'Local LLM runtime: installed, nothing running'}</strong>
          {running
            ? <span>It is now available as a chat provider in Bhippi’s chat. {running.gpuLayersNote}</span>
            : <span>{strata ? 'Strata is the engine made for this model. It runs on this PC and nothing is uploaded.' : status.message || 'Models run through llama.cpp on this PC. Nothing is uploaded.'}</span>}
        </div>
        <div className="ml-engine-actions">
          {!strata && (!status.installed || status.updateAvailable) && !status.running && <button type="button" className="btn btn-small btn-primary" disabled={installing} onClick={() => void run(() => libraryApi.llmInstall(), status.installed ? 'Could not update the runtime' : 'Could not install the runtime')}><Download size={12} /> {status.installed ? 'Update runtime' : 'Install runtime'}</button>}
          {strata && installed && !running && !confirming && <button type="button" className="btn btn-small btn-primary" onClick={() => setConfirming(true)}><Play size={12} /> Start</button>}
          {!strata && status.installed && installed && !running && !plan && <button type="button" className="btn btn-small btn-primary" disabled={planning} onClick={() => void preview()}>{planning ? <LoaderCircle size={12} className="spin" /> : <Play size={12} />} Start</button>}
          {status.running && <button type="button" className="btn btn-small" onClick={() => void run(() => libraryApi.llmStop(), 'Could not stop the model').then(onChanged)}><CircleStop size={12} /> Stop</button>}
        </div>
      </div>
      {installing && job && <DownloadProgress job={job} />}
      {running && <RunningSpeeds running={running} />}
      {!strata && installed && <TuneControls view={view} runtimeInstalled={status.installed} onChanged={onChanged} />}
      {problem && <p className="ml-warn"><TriangleAlert size={13} /> {problem}</p>}
      {strata && confirming && !running && (
        <StrataStartConfirm
          name={view.entry.name}
          busy={false}
          onCancel={() => setConfirming(false)}
          onStart={() => void run(() => libraryApi.llmStart(view.entry.id, variant ? { variant } : {}), 'Could not start the model').then((ok) => { if (ok) { setConfirming(false); onChanged(); } })}
        />
      )}
      {plan && !running && (
        <>
          <PlanPreview plan={plan} />
          <div className="ml-engine-actions end">
            <button type="button" className="btn btn-small btn-ghost" onClick={() => setPlan(null)}>Not now</button>
            <button type="button" className="btn btn-small btn-primary" disabled={plan.verdict === 'no'} onClick={() => void run(() => libraryApi.llmStart(view.entry.id), 'Could not start the model').then((ok) => { if (ok) { setPlan(null); onChanged(); } })}><Play size={12} /> Start</button>
          </div>
        </>
      )}
    </div>
  );
}
