// The Music Studio's top bar: transport, PAT/SONG, tempo + tap, time signature, swing, master volume,
// pattern picker, snap, metronome, position read-out, master meter, bounce / send-to-timeline,
// window buttons, undo / redo and "Back to video".
import { useRef } from 'react';
import { ArrowLeft, Grid3x3, LayoutList, Piano, Play, Redo2, SlidersVertical, Square, Timer, Undo2 } from 'lucide-react';
import type { History } from '../../lib/history';
import { BounceButtons } from './BounceButtons';
import { DragNumber, Knob } from './Controls';
import { useActions, useStudio, type BottomWindow } from './ctx';
import { fmtDb, SNAP_OPTIONS, type SnapId } from './format';
import { PatternPicker } from './PatternPicker';
import { MasterMeter, Readout } from './Transport';

const WINDOWS: { id: BottomWindow | 'playlist'; label: string; key: string; icon: typeof Grid3x3 }[] = [
  { id: 'playlist', label: 'Playlist', key: 'F5', icon: LayoutList },
  { id: 'rack', label: 'Channel Rack', key: 'F6', icon: Grid3x3 },
  { id: 'pianoroll', label: 'Piano Roll', key: 'F7', icon: Piano },
  { id: 'mixer', label: 'Mixer', key: 'F9', icon: SlidersVertical },
];

export function Toolbar({ history, onClose }: { history: History; onClose: () => void }) {
  const { song, ui } = useStudio();
  const act = useActions();
  const { edit, drag, settle, setView, setUi } = act;
  const taps = useRef<number[]>([]);

  const tap = () => {
    const now = performance.now();
    const list = taps.current.filter((t) => now - t < 2500);
    list.push(now);
    taps.current = list.slice(-7);
    if (list.length >= 2) {
      const gaps = list.slice(1).map((t, i) => t - list[i]);
      const bpm = 60000 / (gaps.reduce((a, b) => a + b, 0) / gaps.length);
      edit((s) => ({ ...s, bpm: Math.round(Math.min(999, Math.max(20, bpm)) * 10) / 10 }), 'tap tempo');
    }
  };

  return (
    <div className="ms-toolbar" role="toolbar" aria-label="Music Studio toolbar">
      <button type="button" className="ms-btn" onClick={onClose} title="Back to the video editor" aria-label="Back to video"><ArrowLeft size={14} /> Back to video</button>
      <span className="ms-beta" title="The Music Studio is in beta and still being built: expect rough edges.">Music Studio · Beta · WIP</span>
      <span className="ms-sep" />

      <button type="button" className={`ms-btn ms-play${ui.playing ? ' on' : ''}`} onClick={act.toggle} title="Play / stop (Space)" aria-label={ui.playing ? 'Stop' : 'Play'} aria-pressed={ui.playing}>
        {ui.playing ? <Square size={14} /> : <Play size={14} />}
      </button>
      <div className="ms-seg" role="group" aria-label="Play mode">
        {(['pattern', 'song'] as const).map((m) => (
          <button
            key={m} type="button" className={song.view.mode === m ? 'on' : ''} aria-pressed={song.view.mode === m} title={`${m === 'pattern' ? 'Pattern' : 'Song'} mode (L)`}
            onClick={() => { setView({ mode: m }); if (ui.playing) act.stop(); }}
          >{m === 'pattern' ? 'PAT' : 'SONG'}</button>
        ))}
      </div>
      <Readout />

      <label className="ms-field"><span>BPM</span>
        <DragNumber value={song.bpm} min={20} max={999} step={1} decimals={2} width={62} label="Tempo (BPM)" onChange={(v) => drag((s) => ({ ...s, bpm: v }))} onEnd={() => settle('Music: tempo')} />
      </label>
      <button type="button" className="ms-btn" onClick={tap} title="Tap tempo" aria-label="Tap tempo">Tap</button>
      <label className="ms-field" title="Time signature"><span>Sig</span>
        <DragNumber value={song.timeSig[0]} min={1} max={32} width={30} label="Beats per bar" onChange={(v) => drag((s) => ({ ...s, timeSig: [Math.round(v), s.timeSig[1]] }))} onEnd={() => settle('Music: time signature')} />
        <span>/</span>
        <select aria-label="Beat unit" value={song.timeSig[1]} onChange={(e) => edit((s) => ({ ...s, timeSig: [s.timeSig[0], Number(e.target.value)] }), 'time signature')}>
          {[2, 4, 8, 16].map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </label>
      <div className="ms-field ms-knobfield"><span>Swing</span>
        <Knob value={song.swing} min={0} max={1} def={0} size={26} label="Swing" format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => drag((s) => ({ ...s, swing: v }))} onEnd={() => settle('Music: swing')} />
      </div>
      <div className="ms-field ms-knobfield"><span>Master</span>
        <Knob value={song.masterVolume} min={-60} max={6} def={0} size={26} label="Master volume" format={(v) => `${fmtDb(v)} dB`} onChange={(v) => drag((s) => ({ ...s, masterVolume: v }))} onEnd={() => settle('Music: master volume')} />
      </div>
      <MasterMeter />
      <span className="ms-sep" />

      <PatternPicker />
      <label className="ms-field" title="Snap"><span>Snap</span>
        <select aria-label="Snap" value={ui.snapId} onChange={(e) => setUi({ snapId: e.target.value as SnapId })}>
          {SNAP_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </label>
      <button type="button" className={`ms-icon ms-icon-lg${ui.metronome ? ' on' : ''}`} aria-pressed={ui.metronome} onClick={() => setUi({ metronome: !ui.metronome })} title="Metronome" aria-label="Metronome"><Timer size={15} /></button>
      <span className="ms-sep" />

      <div className="ms-seg ms-windows" role="group" aria-label="Windows">
        {WINDOWS.map((w) => {
          const on = w.id === 'playlist' ? ui.playlist : ui.win === w.id;
          return (
            <button
              key={w.id} type="button" className={on ? 'on' : ''} aria-pressed={on} title={`${w.label} (${w.key})`} aria-label={w.label}
              onClick={() => (w.id === 'playlist' ? setUi({ playlist: !ui.playlist }) : setUi({ win: w.id }))}
            >
              <w.icon size={14} /><span>{w.label}</span>
            </button>
          );
        })}
      </div>
      <span className="ms-grow" />
      <button type="button" className="ms-icon ms-icon-lg" onClick={history.undo} disabled={!history.canUndo} title="Undo" aria-label="Undo"><Undo2 size={15} /></button>
      <button type="button" className="ms-icon ms-icon-lg" onClick={history.redo} disabled={!history.canRedo} title="Redo" aria-label="Redo"><Redo2 size={15} /></button>
      <BounceButtons />
    </div>
  );
}
