// "What can this computer generate?" — the measured hardware, then every local image and video
// model with its output quality, whether it runs here, how long it takes and a download button.
// The numbers come from lib/modelAdvisor; this file only lays them out.
import { useEffect, useState } from 'react';
import { Check, Cpu, Download, Film, HardDrive, Image as ImageIcon, MemoryStick, Sparkles, TriangleAlert } from 'lucide-react';
import { api, errorText, type HardwareInfo } from '../lib/ipc';
import { LOCAL_MODELS, QUALITY_LABELS, assess, formatMinutes, primaryGpu, recommend, type Fit, type LocalModel, type LocalModelKind } from '../lib/modelAdvisor';
import '../styles/generation.css';

let cached: Promise<HardwareInfo> | null = null;
/** One hardware reading per session: it spawns PowerShell and nvidia-smi, and the answer does not change. */
export function useHardware() {
  const [hw, setHw] = useState<HardwareInfo | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    cached ??= api.hardwareInfo();
    cached.then((value) => { if (live) setHw(value); }).catch((e) => { cached = null; if (live) setError(errorText(e)); });
    return () => { live = false; };
  }, []);
  return { hw, error };
}

/** Five segments, filled to the model's quality; tone follows the label. */
export function QualityMeter({ quality, dim = false, label }: { quality: number; dim?: boolean; label?: string }) {
  const tone = quality >= 4 ? 'high' : quality === 3 ? 'mid' : 'low';
  return (
    <span className={`gen-meter tone-${tone}${dim ? ' dim' : ''}`} role="meter" aria-valuemin={0} aria-valuemax={5} aria-valuenow={quality} aria-label={`Output quality: ${QUALITY_LABELS[quality] || 'none'}`}>
      <span className="gen-meter-bars" aria-hidden="true">{[1, 2, 3, 4, 5].map((step) => <i key={step} className={step <= quality ? 'on' : ''} />)}</span>
      <span className="gen-meter-label">{label ?? (QUALITY_LABELS[quality] || 'None')}</span>
    </span>
  );
}

const FIT_TONE: Record<Fit, 'ok' | 'warn' | 'error'> = { great: 'ok', ok: 'ok', slow: 'warn', no: 'error' };

/** The machine summary: GPU, VRAM, RAM and free disk, each measured, with the headline verdicts. */
export function HardwareCard({ hw, error }: { hw: HardwareInfo | null; error?: string }) {
  const gpu = primaryGpu(hw);
  const otherGpu = hw?.adapters?.find((adapter) => !/microsoft basic|remote/i.test(adapter.name));
  const best = (kind: LocalModelKind) => recommend(kind, hw);
  return (
    <div className="gen-hw">
      <div className="gen-hw-specs">
        <span><Cpu size={13} /> {gpu ? gpu.name : otherGpu?.name ?? (hw ? 'No dedicated GPU found' : error || 'Reading this computer…')}</span>
        <span><Sparkles size={13} /> {gpu ? `${(gpu.vramMb / 1024).toFixed(0)} GB VRAM${gpu.computeCap ? ` · compute ${gpu.computeCap}` : ''}` : otherGpu?.vramMb ? `${(otherGpu.vramMb / 1024).toFixed(0)} GB VRAM · no CUDA` : 'No CUDA'}</span>
        <span><MemoryStick size={13} /> {hw?.ramGb != null ? `${Math.round(hw.ramGb)} GB RAM` : 'RAM —'}</span>
        <span><HardDrive size={13} /> {hw?.diskFreeGb != null ? `${Math.round(hw.diskFreeGb)} GB free for models` : 'Disk —'}</span>
      </div>
      {hw && (
        <div className="gen-hw-verdicts">
          {(['video', 'image'] as const).map((kind) => {
            const pick = best(kind);
            return (
              <div key={kind} className="gen-hw-verdict">
                <span className="gen-hw-kind">{kind === 'video' ? <Film size={13} /> : <ImageIcon size={13} />} Best local {kind}</span>
                {pick ? <QualityMeter quality={pick.quality} label={`${QUALITY_LABELS[pick.quality]} · ${pick.label}`} /> : <QualityMeter quality={0} label={gpu ? 'Nothing runs well here' : 'Needs an NVIDIA GPU'} />}
              </div>
            );
          })}
        </div>
      )}
      {hw && !recommend('video', hw) && <p className="gen-hw-note">For video on this computer, a cloud connector (Settings › Connectors) gives far better results than any local model.</p>}
    </div>
  );
}

export type ModelInstall = { configured: boolean; downloading: boolean; progress?: number; active: boolean };

/** One model: quality meter, fit on this machine, time estimate, and its install action. */
export function ModelFitRow({ model, hw, install, onDownload, onUse, onChoose, compact = false, selected, onSelect }: {
  model: LocalModel; hw: HardwareInfo | null; install?: ModelInstall;
  onDownload?: () => void; onUse?: () => void; onChoose?: () => void;
  /** The onboarding version: a checkbox instead of buttons. */
  compact?: boolean; selected?: boolean; onSelect?: (on: boolean) => void;
}) {
  const a = assess(model, hw);
  const recommended = recommend(model.kind, hw)?.task === model.task;
  const installed = !!install?.configured;
  const cannot = a.fit === 'no' || (a.diskShort && !installed);
  return (
    <div className={`gen-model fit-${a.fit}${recommended ? ' recommended' : ''}${install?.active ? ' active' : ''}`}>
      {compact && (
        <input type="checkbox" aria-label={`Download ${model.label}`} checked={installed || !!selected} disabled={installed || cannot || !model.downloadable} onChange={(event) => onSelect?.(event.target.checked)} />
      )}
      <div className="gen-model-main">
        <div className="gen-model-title">
          <strong>{model.label}</strong>
          <span className="gen-model-maker">{model.maker}</span>
          {recommended && <span className="pill tone-ok">Best for this PC</span>}
          {install?.active && <span className="pill tone-ok"><Check size={11} /> In use</span>}
        </div>
        <span className="gen-model-output">{model.output} · {model.downloadable ? `${model.downloadGb} GB download` : 'bring your own checkpoint'} · {model.license}</span>
        <div className="gen-model-meters">
          <QualityMeter quality={model.quality} dim={a.fit === 'no'} />
          <span className={`pill tone-${FIT_TONE[a.fit]}`}>{a.fit === 'no' ? <TriangleAlert size={11} /> : <Check size={11} />} {a.verdict}</span>
          {a.minutes && <span className="gen-model-time">≈ {formatMinutes(a.minutes)} per {model.kind === 'video' ? '5 s clip' : 'image'}</span>}
        </div>
        {!compact && model.note && <span className="gen-model-note">{model.note}</span>}
        {a.reasons.length > 0 && <span className={`gen-model-why${a.fit === 'no' || a.diskShort ? ' bad' : ''}`}>{a.reasons.join(' ')}</span>}
        {install?.downloading && <span className="gen-model-progress"><i style={{ width: `${Math.round((install.progress ?? 0) * 100)}%` }} /></span>}
      </div>
      {!compact && (
        <div className="gen-model-actions">
          {installed
            ? (install?.active ? null : onUse && <button type="button" className="btn btn-small" onClick={onUse}>Use this</button>)
            : model.downloadable
              ? <button type="button" className="btn btn-small" disabled={cannot || install?.downloading || !onDownload} onClick={onDownload}
                  title={cannot ? a.reasons[0] : !onDownload ? 'Set up the Python runtime first' : undefined}>
                  <Download size={12} /> {install?.downloading ? 'Downloading…' : `Download · ${model.downloadGb} GB`}
                </button>
              : onChoose && <button type="button" className="btn btn-small" onClick={onChoose}>Choose file</button>}
        </div>
      )}
    </div>
  );
}

/** Both lists, video then image, for the Local generation page. */
export function LocalModelAdvisor({ installs, onDownload, onUse, onChoose, pythonReady }: {
  installs: Record<string, ModelInstall>;
  onDownload: (task: string) => void;
  onUse: (task: string) => void;
  onChoose: (task: string) => void;
  pythonReady: boolean;
}) {
  const { hw, error } = useHardware();
  return (
    <section className="provider-group gen-advisor">
      <h4><Cpu size={14} /> What this computer can generate</h4>
      <HardwareCard hw={hw} error={error} />
      {(['video', 'image'] as const).map((kind) => (
        <div key={kind} className="gen-model-list">
          <span className="gen-list-title">{kind === 'video' ? 'Video models' : 'Image models'}</span>
          {LOCAL_MODELS.filter((model) => model.kind === kind).map((model) => (
            <ModelFitRow key={model.task} model={model} hw={hw} install={installs[model.task]}
              onDownload={pythonReady ? () => onDownload(model.task) : undefined}
              onUse={() => onUse(model.task)} onChoose={() => onChoose(model.task)} />
          ))}
        </div>
      ))}
      <p className="group-blurb">Quality is the model’s own ceiling and does not drop on a slower card — it only takes longer. Times are estimates for your GPU tier.</p>
    </section>
  );
}
