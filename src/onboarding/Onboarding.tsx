// First run: where projects live, and which offline models to fetch.
//
// Shown once — until Settings.onboarded is true — over the editor. Five short panels: welcome,
// storage location, a model checklist with sizes and recommended defaults, live download progress
// (the downloads keep going in the background once the user moves on), done. Every step can be
// skipped; nothing here is required for Helios to work, it only saves a trip to Settings later.
import { ArrowLeft, ArrowRight, AudioLines, Check, Eraser, FolderOpen, HardDrive, LoaderCircle, Mic, Scissors, Sparkles, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { DownloadProgress } from '../settings/DownloadProgress';
import { chooseStorageRoot } from '../settings/StorageSettings';
import { api, errorText, type ModelInfo, type StorageInfo } from '../lib/ipc';
import { jobsStore, useLiveJobs } from '../lib/jobsStore';
import { registerStorageRoot } from '../lib/storage';
import type { Job, Settings } from '../lib/types';

type Props = {
  /** Saves a settings change right away (the storage root, the onboarded flag). */
  onPatch: (patch: Partial<Settings>) => void;
  /** Closes the onboarding for good (also called by Skip). */
  onDone: () => void;
};

type ItemId = 'roto' | 'transcribe' | 'voice' | 'eraser';

/** One line of the checklist and the downloads it stands for. */
type Item = {
  id: ItemId;
  icon: typeof Scissors;
  title: string;
  blurb: string;
  /** Catalogue ids fetched with model_download, in order (runtime first). */
  models: string[];
  /** Local media task installed with local_media_install, instead of models. */
  task?: string;
  sizeMb: number;
  installed: boolean;
  /** Why it cannot be chosen here, if it cannot. */
  unavailable?: string;
};

const STEPS = ['Welcome', 'Storage', 'Models', 'Downloading', 'Done'] as const;

const WHISPER_CHOICES = ['whisper-base', 'whisper-small', 'whisper-large-v3-turbo-q5'] as const;
const WHISPER_RECOMMENDED = 'whisper-large-v3-turbo-q5';

const size = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`);

export function Onboarding({ onPatch, onDone }: Props) {
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [python, setPython] = useState<{ configured: boolean; eraser: boolean } | null>(null);
  const [whisper, setWhisper] = useState<string>(WHISPER_RECOMMENDED);
  const [voice, setVoice] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Set<ItemId>>(new Set(['roto', 'transcribe']));
  /** Job ids started for each item, and why an item could not start. */
  const [started, setStarted] = useState<Partial<Record<ItemId, string[]>>>({});
  const [failed, setFailed] = useState<Partial<Record<ItemId, string>>>({});
  const [busy, setBusy] = useState(false);
  const live = useLiveJobs();

  useEffect(() => {
    void api.storageInfo().then((info) => { setStorage(info); registerStorageRoot(info.root); }).catch(() => undefined);
    void api.speechStatus().then((status) => {
      setModels(status.models);
      const firstVoice = status.models.find((model) => model.kind === 'tts-voice' && model.recommended && model.languages.includes('en'))
        ?? status.models.find((model) => model.kind === 'tts-voice' && model.recommended)
        ?? status.models.find((model) => model.kind === 'tts-voice');
      setVoice(firstVoice?.id ?? null);
    }).catch(() => undefined);
    void api.localMediaStatus().then((status) => {
      const erase = status.tasks.find((task) => task.task === 'erase');
      setPython({ configured: status.pythonConfigured, eraser: !!erase?.verified || !!erase?.configured });
    }).catch(() => setPython({ configured: false, eraser: false }));
  }, []);

  const byId = useMemo(() => new Map(models.map((model) => [model.id, model])), [models]);
  const pending = (ids: string[]) => ids.filter((id) => byId.get(id) && !byId.get(id)!.installed);
  const mb = (ids: string[]) => pending(ids).reduce((sum, id) => sum + (byId.get(id)?.sizeMb ?? 0), 0);

  const items: Item[] = useMemo(() => {
    const matte = models.find((model) => model.kind === 'matte' && model.recommended) ?? models.find((model) => model.kind === 'matte');
    const rotoIds = matte ? [matte.id] : [];
    const transcribeIds = ['whisper-runtime', whisper];
    const voiceIds = ['piper-runtime', ...(voice ? [voice] : [])];
    const list: Item[] = [
      { id: 'roto', icon: Scissors, title: 'Roto · subject separation', blurb: 'Cuts a person out of their background, frame by frame, on this computer. Needed for text behind a subject and the Magic eraser.', models: rotoIds, sizeMb: mb(rotoIds), installed: rotoIds.length > 0 && pending(rotoIds).length === 0 },
      { id: 'transcribe', icon: Mic, title: 'Transcription · Whisper', blurb: 'Speech to timed words for captions and text-based editing, offline.', models: transcribeIds, sizeMb: mb(transcribeIds), installed: pending(transcribeIds).length === 0 && models.length > 0 },
      { id: 'voice', icon: AudioLines, title: 'Voice · Piper', blurb: 'Reads a script aloud for voice-overs, offline. Optional — cloud voices work with a key.', models: voiceIds, sizeMb: mb(voiceIds), installed: pending(voiceIds).length === 0 && models.length > 0 },
      {
        id: 'eraser', icon: Eraser, title: 'Magic eraser · LaMa', blurb: 'Paints a clean background plate where a subject was, so graphics can sit behind them.', models: [], task: 'erase', sizeMb: 200,
        installed: !!python?.eraser,
        unavailable: python && !python.configured ? 'Needs the local media Python — available later in Settings › Local media.' : undefined,
      },
    ];
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models, whisper, voice, python, byId]);

  const selected = items.filter((item) => chosen.has(item.id) && !item.installed && !item.unavailable);
  const totalMb = selected.reduce((sum, item) => sum + item.sizeMb, 0);

  const go = (next: number) => {
    setDirection(next > step ? 1 : -1);
    setStep(Math.max(0, Math.min(STEPS.length - 1, next)));
  };

  const finish = () => {
    onPatch({ onboarded: true });
    onDone();
  };

  const changeStorage = async () => {
    setStorageError(null);
    try {
      const info = await chooseStorageRoot(storage?.root ?? null);
      if (info) {
        setStorage(info);
        onPatch({ storageRoot: info.custom ? info.root : null });
      }
    } catch (error) {
      setStorageError(errorText(error));
    }
  };

  const resetStorage = async () => {
    setStorageError(null);
    try {
      const info = await api.storageSetRoot(null);
      registerStorageRoot(info.root);
      setStorage(info);
      onPatch({ storageRoot: null });
    } catch (error) {
      setStorageError(errorText(error));
    }
  };

  /** A download that is already running is joined rather than reported as a failure. */
  const startModel = async (id: string): Promise<string> => {
    try {
      return await api.modelDownload(id);
    } catch (error) {
      const label = byId.get(id)?.label ?? id;
      const running = jobsStore.list().find((job) => job.kind === 'model' && job.status === 'running' && job.label.endsWith(label));
      if (running) return running.id;
      throw error;
    }
  };

  const download = async () => {
    setBusy(true);
    const nextStarted: Partial<Record<ItemId, string[]>> = {};
    const nextFailed: Partial<Record<ItemId, string>> = {};
    for (const item of selected) {
      try {
        if (item.task) {
          nextStarted[item.id] = [await api.localMediaInstall(item.task)];
        } else {
          const ids: string[] = [];
          for (const model of pending(item.models)) ids.push(await startModel(model));
          nextStarted[item.id] = ids;
        }
      } catch (error) {
        nextFailed[item.id] = errorText(error);
      }
    }
    setStarted(nextStarted);
    setFailed(nextFailed);
    setBusy(false);
    go(3);
  };

  const progressOf = (item: Item): { state: 'running' | 'done' | 'error' | 'idle'; job: { progress: number; message: string } } => {
    if (failed[item.id]) return { state: 'error', job: { progress: 0, message: failed[item.id]! } };
    const ids = started[item.id] ?? [];
    const jobs = ids.map((id) => live.find((job) => job.id === id)).filter((job): job is Job => !!job);
    if (!ids.length) return { state: 'idle', job: { progress: 0, message: '' } };
    const error = jobs.find((job) => job.status === 'error' || job.status === 'cancelled');
    if (error) return { state: 'error', job: { progress: 0, message: error.message || 'Download failed — retry in Settings.' } };
    const progress = jobs.length ? jobs.reduce((sum, job) => sum + (job.status === 'done' ? 1 : job.progress), 0) / ids.length : 0;
    const done = jobs.length === ids.length && jobs.every((job) => job.status === 'done');
    const current = jobs.find((job) => job.status === 'running');
    return { state: done ? 'done' : 'running', job: { progress: done ? 1 : progress, message: done ? 'Installed' : current?.message || 'Starting…' } };
  };

  const downloading = Object.keys(started) as ItemId[];
  const allDone = downloading.every((id) => { const item = items.find((entry) => entry.id === id); return !item || progressOf(item).state !== 'running'; });

  const toggle = (id: ItemId) => setChosen((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  return (
    <div className="onboarding" role="dialog" aria-modal="true" aria-label="Welcome to Helios">
      <div className="onboarding-card">
        <header className="onboarding-head">
          <ol className="onboarding-steps" aria-label="Setup steps">
            {STEPS.map((name, index) => (
              <li key={name} className={index === step ? 'current' : index < step ? 'past' : ''} aria-current={index === step ? 'step' : undefined}>
                <span className="onboarding-dot">{index < step ? <Check size={10} /> : index + 1}</span>
                <span className="onboarding-step-name">{name}</span>
              </li>
            ))}
          </ol>
          {step < 4 && <button type="button" className="btn btn-ghost btn-small" onClick={finish}>Skip setup</button>}
        </header>

        <div key={step} className={`onboarding-panel from-${direction === 1 ? 'right' : 'left'}`}>
          {step === 0 && (
            <div className="onboarding-welcome">
              <img src="/helios.svg" alt="" width={56} height={56} />
              <h2>Welcome to Helios</h2>
              <p className="onboarding-lead">A video and motion studio that runs on your own computer. Two quick choices and you're editing.</p>
              <ul className="onboarding-points">
                <li><HardDrive size={15} /><span><strong>Every project gets its own folder</strong> — downloads, generated media, voice-overs, mattes and exports, sorted by kind.</span></li>
                <li><Sparkles size={15} /><span><strong>Models on demand</strong> — fetch only the offline models you want; everything can be added later in Settings.</span></li>
                <li><Check size={15} /><span><strong>Your footage stays here</strong> — rendering, transcription and roto run locally.</span></li>
              </ul>
            </div>
          )}

          {step === 1 && (
            <div className="onboarding-body">
              <h2>Where should projects live?</h2>
              <p className="onboarding-lead">Helios makes one folder per project here. You can change this any time in Settings › Storage.</p>
              <div className="onboarding-location">
                <HardDrive size={18} />
                <code title={storage?.root}>{storage?.root ?? 'Documents\\Helios'}</code>
                <button type="button" className="btn" onClick={() => void changeStorage()}><FolderOpen size={14} /> Change…</button>
              </div>
              {storage?.custom && <button type="button" className="btn btn-ghost btn-small onboarding-reset" onClick={() => void resetStorage()}>Use the default ({storage.defaultRoot})</button>}
              {storageError && <p className="onboarding-error"><TriangleAlert size={13} /> {storageError}</p>}
              <div className="onboarding-tree" aria-label="Folder layout">
                <div className="t0">{storage?.root.split(/[\\/]/).pop() || 'Helios'}</div>
                <div className="t1">My project</div>
                {['Project', 'Footage', 'Downloads', 'Generated', 'Audio · Voice-overs, Recordings, SFX', 'Roto · Tracking · Clean plates', 'Renders · Exports', 'Storyboard · Research'].map((name) => (
                  <div key={name} className="t2">{name}</div>
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="onboarding-body">
              <h2>Download offline models</h2>
              <p className="onboarding-lead">Recommended picks are ticked. They download in the background — you can start editing straight away.</p>
              {!models.length && <p className="muted small"><LoaderCircle size={12} className="spin" /> Reading the model catalogue…</p>}
              <div className="onboarding-models">
                {items.map((item) => {
                  const on = chosen.has(item.id) && !item.unavailable;
                  const disabled = item.installed || !!item.unavailable;
                  return (
                    <div key={item.id} className={`onboarding-model${on && !item.installed ? ' on' : ''}${disabled ? ' disabled' : ''}`}>
                      <label className="onboarding-model-main">
                        <input type="checkbox" checked={item.installed || on} disabled={disabled} onChange={() => toggle(item.id)} />
                        <item.icon size={16} className="onboarding-model-icon" />
                        <span className="onboarding-model-copy">
                          <span className="onboarding-model-title">
                            {item.title}
                            {item.id === 'roto' && !item.installed && <span className="pill tone-ok">Recommended</span>}
                          </span>
                          <span className="onboarding-model-blurb">{item.unavailable ?? item.blurb}</span>
                        </span>
                        <span className="onboarding-model-size">{item.installed ? <span className="pill tone-ok"><Check size={11} /> Installed</span> : item.unavailable ? 'Later' : `~${size(item.sizeMb)}`}</span>
                      </label>
                      {item.id === 'transcribe' && on && !item.installed && (
                        <div className="onboarding-choice" role="radiogroup" aria-label="Whisper model">
                          {WHISPER_CHOICES.map((id) => {
                            const model = byId.get(id);
                            if (!model) return null;
                            return (
                              <label key={id} className={whisper === id ? 'selected' : ''}>
                                <input type="radio" name="whisper" checked={whisper === id} onChange={() => setWhisper(id)} />
                                <span>{model.label.replace(/^Whisper /, '')}{id === WHISPER_RECOMMENDED ? ' · recommended' : ''}</span>
                                <em>{size(model.sizeMb)}{model.installed ? ' · installed' : ''}</em>
                              </label>
                            );
                          })}
                        </div>
                      )}
                      {item.id === 'voice' && on && !item.installed && (
                        <div className="onboarding-choice">
                          <select value={voice ?? ''} onChange={(event) => setVoice(event.target.value || null)} aria-label="Voice">
                            {models.filter((model) => model.kind === 'tts-voice').map((model) => (
                              <option key={model.id} value={model.id}>{model.label} · {size(model.sizeMb)}</option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="onboarding-body">
              <h2>{allDone ? 'Downloads finished' : 'Downloading'}</h2>
              <p className="onboarding-lead">{allDone ? 'Everything you picked is ready.' : 'You can carry on — downloads keep running in the background, and Settings › Model Center shows them too.'}</p>
              <div className="onboarding-models">
                {downloading.length === 0 && Object.keys(failed).length === 0 && <p className="muted small">Nothing to download.</p>}
                {items.filter((item) => started[item.id] || failed[item.id]).map((item) => {
                  const { state, job } = progressOf(item);
                  return (
                    <div key={item.id} className={`onboarding-model onboarding-progress state-${state}`}>
                      <div className="onboarding-model-main">
                        <span className="onboarding-state">{state === 'done' ? <Check size={14} /> : state === 'error' ? <TriangleAlert size={14} /> : <LoaderCircle size={14} className="spin" />}</span>
                        <item.icon size={16} className="onboarding-model-icon" />
                        <span className="onboarding-model-copy">
                          <span className="onboarding-model-title">{item.title}</span>
                          {state === 'error' ? <span className="onboarding-model-blurb error">{job.message}</span> : <DownloadProgress job={job} />}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="onboarding-welcome">
              <span className="onboarding-done"><Check size={28} /></span>
              <h2>You're set</h2>
              <p className="onboarding-lead">Projects are saved in <code>{storage?.root ?? 'Documents\\Helios'}</code>. Save a project and it goes to its own folder there, with everything the AI gathers sorted beside it.</p>
              <p className="muted small">Change the location, models or voices any time in Settings.</p>
            </div>
          )}
        </div>

        <footer className="onboarding-foot">
          {step > 0 && step < 4 && step !== 3 ? <button type="button" className="btn btn-ghost" onClick={() => go(step - 1)}><ArrowLeft size={14} /> Back</button> : <span />}
          <span className="onboarding-foot-spacer" />
          {step === 0 && <button type="button" className="btn btn-primary" onClick={() => go(1)}>Get started <ArrowRight size={14} /></button>}
          {step === 1 && <button type="button" className="btn btn-primary" onClick={() => go(2)}>Continue <ArrowRight size={14} /></button>}
          {step === 2 && (
            <>
              <button type="button" className="btn btn-ghost" onClick={() => go(4)}>Not now</button>
              <button type="button" className="btn btn-primary" onClick={() => void download()} disabled={busy || !selected.length}>
                {busy ? <LoaderCircle size={14} className="spin" /> : <ArrowRight size={14} />} {selected.length ? `Download ${selected.length} · ~${size(totalMb)}` : 'Nothing selected'}
              </button>
            </>
          )}
          {step === 3 && <button type="button" className="btn btn-primary" onClick={() => go(4)}>{allDone ? 'Continue' : 'Continue in the background'} <ArrowRight size={14} /></button>}
          {step === 4 && <button type="button" className="btn btn-primary" onClick={finish}>Start editing <ArrowRight size={14} /></button>}
        </footer>
      </div>
    </div>
  );
}
