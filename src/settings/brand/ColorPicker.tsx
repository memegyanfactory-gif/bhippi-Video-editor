// The colour picker in the popover: a saturation/value pad, hue strip, hex field, HSL sliders and an
// eyedropper where the webview has one. Changes stream out as hex while dragging.

import { Pipette } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { hexToHsl, hexToHsv, hslToHex, hsvToHex, parseHex } from '../../lib/brandKit/studio';

type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> };
const eyeDropper = (): EyeDropperCtor | null => (typeof window !== 'undefined' ? ((window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper ?? null) : null);

/** Calls `onMove(x, y)` (0…1, clamped) as the pointer drags over the element. */
function useDrag(onMove: (x: number, y: number) => void) {
  const ref = useRef<HTMLDivElement>(null);
  const move = (e: ReactPointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    onMove(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)));
  };
  return {
    ref,
    onPointerDown: (e: ReactPointerEvent) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); move(e); },
    onPointerMove: (e: ReactPointerEvent) => { if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) move(e); },
  };
}

export function ColorPicker({ hex, onChange, swatches }: { hex: string; onChange: (hex: string) => void; swatches?: string[] }) {
  const [hsv, setHsv] = useState(() => hexToHsv(hex));
  const [text, setText] = useState(hex);
  // Keep hue and saturation when the colour is grey or black (hex alone has lost them), but follow outside changes.
  const last = useRef(hex.toLowerCase());
  useEffect(() => {
    if (hex.toLowerCase() === last.current) return;
    last.current = hex.toLowerCase();
    setHsv(hexToHsv(hex));
    setText(hex);
  }, [hex]);
  const frame = useRef(0);
  const emit = (next: { h: number; s: number; v: number }) => {
    setHsv(next);
    const out = hsvToHex(next);
    last.current = out;
    setText(out);
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => onChange(out));
  };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  const pad = useDrag((x, y) => emit({ ...hsv, s: x * 100, v: (1 - y) * 100 }));
  const strip = useDrag((x) => emit({ ...hsv, h: x * 360 }));
  const hsl = hexToHsl(hsvToHex(hsv));
  const setHsl = (patch: Partial<{ h: number; s: number; l: number }>) => {
    const next = { ...hsl, h: hsv.h, ...patch };
    const out = hslToHex(next);
    const nv = hexToHsv(out);
    emit({ h: next.h, s: out === '#000000' || out === '#ffffff' ? hsv.s : nv.s, v: nv.v });
  };
  const dropper = eyeDropper();
  const pick = async () => {
    if (!dropper) return;
    try { const { sRGBHex } = await new dropper().open(); const out = parseHex(sRGBHex); if (out) emit(hexToHsv(out)); } catch { /* cancelled */ }
  };
  return (
    <div className="bs-picker">
      <div className="bs-pad" {...pad} style={{ background: `hsl(${hsv.h} 100% 50%)` } as CSSProperties} role="slider" aria-label="Saturation and brightness" aria-valuetext={`${Math.round(hsv.s)}% saturation, ${Math.round(hsv.v)}% brightness`} tabIndex={0}
        onKeyDown={(e) => {
          const d = e.shiftKey ? 10 : 2;
          if (e.key === 'ArrowRight') emit({ ...hsv, s: Math.min(100, hsv.s + d) });
          else if (e.key === 'ArrowLeft') emit({ ...hsv, s: Math.max(0, hsv.s - d) });
          else if (e.key === 'ArrowUp') emit({ ...hsv, v: Math.min(100, hsv.v + d) });
          else if (e.key === 'ArrowDown') emit({ ...hsv, v: Math.max(0, hsv.v - d) });
          else return;
          e.preventDefault();
        }}>
        <i className="bs-pad-w" /><i className="bs-pad-b" />
        <b className="bs-pad-knob" style={{ left: `${hsv.s}%`, top: `${100 - hsv.v}%`, background: hsvToHex(hsv) }} />
      </div>
      <div className="bs-hue" {...strip} role="slider" aria-label="Hue" aria-valuenow={Math.round(hsv.h)} tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'ArrowRight') { emit({ ...hsv, h: (hsv.h + 4) % 360 }); e.preventDefault(); } else if (e.key === 'ArrowLeft') { emit({ ...hsv, h: (hsv.h + 356) % 360 }); e.preventDefault(); } }}>
        <b className="bs-hue-knob" style={{ left: `${(hsv.h / 360) * 100}%`, background: `hsl(${hsv.h} 100% 50%)` }} />
      </div>
      <div className="bs-hexrow">
        <span className="bs-hex-chip" style={{ background: hsvToHex(hsv) }} />
        <input className="bs-hex" value={text} spellCheck={false} aria-label="Hex colour" onChange={(e) => { setText(e.target.value); const out = parseHex(e.target.value); if (out) { last.current = out; setHsv(hexToHsv(out)); onChange(out); } }} onBlur={() => setText(hsvToHex(hsv))} />
        {dropper && <button type="button" className="bs-icon-btn" title="Pick a colour from the screen" aria-label="Eyedropper" onClick={() => void pick()}><Pipette size={14} /></button>}
      </div>
      <div className="bs-hsl">
        {([['H', 'h', 360, `linear-gradient(90deg, ${[0, 60, 120, 180, 240, 300, 360].map((h) => `hsl(${h} 100% 50%)`).join(',')})`], ['S', 's', 100, `linear-gradient(90deg, hsl(${hsl.h} 0% ${hsl.l}%), hsl(${hsl.h} 100% ${hsl.l}%))`], ['L', 'l', 100, `linear-gradient(90deg, #000, hsl(${hsl.h} ${hsl.s}% 50%), #fff)`]] as const).map(([label, key, max, track]) => (
          <label key={key}>
            <span>{label}</span>
            <input type="range" min={0} max={max} step={1} value={Math.round(key === 'h' ? hsv.h : hsl[key])} style={{ background: track }} aria-label={`${label === 'H' ? 'Hue' : label === 'S' ? 'Saturation' : 'Lightness'}`} onChange={(e) => setHsl({ [key]: Number(e.target.value) })} />
            <output>{Math.round(key === 'h' ? hsv.h : hsl[key])}</output>
          </label>
        ))}
      </div>
      {swatches && swatches.length > 0 && (
        <div className="bs-quick" aria-label="Brand colours">
          {swatches.map((s, i) => <button key={`${s}-${i}`} type="button" style={{ background: s }} title={s} aria-label={s} onClick={() => emit(hexToHsv(s))} />)}
        </div>
      )}
    </div>
  );
}
