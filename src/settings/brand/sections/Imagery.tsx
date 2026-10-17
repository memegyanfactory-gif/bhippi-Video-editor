import { useState, type CSSProperties } from 'react';
import type { BrandKit } from '../../../lib/brandKit';
import { SAMPLE_FRAMES } from '../helpers';
import { ChipsInput, Field, Group, Slider, tokenHex, type SectionProps } from '../shared';

type Grade = BrandKit['imagery']['grade'];

/** The kit's grade as a CSS filter plus a warm or cool overlay, the same on every sample frame. */
export const gradeStyle = (g: Pick<Grade, 'saturation' | 'contrast' | 'warmth'>): { filter: string; tint: CSSProperties } => ({
  filter: `saturate(${(1 + g.saturation * 0.9).toFixed(2)}) contrast(${(1 + g.contrast * 0.55).toFixed(2)})`,
  tint: { background: g.warmth >= 0 ? '#ff8a2a' : '#2a8aff', opacity: Math.abs(g.warmth) * 0.32, mixBlendMode: 'soft-light' },
});

function Frame({ src, grade, className, caption }: { src: string; grade: Grade; className?: string; caption?: string }) {
  const s = gradeStyle(grade);
  return (
    <figure className={`bs-imframe ${className ?? ''}`}>
      <img src={src} alt="" style={{ filter: s.filter }} draggable={false} />
      <i style={s.tint} />
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}

/** The first frame with a draggable before/after divider. */
function Compare({ src, grade }: { src: string; grade: Grade }) {
  const [at, setAt] = useState(50);
  const s = gradeStyle(grade);
  return (
    <div className="bs-compare">
      <img src={src} alt="Graded" style={{ filter: s.filter }} draggable={false} /><i style={s.tint} />
      <img className="bs-compare-before" src={src} alt="Original" draggable={false} style={{ clipPath: `inset(0 ${100 - at}% 0 0)` }} />
      <span className="bs-compare-tag l">Original</span><span className="bs-compare-tag r">Brand grade</span>
      <b className="bs-compare-bar" style={{ left: `${at}%` }}><i /></b>
      <input type="range" min={0} max={100} value={at} aria-label="Compare original and graded" onChange={(e) => setAt(Number(e.target.value))} />
    </div>
  );
}

const ICONS: { id: BrandKit['imagery']['iconography']; label: string }[] = [
  { id: 'line', label: 'Line' }, { id: 'filled', label: 'Filled' }, { id: 'duotone', label: 'Duotone' }, { id: '3d', label: '3D' }, { id: 'flat', label: 'Flat' }, { id: 'hand-drawn', label: 'Hand-drawn' }, { id: 'custom', label: 'Custom' },
];

function Glyph({ style, color, accent }: { style: string; color: string; accent: string }) {
  const play = 'M13 10.5 L23.5 16.5 L13 22.5 Z';
  const bolt = 'M33 6 L26 19 H32 L30 28 L38 14 H32 Z';
  const common = { strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
  if (style === 'line') return <svg viewBox="0 0 44 34"><circle cx="18" cy="16.5" r="12" fill="none" stroke={color} strokeWidth="2" /><path d={play} fill="none" stroke={color} strokeWidth="2" {...common} /><path d={bolt} fill="none" stroke={accent} strokeWidth="2" {...common} /></svg>;
  if (style === 'filled') return <svg viewBox="0 0 44 34"><circle cx="18" cy="16.5" r="12" fill={color} /><path d={play} fill="#fff" /><path d={bolt} fill={accent} /></svg>;
  if (style === 'duotone') return <svg viewBox="0 0 44 34"><circle cx="18" cy="16.5" r="12" fill={color} opacity=".22" stroke={color} strokeWidth="2" /><path d={play} fill={color} /><path d={bolt} fill={accent} opacity=".35" stroke={accent} strokeWidth="2" {...common} /></svg>;
  if (style === '3d') return <svg viewBox="0 0 44 34"><defs><linearGradient id="g3" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={color} /><stop offset="1" stopColor="#000" stopOpacity=".6" /></linearGradient></defs><circle cx="20" cy="19" r="12" fill="#000" opacity=".25" /><circle cx="18" cy="16.5" r="12" fill="url(#g3)" /><path d={play} fill="#fff" /><path d={bolt} fill={accent} stroke="#0006" strokeWidth="1" /></svg>;
  if (style === 'flat') return <svg viewBox="0 0 44 34"><rect x="6" y="4.5" width="24" height="24" rx="7" fill={color} /><path d={play} fill="#fff" /><path d={bolt} fill={accent} /></svg>;
  if (style === 'hand-drawn') return <svg viewBox="0 0 44 34"><path d="M18 4.8 C26 4.2 31 10 30.6 17 C30 24.6 24 28.8 17.6 28.4 C10.5 28 5.8 22.5 6.4 16 C7 10 11.5 5.4 18 4.8 Z" fill="none" stroke={color} strokeWidth="2" {...common} /><path d="M13.4 10.8 L23.6 16.4 L13.2 22.8" fill="none" stroke={color} strokeWidth="2" {...common} /><path d="M33.4 6.4 L26.4 19 L32.6 18.6 L30 28" fill="none" stroke={accent} strokeWidth="2" {...common} /></svg>;
  return <svg viewBox="0 0 44 34"><rect x="6" y="5" width="32" height="24" rx="6" fill="none" stroke={color} strokeWidth="1.6" strokeDasharray="3 3" /><text x="22" y="23" textAnchor="middle" fontSize="15" fill={color}>?</text></svg>;
}

export function ImageryBoard({ kit, onPatch }: SectionProps) {
  const g = kit.imagery.grade;
  const setGrade = (key: 'saturation' | 'contrast' | 'warmth', value: number) => onPatch('imagery', { grade: { [key]: Math.round(value * 100) / 100 } });
  const fg = tokenHex(kit, 'text', '#ddd');
  const accent = tokenHex(kit, 'accent', '#2d8ceb');
  const bg = tokenHex(kit, 'surface', '#222');
  return (
    <div className="bs-imagery">
      <div className="bs-im-top">
        <div className="bs-im-frames">
          <Compare src={SAMPLE_FRAMES[1]} grade={g} />
          <div className="bs-im-small">
            <Frame src={SAMPLE_FRAMES[0]} grade={g} caption="Portrait" />
            <Frame src={SAMPLE_FRAMES[2]} grade={g} caption="Candid" />
          </div>
        </div>
        <div className="bs-im-grade">
          <Group label="The grade" hint="Applied live to the frames. The AI matches it on generated and found media.">
            <Slider label="Saturation" value={g.saturation} min={-1} max={1} step={0.05} format={(v) => v.toFixed(2)} left="Muted" right="Vivid" onChange={(v) => setGrade('saturation', v)} />
            <Slider label="Contrast" value={g.contrast} min={-1} max={1} step={0.05} format={(v) => v.toFixed(2)} left="Soft" right="Punchy" onChange={(v) => setGrade('contrast', v)} />
            <Slider label="Warmth" value={g.warmth} min={-1} max={1} step={0.05} format={(v) => v.toFixed(2)} left="Cool" right="Warm" onChange={(v) => setGrade('warmth', v)} />
          </Group>
          <Field label="In words"><input className="bs-input" value={g.note} onChange={(e) => onPatch('imagery', { grade: { note: e.target.value } })} /></Field>
        </div>
      </div>
      <Field label="Photography style"><input className="bs-input" value={kit.imagery.style} onChange={(e) => onPatch('imagery', { style: e.target.value })} /></Field>
      <Group label="Iconography" hint="The style of every icon and sticker.">
        <div className="bs-icons" role="radiogroup" aria-label="Iconography style">
          {ICONS.map((i) => (
            <button key={i.id} type="button" role="radio" aria-checked={kit.imagery.iconography === i.id} className={kit.imagery.iconography === i.id ? 'on' : ''} style={{ background: bg }} onClick={() => onPatch('imagery', { iconography: i.id })}>
              <Glyph style={i.id} color={fg} accent={accent} /><span>{i.label}</span>
            </button>
          ))}
        </div>
      </Group>
      <div className="bs-two">
        <Field label="Prompt prefix" hint="every generation starts with this"><textarea className="bs-text" rows={3} value={kit.imagery.promptPrefix} onChange={(e) => onPatch('imagery', { promptPrefix: e.target.value })} /></Field>
        <Field label="Prompt suffix"><textarea className="bs-text" rows={3} value={kit.imagery.promptSuffix} onChange={(e) => onPatch('imagery', { promptSuffix: e.target.value })} /></Field>
      </div>
      <Field label="Negative prompt"><textarea className="bs-text" rows={2} value={kit.imagery.negativePrompt} onChange={(e) => onPatch('imagery', { negativePrompt: e.target.value })} /></Field>
      <div className="bs-two">
        <Group label="Keywords"><ChipsInput value={kit.imagery.keywords} onChange={(keywords) => onPatch('imagery', { keywords })} placeholder="Add a keyword" /></Group>
        <Group label="Avoid"><ChipsInput tone="bad" value={kit.imagery.avoid} onChange={(avoid) => onPatch('imagery', { avoid })} placeholder="Add something to avoid" /></Group>
      </div>
    </div>
  );
}
