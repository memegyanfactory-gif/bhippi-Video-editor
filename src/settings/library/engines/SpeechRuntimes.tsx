// The programs the offline speech models need before they can run: whisper.cpp for transcription and
// the sherpa-onnx library for Kokoro voices. Download them, or point at ones already installed.
// Moved from the old Model Center, with the same download and locate calls.
import { Download, FolderOpen, LoaderCircle } from 'lucide-react';
import type { ModelInfo } from '../../../lib/ipc';
import { DownloadProgress } from '../../DownloadProgress';
import { sizeText, type SpeechCenter } from '../speech/useSpeechCenter';
import { EngineRow } from './EngineRow';

function Runtime({ center, model, found, path, source, runtime }: { center: SpeechCenter; model: ModelInfo; found: boolean; path: string | null; source: string; runtime: 'whisper' | 'tts' }) {
  const job = center.downloading[model.label];
  const where = source === 'downloaded' ? 'downloaded by Bhippi' : source === 'custom' ? 'you pointed at it' : 'found on this computer';
  return (
    <EngineRow
      on={found}
      headline={found ? `${model.label}: ready` : `${model.label}: not installed`}
      detail={found ? `${path} (${where})` : !model.downloadable ? 'There is no prebuilt build for this platform. Install it yourself, then press Locate.' : model.detail}
      actions={(
        <>
          {!found && model.downloadable && (
            <button type="button" className="btn btn-small btn-primary" disabled={!!job} onClick={() => void center.download(model)}>
              <Download size={12} /> {job ? 'Downloading…' : `Install · ${sizeText(model.sizeMb)}`}
            </button>
          )}
          <button type="button" className="btn btn-small btn-ghost" disabled={center.busy === runtime} onClick={() => void center.locate(runtime)}>
            {center.busy === runtime ? <LoaderCircle size={12} className="spin" /> : <FolderOpen size={12} />} {found ? 'Change' : 'Locate…'}
          </button>
        </>
      )}
    >
      {job && <DownloadProgress job={job} />}
    </EngineRow>
  );
}

export function SpeechRuntimes({ center }: { center: SpeechCenter }) {
  const { status } = center;
  const models = status?.models ?? [];
  const whisper = models.find((model) => model.kind === 'stt-runtime');
  const kokoro = models.find((model) => model.kind === 'tts-runtime');
  if (!status) return <EngineRow on={false} headline={'Speech runtimes: checking…'} />;
  return (
    <>
      {whisper && <Runtime center={center} model={whisper} found={status.whisper.found} path={status.whisper.path ?? null} source={status.whisper.source} runtime="whisper" />}
      {kokoro && <Runtime center={center} model={kokoro} found={status.tts.found} path={status.tts.path ?? null} source={status.tts.source} runtime="tts" />}
    </>
  );
}
