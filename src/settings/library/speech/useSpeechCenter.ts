// What the Voice and Transcription pages (and the speech runtimes on Engines) need from the speech
// backend: the runtimes, the voices, saved service keys, and the preferences in settings.speech.
// This is the old Model Center's state, kept in one hook so the pieces that moved share it.
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '../../../components/ui';
import { api, errorText, events, fileSrc, type CloudSpeechModels, type ModelInfo, type ServiceKey, type SpeechStatus, type TranscribeEngineOption, type Voice } from '../../../lib/ipc';
import { useLiveJobs } from '../../../lib/jobsStore';
import type { Settings, VoiceMode } from '../../../lib/types';

/** What each reading mode does, in the order they make sense to try. */
export const MODES: { id: VoiceMode; label: string; blurb: string }[] = [
  { id: 'auto', label: 'Auto', blurb: 'Devanagari is read in Hindi, everything else in English.' },
  { id: 'hinglish', label: 'Hinglish', blurb: 'Word by word: in "yaar ye transition bahut smooth hai" the Hindi words get Hindi pronunciation and the English ones English, all in one voice, the way it is actually spoken.' },
  { id: 'hindi-roman', label: 'Romanised Hindi', blurb: 'The whole script is Hindi typed in Latin letters: transliterated, then read in Hindi.' },
  { id: 'en', label: 'English only', blurb: 'One voice, no splitting.' },
  { id: 'hi', label: 'Hindi only', blurb: 'One voice, transliterating anything still in Latin letters.' },
];

const SAMPLES: Record<VoiceMode, string> = {
  auto: 'This is how your voice-over will sound.',
  hinglish: 'Yaar ye transition bahut smooth hai, dekho.',
  'hindi-roman': 'Namaste, main Bhippi hoon.',
  en: 'This is how your voice-over will sound.',
  hi: 'नमस्ते दोस्तों, आज हम एक बहुत मज़ेदार वीडियो बनाने वाले हैं।',
};

export const sizeText = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`);

export type SpeechCenter = ReturnType<typeof useSpeechCenter>;

export function useSpeechCenter(settings: Settings, onSettings: (settings: Settings) => void) {
  const toast = useToast();
  const jobs = useLiveJobs();
  const [status, setStatus] = useState<SpeechStatus | null>(null);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [cloudModels, setCloudModels] = useState<CloudSpeechModels | null>(null);
  const [services, setServices] = useState<ServiceKey[]>([]);
  const [engineOptions, setEngineOptions] = useState<TranscribeEngineOption[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const player = useRef<HTMLAudioElement | null>(null);

  const speech = settings.speech;
  const mode: VoiceMode = speech?.voiceMode ?? 'auto';

  useEffect(() => { void api.serviceKeys().then((rows) => setServices(rows ?? [])).catch(() => undefined); }, []);

  // The models each keyed voice service offers, re-read when a key comes or goes.
  useEffect(() => {
    void api.speechCloudModels().then(setCloudModels).catch(() => setCloudModels(null));
    void api.speechVoices().then((rows) => setVoices(rows ?? [])).catch(() => undefined);
  }, [services]);

  // Which transcribers could run: re-read whenever a key or a model comes or goes.
  useEffect(() => { void api.transcribeEngineOptions().then((rows) => setEngineOptions(rows ?? [])).catch(() => undefined); }, [services, status]);

  const refresh = useCallback(async () => {
    try {
      const [next, list] = await Promise.all([api.speechStatus(), api.speechVoices()]);
      setStatus(next);
      setVoices(list ?? []);
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

  /** Running downloads by label, so each runtime shows its own progress. */
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

  const saveServiceKey = useCallback(async (id: string, key: string) => {
    const rows = await api.serviceSetKey(id, key);
    setServices(rows);
    const row = rows.find((item) => item.id === id);
    toast({
      tone: 'success',
      title: key.trim() ? `${row?.label ?? id} key saved` : `${row?.label ?? id} key removed`,
      body: key.trim() ? 'It is in this computer’s credential store, not in the project file.' : '',
    });
  }, [toast]);

  const download = async (model: ModelInfo) => {
    try {
      await api.modelDownload(model.id);
      toast({ tone: 'info', title: `Downloading ${model.label}`, body: `${sizeText(model.sizeMb)}. It keeps going if you close this window.` });
    } catch (error) {
      toast({ tone: 'error', title: `Could not download ${model.label}`, body: errorText(error) });
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

  return { settings, speech, mode, status, voices, cloudModels, services, engineOptions, busy, previewing, downloading, save, saveServiceKey, download, locate, preview };
}
