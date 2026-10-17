// Small extras some models' detail panels need: "I already have this folder" for the local-media models.
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { FolderOpen } from 'lucide-react';
import { api } from '../../lib/ipc';
import type { Settings } from '../../lib/types';
import type { Run } from './shared';

/** Points a local-media model at a folder the person already has, instead of downloading it. */
export function LocalFolderPick({ task, settings, onSettings, run }: { task: string; settings: Settings; onSettings: (settings: Settings) => void; run: Run }) {
  const path = settings.localMediaModels?.[task] ?? null;
  const choose = () => run(async () => {
    const picked = await openDialog({ directory: true, multiple: false, title: 'Select the model folder you already have' });
    if (typeof picked !== 'string') return;
    onSettings(await api.settingsSave({ ...settings, localMediaModels: { ...settings.localMediaModels, [task]: picked } }));
  }, 'Could not use that folder');
  return (
    <section className="ml-sec">
      <h4>Already on this PC</h4>
      <p>{path ? `Using the folder ${path}.` : 'If you already have this model, point Bhippi at its folder instead of downloading it again.'}</p>
      <div><button type="button" className="btn btn-small" onClick={() => void choose()}><FolderOpen size={12} /> Choose folder</button></div>
    </section>
  );
}
