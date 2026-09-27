// First run: where projects live, and which offline models to fetch.
//
// Shown once — until Settings.onboarded is true — over the editor. Five short panels: welcome,
// storage location, whether (and how) the AI may generate clips, a model checklist with sizes and recommended defaults, live download progress
// (the downloads keep going in the background once the user moves on), done. Every step can be
// skipped; nothing here is required for Bhippi to work, it only saves a trip to Settings later.
import { ArrowLeft, ArrowRight, AudioLines, Check, Cpu, FolderOpen, HardDrive, LoaderCircle, Mic, Scissors, Sparkles, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { DownloadProgress } from '../settings/DownloadProgress';
import { chooseStorageRoot } from '../settings/StorageSettings';
import { api, errorText, type ModelInfo, type StorageInfo } from '../lib/ipc';
import { jobsStore, useLiveJobs } from '../lib/jobsStore';
import { registerStorageRoot } from '../lib/storage';
import { AI_PACK_FEATURES, aiPackApi, aiPackReady, type AiPackStatus } from '../lib/aiPack';
import type { Job, Settings } from '../lib/types';
import { GenerationStep, type GenChoice } from './GenerationStep';
import { LOCAL_MODELS } from '../lib/modelAdvisor';
import { PixelStage } from '../settings/AvatarSettings';
import { CHARACTERS, type Character } from '../avatar/sprite';

type Props = {
  /** Saves a settings change right away (the storage root, the onboarded flag). */
  onPatch: (patch: Partial<Settings>) => void;
  /** Closes the onboarding for good (also called by Skip). */
  onDone: () => void;
};

type ItemId = 'roto' | 'transcribe' | 'voice' | 'ai';

/** One line of the checklist and the downloads it stands for. */
type Item = {
  id: ItemId;
  icon: typeof Scissors;
  title: string;
  blurb: string;
  /** Catalogue ids fetched with model_download, in order (runtime first). */
  models: string[];
  /** Installed as the one-click AI pack (ai_pack_install), instead of models. */
  pack?: boolean;
  sizeMb: number;
  installed: boolean;
  /** Parts of it this computer already had (found by the scan), which Bhippi uses instead of downloading. */
  found: string[];
  /** Why it cannot be chosen here, if it cannot. */
  unavailable?: string;
};

const STEPS = ['Welcome', 'Storage', 'Generation', 'Models', 'Downloading', 'Done'] as const;

const WHISPER_CHOICES = ['whisper-base', 'whisper-small', 'whisper-large-v3-turbo-q5'] as const;
const WHISPER_RECOMMENDED = 'whisper-large-v3-turbo-q5';

const size = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`);

export function Onboarding({ onPatch, onDone }: Props) {
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [pack, setPack] = useState<AiPackStatus | null>(null);
  const [whisper, setWhisper] = useState<string>(WHISPER_RECOMMENDED);
  const [voice, setVoice] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Set<ItemId>>(new Set(['roto', 'transcribe']));
  /** Job ids started for each item, and why an item could not start. */
  const [started, setStarted] = useState<Partial<Record<ItemId, string[]>>>({});
  const [failed, setFailed] = useState<Partial<Record<ItemId, string>>>({});
  const [busy, setBusy] = useState(false);
  const [genChoice, setGenChoice] = useState<GenChoice>({ cloud: false, local: false });
  const [localTasks, setLocalTasks] = useState<Set<string>>(new Set());
  const [localInstalled, setLocalInstalled] = useState<Set<string>>(new Set());
  /** Local generation model installs: job id, 'waiting' for the AI pack, or the error. */
  const [genJobs, setGenJobs] = useState<Record<string, { jobId?: string; waiting?: boolean; error?: string }>>({});
  const live = useLiveJobs();
  const [buddy, setBuddy] = useState<Character | null>(null);
  /** True while the computer is searched for models it already has. */
  const [scanning, setScanning] = useState(true);

  useEffect(() => {
    void api.storageInfo().then((info) => { setStorage(info); registerStorageRoot(info.root); }).catch(() => undefined);
    // Models this computer already has (another app's Whisper, a Kokoro pack in Downloads, an
    // older Bhippi folder) are found first, so they are ticked as there instead of downloaded again.
    const read = (models_: ModelInfo[]) => {
      setModels(models_);
      const voices = models_.filter((model) => model.kind === 'tts-voice');
      const firstVoice = voices.find((model) => model.installed)
        ?? voices.find((model) => model.recommended && model.languages.includes('en'))
        ?? voices.find((model) => model.recommended)
        ?? voices[0];
      setVoice(firstVoice?.id ?? null);
      // A Whisper model already here wins over downloading the recommended one.
      const have = WHISPER_CHOICES.find((id) => id === WHISPER_RECOMMENDED && models_.some((model) => model.id === id && model.installed))
        ?? WHISPER_CHOICES.find((id) => models_.some((model) => model.id === id && model.installed));
      if (have) setWhisper(have);
    };
    // The plain status shows the list straight away; the scan's answer replaces it (never the reverse).
    let scanned = false;
    void api.speechStatus().then((status) => { if (!scanned) read(status.models); }).catch(() => undefined);
    void api.modelsScan().then(([, status]) => { scanned = true; read(status.models); }).catch(() => undefined).finally(() => setScanning(false));
    void aiPackApi.status().then(setPack).catch(() => setPack(null));
    void api.localMediaStatus().then((status) => setLocalInstalled(new Set(status.tasks.filter((row) => row.configured).map((row) => row.task)))).catch(() => undefined);
  }, []);

  const byId = useMemo(() => new Map(models.map((model) => [model.id, model])), [models]);
  const pending = (ids: string[]) => ids.filter((id) => byId.get(id) && !byId.get(id)!.installed);
  const mb = (ids: string[]) => pending(ids).reduce((sum, id) => sum + (byId.get(id)?.sizeMb ?? 0), 0);
  const foundOf = (ids: string[]) => ids.map((id) => byId.get(id)).filter((model): model is ModelInfo => !!model?.external).map((model) => model.label);

  const items: Item[] = useMemo(() => {
    const matte = models.find((model) => model.kind === 'matte' && model.recommended) ?? models.find((model) => model.kind === 'matte');
    const rotoIds = matte ? [matte.id] : [];
    const transcribeIds = ['whisper-runtime', whisper];
    const voiceIds = ['kokoro-runtime', ...(voice ? [voice] : [])];
    const list: Item[] = [
      { id: 'roto', icon: Scissors, title: 'Roto · subject separation', blurb: 'Cuts a person out of their background, frame by frame, on this computer. Needed for text behind a subject and the Magic eraser.', models: rotoIds, sizeMb: mb(rotoIds), installed: rotoIds.length > 0 && pending(rotoIds).length === 0, found: foundOf(rotoIds) },
      { id: 'transcribe', icon: Mic, title: 'Transcription · Whisper', blurb: 'Speech to timed words for captions and text-based editing, offline.', models: transcribeIds, sizeMb: mb(transcribeIds), installed: pending(transcribeIds).length === 0 && models.length > 0, found: foundOf(transcribeIds) },
      { id: 'voice', icon: AudioLines, title: 'Voice · Kokoro', blurb: 'Natural, studio-clean voice-overs in English, Hindi and Hinglish, offline. Optional — ElevenLabs or OpenAI voices are used instead when you add a key.', models: voiceIds, sizeMb: mb(voiceIds), installed: pending(voiceIds).length === 0 && models.length > 0, found: foundOf(voiceIds) },
      {
        id: 'ai', icon: Cpu, title: `AI pack${pack?.cuda ? ' · uses your NVIDIA GPU' : ''}`, blurb: `${AI_PACK_FEATURES} — the Python runtime, PyTorch and the models, installed in one go. Optional; the rest of Bhippi works without it.`,
        models: [], pack: true, sizeMb: pack?.remainingMb ?? 4000, found: [],
        installed: aiPackReady(pack),
        unavailable: pack === null ? 'Could not check the AI pack — install it later in Settings › Local media.' : undefined,
      },
    ];
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models, whisper, voice, pack, byId]);

  const wantsLocal = genChoice.local && [...localTasks].some((task) => !localInstalled.has(task));
  const selected = items.filter((item) => (chosen.has(item.id) || (item.pack && wantsLocal)) && !item.installed && !item.unavailable);
  const genPending = genChoice.local ? [...localTasks].filter((task) => !localInstalled.has(task)) : [];
  const totalMb = selected.reduce((sum, item) => sum + item.sizeMb, 0) + genPending.reduce((sum, task) => sum + (LOCAL_MODELS.find((m) => m.task === task)?.downloadGb ?? 0) * 1024, 0);
  const downloadCount = selected.length + genPending.length;

  const go = (next: number) => {
    setDirection(next > step ? 1 : -1);
    setStep(Math.max(0, Math.min(STEPS.length - 1, next)));
  };

  /** The pixel avatar stays off unless the user picks a character here. */
  const pickBuddy = (id: Character | null) => {
    setBuddy(id);
    onPatch(id ? { avatar: true, avatarCharacter: id } : { avatar: false });
  };

  const finish = () => {
    onPatch({ onboarded: true });
    onDone();
  };

  /** Saves the generation choice: the cloud master switch and the local-generation switch. */
  const saveGenChoice = () => {
    onPatch({
      cloudGeneration: { enabled: genChoice.cloud },
      disableLocalGeneration: !genChoice.local,
    });
  };

  /** Installs the ticked local generation models, after the AI pack's Python when that is still coming. */
  const installLocal = async (packJob: string | null) => {
    const tasks = [...localTasks].filter((task) => !localInstalled.has(task));
    if (!tasks.length) return;
    setGenJobs(Object.fromEntries(tasks.map((task) => [task, packJob ? { waiting: true } : {}])));
    if (packJob) {
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const job = jobsStore.list().find((entry) => entry.id === packJob);
        if (!job || job.status === 'done') break;
        if (job.status === 'error' || job.status === 'cancelled') {
          setGenJobs(Object.fromEntries(tasks.map((task) => [task, { error: 'The AI pack did not install — download this model later in Settings › Local generation.' }])));
          return;
        }
      }
    }
    for (const task of tasks) {
      try {
        const jobId = await api.localMediaInstall(task);
        setGenJobs((current) => ({ ...current, [task]: { jobId } }));
        // One multi-gigabyte download at a time.
        for (;;) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          const job = jobsStore.list().find((entry) => entry.id === jobId);
          if (!job || job.status !== 'running') break;
        }
      } catch (error) {
        setGenJobs((current) => ({ ...current, [task]: { error: errorText(error) } }));
      }
    }
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

  const download = async (onlyGeneration = false) => {
    setBusy(true);
    const run = onlyGeneration ? selected.filter((item) => item.pack) : selected;
    const nextStarted: Partial<Record<ItemId, string[]>> = {};
    const nextFailed: Partial<Record<ItemId, string>> = {};
    let packJob: string | null = null;
    for (const item of run) {
      try {
        if (item.pack) {
          packJob = await aiPackApi.install();
          nextStarted[item.id] = [packJob];
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
    if (wantsLocal && !nextFailed.ai) void installLocal(packJob);
    go(4);
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
  const genRunning = Object.values(genJobs).some((entry) => entry.waiting || (entry.jobId && live.find((job) => job.id === entry.jobId)?.status === 'running'));
  const allDone = !genRunning && downloading.every((id) => { const item = items.find((entry) => entry.id === id); return !item || progressOf(item).state !== 'running'; });

  const toggle = (id: ItemId) => setChosen((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  return (
    <div className="onboarding" role="dialog" aria-modal="true" aria-label="Welcome to Bhippi Video Editor">
      <div className={`onboarding-card${step === 2 ? ' wide' : ''}`}>
        <header className="onboarding-head">
          <ol className="onboarding-steps" aria-label="Setup steps">
            {STEPS.map((name, index) => (
              <li key={name} className={index === step ? 'current' : index < step ? 'past' : ''} aria-current={index === step ? 'step' : undefined} title={name}>
                <span className="onboarding-dot">{index < step ? <Check size={10} /> : index + 1}</span>
                <span className="onboarding-step-name">{name}</span>
              </li>
            ))}
          </ol>
          {step < 5 && <button type="button" className="btn btn-ghost btn-small" onClick={finish}>Skip setup</button>}
        </header>

        <div key={step} className={`onboarding-panel from-${direction === 1 ? 'right' : 'left'}`}>
          {step === 0 && (
            <div className="onboarding-welcome">
              <img src="/bhippi.png" alt="" width={56} height={56} />
              <h2>Welcome to Bhippi Video Editor</h2>
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
              <p className="onboarding-lead">Bhippi makes one folder per project here. You can change this any time in Settings › Storage.</p>
              <div className="onboarding-location">
                <HardDrive size={18} />
                <code title={storage?.root}>{storage?.root ?? 'Documents\\Bhippi'}</code>
                <button type="button" className="btn" onClick={() => void changeStorage()}><FolderOpen size={14} /> Change…</button>
              </div>
              {storage?.custom && <button type="button" className="btn btn-ghost btn-small onboarding-reset" onClick={() => void resetStorage()}>Use the default ({storage.defaultRoot})</button>}
              {storageError && <p className="onboarding-error"><TriangleAlert size={13} /> {storageError}</p>}
              <div className="onboarding-tree" aria-label="Folder layout">
                <div className="t0">{storage?.root.split(/[\\/]/).pop() || 'Bhippi'}</div>
                <div className="t1">My project</div>
                {['Project', 'Footage', 'Downloads', 'Generated', 'Audio · Voice-overs, Recordings, SFX', 'Roto · Tracking · Clean plates', 'Renders · Exports', 'Storyboard · Research'].map((name) => (
                  <div key={name} className="t2">{name}</div>
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <GenerationStep choice={genChoice} onChoice={setGenChoice} localTasks={localTasks} onLocalTasks={setLocalTasks} installed={localInstalled} />
          )}

          {step === 3 && (
            <div className="onboarding-body">
              <h2>Download offline models</h2>
              <p className="onboarding-lead">Recommended picks are ticked. They download in the background — you can start editing straight away.</p>
              {genPending.length > 0 && <p className="muted small"><Sparkles size={12} /> Also downloading from your generation choice: {genPending.map((task) => LOCAL_MODELS.find((m) => m.task === task)?.label ?? task).join(', ')} (with the AI pack).</p>}
              {!models.length && <p className="muted small"><LoaderCircle size={12} className="spin" /> Reading the model catalogue…</p>}
              {models.length > 0 && scanning && <p className="muted small"><LoaderCircle size={12} className="spin" /> Checking this computer for models you already have…</p>}
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
                          {item.found.length > 0 && (
                            <span className="onboarding-model-found"><Check size={11} /> Already on this computer: {item.found.join(', ')}. Bhippi will use {item.found.length === 1 ? 'it' : 'them'}{item.installed ? '' : ' and only download the rest'}.</span>
                          )}
                        </span>
                        <span className="onboarding-model-size">
                          {item.installed
                            ? <span className="pill tone-ok" title={item.found.length ? 'Found on this computer — no download needed' : undefined}><Check size={11} /> {item.found.length ? 'Found on this PC' : 'Installed'}</span>
                            : item.unavailable ? 'Later' : `~${size(item.sizeMb)}`}
                        </span>
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
                                <em>{size(model.sizeMb)}{model.external ? ' · on this PC' : model.installed ? ' · installed' : ''}</em>
                              </label>
                            );
                          })}
                        </div>
                      )}
                      {item.id === 'voice' && on && !item.installed && models.filter((model) => model.kind === 'tts-voice').length > 1 && (
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

          {step === 4 && (
            <div className="onboarding-body">
              <h2>{allDone ? 'Downloads finished' : 'Downloading'}</h2>
              <p className="onboarding-lead">{allDone ? 'Everything you picked is ready.' : 'You can carry on — downloads keep running in the background, and Settings › Model Center shows them too.'}</p>
              <div className="onboarding-models">
                {downloading.length === 0 && Object.keys(failed).length === 0 && !Object.keys(genJobs).length && <p className="muted small">Nothing to download.</p>}
                {Object.entries(genJobs).map(([task, entry]) => {
                  const job = entry.jobId ? live.find((row) => row.id === entry.jobId) : undefined;
                  const state = entry.error || job?.status === 'error' || job?.status === 'cancelled' ? 'error' : job?.status === 'done' ? 'done' : 'running';
                  const model = LOCAL_MODELS.find((m) => m.task === task);
                  return (
                    <div key={task} className={`onboarding-model onboarding-progress state-${state}`}>
                      <div className="onboarding-model-main">
                        <span className="onboarding-state">{state === 'done' ? <Check size={14} /> : state === 'error' ? <TriangleAlert size={14} /> : <LoaderCircle size={14} className="spin" />}</span>
                        <Sparkles size={16} className="onboarding-model-icon" />
                        <span className="onboarding-model-copy">
                          <span className="onboarding-model-title">{model?.label ?? task} · {model?.kind === 'video' ? 'video' : 'image'} generation</span>
                          {state === 'error' ? <span className="onboarding-model-blurb error">{entry.error ?? job?.message}</span>
                            : entry.waiting ? <span className="onboarding-model-blurb">Waits for the AI pack to finish, then downloads (~{model?.downloadGb} GB).</span>
                            : <DownloadProgress job={{ progress: job?.status === 'done' ? 1 : job?.progress ?? 0, message: job?.message || 'Starting…' }} />}
                        </span>
                      </div>
                    </div>
                  );
                })}
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

          {step === 5 && (
            <div className="onboarding-welcome">
              <span className="onboarding-done"><Check size={28} /></span>
              <h2>You're set</h2>
              <p className="onboarding-lead">Projects are saved in <code>{storage?.root ?? 'Documents\\Bhippi'}</code>. Save a project and it goes to its own folder there, with everything the AI gathers sorted beside it.</p>
              <div className="onboarding-buddy">
                <strong>Want a pixel buddy?</strong>
                <span className="muted small">Optional — a little character on your timeline that acts out what Bhippi AI is doing. Off unless you pick one; change it any time in Settings › Avatar.</span>
                <div className="onboarding-buddy-row" role="radiogroup" aria-label="Pixel buddy">
                  <button type="button" role="radio" aria-checked={buddy === null} className={`onboarding-buddy-pick none${buddy === null ? ' active' : ''}`} onClick={() => pickBuddy(null)}>
                    <span>No thanks</span>
                  </button>
                  {CHARACTERS.map((entry) => (
                    <button key={entry.id} type="button" role="radio" aria-checked={buddy === entry.id} title={entry.title} className={`onboarding-buddy-pick${buddy === entry.id ? ' active' : ''}`} onClick={() => pickBuddy(entry.id)}>
                      <PixelStage anim={buddy === entry.id ? 'wave' : 'idle'} character={entry.id} scale={1} />
                      <span>{entry.name}</span>
                    </button>
                  ))}
                </div>
              </div>
              <p className="muted small">Change the location, models or voices any time in Settings.</p>
            </div>
          )}
        </div>

        <footer className="onboarding-foot">
          {step > 0 && step < 5 && step !== 4 ? <button type="button" className="btn btn-ghost" onClick={() => go(step - 1)}><ArrowLeft size={14} /> Back</button> : <span />}
          <span className="onboarding-foot-spacer" />
          {step === 0 && <button type="button" className="btn btn-primary" onClick={() => go(1)}>Get started <ArrowRight size={14} /></button>}
          {step === 1 && <button type="button" className="btn btn-primary" onClick={() => go(2)}>Continue <ArrowRight size={14} /></button>}
          {step === 2 && <button type="button" className="btn btn-primary" onClick={() => { saveGenChoice(); go(3); }}>Continue <ArrowRight size={14} /></button>}
          {step === 3 && (
            <>
              <button type="button" className="btn btn-ghost" onClick={() => (wantsLocal ? void download(true) : go(5))}>{wantsLocal ? 'Skip these' : 'Not now'}</button>
              <button type="button" className="btn btn-primary" onClick={() => void download()} disabled={busy || !downloadCount}>
                {busy ? <LoaderCircle size={14} className="spin" /> : <ArrowRight size={14} />} {downloadCount ? `Download ${downloadCount} · ~${size(totalMb)}` : 'Nothing selected'}
              </button>
            </>
          )}
          {step === 4 && <button type="button" className="btn btn-primary" onClick={() => go(5)}>{allDone ? 'Continue' : 'Continue in the background'} <ArrowRight size={14} /></button>}
          {step === 5 && <button type="button" className="btn btn-primary" onClick={finish}>Start editing <ArrowRight size={14} /></button>}
        </footer>
      </div>
    </div>
  );
}
