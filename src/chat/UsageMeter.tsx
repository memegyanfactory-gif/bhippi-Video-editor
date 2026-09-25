// What is left on the current provider's plan, in the chat bar.
//
// Ported from the Bhippi desktop app's meter: a ring that fills as the allowance goes and walks green → amber →
// red on the way, the percentage beside it because colour is never the only signal, and a drop-up
// with the detail. Above about nine tenths it also raises a banner, which is the moment worth
// interrupting for.
//
// Every number comes from the provider itself (see lib/usage.ts). A provider that has not been
// used yet shows an empty ring and says so rather than implying it is fresh.
import { ExternalLink, RotateCcw, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Portal, usePlacement } from '../components/Portal';
import { ProviderLogo } from '../components/ProviderLogo';
import type { ProviderInfo } from '../lib/types';
import { agoText, all, forProvider, standing, subscribe, untilText, worst, type Standing } from '../lib/usage';

const TONE: Record<Standing, string> = {
  unknown: 'var(--text-faint)',
  ok: '#46c46a',
  warn: '#d8a33c',
  high: '#e08a3c',
  exhausted: '#e0574a',
};

/** The arc grows clockwise as the allowance goes. An empty ring means nothing is known yet. */
function Ring({ used, tone, size = 13, thickness = 2 }: { used: number; tone: string; size?: number; thickness?: number }) {
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const centre = size / 2;
  const spent = Math.min(1, Math.max(0, used));
  return (
    <svg className="usage-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" focusable="false">
      <circle cx={centre} cy={centre} r={radius} fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth={thickness} />
      {spent > 0 && (
        <circle
          cx={centre}
          cy={centre}
          r={radius}
          fill="none"
          stroke={tone}
          strokeWidth={thickness}
          strokeLinecap="butt"
          strokeDasharray={`${circumference * spent} ${circumference}`}
          transform={`rotate(-90 ${centre} ${centre})`}
        />
      )}
    </svg>
  );
}

const percent = (used: number) => `${Math.round(used * 100)}%`;
const tokenCount = (value: number) => value >= 1000000 ? `${(value / 1000000).toFixed(1)}M` : value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);

function Line({ label, window, tone }: { label: string; window: { used: number; resetsAt: number | null } | null; tone: string }) {
  if (!window) return null;
  return (
    <div className="usage-line">
      <span className="usage-line-label">{label}</span>
      <span className="usage-bar"><span className="usage-bar-fill" style={{ width: `${Math.min(100, window.used * 100)}%`, background: tone }} /></span>
      <span className="usage-line-value">{percent(window.used)}</span>
      {window.resetsAt && <span className="usage-line-reset">resets {untilText(window.resetsAt)}</span>}
    </div>
  );
}

export function UsageMeter({ provider, model, onSwitch }: {
  /** The provider the chat is set to. Changing it shows that provider's own numbers. */
  provider: ProviderInfo | undefined;
  model: string | null;
  onSwitch: () => void;
}) {
  const [, bump] = useState(0);
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const chip = useRef<HTMLButtonElement>(null);
  const at = usePlacement(chip, open, 268);

  // The store changes when a turn reports its standing; the clock matters too, since a reset
  // time passing turns an exhausted provider back into a usable one.
  useEffect(() => {
    const off = subscribe(() => bump((value) => value + 1));
    const tick = window.setInterval(() => bump((value) => value + 1), 30_000);
    return () => {
      off();
      window.clearInterval(tick);
    };
  }, []);

  const snapshot = forProvider(provider?.id);
  const state = standing(snapshot);
  const { used, window: which, resetsAt } = worst(snapshot);
  const tone = TONE[state];
  const others = all().filter((item) => item.providerId !== provider?.id);

  const label = state === 'unknown'
    ? snapshot?.tokens ? `${tokenCount(snapshot.tokens.input + snapshot.tokens.output)} tokens` : 'Usage unknown'
    : state === 'exhausted'
      ? `${provider?.label ?? 'This provider'} is out`
      : `${percent(used)}${which ? ` ${which}` : ''}`;

  // The banner is for the moment worth interrupting over, and only once per reading.
  const bannerKey = snapshot ? `${snapshot.providerId}:${Math.round(used * 100)}` : null;
  const banner = snapshot && (state === 'high' || state === 'exhausted') && dismissed !== bannerKey;

  return (
    <>
      {banner && (
        <div className={`usage-banner ${state}`} role="status">
          <span>
            {state === 'exhausted'
              ? `${provider?.label ?? 'This provider'} has used its whole ${which ?? 'plan'} allowance`
              : `You've used ${percent(used)} of your ${which ?? 'plan'} limit`}
            {resetsAt && ` · resets ${untilText(resetsAt)}`}
          </span>
          <button type="button" className="usage-banner-link" onClick={() => setOpen(true)}>View usage</button>
          <button type="button" className="usage-banner-close" onClick={() => setDismissed(bannerKey)} aria-label="Dismiss">
            <X size={11} />
          </button>
        </div>
      )}

      <div className="usage-anchor">
        <button
          type="button"
          ref={chip}
          className={`bar-chip usage-chip ${state}`}
          onClick={() => setOpen(!open)}
          title={snapshot
            ? `${provider?.label ?? 'Provider'}: ${label}, learned ${agoText(snapshot.at)}`
            : 'This provider has not reported its usage yet — it will after the first turn'}
        >
          <Ring used={state === 'unknown' ? 0 : used} tone={tone} />
          <span style={{ color: state === 'exhausted' ? tone : undefined }}>{label}</span>
        </button>

        {open && (
          <Portal>
            <div className="bar-scrim" onPointerDown={() => setOpen(false)} aria-hidden="true" />
            <div className="bar-popover usage-popover" style={at} role="dialog" aria-label="Plan usage">
              <div className="usage-head">
                <ProviderLogo id={provider?.id ?? 'bhippi'} size={14} />
                <span className="usage-head-name">{provider?.label ?? 'No provider'}</span>
                {model && <span className="usage-head-model">{model}</span>}
              </div>

              {snapshot ? (
                <>
                  <Line label="Session" window={snapshot.session} tone={tone} />
                  <Line label="Weekly" window={snapshot.weekly} tone={tone} />
                  {state === 'exhausted' && (
                    <p className="usage-note out">
                      This provider refused the last turn for its limit.
                      {snapshot.exhaustedUntil ? ` It frees up ${untilText(snapshot.exhaustedUntil)}.` : ''} Switch to another to keep going.
                    </p>
                  )}
                  <p className="usage-note">
                    From {provider?.label ?? 'the provider'} itself, {agoText(snapshot.at)}
                    {snapshot.model ? ` on ${snapshot.model}` : ''}.
                  </p>
                  {!snapshot.session && !snapshot.weekly && snapshot.tokens && (
                    <p className="usage-note">Codex reported {tokenCount(snapshot.tokens.input)} input and {tokenCount(snapshot.tokens.output)} output tokens on the last turn. Its CLI does not expose a plan percentage.</p>
                  )}
                </>
              ) : (
                <p className="usage-note">
                  Nothing reported yet. Providers tell Bhippi where they stand while a turn runs, so this fills in after the first message.
                </p>
              )}

              {others.length > 0 && (
                <>
                  <div className="popover-divider" />
                  <div className="usage-others">
                    {others.slice(0, 5).map((item) => {
                      const state2 = standing(item);
                      const reading = worst(item);
                      return (
                        <div key={item.providerId} className="usage-other">
                          <Ring used={state2 === 'unknown' ? 0 : reading.used} tone={TONE[state2]} size={11} />
                          <span className="usage-other-name">{item.providerId}</span>
                          <span className="usage-other-value" style={{ color: state2 === 'exhausted' ? TONE[state2] : undefined }}>
                            {state2 === 'exhausted' ? 'out' : percent(reading.used)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              <button type="button" className="bar-action" onClick={() => { setOpen(false); onSwitch(); }}>
                {state === 'exhausted' ? <><RotateCcw size={11} /> Switch provider</> : <><ExternalLink size={11} /> Manage providers</>}
              </button>
            </div>
          </Portal>
        )}
      </div>
    </>
  );
}
