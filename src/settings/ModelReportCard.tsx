import { AlertTriangle, ChevronDown, ChevronRight, LoaderCircle, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorText, events } from '../lib/ipc';
import { faultSummary, formatPercent, phaseLabel, rowKey, sortByRecentUse, unsuitableRows, type ModelReportRow } from './modelReport';
import { Section } from './SettingsLayout';

const REFRESH_GAP_MS = 4000;

const ago = (ms: number) => {
  if (!ms) return '';
  const minutes = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (minutes < 60) return `${minutes || 1}m ago`;
  if (minutes < 60 * 48) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1440)}d ago`;
};

/** Settings → Brain → Model report card: which AI models actually succeed here, from the turn traces. */
export function ModelReportCard() {
  const [rows, setRows] = useState<ModelReportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const last = useRef(0);
  const timer = useRef<number | null>(null);

  const load = useCallback(async () => {
    last.current = Date.now();
    setBusy(true);
    try {
      setRows(sortByRecentUse(await api.brainReport()));
      setError(null);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }, []);

  // Load once, then follow the brain, at most once every few seconds.
  useEffect(() => {
    void load();
    const pending = events.brain(() => {
      const wait = REFRESH_GAP_MS - (Date.now() - last.current);
      if (wait <= 0) { void load(); return; }
      if (timer.current === null) timer.current = window.setTimeout(() => { timer.current = null; void load(); }, wait);
    });
    return () => {
      void pending.then((unlisten) => unlisten());
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [load]);

  const toggle = (key: string) => setOpen((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const bad = unsuitableRows(rows ?? []);
  const badNames = bad.map((row) => row.model).filter((name, i, all) => all.indexOf(name) === i);

  return (
    <Section
      title="Model report card"
      actions={<button type="button" className="btn" onClick={() => void load()} disabled={busy}>{busy ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />} Refresh</button>}
    >
      <div className="mr-body">
        <p className="muted">How each model did across your recorded AI turns: how often its tool calls failed and how many turns reached a passing workflow check. Needs turn traces on.</p>
        {bad.length > 0 && (
          <div className="mr-warn" role="alert">
            <AlertTriangle size={15} />
            <div>
              <strong>{badNames.length === 1 ? 'A model you used cannot do this job' : `${badNames.length} models you used cannot do this job`}</strong>
              <span>{badNames.join(', ')}. Switch to another model, or set Settings → General → How models build to Guided so weaker models get step-by-step help.</span>
            </div>
          </div>
        )}
        {error ? <p className="muted">The report could not be read: {error}</p>
          : !rows ? <p className="muted"><LoaderCircle size={13} className="spin" /> Reading the traces…</p>
          : rows.length === 0 ? <p className="muted">No recorded turns yet. Run an AI turn with turn traces on and its model shows up here.</p>
          : (
            <div className="mr-table" role="table" aria-label="Model report card">
              <div className="mr-row mr-head" role="row">
                <span /><span>Model</span><span>Mode</span><span className="num">Turns</span><span className="num">Failed calls</span><span className="num">Verified</span><span>Verdict</span>
              </div>
              {rows.map((row) => {
                const key = rowKey(row);
                const isOpen = open.has(key);
                const slug = row.verdict.replace(' ', '-');
                return (
                  <div key={key} className={`mr-item ${slug}`}>
                    <button type="button" className="mr-row" role="row" onClick={() => toggle(key)} aria-expanded={isOpen}>
                      {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      <span className="mr-name"><strong title={row.model}>{row.model}</strong><em>{row.providerId}{row.lastUsed ? ` · ${ago(row.lastUsed)}` : ''}</em></span>
                      <span><i className={`mr-tier ${row.tier}`}>{row.tier}</i></span>
                      <span className="num">{row.turns}</span>
                      <span className="num" title={`${row.failedCalls} of ${row.toolCalls} tool calls`}>{formatPercent(row.failRate)}</span>
                      <span className="num">{row.verifiedTurns}/{row.turns}</span>
                      <span className="mr-verdict" title={row.reason}><i className={`mr-chip ${slug}`}>{row.verdict}</i><em>{row.reason}</em></span>
                    </button>
                    {isOpen && (
                      <div className="mr-detail">
                        <dl className="brain-facts">
                          <dt>Tool calls</dt><dd>{row.toolCalls} ({row.avgToolCalls.toFixed(1)} per turn), {row.failedCalls} failed</dd>
                          {row.identicalRetries > 0 && <><dt>Same retry</dt><dd>{row.identicalRetries}× repeated an identical failing call</dd></>}
                          {row.emptyArgFailures > 0 && <><dt>Empty args</dt><dd>{row.emptyArgFailures} failed calls sent no arguments</dd></>}
                          {row.zeroToolTurns > 0 && <><dt>No tools</dt><dd>{row.zeroToolTurns} turn{row.zeroToolTurns === 1 ? '' : 's'} made no tool call</dd></>}
                          {Object.keys(row.faults).length > 0 && <><dt>Faults</dt><dd>{faultSummary(row.faults)}</dd></>}
                        </dl>
                        {row.topFailingTools.length > 0 && (
                          <div><h6>Most failing tools</h6><ul>{row.topFailingTools.map((tool) => <li key={tool.name}><code>{tool.name}</code> {tool.failed} of {tool.calls} failed</li>)}</ul></div>
                        )}
                        {row.phases.length > 0 && (
                          <div><h6>By phase</h6><ul>{row.phases.map((phase) => <li key={phase.phase}>{phaseLabel(phase.phase)}: {phase.turns} turn{phase.turns === 1 ? '' : 's'}, {phase.verifyOk} verified</li>)}</ul></div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
      </div>
    </Section>
  );
}
