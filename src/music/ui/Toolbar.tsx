// The Music Studio's top bar: transport, PAT/SONG, LCD position / tempo / time signature, swing and
// master knobs, master LED meter, pattern picker, snap, metronome, window toggles, undo / redo and
// bounce / send-to-timeline.
import { useRef } from 'react';
import { ArrowLeft, Grid3x3, LayoutList, Magnet, PanelLeft, Piano, Play, Redo2, SkipBack, SlidersVertical, Square, Timer, Undo2 } from 'lucide-react';
import type { History } from '../../lib/history';
import { BounceButtons } from './BounceButtons';
import { DragNumber, Knob } from './Controls';
import { useActions, useStudio, type BottomWindow } from './ctx';
import { fmtDb, SNAP_OPTIONS, type SnapId } from './format';
import { PatternPicker } from './PatternPicker';
import { MasterMeter, Readout } from './Transport';

const WINDOWS: { id: BottomWindow | 'playlist' | 'browser'; label: string; key: string; icon: typeof Grid3x3 }[] = [
  { id: 'browser', label: 'Browser', key: '', icon: PanelLeft },
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
  const rewind = () => { act.stop(); setUi({ playFrom: 0 }); };

  return (
    <div className="ms-toolbar" role="toolbar" aria-label="Music Studio toolbar">
      <div className="ms-tb-group ms-tb-id">
        <button type="button" className="ms-tbtn wide" onClick={onClose} title="Back to the video editor" aria-label="Back to video"><ArrowLeft size={14} /><span className="ms-tb-label">Video</span></button>
        <span className="ms-beta" title="The Music Studio is in beta and still being built: expect rough edges.">Music Studio · Beta · WIP</span>
      </div>

      <div className="ms-tb-group ms-tb-transport" role="group" aria-label="Transport">
        <button type="button" className="ms-tbtn" onClick={rewind} title="Back to start" aria-label="Back to start"><SkipBack size={14} /></button>
        <button type="button" className={`ms-tbtn ms-t-play${ui.playing ? ' on' : ''}`} onClick={() => { if (!ui.playing) act.toggle(); }} title="Play (Space)" aria-label="Play" aria-pressed={ui.playing}><Play size={15} /></button>
        <button type="button" className={`ms-tbtn ms-t-stop${!ui.playing ? ' on' : ''}`} onClick={act.stop} title="Stop (Space)" aria-label="Stop"><Square size={13} /></button>
        <span className="ms-tb-div" />
        <div className="ms-seg" role="group" aria-label="Play mode">
          {(['pattern', 'song'] as const).map((m) => (
            <button
              key={m} type="button" className={song.view.mode === m ? 'on' : ''} aria-pressed={song.view.mode === m} title={`${m === 'pattern' ? 'Pattern' : 'Song'} mode (L)`}
              onClick={() => { setView({ mode: m }); if (ui.playing) act.stop(); }}
            >{m === 'pattern' ? 'PAT' : 'SONG'}</button>
          ))}
        </div>
        <button type="button" className={`ms-tbtn${ui.metronome ? ' on' : ''}`} aria-pressed={ui.metronome} onClick={() => setUi({ metronome: !ui.metronome })} title="Metronome" aria-label="Metronome"><Timer size={14} /></button>
      </div>

      <div className="ms-tb-group ms-tb-lcds">
        <Readout />
        <label className="ms-lcd ms-lcd-bpm"><span className="ms-lcd-label">Tempo</span>
          <DragNumber value={song.bpm} min={20} max={999} step={1} decimals={2} width={66} label="Tempo (BPM)" onChange={(v) => drag((s) => ({ ...s, bpm: v }))} onEnd={() => settle('Music: tempo')} />
        </label>
        <button type="button" className="ms-tbtn tap" onClick={tap} title="Tap tempo: tap along with the beat" aria-label="Tap tempo">TAP</button>
        <div className="ms-lcd ms-lcd-sig" title="Time signature"><span className="ms-lcd-label">Sig</span>
          <span className="ms-lcd-row">
            <DragNumber value={song.timeSig[0]} min={1} max={32} width={28} label="Beats per bar" onChange={(v) => drag((s) => ({ ...s, timeSig: [Math.round(v), s.timeSig[1]] }))} onEnd={() => settle('Music: time signature')} />
            <span>/</span>
            <select aria-label="Beat unit" value={song.timeSig[1]} onChange={(e) => edit((s) => ({ ...s, timeSig: [s.timeSig[0], Number(e.target.value)] }), 'time signature')}>
              {[2, 4, 8, 16].map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </span>
        </div>
      </div>

      <div className="ms-tb-group ms-tb-mix">
        <div className="ms-tb-knob"><Knob value={song.swing} min={0} max={1} def={0} size={26} label="Swing" format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => drag((s) => ({ ...s, swing: v }))} onEnd={() => settle('Music: swing')} /><span>Swing</span></div>
        <div className="ms-tb-knob"><Knob value={song.masterVolume} min={-60} max={6} def={0} size={26} label="Master volume" format={(v) => `${fmtDb(v)} dB`} onChange={(v) => drag((s) => ({ ...s, masterVolume: v }))} onEnd={() => settle('Music: master volume')} /><span>Master</span></div>
        <MasterMeter />
      </div>

      <div className="ms-tb-group ms-tb-edit">
        <PatternPicker />
        <label className="ms-snap" title="Snap: the grid notes and clips lock to"><Magnet size={13} />
          <select aria-label="Snap" value={ui.snapId} onChange={(e) => setUi({ snapId: e.target.value as SnapId })}>
            {SNAP_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </label>
      </div>

      <span className="ms-grow" />
      <div className="ms-tb-group ms-tb-windows ms-windows" role="group" aria-label="Windows">
        {WINDOWS.map((w) => {
          const on = w.id === 'playlist' ? ui.playlist : w.id === 'browser' ? ui.browser : ui.win === w.id;
          const label = w.key ? `${w.label} (${w.key})` : w.label;
          return (
            <button
              key={w.id} type="button" className={`ms-tbtn${on ? ' on' : ''}`} aria-pressed={on} title={label} aria-label={w.label}
              onClick={() => (w.id === 'playlist' ? setUi({ playlist: !ui.playlist }) : w.id === 'browser' ? setUi({ browser: !ui.browser }) : setUi({ win: w.id }))}
            >
              <w.icon size={14} />
            </button>
          );
        })}
      </div>
      <div className="ms-tb-group ms-tb-history">
        <button type="button" className="ms-tbtn" onClick={history.undo} disabled={!history.canUndo} title="Undo (Ctrl+Z)" aria-label="Undo"><Undo2 size={14} /></button>
        <button type="button" className="ms-tbtn" onClick={history.redo} disabled={!history.canRedo} title="Redo (Ctrl+Y)" aria-label="Redo"><Redo2 size={14} /></button>
      </div>
      <BounceButtons />
    </div>
  );
}
