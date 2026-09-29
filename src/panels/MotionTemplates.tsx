// The motion-engine templates in the Graphics tab: one click places a template at the playhead,
// using the selected clip as its footage when it takes some (subject reveal, cut-out, b-roll…).
import { Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useToast } from '../components/ui';
import { MOTION_TEMPLATES } from '../motion/kit';
import type { History } from '../lib/history';
import { nestLooseMotionScenes, placeTemplateByHand, TEMPLATE_FOOTAGE } from '../lib/motionTools';
import { playhead } from '../lib/playhead';
import { thumbnailUrl } from '../lib/templateExamples';
import type { Asset } from '../lib/types';

export function MotionTemplates({ history, assets, clipSelection }: { history: History; assets: Asset[]; clipSelection: string[] }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const assetMap = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);
  const place = async (id: string) => {
    setBusy(id);
    try {
      const result = await placeTemplateByHand({ history, assets: assetMap, templateId: id, start: playhead.get(), selectedClipId: clipSelection.length === 1 ? clipSelection[0] : null });
      if (result.ok) toast({ tone: 'success', title: 'Motion scene placed', body: String(result.summary ?? '').split('. ')[0], timeout: 2500 });
      else toast({ tone: 'error', title: 'Could not place the template', body: String(result.error) });
    } finally {
      setBusy(null);
    }
  };
  const project = history.current();
  const comp = project.comps.find((c) => c.id === project.activeCompId) ?? project.comps[0];
  const loose = comp ? comp.clips.filter((clip) => clip.source.type === 'motion').length : 0;
  const nest = () => {
    if (!comp) return;
    const result = nestLooseMotionScenes(history.current(), comp.id);
    if (!result.count) return;
    history.commit(() => result.project, 'Put Motion Scenes into Comps');
    toast({ tone: 'success', title: `${result.count} motion scene${result.count === 1 ? '' : 's'} moved into comps`, body: 'Find them in the AI Motion bin; double-click a comp clip to edit it.', timeout: 3500 });
  };
  return (
    <div className="effects-section">
      <div className="effects-title">
        Motion templates <span className="muted">— GPU engine, at the playhead; footage templates use the selected clip</span>
        {loose > 0 && <><div className="toolbar-spacer" /><button type="button" className="btn btn-small" onClick={nest} title="Each loose motion scene becomes its own [Motion] comp, placed where it was">Put {loose} motion scene{loose === 1 ? '' : 's'} into comps</button></>}
      </div>
      <div className="mt-grid">
        {MOTION_TEMPLATES.map((spec) => {
          const thumb = thumbnailUrl(spec.id);
          return (
            <button key={spec.id} type="button" className="mt-card" disabled={busy !== null} onClick={() => void place(spec.id)}
              title={`${spec.use}${TEMPLATE_FOOTAGE[spec.id] ? `\nUses the selected clip as ${TEMPLATE_FOOTAGE[spec.id]}.` : ''}\n${spec.technique}`}>
              {thumb ? <img src={thumb} alt="" loading="lazy" draggable={false} /> : <span className="mt-card-blank"><Sparkles size={16} />{TEMPLATE_FOOTAGE[spec.id] ? <em>uses footage</em> : null}</span>}
              <span className="mt-card-label">{spec.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
