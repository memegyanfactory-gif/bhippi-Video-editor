// Track header › Track Volume & Pan…: an audio track's fader (dB) and balance, heard as you drag
// (a preview step, one undo step on OK; Cancel puts them back).
import { useState } from 'react';
import { Modal } from '../components/ui';

export function TrackMixDialog({ name, gain, pan, onPreview, onSubmit, onCancel, onClose }: { name: string; gain: number; pan: number; onPreview: (mix: { gain: number; pan: number }) => void; onSubmit: () => void; onCancel: () => void; onClose: () => void }) {
  const [value, setValue] = useState({ gain, pan });
  const change = (patch: Partial<typeof value>) => {
    const next = { ...value, ...patch };
    setValue(next);
    onPreview(next);
  };
  const side = value.pan === 0 ? 'Centre' : `${Math.round(Math.abs(value.pan) * 100)}% ${value.pan < 0 ? 'left' : 'right'}`;
  return (
    <Modal title={`${name} — volume & pan`} onClose={() => { onCancel(); onClose(); }} width={380} footer={
      <>
        <button type="button" className="btn btn-ghost" onClick={() => change({ gain: 0, pan: 0 })}>Reset</button>
        <div className="toolbar-spacer" />
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={onSubmit}>OK</button>
      </>
    }>
      <div className="dialog-body">
        <label className="field">
          <span>Volume {value.gain > 0 ? '+' : ''}{value.gain.toFixed(1)} dB</span>
          <input type="range" min={-40} max={12} step={0.5} value={value.gain} onChange={(event) => change({ gain: Number(event.target.value) })} onDoubleClick={() => change({ gain: 0 })} />
        </label>
        <label className="field">
          <span>Balance: {side}</span>
          <input type="range" min={-1} max={1} step={0.05} value={value.pan} onChange={(event) => change({ pan: Number(event.target.value) })} onDoubleClick={() => change({ pan: 0 })} />
        </label>
      </div>
    </Modal>
  );
}
