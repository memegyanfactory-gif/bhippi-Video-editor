import { Check } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { fontFallback, fontStack, type BrandTypeface } from '../../../lib/brandKit';
import { fontChoices } from '../fonts';
import { KineticStage } from '../Kinetic';
import { Field, Group, Popover, Segmented, Slider, faceStyle, tokenHex, type SectionProps } from '../shared';

type Face = 'display' | 'heading' | 'body' | 'caption' | 'mono';
const FACES: { id: Face; label: string; scale?: 'hook' | 'title' | 'body' | 'caption'; px: number }[] = [
  { id: 'display', label: 'Display', scale: 'hook', px: 5.4 },
  { id: 'heading', label: 'Heading', scale: 'title', px: 4.4 },
  { id: 'body', label: 'Body', scale: 'body', px: 5 },
  { id: 'caption', label: 'Caption', scale: 'caption', px: 2.8 },
  { id: 'mono', label: 'Mono', px: 3.6 },
];

export function TypeBoard({ kit, onPatch }: SectionProps) {
  const [face, setFace] = useState<Face>('display');
  const [texts, setTexts] = useState({ display: kit.tagline || 'Make it unmistakably yours', heading: 'A headline that earns the next second', body: 'Body copy is where the brand explains itself. It stays calm, readable and generous with space, so the idea does the talking.', caption: 'CAPTIONS ARE READ AT A GLANCE', mono: '00:12:04 · 24 fps' });
  const [picker, setPicker] = useState<HTMLElement | null>(null);
  const tf = kit.typography[face];
  const bg = tokenHex(kit, 'background', '#111');
  const fg = tokenHex(kit, 'text', '#fff');
  const muted = tokenHex(kit, 'muted', '#999');
  const accent = tokenHex(kit, 'accent', '#2d8ceb');
  const set = (change: Partial<BrandTypeface>) => onPatch('typography', { [face]: change });
  const choices = useMemo(() => fontChoices(Object.values(kit.typography).filter((v): v is BrandTypeface => !!v && typeof v === 'object' && 'family' in v).map((v) => v.family)), [kit.typography]);
  const trigger = useRef<HTMLButtonElement>(null);
  const spec = FACES.find((f) => f.id === face)!;
  const scaleKey = spec.scale;
  const closePicker = () => setPicker(null);

  return (
    <div className="bs-type">
      <div className="bs-specimen" style={{ background: bg, color: fg }}>
        {FACES.map((f) => {
          const t = kit.typography[f.id];
          const size = f.scale ? kit.typography.scale[f.scale] * f.px : f.px * 4;
          return (
            <div key={f.id} className={`bs-spec-row${face === f.id ? ' on' : ''}`} style={{ ['--bs-row' as string]: accent }} onClick={() => setFace(f.id)}>
              <button type="button" className="bs-spec-tag" style={{ color: muted }} onClick={() => setFace(f.id)} aria-pressed={face === f.id}>
                <b>{f.label}</b><span>{t.family} {t.weight}</span>
              </button>
              <textarea className="bs-spec-text" rows={1} aria-label={`${f.label} sample`} value={texts[f.id]} style={{ ...faceStyle(t), fontSize: size, lineHeight: f.id === 'body' ? kit.typography.lineHeight + 0.35 : kit.typography.lineHeight, color: f.id === 'caption' || f.id === 'mono' ? muted : fg }} onFocus={() => setFace(f.id)} onChange={(e) => setTexts({ ...texts, [f.id]: e.target.value.replace(/\s*\n\s*/g, ' ') })} />
            </div>
          );
        })}
      </div>

      <div className="bs-type-controls">
        <div className="bs-type-controls-head">
          <span className="bs-label">Editing</span>
          <Segmented label="Typeface role" value={face} onChange={setFace} options={FACES.map((f) => ({ value: f.id, label: f.label }))} />
        </div>
        <Field label="Font">
          <button ref={trigger} type="button" className="bs-fontbtn" style={{ fontFamily: fontStack(tf) }} aria-haspopup="listbox" onClick={(e) => setPicker(picker ? null : e.currentTarget)}>
            <span>{tf.family}</span><small>{tf.weight}</small>
          </button>
        </Field>
        <Slider label="Weight" value={tf.weight} min={100} max={900} step={100} format={(v) => String(v)} onChange={(weight) => set({ weight })} left="Thin" right="Black" />
        <Slider label="Letter spacing" value={Number.parseFloat(tf.letterSpacing) || 0} min={-0.08} max={0.2} step={0.005} format={(v) => `${v.toFixed(3)}em`} onChange={(v) => set({ letterSpacing: `${Math.round(v * 1000) / 1000}em` })} />
        <div className="bs-field"><span>Case</span>
          <Segmented label="Letter case" value={tf.transform} onChange={(transform) => set({ transform })} options={[{ value: 'none', label: 'Aa' }, { value: 'uppercase', label: 'AA' }, { value: 'lowercase', label: 'aa' }, { value: 'capitalize', label: 'Ab' }]} />
        </div>
        <button type="button" className={`bs-toggle${tf.italic ? ' on' : ''}`} aria-pressed={tf.italic} onClick={() => set({ italic: !tf.italic })}><i style={{ fontStyle: 'italic', fontFamily: 'serif' }}>I</i> Italic</button>
        {scaleKey && <Slider label={`Size (${spec.label.toLowerCase()})`} value={kit.typography.scale[scaleKey]} min={1} max={16} step={0.1} format={(v) => `${v.toFixed(1)}% of frame height`} onChange={(v) => onPatch('typography', { scale: { [scaleKey]: Math.round(v * 10) / 10 } })} />}
        <Slider label="Line height" value={kit.typography.lineHeight} min={0.9} max={1.8} step={0.05} format={(v) => v.toFixed(2)} onChange={(lineHeight) => onPatch('typography', { lineHeight })} />
      </div>

      <div className="bs-type-kin">
        <Group label="In motion" hint="The heading, moving the way this brand moves.">
          <KineticStage kit={kit} text={texts.heading} />
        </Group>
        <Group label="Type rules" hint="One per line.">
          <textarea className="bs-text" rows={3} value={kit.typography.rules.join('\n')} onChange={(e) => onPatch('typography', { rules: e.target.value.split('\n') })} onBlur={(e) => onPatch('typography', { rules: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })} />
        </Group>
      </div>

      {picker && (
        <Popover anchor={picker} onClose={closePicker} width={300} label={`Choose the ${face} font`}>
          <ul className="bs-fontlist" role="listbox" aria-label="Fonts">
            {choices.map((c) => (
              <li key={c.family} role="option" aria-selected={c.family === tf.family}>
                <button type="button" className={c.family === tf.family ? 'on' : ''} onClick={() => { set({ family: c.family, fallback: fontFallback(c.family) }); closePicker(); }}>
                  <span style={{ fontFamily: `"${c.family}", ${tf.fallback}` }}>{c.family}</span>
                  {!c.installed && <small title="Not installed on this machine: previews use the fallback">fallback</small>}
                  {c.group === 'bundled' && <small className="ok">bundled</small>}
                  {c.family === tf.family && <Check size={13} />}
                </button>
              </li>
            ))}
          </ul>
        </Popover>
      )}
    </div>
  );
}
