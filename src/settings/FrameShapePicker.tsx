// Frame shape, the way CapCut and Premiere's Sequence Settings offer it: a card per aspect ratio,
// drawn at its own shape, then the resolution tier and a turn button (16:9 ⇄ 9:16). Used by
// Project Settings and New Comp; Project Settings also asks what the footage already in the comp
// should do in the new shape (lib/reformat.ts).
import { RotateCw } from 'lucide-react';
import { aspectLabel, FRAME_PRESETS, orientationOf, presetOf, RESOLUTION_TIERS, scaleTo, swapped, type ReformatMode } from '../lib/reformat';

type Size = { width: number; height: number };

export function FrameShapePicker({ size, onChange }: { size: Size; onChange: (size: Size) => void }) {
  const current = presetOf(size.width, size.height);
  const short = Math.min(size.width, size.height);
  const tier = RESOLUTION_TIERS.find((entry) => entry.short === short);
  return (
    <div className="frame-shape">
      <div className="frame-shape-cards" role="radiogroup" aria-label="Frame shape">
        {FRAME_PRESETS.map((preset) => {
          const active = current?.id === preset.id;
          // Each card keeps the chosen resolution tier when it can.
          const target = scaleTo(preset, tier ? tier.short : Math.min(preset.width, preset.height));
          const w = preset.width >= preset.height ? 34 : Math.round((34 * preset.width) / preset.height);
          const h = preset.height >= preset.width ? 34 : Math.round((34 * preset.height) / preset.width);
          return (
            <button key={preset.id} type="button" role="radio" aria-checked={active} className={`frame-shape-card${active ? ' active' : ''}`} onClick={() => onChange(target)} title={`${preset.width}×${preset.height} · ${preset.use}`}>
              <span className="frame-shape-glyph"><i style={{ width: w, height: h }} /></span>
              <strong>{preset.ratio}</strong>
              <span>{preset.label}</span>
            </button>
          );
        })}
      </div>
      <div className="frame-shape-row">
        <div className="segmented" role="radiogroup" aria-label="Resolution">
          {RESOLUTION_TIERS.map((entry) => (
            <button key={entry.short} type="button" className={entry.short === short ? 'active' : ''} onClick={() => onChange(scaleTo(size, entry.short))}>{entry.label}</button>
          ))}
        </div>
        <button type="button" className="btn btn-small" onClick={() => onChange(swapped(size))} disabled={orientationOf(size.width, size.height) === 'square'} title="Turn the frame on its side (16:9 ⇄ 9:16)">
          <RotateCw size={12} /> Rotate
        </button>
      </div>
      <small className="muted">{size.width}×{size.height} · {aspectLabel(size.width, size.height)} {orientationOf(size.width, size.height)}{current ? ` · ${current.use}` : ''}</small>
    </div>
  );
}

const MODES: { id: ReformatMode; label: string; hint: string }[] = [
  { id: 'fill', label: 'Fill', hint: 'Crop to fill the new frame from the centre — best for a talking head.' },
  { id: 'blur', label: 'Fit + blur', hint: 'Show the whole picture over a blurred copy of itself — best for slides, gameplay and landscapes.' },
  { id: 'fit', label: 'Fit', hint: 'Show the whole picture with bars.' },
  { id: 'keep', label: 'Leave', hint: 'Only change the frame; leave the footage as it is.' },
];

/** What footage that filled the old frame does in the new one. Motion graphics are always rebuilt. */
export function ReformatChoice({ mode, onChange }: { mode: ReformatMode; onChange: (mode: ReformatMode) => void }) {
  return (
    <div className="field">
      <span>Footage already in the comp</span>
      <div className="segmented wide" role="radiogroup" aria-label="Reframe footage">
        {MODES.map((entry) => <button key={entry.id} type="button" className={mode === entry.id ? 'active' : ''} onClick={() => onChange(entry.id)} title={entry.hint}>{entry.label}</button>)}
      </div>
      <small className="muted">{MODES.find((entry) => entry.id === mode)?.hint} Motion graphics are rebuilt for the new shape.</small>
    </div>
  );
}
