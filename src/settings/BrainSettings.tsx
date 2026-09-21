import { Brain, FolderOpen, LoaderCircle, RefreshCw, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Toggle, useToast } from '../components/ui';
import { api, errorText } from '../lib/ipc';
import type { BrainStatus } from '../lib/ideagraph';
import type { Settings } from '../lib/types';

type Props = { settings: Settings; onSettings: (settings: Settings) => void };

/**
 * The IdeaGraph brain panel: where the `ig` CLI lives, where the brain repo
 * lives, whether turns are recorded, and what the brain currently knows —
 * node status, coverage gaps steering the next turns, and the review queue.
 */
export function BrainSettings({ settings, onSettings }: Props) {
  const toast = useToast();
  const [bin, setBin] = useState(settings.ideagraphBin ?? '');
  const [brain, setBrain] = useState(settings.ideagraphBrain ?? '');
  const [report, setReport] = useState<BrainStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      setReport(await api.ideagraphStatus());
    } catch (error) {
      setReport(null);
      toast({ tone: 'error', title: 'Brain is not reachable', body: `${errorText(error)} — install it with: pip install ideagraph-live` });
    } finally {
      setLoading(false);
    }
  };

  // Refresh once on open; the Refresh button re-runs it on demand.
  useEffect(() => {
    void refresh();
  }, []);

  const savePaths = () => {
    onSettings({ ...settings, ideagraphBin: bin.trim() || null, ideagraphBrain: brain.trim() || null });
    toast({ tone: 'success', title: 'Brain paths saved' });
  };

  const init = async () => {
    setInitializing(true);
    try {
      const message = await api.ideagraphInit();
      toast({ tone: 'success', title: 'Brain ready', body: message });
      await refresh();
    } catch (error) {
      toast({ tone: 'error', title: 'Could not init the brain', body: errorText(error) });
    } finally {
      setInitializing(false);
    }
  };

  const gaps = report?.gaps?.gaps ?? [];
  return (
    <div className="brain-settings">
      <div className="settings-intro">
        <div>
          <h3><Brain size={14} /> IdeaGraph brain</h3>
          <p>A self-improving knowledge graph (Ingest → Embed → Suggest → Visualize) backed by your own private git repo. Helios records each AI turn&apos;s tool outcomes as episodic nodes, and the coverage gaps steer what gets researched next.</p>
        </div>
        <button type="button" className="btn" onClick={() => void refresh()} disabled={loading}>
          {loading ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />} Refresh
        </button>
      </div>
      <label className="field">
        <span>Brain repo path (empty = the engine default, ~/ideagraph-brain)</span>
        <div className="field-inline">
          <input value={brain} onChange={(event) => setBrain(event.target.value)} placeholder="~/ideagraph-brain" spellCheck={false} />
          <button type="button" className="btn" onClick={() => void init()} disabled={initializing}>{initializing ? <LoaderCircle size={14} className="spin" /> : <Sparkles size={14} />} Init brain</button>
        </div>
      </label>
      <label className="field">
        <span>`ig` command (empty = `ig` on PATH)</span>
        <div className="field-inline">
          <input value={bin} onChange={(event) => setBin(event.target.value)} placeholder="ig" spellCheck={false} />
          <button type="button" className="btn btn-primary" onClick={savePaths}>Save</button>
        </div>
      </label>
      <label className="provider-auto-update">
        <Toggle checked={settings.ideagraphRecord ?? false} onChange={(on) => onSettings({ ...settings, ideagraphRecord: on })} label="Record AI turn outcomes" />
        <span className="muted small">Each finished turn is ingested as one compact note: prompt, tools used with success/failure and durations, workflow verification.</span>
      </label>
      {report ? (
        <>
          <h4>Status</h4>
          <pre className="brain-report">{report.status || 'The brain answered with nothing.'}</pre>
          {!!gaps.length && (
            <>
              <h4>Coverage gaps (what to research next)</h4>
              <ul className="brain-gaps">{gaps.map((gap) => <li key={gap}>{gap}</li>)}</ul>
            </>
          )}
          {!!report.pending.trim() && report.pending.trim() !== 'No pending suggestions.' && (
            <>
              <h4>Pending review</h4>
              <pre className="brain-report">{report.pending}</pre>
            </>
          )}
        </>
      ) : (
        <p className="muted"><FolderOpen size={13} /> {loading ? 'Asking the brain…' : 'No brain connected yet — set the paths above, press Init brain, then Refresh.'}</p>
      )}
    </div>
  );
}
