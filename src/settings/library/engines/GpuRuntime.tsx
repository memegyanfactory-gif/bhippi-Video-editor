// The GPU runtime: Bhippi's AI pack (its own Python and PyTorch, plus the cutout, depth, eraser and
// tracking models) and the Python environment the local-media models run in. Moved from the old
// Local generation tab with the same install call and the same "Choose Python" setting.
import { open } from '@tauri-apps/plugin-dialog';
import { Download, FolderOpen } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useToast } from '../../../components/ui';
import { api } from '../../../lib/ipc';
import { AI_PACK_FEATURES, aiPackApi, aiPackReady, type AiPackStatus } from '../../../lib/aiPack';
import type { Settings } from '../../../lib/types';
import type { Run } from '../shared';
import { EngineRow } from './EngineRow';

export function GpuRuntime({ settings, onSettings, run }: { settings: Settings; onSettings: (settings: Settings) => void; run: Run }) {
  const toast = useToast();
  const [pack, setPack] = useState<AiPackStatus | null>(null);

  useEffect(() => {
    let stopped = false;
    const refresh = () => { void aiPackApi.status().then((value) => { if (!stopped) setPack(value); }).catch(() => undefined); };
    refresh();
    const interval = window.setInterval(refresh, 2000);
    return () => { stopped = true; window.clearInterval(interval); };
  }, []);

  const install = () => run(async () => {
    const id = await aiPackApi.install();
    toast({ tone: 'info', title: 'AI pack install started', body: `Follow progress or cancel in Jobs (${id}).` });
  }, 'Could not install the AI pack');

  const choosePython = () => run(async () => {
    const path = await open({ multiple: false, title: 'Select local media Python executable' });
    if (typeof path !== 'string') return;
    onSettings(await api.settingsSave({ ...settings, localMediaPython: path }));
  }, 'Could not use that Python');

  const ready = aiPackReady(pack);
  const python = settings.localMediaPython || null;
  return (
    <>
      <EngineRow
        on={ready}
        headline={!pack ? 'AI pack: checking…' : ready ? 'AI pack: installed' : 'AI pack: not installed'}
        detail={pack
          ? <>{AI_PACK_FEATURES}. Its own Python and PyTorch{pack.cuda ? ' with CUDA for your NVIDIA GPU' : ' (CPU build, no NVIDIA GPU found)'}.{!ready && ` About ${(pack.remainingMb / 1000).toFixed(1)} GB to download${pack.python || pack.libraries || pack.tasks.some(([, done]) => done) ? ', resumes where it stopped' : ''}.`}</>
          : undefined}
        actions={pack && !ready ? <button type="button" className="btn btn-small btn-primary" onClick={() => void install()}><Download size={12} /> Install</button> : undefined}
      />
      <EngineRow
        on={!!python}
        headline={python ? 'Python environment: set' : 'Python environment: not set'}
        detail={python ?? 'Local image, video and music models need one Python with CUDA PyTorch, Diffusers, Transformers and Accelerate. Install the AI pack, or choose your own.'}
        actions={<button type="button" className="btn btn-small" onClick={() => void choosePython()}><FolderOpen size={12} /> {python ? 'Change' : 'Choose Python…'}</button>}
      />
    </>
  );
}
