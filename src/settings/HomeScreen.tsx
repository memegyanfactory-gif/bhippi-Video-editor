import { ArrowRight, Clapperboard, FilePlus2, Film, FolderOpen, Keyboard, Sparkles, Upload } from 'lucide-react';
import { bytes, timecode } from '../lib/editor';
import { api } from '../lib/ipc';
import { compDuration } from '../lib/timeline';
import type { AppInfo, Job, Project, ProviderInfo } from '../lib/types';
import { ProviderLogo } from '../components/ProviderLogo';

type Props = {
  project: Project;
  info: AppInfo | null;
  jobs: Job[];
  providers: ProviderInfo[];
  assetCount: number;
  recents: string[];
  onEdit: () => void;
  onNewProject: () => void;
  onImport: () => void;
  onOpen: () => void;
  onOpenRecent: (path: string) => void;
  onProviders: () => void;
  onShortcuts: () => void;
};

export function HomeScreen(props: Props) {
  const exports = props.jobs.filter((job) => job.kind === 'export' && job.status === 'done' && job.result?.path);
  const ready = props.providers.filter((row) => row.usable && row.kind !== 'builtin');
  const comp = props.project.comps.find((item) => item.id === props.project.activeCompId) ?? props.project.comps[0];
  return (
    <div className="home">
      <div className="home-inner">
        <div className="home-hero">
          <img src="/helios.svg" alt="" width={64} height={64} />
          <div>
            <h1>Welcome to Helios</h1>
            <p>A local-first video studio with Premiere-style editing and an AI editor that makes real edits.</p>
          </div>
        </div>
        <div className="home-grid">
          <button type="button" className="home-card primary" onClick={props.onEdit}>
            <Film size={22} />
            <strong>Continue editing</strong>
            <span>{props.project.name} · {comp ? `${comp.name} · ${comp.clips.length} clips · ${timecode(compDuration(comp), comp.fps)}` : 'no comp yet'}</span>
            <ArrowRight size={16} className="home-go" />
          </button>
          <button type="button" className="home-card" onClick={props.onOpen}>
            <FolderOpen size={22} />
            <strong>Open project</strong>
            <span>A .helios project file</span>
          </button>
          <button type="button" className="home-card" onClick={props.onImport}>
            <Upload size={22} />
            <strong>Import media</strong>
            <span>{props.assetCount} items in the project</span>
          </button>
          <button type="button" className="home-card" onClick={props.onNewProject}>
            <FilePlus2 size={22} />
            <strong>New project</strong>
            <span>Start a fresh, clean, empty project</span>
          </button>
          <button type="button" className="home-card" onClick={props.onProviders}>
            <Sparkles size={22} />
            <strong>AI providers</strong>
            <span className="home-providers">
              {ready.length ? ready.slice(0, 6).map((row) => <ProviderLogo key={row.id} id={row.id} size={16} />) : 'Set up Claude, Codex, Gemini, Ollama or an API key'}
            </span>
          </button>
          <button type="button" className="home-card" onClick={props.onShortcuts}>
            <Keyboard size={22} />
            <strong>Keyboard shortcuts</strong>
            <span>Premiere's keymap: J K L, I O, Q W, Ctrl+K and more</span>
          </button>
        </div>
        {props.recents.length > 0 && (
          <div className="home-recent">
            <h2>Recent projects</h2>
            {props.recents.slice(0, 6).map((path) => (
              <div key={path} className="home-export">
                <Clapperboard size={14} />
                <button type="button" className="home-export-name link" onClick={() => props.onOpenRecent(path)} title={path}>{path.split(/[\\/]/).pop()}</button>
                <button type="button" className="btn btn-small btn-ghost" onClick={() => void api.revealPath(path)}>Show in folder</button>
              </div>
            ))}
          </div>
        )}
        <div className="home-recent">
          <h2>Exported this session</h2>
          {exports.length === 0 ? (
            <p className="muted">Nothing exported yet — press Ctrl+M in the editor.</p>
          ) : (
            exports.map((job) => (
              <div key={job.id} className="home-export">
                <Film size={14} />
                <span className="home-export-name">{job.result?.path?.split(/[\\/]/).pop()}</span>
                <span className="muted">{bytes(job.result?.size ?? 0)}</span>
                <button type="button" className="btn btn-small" onClick={() => job.result?.path && void api.openPath(job.result.path)}>Open</button>
                <button type="button" className="btn btn-small btn-ghost" onClick={() => job.result?.path && void api.revealPath(job.result.path)}>Show in folder</button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
