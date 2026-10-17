// Qwen3.8 Flash Next runs through Strata, not llama.cpp. This is what its page adds: why it needs its
// own engine, what Strata reported for each size, an honest note for this PC, the Windows page file
// warning with its steps, and the "your PC may be slow while it loads" notice before a start.
import { LoaderCircle, Play, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { HardwareInfo } from '../../lib/ipc';
import { primaryVramGb } from '../../lib/modelFit';
import { strataMeasuredText } from '../../lib/llmSpeed';
import { libraryApi, type LibraryEntry, type StrataStatus } from '../../lib/modelLibrary';

/** The badge on the list and the page: it needs Strata, not llama.cpp. */
export const STRATA_BADGE = 'Runs with Strata';

/** Strata's own measurements (docs/MODELS.md: RTX 5070 12 GB, Ryzen 5 7600, 64 GB of RAM), in tokens a second; a token is about three quarters of a word. */
export const STRATA_SPEEDS: Record<string, { short: number; long: number; prompt: number }> = {
  q2_0: { short: 94, long: 76, prompt: 2650 },
  iq2_xs: { short: 79, long: 63, prompt: 2090 },
  iq3_xxs: { short: 62, long: 49, prompt: 1750 },
  iq3_s: { short: 53, long: 46, prompt: 1620 },
  'coder-iq1_m': { short: 55, long: 43, prompt: 2180 },
};

/** Minimum video memory Strata runs on, and the amount it is made for. */
const MIN_VRAM_GB = 8;
const GOOD_VRAM_GB = 12;
/** What to suggest when Strata does not load on a small card: a 35B mixture-of-experts model through llama.cpp. */
const FALLBACK_MODEL = 'Qwen3.6 35B A3B';

/** How this PC's card and memory suit Strata, in words a person can act on, and whether it is good news. */
export const pcNote = (hw: HardwareInfo | null, smallestRamGb: number): { text: string; tone: 'ok' | 'warn' | 'bad' } | null => {
  if (!hw) return null;
  const gpu = primaryVramGb(hw);
  if (!gpu) return { tone: 'bad', text: `No NVIDIA graphics card was found. Strata needs one with at least ${MIN_VRAM_GB} GB of video memory.` };
  const memory = Math.round(gpu.vramGb);
  const ram = hw.ramGb != null ? Math.round(hw.ramGb) : null;
  const ramText = ram == null ? '' : ram < smallestRamGb ? ` Your PC has ${ram} GB of RAM, less than any size here needs (${smallestRamGb} GB at the least).` : ` Your PC has ${ram} GB of RAM.`;
  if (gpu.vramGb < MIN_VRAM_GB - 0.5) return { tone: 'bad', text: `Your ${gpu.name} has ${memory} GB of video memory. Strata needs at least ${MIN_VRAM_GB} GB, so it cannot run this model.${ramText}` };
  if (gpu.vramGb < GOOD_VRAM_GB - 0.5) return { tone: 'warn', text: `Experimental on cards under ${GOOD_VRAM_GB} GB. Your ${gpu.name} has ${memory} GB of video memory. Strata is made for ${GOOD_VRAM_GB} GB or more: it runs this model on your card, more slowly than on a ${GOOD_VRAM_GB} GB card, and it may fail to load. If it does, ${FALLBACK_MODEL} through llama.cpp is the one to use.${ramText}` };
  return { tone: 'ok', text: `Your ${gpu.name} has ${memory} GB of video memory, enough for Strata.${ramText}` };
};

/** The Strata panel's live facts (page file, driver, what runs), refreshed when `token` changes; `null` asks for nothing. */
export function useStrataStatus(token: string | null): StrataStatus | null {
  const [status, setStatus] = useState<StrataStatus | null>(null);
  useEffect(() => {
    if (token == null) { setStatus(null); return undefined; }
    let live = true;
    libraryApi.strataStatus().then((next) => { if (live) setStatus(next); }).catch(() => { if (live) setStatus(null); });
    return () => { live = false; };
  }, [token]);
  return status;
}

/** Shown before a start: loading reads tens of gigabytes into memory. */
export function StrataStartConfirm({ name, busy, onCancel, onStart }: { name: string; busy: boolean; onCancel: () => void; onStart: () => void }) {
  return (
    <div className="lb-note warn lb-strata-confirm" role="group" aria-label={`Start ${name}`}>
      <TriangleAlert size={14} />
      <span>
        <strong>Before you start {name}.</strong> Loading it reads 35 to 55 GB into memory, so your PC may be slow or stop responding for 1 to 3 minutes, longest the first time. Save your work, and leave the window open until it says the model is ready.
      </span>
      <span className="lb-strata-confirm-actions">
        <button type="button" className="btn btn-small" onClick={onCancel}>Not now</button>
        <button type="button" className="btn btn-small btn-primary" disabled={busy} onClick={onStart}>
          {busy ? <LoaderCircle size={12} className="spin" /> : <Play size={11} />} Start
        </button>
      </span>
    </div>
  );
}

const rounded = (value: number) => value.toLocaleString('en-US');

/** The Strata section of a model page: engine, this PC, Strata's speeds and the page file warning. */
export function StrataNotes({ entry, hw, status }: { entry: LibraryEntry; hw: HardwareInfo | null; status: StrataStatus | null }) {
  const note = pcNote(hw, Math.min(...entry.variants.map((variant) => variant.minRamGb)));
  const rows = entry.variants.filter((variant) => STRATA_SPEEDS[variant.id]);
  return (
    <section className="lb-section lb-strata" aria-label="Running it with Strata">
      <h4 className="lb-h">Runs with Strata</h4>
      <p className="lb-desc">
        This model is too big for a usual graphics card, so it does not run through llama.cpp. Bhippi sets up <a className="lb-link" href="https://github.com/Niko1221/Strata" target="_blank" rel="noreferrer">Strata</a>, a free engine made for it (MIT license), inside its own folder. Pressing Download installs Strata and the model together, about 70 GB, and can be stopped and continued. Nothing leaves this PC.
      </p>

      {note && <div className={`lb-note${note.tone === 'ok' ? '' : ' warn'}`}><TriangleAlert size={14} /><span>{note.text}</span></div>}
      {status?.driverProblem && <div className="lb-note warn"><TriangleAlert size={14} /><span>{status.driverProblem}</span></div>}

      {status?.pageFile && (
        <div className="lb-note warn lb-strata-pagefile" role="group" aria-label="Windows page file">
          <TriangleAlert size={14} />
          <div>
            <strong>Set a fixed Windows page file before you start.</strong> {status.pageFile.summary}
            <ol className="lb-steps">{status.pageFile.steps.map((step) => <li key={step}>{step}</li>)}</ol>
          </div>
        </div>
      )}

      <table className="lb-speeds" aria-label="Speed reported by Strata">
        <caption>Reported by Strata (RTX 5070 12 GB, 64 GB of RAM). Tokens a second; a token is about three quarters of a word.</caption>
        <thead><tr><th scope="col">Size</th><th scope="col">Short chat</th><th scope="col">128K of text</th><th scope="col">Reading your prompt</th></tr></thead>
        <tbody>
          {rows.map((variant) => {
            const speed = STRATA_SPEEDS[variant.id];
            return <tr key={variant.id}><th scope="row">{variant.llm?.quant ?? variant.label}{variant.id.startsWith('coder') ? ' (Coder)' : ''}</th><td>{speed.short}</td><td>{speed.long}</td><td>{rounded(speed.prompt)}</td></tr>;
          })}
        </tbody>
      </table>
      {status && status.measured.length > 0 && (
        <div className="lb-plan" aria-label="Measured on this PC">
          <strong>Measured on this PC</strong> (one short check after the first start)
          <ul>
            {status.measured.map((check) => {
              const text = strataMeasuredText(check);
              const size = entry.variants.find((variant) => variant.id === check.variant);
              return text ? <li key={check.variant}>{size?.llm?.quant ?? size?.label ?? check.variant}: {text}</li> : null;
            })}
          </ul>
        </div>
      )}
      <p className="lb-plan">A card with less video memory is slower and one with more is faster. Swift runs at the same speed as the size it is based on.</p>
    </section>
  );
}
