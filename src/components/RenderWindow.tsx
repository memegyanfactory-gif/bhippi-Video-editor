// The export's render window: every stage with its own tick, the clip being rendered, a live
// picture of the frame just rendered, frames done, speed, time left, and Cancel. It follows the
// FFmpeg encode job to the end and offers Open / Show in folder. "Run in background" collapses it
// to a small pill; the render keeps going.
import { CheckCircle2, Circle, Film, FolderOpen, Loader2, Minimize2, Play, X, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api, fileSrc } from '../lib/ipc';
import { jobsStore } from '../lib/jobsStore';
import { overallProgress, renderProgress, useRenderProgress, type RenderStage } from '../lib/renderProgress';

const STAGE_LABEL: Record<RenderStage, string> = {
  graphics: 'Motion graphics',
  scenes: 'Motion scenes (GPU)',
  encoding: 'Encoding video',
};

const clock = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const s = Math.round(seconds);
  return s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function RenderWindow() {
  const s = useRenderProgress();
  const rate = useRef<{ at: number; frames: number; fps: number }>({ at: 0, frames: 0, fps: 0 });
  // The encode itself, frame by frame: FFmpeg writes a small JPEG each second of video beside the
  // export, so the window shows the render moving from the first second to the last.
  const [encoded, setEncoded] = useState<{ src: string; second: number } | null>(null);
  useEffect(() => {
    if (!s.jobId || s.stage !== 'encoding' || s.status !== 'running') return;
    const job = s.jobId;
    let stopped = false;
    const poll = () => void api.exportPreview(job).then((path) => {
      if (stopped || !path) return;
      const second = Number(/preview_(\d+)\.jpg$/.exec(path)?.[1] ?? 0);
      setEncoded((current) => (current?.second === second ? current : { src: fileSrc(path), second }));
    }).catch(() => undefined);
    poll();
    const timer = setInterval(poll, 700);
    return () => { stopped = true; clearInterval(timer); };
  }, [s.jobId, s.stage, s.status]);
  useEffect(() => { if (!s.open) setEncoded(null); }, [s.open]);
  useEffect(() => { setEncoded(null); }, [s.startedAt]);

  // Follow the FFmpeg job once the export hands over to it.
  useEffect(() => {
    if (!s.jobId || s.status !== 'running') return;
    const check = () => {
      const job = jobsStore.get(s.jobId!);
      if (!job) return;
      renderProgress.encodeProgress(job.progress, job.message);
      if (job.status === 'done') renderProgress.finish('done', { output: job.result?.path ?? null });
      else if (job.status === 'error') renderProgress.finish('error', { error: job.message || 'The encoder failed.' });
      else if (job.status === 'cancelled') renderProgress.finish('cancelled');
    };
    check();
    return jobsStore.subscribe(check);
  }, [s.jobId, s.status]);

  if (!s.open) return null;
  const overall = overallProgress(s);
  const now = performance.now();
  const elapsed = (now - s.startedAt) / 1000;
  // Frames per second over the last stretch (smoothed), for the pre-render stages.
  if (s.stage !== 'encoding') {
    const r = rate.current;
    if (now - r.at > 700) {
      const fps = r.at ? (s.doneFrames - r.frames) / ((now - r.at) / 1000) : 0;
      rate.current = { at: now, frames: s.doneFrames, fps: r.fps ? r.fps * 0.6 + fps * 0.4 : fps };
    }
  }
  const eta = overall > 0.02 ? (elapsed / overall) * (1 - overall) : NaN;
  const running = s.status === 'running';
  // Cancelled a while ago and still not stopped: the window may be closed regardless.
  const closable = !running || s.abandoned;

  if (s.minimized && running) {
    return (
      <button type="button" className="render-pill" onClick={() => renderProgress.minimize(false)} title="Show the render window">
        <Loader2 size={13} className="spin" /> Rendering {Math.round(overall * 100)}% · {clock(eta)} left
        <i style={{ width: `${overall * 100}%` }} />
      </button>
    );
  }

  const stageState = (stage: RenderStage) => {
    const index = s.stages.indexOf(stage);
    const current = s.stages.indexOf(s.stage);
    if (s.status === 'done' || index < current) return 'done';
    if (index === current) return s.status === 'running' ? 'active' : s.status;
    return 'waiting';
  };

  return (
    <div className="modal-backdrop render-backdrop">
      <div className="modal render-window" role="dialog" aria-label="Rendering">
        <div className="modal-head">
          <h2><Film size={14} /> {running ? 'Rendering' : s.status === 'done' ? 'Export finished' : s.status === 'cancelled' ? 'Render cancelled' : 'Render failed'}</h2>
          <div className="render-head-actions">
            {running && <button type="button" className="icon-btn" title="Run in background" onClick={() => renderProgress.minimize(true)}><Minimize2 size={14} /></button>}
            {closable && <button type="button" className="icon-btn" title="Close" onClick={() => renderProgress.close()}><X size={14} /></button>}
          </div>
        </div>
        <div className="modal-body render-body">
          <div className="render-preview">
            {s.stage === 'encoding' && encoded ? <img src={encoded.src} alt="The frame being encoded" />
              : s.stage !== 'encoding' && s.preview ? <img src={s.preview} alt="The frame being rendered" />
              : <div className="render-preview-empty">{s.stage === 'encoding' ? 'Encoding with FFmpeg…' : 'Preparing the first frame…'}</div>}
            {running && s.stage !== 'encoding' && <span className="render-preview-tag">frame {s.frame}/{s.frames}</span>}
            {running && s.stage === 'encoding' && encoded && <span className="render-preview-tag">encoding {clock(encoded.second)}</span>}
          </div>
          <div className="render-info">
            <div className="render-overall">
              <div className="render-percent">{Math.round(overall * 100)}%</div>
              <div className="render-bar"><i style={{ width: `${overall * 100}%` }} className={s.status === 'error' ? 'bad' : ''} /></div>
              <div className="render-times">
                <span>Elapsed {clock(elapsed)}</span>
                {running && <span>Left ~{clock(eta)}</span>}
                {running && s.stage !== 'encoding' && rate.current.fps > 0 && <span>{rate.current.fps.toFixed(1)} fps</span>}
              </div>
            </div>
            <ol className="render-stages">
              {s.stages.map((stage) => {
                const st = stageState(stage);
                return (
                  <li key={stage} className={`render-stage ${st}`}>
                    {st === 'done' ? <CheckCircle2 size={14} /> : st === 'active' ? <Loader2 size={14} className="spin" /> : st === 'error' ? <XCircle size={14} /> : <Circle size={14} />}
                    <span className="render-stage-name">{STAGE_LABEL[stage]}</span>
                    {st === 'active' && stage !== 'encoding' && <span className="render-stage-detail">{s.item} ({s.itemIndex}/{s.itemCount}) · {s.frame}/{s.frames} frames</span>}
                    {st === 'active' && stage === 'encoding' && <span className="render-stage-detail">{Math.round(s.encode * 100)}%{s.encodeMessage ? ` · ${s.encodeMessage}` : ''}</span>}
                  </li>
                );
              })}
            </ol>
            {s.stage !== 'encoding' && running && (
              <div className="render-item-bar"><i style={{ width: `${s.frames ? (s.frame / s.frames) * 100 : 0}%` }} /></div>
            )}
            {running && s.stall && <div className="render-error render-stall" role="status">{s.stall}</div>}
            {running && s.abandoned && <div className="render-error" role="status">The render did not stop after Cancel. You can close this window.</div>}
            {s.error && <div className="render-error" role="alert">{s.error}</div>}
            {s.output && s.status === 'done' && <div className="render-output" title={s.output}>{s.output.split(/[\\/]/).pop()}</div>}
            <div className="render-actions">
              {running && <button type="button" className="btn" onClick={() => { renderProgress.cancel(); if (s.jobId) void api.jobCancel(s.jobId); }}><X size={12} /> Cancel</button>}
              {running && <button type="button" className="btn btn-ghost" onClick={() => renderProgress.minimize(true)}><Minimize2 size={12} /> Run in background</button>}
              {s.status === 'done' && s.output && <button type="button" className="btn btn-primary" onClick={() => void api.openPath(s.output!)}><Play size={12} /> Open</button>}
              {s.status === 'done' && s.output && <button type="button" className="btn" onClick={() => void api.revealPath(s.output!)}><FolderOpen size={12} /> Show in folder</button>}
              {closable && <button type="button" className="btn btn-ghost" onClick={() => renderProgress.close()}>Close</button>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
