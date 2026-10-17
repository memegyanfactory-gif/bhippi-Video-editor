// The "Settings" block above the grid on the Voice and Transcription pages.
import type { Settings } from '../../../lib/types';
import { TranscriptionPrefs, VoicePrefs } from './SpeechPrefs';
import { useSpeechCenter } from './useSpeechCenter';

export function CategoryPrefs({ kind, settings, onSettings }: { kind: 'voice' | 'speech'; settings: Settings; onSettings: (settings: Settings) => void }) {
  const center = useSpeechCenter(settings, onSettings);
  return kind === 'voice' ? <VoicePrefs center={center} /> : <TranscriptionPrefs center={center} />;
}
