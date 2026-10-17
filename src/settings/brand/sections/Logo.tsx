import { Eye, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';
import type { BrandKit, BrandLogo, Corner } from '../../../lib/brandKit';
import { onColor } from '../../../lib/brandKit/studio';
import { SAMPLE_FRAMES, sanitizeSvgMarkup } from '../helpers';
import { Field, Group, LogoMark, Segmented, Slider, tokenHex, useKitVars, type SectionProps } from '../shared';

const ROLES: BrandLogo['role'][] = ['primary', 'mark', 'wordmark', 'monochrome', 'inverse', 'icon'];
const CORNERS: Corner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'];

/** Four corners and a centre: pick where the logo bug sits. */
export function CornerPicker({ value, onChange, label }: { value: Corner; onChange: (c: Corner) => void; label: string }) {
  return (
    <div className="bs-corners" role="radiogroup" aria-label={label}>
      {CORNERS.map((c) => <button key={c} type="button" role="radio" aria-checked={value === c} title={c} className={`${c}${value === c ? ' on' : ''}`} onClick={() => onChange(c)} />)}
    </div>
  );
}

function Tile({ kit, logo, kind, height, overlay }: { kit: BrandKit; logo?: BrandLogo; kind: 'light' | 'dark' | 'brand' | 'photo'; height: number; overlay: boolean }) {
  const primary = tokenHex(kit, 'primary', '#2d8ceb');
  const space = (logo?.clearSpace ?? 1) * height;
  const style = kind === 'light' ? { background: '#ffffff', color: '#111' } : kind === 'dark' ? { background: '#0b0b0e', color: '#fff' } : kind === 'brand' ? { background: primary, color: onColor(primary) } : { backgroundImage: `linear-gradient(#0006,#0006), url(${SAMPLE_FRAMES[1]})`, backgroundSize: 'cover', backgroundPosition: 'center', color: '#fff' };
  return (
    <div className={`bs-tile k-${kind}`} style={style}>
      <div className="bs-tile-logo">
        <LogoMark kit={kit} logo={logo} height={height} />
        {overlay && <i className="bs-clear" style={{ inset: -space }} />}
      </div>
      <span className="bs-tile-tag">{kind}</span>
    </div>
  );
}

export function LogoBoard({ kit, onReplace, onAddLogo }: Pick<SectionProps, 'kit' | 'onReplace'> & { onAddLogo: (role: BrandLogo['role']) => void }) {
  const [overlay, setOverlay] = useState(true);
  const vars = useKitVars(kit);
  const logos: (BrandLogo | undefined)[] = kit.logos.length ? kit.logos : [undefined];
  const update = (id: string, change: Partial<BrandLogo>) => onReplace({ ...kit, logos: kit.logos.map((l) => (l.id === id ? { ...l, ...change } : l)), updatedAt: new Date().toISOString() });
  const primary = kit.logos.find((l) => l.role === 'primary') ?? kit.logos[0];
  const bg = tokenHex(kit, 'background', '#111');
  const brand = tokenHex(kit, 'primary', '#2d8ceb');
  return (
    <div className="bs-logoboard" style={vars}>
      <div className="bs-toolbar">
        <button type="button" className={`bs-toggle${overlay ? ' on' : ''}`} aria-pressed={overlay} onClick={() => setOverlay((v) => !v)}><Eye size={13} /> Clear space and minimum size</button>
        <button type="button" className="bs-btn" onClick={() => onAddLogo('primary')}><Upload size={13} /> {kit.logos.length ? 'Replace primary logo' : 'Upload a logo'}</button>
        <button type="button" className="bs-btn ghost" onClick={() => onAddLogo(kit.logos.some((l) => l.role === 'inverse') ? 'mark' : 'inverse')}>Add another variant</button>
        <span className="bs-hint">SVG stays vector; PNG and WebP are embedded for export.</span>
      </div>
      {logos.map((logo, i) => (
        <div key={logo?.id ?? 'monogram'} className="bs-logo-card">
          <div className="bs-logo-card-head">
            <div className="bs-logo-card-title">
              <b>{logo ? logo.role : 'Monogram'}</b>
              <span>{logo ? (logo.svg ? 'Vector' : logo.dataUrl || logo.path ? 'Raster' : 'No file') : 'No logo uploaded yet: graphics use this monogram'}</span>
            </div>
            {logo && <button type="button" className="bs-btn ghost danger small" onClick={() => onReplace({ ...kit, logos: kit.logos.filter((l) => l.id !== logo.id) })}><Trash2 size={12} /> Remove</button>}
          </div>
          <div className="bs-tiles">
            {(['light', 'dark', 'brand', 'photo'] as const).map((k) => <Tile key={k} kit={kit} logo={logo} kind={k} height={i === 0 ? 46 : 38} overlay={overlay} />)}
          </div>
          {overlay && logo && (
            <div className="bs-minsize">
              <LogoMark kit={kit} logo={logo} height={Math.max(8, Math.min(26, logo.minSize / 3))} />
              <span>Never smaller than <b>{logo.minSize}px</b> tall at 1080p. Keep <b>{logo.clearSpace}×</b> its height clear on every side.</span>
            </div>
          )}
          {logo && (
            <div className="bs-logo-controls">
              <Field label="Role">
                <select className="bs-input" value={logo.role} onChange={(e) => update(logo.id, { role: e.target.value as BrandLogo['role'] })}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select>
              </Field>
              <Field label="Sits on">
                <Segmented label="Background" value={logo.on} onChange={(on) => update(logo.id, { on })} options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'any', label: 'Any' }]} />
              </Field>
              <div className="bs-field"><span>Default corner</span><CornerPicker label="Logo corner" value={logo.placement} onChange={(placement) => update(logo.id, { placement })} /></div>
              <Slider label="Clear space" value={logo.clearSpace} min={0.25} max={3} step={0.25} format={(v) => `${v}× height`} onChange={(clearSpace) => update(logo.id, { clearSpace })} />
              <Slider label="Minimum height" value={logo.minSize} min={16} max={160} step={4} format={(v) => `${v}px`} onChange={(minSize) => update(logo.id, { minSize })} />
            </div>
          )}
        </div>
      ))}
      <Group label="Where it gets cropped" hint="How the mark survives small, round and square spaces.">
        <div className="bs-crops">
          <figure><div className="bs-crop fav" style={{ background: bg }}><LogoMark kit={kit} logo={primary} height={14} /></div><figcaption>Favicon · 32</figcaption></figure>
          <figure><div className="bs-crop app" style={{ background: brand, color: onColor(brand) }}><LogoMark kit={kit} logo={primary} height={34} /></div><figcaption>App icon</figcaption></figure>
          <figure><div className="bs-crop avatar" style={{ background: bg }}><LogoMark kit={kit} logo={primary} height={30} /></div><figcaption>Avatar</figcaption></figure>
          <figure><div className="bs-crop story" style={{ background: `linear-gradient(145deg, ${brand}, ${bg})` }}><LogoMark kit={kit} logo={primary} height={26} /></div><figcaption>Story ring</figcaption></figure>
        </div>
      </Group>
      <Field label="Paste SVG markup" hint="replaces the primary logo">
        <textarea className="bs-text mono" rows={2} placeholder="<svg …>…</svg>" onBlur={(e) => {
          const svg = sanitizeSvgMarkup(e.target.value);
          if (!svg.startsWith('<svg')) return;
          onReplace({ ...kit, logos: [...kit.logos.filter((l) => l.role !== 'primary'), { id: `logo_${Math.random().toString(36).slice(2, 9)}`, role: 'primary', svg, assetId: null, path: null, dataUrl: null, clearSpace: 1, minSize: 64, placement: kit.layout.logoBug, on: 'any', doNots: [] }], updatedAt: new Date().toISOString() });
          e.target.value = '';
        }} />
      </Field>
    </div>
  );
}
