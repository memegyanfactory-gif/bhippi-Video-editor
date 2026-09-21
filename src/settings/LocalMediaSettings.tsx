import { useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { api, errorText } from '../lib/ipc';
import type { Settings } from '../lib/types';

export function LocalMediaSettings({ settings, onSettings, rotoOnly = false }: { settings: Settings; onSettings: (value: Settings) => void; rotoOnly?: boolean }) {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof api.localMediaStatus>> | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [hfToken, setHfToken] = useState('');
  const install = async (task: string) => {
    try { const id = await api.localMediaInstall(task, task === 'audio' && hfToken.trim() ? hfToken.trim() : undefined); setMessage(`Download started. Follow progress or cancel in Jobs (${id}).`); }
    catch (e) { setError(errorText(e)); }
  };
  useEffect(() => {
    let stopped = false;
    const refresh = () => void api.localMediaStatus().then(value => { if (!stopped) setStatus(value); }).catch(e => { if (!stopped) setError(errorText(e)); });
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
  return <section className="provider-group">
    <h3>{rotoOnly ? 'Tracked Roto models' : 'Local media models'}</h3>
    <button className="btn" onClick={() => void api.settingsGet().then(onSettings).catch(e => setError(errorText(e)))}>Refresh installation status</button>
    <p>{rotoOnly ? 'Download SAM 2.1 and ViTMatte here, then select them for Roto. The toolbar and AI use the same installed models.' : 'Generate assets directly on this computer. These specialist workers do not use ComfyUI. Configure compatible local weights before asking the assistant to generate media.'}</p>
    <h4>GPU runtime</h4>
    <p>{settings.localMediaPython || 'Choose a Python environment with CUDA PyTorch, Diffusers, Transformers, Accelerate, Pillow, SoundFile and imageio-ffmpeg.'}</p>
    <button className="btn" onClick={() => void choose()}>Choose Python</button>
    {!rotoOnly && (() => {
      const activeKind = settings.localVideoModel ?? (status?.tasks.some(r => r.task === 'video-ltx23' && r.configured) ? 'ltx23' : status?.tasks.some(r => r.task === 'video-wan' && r.configured) ? 'wan' : 'ltx');
      const ltx23Row = status?.tasks.find(r => r.task === 'video-ltx23');
      const ltxRow = status?.tasks.find(r => r.task === 'video-ltx');
      const wanRow = status?.tasks.find(r => r.task === 'video-wan');
      const activeRow = status?.tasks.find(r => r.task === 'video');
      return (
        <section className="provider-group">
          <h4>Text to Video Model</h4>
          <p>Choose which model to use for local video generation.</p>
          <label style={{ display: 'block', marginBottom: 12 }}>
            <strong>Active Video Model:</strong>
            <select
              aria-label="Active video model"
              value={activeKind}
              onChange={async (event) => {
                const next = { ...settings, localVideoModel: event.target.value as 'ltx' | 'wan' | 'ltx23' | 'custom' };
                onSettings(await api.settingsSave(next));
                setMessage(`Active video model switched to ${event.target.value.toUpperCase()}.`);
              }}
              style={{ display: 'block', width: '100%', marginTop: 4, padding: '6px 8px' }}
            >
              <option value="ltx23">LTX-Video 2.3 22B (ComfyUI Desktop Checkpoint · Synchronized Video + Audio)</option>
              <option value="wan">Wan 2.1 1.3B · Lightweight compact model</option>
              <option value="ltx">LTX-Video 2B (Lightricks) · Fast, cinematic, fits 10 GB VRAM</option>
              <option value="custom">Custom folder · Local Diffusers video model directory</option>
            </select>
          </label>

          {activeKind === 'ltx23' && (
            <div style={{ padding: '8px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 6, marginBottom: 8 }}>
              <strong>LTX-Video 2.3 22B (ComfyUI Checkpoint)</strong>
              <p>{ltx23Row?.configured ? 'Installed (29.15 GB) · Ready for Generation' : 'Checkpoint not found'}</p>
              <p style={{ wordBreak: 'break-all', fontSize: '0.9em' }}>{ltx23Row?.modelPath || settings.localMediaModels?.['video-ltx23'] || 'C:\\Users\\aayus\\AppData\\Local\\Comfy-Desktop\\ComfyUI-Shared\\models\\checkpoints\\ltx-2.3-22b-dev-fp8.safetensors'}</p>
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <button className="btn" onClick={() => void choose('video-ltx23')}>Choose .safetensors</button>
              </div>
              <p style={{ marginTop: 6, fontSize: '0.85em', opacity: 0.8 }}>
                Generates state-of-the-art cinematic video with synchronized audio. Automatically uses Gemma 3 12B text encoder and Distilled LoRA for 6-step accelerated sampling on your RTX 3080.
              </p>
            </div>
          )}

          {activeKind === 'ltx' && (
            <div style={{ padding: '8px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 6, marginBottom: 8 }}>
              <strong>LTX-Video 2B (Lightricks)</strong>
              <p>{ltxRow?.verified ? 'Inference succeeded · ready for generation' : ltxRow?.configured ? 'Configured · inference not yet verified' : 'Model not installed or configured'}</p>
              <p style={{ wordBreak: 'break-all', fontSize: '0.9em' }}>{ltxRow?.modelPath || settings.localMediaModels?.['video-ltx'] || 'No directory configured'}</p>
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <button className="btn" onClick={() => void choose('video-ltx')}>Choose folder</button>
                <button
                  className="btn"
                  disabled={!status?.pythonConfigured || ltxRow?.download?.status === 'running' || ltxRow?.configured}
                  onClick={() => void install('video-ltx')}
                >
                  {ltxRow?.download?.status === 'running' ? 'Downloading…' : ltxRow?.configured ? 'Installed' : 'Download LTX-Video 2B (~4.8 GB)'}
                </button>
              </div>
              {ltxRow?.download && (
                <div role="status" style={{ marginTop: 8 }}>
                  {ltxRow.download.status === 'running' && <progress aria-label="LTX-Video download progress" max={1} value={ltxRow.download.progress} style={{ width: '100%', marginTop: 4 }} />}
                  <p>{ltxRow.download.message}{ltxRow.download.totalBytes ? ` · ${((ltxRow.download.downloadedBytes ?? 0) / 1e9).toFixed(2)} / ${(ltxRow.download.totalBytes / 1e9).toFixed(2)} GB` : ''}</p>
                  {ltxRow.download.jobId && ltxRow.download.status === 'running' && <button className="btn" onClick={() => void api.jobCancel(ltxRow.download!.jobId!).catch(e => setError(errorText(e)))}>Cancel download</button>}
                </div>
              )}
              <p style={{ marginTop: 6, fontSize: '0.85em', opacity: 0.8 }}>Generates smooth 24 fps cinematic video at 768x512 / 704x480. High prompt adherence, no VRAM swapping on 10 GB GPUs.</p>
            </div>
          )}

          {activeKind === 'wan' && (
            <div style={{ padding: '8px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 6, marginBottom: 8 }}>
              <strong>Wan 2.1 1.3B</strong>
              <p>{wanRow?.verified ? 'Inference succeeded · ready for generation' : wanRow?.configured ? 'Configured · inference not yet verified' : 'Model not installed or configured'}</p>
              <p style={{ wordBreak: 'break-all', fontSize: '0.9em' }}>{wanRow?.modelPath || settings.localMediaModels?.['video-wan'] || 'No directory configured'}</p>
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <button className="btn" onClick={() => void choose('video-wan')}>Choose folder</button>
                <button
                  className="btn"
                  disabled={!status?.pythonConfigured || wanRow?.download?.status === 'running' || wanRow?.configured}
                  onClick={() => void install('video-wan')}
                >
                  {wanRow?.download?.status === 'running' ? 'Downloading…' : wanRow?.configured ? 'Installed' : 'Download Wan 2.1 1.3B'}
                </button>
              </div>
              {wanRow?.download && (
                <div role="status" style={{ marginTop: 8 }}>
                  {wanRow.download.status === 'running' && <progress aria-label="Wan download progress" max={1} value={wanRow.download.progress} style={{ width: '100%', marginTop: 4 }} />}
                  <p>{wanRow.download.message}{wanRow.download.totalBytes ? ` · ${((wanRow.download.downloadedBytes ?? 0) / 1e9).toFixed(2)} / ${(wanRow.download.totalBytes / 1e9).toFixed(2)} GB` : ''}</p>
                  {wanRow.download.jobId && wanRow.download.status === 'running' && <button className="btn" onClick={() => void api.jobCancel(wanRow.download!.jobId!).catch(e => setError(errorText(e)))}>Cancel download</button>}
                </div>
              )}
              <p style={{ marginTop: 6, fontSize: '0.85em', opacity: 0.8 }}>Generates 16 fps video at 832x480. Lower parameter count; susceptible to motion artifacts on complex scenes.</p>
            </div>
          )}

          {activeKind === 'custom' && (
            <div style={{ padding: '8px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 6, marginBottom: 8 }}>
              <strong>Custom Video Model Folder</strong>
              <p>{activeRow?.configured ? 'Configured Diffusers model folder' : 'No custom model folder selected'}</p>
              <p style={{ wordBreak: 'break-all', fontSize: '0.9em' }}>{settings.localMediaModels?.['video-custom'] || settings.localMediaModels?.['video'] || 'No folder selected'}</p>
              <button className="btn" onClick={() => void choose('video-custom')}>Select model directory</button>
              <p style={{ marginTop: 6, fontSize: '0.85em', opacity: 0.8 }}>Choose any Diffusers pipeline folder containing model_index.json (supports WanPipeline or LTXPipeline architecture).</p>
            </div>
          )}
        </section>
      );
    })()}

    {status?.tasks.filter(row => row.task === row.modelKey && !['video', 'video-ltx', 'video-wan'].includes(row.task) && (!rotoOnly || ['sam2', 'vitmatte'].includes(row.task))).map(row => <section key={row.task} className="provider-group">
      <h4>{row.label}</h4>
      <p>{row.verified ? 'Inference succeeded · review output quality for your shot' : row.configured ? 'Configured · inference not yet verified' : 'Model or runtime not configured'}</p>
      <p>{row.modelPath || settings.localMediaModels?.[row.modelKey] || 'No model directory selected'}</p>
      <button className="btn" onClick={() => void choose(row.modelKey)}>Choose model folder</button>
      <button className="btn" disabled={!status.pythonConfigured || row.download?.status === 'running' || row.configured} onClick={() => void install(row.modelKey)}>{row.download?.status === 'running' ? 'Downloading…' : row.configured ? 'Installed' : 'Download official model'}</button>
      {row.task === 'audio' && !row.configured && (
        <label style={{ display: 'block', marginTop: 8 }}>Hugging Face read token (gated model — accept its terms on huggingface.co first; used once, never stored)
          <input type="password" value={hfToken} onChange={(event) => setHfToken(event.target.value)} placeholder="hf_…" autoComplete="off" style={{ display: 'block', width: '100%', marginTop: 4 }} />
        </label>
      )}
      {row.download && <div role="status">
        {row.download.status === 'running' && <progress aria-label={`${row.label} download progress`} max={1} value={row.download.progress} style={{ width: '100%', marginTop: 8 }} />}
        <p>{row.download.message}{row.download.totalBytes ? ` · ${((row.download.downloadedBytes ?? 0) / 1e9).toFixed(2)} / ${(row.download.totalBytes / 1e9).toFixed(2)} GB` : ''}</p>
        {row.download.external && row.download.status === 'running' && <small>Continues in the background when you close Settings.</small>}
        {row.download.jobId && row.download.status === 'running' && <button className="btn" onClick={() => void api.jobCancel(row.download!.jobId!).catch(e => setError(errorText(e)))}>Cancel download</button>}
      </div>}
      <p>{row.modelKey === 'image' ? 'Shared SDXL Base 1.0 weights · OpenRAIL++ terms · multi-GB download. Masked replacement uses a white replacement region and preserves black regions.' : row.task === 'sam2' ? 'SAM 2.1 tiny · Apache 2.0 · used by experimental tracked Roto.' : row.task === 'vitmatte' ? 'ViTMatte small · Apache 2.0 · refines SAM trimaps into alpha; requires SAM for tracked Roto.' : row.task === 'depth' ? 'Depth Anything 3 Small · Apache 2.0 · relative video depth and foreground occlusion. Requires the Depth Anything 3 Python runtime. AI can place images, video or text behind the resulting foreground. Float depth and 16-bit mattes are retained. This is not hair matting or metre-accurate placement.' : row.task === 'person-track' ? 'RF-DETR Nano finds every person and ByteTrack keeps their identities while they move · Apache 2.0 / MIT · ~120 MB · runs on CPU, no GPU needed. The Download button also installs the rfdetr and supervision packages into the Python runtime above. Powers track_people and the podcast cut\u2019s auto-tracking: who sits where, 2 or 20 people.' : row.task === 'erase' ? 'LaMa big-lama \u00b7 Apache 2.0 \u00b7 ~200 MB \u00b7 builds a clean background plate behind a rotoscoped subject so text and graphics can sit truly behind the person. The Download button also installs simple-lama-inpainting into the Python runtime above.' : 'Stable Audio Open 1.0 · model-specific Stability license and gated download; use your own authorized Hugging Face login.'}</p>
      {status.tasks.filter(other => other.modelKey === row.modelKey && other.task !== row.task).map(other => <p key={other.task}>{other.label}: {other.verified ? 'inference succeeded' : other.configured ? 'ready to test' : 'uses this download'}</p>)}
    </section>)}
    <h4>Roto</h4><p>RVM remains the default. The experimental SAM 2.1 + ViTMatte path uses foreground/background points to track a subject and refine its alpha. Add a foreground point on the first frame. A quality comparison is still required.</p>
    <select aria-label="Roto engine" value={settings.localRotoEngine ?? 'rvm'} onChange={event => void api.settingsSave({ ...settings, localRotoEngine: event.target.value }).then(onSettings).catch(e => setError(errorText(e)))}>
      <option value="rvm">RVM · fallback</option><option value="sam2-vitmatte" disabled={!['sam2', 'vitmatte'].every(task => status?.tasks.some(row => row.task === task && row.configured))}>SAM 2.1 + ViTMatte · tracked Roto</option>
    </select>
    <button className="btn" disabled={!['sam2', 'vitmatte'].every(task => status?.tasks.some(row => row.task === task && row.configured)) || settings.localRotoEngine === 'sam2-vitmatte'} onClick={() => void api.settingsSave({ ...settings, localRotoEngine: 'sam2-vitmatte' }).then(onSettings).then(() => setMessage('Tracked Roto selected for the toolbar and AI. Add a foreground point on the first clip frame, then run Roto.')).catch(e => setError(errorText(e)))}>{settings.localRotoEngine === 'sam2-vitmatte' ? 'Selected for Roto and AI' : 'Use SAM + ViTMatte for Roto and AI'}</button>
    {!rotoOnly && <><h4>3D, masked video editing and structural controls</h4><p>Not integrated yet. These tasks require dedicated adapters and cannot be performed by the text-to-video worker above.</p></>}
    {error && <p role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
  </section>;
}
