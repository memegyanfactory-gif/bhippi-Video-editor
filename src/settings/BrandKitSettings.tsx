// Settings → Brand kit, as Brand Studio: the brand comes alive first (its film), then a canvas of
// artboards — logo, colour, type, motion, voice, imagery, layout, sound, the brand in use — each one a
// live editor. A prompt bar asks Bhippi's AI to change the kit.
//
// A kit is data (src/lib/brandKit). This file is the shell: it owns the kits document (selection,
// saving, creating, duplicating, importing, applying to the project); the studio itself lives in
// src/settings/brand/. Persistence is the settings document, as it always was.

import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '../components/ui';
import {
  ARCHETYPES, assetDataUrl, assetText, colorsFrom, emptyBrandKitDoc, exportBrandKit, findArchetype, importBrandKit, mergeBrandKit, newBrandKit,
  type BrandArchetype, type BrandKit, type BrandKitDoc, type BrandKitSection, type BrandLogo,
} from '../lib/brandKit';
import { errorText } from '../lib/ipc';
import type { Asset, Settings } from '../lib/types';
import { useBrandHealth } from './brand/HealthCard';
import { StudioBody } from './brand/StudioBody';
import { StudioTopBar } from './brand/StudioTopBar';
import { StyleDrawer } from './brand/StyleDrawer';
import { WizardHost } from './brand/WizardHost';
import { applyDaisyTheme, archetypeLabel, nextKitName, sanitizeSvgMarkup, type BoardId } from './brand/helpers';
import '../styles/brand-studio.css';

export { KitThumb } from './brand/KitThumb';
export { applyDaisyTheme, archetypeLabel, cardMotion, chipsFromText, contrastBadge, linesFromText, nextKitName, sanitizeSvgMarkup } from './brand/helpers';

export type BrandKitSettingsProps = {
  settings: Settings;
  onSettings: (settings: Settings) => void;
  /** The open project's kit pointer and how to change it. */
  projectBrandKitId: string | null;
  onProjectBrandKit: (id: string | null) => void;
  /** Imports files into the project library (the app's host.importMedia); optional in tests. */
  importMedia?: (paths: string[], folderId?: string | null) => Promise<Asset[]>;
};

/** The studio's health score for the top bar; its own component so the hook runs only with a kit. */
function useScore(kit: BrandKit | null) {
  const placeholder = useMemo(() => kit ?? newBrandKit({ name: 'x' }), [kit]);
  const health = useBrandHealth(placeholder);
  return kit ? health : null;
}

export function BrandKitSettings(props: BrandKitSettingsProps) {
  const toast = useToast();
  // Typing edits live here until they are saved (after a pause), so a keystroke does not send the
  // whole brand kit document to the backend.
  const [draft, setDraft] = useState<BrandKitDoc | null>(null);
  const doc: BrandKitDoc = draft ?? props.settings.brandKits ?? emptyBrandKitDoc();
  const [selectedId, setSelectedId] = useState<string | null>(doc.kits[0]?.id ?? null);
  const [importText, setImportText] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<'styles' | 'colours' | null>(null);
  const [wizard, setWizard] = useState(false);
  const [jumpTo, setJumpTo] = useState<{ id: BoardId; n: number } | null>(null);
  const selected = doc.kits.find((k) => k.id === selectedId) ?? doc.kits[0] ?? null;
  const timer = useRef<number | null>(null);
  /** When the user last edited here: the studio flashes only changes that came from elsewhere (the AI). */
  const localEditAt = useRef(0);
  const health = useScore(selected);

  // The latest settings and draft, so a delayed save never writes an older document over a newer one.
  const settingsRef = useRef(props.settings);
  settingsRef.current = props.settings;
  const pending = useRef<BrandKitDoc | null>(null);
  /** Saves through the app's settings (only the brand kits are sent; a refused save is reported there). */
  const persist = async (next: BrandKitDoc) => {
    localEditAt.current = Date.now();
    // A structural save supersedes any typing save still waiting.
    if (timer.current) { window.clearTimeout(timer.current); timer.current = null; }
    pending.current = null;
    props.onSettings({ ...settingsRef.current, brandKits: next });
    setDraft(null);
  };
  /** Typing edits coalesce into one save after a pause; structural edits save at once. */
  const persistSoon = (next: BrandKitDoc) => {
    localEditAt.current = Date.now();
    pending.current = next;
    setDraft(next);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { void persist(next); }, 500);
  };
  // Closing the panel mid-typing still saves what was typed.
  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
    if (pending.current) props.onSettings({ ...settingsRef.current, brandKits: pending.current });
  }, []);

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
  /** A kit in the switcher: select it and make it this project's kit. */
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
    setDrawer(null);
    if (existing) return pickKit(existing);
    const kit = newBrandKit({ style: arch.id, name: arch.group === 'house' ? 'My brand' : archetypeLabel(arch.name) });
    await create(kit, true);
    toast({ tone: 'success', title: `Started ${kit.name}`, body: `A new kit in the ${archetypeLabel(arch.name)} style, now used by this project.`, timeout: 2600 });
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
    const kit = importBrandKit(importText ?? '');
    if ('error' in kit) return toast({ tone: 'error', title: 'That is not a brand kit', body: kit.error });
    await create(kit);
    setImportText(null);
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

  const startFromStyle = () => setDrawer('styles');
  return (
    <div className="bk-root bs-root">
      <StudioTopBar
        kits={doc.kits}
        selected={selected}
        projectKitId={props.projectBrandKitId}
        defaultKitId={doc.activeId}
        health={health}
        onSelect={pickKit}
        onNew={() => setWizard(true)}
        onStyles={startFromStyle}
        onApply={() => selected && props.onProjectBrandKit(props.projectBrandKitId === selected.id ? null : selected.id)}
        onDefault={() => selected && void persist({ ...doc, activeId: doc.activeId === selected.id ? null : selected.id })}
        onDuplicate={() => void duplicate()}
        onImport={() => setImportText('')}
        onExport={() => void doExport()}
        onDelete={() => void remove()}
        onHealth={() => setJumpTo((j) => ({ id: 'overview', n: (j?.n ?? 0) + 1 }))}
      />
      {selected ? (
        <StudioBody kit={selected} onPatch={patch} onReplace={(kit) => void replace(kit, false)} onAddLogo={(role) => void addLogo(role)} onOpenStyles={setDrawer} localEditAt={localEditAt} jumpTo={jumpTo} />
      ) : (
        <div className="bs-empty">
          <Sparkles size={28} />
          <h2>Make your brand</h2>
          <p>A brand kit is the identity every graphic, caption and generated image is edited to: logo, colours, type, voice, motion, imagery and layout. Start one and watch it come alive.</p>
          <div>
            <button type="button" className="bs-btn primary big" onClick={() => setWizard(true)}>Create a brand</button>
            <button type="button" className="bs-btn big" onClick={startFromStyle}>Start from a style</button>
          </div>
          <small>Or ask Bhippi AI: “make a brand kit from https://my-product.com”.</small>
        </div>
      )}
      {drawer && <StyleDrawer kits={doc.kits} selected={selected} tab={drawer} onClose={() => setDrawer(null)} onPickArchetype={(a) => void pickArchetype(a)} onPickColours={pickColours} />}
      {importText !== null && (
        <div className="bs-modal" role="dialog" aria-label="Import a brand kit" onKeyDown={(e) => { if (e.key === 'Escape') setImportText(null); }}>
          <div className="bs-modal-card">
            <h4>Import a brand kit</h4>
            <p>Paste a kit exported from Bhippi.</p>
            <textarea className="bs-text mono" rows={10} autoFocus value={importText} onChange={(e) => setImportText(e.target.value)} placeholder='{"name": "…", "colors": {…}}' />
            <div className="bs-modal-actions"><button type="button" className="bs-btn ghost" onClick={() => setImportText(null)}>Cancel</button><button type="button" className="bs-btn primary" disabled={!importText.trim()} onClick={() => void doImport()}>Import</button></div>
          </div>
        </div>
      )}
      {wizard && <WizardHost onClose={() => setWizard(false)} onCreate={(kit) => { setWizard(false); void create(kit, true); }} />}
    </div>
  );
}
