// Settings › Speech & voice: downloading the offline speech models, pointing at ones already
// installed, and choosing the voice a script is read in.
//
// Bhippi ships no speech model — between them they are gigabytes, and most people only want
// one language. Everything here is fetched on demand into the Bhippi data folder, or detected
// wherever the user already keeps it.
import { HardwareSummary } from './HardwareSummary';
import { LocalMediaSettings } from './LocalMediaSettings';
import { DownloadProgress } from './DownloadProgress';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import {
  Check, CloudOff, Download, FolderOpen, Languages, LoaderCircle, Mic, Play, Trash2, TriangleAlert, Volume2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '../components/ui';
import { api, errorText, events, fileSrc, type CloudSpeechModels, type ModelInfo, type ServiceKey, type SpeechStatus, type TranscribeEngineOption, type Voice } from '../lib/ipc';
import type { Job, Settings, TranscribeEngine, VoiceMode } from '../lib/types';

type Props = {
  settings: Settings;
  onSettings: (settings: Settings) => void;
  jobs: Job[];
};

/** What each reading mode does, in the order they make sense to try. */
const MODES: { id: VoiceMode; label: string; blurb: string }[] = [
  { id: 'auto', label: 'Auto', blurb: 'Devanagari is read in Hindi, everything else in English.' },
  { id: 'hinglish', label: 'Hinglish', blurb: 'Word by word: in "yaar ye transition bahut smooth hai" the Hindi words get Hindi pronunciation and the English ones English — all in one voice, the way it is actually spoken.' },
  { id: 'hindi-roman', label: 'Romanised Hindi', blurb: 'The whole script is Hindi typed in Latin letters — transliterated, then read in Hindi.' },
  { id: 'en', label: 'English only', blurb: 'One voice, no splitting.' },
  { id: 'hi', label: 'Hindi only', blurb: 'One voice, transliterating anything still in Latin letters.' },
];

const SAMPLES: Record<VoiceMode, string> = {
  auto: 'This is how your voice-over will sound.',
  hinglish: 'Yaar ye transition bahut smooth hai, dekho.',
  'hindi-roman': 'Namaste, main Bhippi hoon.',
  en: 'This is how your voice-over will sound.',
  hi: 'नमस्ते दोस्तों, आज हम एक बहुत मज़ेदार वीडियो बनाने वाले हैं।',
};

const LANGUAGE_LABEL: Record<string, string> = {
  en: 'English',
  hi: 'Hindi',
  hinglish: 'Hinglish',
  multilingual: 'Any language',
};

const size = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`);

export function SpeechSettings({ settings, onSettings, jobs }: Props) {
  const toast = useToast();
  const [status, setStatus] = useState<SpeechStatus | null>(null);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [cloudModels, setCloudModels] = useState<CloudSpeechModels | null>(null);
  const [services, setServices] = useState<ServiceKey[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const player = useRef<HTMLAudioElement | null>(null);

  const speech = settings.speech;
  const mode: VoiceMode = speech?.voiceMode ?? 'auto';

  useEffect(() => {
    void api.serviceKeys().then(setServices).catch(() => undefined);
  }, []);

  // The models each keyed voice service offers, re-read when a key comes or goes.
  useEffect(() => {
    void api.speechCloudModels().then(setCloudModels).catch(() => setCloudModels(null));
    void api.speechVoices().then(setVoices).catch(() => undefined);
  }, [services]);

  // Which transcribers could run: re-read whenever a key or a model comes or goes.
  const [engineOptions, setEngineOptions] = useState<TranscribeEngineOption[]>([]);
  useEffect(() => {
    void api.transcribeEngineOptions().then(setEngineOptions).catch(() => undefined);
  }, [services, status]);

  const saveServiceKey = useCallback(
    async (id: string, key: string) => {
      const rows = await api.serviceSetKey(id, key);
      setServices(rows);
      const row = rows.find((item) => item.id === id);
      toast({
        tone: 'success',
        title: key.trim() ? `${row?.label ?? id} key saved` : `${row?.label ?? id} key removed`,
        body: key.trim() ? 'It is in this computer\u2019s credential store, not in the project file.' : '',
      });
    },
    [toast],
  );

  const refresh = useCallback(async () => {
    try {
      const [next, list] = await Promise.all([api.speechStatus(), api.speechVoices()]);
      setStatus(next);
      setVoices(list);
    } catch (error) {
      toast({ tone: 'error', title: 'Could not read the speech models', body: errorText(error) });
    }
  }, [toast]);

  useEffect(() => {
    void refresh();
    const stop = events.models(() => void refresh());
    return () => {
      void stop.then((off) => off());
      player.current?.pause();
    };
  }, [refresh]);

  // A finished download is announced on bhippi://models, but a failed one is only a job — so
  // watch the jobs too and re-read once none are running.
  const downloading = useMemo(() => {
    const running: Record<string, { progress: number; message: string }> = {};
    for (const job of jobs) {
      if (job.kind === 'model' && job.status === 'running') running[job.label.replace(/^Downloading /, '')] = job;
    }
    return running;
  }, [jobs]);

  const save = async (patch: Partial<Settings['speech']>) => {
    try {
      onSettings(await api.settingsSave({ ...settings, speech: { ...speech, ...patch } }));
    } catch (error) {
      toast({ tone: 'error', title: 'Could not save that', body: errorText(error) });
    }
  };

  const download = async (model: ModelInfo) => {
    try {
      await api.modelDownload(model.id);
      toast({ tone: 'info', title: `Downloading ${model.label}`, body: `${size(model.sizeMb)} — it keeps going if you close this window.` });
    } catch (error) {
      toast({ tone: 'error', title: `Could not download ${model.label}`, body: errorText(error) });
    }
  };

  const remove = async (model: ModelInfo) => {
    setBusy(model.id);
    try {
      setStatus(await api.modelDelete(model.id));
      setVoices(await api.speechVoices());
      toast({ tone: 'info', title: `${model.label} removed`, body: `${size(model.sizeMb)} freed.` });
    } catch (error) {
      toast({ tone: 'error', title: `Could not remove ${model.label}`, body: errorText(error) });
    } finally {
      setBusy(null);
    }
  };

  const locate = async (runtime: 'whisper' | 'tts') => {
    const picked = await openDialog({ title: runtime === 'whisper' ? 'Pick whisper-cli' : 'Pick the sherpa-onnx C library (sherpa-onnx-c-api)' });
    if (typeof picked !== 'string') return;
    setBusy(runtime);
    try {
      const next = await api.speechLocate(runtime, picked);
      setStatus(next);
      // The backend stores the program's path in the settings itself: read them back, or the next save undoes it.
      onSettings(await api.settingsGet());
      const found = runtime === 'whisper' ? next.whisper.found : next.tts.found;
      toast(found
        ? { tone: 'success', title: 'Found it', body: (runtime === 'whisper' ? next.whisper.path : next.tts.path) ?? '' }
        : { tone: 'error', title: 'That is not the right program', body: runtime === 'whisper' ? 'Pick whisper-cli (older builds call it main).' : 'Pick sherpa-onnx-c-api from a sherpa-onnx v1.13.8 shared build.' });
    } catch (error) {
      toast({ tone: 'error', title: 'Could not use that path', body: errorText(error) });
    } finally {
      setBusy(null);
    }
  };

  const preview = async () => {
    setPreviewing(true);
    try {
      const path = await api.speechPreview(SAMPLES[mode], speech?.voice ?? null, mode);
      player.current?.pause();
      const audio = new Audio(fileSrc(path));
      player.current = audio;
      await audio.play();
    } catch (error) {
      toast({ tone: 'error', title: 'Could not speak that', body: errorText(error) });
    } finally {
      setPreviewing(false);
    }
  };

  const models = status?.models ?? [];
  const sttModels = models.filter((model) => model.kind === 'stt-model');
  const ttsVoices = models.filter((model) => model.kind === 'tts-voice');
  const whisperRuntime = models.find((model) => model.kind === 'stt-runtime');
  const kokoroRuntime = models.find((model) => model.kind === 'tts-runtime');
  const sttReady = (status?.whisper.found ?? false) && sttModels.some((model) => model.installed);
  // Only Kokoro splits a line between speakers; a cloud voice reads Hindi itself.
  const hindiVoices = voices.filter((voice) => voice.engine === 'kokoro' && voice.languages.includes('hi'));
  const cloudVoices = voices.filter((voice) => !voice.offline);
  const offlineVoices = voices.filter((voice) => voice.offline);
  // What "Automatic" resolves to today — the same order the backend uses.
  const automatic = voices.find((voice) => voice.engine === 'elevenlabs') ?? voices.find((voice) => voice.id === 'openai:coral') ?? voices.find((voice) => voice.id === 'kokoro:af_heart');
  const hasEleven = voices.some((voice) => voice.engine === 'elevenlabs');
  const hasOpenAi = voices.some((voice) => voice.engine === 'openai');

  // Every model/runtime row below draws its own download progress. A running job whose label
  // matches none of them — stale, or from a model this build no longer lists — would otherwise
  // vanish silently instead of showing the user their download is still going.
  const knownLabels = new Set([...models.map((model) => model.label), whisperRuntime?.label, kokoroRuntime?.label].filter((label): label is string => !!label));
  const otherJobs = jobs.filter((job) => job.kind === 'model' && job.status === 'running' && !knownLabels.has(job.label.replace(/^Downloading /, '')));

  return (
    <div className="speech-settings">
      <div className="settings-intro">
        <div>
          <h3>Model Center</h3>
          <p>
            Transcription and voice-over can both run on this computer — nothing is uploaded, nothing is metered,
            and there is no length limit. Bhippi ships neither model, so download the ones you need, or point it at
            copies you already have.
          </p>
        </div>
        {status && (
          <button type="button" className="btn" onClick={() => void api.openPath(status.folder)}>
            <FolderOpen size={14} /> Models folder
          </button>
        )}
      </div>

      {otherJobs.length > 0 && (
        <section className="provider-group">
          {otherJobs.map((job) => (
            <div key={job.id} className="provider-row model-row">
              <div className="model-icon"><Download size={16} /></div>
              <div className="provider-main">
                <div className="provider-title"><strong>{job.label}</strong></div>
                <DownloadProgress job={job} />
              </div>
              <div className="provider-actions">
                <button type="button" className="btn btn-small btn-ghost" onClick={() => void api.jobCancel(job.id)}>Cancel</button>
              </div>
            </div>
          ))}
        </section>
      )}
      <HardwareSummary />
      <section className="provider-group"><h4>Matting and roto</h4><p className="group-blurb">Robust Video Matting remains the working fallback. Segmentation masks are never treated as production alpha automatically: candidates require trimap refinement, edge review, color-management checks and a benchmark on your footage.</p>{models.filter(model=>model.kind==='matte').map(model=><ModelRow key={model.id} model={model} job={downloading[model.label]} busy={busy===model.id} onDownload={()=>void download(model)} onRemove={()=>void remove(model)}/>)}</section>
      <LocalMediaSettings settings={settings} onSettings={onSettings} rotoOnly />
      <details className="provider-group"><summary>Other Roto engines · not integrated</summary><p className="group-blurb">These engines do not yet have working Bhippi adapters. Their runtime and model terms still need checking before an integration is offered. Use the downloadable SAM + ViTMatte engine above.</p>{models.filter(model=>model.kind==='matte-candidate' && !['sam2.1', 'vitmatte'].includes(model.id)).map(model=><ModelRow key={model.id} model={model} job={downloading[model.label]} busy={busy===model.id} onDownload={()=>void download(model)} onRemove={()=>void remove(model)}/>)}</details>
      {/* ── transcription ─────────────────────────────────────────── */}
      <section className="provider-group">
        <h4><Mic size={14} /> Transcription</h4>
        <p className="group-blurb">
          Turns the sound in your clips into timed words for the Subtitles panel. Auto uses a speech-to-text key first
          — Deepgram, then ElevenLabs Scribe; both separate speakers and take long files. Without one it uses an AI
          provider key that can hear audio (OpenAI, Groq, Mistral, Google Gemini or OpenRouter), and then the offline
          model when one is downloaded. Your ElevenLabs key under Voice-over also turns on Scribe transcription.
        </p>

        <ServiceKeyField row={services.find((item) => item.id === 'deepgram')} onSave={saveServiceKey} />

        {whisperRuntime && (
          <RuntimeCard
            model={whisperRuntime}
            found={status?.whisper.found ?? false}
            path={status?.whisper.path ?? null}
            source={status?.whisper.source ?? ''}
            job={downloading[whisperRuntime.label]}
            onDownload={() => void download(whisperRuntime)}
            onLocate={() => void locate('whisper')}
            busy={busy === 'whisper'}
          />
        )}

        <TranscriberChoice
          value={speech?.transcribeEngine ?? 'auto'}
          options={engineOptions}
          onChange={(value) => void save({ transcribeEngine: value })}
        />

        <label className="field speech-field">
          <span>Offline model</span>
          <select
            value={speech?.transcribeModel ?? ''}
            onChange={(event) => void save({ transcribeModel: event.target.value || null })}
            disabled={!sttModels.some((model) => model.installed)}
          >
            <option value="">Best one downloaded</option>
            {sttModels.filter((model) => model.installed).map((model) => (
              <option key={model.id} value={model.id}>{model.label}</option>
            ))}
          </select>
          <span className="field-hint">
            {sttReady
              ? 'Ready. Auto uses it when no key can transcribe; Offline only uses nothing else.'
              : 'Download whisper.cpp and one model below to transcribe without a key.'}
          </span>
        </label>

        {sttModels.map((model) => (
          <ModelRow
            key={model.id}
            model={model}
            job={downloading[model.label]}
            busy={busy === model.id}
            onDownload={() => void download(model)}
            onRemove={() => void remove(model)}
          />
        ))}
      </section>

      {/* ── voice ─────────────────────────────────────────────────── */}
      <section className="provider-group">
        <h4><Volume2 size={14} /> Voice-over</h4>
        <p className="group-blurb">
          Reads a script aloud and drops the take in your project. With an ElevenLabs or OpenAI key saved, their voices
          are used; otherwise Kokoro reads it on this computer — natural English, Hindi and Hinglish, free, and nothing is
          uploaded. Every take is cleaned up and levelled to the loudness online platforms play speech at.
        </p>

        <ServiceKeyField row={services.find((item) => item.id === 'elevenlabs')} onSave={saveServiceKey} />

        {kokoroRuntime && (
          <RuntimeCard
            model={kokoroRuntime}
            found={status?.tts.found ?? false}
            path={status?.tts.path ?? null}
            source={status?.tts.source ?? ''}
            job={downloading[kokoroRuntime.label]}
            onDownload={() => void download(kokoroRuntime)}
            onLocate={() => void locate('tts')}
            busy={busy === 'tts'}
          />
        )}

        <div className="field-row">
          <label className="field">
            <span>Voice</span>
            <select value={speech?.voice ?? ''} onChange={(event) => void save({ voice: event.target.value || null })} disabled={!voices.length}>
              <option value="">{automatic ? `Automatic — ${automatic.label}` : 'No voice ready yet'}</option>
              {cloudVoices.length > 0 && (
                <optgroup label="Cloud">
                  {cloudVoices.map((voice) => <option key={voice.id} value={voice.id}>{voice.label}</option>)}
                </optgroup>
              )}
              {offlineVoices.length > 0 && (
                <optgroup label="Offline · Kokoro">
                  {offlineVoices.map((voice) => <option key={voice.id} value={voice.id}>{voice.label}</option>)}
                </optgroup>
              )}
            </select>
          </label>
          <label className="field">
            <span>Hindi voice, for Hinglish</span>
            <select
              value={speech?.hindiVoice ?? ''}
              onChange={(event) => void save({ hindiVoice: event.target.value || null })}
              disabled={!hindiVoices.length}
            >
              <option value="">{hindiVoices.length ? `Automatic — ${hindiVoices[0].label}` : 'Download the Kokoro voices first'}</option>
              {hindiVoices.map((voice) => (
                <option key={voice.id} value={voice.id}>{voice.label}</option>
              ))}
            </select>
          </label>
        </div>

        {(hasEleven || hasOpenAi) && (
          <div className="field-row">
            {hasEleven && (
              <label className="field">
                <span>ElevenLabs model</span>
                <select value={speech?.elevenlabsModel ?? ''} onChange={(event) => void save({ elevenlabsModel: event.target.value || null })}>
                  <option value="">Automatic — {cloudModels?.elevenlabs.find((model) => model.id === cloudModels.elevenlabsDefault)?.label ?? 'Multilingual v2'}</option>
                  {(cloudModels?.elevenlabs ?? []).map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
                </select>
              </label>
            )}
            {hasOpenAi && (
              <label className="field">
                <span>OpenAI speech model</span>
                <select value={speech?.openaiTtsModel ?? ''} onChange={(event) => void save({ openaiTtsModel: event.target.value || null })}>
                  <option value="">Automatic — {cloudModels?.openaiDefault ?? 'gpt-4o-mini-tts'}</option>
                  {(cloudModels?.openai ?? []).map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
                </select>
              </label>
            )}
          </div>
        )}

        <label className="field speech-field">
          <span>How to read a script</span>
          <select value={mode} onChange={(event) => void save({ voiceMode: event.target.value as VoiceMode })}>
            {MODES.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
          </select>
          <span className="field-hint">{MODES.find((entry) => entry.id === mode)?.blurb}</span>
        </label>

        <div className="field-row">
          <label className="field">
            <span>Pace — {(speech?.speed ?? 1).toFixed(2)}×</span>
            <input
              type="range" min={0.5} max={2} step={0.05}
              value={speech?.speed ?? 1}
              onChange={(event) => void save({ speed: Number(event.target.value) })}
            />
          </label>
          <button type="button" className="btn btn-primary" onClick={() => void preview()} disabled={previewing || !voices.length}>
            {previewing ? <LoaderCircle size={14} className="spin" /> : <Play size={14} />} Preview
          </button>
        </div>

        {ttsVoices.map((model) => (
          <ModelRow
            key={model.id}
            model={model}
            job={downloading[model.label]}
            busy={busy === model.id}
            onDownload={() => void download(model)}
            onRemove={() => void remove(model)}
          />
        ))}
        <p className="muted small">
          For Hinglish, one Hindi Kokoro speaker reads the whole line: Hindi words with Hindi pronunciation, English words
          with English pronunciation — Indian-accented English, the way it is naturally spoken.
        </p>
      </section>
    </div>
  );
}

/**
 * Which transcriber to use: Auto (naming the engine it will pick), cloud only, one engine by name,
 * or offline only. An engine without a key is listed but cannot be picked, so the choice always
 * says what is missing rather than failing later in the Subtitles panel.
 */
function TranscriberChoice({ value, options, onChange }: {
  value: TranscribeEngine;
  options: TranscribeEngineOption[];
  onChange: (value: TranscribeEngine) => void;
}) {
  const cloud = options.filter((option) => !option.offline);
  const offline = options.find((option) => option.offline);
  const autoPick = options.find((option) => option.ready);
  const cloudPick = cloud.find((option) => option.ready);
  const chosen = options.find((option) => option.id === value);
  const savedSpeechKey = cloud.find((option) => option.dedicated && option.ready);
  const row = (option: TranscribeEngineOption) => (
    <option key={option.id} value={option.id} disabled={!option.ready && option.id !== value}>
      {option.label}{option.ready ? '' : option.offline ? ' — not downloaded' : ' — no key saved'}
    </option>
  );
  return (
    <label className="field speech-field">
      <span>Which transcriber to use</span>
      <select value={value} onChange={(event) => onChange(event.target.value as TranscribeEngine)}>
        <option value="auto">{autoPick ? `Auto — ${autoPick.label} now, the next one if it fails` : 'Auto — nothing set up yet'}</option>
        <option value="cloud">{cloudPick ? `Cloud only — ${cloudPick.label} first, never the offline model` : 'Cloud only — no key saved yet'}</option>
        <optgroup label="Speech-to-text keys">{cloud.filter((option) => option.dedicated).map(row)}</optgroup>
        <optgroup label="AI provider keys">{cloud.filter((option) => !option.dedicated).map(row)}</optgroup>
        <option value="local">{offline?.ready ? `Offline only — ${offline.label}, never upload the audio` : 'Offline only — never upload the audio (not downloaded yet)'}</option>
      </select>
      {chosen && !chosen.ready && !chosen.offline && (
        <span className="field-hint warn">
          No {chosen.label} key is saved, so nothing will transcribe. Add it in Settings
          {chosen.dedicated ? ' › Speech & voice' : ' › AI providers'}, or choose Auto.
        </span>
      )}
      {/* A saved key that nothing will ever reach is worth saying out loud. */}
      {value === 'local' && savedSpeechKey && (
        <span className="field-hint warn">
          Your {savedSpeechKey.label} key is saved, but this is set to offline only, so nothing will reach it. Choose
          Auto to transcribe with it.
        </span>
      )}
      {value === 'auto' && !autoPick && options.length > 0 && (
        <span className="field-hint">
          Save a Deepgram or ElevenLabs key, add an OpenAI, Groq, Mistral, Google Gemini or OpenRouter key in
          Settings › AI providers, or download an offline model below.
        </span>
      )}
      {value !== 'auto' && value !== 'local' && (
        <span className="field-hint">A single engine is used on its own: if it fails, nothing else is tried.</span>
      )}
    </label>
  );
}

/** whisper.cpp or Piper: the program a model needs before it can run at all. */
/**
 * A key for a service that is not a chat provider.
 *
 * The key is write-only from here: the backend says whether one is filed and never sends it back,
 * so there is nothing on screen to read over a shoulder, and an empty save removes it.
 */
function ServiceKeyField({ row, onSave }: { row: ServiceKey | undefined; onSave: (id: string, key: string) => Promise<void> }) {
  const toast = useToast();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  if (!row) return null;

  const run = async (key: string) => {
    setBusy(true);
    try {
      await onSave(row.id, key);
      setValue('');
    } catch (error) {
      toast({ tone: 'error', title: `Could not save the ${row.label} key`, body: errorText(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <label className="field speech-field">
      <span>
        {row.label} API key
        {row.saved && <span className="key-saved"><Check size={11} /> saved</span>}
      </span>
      <div className="key-row">
        <input
          type="password"
          value={value}
          spellCheck={false}
          autoComplete="off"
          placeholder={row.saved ? 'A saved key is in place — paste a new one to replace it' : `Paste your ${row.label} key`}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && value.trim()) {
              event.preventDefault();
              void run(value);
            }
          }}
        />
        <button type="button" className="btn btn-small" disabled={!value.trim() || busy} onClick={() => void run(value)}>
          {busy ? <LoaderCircle size={12} className="spin" /> : <Check size={12} />} Save
        </button>
        {row.saved && (
          <button type="button" className="btn btn-small btn-ghost" disabled={busy} title={`Remove the ${row.label} key`} onClick={() => void run('')}>
            <Trash2 size={12} />
          </button>
        )}
      </div>
      <span className="field-hint">{row.blurb}</span>
    </label>
  );
}

function RuntimeCard(props: {
  model: ModelInfo;
  found: boolean;
  path: string | null;
  source: string;
  job?: { progress: number; message: string };
  busy: boolean;
  onDownload: () => void;
  onLocate: () => void;
}) {
  const where = props.source === 'downloaded' ? 'downloaded by Bhippi' : props.source === 'custom' ? 'you pointed at it' : 'found on this computer';
  return (
    <div className={`tool-card${props.found ? ' ok' : ' missing'}`}>
      {props.found ? <Check size={18} /> : <TriangleAlert size={18} />}
      <div>
        <strong>{props.found ? `${props.model.label} ready` : `${props.model.label} not installed`}</strong>
        <span>{props.found ? `${props.path} — ${where}` : props.model.detail}</span>
        {props.job && <DownloadProgress job={props.job} />}
        {!props.found && !props.model.downloadable && (
          <span className="warn">There is no prebuilt build for this platform. Install it yourself, then press Locate.</span>
        )}
      </div>
      <div className="provider-actions">
        {!props.found && props.model.downloadable && (
          <button type="button" className="btn btn-small" onClick={props.onDownload} disabled={Boolean(props.job)}>
            <Download size={12} /> {props.job ? 'Downloading…' : `Download · ${size(props.model.sizeMb)}`}
          </button>
        )}
        <button type="button" className="btn btn-small btn-ghost" onClick={props.onLocate} disabled={props.busy}>
          {props.busy ? <LoaderCircle size={12} className="spin" /> : <FolderOpen size={12} />} Locate…
        </button>
      </div>
    </div>
  );
}

function ModelRow(props: {
  model: ModelInfo;
  job?: { progress: number; message: string };
  busy: boolean;
  onDownload: () => void;
  onRemove: () => void;
}) {
  const { model } = props;
  return (
    <div className={`provider-row model-row${model.installed ? ' ready' : ''}`}>
      <div className="model-icon">{model.kind === 'tts-voice' ? <Volume2 size={16} /> : <Languages size={16} />}</div>
      <div className="provider-main">
        <div className="provider-title">
          <strong>{model.label}</strong>
          {model.installed
            ? <span className="pill tone-ok"><Check size={11} />Installed</span>
            : model.recommended ? <span className="pill tone-warn">Recommended</span> : null}
          {model.installed && <span className="pill tone-off"><CloudOff size={11} />Offline</span>}
        </div>
        <div className="provider-detail"><span>{model.detail}</span></div>
        <div className="provider-detail">
          <span>{size(model.sizeMb)}</span>
          {model.languages.map((language) => <span key={language} className="lang-tag">{LANGUAGE_LABEL[language] ?? language}</span>)}
          <span>{model.license}</span>
        </div>
        {props.job && <DownloadProgress job={props.job} />}
      </div>
      <div className="provider-actions">
        {model.installed ? (
          <button type="button" className="icon-btn small" onClick={props.onRemove} disabled={props.busy} title={`Remove ${model.label}`}>
            {props.busy ? <LoaderCircle size={13} className="spin" /> : <Trash2 size={13} />}
          </button>
        ) : (
          <button type="button" className="btn btn-small" onClick={props.onDownload} disabled={Boolean(props.job) || !model.downloadable} title={model.kind === 'matte-candidate' ? 'Runtime and license review required before this candidate can be enabled' : undefined}>
            {model.kind === 'matte-candidate' ? <TriangleAlert size={12} /> : <Download size={12} />} {model.kind === 'matte-candidate' ? 'Review required' : props.job ? 'Downloading…' : 'Download'}
          </button>
        )}
      </div>
    </div>
  );
}
