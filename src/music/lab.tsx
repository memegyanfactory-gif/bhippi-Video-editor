// Music Lab (music-lab.html, `npm run dev:web` → /music-lab.html): the Music Studio on a template
// song, outside the app, for checking its windows and playback in a plain browser. Bouncing needs
// the app (it saves through Tauri); here it fails with a toast.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/app.css';
import '../styles/themes.css';
import '../styles/music.css';
import { useHistory } from '../lib/history';
import { newProject } from '../lib/timeline';
import { withSong } from './model';
import { songFromTemplate } from './templates';
import { MusicStudio } from './ui/MusicStudio';

const template = new URLSearchParams(location.search).get('template') ?? 'lofi';

function Lab() {
  const history = useHistory(withSong(newProject('Music Lab'), songFromTemplate(template, { seed: 7 })));
  return (
    <div style={{ position: 'relative', height: '100%' }}>
      <MusicStudio project={history.project} history={history} assets={new Map()} onClose={() => undefined}
        importAudio={async () => null} placeOnTimeline={() => undefined}
        toast={(t) => console.log(`[toast] ${t.tone}: ${t.title}${t.body ? ` — ${t.body}` : ''}`)} />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><Lab /></StrictMode>);
