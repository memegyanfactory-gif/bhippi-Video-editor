// Settings → Brand kit: the editor for the kits the AI and every graphic read from.
//
// A kit is data (src/lib/brandKit). The left side is a library of cards — the user's kits, the house
// look, the style archetypes, the reference kits and the DaisyUI colour themes. One click selects and
// applies: a kit becomes this project's kit, an archetype opens (or starts) a kit in that style, a
// colour theme recolours the selected kit. The right side edits the selected kit and previews its
// brand board. Persistence is the settings document.

import { KitLearnings } from './KitLearnings';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { HtmlMotionLayer } from '../editor/HtmlMotionLayer';
import { BrandGuidelineView } from './BrandGuidelineView';
import { useToast } from '../components/ui';
import {
  ARCHETYPES, DAISY_THEMES, SYSTEM_FONTS, assetDataUrl, assetText, brandBoard, brandKitSummary, brandKitTheme, contrastRatio, daisyThemeToBrandColors, emptyBrandKitDoc, exportBrandKit,
  colorsFrom, findArchetype, findDaisyTheme, fontStack, importBrandKit, isDark, logoMarkup, mergeBrandKit, newBrandKit, resolveActiveKit, validateBrandKit,
  type BrandArchetype, type BrandKit, type DaisyTheme, type BrandKitDoc, type BrandKitSection, type BrandLogo, type ColorRole,
} from '../lib/brandKit';
import { api, errorText } from '../lib/ipc';
import type { Asset, Settings } from '../lib/types';

export type BrandKitSettingsProps = {
  settings: Settings;
  onSettings: (settings: Settings) => void;
  /** The open project's kit pointer and how to change it. */
  projectBrandKitId: string | null;
  onProjectBrandKit: (id: string | null) => void;
  /** Imports files into the project library (the app's host.importMedia); optional in tests. */
  importMedia?: (paths: string[], folderId?: string | null) => Promise<Asset[]>;
};

// ── small pure helpers (tested) ─────────────────────────────────────────────

/** "a, b, c" → ['a','b','c']. */
export const chipsFromText = (text: string): string[] => text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
/** One item per line. */
export const linesFromText = (text: string): string[] => text.split('\n').map((s) => s.trim()).filter(Boolean);
export const sanitizeSvgMarkup = (text: string): string =>
  text.replace(/<\?xml[^>]*>/g, '').replace(/<!DOCTYPE[^>]*>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+="[^"]*"/gi, '').trim();
export const contrastBadge = (fg: string, bg: string): { ratio: number; level: 'good' | 'ok' | 'bad' } => {
  const ratio = contrastRatio(fg, bg);
  return { ratio, level: ratio >= 4.5 ? 'good' : ratio >= 3 ? 'ok' : 'bad' };
};
/** "Acme" → "Acme copy", "Acme copy" → "Acme copy 2". */
export const nextKitName = (name: string, existing: string[]): string => {
  let candidate = `${name} copy`;
  let n = 2;
  while (existing.includes(candidate)) candidate = `${name} copy ${n++}`;
  return candidate;
};
export const applyDaisyTheme = (kit: BrandKit, themeId: string): BrandKit => {
  const theme = findDaisyTheme(themeId);
  return theme ? mergeBrandKit(kit, 'colors', { colors: daisyThemeToBrandColors(theme) }) : kit;
};

/** Design-pixel calcs from the logo markup, sized for the settings panel (no --u there). */
const flattenLogo = (html: string) => html.replace(/calc\(([\d.]+)px \* var\(--u\)\)/g, '$1px');

/** A small static picture of a kit: field, logo or monogram, name in the display face, swatches. */
export function KitThumb({ kit }: { kit: BrandKit }) {
  const theme = brandKitTheme(kit);
  const primary = kit.colors.tokens.find((t) => t.role === 'primary')?.hex ?? theme.accent;
  const display = kit.typography.display;
  return (
    <div className="bk-thumb" style={{ background: `linear-gradient(160deg, ${theme.bg}, ${theme.card})`, color: theme.fg, ['--bk-primary' as string]: primary, ['--accent' as string]: theme.accent, ['--bk-display' as string]: fontStack(display) }}>
      <div className="bk-thumb-top">
        <span className="bk-thumb-logo" dangerouslySetInnerHTML={{ __html: flattenLogo(logoMarkup(kit, 'any', 22)) }} />
        <span className="bk-thumb-name" style={{ fontFamily: fontStack(display), fontWeight: display.weight, letterSpacing: display.letterSpacing, textTransform: display.transform }}>{kit.name}</span>
      </div>
      <div className="bk-thumb-swatches">{kit.colors.tokens.slice(0, 7).map((t, i) => <i key={`${t.name}-${i}`} style={{ background: t.hex }} title={`${t.name} ${t.hex}`} />)}</div>
    </div>
  );
}

/** Strip the group suffix the archetype names carry, for the card face. */
export const archetypeLabel = (name: string): string => name.replace(/\s*\((reference|house)\)$/, '');
/** The card's own motion, from the archetype's motion spec — hover plays it. */
export const cardMotion = (motion: BrandArchetype['motion']): Record<string, string> => ({
  '--bk-ease': motion.easing,
  '--bk-enter': `${Math.max(0.24, Math.min(1.1, motion.enter))}s`,
  '--bk-stagger': `${Math.max(0.04, Math.min(0.2, motion.stagger))}s`,
  '--bk-lift': motion.intensity === 'energetic' ? '-5px' : motion.intensity === 'calm' ? '-2px' : '-3px',
});

/** One starting style as a miniature brand board: field, display type, swatches, motion on hover. */
function ArchetypeCard({ arch, selected, made, onPick }: { arch: BrandArchetype; selected: boolean; made?: boolean; onPick: () => void }) {
  const c = arch.colors;
  const display = arch.typography.display;
  return (
    <button
      type="button"
      className={`bk-card ${selected ? 'active' : ''}`}
      onClick={onPick}
      title={`${arch.name} — ${arch.character}${made ? ' · you have a kit in this style' : ''}`}
      aria-pressed={selected}
      style={{ ...cardMotion(arch.motion), background: c.bg, color: c.text }}
    >
      <span className="bk-card-field" style={{ background: `linear-gradient(${arch.gradient.angle}deg, ${arch.gradient.stops.join(', ')})` }} />
      <span className="bk-card-body">
        <span className="bk-card-title" style={{ fontFamily: `"${display.family}", system-ui, sans-serif`, fontWeight: display.weight, letterSpacing: display.letterSpacing, textTransform: display.transform }}>
          {archetypeLabel(arch.name)}
        </span>
        <span className="bk-card-sub" style={{ color: c.muted }}>{arch.industries[0] ?? arch.group}</span>
      </span>
      <span className="bk-card-swatches">{[c.primary, c.accent, c.accent2, c.surface, c.text].map((hex, i) => <i key={i} style={{ background: hex, transitionDelay: `calc(var(--bk-stagger) * ${i})` }} />)}</span>
      {selected && <span className="bk-card-check" style={{ background: c.primary, color: c.bg }}>✓</span>}
      {made && !selected && <span className="bk-card-made" title="You have a kit in this style">●</span>}
    </button>
  );
}

/** One DaisyUI theme as a card: base field, primary/secondary/accent chips, a mock control row. */
function DaisyCard({ theme, selected, onPick }: { theme: DaisyTheme; selected: boolean; onPick: () => void }) {
  const c = theme.colors;
  return (
    <button
      type="button"
      className={`bk-card bk-card-daisy ${selected ? 'active' : ''}`}
      onClick={onPick}
      title={`DaisyUI · ${theme.name} — ${theme.character}`}
      aria-pressed={selected}
      style={{ background: c.base100, color: c.baseContent, ['--bk-radius' as string]: theme.radius.box }}
    >
      <span className="bk-card-chips">
        <i style={{ background: c.primary, color: c.primaryContent, transitionDelay: '0s' }}>A</i>
        <i style={{ background: c.secondary, color: c.secondaryContent, transitionDelay: '.05s' }}>A</i>
        <i style={{ background: c.accent, color: c.accentContent, transitionDelay: '.1s' }}>A</i>
        <i style={{ background: c.neutral, color: c.neutralContent, transitionDelay: '.15s' }}>A</i>
      </span>
      <span className="bk-card-body">
        <span className="bk-card-title">{theme.name}</span>
        <span className="bk-card-sub" style={{ color: c.baseContent, opacity: 0.65 }}>{theme.scheme}</span>
      </span>
      <span className="bk-card-bars">
        <i style={{ background: c.base200 }} />
        <i style={{ background: c.base300 }} />
        <i style={{ background: c.info }} />
        <i style={{ background: c.success }} />
        <i style={{ background: c.warning }} />
        <i style={{ background: c.error }} />
      </span>
      {selected && <span className="bk-card-check" style={{ background: c.primary, color: c.primaryContent }}>✓</span>}
    </button>
  );
}

/** A titled grid of cards that wraps, so every choice is visible and one click away. */
function LibrarySection({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <section className="bk-lib-section">
      <div className="bk-shelf-head"><strong>{label}</strong>{hint && <small>{hint}</small>}</div>
      <div className="bk-lib-grid">{children}</div>
    </section>
  );
}

const ROLES: ColorRole[] = ['primary', 'secondary', 'accent', 'background', 'surface', 'text', 'muted', 'success', 'warning', 'error', 'info', 'neutral', 'custom'];
const SECTION_LABELS: Record<BrandKitSection, string> = { identity: 'Identity', logos: 'Logos', colors: 'Colours', typography: 'Typography', voice: 'Voice', motion: 'Motion', imagery: 'Imagery', layout: 'Layout', audio: 'Audio', social: 'Social', assets: 'Assets', notes: 'Notes', guideline: 'Guideline' };

// ── component ────────────────────────────────────────────────────────────────

export function BrandKitSettings(props: BrandKitSettingsProps) {
  const toast = useToast();
  const doc: BrandKitDoc = props.settings.brandKits ?? emptyBrandKitDoc();
  const [selectedId, setSelectedId] = useState<string | null>(doc.kits[0]?.id ?? null);
  const [importText, setImportText] = useState('');
  const [showImport, setShowImport] = useState(false);
  const selected = doc.kits.find((k) => k.id === selectedId) ?? doc.kits[0] ?? null;
  const active = resolveActiveKit(doc, { activeBrandKitId: props.projectBrandKitId });
  const timer = useRef<number | null>(null);

  // The latest settings, so a delayed save never writes an older document over a newer one.
  const settingsRef = useRef(props.settings);
  settingsRef.current = props.settings;
  const persist = async (next: BrandKitDoc) => {
    // A structural save supersedes any typing save still waiting.
    if (timer.current) { window.clearTimeout(timer.current); timer.current = null; }
    try {
      props.onSettings(await api.settingsSave({ ...settingsRef.current, brandKits: next }));
    } catch (error) {
      toast({ tone: 'error', title: 'Could not save the brand kit', body: errorText(error) });
    }
  };
  /** Typing edits coalesce; structural edits save at once. */
  const persistSoon = (next: BrandKitDoc) => {
    props.onSettings({ ...settingsRef.current, brandKits: next });
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { void persist(next); }, 500);
  };
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  const replace = (kit: BrandKit, soon = true) => {
    const next = { ...doc, kits: doc.kits.map((k) => (k.id === kit.id ? kit : k)) };
    return soon ? persistSoon(next) : persist(next);
  };
  const patch = (section: BrandKitSection | 'all', value: Record<string, unknown>, soon = true) => {
    if (!selected) return;
    void replace(mergeBrandKit(selected, section, value), soon);
  };

  /** Adds a kit and selects it; `useForProject` makes it the project's kit (one history step). */
  const create = async (kit: BrandKit, useForProject = false) => {
    const next: BrandKitDoc = { kits: [...doc.kits, kit], activeId: doc.activeId ?? kit.id };
    await persist(next);
    setSelectedId(kit.id);
    if (useForProject || !props.projectBrandKitId) props.onProjectBrandKit(kit.id);
  };
  /** A kit card: select it and make it this project's kit. */
  const pickKit = (kit: BrandKit) => {
    setSelectedId(kit.id);
    if (props.projectBrandKitId !== kit.id) {
      props.onProjectBrandKit(kit.id);
      toast({ tone: 'success', title: `Using ${kit.name}`, body: 'Every new graphic, title and generation in this project follows it.', timeout: 2200 });
    }
  };
  /** An archetype or reference card: open the kit already made in that style, or start one, and use it. */
  const pickArchetype = async (arch: BrandArchetype) => {
    // The kit in view wins, then the project's, then the first kit made in that style.
    const existing = (selected?.style === arch.id ? selected : null)
      ?? doc.kits.find((k) => k.id === props.projectBrandKitId && k.style === arch.id)
      ?? doc.kits.find((k) => k.style === arch.id);
    if (existing) return pickKit(existing);
    const kit = newBrandKit({ style: arch.id, name: arch.group === 'house' ? 'My brand' : archetypeLabel(arch.name) });
    await create(kit, true);
    toast({ tone: 'success', title: `Started ${kit.name}`, body: `A new kit in the ${archetypeLabel(arch.name)} style, now used by this project. Edit it on the right.`, timeout: 2600 });
  };
  /** A colour card: recolour the selected kit (null = back to its archetype's own colours). */
  const pickColours = (themeId: string | null) => {
    if (!selected) return toast({ tone: 'info', title: 'Pick a kit first', body: 'Colour themes recolour the selected kit.' });
    let next: BrandKit;
    if (themeId) next = applyDaisyTheme(selected, themeId);
    else {
      const arch = findArchetype(selected.style) ?? ARCHETYPES[0];
      next = mergeBrandKit(selected, 'colors', { colors: { ...colorsFrom(arch, arch.colors), daisyTheme: null } });
    }
    void replace(next, false);
    if (props.projectBrandKitId !== selected.id) props.onProjectBrandKit(selected.id);
  };
  const duplicate = async () => {
    if (!selected) return;
    const copy = importBrandKit(exportBrandKit({ ...selected, name: nextKitName(selected.name, doc.kits.map((k) => k.name)) }));
    if ('error' in copy) return toast({ tone: 'error', title: 'Could not duplicate', body: copy.error });
    await create({ ...copy, id: `bk_${Math.random().toString(36).slice(2, 10)}` });
  };
  const remove = async () => {
    if (!selected) return;
    const next: BrandKitDoc = { kits: doc.kits.filter((k) => k.id !== selected.id), activeId: doc.activeId === selected.id ? null : doc.activeId };
    await persist(next);
    if (props.projectBrandKitId === selected.id) props.onProjectBrandKit(null);
    setSelectedId(next.kits[0]?.id ?? null);
  };
  const doImport = async () => {
    const kit = importBrandKit(importText);
    if ('error' in kit) return toast({ tone: 'error', title: 'That is not a brand kit', body: kit.error });
    await create(kit);
    setImportText('');
    setShowImport(false);
  };
  const doExport = async () => {
    if (!selected) return;
    const json = exportBrandKit(selected);
    try {
      await navigator.clipboard.writeText(json);
      toast({ tone: 'info', title: 'Brand kit copied', body: `${selected.name} as JSON is on the clipboard.` });
    } catch {
      toast({ tone: 'info', title: 'Brand kit JSON', body: json.slice(0, 200) + '…' });
    }
  };
  const addLogo = async (role: BrandLogo['role']) => {
    if (!selected) return;
    const picked = await openDialog({ multiple: false, filters: [{ name: 'Logo', extensions: ['svg', 'png', 'webp', 'jpg', 'jpeg'] }] });
    const path = typeof picked === 'string' ? picked : Array.isArray(picked) ? picked[0] : null;
    if (!path) return;
    let assetId: string | null = null;
    let finalPath = path;
    if (props.importMedia) {
      try {
        const [asset] = await props.importMedia([path], null);
        if (asset) { assetId = asset.id; finalPath = asset.path; }
      } catch (error) {
        toast({ tone: 'error', title: 'Could not import the logo', body: errorText(error) });
      }
    }
    const logo: BrandLogo = { id: `logo_${Math.random().toString(36).slice(2, 9)}`, role, assetId, path: finalPath, svg: null, dataUrl: null, clearSpace: 1, minSize: 64, placement: selected.layout.logoBug, on: 'any', doNots: ['Do not stretch, rotate or recolour the mark.'] };
    try {
      if (/\.svg$/i.test(finalPath)) logo.svg = sanitizeSvgMarkup(await assetText(finalPath));
      else logo.dataUrl = await assetDataUrl(finalPath);
    } catch {
      toast({ tone: 'info', title: 'Logo attached by path only', body: 'It previews, but could not be embedded for export. Import it into the project library to fix that.' });
    }
    void replace({ ...selected, logos: [...selected.logos.filter((l) => l.role !== role), logo], updatedAt: new Date().toISOString() }, false);
  };

  return (
    <div className="bk-root">
      <div className="bk-library">
        {doc.kits.length > 0 ? (
          <LibrarySection label="Your kits" hint="Click one to use it for this project">
            {doc.kits.map((kit) => (
              <button
                key={kit.id}
                type="button"
                className={`bk-kit-card ${selected?.id === kit.id ? 'active' : ''}`}
                onClick={() => pickKit(kit)}
                aria-pressed={props.projectBrandKitId === kit.id}
                title={`${kit.name} — click to use it for this project`}
              >
                <KitThumb kit={kit} />
                <strong>{kit.name}</strong>
                <span>{kit.style}{kit.industry ? ` · ${kit.industry}` : ''}</span>
                <div className="bk-badges">
                  {props.projectBrandKitId === kit.id && <span className="bk-badge on">this project</span>}
                  {doc.activeId === kit.id && <span className="bk-badge">default</span>}
                  {active?.id === kit.id && props.projectBrandKitId !== kit.id && <span className="bk-badge on">active</span>}
                </div>
              </button>
            ))}
          </LibrarySection>
        ) : (
          <div className="bk-empty">
            <strong>No brand kit yet.</strong>
            <span>Click any style below to start one — it is used by this project right away. Or ask Bhippi AI: “make a brand kit from https://my-product.com”.</span>
          </div>
        )}
        {ARCHETYPE_GROUPS.map(({ group, label, hint }) => (
          <LibrarySection key={group} label={label} hint={hint}>
            {ARCHETYPES.filter((a) => a.group === group).map((a) => (
              <ArchetypeCard key={a.id} arch={a} selected={selected?.style === a.id} made={doc.kits.some((k) => k.style === a.id)} onPick={() => void pickArchetype(a)} />
            ))}
          </LibrarySection>
        ))}
        <LibrarySection label="Colours" hint={selected ? `Click to recolour ${selected.name}` : 'Pick a kit, then a colour theme'}>
          {(() => {
            const arch = (selected && findArchetype(selected.style)) || ARCHETYPES[0];
            // Marked only when the kit really wears its style's colours (not custom ones).
            const styleHexes = colorsFrom(arch, arch.colors).tokens.map((t) => t.hex.toLowerCase()).sort().join();
            const own = !!selected && !selected.colors.daisyTheme && selected.colors.tokens.map((t) => t.hex.toLowerCase()).sort().join() === styleHexes;
            return (
              <button
                type="button"
                className={`bk-card bk-card-none ${own ? 'active' : ''}`}
                onClick={() => pickColours(null)}
                aria-pressed={own}
                title={selected ? `Recolour ${selected.name} with ${archetypeLabel(arch.name)}'s own colours${own ? '' : ' (replaces its current colours)'}` : 'Pick a kit first'}
                style={{ ...cardMotion(arch.motion), background: arch.colors.bg, color: arch.colors.text }}
              >
                <span className="bk-card-swatches tall">{[arch.colors.primary, arch.colors.accent, arch.colors.accent2, arch.colors.surface].map((hex, i) => <i key={i} style={{ background: hex, transitionDelay: `calc(var(--bk-stagger) * ${i})` }} />)}</span>
                <span className="bk-card-body"><span className="bk-card-title">Style colours</span><span className="bk-card-sub" style={{ color: arch.colors.muted }}>{archetypeLabel(arch.name)}</span></span>
                {own && <span className="bk-card-check" style={{ background: arch.colors.primary, color: arch.colors.bg }}>✓</span>}
              </button>
            );
          })()}
          {DAISY_THEMES.map((t) => <DaisyCard key={t.id} theme={t} selected={selected?.colors.daisyTheme === t.id} onPick={() => pickColours(t.id)} />)}
        </LibrarySection>
        <div className="bk-library-actions">
          <button type="button" className="btn btn-small" onClick={() => setShowImport((v) => !v)}>Import JSON</button>
          {selected && <button type="button" className="btn btn-small" onClick={() => void duplicate()}>Duplicate {selected.name}</button>}
        </div>
        {showImport && <ImportBox value={importText} onChange={setImportText} onImport={() => void doImport()} />}
      </div>
      {selected ? (
        <KitEditor
          kit={selected}
          isDefault={doc.activeId === selected.id}
          isProject={props.projectBrandKitId === selected.id}
          onPatch={patch}
          onReplace={(kit) => void replace(kit, false)}
          onDefault={() => void persist({ ...doc, activeId: doc.activeId === selected.id ? null : selected.id })}
          onProject={() => props.onProjectBrandKit(props.projectBrandKitId === selected.id ? null : selected.id)}
          onDuplicate={() => void duplicate()}
          onExport={() => void doExport()}
          onDelete={() => void remove()}
          onAddLogo={(role) => void addLogo(role)}
        />
      ) : (
        <div className="bk-editor bk-editor-empty">
          <h3>Brand kit</h3>
          <p>A brand kit is the identity every graphic, caption and generated image is edited to: logo, colours, type, voice, motion, imagery, layout, audio — and the guideline the AI builds videos from. Pick a style on the left to start one.</p>
        </div>
      )}
    </div>
  );
}

const ARCHETYPE_GROUPS: { group: BrandArchetype['group']; label: string; hint: string }[] = [
  { group: 'house', label: 'House', hint: 'The Bhippi look — click to use it' },
  { group: 'archetype', label: 'Style archetypes', hint: 'Click to start (or open) a kit in that style · hover shows its motion' },
  { group: 'reference', label: 'Reference kits', hint: 'Rebuilt from public brand boards · click to use' },
];

function ImportBox({ value, onChange, onImport }: { value: string; onChange: (v: string) => void; onImport: () => void }) {
  return (
    <div className="field">
      <span>Paste an exported brand kit</span>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder='{"name": "…", "colors": {…}}' />
      <button type="button" className="btn btn-small" onClick={onImport} disabled={!value.trim()}>Import</button>
    </div>
  );
}

function KitEditor({ kit, isDefault, isProject, onPatch, onReplace, onDefault, onProject, onDuplicate, onExport, onDelete, onAddLogo }: {
  kit: BrandKit; isDefault: boolean; isProject: boolean;
  onPatch: (section: BrandKitSection | 'all', value: Record<string, unknown>, soon?: boolean) => void;
  onReplace: (kit: BrandKit) => void; onDefault: () => void; onProject: () => void; onDuplicate: () => void; onExport: () => void; onDelete: () => void; onAddLogo: (role: BrandLogo['role']) => void;
}) {
  const errors = useMemo(() => validateBrandKit(kit), [kit]);
  const theme = brandKitTheme(kit);
  const board = useMemo(() => brandBoard(kit), [kit]);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(true);
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => { setTime((t) => (t + (now - last) / 1000) % board.seconds); last = now; frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, board.seconds]);
  const text = (section: BrandKitSection | 'all', key: string, value: string) => onPatch(section, { [key]: value });
  const tokens = kit.colors.tokens;
  const bgHex = tokens.find((t) => t.role === 'background')?.hex ?? kit.palette.ink;
  const surfaceHex = tokens.find((t) => t.role === 'surface')?.hex ?? kit.palette.surface;
  const textHex = tokens.find((t) => t.role === 'text')?.hex ?? kit.palette.text;
  const setToken = (index: number, change: Partial<(typeof tokens)[number]>) => onPatch('colors', { colors: { tokens: tokens.map((t, i) => (i === index ? { ...t, ...change } : t)) } });

  return (
    <div className="bk-editor">
      <div className="bk-preview" style={{ width: '100%' }}>
        <PreviewBoard html={board.html} css={board.css} time={time} seconds={board.seconds} />
      </div>
      <div className="bk-preview-bar">
        <button type="button" className="btn btn-small" onClick={() => setPlaying((v) => !v)}>{playing ? 'Pause' : 'Play'}</button>
        <input type="range" min={0} max={board.seconds} step={0.05} value={time} onChange={(e) => { setPlaying(false); setTime(Number(e.target.value)); }} />
        <span>{time.toFixed(1)}s</span>
      </div>
      <div className="bk-summary bk-summary-clamp" title={brandKitSummary(kit)}>{brandKitSummary(kit)}</div>
      <div className="bk-actions">
        <button type="button" className={`btn btn-small ${isProject ? 'btn-primary' : ''}`} onClick={onProject}>{isProject ? 'Used by this project' : 'Use for this project'}</button>
        <button type="button" className={`btn btn-small ${isDefault ? 'btn-primary' : ''}`} onClick={onDefault}>{isDefault ? 'Default for new projects' : 'Make default'}</button>
        <button type="button" className="btn btn-small" onClick={onDuplicate}>Duplicate</button>
        <button type="button" className="btn btn-small" onClick={onExport}>Export JSON</button>
        <button type="button" className="btn btn-ghost btn-small danger" onClick={onDelete}>Delete</button>
      </div>
      {errors.length > 0 && <div className="bk-errors">{errors.map((e) => <span key={e}>• {e}</span>)}</div>}

      <Section title={SECTION_LABELS.guideline} hint="what the AI builds videos from">
        <BrandGuidelineView kit={kit} onReset={() => onPatch('guideline', { guideline: null })} />
      </Section>

      <Section title="Learnings" hint={kit.learnings?.length ? `${kit.learnings.filter((learning) => learning.status === 'active').length} in use · from ${kit.sources?.length ?? 0} reference${(kit.sources?.length ?? 0) === 1 ? '' : 's'}` : '/train teaches it'}>
        <KitLearnings kit={kit} onReplace={(next) => onReplace({ ...next, updatedAt: new Date().toISOString() })} />
      </Section>

      <Section title={SECTION_LABELS.identity} hint={kit.style} open>
        <div className="bk-grid">
          <Field label="Name"><input value={kit.name} onChange={(e) => text('identity', 'name', e.target.value)} /></Field>
          <Field label="Tagline"><input value={kit.tagline} onChange={(e) => text('identity', 'tagline', e.target.value)} /></Field>
          <Field label="Industry"><input value={kit.industry} onChange={(e) => text('identity', 'industry', e.target.value)} /></Field>
          <Field label="Audience"><input value={kit.audience} onChange={(e) => text('identity', 'audience', e.target.value)} /></Field>
        </div>
        <Field label="Description"><textarea value={kit.description} onChange={(e) => text('identity', 'description', e.target.value)} /></Field>
        <Field label="Values (comma separated)"><input value={kit.values.join(', ')} onChange={(e) => onPatch('identity', { values: chipsFromText(e.target.value) })} /></Field>
        <Field label="One-line character (what the AI is told)"><input value={kit.voice} onChange={(e) => text('identity', 'voice', e.target.value)} /></Field>
      </Section>

      <Section title={SECTION_LABELS.logos} hint={`${kit.logos.length} logo${kit.logos.length === 1 ? '' : 's'}`}>
        {kit.logos.map((logo, i) => (
          <div key={logo.id} className="bk-logo-row">
            <div className="bk-logo-box" dangerouslySetInnerHTML={{ __html: logoMarkup({ ...kit, logos: [logo] }, 'any', 40).replace(/calc\(([\d.]+)px \* var\(--u\)\)/g, '$1px') }} />
            <div className="bk-grid">
              <Field label="Role"><select value={logo.role} onChange={(e) => onReplace({ ...kit, logos: kit.logos.map((l, k) => (k === i ? { ...l, role: e.target.value as BrandLogo['role'] } : l)) })}>{['primary', 'mark', 'wordmark', 'monochrome', 'inverse', 'icon'].map((r) => <option key={r}>{r}</option>)}</select></Field>
              <Field label="Placement"><select value={logo.placement} onChange={(e) => onReplace({ ...kit, logos: kit.logos.map((l, k) => (k === i ? { ...l, placement: e.target.value as BrandLogo['placement'] } : l)) })}>{['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'].map((r) => <option key={r}>{r}</option>)}</select></Field>
              <Field label="Clear space (× height)"><input type="number" step={0.5} value={logo.clearSpace} onChange={(e) => onReplace({ ...kit, logos: kit.logos.map((l, k) => (k === i ? { ...l, clearSpace: Number(e.target.value) } : l)) })} /></Field>
              <Field label="Min height px"><input type="number" value={logo.minSize} onChange={(e) => onReplace({ ...kit, logos: kit.logos.map((l, k) => (k === i ? { ...l, minSize: Number(e.target.value) } : l)) })} /></Field>
            </div>
            <button type="button" className="btn btn-ghost btn-small danger" onClick={() => onReplace({ ...kit, logos: kit.logos.filter((_, k) => k !== i) })}>Remove</button>
          </div>
        ))}
        <div className="bk-inline">
          <button type="button" className="btn btn-small" onClick={() => onAddLogo('primary')}>Add logo file…</button>
          <span className="field-hint">SVG stays vector and exports; PNG/WebP are embedded for export.</span>
        </div>
        <Field label="Or paste SVG markup for the primary logo"><textarea placeholder="<svg …>…</svg>" onBlur={(e) => { const svg = sanitizeSvgMarkup(e.target.value); if (svg.startsWith('<svg')) { onReplace({ ...kit, logos: [...kit.logos.filter((l) => l.role !== 'primary'), { id: `logo_${Math.random().toString(36).slice(2, 9)}`, role: 'primary', svg, assetId: null, path: null, dataUrl: null, clearSpace: 1, minSize: 64, placement: kit.layout.logoBug, on: 'any', doNots: [] }] }); e.target.value = ''; } }} /></Field>
      </Section>

      <Section title={SECTION_LABELS.colors} hint={`${tokens.length} tokens`}>
        <div className="bk-inline">
          <span className={`bk-contrast ${contrastBadge(textHex, bgHex).level}`}>text / background {contrastBadge(textHex, bgHex).ratio}:1</span>
          <span className={`bk-contrast ${contrastBadge(textHex, surfaceHex).level}`}>text / surface {contrastBadge(textHex, surfaceHex).ratio}:1</span>
          <span className={`bk-contrast ${contrastBadge(isDark(theme.accent) ? '#ffffff' : '#111111', theme.accent).level}`}>label / accent {contrastBadge(isDark(theme.accent) ? '#ffffff' : '#111111', theme.accent).ratio}:1</span>
          <label>Replace from DaisyUI <select value="" onChange={(e) => { if (e.target.value) onReplace(applyDaisyTheme(kit, e.target.value)); }}><option value="">theme…</option>{DAISY_THEMES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        </div>
        {tokens.map((token, i) => (
          <div key={`${token.name}-${i}`} className="bk-token">
            <input type="color" value={/^#[0-9a-f]{6}$/i.test(token.hex) ? token.hex : '#000000'} onChange={(e) => setToken(i, { hex: e.target.value })} />
            <input value={token.name} onChange={(e) => setToken(i, { name: e.target.value })} />
            <select value={token.role} onChange={(e) => setToken(i, { role: e.target.value as ColorRole })}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select>
            <input value={token.hex} onChange={(e) => setToken(i, { hex: e.target.value })} />
            <input value={token.usage} onChange={(e) => setToken(i, { usage: e.target.value })} />
            <button type="button" className="btn btn-ghost btn-small danger" onClick={() => onPatch('colors', { colors: { tokens: tokens.filter((_, k) => k !== i) } }, false)}>×</button>
          </div>
        ))}
        <div className="bk-inline">
          <button type="button" className="btn btn-small" onClick={() => onPatch('colors', { colors: { tokens: [...tokens, { name: 'New colour', hex: theme.accent, role: 'custom', usage: '' }] } }, false)}>Add token</button>
        </div>
        <Field label="Gradients (one per line: Name, angle, #hex, #hex)"><textarea value={kit.colors.gradients.map((g) => `${g.name}, ${g.angle}, ${g.stops.join(', ')}`).join('\n')} onChange={(e) => onPatch('colors', { colors: { gradients: linesFromText(e.target.value).map((line) => { const [name, angle, ...stops] = line.split(',').map((s) => s.trim()); return { name: name || 'Gradient', angle: Number(angle) || 135, stops: stops.filter((s) => /^#[0-9a-f]{6}$/i.test(s)), usage: '' }; }).filter((g) => g.stops.length >= 2) } })} /></Field>
        <Field label="Colour rules (one per line)"><textarea value={kit.colors.rules.join('\n')} onChange={(e) => onPatch('colors', { colors: { rules: linesFromText(e.target.value) } })} /></Field>
      </Section>

      <Section title={SECTION_LABELS.typography} hint={`${kit.typography.display.family} / ${kit.typography.body.family}`}>
        {(['display', 'heading', 'body', 'caption', 'mono'] as const).map((face) => {
          const tf = kit.typography[face];
          return (
            <div key={face} className="bk-grid">
              <Field label={`${face} family`}><select value={tf.family} onChange={(e) => onPatch('typography', { [face]: { family: e.target.value } })}>{SYSTEM_FONTS.map((f) => <option key={f}>{f}</option>)}</select></Field>
              <Field label="Weight"><input type="number" min={100} max={900} step={100} value={tf.weight} onChange={(e) => onPatch('typography', { [face]: { weight: Number(e.target.value) } })} /></Field>
              <Field label="Tracking"><input value={tf.letterSpacing} onChange={(e) => onPatch('typography', { [face]: { letterSpacing: e.target.value } })} /></Field>
              <Field label="Case"><select value={tf.transform} onChange={(e) => onPatch('typography', { [face]: { transform: e.target.value } })}>{['none', 'uppercase', 'lowercase', 'capitalize'].map((c) => <option key={c}>{c}</option>)}</select></Field>
              <div className="bk-specimen" style={{ fontFamily: `"${tf.family}", ${tf.fallback}`, fontWeight: tf.weight, letterSpacing: tf.letterSpacing, textTransform: tf.transform, fontStyle: tf.italic ? 'italic' : 'normal' }}>{kit.name} Aa Bb 123</div>
            </div>
          );
        })}
        <div className="bk-grid">
          {(['hook', 'title', 'subtitle', 'body', 'label', 'caption'] as const).map((k) => <Field key={k} label={`${k} % of height`}><input type="number" step={0.1} value={kit.typography.scale[k]} onChange={(e) => onPatch('typography', { scale: { [k]: Number(e.target.value) } })} /></Field>)}
          <Field label="Line height"><input type="number" step={0.05} value={kit.typography.lineHeight} onChange={(e) => onPatch('typography', { lineHeight: Number(e.target.value) })} /></Field>
        </div>
        <Field label="Type rules (one per line)"><textarea value={kit.typography.rules.join('\n')} onChange={(e) => onPatch('typography', { rules: linesFromText(e.target.value) })} /></Field>
      </Section>

      <Section title={SECTION_LABELS.voice} hint={kit.voiceGuide.tone.join(', ')}>
        <div className="bk-grid">
          <Field label="Tone (comma separated)"><input value={kit.voiceGuide.tone.join(', ')} onChange={(e) => onPatch('voice', { tone: chipsFromText(e.target.value) })} /></Field>
          <Field label="Personality"><input value={kit.voiceGuide.personality.join(', ')} onChange={(e) => onPatch('voice', { personality: chipsFromText(e.target.value) })} /></Field>
          <Field label="Use"><input value={kit.voiceGuide.use.join(', ')} onChange={(e) => onPatch('voice', { use: chipsFromText(e.target.value) })} /></Field>
          <Field label="Avoid"><input value={kit.voiceGuide.avoid.join(', ')} onChange={(e) => onPatch('voice', { avoid: chipsFromText(e.target.value) })} /></Field>
          <Field label="Language"><input value={kit.voiceGuide.language} onChange={(e) => onPatch('voice', { language: e.target.value })} /></Field>
        </div>
        <Field label="Sample lines (one per line)"><textarea value={kit.voiceGuide.samples.join('\n')} onChange={(e) => onPatch('voice', { samples: linesFromText(e.target.value) })} /></Field>
        <Field label="Caption rules (one per line)"><textarea value={kit.voiceGuide.captionRules.join('\n')} onChange={(e) => onPatch('voice', { captionRules: linesFromText(e.target.value) })} /></Field>
      </Section>

      <Section title={SECTION_LABELS.motion} hint={`${kit.motionGuide.intensity} · enter ${kit.motionGuide.enter}s`}>
        <div className="bk-grid">
          <Field label="Easing"><input value={kit.motionGuide.easing} onChange={(e) => onPatch('motion', { easing: e.target.value })} /></Field>
          <Field label="Intensity"><select value={kit.motionGuide.intensity} onChange={(e) => onPatch('motion', { intensity: e.target.value })}>{['calm', 'balanced', 'energetic'].map((c) => <option key={c}>{c}</option>)}</select></Field>
          {(['enter', 'exit', 'hold', 'stagger'] as const).map((k) => <Field key={k} label={`${k} (s)`}><input type="number" step={0.05} min={0} value={kit.motionGuide[k]} onChange={(e) => onPatch('motion', { [k]: Number(e.target.value) })} /></Field>)}
          <Field label="Transitions"><input value={kit.motionGuide.transitions.join(', ')} onChange={(e) => onPatch('motion', { transitions: chipsFromText(e.target.value) })} /></Field>
          <Field label="Preferred React Bits"><input value={kit.motionGuide.preferredBits.join(', ')} onChange={(e) => onPatch('motion', { preferredBits: chipsFromText(e.target.value) })} /></Field>
          <Field label="Preferred Crimson templates"><input value={kit.motionGuide.preferredTemplates.join(', ')} onChange={(e) => onPatch('motion', { preferredTemplates: chipsFromText(e.target.value) })} /></Field>
        </div>
        <div className="bk-inline">
          <label>Sample</label>
          <div className="bk-motion-sample" key={`${kit.motionGuide.easing}-${kit.motionGuide.enter}-${playing}`} style={{ background: theme.accent, transition: `transform ${kit.motionGuide.enter}s ${kit.motionGuide.easing}`, transform: playing ? `translateX(${Math.round((time / board.seconds) * 120)}px)` : 'none' }} />
        </div>
        <Field label="Principles (one per line)"><textarea value={kit.motionGuide.principles.join('\n')} onChange={(e) => onPatch('motion', { principles: linesFromText(e.target.value) })} /></Field>
      </Section>

      <Section title={SECTION_LABELS.imagery} hint={kit.imagery.iconography}>
        <Field label="Style"><input value={kit.imagery.style} onChange={(e) => onPatch('imagery', { style: e.target.value })} /></Field>
        <div className="bk-grid">
          <Field label="Iconography"><select value={kit.imagery.iconography} onChange={(e) => onPatch('imagery', { iconography: e.target.value })}>{['line', 'filled', 'duotone', '3d', 'flat', 'hand-drawn', 'custom'].map((c) => <option key={c}>{c}</option>)}</select></Field>
          {(['saturation', 'contrast', 'warmth'] as const).map((k) => <Field key={k} label={`${k} ${kit.imagery.grade[k].toFixed(2)}`}><input type="range" min={-1} max={1} step={0.05} value={kit.imagery.grade[k]} onChange={(e) => onPatch('imagery', { grade: { [k]: Number(e.target.value) } })} /></Field>)}
        </div>
        <Field label="Prompt prefix (every generation starts with this)"><textarea value={kit.imagery.promptPrefix} onChange={(e) => onPatch('imagery', { promptPrefix: e.target.value })} /></Field>
        <Field label="Prompt suffix"><textarea value={kit.imagery.promptSuffix} onChange={(e) => onPatch('imagery', { promptSuffix: e.target.value })} /></Field>
        <Field label="Negative prompt"><textarea value={kit.imagery.negativePrompt} onChange={(e) => onPatch('imagery', { negativePrompt: e.target.value })} /></Field>
        <Field label="Keywords / avoid (comma separated)"><input value={kit.imagery.keywords.join(', ')} onChange={(e) => onPatch('imagery', { keywords: chipsFromText(e.target.value) })} /><input value={kit.imagery.avoid.join(', ')} placeholder="avoid…" onChange={(e) => onPatch('imagery', { avoid: chipsFromText(e.target.value) })} /></Field>
      </Section>

      <Section title={SECTION_LABELS.layout} hint={`bug ${kit.layout.logoBug} · lower third ${kit.layout.lowerThird}`}>
        <div className="bk-grid">
          <Field label={`Safe margin ${(kit.layout.safeMargin * 100).toFixed(0)}%`}><input type="range" min={0.02} max={0.12} step={0.005} value={kit.layout.safeMargin} onChange={(e) => onPatch('layout', { safeMargin: Number(e.target.value) })} /></Field>
          <Field label="Logo bug"><select value={kit.layout.logoBug} onChange={(e) => onPatch('layout', { logoBug: e.target.value })}>{['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'].map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Lower third"><select value={kit.layout.lowerThird} onChange={(e) => onPatch('layout', { lowerThird: e.target.value })}>{['bottom-left', 'bottom-right', 'bottom-center'].map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Captions"><select value={kit.layout.captions} onChange={(e) => onPatch('layout', { captions: e.target.value })}>{['bottom-center', 'top-center', 'center', 'lower-third-side'].map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label={`Corner radius ${(kit.layout.radius * 100).toFixed(1)}%`}><input type="range" min={0} max={0.08} step={0.002} value={kit.layout.radius} onChange={(e) => onPatch('layout', { radius: Number(e.target.value), })} /></Field>
          <Field label="Aspects"><input value={kit.layout.aspects.join(', ')} onChange={(e) => onPatch('layout', { aspects: chipsFromText(e.target.value) })} /></Field>
        </div>
        <Field label="Layout rules (one per line)"><textarea value={kit.layout.rules.join('\n')} onChange={(e) => onPatch('layout', { rules: linesFromText(e.target.value) })} /></Field>
      </Section>

      <Section title={SECTION_LABELS.audio} hint={kit.audio.music}>
        <div className="bk-grid">
          <Field label="Music"><input value={kit.audio.music} onChange={(e) => onPatch('audio', { music: e.target.value })} /></Field>
          <Field label="Tempo min"><input type="number" value={kit.audio.tempo[0]} onChange={(e) => onPatch('audio', { tempo: [Number(e.target.value), kit.audio.tempo[1]] })} /></Field>
          <Field label="Tempo max"><input type="number" value={kit.audio.tempo[1]} onChange={(e) => onPatch('audio', { tempo: [kit.audio.tempo[0], Number(e.target.value)] })} /></Field>
          <Field label="SFX palette"><input value={kit.audio.sfx.join(', ')} onChange={(e) => onPatch('audio', { sfx: chipsFromText(e.target.value) })} /></Field>
          <Field label="TTS voice id"><input value={kit.audio.voice ?? ''} placeholder="kokoro:af_heart" onChange={(e) => onPatch('audio', { voice: e.target.value || null })} /></Field>
        </div>
        <Field label="Sound rules (one per line)"><textarea value={kit.audio.rules.join('\n')} onChange={(e) => onPatch('audio', { rules: linesFromText(e.target.value) })} /></Field>
      </Section>

      <Section title={SECTION_LABELS.social} hint={kit.social.platforms.join(', ')}>
        <Field label="Platforms"><input value={kit.social.platforms.join(', ')} onChange={(e) => onPatch('social', { platforms: chipsFromText(e.target.value) })} /></Field>
        <Field label="Intro (first 2 s)"><input value={kit.social.intro} onChange={(e) => onPatch('social', { intro: e.target.value })} /></Field>
        <Field label="Outro (last 3 s)"><input value={kit.social.outro} onChange={(e) => onPatch('social', { outro: e.target.value })} /></Field>
        <Field label="End card (one per line)"><textarea value={kit.social.endCard.join('\n')} onChange={(e) => onPatch('social', { endCard: linesFromText(e.target.value) })} /></Field>
        <Field label="Hashtags"><input value={kit.social.hashtags.join(', ')} onChange={(e) => onPatch('social', { hashtags: chipsFromText(e.target.value) })} /></Field>
      </Section>

      <Section title={SECTION_LABELS.notes} hint={kit.notes ? 'has notes' : ''}>
        <Field label="Notes"><textarea value={kit.notes} onChange={(e) => onPatch('notes', { notes: e.target.value })} /></Field>
        {kit.assets.length > 0 && <div className="bk-summary">Assets: {kit.assets.map((a) => `${a.kind} ${a.name}`).join(' · ')}</div>}
      </Section>
    </div>
  );
}

function PreviewBoard({ html, css, time, seconds }: { html: string; css: string; time: number; seconds: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 560, h: 315 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth || 560, h: el.clientHeight || 315 });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} style={{ position: 'absolute', inset: 0 }}>
      <HtmlMotionLayer source={{ html, css, title: 'Brand board', template: 'custom' }} time={time} clipStart={0} clipDuration={seconds} stageW={size.w} stageH={size.h} />
    </div>
  );
}

function Section({ title, hint, open, children }: { title: string; hint?: string; open?: boolean; children: ReactNode }) {
  return (
    <details className="bk-section" open={open}>
      <summary>{title}<small>{hint}</small></summary>
      <div className="bk-section-body">{children}</div>
    </details>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
