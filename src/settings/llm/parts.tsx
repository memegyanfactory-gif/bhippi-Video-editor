// Small pieces of the language-model browser: a maker's round logo, the verified tick, the
// capability icons and the copy button.
import { convertFileSrc } from '@tauri-apps/api/core';
import { BadgeCheck, Brain, Check, Copy, Eye, TriangleAlert, Wrench } from 'lucide-react';
import { useEffect, useState } from 'react';
import { copyText } from '../../lib/clipboard';
import type { Capabilities } from '../../lib/llmHub';
import type { FitResult } from '../../lib/modelFit';
import type { SettingsTab } from '../SettingsModal';

/** A stable colour (0-359) from a name, so a logo without a picture always gets the same one. */
const hueOf = (name: string): number => {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) hash = (hash * 31 + name.charCodeAt(index)) >>> 0;
  return hash % 360;
};

const FIT_TONE: Record<FitResult['fit'], string> = { great: 'ok', ok: 'ok', slow: 'warn', no: 'bad', nvidia: 'bad', checking: 'quiet' };

/** How a size runs on this PC, in a small pill; the reasons show on hover. */
export function FitPill({ fit }: { fit: FitResult }) {
  return (
    <span className={`lb-fit ${FIT_TONE[fit.fit]}`} title={fit.reasons.join(' ') || undefined}>
      {fit.fit === 'great' || fit.fit === 'ok' ? <Check size={11} /> : fit.fit === 'checking' ? null : <TriangleAlert size={11} />}
      {fit.label}
    </span>
  );
}

/** "Change limit": opens Settings › General, where the memory limit is (Performance). Nothing when there is no way to navigate. */
export function ChangeLimit({ onTab }: { onTab?: (tab: SettingsTab) => void }) {
  if (!onTab) return null;
  return <> <a href="#performance" onClick={(event) => { event.preventDefault(); onTab('general'); }}>Change limit</a></>;
}

/** A round logo from the cached file; a neutral circle with the first letter when there is none or it does not load. */
export function MakerLogo({ path, name, size = 36 }: { path: string | null | undefined; name: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [path]);
  const letter = (name.replace(/[^A-Za-z0-9]/g, '')[0] ?? '?').toUpperCase();
  const style = { width: size, height: size, fontSize: Math.round(size * 0.42), '--hue': hueOf(name) } as React.CSSProperties;
  if (path && !failed) {
    return (
      <span className="lb-logo" style={style} aria-hidden="true">
        <img src={convertFileSrc(path)} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} />
      </span>
    );
  }
  return <span className="lb-logo fallback" style={style} aria-hidden="true">{letter}</span>;
}

export function VerifiedTick({ maker }: { maker: string }) {
  return <span className="lb-tick" title={`Made by ${maker}`}><BadgeCheck size={14} aria-label={`Made by ${maker}`} /></span>;
}

/** Vision, tool use and reasoning as small icons; only what the model has. */
export function CapIcons({ caps, size = 13 }: { caps: Capabilities; size?: number }) {
  return (
    <span className="lb-caps">
      {caps.vision && <span className="lb-cap" title="Vision: can look at pictures"><Eye size={size} /></span>}
      {caps.tools && <span className="lb-cap" title="Tool use: can call tools"><Wrench size={size} /></span>}
      {caps.reasoning && <span className="lb-cap" title="Reasoning: thinks before it answers"><Brain size={size} /></span>}
    </span>
  );
}

/** Capability chips with words, for the detail pane. */
export function CapChips({ caps }: { caps: Capabilities }) {
  const items = [
    caps.vision && { key: 'vision', icon: <Eye size={13} />, label: 'Vision' },
    caps.tools && { key: 'tools', icon: <Wrench size={13} />, label: 'Tool use' },
    caps.reasoning && { key: 'reasoning', icon: <Brain size={13} />, label: 'Reasoning' },
  ].filter(Boolean) as { key: string; icon: React.ReactNode; label: string }[];
  if (!items.length) return <span className="lb-faint">Text chat</span>;
  return <>{items.map((item) => <span key={item.key} className="lb-chip cap">{item.icon}{item.label}</span>)}</>;
}

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="lb-icon-btn"
      title={done ? 'Copied' : label}
      aria-label={label}
      onClick={() => void copyText(text).then((ok) => { setDone(ok); window.setTimeout(() => setDone(false), 1400); })}
    >
      {done ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}
