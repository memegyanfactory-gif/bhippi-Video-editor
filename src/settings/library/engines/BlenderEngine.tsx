// Headless Blender for the AI's 3D renders (render_3d_scene): found on its own, or chosen here.
// Moved as is from the old Local generation tab.
import { open } from '@tauri-apps/plugin-dialog';
import { FolderOpen } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../../../lib/ipc';
import type { Settings } from '../../../lib/types';
import type { Run } from '../shared';
import { EngineRow } from './EngineRow';

export function BlenderEngine({ settings, onSettings, run }: { settings: Settings; onSettings: (settings: Settings) => void; run: Run }) {
  const path = settings.blenderPath ?? null;
  const [status, setStatus] = useState<{ found: boolean; path?: string; version?: string | null; hint?: string } | null>(null);
  useEffect(() => {
    let stopped = false;
    setStatus(null);
    void api.blenderStatus().then((value) => { if (!stopped) setStatus(value); }).catch(() => { if (!stopped) setStatus({ found: false }); });
    return () => { stopped = true; };
  }, [path]);

  const choose = (clear = false) => run(async () => {
    const picked = clear ? null : await open({ multiple: false, title: 'Select the Blender program (blender.exe)' });
    if (!clear && typeof picked !== 'string') return;
    onSettings(await api.settingsSave({ ...settings, blenderPath: picked }));
  }, 'Could not use that Blender');

  const found = !!status?.found;
  return (
    <EngineRow
      on={found}
      headline={status === null ? 'Looking for Blender…' : found ? (status.version ?? 'Blender found') : 'Blender not found'}
      detail={<>{found ? status!.path : status?.hint ?? 'Install Blender, or choose its program if it lives somewhere unusual.'}{path ? ` Chosen by hand${found ? '' : ', and that file is missing'}.` : ''}</>}
      actions={(
        <>
          <button type="button" className="btn btn-small" onClick={() => void choose()}><FolderOpen size={12} /> {found ? 'Change' : 'Choose Blender'}</button>
          {path && <button type="button" className="btn btn-small btn-ghost" onClick={() => void choose(true)}>Find automatically</button>}
        </>
      )}
    />
  );
}
