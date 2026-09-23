// The motion-engine templates in the Graphics tab: one click places a template at the playhead,
// using the selected clip as its footage when it takes some (subject reveal, cut-out, b-roll…).
import { Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useToast } from '../components/ui';
import { MOTION_TEMPLATES } from '../motion/kit';
import type { History } from '../lib/history';
import { placeTemplateByHand, TEMPLATE_FOOTAGE } from '../lib/motionTools';
import { playhead } from '../lib/playhead';
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
  return (
    <div className="effects-section">
      <div className="effects-title">Motion templates <span className="muted">— GPU engine, at the playhead; footage templates use the selected clip</span></div>
      <div className="chips" style={{ flexWrap: 'wrap' }}>
        {MOTION_TEMPLATES.map((spec) => (
          <button key={spec.id} type="button" className="chip" disabled={busy !== null} onClick={() => void place(spec.id)}
            title={`${spec.use}${TEMPLATE_FOOTAGE[spec.id] ? `\nUses the selected clip as ${TEMPLATE_FOOTAGE[spec.id]}.` : ''}\n${spec.technique}`}>
            <Sparkles size={11} /> {spec.label}
          </button>
        ))}
      </div>
    </div>
  );
}
