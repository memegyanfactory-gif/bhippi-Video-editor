// The launch splash: a small card in the middle of the screen, like a desktop suite's. The window
// behind it is maximized but see-through while Bhippi boots (tauri.conf.json, html.booting in
// index.html), so only the card shows. It reports each check in its corner as it finishes, then its
// ending (splashArt.ts) grows the card to fill the window and opens onto the editor, or onto the
// sign-in gate when the license needs attention.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../lib/ipc';
import { useLicense } from '../license/licenseStore';
import appPackage from '../../package.json';
import { LEGAL } from '../settings/legal';
import { useBoot } from './bootStore';
import { startSplashArt, type SplashArt } from './splashArt';
import '../styles/splash.css';

/**
 * The version on the card, read from package.json when the app is built, so it is on screen from the
 * first frame and always matches the release (tests/version.test.ts keeps every version file in step).
 */
const VERSION = appPackage.version;

/** Long enough for the artwork to draw itself in, on the fastest launch. */
const MIN_SHOWN_MS = 2300;
/** A launch that never reports ready still opens. */
const GIVE_UP_MS = 25000;
/** How long each status line stays before the next replaces it. */
const LINE_MS = 190;

type Phase = 'idle' | 'leaving' | 'opening' | 'fading' | 'gone';

/**
 * The window is Bhippi's again: the app shows, the page is opaque and the pointer stops passing
 * through to the desktop (splash_done in lib.rs). Also run if the splash goes away any other way.
 */
let booted = false;
function endBoot() {
  if (booted) return;
  booted = true;
  document.documentElement.classList.remove('booting');
  // Until this answers, every click falls through the window to the desktop, so a refusal is
  // asked again rather than dropped (it once failed silently whenever a project tab was open).
  const handBack = (attempt: number) => {
    api.splashDone().catch((error) => {
      console.error('The window did not take the pointer back', error);
      if (attempt < 5) window.setTimeout(() => handBack(attempt + 1), 400 * (attempt + 1));
    });
  };
  handBack(0);
}

export function BootSplash() {
  const boot = useBoot();
  const license = useLicense();
  const [phase, setPhase] = useState<Phase>('idle');
  const [shown, setShown] = useState(0);
  const [gaveUp, setGaveUp] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const art = useRef<SplashArt | null>(null);
  const mountedAt = useRef(performance.now());

  useEffect(() => {
    const timer = window.setTimeout(() => setGaveUp(true), GIVE_UP_MS);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!canvas.current || !card.current) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const instance = startSplashArt(canvas.current, {
      card: card.current,
      reducedMotion,
      onOpen: () => setPhase(reducedMotion ? 'fading' : 'opening'),
      onCovered: endBoot,
      onDone: () => {
        if (reducedMotion) window.setTimeout(() => setPhase('gone'), 320);
        else setPhase('gone');
      },
    });
    art.current = instance;
    return () => {
      instance.destroy();
      art.current = null;
    };
  }, []);

  // A crash or anything else that removes the splash early still hands the window back. (A cleanup
  // whose element is still on the page is React's development double-mount, not a removal.)
  useEffect(() => {
    const element = root.current;
    return () => {
      window.setTimeout(() => {
        if (!element?.isConnected) endBoot();
      }, 0);
    };
  }, []);

  // One line at a time, each long enough to read, however fast the checks arrive.
  const lastLine = boot.lines.length - 1;
  useEffect(() => {
    if (shown >= lastLine) return;
    const timer = window.setTimeout(() => setShown((index) => index + 1), LINE_MS);
    return () => window.clearTimeout(timer);
  }, [shown, lastLine]);

  // Ready: the license answered and, when it lets the editor open, the editor has loaded.
  const unlocked = license.status?.state === 'active' || (license.devBypass && license.status?.devBypassAllowed === true);
  const ready = gaveUp || (boot.licenseSettled && (!unlocked || boot.appReady));
  const caughtUp = shown >= lastLine;
  useEffect(() => {
    if (phase !== 'idle' || !ready || (!caughtUp && !gaveUp)) return;
    const wait = Math.max(220, MIN_SHOWN_MS - (performance.now() - mountedAt.current));
    const timer = window.setTimeout(() => {
      setPhase('leaving');
      art.current?.finish();
    }, wait);
    return () => window.clearTimeout(timer);
  }, [phase, ready, caughtUp, gaveUp]);

  if (phase === 'gone') return null;
  const line = boot.lines[Math.min(shown, lastLine)] ?? '';

  return createPortal(
    <div className={`splash is-${phase}`} ref={root} aria-busy={phase === 'idle'}>
      <canvas ref={canvas} />
      <div className="splash-card" ref={card}>
        <div className="splash-info">
          <header className="splash-brand">
            <img src="/bhippi.png" alt="" width={28} height={28} />
            <div>
              <div className="splash-name">Bhippi</div>
              <div className="splash-product">
                Video Editor<span className="splash-version"> · {VERSION}</span>
              </div>
            </div>
          </header>
          <div className="splash-legal">
            <p className="splash-credit">
              Artwork drawn live by <b>Bhippi</b> — a new composition every launch.
            </p>
            <p>
              © {new Date().getFullYear()} {LEGAL.owner}. All rights reserved. {LEGAL.product} is licensed, not sold, to one
              account for use on up to two PCs.
            </p>
            <p>
              By using Bhippi you agree to the Terms of Service and the Privacy Policy. Your projects, footage and exports stay
              on this computer; AI features send only what a request needs to the providers you connect, under their own terms.
            </p>
            <p className="splash-fine">
              Includes open-source software. Terms, privacy and notices: Settings › Privacy &amp; legal · {LEGAL.website}
            </p>
          </div>
        </div>
        <div className="splash-status" role="status" aria-live="polite">
          <span key={line}>{line}</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
