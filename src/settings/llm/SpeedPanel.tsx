// What a downloaded or running local model shows about its speed: the live writing and reading
// speeds, the speed-ups that are on, and "Tune for this PC" with its progress and result. Everything
// shown is a measurement from this PC; nothing is promised beyond it.
import { Gauge, LoaderCircle, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, errorText } from '../../lib/ipc';
import { useLiveJobs } from '../../lib/jobsStore';
import { liveSpeedText, speedupsText, tuneJobFor, tunedText } from '../../lib/llmSpeed';
import { libraryApi, type LibraryView, type LlmRunning, type LlmTuning } from '../../lib/modelLibrary';

/** How often the live speeds are refreshed while a model runs and its page is open. */
const REFRESH_MS = 6000;

/** The running model with speeds that keep up with its real use (the server reports them after each reply). */
export function useRunningSpeeds(initial: LlmRunning | null): LlmRunning | null {
  const [running, setRunning] = useState<LlmRunning | null>(initial);
  const key = initial ? `${initial.modelId}|${initial.port}` : '';
  useEffect(() => {
    setRunning(initial);
    if (!initial) return undefined;
    let live = true;
    const timer = window.setInterval(() => {
      libraryApi.llmStatus().then((status) => { if (live && status.running && status.running.port === initial.port) setRunning(status.running); }).catch(() => undefined);
    }, REFRESH_MS);
    return () => { live = false; window.clearInterval(timer); };
    // The status object is replaced on every refresh; only a different server restarts the timer.
  }, [key]);
  return running ?? initial;
}

/** "Writing 38 words/s · Reading 1,450 tokens/s" and the "Speed-ups on" line of a running model. */
export function RunningSpeeds({ running }: { running: LlmRunning }) {
  const live = useRunningSpeeds(running) ?? running;
  const speeds = liveSpeedText(live);
  const ups = speedupsText(live);
  if (!speeds && !ups) return null;
  return (
    <div className="ml-speed" aria-live="polite">
      {speeds && <span className="ml-speed-live">{speeds}</span>}
      {ups && <span className="ml-speed-ups">{ups}{live.tuned ? ' · tuned for this PC' : ''}</span>}
    </div>
  );
}

/** "Tune for this PC" for a downloaded model: the button, progress while it measures, and the result. */
export function TuneControls({ view, runtimeInstalled, onChanged }: { view: LibraryView; runtimeInstalled: boolean; onChanged?: () => void }) {
  const jobs = useLiveJobs();
  const job = tuneJobFor(jobs, view.entry.name);
  const [tuning, setTuning] = useState<LlmTuning | null>(null);
  const [problem, setProblem] = useState('');
  const [starting, setStarting] = useState(false);
  const status = job?.status ?? 'none';
  const installed = !!view.state.installedVariant && !view.state.broken;

  useEffect(() => {
    if (!installed) { setTuning(null); return undefined; }
    let live = true;
    libraryApi.llmTuning(view.entry.id).then((found) => { if (live) setTuning(found); }).catch(() => { if (live) setTuning(null); });
    return () => { live = false; };
  }, [view.entry.id, installed, view.state.installedVariant, status]);

  if (!installed || view.entry.runtime !== 'llama-cpp' || view.entry.source === 'huggingface') return null;
  const busy = status === 'running' || starting;
  const tune = async () => {
    setStarting(true);
    setProblem('');
    try {
      await libraryApi.llmTune(view.entry.id, view.state.installedVariant ?? undefined);
      onChanged?.();
    } catch (error) {
      setProblem(errorText(error));
    } finally {
      setStarting(false);
    }
  };
  return (
    <div className="ml-tune">
      <div className="ml-tune-row">
        <button type="button" className="btn btn-small" disabled={busy || !runtimeInstalled} onClick={() => void tune()} title="Measures this model on your PC and keeps the fastest settings. It takes a few minutes and stops the model while it measures.">
          {busy ? <LoaderCircle size={12} className="spin" /> : <Gauge size={12} />} {tuning ? 'Tune again' : 'Tune for this PC'}
        </button>
        {tuning && !busy && <span className="ml-tune-result" title={tuning.notes.join('\n')}>{tunedText(tuning)}</span>}
        {!tuning && !busy && <span className="ml-tune-hint">Takes a few minutes. Stops the model while it measures.</span>}
      </div>
      {status === 'running' && job && (
        <div className="model-progress">
          <div className="model-bar"><i style={{ width: `${Math.round(job.progress * 100)}%` }} /></div>
          <span className="muted small">
            {job.message}
            {job.cancellable && <button type="button" className="lb-icon-btn" title="Stop tuning" aria-label="Stop tuning" onClick={() => void api.jobCancel(job.id)}><X size={12} /></button>}
          </span>
        </div>
      )}
      {status === 'error' && job && !busy && <p className="ml-tune-hint bad">{job.message}</p>}
      {problem && <p className="ml-tune-hint bad">{problem}</p>}
    </div>
  );
}
