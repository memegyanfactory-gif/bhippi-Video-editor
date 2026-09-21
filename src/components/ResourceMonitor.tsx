import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Job } from '../lib/types';
import type { ToolRun } from '../chat/Activity';

type Usage = { cpuPercent: number; ramUsedGb: number; ramTotalGb: number; diskFreeGb: number; diskTotalGb: number; drive: string; processes: { name: string; pid: number; ramGb: number }[] };
export function ResourceMonitor({ jobs, runs }: { jobs: Job[]; runs: ToolRun[] }) {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);
  const [updated, setUpdated] = useState('');
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const value = await invoke<Usage>('resource_usage'); if (!stopped) { setUsage(value); setError(false); setUpdated(new Date().toLocaleTimeString()); } }
      catch { if (!stopped) setError(true); }
      if (!stopped) timer = setTimeout(poll, 5000);
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, []);
  const activeJobs = jobs.filter(job => job.status === 'running');
  const activeRuns = runs.filter(run => run.status === 'running');
  return <div className="resource-monitor">
    <button type="button" className="resource-toggle" aria-expanded={open} onClick={() => setOpen(!open)} title="Live system usage and Helios activity">
      {error ? 'Usage unavailable' : usage ? `CPU ${usage.cpuPercent}% · RAM ${usage.ramUsedGb}/${usage.ramTotalGb} GB · ${usage.diskFreeGb} GB free` : 'Reading usage…'}
    </button>
    {open && <section className="resource-details" aria-label="Resource usage details">
      <div className="resource-heading"><strong>System & Helios activity</strong><button onClick={() => setOpen(false)} aria-label="Close usage details">×</button></div>
      <p>{error ? 'Refresh failed. Last measurements may be stale.' : `Live · updated ${updated || 'pending'} · refreshes every 5 seconds`}</p>
      {usage && <><p>System CPU: {usage.cpuPercent}% · Memory: {usage.ramUsedGb} / {usage.ramTotalGb} GB</p><p>Model drive {usage.drive}: {usage.diskFreeGb} GB free / {usage.diskTotalGb} GB total</p>
        <strong>Helios processes · memory</strong>{usage.processes.map(p => <div className="resource-row" key={p.pid}><span>{p.name} · PID {p.pid}</span><span>{p.ramGb.toFixed(3)} GB</span></div>)}</>}
      <strong>Running tools ({activeRuns.length})</strong>
      {!activeRuns.length && <p>No tool currently running</p>}
      {activeRuns.map(run => <div className="resource-task" key={run.callId}><b>{run.name.replace(/_/g, ' ')}</b><p>{run.request}</p></div>)}
      <strong>Background jobs ({activeJobs.length})</strong>
      {!activeJobs.length && <p>No app-managed job currently running</p>}
      {activeJobs.map(job => <div className="resource-task" key={job.id}><b>{job.label} · {Math.round(job.progress * 100)}%</b><p>{job.message}</p></div>)}
      <p>CPU and memory totals include the whole computer. Process memory is shown separately; shared in-app tools do not have independent memory measurements.</p>
    </section>}
  </div>;
}
