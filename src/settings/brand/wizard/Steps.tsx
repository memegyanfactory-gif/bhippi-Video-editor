// The questions behind the wizard. Each is one screen: a big prompt, one thing to answer, skippable
// where it makes sense. They only edit the shared brief; the wizard decides what comes next.

import { ArrowRight, Check, Globe, ImagePlus, LayoutGrid, Loader2, SlidersHorizontal, Sparkles, Upload, X } from 'lucide-react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type SetStateAction } from 'react';
import { useToast } from '../../../components/ui';
import { assetDataUrl, assetText } from '../../../lib/brandKit';
import { EXAMPLE_PROMPTS, FEELING_WORDS, INDUSTRY_CHIPS, parseBrief, type Brief, type Sliders } from '../../../lib/brandKit/brief';
import { sanitizeSvg } from '../../../lib/brandKit/directions';
import { brandFromPage, type WebsiteBrand } from '../../../lib/brandKit/fromWebsite';
import { brandSwatches, colorsInSvg, paletteFromImageUrl, vividSwatches } from '../../../lib/brandKit/palette';
import { api, errorText } from '../../../lib/ipc';

export type BriefProps = { brief: Brief; setBrief: Dispatch<SetStateAction<Brief>> };
export type PickedImage = { path: string; url: string; colors: string[] };

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const patch = (setBrief: BriefProps['setBrief'], p: Partial<Brief>) => setBrief((b) => ({ ...b, ...p }));

// ── 0. describe ──────────────────────────────────────────────────────────────

export function DescribeStep({ text, setText, onGenerate, onFineTune, onStyles, canGenerate }: {
  text: string; setText: (t: string) => void; onGenerate: () => void; onFineTune: () => void; onStyles: () => void; canGenerate: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const read = useMemo(() => parseBrief(text), [text]);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div className="bw-describe">
      <h1 className="bw-h1">Describe your brand<span className="bw-h1-dot">.</span></h1>
      <p className="bw-sub">A sentence or two is plenty. Say what it is, who it is for and how it should feel, and I will draw three directions.</p>
      <div className="bw-prompt">
        <textarea
          ref={ref}
          value={text}
          rows={4}
          maxLength={600}
          placeholder="A playful kids' bakery in Mumbai with a hand-drawn feel…"
          aria-label="Describe your brand"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (canGenerate) onGenerate(); }
          }}
        />
        <div className="bw-prompt-bar">
          <div className="bw-read" aria-live="polite">
            {read.notes.length ? (<><span>I read this as</span>{read.notes.slice(0, 5).map((n) => <b key={n}>{n}</b>)}</>) : <span className="bw-faint">Enter to continue · Shift+Enter for a new line</span>}
          </div>
          <button type="button" className="bw-go" disabled={!canGenerate} onClick={onGenerate}><Sparkles size={16} />Create directions<ArrowRight size={16} /></button>
        </div>
      </div>
      <div className="bw-examples" role="group" aria-label="Example descriptions">
        {EXAMPLE_PROMPTS.map((p) => <button key={p} type="button" className="bw-example" onClick={() => { setText(p); ref.current?.focus(); }}>{p}</button>)}
      </div>
      <div className="bw-alt">
        <button type="button" className="bw-link" onClick={onFineTune}><SlidersHorizontal size={14} />Fine-tune the answers</button>
        <span aria-hidden="true">·</span>
        <button type="button" className="bw-link" onClick={onStyles}><LayoutGrid size={14} />Start from a style instead</button>
      </div>
    </div>
  );
}

// ── 1. name ──────────────────────────────────────────────────────────────────

export function NameStep({ brief, setBrief, onEnter }: BriefProps & { onEnter: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const makes = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div className="bw-q">
      <p className="bw-kicker">The basics</p>
      <h2 className="bw-h2">What is it called?</h2>
      <input ref={ref} className="bw-big" value={brief.name} placeholder="Sunny Crumbs" aria-label="Brand name" maxLength={48} onChange={(e) => patch(setBrief, { name: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); makes.current?.focus(); } }} />
      <h2 className="bw-h2 bw-h2-2">And what do you make?</h2>
      <input ref={makes} className="bw-big bw-big-2" value={brief.makes} placeholder="Hand-decorated cakes and cookies for birthdays" aria-label="What do you make" maxLength={160} onChange={(e) => patch(setBrief, { makes: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter(); } }} />
    </div>
  );
}

// ── 2. audience ──────────────────────────────────────────────────────────────

const AUDIENCE_CHIPS = ['Kids and parents', 'Gen Z', 'Founders', 'Developers', 'Busy professionals', 'Creators', 'Families', 'Students', 'Luxury buyers', 'Local community'];

export function AudienceStep({ brief, setBrief, onEnter }: BriefProps & { onEnter: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const industry = brief.industry;
  return (
    <div className="bw-q">
      <p className="bw-kicker">Your people</p>
      <h2 className="bw-h2">Who is it for?</h2>
      <input ref={ref} className="bw-big" value={brief.audience} placeholder="Busy parents who want something special" aria-label="Audience" maxLength={90} onChange={(e) => patch(setBrief, { audience: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter(); } }} />
      <div className="bw-chips" role="group" aria-label="Common audiences">
        {AUDIENCE_CHIPS.map((a) => <button key={a} type="button" className="bw-chip" aria-pressed={brief.audience === a} onClick={() => patch(setBrief, { audience: brief.audience === a ? '' : a })}>{a}</button>)}
      </div>
      <h2 className="bw-h2 bw-h2-2">And the world it lives in?</h2>
      <div className="bw-chips" role="group" aria-label="Industries">
        {INDUSTRY_CHIPS.map((i) => <button key={i} type="button" className="bw-chip" aria-pressed={industry === i} onClick={() => patch(setBrief, { industry: industry === i ? '' : i })}>{i}</button>)}
      </div>
      <input className="bw-mid" value={INDUSTRY_CHIPS.includes(industry) ? '' : industry} placeholder="Or say it in your own words: boutique cheese shop" aria-label="Industry" maxLength={60} onChange={(e) => patch(setBrief, { industry: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter(); } }} />
    </div>
  );
}

// ── 3. feel ──────────────────────────────────────────────────────────────────

const AXES: { key: keyof Sliders; left: string; right: string }[] = [
  { key: 'serious', left: 'Playful', right: 'Serious' },
  { key: 'expressive', left: 'Minimal', right: 'Expressive' },
  { key: 'cool', left: 'Warm', right: 'Cool' },
  { key: 'modern', left: 'Classic', right: 'Modern' },
];

/** A small card that morphs as the sliders move: corners, colour, type, shapes, bounce. */
export function FeelPreview({ sliders: s, name }: { sliders: Sliders; name: string }) {
  const hue = lerp(22, 214, s.cool);
  const sat = lerp(34, 90, s.expressive);
  const style = {
    '--r': `${lerp(34, 4, s.serious)}px`,
    '--h': hue, '--s': `${sat}%`,
    '--tilt': `${lerp(-3.5, 0, s.serious)}deg`,
    '--bob': `${lerp(9, 0.6, s.serious)}px`, '--bobt': `${lerp(2.1, 7, s.serious)}s`,
    '--shapes': lerp(0, 1, s.expressive), '--wt': Math.round(lerp(300, 900, s.expressive) / 100) * 100,
    '--serif': Math.max(0, Math.min(1, (0.65 - s.modern) / 0.3)), '--sans': Math.max(0, Math.min(1, (s.modern - 0.35) / 0.3)),
    '--lum': `${lerp(95, 90, s.expressive)}%`,
  } as CSSProperties;
  const line = s.serious > 0.62 ? 'Built to be trusted.' : s.serious < 0.38 ? 'Say hello to happy.' : 'Made for people like you.';
  const title = name.trim() || 'Your brand';
  return (
    <div className="bw-feel" style={style} aria-hidden="true">
      <div className="bw-feel-card">
        <i className="bw-feel-s1" /><i className="bw-feel-s2" /><i className="bw-feel-s3" />
        <div className="bw-feel-title">
          <span className="bw-feel-serif">{title}</span>
          <span className="bw-feel-sans">{title}</span>
        </div>
        <p key={line} className="bw-feel-line">{line}</p>
        <span className="bw-feel-pill">Get started</span>
      </div>
    </div>
  );
}

export function FeelStep({ brief, setBrief }: BriefProps) {
  const [custom, setCustom] = useState('');
  const toggle = (w: string) => setBrief((b) => ({ ...b, words: b.words.includes(w) ? b.words.filter((x) => x !== w) : [...b.words, w].slice(0, 8) }));
  const words = [...FEELING_WORDS, ...brief.words.filter((w) => !FEELING_WORDS.includes(w))];
  return (
    <div className="bw-q bw-feel-wrap">
      <div className="bw-feel-main">
        <p className="bw-kicker">The feeling</p>
        <h2 className="bw-h2">How should it feel?</h2>
        <div className="bw-sliders">
          {AXES.map(({ key, left, right }) => (
            <label key={key} className="bw-slider">
              <span className={brief.sliders[key] < 0.5 ? 'is-on' : ''}>{left}</span>
              <input type="range" min={0} max={100} value={Math.round(brief.sliders[key] * 100)} aria-label={`${left} to ${right}`} style={{ '--pct': `${Math.round(brief.sliders[key] * 100)}%` } as CSSProperties}
                onChange={(e) => setBrief((b) => ({ ...b, sliders: { ...b.sliders, [key]: Number(e.target.value) / 100 } }))} />
              <span className={brief.sliders[key] >= 0.5 ? 'is-on' : ''}>{right}</span>
            </label>
          ))}
        </div>
        <p className="bw-label">Words that describe it <span className="bw-faint">(optional)</span></p>
        <div className="bw-chips" role="group" aria-label="Describing words">
          {words.map((w) => <button key={w} type="button" className="bw-chip" aria-pressed={brief.words.includes(w)} onClick={() => toggle(w)}>{w}</button>)}
          <input className="bw-chip-input" value={custom} placeholder="Add your own" aria-label="Add a word" maxLength={20}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); const w = custom.trim(); if (w) { setBrief((b) => ({ ...b, words: [...new Set([...b.words, w.charAt(0).toUpperCase() + w.slice(1)])].slice(0, 8) })); setCustom(''); } } }} />
        </div>
      </div>
      <FeelPreview sliders={brief.sliders} name={brief.name} />
    </div>
  );
}

// ── 4. bring what you have ───────────────────────────────────────────────────

const normaliseUrl = (v: string) => { const t = v.trim(); return !t ? '' : /^https?:\/\//i.test(t) ? t : `https://${t}`; };
const pathsOf = (picked: unknown): string[] => (typeof picked === 'string' ? [picked] : Array.isArray(picked) ? picked.filter((p): p is string => typeof p === 'string') : []);

export function BringStep({ brief, setBrief, images, setImages, site, setSite }: BriefProps & {
  images: PickedImage[]; setImages: Dispatch<SetStateAction<PickedImage[]>>; site: WebsiteBrand | null; setSite: (s: WebsiteBrand | null) => void;
}) {
  const toast = useToast();
  const [url, setUrl] = useState(brief.siteUrl);
  const [busy, setBusy] = useState<'site' | 'images' | 'logo' | null>(null);
  const [siteError, setSiteError] = useState('');

  const readSite = async () => {
    const target = normaliseUrl(url);
    if (!/^https?:\/\/[^\s/]+\.[^\s/]+/i.test(target)) { setSiteError('That does not look like a website address.'); return; }
    setBusy('site');
    setSiteError('');
    try {
      const page = await api.webPageSource(target);
      if (!page || typeof page.html !== 'string') throw new Error('the page came back empty');
      const found = brandFromPage(page.url || target, page.html, page.stylesheets ?? []);
      setSite(found);
      const c = found.colors;
      setBrief((b) => ({
        ...b,
        siteUrl: target,
        siteColors: [c.primary, c.accent, c.secondary].filter((x): x is string => !!x),
        siteBackground: c.background,
        name: b.name || found.name,
        makes: b.makes || found.description.slice(0, 140),
      }));
    } catch (error) {
      setSiteError(`Could not read ${target}: ${errorText(error)}`);
    } finally {
      setBusy(null);
    }
  };

  const clearSite = () => { setSite(null); setUrl(''); setBrief((b) => ({ ...b, siteUrl: '', siteColors: [], siteBackground: null })); };

  const syncImages = (next: PickedImage[]) => {
    setImages(next);
    const merged = brandSwatches(next.flatMap((i) => i.colors).map((hex) => ({ hex, share: 1 })), 5, 56);
    setBrief((b) => ({ ...b, imageColors: merged }));
  };

  const addImages = async () => {
    let picked: unknown;
    try {
      picked = await openDialog({ multiple: true, filters: [{ name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }] });
    } catch (error) {
      toast({ tone: 'error', title: 'Could not open the file picker', body: errorText(error) });
      return;
    }
    const paths = pathsOf(picked).filter((p) => !images.some((i) => i.path === p)).slice(0, 8 - images.length);
    if (!paths.length) return;
    setBusy('images');
    const added: PickedImage[] = [];
    for (const path of paths) {
      try {
        const dataUrl = await assetDataUrl(path);
        const palette = await paletteFromImageUrl(dataUrl, 7);
        added.push({ path, url: dataUrl, colors: vividSwatches(palette, 3).length ? vividSwatches(palette, 3) : brandSwatches(palette, 2) });
      } catch (error) {
        toast({ tone: 'error', title: `Could not read ${path.split(/[\\/]/).pop()}`, body: errorText(error) });
      }
    }
    syncImages([...images, ...added]);
    setBusy(null);
  };

  const setLogo = (svg: string | null, dataUrl: string | null, label: string, path: string | null) => {
    setBrief((b) => ({ ...b, logo: { svg, dataUrl, path, label }, logoColors: svg ? colorsInSvg(svg, 3) : [] }));
  };

  const addLogo = async () => {
    let picked: unknown;
    try {
      picked = await openDialog({ multiple: false, filters: [{ name: 'Logo', extensions: ['svg', 'png', 'webp', 'jpg', 'jpeg'] }] });
    } catch (error) {
      toast({ tone: 'error', title: 'Could not open the file picker', body: errorText(error) });
      return;
    }
    const path = pathsOf(picked)[0];
    if (!path) return;
    setBusy('logo');
    try {
      const label = path.split(/[\\/]/).pop() ?? 'logo';
      if (/\.svg$/i.test(path)) {
        const svg = sanitizeSvg(await assetText(path));
        if (!svg.startsWith('<svg')) throw new Error('that file is not an SVG');
        setLogo(svg, null, label, path);
      } else {
        const dataUrl = await assetDataUrl(path);
        setLogo(null, dataUrl, label, path);
        try {
          const vivid = vividSwatches(await paletteFromImageUrl(dataUrl, 6), 2);
          setBrief((b) => ({ ...b, logoColors: vivid }));
        } catch { /* the logo still works without a palette */ }
      }
    } catch (error) {
      toast({ tone: 'error', title: 'Could not use that logo', body: errorText(error) });
    } finally {
      setBusy(null);
    }
  };

  const siteSvgLogos = site?.logos.filter((l) => l.kind === 'svg' && l.svg) ?? [];

  return (
    <div className="bw-q bw-bring">
      <p className="bw-kicker">Optional, all of it</p>
      <h2 className="bw-h2">Bring what you already have.</h2>
      <div className="bw-bring-grid">
        <section className="bw-card" aria-label="Website">
          <header><Globe size={16} /><h3>Your website</h3></header>
          <p>I will read its colours and fonts.</p>
          <div className="bw-row">
            <input value={url} placeholder="yourbrand.com" aria-label="Website address" onChange={(e) => { setUrl(e.target.value); setSiteError(''); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); void readSite(); } }} />
            <button type="button" className="bw-btn" disabled={busy === 'site' || !url.trim()} onClick={() => void readSite()}>{busy === 'site' ? <Loader2 size={14} className="bw-spin" /> : 'Read'}</button>
          </div>
          {siteError && <p className="bw-err" role="alert">{siteError}</p>}
          {site && (
            <div className="bw-found">
              <div className="bw-found-head"><b>{site.name || site.url}</b><button type="button" className="bw-x" onClick={clearSite} aria-label="Forget the website"><X size={13} /></button></div>
              <div className="bw-swatches">{brief.siteColors.map((c) => <i key={c} style={{ background: c }} title={c} />)}{brief.siteBackground && <i className="is-ring" style={{ background: brief.siteBackground }} title={`background ${brief.siteBackground}`} />}</div>
              <p className="bw-faint">Type: {site.fonts.declared.slice(0, 2).join(', ') || 'not declared'}</p>
              {siteSvgLogos.length > 0 && <button type="button" className="bw-link" onClick={() => { const s = sanitizeSvg(siteSvgLogos[0].svg ?? ''); if (s.startsWith('<svg')) setLogo(s, null, 'logo from website', null); }}>Use the logo from the site</button>}
            </div>
          )}
        </section>

        <section className="bw-card" aria-label="Pictures">
          <header><ImagePlus size={16} /><h3>Pictures you love</h3></header>
          <p>I will pull a palette out of them.</p>
          <div className="bw-thumbs">
            {images.map((im) => (
              <figure key={im.path}>
                <img src={im.url} alt="" />
                <button type="button" className="bw-x" aria-label="Remove picture" onClick={() => syncImages(images.filter((i) => i.path !== im.path))}><X size={12} /></button>
                <figcaption>{im.colors.map((c) => <i key={c} style={{ background: c }} />)}</figcaption>
              </figure>
            ))}
            {images.length < 8 && <button type="button" className="bw-add" onClick={() => void addImages()} disabled={busy === 'images'}>{busy === 'images' ? <Loader2 size={16} className="bw-spin" /> : <Upload size={16} />}<span>Add pictures</span></button>}
          </div>
          {brief.imageColors.length > 0 && <div className="bw-swatches" aria-label="Palette from your pictures">{brief.imageColors.map((c) => <i key={c} style={{ background: c }} title={c} />)}</div>}
        </section>

        <section className="bw-card" aria-label="Logo">
          <header><Check size={16} /><h3>Your logo</h3></header>
          <p>SVG or PNG. I will build the lockups around it.</p>
          {brief.logo ? (
            <div className="bw-logo-has">
              <div className="bw-logo-tile">{brief.logo.svg ? <span dangerouslySetInnerHTML={{ __html: brief.logo.svg }} /> : <img src={brief.logo.dataUrl ?? ''} alt="" />}</div>
              <div><b>{brief.logo.label}</b><button type="button" className="bw-link" onClick={() => setBrief((b) => ({ ...b, logo: null, logoColors: [] }))}>Remove</button></div>
            </div>
          ) : (
            <button type="button" className="bw-add bw-add-wide" onClick={() => void addLogo()} disabled={busy === 'logo'}>{busy === 'logo' ? <Loader2 size={16} className="bw-spin" /> : <Upload size={16} />}<span>Choose a logo</span></button>
          )}
          <p className="bw-faint">No logo yet? A wordmark is made from your name.</p>
        </section>
      </div>
    </div>
  );
}
