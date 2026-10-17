// The "Settings" block on the Transcription and Voice pages: what the old Model Center held besides
// the models themselves. Transcription: the Deepgram key, which transcriber to use, the offline
// model. Voice: the ElevenLabs key, the voice, the Hindi voice, cloud models, how a script is read,
// pace and a preview. Same settings fields as before.
import { Check, LoaderCircle, Mic, Play, Trash2, Volume2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useToast } from '../../../components/ui';
import { errorText, type ServiceKey, type TranscribeEngineOption } from '../../../lib/ipc';
import type { TranscribeEngine, VoiceMode } from '../../../lib/types';
import { MODES, type SpeechCenter } from './useSpeechCenter';

function Prefs({ icon, summary, children }: { icon: ReactNode; summary: string; children: ReactNode }) {
  return (
    <details className="ml-prefs">
      <summary>{icon}<strong>Settings</strong><span>{summary}</span></summary>
      <div className="ml-prefs-body">{children}</div>
    </details>
  );
}

export function TranscriptionPrefs({ center }: { center: SpeechCenter }) {
  const { speech, status, services, engineOptions, save, saveServiceKey } = center;
  const sttModels = (status?.models ?? []).filter((model) => model.kind === 'stt-model');
  const sttReady = (status?.whisper.found ?? false) && sttModels.some((model) => model.installed);
  return (
    <Prefs icon={<Mic size={13} />} summary="Which transcriber, keys, offline model">
      <p className="ml-prefs-blurb">
        Auto uses a speech-to-text key first (Deepgram, then ElevenLabs Scribe), then an AI provider key that can hear audio
        (OpenAI, Groq, Mistral, Google Gemini or OpenRouter), then the offline model when one is downloaded.
      </p>
      <ServiceKeyField row={services.find((item) => item.id === 'deepgram')} onSave={saveServiceKey} />
      <TranscriberChoice value={speech?.transcribeEngine ?? 'auto'} options={engineOptions} onChange={(value) => void save({ transcribeEngine: value })} />
      <label className="field speech-field">
        <span>Offline model</span>
        <select value={speech?.transcribeModel ?? ''} onChange={(event) => void save({ transcribeModel: event.target.value || null })} disabled={!sttModels.some((model) => model.installed)}>
          <option value="">Best one downloaded</option>
          {sttModels.filter((model) => model.installed).map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
        </select>
        <span className="field-hint">
          {sttReady ? 'Ready. Auto uses it when no key can transcribe; Offline only uses nothing else.' : 'Download whisper.cpp (Engines) and one model below to transcribe without a key.'}
        </span>
      </label>
    </Prefs>
  );
}

export function VoicePrefs({ center }: { center: SpeechCenter }) {
  const { speech, mode, voices, cloudModels, services, previewing, save, saveServiceKey, preview } = center;
  // Only Kokoro splits a line between speakers; a cloud voice reads Hindi itself.
  const hindiVoices = voices.filter((voice) => voice.engine === 'kokoro' && voice.languages.includes('hi'));
  const cloudVoices = voices.filter((voice) => !voice.offline);
  const offlineVoices = voices.filter((voice) => voice.offline);
  // What "Automatic" resolves to today: the same order the backend uses.
  const automatic = voices.find((voice) => voice.engine === 'elevenlabs') ?? voices.find((voice) => voice.id === 'openai:coral') ?? voices.find((voice) => voice.id === 'kokoro:af_heart');
  const hasEleven = voices.some((voice) => voice.engine === 'elevenlabs');
  const hasOpenAi = voices.some((voice) => voice.engine === 'openai');
  return (
    <Prefs icon={<Volume2 size={13} />} summary="Voice, language, pace, keys">
      <p className="ml-prefs-blurb">
        With an ElevenLabs or OpenAI key saved their voices are used; otherwise Kokoro reads the script on this computer, free,
        with nothing uploaded. Every take is levelled to the loudness online platforms play speech at.
      </p>
      <ServiceKeyField row={services.find((item) => item.id === 'elevenlabs')} onSave={saveServiceKey} />
      <div className="field-row">
        <label className="field">
          <span>Voice</span>
          <select value={speech?.voice ?? ''} onChange={(event) => void save({ voice: event.target.value || null })} disabled={!voices.length}>
            <option value="">{automatic ? `Automatic: ${automatic.label}` : 'No voice ready yet'}</option>
            {cloudVoices.length > 0 && <optgroup label="Cloud">{cloudVoices.map((voice) => <option key={voice.id} value={voice.id}>{voice.label}</option>)}</optgroup>}
            {offlineVoices.length > 0 && <optgroup label="Offline · Kokoro">{offlineVoices.map((voice) => <option key={voice.id} value={voice.id}>{voice.label}</option>)}</optgroup>}
          </select>
        </label>
        <label className="field">
          <span>Hindi voice, for Hinglish</span>
          <select value={speech?.hindiVoice ?? ''} onChange={(event) => void save({ hindiVoice: event.target.value || null })} disabled={!hindiVoices.length}>
            <option value="">{hindiVoices.length ? `Automatic: ${hindiVoices[0].label}` : 'Download the Kokoro voices first'}</option>
            {hindiVoices.map((voice) => <option key={voice.id} value={voice.id}>{voice.label}</option>)}
          </select>
        </label>
      </div>
      {(hasEleven || hasOpenAi) && (
        <div className="field-row">
          {hasEleven && (
            <label className="field">
              <span>ElevenLabs model</span>
              <select value={speech?.elevenlabsModel ?? ''} onChange={(event) => void save({ elevenlabsModel: event.target.value || null })}>
                <option value="">Automatic: {cloudModels?.elevenlabs.find((model) => model.id === cloudModels.elevenlabsDefault)?.label ?? 'Multilingual v2'}</option>
                {(cloudModels?.elevenlabs ?? []).map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
              </select>
            </label>
          )}
          {hasOpenAi && (
            <label className="field">
              <span>OpenAI speech model</span>
              <select value={speech?.openaiTtsModel ?? ''} onChange={(event) => void save({ openaiTtsModel: event.target.value || null })}>
                <option value="">Automatic: {cloudModels?.openaiDefault ?? 'gpt-4o-mini-tts'}</option>
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
          <span>Pace: {(speech?.speed ?? 1).toFixed(2)}×</span>
          <input type="range" min={0.5} max={2} step={0.05} value={speech?.speed ?? 1} onChange={(event) => void save({ speed: Number(event.target.value) })} />
        </label>
        <button type="button" className="btn btn-primary" onClick={() => void preview()} disabled={previewing || !voices.length}>
          {previewing ? <LoaderCircle size={14} className="spin" /> : <Play size={14} />} Preview
        </button>
      </div>
    </Prefs>
  );
}

/**
 * Which transcriber to use: Auto (naming the engine it will pick), cloud only, one engine by name,
 * or offline only. An engine without a key is listed but cannot be picked, so the choice always
 * says what is missing rather than failing later in the Subtitles panel.
 */
function TranscriberChoice({ value, options, onChange }: { value: TranscribeEngine; options: TranscribeEngineOption[]; onChange: (value: TranscribeEngine) => void }) {
  const cloud = options.filter((option) => !option.offline);
  const offline = options.find((option) => option.offline);
  const autoPick = options.find((option) => option.ready);
  const cloudPick = cloud.find((option) => option.ready);
  const chosen = options.find((option) => option.id === value);
  const savedSpeechKey = cloud.find((option) => option.dedicated && option.ready);
  const row = (option: TranscribeEngineOption) => (
    <option key={option.id} value={option.id} disabled={!option.ready && option.id !== value}>
      {option.label}{option.ready ? '' : option.offline ? ' (not downloaded)' : ' (no key saved)'}
    </option>
  );
  return (
    <label className="field speech-field">
      <span>Which transcriber to use</span>
      <select value={value} onChange={(event) => onChange(event.target.value as TranscribeEngine)}>
        <option value="auto">{autoPick ? `Auto: ${autoPick.label} now, the next one if it fails` : 'Auto: nothing set up yet'}</option>
        <option value="cloud">{cloudPick ? `Cloud only: ${cloudPick.label} first, never the offline model` : 'Cloud only: no key saved yet'}</option>
        <optgroup label="Speech-to-text keys">{cloud.filter((option) => option.dedicated).map(row)}</optgroup>
        <optgroup label="AI provider keys">{cloud.filter((option) => !option.dedicated).map(row)}</optgroup>
        <option value="local">{offline?.ready ? `Offline only: ${offline.label}, never upload the audio` : 'Offline only: never upload the audio (not downloaded yet)'}</option>
      </select>
      {chosen && !chosen.ready && !chosen.offline && (
        <span className="field-hint warn">
          No {chosen.label} key is saved, so nothing will transcribe. {chosen.dedicated ? 'Add it above' : 'Add it in Settings › AI providers'}, or choose Auto.
        </span>
      )}
      {/* A saved key that nothing will ever reach is worth saying out loud. */}
      {value === 'local' && savedSpeechKey && (
        <span className="field-hint warn">Your {savedSpeechKey.label} key is saved, but this is set to offline only, so nothing will reach it. Choose Auto to transcribe with it.</span>
      )}
      {value === 'auto' && !autoPick && options.length > 0 && (
        <span className="field-hint">Save a Deepgram or ElevenLabs key, add an OpenAI, Groq, Mistral, Google Gemini or OpenRouter key in Settings › AI providers, or download an offline model.</span>
      )}
      {value !== 'auto' && value !== 'local' && <span className="field-hint">A single engine is used on its own: if it fails, nothing else is tried.</span>}
    </label>
  );
}

/**
 * A key for a service that is not a chat provider. The key is write-only from here: the backend says
 * whether one is filed and never sends it back, and an empty save removes it.
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
          type="password" value={value} spellCheck={false} autoComplete="off"
          placeholder={row.saved ? 'A saved key is in place. Paste a new one to replace it' : `Paste your ${row.label} key`}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && value.trim()) { event.preventDefault(); void run(value); } }}
        />
        <button type="button" className="btn btn-small" disabled={!value.trim() || busy} onClick={() => void run(value)}>
          {busy ? <LoaderCircle size={12} className="spin" /> : <Check size={12} />} Save
        </button>
        {row.saved && (
          <button type="button" className="btn btn-small btn-ghost" disabled={busy} title={`Remove the ${row.label} key`} onClick={() => void run('')}><Trash2 size={12} /></button>
        )}
      </div>
      <span className="field-hint">{row.blurb}</span>
    </label>
  );
}
