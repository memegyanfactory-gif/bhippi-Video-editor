// Plan allowances and token spend are separate measurements, scoped to the selected model.
import { ExternalLink, RotateCcw, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Portal, usePlacement } from '../components/Portal';
import { ProviderLogo } from '../components/ProviderLogo';
import type { ProviderInfo } from '../lib/types';
import { agoText, expired, forProvider, standing, subscribe, summarizeTurns, tokenCount, untilText, usageLabel, worst, type Standing, type UsageTurn, type Window } from '../lib/usage';
import '../styles/usage.css';
import { useProviderUsage, windowLabel } from '../lib/providerUsage';

const TONE: Record<Standing, string> = { unknown: 'var(--text-faint)', ok: 'var(--green, #46c46a)', warn: '#d8a33c', high: '#e08a3c', exhausted: '#e0574a' };

function Ring({ used, tone }: { used: number; tone: string }) {
  const circumference = 2 * Math.PI * 6;
  return <svg className="usage-ring" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" opacity="0.2" strokeWidth="2" />
    <circle cx="7" cy="7" r="6" fill="none" stroke={tone} strokeWidth="2" strokeLinecap="round" strokeDasharray={circumference}
      strokeDashoffset={circumference * (1 - Math.min(1, Math.max(0, used)))} transform="rotate(-90 7 7)" />
  </svg>;
}

function LimitLine({ label, window, now }: { label: string; window: Window | null; now: number }) {
  if (!window) return null;
  const reset = expired(window, now);
  const state = window.used >= 0.995 ? 'exhausted' : window.used >= 0.9 ? 'high' : window.used >= 0.75 ? 'warn' : 'ok';
  return <div className={`usage-window${reset ? ' reset' : ''}`}>
    <div className="usage-window-title"><span>{label}</span><span className="usage-window-reset" title={window.resetsAt ? new Date(window.resetsAt * 1000).toLocaleString() : undefined}>{reset ? 'Awaiting report' : window.resetsAt ? `Resets ${untilText(window.resetsAt, now)}` : ''}</span><strong>{reset ? '—' : `${Math.round(window.used * 100)}%`}</strong></div>
    {!reset && <div className="usage-bar" role="progressbar" aria-label={`${label} allowance used`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(window.used * 100)}>
      <span className="usage-bar-fill" style={{ width: `${window.used * 100}%`, background: TONE[state] }} />
    </div>}
  </div>;
}

export function UsageMeter({ provider, model, turns = [], running = false, sessionId, onSwitch }: {
  provider: ProviderInfo | undefined; providers?: readonly ProviderInfo[]; model: string | null;
  turns?: readonly UsageTurn[]; running?: boolean; sessionId?: string; onSwitch: () => void;
}) {
  const live = useProviderUsage(provider?.id, sessionId, running);
  const [, bump] = useState(0);
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const chip = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const id = useId();
  const at = usePlacement(chip, open, 300);
  useEffect(() => {
    const off = subscribe(() => bump((value) => value + 1));
    const tick = window.setInterval(() => bump((value) => value + 1), 30_000);
    return () => { off(); window.clearInterval(tick); };
  }, []);
  useEffect(() => {
    if (!open) return;
    popup.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); chip.current?.focus(); }
    };
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !popup.current?.contains(event.target) && !chip.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('pointerdown', outside, true);
    return () => { document.removeEventListener('keydown', keydown, true); document.removeEventListener('pointerdown', outside, true); };
  }, [open]);
  const now = Date.now();
  const snapshot = forProvider(provider?.id, model);
  const state = standing(snapshot, now);
  const reading = worst(snapshot, now);
  const context = live.data?.context;
  const contextUsed = context?.limitTokens ? Math.min(1, context.usedTokens / context.limitTokens) : null;
  const label = contextUsed !== null ? `Context window: ${Math.round(contextUsed * 100)}% used` : provider ? usageLabel(snapshot, now) : 'Select provider';
  const totals = summarizeTurns(turns, provider?.id, model);
  const hasLimits = !!(snapshot?.session || snapshot?.weekly || snapshot?.plan);
  const bannerKey = snapshot ? `${snapshot.providerId}:${snapshot.model}:${snapshot.limitsAt ?? snapshot.at}:${state}` : null;
  const banner = snapshot && (state === 'high' || state === 'exhausted') && dismissed !== bannerKey;
  const providerName = provider?.label ?? 'No provider selected';
  const hasRefusal = !!snapshot?.exhaustedUntil && snapshot.exhaustedUntil * 1000 > now;
  return <>
    {banner && <div className={`usage-banner ${state}`} role="status">
      <span>{providerName}: {hasRefusal ? 'the last request was rate limited' : `${Math.round(reading.used * 100)}% of the ${reading.window === 'session' ? snapshot.sessionLabel ?? 'session' : reading.window === 'weekly' ? snapshot.weeklyLabel ?? 'weekly' : 'plan'} allowance used`}
        {(hasRefusal ? snapshot.exhaustedUntil : reading.resetsAt) && ` · retry ${untilText(hasRefusal ? snapshot.exhaustedUntil : reading.resetsAt, now)}`}</span>
      <button type="button" className="usage-banner-link" onClick={() => setOpen(true)}>View usage</button>
      <button type="button" className="usage-banner-close" onClick={() => setDismissed(bannerKey)} aria-label="Dismiss usage warning"><X size={11} /></button>
    </div>}
    <div className="usage-anchor">
      <button type="button" ref={chip} className={`bar-chip usage-chip ${state}${open ? ' active' : ''}`} onClick={() => setOpen(!open)}
        aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
        aria-label={`${providerName}${model ? ` · ${model}` : ''}: ${label}`}
        title={`${providerName}${model ? ` · ${model}` : ''}\n${label}${snapshot?.tokens && !reading.window ? ' on the last reported turn' : ''}${running ? '\nRunning; tokens update when the turn finishes.' : ''}`}>
        <Ring used={contextUsed ?? reading.used} tone={contextUsed !== null ? TONE[contextUsed >= 0.9 ? 'high' : contextUsed >= 0.75 ? 'warn' : 'ok'] : TONE[state]} />
        {running && <span className="usage-live" aria-label="Turn running" />}
      </button>
      {open && <Portal>
        <div className="bar-scrim" onPointerDown={() => setOpen(false)} aria-hidden="true" />
        <div ref={popup} id={id} tabIndex={-1} className="bar-popover usage-popover" style={{ ...at, maxHeight: Math.min(at?.maxHeight ?? 280, 280) }} role="dialog" aria-label={`${providerName} usage`}>
          <div className="usage-head"><ProviderLogo id={provider?.id ?? 'bhippi'} size={14} />
            <div className="usage-identity"><span className="usage-head-name">{providerName}</span><span className="usage-head-model" title={model ?? snapshot?.model ?? undefined}>{model ?? snapshot?.model ?? 'Automatic model'}</span></div>
            <button type="button" className="usage-close" aria-label="Close usage" onClick={() => { setOpen(false); chip.current?.focus(); }}><X size={14} /></button>
          </div>
          {provider && <>
            <div className="usage-section">
              <div className="usage-section-heading">Plan usage limits <span title={live.error || `Last reported ${agoText(snapshot?.limitsAt ?? snapshot?.at ?? now, now)}`}>{hasLimits ? agoText(snapshot!.limitsAt ?? snapshot!.at, now) : live.loading ? 'Checking…' : live.error ? 'Check failed' : 'Not available'}</span></div>
              <LimitLine label={snapshot?.sessionLabel ?? 'Session limit'} window={snapshot?.session ?? null} now={now} />
              <LimitLine label={snapshot?.weeklyLabel ?? 'Weekly'} window={snapshot?.weekly ?? null} now={now} />
              <LimitLine label="Plan" window={snapshot?.plan ?? null} now={now} />
              {!hasLimits && !live.loading && <p className="usage-note">{live.error || (provider.id === 'codex' ? 'No plan quota returned for this account.' : 'This provider does not expose plan limits here.')}</p>}
              {live.data?.limits.filter((bucket) => bucket.id !== (live.data?.limits.find((item) => item.id === 'codex') ?? live.data?.limits[0])?.id).map((bucket) => <div key={bucket.id}><LimitLine label={`${windowLabel(bucket.primary?.minutes, 'Limit')} · ${bucket.label}`} window={bucket.primary} now={now} /><LimitLine label={`${windowLabel(bucket.secondary?.minutes, 'Longer limit')} · ${bucket.label}`} window={bucket.secondary} now={now} /></div>)}
              {hasRefusal && <p className="usage-note out">Rate limited · retry {untilText(snapshot!.exhaustedUntil, now)}</p>}
            </div>
            <div className="usage-section">
              <div className="usage-section-heading">Context window <span>{live.data?.context ? `${tokenCount(live.data.context.usedTokens)}${live.data.context.limitTokens ? ` / ${tokenCount(live.data.context.limitTokens)}` : ''}` : running && provider.id === 'codex' ? 'Awaiting reading' : 'Not available'}</span></div>
              {live.data?.context?.limitTokens && <div className="usage-bar" role="progressbar" aria-label="Context window used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(live.data.context.usedTokens / live.data.context.limitTokens * 100))}><span className="usage-bar-fill" style={{ width: `${Math.min(100, live.data.context.usedTokens / live.data.context.limitTokens * 100)}%`, background: 'var(--blue-hi)' }} /></div>}
            </div>
            <div className="usage-section">
              <div className="usage-section-heading" title="Tokens processed across requests and tool rounds, including repeated input. Separate from the context window and account quota.">Last completed turn · tokens <span>{snapshot?.tokens ? agoText(snapshot.tokensAt ?? snapshot.at, now) : 'Not reported'}</span></div>
              {snapshot?.tokens ? <>
                <div className="usage-token-split"><span>Input <strong>{tokenCount(snapshot.tokens.input)}</strong></span><span>Output <strong>{tokenCount(snapshot.tokens.output)}</strong></span><strong className="usage-token-sum" title="Reported request tokens, not context-window occupancy">{tokenCount(snapshot.tokens.input + snapshot.tokens.output)}</strong></div>
              </> : null}
              {totals.reported > 0 && <div className="usage-conversation">
                <div title={`${totals.reported} reported turns; ${totals.missing} unreported turns excluded`}><span>Conversation · {model ? 'this model' : 'this provider'}</span><strong>{tokenCount(totals.input + totals.output)}</strong></div>
              </div>}
            </div>
          </>}
          <button type="button" className="bar-action" onClick={() => { setOpen(false); onSwitch(); }}>{state === 'exhausted' ? <><RotateCcw size={12} /> Switch provider</> : <><ExternalLink size={12} /> Manage providers</>}</button>
        </div>
      </Portal>}
    </div>
  </>;
}
