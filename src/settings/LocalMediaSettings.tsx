import { useEffect, useState, type ReactNode } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { Box, Check, Cpu, Download, Eraser, Film, FolderOpen, Image, Layers, Music, RefreshCw, Scissors, TriangleAlert, Users } from 'lucide-react';
import { DownloadProgress, type DownloadJob } from './DownloadProgress';
import { LocalModelAdvisor, type ModelInstall } from './LocalModelAdvisor';
import { Toggle } from '../components/ui';
import { api, errorText } from '../lib/ipc';
import { AI_PACK_FEATURES, aiPackApi, aiPackReady, type AiPackStatus } from '../lib/aiPack';
import type { Settings } from '../lib/types';

type Task = NonNullable<Awaited<ReturnType<typeof api.localMediaStatus>>>['tasks'][number];

/** How installed a task is, in the same ok/warn/off vocabulary as every other settings tab. */
function taskTone(row: { configured: boolean; verified: boolean } | undefined): { tone: 'ok' | 'warn' | 'off'; label: string } {
  if (!row) return { tone: 'off', label: 'Not installed' };
  if (row.verified) return { tone: 'ok', label: 'Ready' };
  if (row.configured) return { tone: 'warn', label: 'Configured · unverified' };
  return { tone: 'off', label: 'Not installed' };
}

const TASK_ICON: Record<string, ReactNode> = {
  image: <Image size={16} />,
  audio: <Music size={16} />,
  sam2: <Scissors size={16} />,
  vitmatte: <Scissors size={16} />,
  depth: <Layers size={16} />,
  'person-track': <Users size={16} />,
  erase: <Eraser size={16} />,
};

export function LocalMediaSettings({ settings, onSettings, rotoOnly = false }: { settings: Settings; onSettings: (value: Settings) => void; rotoOnly?: boolean }) {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof api.localMediaStatus>> | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [hfToken, setHfToken] = useState('');
  const [pack, setPack] = useState<AiPackStatus | null>(null);
  const installPack = async () => {
    try { const id = await aiPackApi.install(); setMessage(`AI pack install started. Follow progress or cancel in Jobs (${id}).`); }
    catch (e) { setError(errorText(e)); }
  };
  const install = async (task: string) => {
    try { const id = await api.localMediaInstall(task, (task === 'audio' || task === 'image-flux') && hfToken.trim() ? hfToken.trim() : undefined); setMessage(`Download started. Follow progress or cancel in Jobs (${id}).`); }
    catch (e) { setError(errorText(e)); }
  };
  useEffect(() => {
    let stopped = false;
    const refresh = () => {
      void api.localMediaStatus().then(value => { if (!stopped) setStatus(value); }).catch(e => { if (!stopped) setError(errorText(e)); });
      void aiPackApi.status().then(value => { if (!stopped) setPack(value); }).catch(() => undefined);
    };
    refresh();
    const interval = window.setInterval(refresh, 2000);
    return () => { stopped = true; window.clearInterval(interval); };
  }, [settings]);
  const choose = async (task?: string) => {
    try {
      const path = await open({ directory: !!task, multiple: false, title: task ? 'Select local Diffusers checkpoint folder' : 'Select local media Python executable' });
      if (typeof path !== 'string') return;
      const next = task ? { ...settings, localMediaModels: { ...settings.localMediaModels, [task]: path } } : { ...settings, localMediaPython: path };
      onSettings(await api.settingsSave(next));
    } catch (e) { setError(errorText(e)); }
  };

  const pythonReady = !!settings.localMediaPython;
  const chooseBlender = async (clear = false) => {
    try {
      const path = clear ? null : await open({ multiple: false, title: 'Select the Blender program (blender.exe)' });
      if (!clear && typeof path !== 'string') return;
      onSettings(await api.settingsSave({ ...settings, blenderPath: path }));
    } catch (e) { setError(errorText(e)); }
  };

  return <section className="provider-group">
    <div className="settings-intro">
      <div>
        <h3>{rotoOnly ? 'Tracked Roto models' : 'Local media models'}</h3>
        <p>{rotoOnly
          ? 'Download SAM 2.1 and ViTMatte here, then select them for Roto. The toolbar and AI use the same installed models.'
          : 'Generate assets directly on this computer — images, video, audio, depth and matting — with no ComfyUI required. Everything below is optional: install only the tasks you plan to use.'}</p>
      </div>
      <button type="button" className="btn" onClick={() => void api.settingsGet().then(onSettings).catch(e => setError(errorText(e)))}><RefreshCw size={14} /> Refresh status</button>
    </div>

    {!rotoOnly && (
      <section className="provider-group">
        <h4><Image size={14} /> AI image &amp; video generation</h4>
        <label className="provider-auto-update">
          <Toggle
            checked={!(settings.disableLocalGeneration ?? true)}
            onChange={(on) => onSettings({ ...settings, disableLocalGeneration: !on })}
            label="Let the AI generate images and video with the local models below"
          />
          <span>Let the AI generate images and video with the local models below</span>
        </label>
        <p className="group-blurb">
          {(settings.disableLocalGeneration ?? true)
            ? 'Off by default: the AI sources real footage online for each shot instead (or, for a topic with nothing real to find, builds an animated HTML/CSS explainer panel). Turn this on to let it generate images or video with the local models below instead.'
            : 'On: the AI may generate images and video with the local models below during Gather. Local voice-over and music generation are never affected by this switch.'}
        </p>
      </section>
    )}

    <section className="provider-group">
      <h4><Cpu size={14} /> GPU runtime</h4>
      {pack && (
        <div className={`tool-card${aiPackReady(pack) ? ' ok' : ' missing'}`}>
          {aiPackReady(pack) ? <Check size={18} /> : <Download size={18} />}
          <div>
            <strong>{aiPackReady(pack) ? 'AI pack installed' : 'AI pack — one click'}</strong>
            <span>{AI_PACK_FEATURES}. Installs its own Python, PyTorch{pack.cuda ? ' with CUDA for your NVIDIA GPU' : ' (CPU build — no NVIDIA GPU found)'} and the models. Text-to-image and text-to-video models are not included.</span>
            {!aiPackReady(pack) && <span>About {(pack.remainingMb / 1000).toFixed(1)} GB to download{pack.python || pack.libraries || pack.tasks.some(([, done]) => done) ? ' — resumes where it stopped' : ''}.</span>}
          </div>
          <div className="provider-actions">
            {!aiPackReady(pack) && <button type="button" className="btn btn-small" onClick={() => void installPack()}><Download size={12} /> Install AI pack</button>}
          </div>
        </div>
      )}
      <div className={`tool-card${pythonReady ? ' ok' : ' missing'}`}>
        {pythonReady ? <Check size={18} /> : <TriangleAlert size={18} />}
        <div>
          <strong>{pythonReady ? 'Python environment set' : 'No Python environment set yet'}</strong>
          {!pythonReady && <span>Install the AI pack above, or choose your own Python environment.</span>}
          <span>{settings.localMediaPython || 'Every task below needs one Python environment with CUDA PyTorch, Diffusers, Transformers, Accelerate, Pillow, SoundFile and imageio-ffmpeg.'}</span>
          {!pythonReady && <span className="warn">Choose it first — every Download button below stays disabled until this is set.</span>}
        </div>
        <div className="provider-actions">
          <button type="button" className="btn btn-small" onClick={() => void choose()}><FolderOpen size={12} /> Choose Python</button>
        </div>
      </div>
    </section>

    {!rotoOnly && <BlenderCard path={settings.blenderPath ?? null} onChoose={() => void chooseBlender()} onAuto={() => void chooseBlender(true)} />}

    {!rotoOnly && (() => {
      const videoKind = settings.localVideoModel ?? null;
      const installs: Record<string, ModelInstall> = {};
      for (const row of status?.tasks ?? []) {
        const active = row.task === 'image' ? (settings.localImageModel ?? 'sdxl') === 'sdxl'
          : row.task === 'image-flux' ? settings.localImageModel === 'flux'
          : row.task === `video-${videoKind}`;
        installs[row.task] = { configured: row.configured, downloading: row.download?.status === 'running', progress: row.download?.progress, active: row.configured && active };
      }
      return <LocalModelAdvisor installs={installs} pythonReady={pythonReady}
        onDownload={(task) => {
          if (task === 'image-flux' && !hfToken.trim()) { setError('FLUX.1 schnell is gated: accept its terms on huggingface.co, paste a read token in the FLUX row below, then download.'); return; }
          void install(task);
        }}
        onChoose={(task) => void choose(task)}
        onUse={(task) => {
          const next = task.startsWith('image')
            ? { ...settings, localImageModel: task === 'image-flux' ? 'flux' as const : 'sdxl' as const }
            : { ...settings, localVideoModel: task.replace('video-', '') as 'ltx' | 'wan' | 'wan22' | 'ltx23' };
          void api.settingsSave(next).then(onSettings).then(() => setMessage('Model switched. The AI and the generate tools use it from now on.')).catch(e => setError(errorText(e)));
        }} />;
    })()}

    {!rotoOnly && (() => {
      const activeKind = settings.localVideoModel ?? (status?.tasks.some(r => r.task === 'video-ltx23' && r.configured) ? 'ltx23' : status?.tasks.some(r => r.task === 'video-wan' && r.configured) ? 'wan' : 'ltx');
      const ltx23Row = status?.tasks.find(r => r.task === 'video-ltx23');
      const ltxRow = status?.tasks.find(r => r.task === 'video-ltx');
      const wanRow = status?.tasks.find(r => r.task === 'video-wan');
      const activeRow = status?.tasks.find(r => r.task === 'video');
      return (
        <section className="provider-group">
          <h4><Film size={14} /> Text to video model</h4>
          <p className="group-blurb">Choose which model local video generation uses.</p>
          <label className="field">
            <span>Active video model</span>
            <select
              aria-label="Active video model"
              value={activeKind}
              onChange={async (event) => {
                const next = { ...settings, localVideoModel: event.target.value as 'ltx' | 'wan' | 'wan22' | 'ltx23' | 'custom' };
                onSettings(await api.settingsSave(next));
                setMessage(`Active video model switched to ${event.target.value.toUpperCase()}.`);
              }}
            >
              <option value="ltx23">LTX-Video 2.3 22B (ComfyUI checkpoint · video + synchronized audio)</option>
              <option value="wan22">Wan 2.2 5B · 720p, 24 fps, needs 16 GB+ VRAM</option>
              <option value="wan">Wan 2.1 1.3B · lightweight, compact model</option>
              <option value="ltx">LTX-Video 2B (Lightricks) · fast, cinematic, fits 10 GB VRAM</option>
              <option value="custom">Custom folder · local Diffusers video model directory</option>
            </select>
          </label>

          {activeKind === 'ltx23' && (
            <VideoModelCard tone={taskTone(ltx23Row).tone} label="LTX-Video 2.3 22B" state={taskTone(ltx23Row).label}
              path={ltx23Row?.modelPath || settings.localMediaModels?.['video-ltx23'] || null}
              description="Cinematic video with synchronized audio, ~29 GB checkpoint. Automatically uses the Gemma 3 12B text encoder and a distilled LoRA for 6-step accelerated sampling.">
              <button type="button" className="btn btn-small" onClick={() => void choose('video-ltx23')}><FolderOpen size={12} /> Choose .safetensors</button>
            </VideoModelCard>
          )}

          {activeKind === 'ltx' && (
            <VideoModelCard tone={taskTone(ltxRow).tone} label="LTX-Video 2B (Lightricks)" state={taskTone(ltxRow).label}
              path={ltxRow?.modelPath || settings.localMediaModels?.['video-ltx'] || null}
              description="Smooth 24 fps cinematic video at 768×512 / 704×480. High prompt adherence, no VRAM swapping on 10 GB GPUs."
              progress={ltxRow?.download?.status === 'running' ? ltxRow.download : undefined}>
              <button type="button" className="btn btn-small" onClick={() => void choose('video-ltx')}><FolderOpen size={12} /> Choose folder</button>
              <button type="button" className="btn btn-small" disabled={!pythonReady || ltxRow?.download?.status === 'running' || ltxRow?.configured} title={!pythonReady ? 'Choose a Python environment first' : undefined} onClick={() => void install('video-ltx')}>
                {ltxRow?.download?.status === 'running' ? <><Download size={12} /> Downloading…</> : ltxRow?.configured ? <><Check size={12} /> Installed</> : <><Download size={12} /> Download (~28 GB)</>}
              </button>
              {ltxRow?.download?.jobId && ltxRow.download.status === 'running' && <button type="button" className="btn btn-small btn-ghost" onClick={() => void api.jobCancel(ltxRow.download!.jobId!).catch(e => setError(errorText(e)))}>Cancel</button>}
            </VideoModelCard>
          )}

          {activeKind === 'wan22' && (() => {
            const row = status?.tasks.find(r => r.task === 'video-wan22');
            return (
              <VideoModelCard tone={taskTone(row).tone} label="Wan 2.2 TI2V 5B" state={taskTone(row).label}
                path={row?.modelPath || settings.localMediaModels?.['video-wan22'] || null}
                description="1280×704 at 24 fps, up to 5 s. Sharp 720p with steady motion; ~34 GB download."
                progress={row?.download?.status === 'running' ? row.download : undefined}>
                <button type="button" className="btn btn-small" onClick={() => void choose('video-wan22')}><FolderOpen size={12} /> Choose folder</button>
                <button type="button" className="btn btn-small" disabled={!pythonReady || row?.download?.status === 'running' || row?.configured} title={!pythonReady ? 'Choose a Python environment first' : undefined} onClick={() => void install('video-wan22')}>
                  {row?.download?.status === 'running' ? <><Download size={12} /> Downloading…</> : row?.configured ? <><Check size={12} /> Installed</> : <><Download size={12} /> Download (~34 GB)</>}
                </button>
              </VideoModelCard>
            );
          })()}

          {activeKind === 'wan' && (
            <VideoModelCard tone={taskTone(wanRow).tone} label="Wan 2.1 1.3B" state={taskTone(wanRow).label}
              path={wanRow?.modelPath || settings.localMediaModels?.['video-wan'] || null}
              description="16 fps video at 832×480. Lower parameter count, so it is more susceptible to motion artifacts on complex scenes."
              progress={wanRow?.download?.status === 'running' ? wanRow.download : undefined}>
              <button type="button" className="btn btn-small" onClick={() => void choose('video-wan')}><FolderOpen size={12} /> Choose folder</button>
              <button type="button" className="btn btn-small" disabled={!pythonReady || wanRow?.download?.status === 'running' || wanRow?.configured} title={!pythonReady ? 'Choose a Python environment first' : undefined} onClick={() => void install('video-wan')}>
                {wanRow?.download?.status === 'running' ? <><Download size={12} /> Downloading…</> : wanRow?.configured ? <><Check size={12} /> Installed</> : <><Download size={12} /> Download</>}
              </button>
              {wanRow?.download?.jobId && wanRow.download.status === 'running' && <button type="button" className="btn btn-small btn-ghost" onClick={() => void api.jobCancel(wanRow.download!.jobId!).catch(e => setError(errorText(e)))}>Cancel</button>}
            </VideoModelCard>
          )}

          {activeKind === 'custom' && (
            <VideoModelCard tone={activeRow?.configured ? 'ok' : 'off'} label="Custom video model folder" state={activeRow?.configured ? 'Configured' : 'Not selected'}
              path={settings.localMediaModels?.['video-custom'] || settings.localMediaModels?.['video'] || null}
              description="Any Diffusers pipeline folder containing model_index.json — supports the WanPipeline or LTXPipeline architecture.">
              <button type="button" className="btn btn-small" onClick={() => void choose('video-custom')}><FolderOpen size={12} /> Select folder</button>
            </VideoModelCard>
          )}
        </section>
      );
    })()}

    {(() => {
      const rows = status?.tasks.filter(row => row.task === row.modelKey && !['video', 'video-ltx', 'video-wan', 'video-wan22'].includes(row.task) && (!rotoOnly || ['sam2', 'vitmatte'].includes(row.task))) ?? [];
      if (!rows.length) return null;
      return (
        <section className="provider-group">
          <h4><Layers size={14} /> {rotoOnly ? 'Roto models' : 'Other local models'}</h4>
          {rows.map(row => <TaskRow key={row.task} row={row} status={status} pythonReady={pythonReady}
            hfToken={hfToken} onHfToken={setHfToken}
            onChoose={() => void choose(row.modelKey)} onInstall={() => void install(row.modelKey)}
            onCancel={() => void api.jobCancel(row.download!.jobId!).catch(e => setError(errorText(e)))} />)}
        </section>
      );
    })()}

    <section className="provider-group">
      <h4><Scissors size={14} /> Roto engine</h4>
      <p className="group-blurb">RVM remains the default. The experimental SAM 2.1 + ViTMatte path uses foreground/background points to track a subject and refine its alpha — add a foreground point on the first frame. A quality comparison is still required.</p>
      <label className="field">
        <span>Engine</span>
        <select aria-label="Roto engine" value={settings.localRotoEngine ?? 'rvm'} onChange={event => void api.settingsSave({ ...settings, localRotoEngine: event.target.value }).then(onSettings).catch(e => setError(errorText(e)))}>
          <option value="rvm">RVM · fallback</option>
          <option value="sam2-vitmatte" disabled={!['sam2', 'vitmatte'].every(task => status?.tasks.some(row => row.task === task && row.configured))}>SAM 2.1 + ViTMatte · tracked Roto</option>
        </select>
      </label>
      <button type="button" className="btn btn-small" disabled={!['sam2', 'vitmatte'].every(task => status?.tasks.some(row => row.task === task && row.configured)) || settings.localRotoEngine === 'sam2-vitmatte'}
        onClick={() => void api.settingsSave({ ...settings, localRotoEngine: 'sam2-vitmatte' }).then(onSettings).then(() => setMessage('Tracked Roto selected for the toolbar and AI. Add a foreground point on the first clip frame, then run Roto.')).catch(e => setError(errorText(e)))}>
        {settings.localRotoEngine === 'sam2-vitmatte' ? <><Check size={12} /> Selected for Roto and AI</> : 'Use SAM + ViTMatte for Roto and AI'}
      </button>
    </section>

    {!rotoOnly && (
      <section className="provider-group">
        <h4>3D, masked video editing and structural controls</h4>
        <p className="group-blurb">Not integrated yet. These tasks require dedicated adapters and cannot be performed by the text-to-video worker above.</p>
      </section>
    )}

    {error && <p role="alert" className="field-hint error">{error}</p>}
    {message && <p role="status" className="field-hint">{message}</p>}
  </section>;
}

/** One video-model option: icon, install state, path, description, then whatever actions apply. */
function VideoModelCard({ tone, label, state, path, description, progress, children }: {
  tone: 'ok' | 'warn' | 'off'; label: string; state: string; path: string | null; description: string; progress?: DownloadJob; children: ReactNode;
}) {
  return (
    <div className={`tool-card${tone === 'ok' ? ' ok' : ' missing'}`}>
      {tone === 'ok' ? <Check size={18} /> : <TriangleAlert size={18} />}
      <div>
        <div className="provider-title"><strong>{label}</strong><span className={`pill tone-${tone}`}>{state}</span></div>
        <span>{path ?? 'No model selected yet'}</span>
        <span>{description}</span>
        {progress && <DownloadProgress job={progress} />}
      </div>
      <div className="provider-actions">{children}</div>
    </div>
  );
}

/** One generic model/runtime task (image, audio, matting, depth, person tracking, eraser…). */
function TaskRow({ row, status, pythonReady, hfToken, onHfToken, onChoose, onInstall, onCancel }: {
  row: Task;
  status: Awaited<ReturnType<typeof api.localMediaStatus>> | null;
  pythonReady: boolean;
  hfToken: string;
  onHfToken: (value: string) => void;
  onChoose: () => void;
  onInstall: () => void;
  onCancel: () => void;
}) {
  const tone = taskTone(row);
  const downloading = row.download?.status === 'running';
  const description = row.task === 'image-flux' ? 'FLUX.1 schnell · Apache 2.0 · ~34 GB · gated: accept the terms on huggingface.co/black-forest-labs/FLUX.1-schnell and paste a read token. Plain text-to-image only; edits stay on SDXL.'
    : row.modelKey === 'image' ? 'Shared SDXL Base 1.0 weights · OpenRAIL++ terms · multi-GB download. Masked replacement uses a white replacement region and preserves black regions.'
    : row.task === 'sam2' ? 'SAM 2.1 tiny · Apache 2.0 · used by experimental tracked Roto.'
    : row.task === 'vitmatte' ? 'ViTMatte small · Apache 2.0 · refines SAM trimaps into alpha; requires SAM for tracked Roto.'
    : row.task === 'depth' ? 'Depth Anything 3 Small · Apache 2.0 · relative video depth and foreground occlusion, so the AI can place images, video or text behind a subject. Not hair matting or metre-accurate placement.'
    : row.task === 'person-track' ? 'RF-DETR Nano + ByteTrack · Apache 2.0 / MIT · ~120 MB · CPU only, no GPU needed. Also installs the rfdetr and supervision packages. Powers track_people and the podcast cut’s auto-tracking.'
    : row.task === 'erase' ? 'LaMa big-lama · Apache 2.0 · ~200 MB · builds a clean background plate behind a rotoscoped subject so text and graphics can sit truly behind the person. Also installs simple-lama-inpainting.'
    : 'Stable Audio Open 1.0 · model-specific Stability license and gated download; use your own authorized Hugging Face login.';
  const shared = status?.tasks.filter(other => other.modelKey === row.modelKey && other.task !== row.task) ?? [];
  return (
    <div className={`provider-row model-row${tone.tone === 'ok' ? ' ready' : ''}`}>
      <div className="model-icon">{TASK_ICON[row.task] ?? <Layers size={16} />}</div>
      <div className="provider-main">
        <div className="provider-title"><strong>{row.label}</strong><span className={`pill tone-${tone.tone}`}>{tone.tone === 'ok' && <Check size={11} />}{tone.label}</span></div>
        <div className="provider-detail"><span>{row.modelPath || 'No model directory selected'}</span></div>
        <p className="muted small">{description}</p>
        {(row.task === 'audio' || row.task === 'image-flux') && !row.configured && (
          <label className="field">
            <span>Hugging Face read token (gated model — accept its terms on huggingface.co first; used once, never stored)</span>
            <input type="password" value={hfToken} onChange={(event) => onHfToken(event.target.value)} placeholder="hf_…" autoComplete="off" />
          </label>
        )}
        {row.download && (downloading || row.download.message) && <DownloadProgress job={row.download} />}
        {row.download?.external && downloading && <span className="field-hint">Continues in the background when you close Settings.</span>}
        {shared.map(other => <p key={other.task} className="muted small">{other.label}: {other.verified ? 'inference succeeded' : other.configured ? 'ready to test' : 'uses this download'}</p>)}
      </div>
      <div className="provider-actions">
        <button type="button" className="btn btn-small" onClick={onChoose}><FolderOpen size={12} /> Choose folder</button>
        {downloading && row.download?.jobId ? (
          <button type="button" className="btn btn-small btn-ghost" onClick={onCancel}>Cancel</button>
        ) : (
          <button type="button" className="btn btn-small" disabled={!pythonReady || row.configured} title={!pythonReady ? 'Choose a Python environment first' : undefined} onClick={onInstall}>
            <Download size={12} /> {row.configured ? 'Installed' : 'Download'}
          </button>
        )}
      </div>
    </div>
  );
}

/** Headless Blender for the AI's 3D renders (render_3d_scene): found on its own, or chosen here. */
function BlenderCard({ path, onChoose, onAuto }: { path: string | null; onChoose: () => void; onAuto: () => void }) {
  const [status, setStatus] = useState<{ found: boolean; path?: string; version?: string | null; hint?: string } | null>(null);
  useEffect(() => {
    let stopped = false;
    setStatus(null);
    void api.blenderStatus().then((value) => { if (!stopped) setStatus(value); }).catch(() => { if (!stopped) setStatus({ found: false }); });
    return () => { stopped = true; };
  }, [path]);
  const found = !!status?.found;
  return (
    <section className="provider-group">
      <h4><Box size={14} /> 3D renders (Blender)</h4>
      <p className="group-blurb">The AI renders real 3D (glass, pearl, metal, extruded logos, devices showing your UI) in your own Blender, headless in the background. Blender is free from blender.org; 4.2 or newer.</p>
      <div className={`tool-card${found ? ' ok' : ' missing'}`}>
        {found ? <Check size={18} /> : <TriangleAlert size={18} />}
        <div>
          <strong>{status === null ? 'Looking for Blender…' : found ? (status.version ?? 'Blender found') : 'Blender not found'}</strong>
          <span>{found ? status!.path : status?.hint ?? 'Install Blender, or choose its program if it lives somewhere unusual.'}</span>
          {path && <span>Chosen by hand{found ? '' : ' — that file is missing'}.</span>}
        </div>
        <div className="provider-actions">
          <button type="button" className="btn btn-small" onClick={onChoose}><FolderOpen size={12} /> Choose Blender</button>
          {path && <button type="button" className="btn btn-small" onClick={onAuto}>Find automatically</button>}
        </div>
      </div>
    </section>
  );
}
