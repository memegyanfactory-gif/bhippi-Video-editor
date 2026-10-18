// "Bounce" renders the song offline to a WAV and imports it into the bin; "Send to timeline" also
// lays it on the active video comp as the music bed, with its beat grid.
import { useState } from 'react';
import { Clapperboard, Download, Loader2 } from 'lucide-react';
import { bounceSong, hasArrangement } from '../bounce';
import { useActions } from './ctx';

export function BounceButtons() {
  const act = useActions();
  const { toast } = act;
  const [busy, setBusy] = useState<'bounce' | 'place' | null>(null);

  const run = async (place: boolean) => {
    if (busy) return;
    setBusy(place ? 'place' : 'bounce');
    try {
      const s = act.getSong();
      const songMode = s.view.mode === 'song' && hasArrangement(s);
      if (s.view.mode === 'song' && !songMode) toast({ tone: 'info', title: 'The playlist is empty', body: 'Bouncing the active pattern instead.' });
      const { path, result } = await bounceSong(s, { name: s.name, loadSample: act.loadSample, mode: songMode ? 'song' : 'pattern', patternId: s.view.activePatternId ?? undefined });
      const asset = await act.importAudio(path);
      if (!asset) {
        toast({ tone: 'error', title: 'Bounced, but the import failed', body: path });
        return;
      }
      if (place) act.placeOnTimeline(asset.id, result.duration, result.beats, result.downbeats);
      toast({ tone: 'success', title: place ? 'Song placed on the timeline' : 'Song bounced to the bin', body: `${asset.name} · ${result.duration.toFixed(1)}s` });
    } catch (e) {
      toast({ tone: 'error', title: 'Bounce failed', body: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <button type="button" className="ms-tbtn wide" disabled={!!busy} onClick={() => void run(false)} title="Render the song to a WAV and import it into the bin" aria-label="Bounce">
        {busy === 'bounce' ? <Loader2 size={14} className="ms-spin" /> : <Download size={14} />}<span className="ms-tb-label">Bounce</span>
      </button>
      <button type="button" className="ms-tbtn wide ms-primary" disabled={!!busy} onClick={() => void run(true)} title="Bounce, import and lay the song on the video timeline as the music bed" aria-label="Send to timeline">
        {busy === 'place' ? <Loader2 size={14} className="ms-spin" /> : <Clapperboard size={14} />}<span className="ms-tb-label">Send to timeline</span>
      </button>
    </>
  );
}
