import { Activity, ArrowDownLeft, ArrowUpRight, Gauge, MessagesSquare } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { ProviderLogo } from '../components/ProviderLogo';
import { all, agoText, expired, standing, subscribe, tokenCount, untilText, usageLabel } from '../lib/usage';
import { usageHistory, usageSummary, type UsageRange } from '../lib/usageHistory';
import type { ProviderInfo, Settings } from '../lib/types';
import { SettingsHeader } from './SettingsLayout';
import '../styles/usage-settings.css';

export function UsageSettings({ providers, settings }: { providers: ProviderInfo[]; settings: Settings }) {
  const records = useSyncExternalStore(usageHistory.subscribe, usageHistory.get);
  const [range, setRange] = useState<UsageRange>('week');
  const [providerId, setProviderId] = useState('');
  const [model, setModel] = useState('');
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const off = subscribe(() => setNow(Date.now()));
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => { off(); window.clearInterval(timer); };
  }, []);
  const summary = usageSummary(records, range, providerId, model, now);
  const name = (id: string) => providers.find((row) => row.id === id)?.label ?? id;
  const providerIds = [...new Set([...providers.map((row) => row.id), ...records.map((row) => row.providerId)])];
  const models = [...new Set(records.filter((row) => !providerId || row.providerId === providerId).flatMap((row) => row.model ? [row.model] : []))];
  const limits = all().filter((row) => (!providerId || row.providerId === providerId) && (!model || row.model === model || row.account));
  const selected = providers.find((row) => row.id === settings.providerId);
  const total = summary.input + summary.output;
  return <div className="usage-settings">
    <SettingsHeader title="Usage">Token activity recorded in Bhippi, with provider-reported limits kept separately.</SettingsHeader>
    <div className="usage-settings-toolbar">
      <div className="usage-range" role="group" aria-label="Usage period">
        {([['today', 'Today'], ['week', '7 days'], ['month', '30 days'], ['all', 'All time']] as const).map(([id, label]) =>
          <button type="button" key={id} className={range === id ? 'active' : ''} aria-pressed={range === id} onClick={() => setRange(id)}>{label}</button>)}
      </div>
      <select aria-label="Usage provider" value={providerId} onChange={(event) => { setProviderId(event.target.value); setModel(''); }}>
        <option value="">All providers</option>{providerIds.map((id) => <option key={id} value={id}>{name(id)}</option>)}
      </select>
      <select aria-label="Usage model" value={model} onChange={(event) => setModel(event.target.value)}><option value="">All models</option>{models.map((id) => <option key={id} value={id}>{id}</option>)}</select>
    </div>
    <div className="usage-metrics">
      {([{ label: 'Total tokens', value: total, icon: <Activity size={15} /> }, { label: 'Input tokens', value: summary.input, icon: <ArrowDownLeft size={15} /> },
        { label: 'Output tokens', value: summary.output, icon: <ArrowUpRight size={15} /> }, { label: 'Reported turns', value: summary.turns, icon: <MessagesSquare size={15} /> }]).map((metric) =>
        <div key={metric.label} className="usage-metric"><span>{metric.icon}{metric.label}</span><strong title={metric.value.toLocaleString()}>{tokenCount(metric.value)}</strong></div>)}
    </div>
    {selected && <div className="usage-current"><ProviderLogo id={selected.id} size={14} /><span>Selected in chat</span><strong>{selected.label}</strong><span className="usage-current-model">{settings.model ?? 'Automatic model'}</span></div>}
    <section className="usage-breakdown">
      <div className="usage-settings-heading"><h4>Provider &amp; model breakdown</h4><span>{summary.groups.length} models</span></div>
      {summary.groups.length ? <div className="usage-table-scroll"><table className="usage-table">
        <thead><tr><th>Provider / model</th><th>Input</th><th>Output</th><th>Total</th><th>Turns</th></tr></thead>
        <tbody>{summary.groups.map((row) => <tr key={JSON.stringify([row.providerId, row.model])}>
          <td><div className="usage-table-provider"><ProviderLogo id={row.providerId} size={15} /><span>{name(row.providerId)}</span></div><div className="usage-table-model" title={row.model ?? undefined}>{row.model ?? 'Automatic model'}</div>
            <div className="usage-share" title={`${Math.round((row.input + row.output) / Math.max(1, total) * 100)}% of tokens in this view`}><span style={{ width: `${(row.input + row.output) / Math.max(1, total) * 100}%` }} /></div></td>
          <td title={row.input.toLocaleString()}>{tokenCount(row.input)}</td><td title={row.output.toLocaleString()}>{tokenCount(row.output)}</td>
          <td title={(row.input + row.output).toLocaleString()}><strong>{tokenCount(row.input + row.output)}</strong></td><td>{row.turns}</td>
        </tr>)}</tbody>
      </table></div> : <div className="usage-settings-empty"><Activity size={24} /><strong>No reported tokens in this view</strong><span>Run a chat turn or choose another period. Providers that omit token counts are excluded.</span></div>}
      <p className="usage-settings-footnote">Provider-reported requests and tool rounds in Bhippi. External app activity and unreported tokens are excluded. Token totals are not subscription bills or context-window estimates.</p>
    </section>
    <section className="usage-breakdown">
      <div className="usage-settings-heading"><h4><Gauge size={14} /> Plan limits</h4><span>Latest readings · independent of period</span></div>
      {limits.length ? <div className="usage-limit-grid">{limits.map((row) => {
        const windows = ([[row.sessionLabel ?? 'Session', row.session], [row.weeklyLabel ?? 'Weekly', row.weekly], ['Plan', row.plan]] as const).filter((entry) => entry[1]);
        return <article className="usage-limit-card" key={JSON.stringify([row.providerId, row.model])}>
          <header><ProviderLogo id={row.providerId} size={16} /><strong>{name(row.providerId)}</strong><span className={`usage-limit-state ${standing(row, now)}`}>{usageLabel(row, now)}</span></header>
          <p className="usage-table-model">{row.account ? 'Account limits · shared across models' : row.model ?? 'Automatic model'}</p>
          {windows.map(([label, window]) => window && <div className="usage-limit-window" key={label}>
            <div><span>{label}</span><strong>{expired(window, now) ? 'Awaiting update' : `${Math.round(window.used * 100)}% used`}</strong></div>
            {!expired(window, now) && <div className="usage-share" role="progressbar" aria-label={`${name(row.providerId)} ${label} usage`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(window.used * 100)}><span style={{ width: `${window.used * 100}%` }} /></div>}
            {window.resetsAt !== null && <small>{expired(window, now) ? 'Reset time passed' : `Resets ${untilText(window.resetsAt, now)}`}</small>}
          </div>)}
          {!windows.length && <p className="usage-settings-footnote">No plan percentage reported for this model.</p>}
          {!!row.exhaustedUntil && row.exhaustedUntil * 1000 > now && <p className="usage-settings-footnote">Rate limited; retry {untilText(row.exhaustedUntil, now)}.</p>}
          {windows.length > 0 && <p className="usage-settings-footnote">Limit reported {agoText(row.limitsAt ?? row.at, now)}.</p>}
        </article>;
      })}</div> : <p className="usage-settings-footnote">No readings yet. Limits appear when a provider reports them during a turn.</p>}
    </section>
  </div>;
}
