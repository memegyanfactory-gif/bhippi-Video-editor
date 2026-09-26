// Color Lab (color-lab.html, `npm run dev:web` → /color-lab.html): the Color Studio, the Histogram
// panel and the GPU grade pass on a generated test picture, outside the app — for checking the
// grading tools' layout and behaviour in a plain browser.
import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/app.css';
import '../styles/themes.css';
import '../styles/color.css';
import { useHistory } from '../lib/history';
import { newClip, newComp, newProject } from '../lib/timeline';
import { createAppliedEffect } from '../lib/effectFilters';
import { EFFECT_MAP } from '../lib/effectsCatalog';
import { syncProjectLuts } from '../lib/luts';
import type { Asset, Project } from '../lib/types';
import { EffectControlsPanel } from '../panels/EffectControlsPanel';
import { composeGrades, GradedImage, gradeLut } from '../editor/GradeCanvas';
import { ScopesPanel } from './ScopesPanel';

/** A test picture: sky gradient, a face-toned oval, colour swatches and a grey ramp. */
function testPicture(): string {
  const canvas = document.createElement('canvas');
  canvas.width = 960; canvas.height = 540;
  const c = canvas.getContext('2d')!;
  const sky = c.createLinearGradient(0, 0, 0, 300);
  sky.addColorStop(0, '#5d86b8'); sky.addColorStop(1, '#d9c7a8');
  c.fillStyle = sky; c.fillRect(0, 0, 960, 300);
  c.fillStyle = '#3f5a2c'; c.fillRect(0, 300, 960, 120);
  c.fillStyle = '#c99479'; c.beginPath(); c.ellipse(250, 250, 90, 120, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#8f5f4c'; c.beginPath(); c.ellipse(250, 330, 50, 20, 0, 0, Math.PI * 2); c.fill();
  ['#c0392b', '#e67e22', '#f1c40f', '#27ae60', '#16a085', '#2980b9', '#8e44ad'].forEach((color, i) => { c.fillStyle = color; c.fillRect(420 + i * 72, 120, 64, 120); });
  for (let i = 0; i < 32; i++) { const v = Math.round((i / 31) * 255); c.fillStyle = `rgb(${v},${v},${v})`; c.fillRect(i * 30, 430, 30, 110); }
  return canvas.toDataURL('image/png');
}

function Lab() {
  const picture = useMemo(testPicture, []);
  const asset: Asset = useMemo(() => ({ id: 'picture', name: 'Test picture', path: picture, kind: 'image', duration: 10, width: 960, height: 540, fps: null, hasAudio: false, videoCodec: null } as unknown as Asset), [picture]);
  const initial = useMemo<Project>(() => {
    const project = newProject('Color Lab');
    const comp = newComp({ name: 'Grade', width: 960, height: 540, fps: 30 });
    const clip = newClip({ trackId: comp.tracks.find((t) => t.kind === 'video')!.id, source: { type: 'media', assetId: 'picture' }, duration: 10, start: 0 });
    const grade = createAppliedEffect(EFFECT_MAP.get('lumetri-color')!);
    const tint = createAppliedEffect(EFFECT_MAP.get('levels')!);
    return { ...project, comps: [{ ...comp, clips: [{ ...clip, name: 'Test picture', appliedEffects: [grade, tint] }] }], activeCompId: comp.id, openCompIds: [comp.id] };
  }, []);
  const history = useHistory(initial);
  const project = history.project;
  syncProjectLuts(project);
  const comp = project.comps[0];
  const clip = comp.clips[0];
  const [scopes, setScopes] = useState(true);
  const assets = useMemo(() => new Map([[asset.id, asset]]), [asset]);
  const grades = (clip.appliedEffects ?? []).filter((fx) => fx.enabled && fx.effectId === 'lumetri-color');
  const spec = composeGrades(grades.map((fx) => ({ ...gradeLut(fx.params), mix: 1 })));
  return (
    <div className="color-lab" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 400px', height: '100vh', background: 'var(--panel)', color: 'var(--text)' }}>
      <div className="monitor program" style={{ minWidth: 0 }}>
        <div className="monitor-frame-wrap">
          {scopes && <ScopesPanel project={project} comp={comp} selection={[clip.id]} onClose={() => setScopes(false)} />}
          <div className="monitor-frame">
            <div data-clip-id={clip.id} style={{ position: 'relative', width: 800, height: 450 }}>
              {spec ? <GradedImage src={picture} grade={spec} /> : <img className="layer-media" src={picture} alt="" style={{ width: '100%', height: '100%' }} />}
            </div>
          </div>
        </div>
        <div className="monitor-bar"><button type="button" className="btn btn-small" onClick={() => setScopes(!scopes)}>Histogram</button><span className="toolbar-spacer" /><span className="timecode dim">{spec ? 'GPU graded' : 'ungraded'}</span></div>
      </div>
      <div style={{ overflow: 'auto', borderLeft: '1px solid var(--line)' }}>
        <EffectControlsPanel project={project} comp={comp} assets={assets} history={history} selection={[clip.id]} />
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><Lab /></StrictMode>);
