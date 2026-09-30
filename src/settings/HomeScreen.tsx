import { ArrowRight, Clapperboard, Film, FolderOpen, Keyboard, Plus, Sparkles, Upload } from 'lucide-react';
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
  /** The session project has a file or some work in it (an empty, never-saved one is not offered). */
  canContinue: boolean;
  recents: string[];
  /** The recent files confirmed to be on disk; any other entry is shown but can't be opened. */
  recentFound: ReadonlySet<string>;
  onEdit: () => void;
  onNewProject: () => void;
  onImport: () => void;
  onOpen: () => void;
  onOpenRecent: (path: string) => void;
  onForgetRecent: (path: string) => void;
  onProviders: () => void;
  onShortcuts: () => void;
};

/** "D:\Films\Launch.bhippi" → { name: "Launch", folder: "D:\Films" }. */
function splitPath(path: string) {
  const cut = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
  const file = path.slice(cut + 1);
  return { name: file.replace(/\.bhippi$/i, ''), folder: cut > 0 ? path.slice(0, cut) : '' };
}

export function HomeScreen(props: Props) {
  const exports = props.jobs.filter((job) => job.kind === 'export' && job.status === 'done' && job.result?.path);
  const ready = props.providers.filter((row) => row.usable && row.kind !== 'builtin');
  const comp = props.project.comps.find((item) => item.id === props.project.activeCompId) ?? props.project.comps[0];
  return (
    <div className="home">
      <div className="home-inner">
        <header className="home-head">
          <img src="/bhippi.png" alt="" width={40} height={40} />
          <div className="home-title">
            <h1>Bhippi</h1>
            <p>Edit by hand, or ask the AI to make the edit.</p>
          </div>
          <div className="home-actions">
            <button type="button" className="btn" onClick={props.onOpen}><FolderOpen size={15} />Open</button>
            <button type="button" className="btn btn-primary" onClick={props.onNewProject}><Plus size={15} />New project</button>
          </div>
        </header>

        {props.canContinue && (
          <button type="button" className="home-card home-current" onClick={props.onEdit}>
            <span className="home-current-icon"><Film size={20} /></span>
            <span className="home-current-text">
              <strong>{props.project.name}</strong>
              <span>{comp ? `${comp.name} · ${comp.clips.length} clips · ${timecode(compDuration(comp), comp.fps)}` : 'No comp yet'}</span>
            </span>
            <span className="home-current-go">Continue editing<ArrowRight size={15} /></span>
          </button>
        )}

        <div className="home-quick">
          <button type="button" onClick={props.onImport}>
            <Upload size={15} /><span>Import media</span><small>{props.assetCount} in project</small>
          </button>
          <button type="button" onClick={props.onProviders}>
            <Sparkles size={15} /><span>AI providers</span>
            {ready.length ? (
              <small className="home-providers">{ready.slice(0, 4).map((row) => <ProviderLogo key={row.id} id={row.id} size={14} />)}</small>
            ) : <small>Set up</small>}
          </button>
          <button type="button" onClick={props.onShortcuts}>
            <Keyboard size={15} /><span>Shortcuts</span><small>Premiere keymap</small>
          </button>
        </div>

        <section className="home-section">
          <h2>Recent projects</h2>
          <div className="home-card home-list">
            {props.recents.length === 0 ? (
              <p className="home-empty">Projects you open or create show up here. Start one with New project.</p>
            ) : (
              props.recents.slice(0, 8).map((path) => {
                const found = props.recentFound.has(path);
                const { name, folder } = splitPath(path);
                return (
                  <div key={path} className={`home-row${found ? '' : ' missing'}`}>
                    <Clapperboard size={15} />
                    <button type="button" className="home-row-name" disabled={!found} onClick={() => found && props.onOpenRecent(path)}
                      title={found ? path : `Not found: ${path}`}>
                      <b>{name}</b><small>{found ? folder : 'Missing'}</small>
                    </button>
                    <span className="home-row-actions">
                      {found ? (
                        <button type="button" className="btn btn-small btn-ghost" onClick={() => void api.revealPath(path)}>Show in folder</button>
                      ) : (
                        <button type="button" className="btn btn-small btn-ghost" onClick={() => props.onForgetRecent(path)}>Remove</button>
                      )}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {exports.length > 0 && (
          <section className="home-section">
            <h2>Exported this session</h2>
            <div className="home-card home-list">
              {exports.map((job) => {
                const path = job.result!.path!;
                const { folder } = splitPath(path);
                return (
                  <div key={job.id} className="home-row">
                    <Film size={15} />
                    <button type="button" className="home-row-name" onClick={() => void api.openPath(path)} title={path}>
                      <b>{path.split(/[\\/]/).pop()}</b><small>{bytes(job.result?.size ?? 0)} · {folder}</small>
                    </button>
                    <span className="home-row-actions">
                      <button type="button" className="btn btn-small btn-ghost" onClick={() => void api.revealPath(path)}>Show in folder</button>
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
