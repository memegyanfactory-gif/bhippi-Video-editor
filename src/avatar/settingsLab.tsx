// Avatar Lab, settings mode (avatar-lab.html?settings): the real Settings modal open on the Avatar
// tab, with settings kept in memory, so the page can be checked without the desktop app.

import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ToastProvider } from '../components/ui';
import { SettingsModal, type SettingsTab } from '../settings/SettingsModal';
import type { Settings } from '../lib/types';
import '../styles/app.css';

function Lab() {
  const [settings, setSettings] = useState({} as Settings);
  const [tab, setTab] = useState<SettingsTab>('avatar');
  return (
    <SettingsModal tab={tab} onTab={setTab} onClose={() => undefined} providers={[]} onProviders={() => undefined} info={null} onTools={() => undefined}
      settings={settings} onSettings={setSettings} jobs={[]} />
  );
}

document.body.innerHTML = '<div id="root"></div>';
createRoot(document.getElementById('root')!).render(<ToastProvider><Lab /></ToastProvider>);
