// The llama.cpp runtime that local language models run on: install it, and stop whatever it is
// running. Starting a model happens on the model itself (Language models), because a start needs a
// model chosen and planned for this PC first.
import { CircleStop, Download } from 'lucide-react';
import type { Job } from '../../../lib/types';
import { libraryApi, type LlmRuntimeStatus } from '../../../lib/modelLibrary';
import { DownloadProgress } from '../../DownloadProgress';
import type { Run } from '../shared';
import { EngineRow } from './EngineRow';

export function LlmEngine({ status, job, run, onChanged, onBrowse }: { status: LlmRuntimeStatus | null; job: Job | undefined; run: Run; onChanged: () => void; onBrowse: () => void }) {
  const installing = !!job && job.status === 'running';
  if (!status) return <EngineRow on={false} headline={'llama.cpp: checking…'} />;
  const running = status.running;
  return (
    <EngineRow
      on={!!running}
      headline={!status.installed ? 'llama.cpp: not installed' : running ? 'llama.cpp: running a model' : 'llama.cpp: installed, nothing running'}
      detail={running
        ? `${running.modelId} is a chat provider in Bhippi’s chat now.`
        : status.message || 'Local language models run through llama.cpp on this PC. Nothing is uploaded.'}
      actions={(
        <>
          {!status.installed && <button type="button" className="btn btn-small btn-primary" disabled={installing} onClick={() => void run(() => libraryApi.llmInstall(), 'Could not install the runtime')}><Download size={12} /> Install</button>}
          {status.installed && !running && <button type="button" className="btn btn-small" onClick={onBrowse}>Pick a model to start</button>}
          {running && <button type="button" className="btn btn-small" onClick={() => void run(() => libraryApi.llmStop(), 'Could not stop the model').then(onChanged)}><CircleStop size={12} /> Stop</button>}
        </>
      )}
    >
      {installing && job && <DownloadProgress job={job} />}
    </EngineRow>
  );
}
