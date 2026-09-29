// Brand kit tools — the copilot's way to read, make, change, apply and show brand kits.
//
// Kits live in Settings (`Settings.brandKits`), the project keeps a pointer (`activeBrandKitId`).
// Reads are allowed in every phase; writes go through the host's settings callbacks so the panel,
// the tools and the system prompt always see the same document.

import { addLearnings, forgetSource, LEARNING_AREAS, type NewLearning } from './brandKit/learnings';
import type { ToolHost } from './aiTools';
import {
  ARCHETYPES, BRAND_KIT_SECTIONS, DAISY_THEMES, HOUSE_ARCHETYPE, assetDataUrl, assetText, brandBoard, brandKitContext, brandKitPrompt, brandKitSummary, brandKitTheme,
  brandedPrompt, daisyThemeSummary, daisyThemeToBrandColors, emptyBrandKitDoc, exportBrandKit, findArchetype, findDaisyTheme, findKit, importBrandKit, kitFromArchetype,
  mergeBrandKit, pickBrandKit, resolveActiveKit, retintGraphicHtml, validateBrandKit,
  type BrandKit, type BrandKitDoc, type BrandKitSection, type BrandLogo, type Corner, type LogoRole,
} from './brandKit';
import type { NewBrandKitInput } from './brandKit/build';
import { relativeLuminance } from './brandKit/build';
import { brandFromPage } from './brandKit/fromWebsite';
import { guidelineOf } from './brandKit/guideline';
import { api, errorText } from './ipc';
import { createMotionGraphicComp } from './motionGraphics';
import { playhead } from './playhead';
import type { Comp, Project, ToolResult } from './types';

type Args = Record<string, unknown>;

export type BrandToolContext = {
  project: Project;
  comp: Comp | null;
  commit: (change: (current: Project) => Project, label?: string) => void;
  /** A project folder by name, created when missing (logos land in "Brand"). */
  folderFor: (name: string) => string;
};

export const BRAND_KIT_TOOLS = new Set([
  'list_brand_kits', 'get_brand_kit', 'list_brand_archetypes', 'create_brand_kit', 'update_brand_kit', 'delete_brand_kit',
  'set_active_brand_kit', 'apply_brand_kit', 'brand_kit_prompt', 'render_brand_board', 'import_brand_logo', 'export_brand_kit', 'import_brand_kit',
  'get_brand_guideline', 'extract_brand_from_url', 'check_brand_compliance',
  'train_brand_kit', 'forget_training',
]);

const fail = (error: string): ToolResult => ({ ok: false, error });
const done = (summary: string, data: Record<string, unknown> = {}): ToolResult => ({ ok: true, ...data, summary });
const str = (args: Args, key: string): string | undefined => (typeof args[key] === 'string' && (args[key] as string).trim() ? (args[key] as string) : undefined);
const num = (args: Args, key: string): number | undefined => (typeof args[key] === 'number' && Number.isFinite(args[key]) ? (args[key] as number) : undefined);
const bool = (args: Args, key: string): boolean | undefined => (typeof args[key] === 'boolean' ? (args[key] as boolean) : undefined);
const record = (args: Args, key: string): Args | undefined => (args[key] && typeof args[key] === 'object' && !Array.isArray(args[key]) ? (args[key] as Args) : undefined);
const list = (args: Args, key: string): string[] | undefined => (Array.isArray(args[key]) ? (args[key] as unknown[]).filter((v): v is string => typeof v === 'string') : undefined);

export const brandKitDoc = (host: ToolHost): BrandKitDoc => host.settings?.().brandKits ?? emptyBrandKitDoc();

/** The kit this project is edited to, if the host can see settings. */
export const activeBrandKit = (host: ToolHost, project: Project): BrandKit | null => resolveActiveKit(host.settings?.().brandKits ?? null, project);

async function saveDoc(host: ToolHost, doc: BrandKitDoc): Promise<string | null> {
  if (!host.settings || !host.saveSettings) return 'Brand kits are kept in the app settings, which this host cannot save.';
  try {
    await host.saveSettings({ ...host.settings(), brandKits: doc });
    return null;
  } catch (error) {
    return errorText(error);
  }
}

/** The kit a tool call means: by id/name, by a free-text `query`, else the project's active kit. */
const kitOf = (host: ToolHost, project: Project, args: Args): BrandKit | undefined => {
  const id = str(args, 'id');
  const query = str(args, 'query');
  const doc = brandKitDoc(host);
  if (id) return findKit(doc, id);
  if (query) return pickBrandKit(doc, query)?.kit;
  return resolveActiveKit(doc, project) ?? undefined;
};
const noKit = (id?: string): ToolResult => fail(id ? `No brand kit called "${id}". list_brand_kits shows them.` : 'No brand kit is active for this project. set_active_brand_kit {"auto": true} picks one (or {"query": "<brand words>"}), list_brand_kits shows them, create_brand_kit makes one.');

/** The kit without embedded logo bytes — what tool results carry. */
const publicKit = (kit: BrandKit) => ({ ...kit, logos: kit.logos.map((l) => ({ ...l, dataUrl: l.dataUrl ? '[embedded]' : null })) });

const summarise = (kit: BrandKit, doc: BrandKitDoc, project: Project) => ({
  id: kit.id, name: kit.name, style: kit.style, tagline: kit.tagline, industry: kit.industry,
  isDefault: doc.activeId === kit.id, isProject: project.activeBrandKitId === kit.id, active: resolveActiveKit(doc, project)?.id === kit.id,
  logos: kit.logos.length, updatedAt: kit.updatedAt, summary: brandKitSummary(kit),
});

function sectionOf(kit: BrandKit, section: string): unknown {
  switch (section) {
    case 'identity': return { name: kit.name, tagline: kit.tagline, description: kit.description, industry: kit.industry, audience: kit.audience, values: kit.values, style: kit.style, voice: kit.voice };
    case 'logos': return publicKit(kit).logos;
    case 'colors': return { ...kit.colors, palette: kit.palette };
    case 'typography': return kit.typography;
    case 'voice': return kit.voiceGuide;
    case 'motion': return kit.motionGuide;
    case 'imagery': return kit.imagery;
    case 'layout': return kit.layout;
    case 'audio': return kit.audio;
    case 'social': return kit.social;
    case 'assets': return kit.assets;
    case 'notes': return kit.notes;
    case 'guideline': return guidelineOf(kit);
    case 'all': return publicKit(kit);
    default: return undefined;
  }
}

const sanitizeSvg = (text: string): string =>
  text.replace(/<\?xml[^>]*>/g, '').replace(/<!DOCTYPE[^>]*>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+="[^"]*"/gi, '').trim();

const isCorner = (v: unknown): v is Corner => typeof v === 'string' && ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'].includes(v);
const isRole = (v: unknown): v is LogoRole => typeof v === 'string' && ['primary', 'mark', 'wordmark', 'monochrome', 'inverse', 'icon'].includes(v);

export async function runBrandKitTool(host: ToolHost, name: string, args: Args, ctx: BrandToolContext): Promise<ToolResult> {
  const { project } = ctx;
  const doc = brandKitDoc(host);

  switch (name) {
    case 'list_brand_kits': {
      const active = resolveActiveKit(doc, project);
      return done(
        doc.kits.length ? `${doc.kits.length} brand kit${doc.kits.length === 1 ? '' : 's'}; ${active ? `this project uses "${active.name}"` : 'none active for this project'}.` : 'No brand kits yet. create_brand_kit makes one from an archetype (list_brand_archetypes).',
        { kits: doc.kits.map((k) => summarise(k, doc, project)), defaultId: doc.activeId, projectId: project.activeBrandKitId ?? null, activeId: active?.id ?? null },
      );
    }

    case 'get_brand_kit': {
      const kit = kitOf(host, project, args);
      if (!kit) return noKit(str(args, 'id'));
      const section = str(args, 'section');
      if (section) {
        const value = sectionOf(kit, section);
        if (value === undefined) return fail(`Unknown section "${section}". Sections: ${BRAND_KIT_SECTIONS.join(', ')}.`);
        return done(`${kit.name} — ${section}`, { id: kit.id, name: kit.name, section, value });
      }
      return done(brandKitSummary(kit), { kit: publicKit(kit), context: brandKitContext(kit) });
    }

    case 'list_brand_archetypes': {
      const group = str(args, 'group');
      const terms = (str(args, 'query') ?? '').toLowerCase().split(/[\s,]+/).filter(Boolean);
      const matches = (text: string) => !terms.length || terms.every((t) => text.toLowerCase().includes(t));
      const archetypes = ARCHETYPES
        .filter((a) => !group || group === a.group)
        .filter((a) => matches(`${a.id} ${a.name} ${a.character} ${a.industries.join(' ')}`))
        .map((a) => ({ id: a.id, name: a.name, group: a.group, character: a.character, industries: a.industries, colors: a.colors, display: `${a.typography.display.family} ${a.typography.display.weight}`, motion: a.motion.intensity, transitions: a.motion.transitions }));
      const daisy = (!group || group === 'daisy')
        ? DAISY_THEMES.filter((t) => matches(`${t.id} ${t.name} ${t.character} ${t.industries.join(' ')}`)).map((t) => ({ id: t.id, name: t.name, group: 'daisy', scheme: t.scheme, character: t.character, industries: t.industries, colors: { bg: t.colors.base100, surface: t.colors.base200, text: t.colors.baseContent, primary: t.colors.primary, accent: t.colors.accent, secondary: t.colors.secondary }, summary: daisyThemeSummary(t) }))
        : [];
      return done(`${archetypes.length} archetype${archetypes.length === 1 ? '' : 's'}${daisy.length ? ` and ${daisy.length} DaisyUI themes` : ''}. Start a kit with create_brand_kit {"style": "<id>"} (add "daisyTheme" for DaisyUI colours).`, { archetypes, daisyThemes: daisy });
    }

    case 'create_brand_kit': {
      const style = str(args, 'style');
      const arch = findArchetype(style) ?? HOUSE_ARCHETYPE;
      if (style && !findArchetype(style)) return fail(`No archetype matches "${style}". list_brand_archetypes shows the ids (or omit style for the house look).`);
      const input: NewBrandKitInput = {
        style: arch.id, name: str(args, 'name'), brandName: str(args, 'brandName'), tagline: str(args, 'tagline'), description: str(args, 'description'), industry: str(args, 'industry'), audience: str(args, 'audience'), values: list(args, 'values'),
        primary: str(args, 'primary'), accent: str(args, 'accent'), accent2: str(args, 'accent2'), background: str(args, 'background'), surface: str(args, 'surface'), text: str(args, 'text'),
        displayFont: str(args, 'displayFont'), bodyFont: str(args, 'bodyFont'), logoSvg: str(args, 'logoSvg'),
        voice: record(args, 'voice') as NewBrandKitInput['voice'], motion: record(args, 'motion') as NewBrandKitInput['motion'], imagery: record(args, 'imagery') as NewBrandKitInput['imagery'],
        layout: record(args, 'layout') as NewBrandKitInput['layout'], audio: record(args, 'audio') as NewBrandKitInput['audio'], social: record(args, 'social') as NewBrandKitInput['social'], notes: str(args, 'notes'),
      };
      let kit = kitFromArchetype(arch, input);
      const daisyId = str(args, 'daisyTheme');
      if (daisyId) {
        const theme = findDaisyTheme(daisyId);
        if (!theme) return fail(`No DaisyUI theme called "${daisyId}". list_brand_archetypes {"group":"daisy"} lists them.`);
        kit = mergeBrandKit(kit, 'colors', { colors: daisyThemeToBrandColors(theme) });
      }
      const errors = validateBrandKit(kit);
      if (errors.length) return fail(`The kit is not valid: ${errors.join('; ')}.`);
      const asDefault = bool(args, 'asDefault') === true || !doc.activeId;
      const next: BrandKitDoc = { kits: [...doc.kits.filter((k) => k.id !== kit.id), kit], activeId: asDefault ? kit.id : doc.activeId };
      const error = await saveDoc(host, next);
      if (error) return fail(error);
      const activate = bool(args, 'activate') !== false;
      if (activate) ctx.commit((current) => ({ ...current, activeBrandKitId: kit.id }), 'Brand kit');
      return done(`Created brand kit "${kit.name}" from ${arch.name}${daisyId ? ` with DaisyUI ${daisyId} colours` : ''}${activate ? '; it is now this project\'s kit' : ''}${asDefault ? ' and the user default' : ''}. Every graphic, text and generation now reads it. Show it with render_brand_board.`, { kit: publicKit(kit), context: brandKitContext(kit) });
    }

    case 'update_brand_kit': {
      const kit = kitOf(host, project, args);
      if (!kit) return noKit(str(args, 'id'));
      const section = str(args, 'section') as BrandKitSection | 'all' | undefined;
      const patch = record(args, 'patch');
      if (!section || (section !== 'all' && !BRAND_KIT_SECTIONS.includes(section))) return fail(`section must be one of ${BRAND_KIT_SECTIONS.join(', ')} or "all".`);
      if (!patch || !Object.keys(patch).length) return fail('patch must be an object with the fields to change.');
      const next = mergeBrandKit(kit, section, patch);
      const errors = validateBrandKit(next);
      if (errors.length) return fail(`That change would make the kit invalid: ${errors.join('; ')}.`);
      const error = await saveDoc(host, { ...doc, kits: doc.kits.map((k) => (k.id === kit.id ? next : k)) });
      if (error) return fail(error);
      return done(`Updated ${section} of "${next.name}".`, { id: next.id, section, value: sectionOf(next, section), kit: brandKitSummary(next) });
    }

    case 'delete_brand_kit': {
      const id = str(args, 'id');
      const kit = findKit(doc, id);
      if (!kit) return noKit(id);
      const error = await saveDoc(host, { kits: doc.kits.filter((k) => k.id !== kit.id), activeId: doc.activeId === kit.id ? null : doc.activeId });
      if (error) return fail(error);
      if (project.activeBrandKitId === kit.id) ctx.commit((current) => ({ ...current, activeBrandKitId: null }), 'Brand kit');
      return done(`Deleted brand kit "${kit.name}".`, { id: kit.id });
    }

    case 'set_active_brand_kit': {
      const scope = str(args, 'scope') ?? 'project';
      const auto = bool(args, 'auto') === true;
      const query = str(args, 'query');
      if (args.id === null && !auto && !query) {
        if (scope !== 'default') ctx.commit((current) => ({ ...current, activeBrandKitId: null }), 'Brand kit');
        if (scope !== 'project') { const error = await saveDoc(host, { ...doc, activeId: null }); if (error) return fail(error); }
        return done(`Cleared the brand kit for ${scope === 'both' ? 'this project and the default' : scope === 'default' ? 'the user default' : 'this project'}.`);
      }
      if (!doc.kits.length) return fail('There are no brand kits yet. create_brand_kit makes one (list_brand_archetypes for the styles).');
      let kit = str(args, 'id') ? findKit(doc, str(args, 'id')) : undefined;
      let reason = '';
      if (!kit && (auto || query || !str(args, 'id'))) {
        const picked = pickBrandKit(doc, query ?? [project.name, ctx.comp?.name].filter(Boolean).join(' '));
        if (picked) { kit = picked.kit; reason = picked.reason; }
      }
      if (!kit) return noKit(str(args, 'id'));
      if (scope !== 'default') ctx.commit((current) => ({ ...current, activeBrandKitId: kit.id }), 'Brand kit');
      if (scope !== 'project') { const error = await saveDoc(host, { ...doc, activeId: kit.id }); if (error) return fail(error); }
      return done(`"${kit.name}" is now the brand kit for ${scope === 'both' ? 'this project and new projects' : scope === 'default' ? 'new projects' : 'this project'}${reason ? ` — chosen as ${reason}` : ''}. Tell the user which kit you are using.`, { id: kit.id, chosenAs: reason || 'named', alternatives: doc.kits.filter((k) => k.id !== kit.id).map((k) => ({ id: k.id, name: k.name, style: k.style, industry: k.industry })), context: brandKitContext(kit) });
    }

    case 'apply_brand_kit': {
      const kit = kitOf(host, project, args);
      if (!kit) return noKit(str(args, 'id'));
      const restyle = bool(args, 'restyle') !== false;
      const theme = brandKitTheme(kit);
      let graphics = 0;
      let texts = 0;
      ctx.commit((current) => ({
        ...current,
        activeBrandKitId: kit.id,
        comps: restyle
          ? current.comps.map((comp) => ({
            ...comp,
            clips: comp.clips.map((clip) => {
              if (clip.source.type === 'html' && (clip.source.html.includes('class="rbx"') || clip.source.html.includes('class="mgc"'))) {
                const html = retintGraphicHtml(clip.source.html, kit);
                if (html !== clip.source.html) graphics++;
                return { ...clip, source: { ...clip.source, html } };
              }
              if (clip.source.type === 'text') {
                texts++;
                return { ...clip, source: { ...clip.source, color: theme.fg } };
              }
              return clip;
            }),
          }))
          : current.comps,
      }), 'AI: apply brand kit');
      return done(`Applied "${kit.name}"${restyle ? `: retinted ${graphics} motion graphic${graphics === 1 ? '' : 's'} and ${texts} text clip${texts === 1 ? '' : 's'}` : ''}. New graphics and text read the kit automatically.`, { id: kit.id, graphics, texts, context: brandKitContext(kit) });
    }

    case 'brand_kit_prompt': {
      const kit = kitOf(host, project, args);
      if (!kit) return noKit(str(args, 'id'));
      const kind = str(args, 'kind') === 'video' ? 'video' : 'image';
      const rules = brandKitPrompt(kit, kind);
      const prompt = str(args, 'prompt');
      const branded = prompt ? brandedPrompt(kit, prompt, str(args, 'negative_prompt'), kind) : null;
      return done(`${kit.name} imagery rules for ${kind}: ${kit.imagery.style}`, { ...rules, ...(branded ? { prompt: branded.prompt, negative_prompt: branded.negative } : {}), note: 'generate_local_media applies these automatically while the kit is active.' });
    }

    case 'render_brand_board': {
      const kit = kitOf(host, project, args);
      if (!kit) return noKit(str(args, 'id'));
      if (!ctx.comp) return fail('No composition to place the board on.');
      const board = brandBoard(kit);
      try {
        const result = createMotionGraphicComp(project, {
          template: 'custom', title: `Brand board — ${kit.name}`, html: board.html, css: board.css, js: '',
          duration: num(args, 'duration') ?? board.seconds, start: num(args, 'start') ?? Math.max(0, playhead.get()), track: str(args, 'track'), asNestedComp: true,
          targetCompId: ctx.comp.id, canvas: { width: 1920, height: 1080 },
        });
        ctx.commit(() => result.project, 'AI: brand board');
        host.setSelection([result.newClipId]);
        return done(`Placed the "${kit.name}" brand board at ${result.start}s for ${result.duration}s (logo, palette, type, gradient, lower third, voice and motion samples). It exports as rendered frames.`, { clipId: result.newClipId, compId: result.mogrtComp?.id, start: result.start, duration: result.duration });
      } catch (error) {
        return fail(errorText(error));
      }
    }

    case 'import_brand_logo': {
      const kit = kitOf(host, project, args);
      if (!kit) return noKit(str(args, 'id'));
      let path = str(args, 'path');
      const role: LogoRole = isRole(args.role) ? args.role : 'primary';
      // A logo straight from a website (extract_brand_from_url): inline SVG markup or an image URL.
      const svgMarkup = str(args, 'svg');
      const url = str(args, 'url');
      if (!path && (svgMarkup || url)) {
        try {
          const dir = await api.storageDir('guidelines');
          const slug = kit.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'brand';
          if (svgMarkup) {
            const clean = sanitizeSvg(svgMarkup);
            if (!clean.includes('<svg')) return fail('svg must be SVG markup.');
            path = `${dir}\\${slug}-${role}-logo.svg`;
            await api.fsWriteFile(path, clean, true);
          } else if (url) {
            const downloaded = await api.mediaDownload(url, 'image', `${slug}-${role}-logo`);
            path = downloaded.path;
          }
        } catch (error) {
          return fail(`Could not fetch the logo: ${errorText(error)}`);
        }
      }
      if (!path) return fail('Give the logo as path (a file), url (an image on the web) or svg (markup).');
      let assets;
      try {
        assets = await host.importMedia([path], ctx.folderFor('Brand'));
      } catch (error) {
        return fail(`Could not import the logo: ${errorText(error)}`);
      }
      const asset = assets[0];
      if (!asset) return fail(`Nothing was imported from ${path}.`);
      const logo: BrandLogo = {
        id: `logo_${Math.random().toString(36).slice(2, 9)}`, role, assetId: asset.id, path: asset.path, svg: null, dataUrl: null,
        clearSpace: num(args, 'clearSpace') ?? 1, minSize: num(args, 'minSize') ?? 64, placement: isCorner(args.placement) ? args.placement : kit.layout.logoBug, on: 'any',
        doNots: ['Do not stretch, rotate or recolour the mark.', 'Do not place it on busy footage without a plate.', `Keep ${num(args, 'clearSpace') ?? 1}× the mark height clear around it.`],
      };
      let embedded = 'not embedded (preview only)';
      try {
        if (/\.svg$/i.test(asset.path)) {
          const text = sanitizeSvg(await assetText(asset.path));
          if (text.includes('<svg')) { logo.svg = text; embedded = 'inline SVG (vector, exports)'; }
        } else {
          logo.dataUrl = await assetDataUrl(asset.path);
          embedded = 'embedded as a data URL (exports)';
        }
      } catch {
        // The file could not be read back through the asset protocol; the path still previews.
      }
      const next: BrandKit = {
        ...kit,
        logos: [...kit.logos.filter((l) => l.role !== role), logo],
        assets: [...kit.assets, { id: `asset_${Math.random().toString(36).slice(2, 9)}`, kind: 'logo', name: asset.name, assetId: asset.id, path: asset.path, tags: [role], notes: '' }],
        updatedAt: new Date().toISOString(),
      };
      const error = await saveDoc(host, { ...doc, kits: doc.kits.map((k) => (k.id === kit.id ? next : k)) });
      if (error) return fail(error);
      return done(`Attached ${asset.name} as the ${role} logo of "${kit.name}" — ${embedded}; it sits in the project's Brand folder.`, { logo: { ...logo, dataUrl: logo.dataUrl ? '[embedded]' : null }, assetId: asset.id });
    }

    case 'export_brand_kit': {
      const kit = kitOf(host, project, args);
      if (!kit) return noKit(str(args, 'id'));
      return done(`Exported "${kit.name}" as JSON (${exportBrandKit(kit).length} characters).`, { id: kit.id, json: exportBrandKit(kit) });
    }

    case 'import_brand_kit': {
      const json = str(args, 'json');
      if (!json) return fail('json is required: the exported kit text.');
      const result = importBrandKit(json);
      if ('error' in result) return fail(`That is not a valid brand kit: ${result.error}`);
      const error = await saveDoc(host, { kits: [...doc.kits.filter((k) => k.id !== result.id), result], activeId: doc.activeId ?? result.id });
      if (error) return fail(error);
      if (bool(args, 'activate') !== false) ctx.commit((current) => ({ ...current, activeBrandKitId: result.id }), 'Brand kit');
      return done(`Imported brand kit "${result.name}".`, { kit: publicKit(result), context: brandKitContext(result) });
    }

    case 'train_brand_kit': {
      // /train (docs/TRAIN-AND-TEMPLATES-PLAN.md Part A): what a reference taught, into the kit.
      const kit = kitOf(host, project, args);
      if (!kit) return noKit(str(args, 'id') ?? str(args, 'query'));
      const source = record(args, 'source');
      const kinds = ['video', 'link', 'image', 'website', 'timeline', 'file'] as const;
      const kind = kinds.find((value) => value === source?.kind);
      const label = typeof source?.label === 'string' ? source.label.trim() : '';
      if (!kind || !label) return fail(`source must be {"kind": ${kinds.map((value) => `"${value}"`).join(' | ')}, "label": "<what the user gave>", "ref"?: "<path or URL>"}.`);
      const raw = Array.isArray(args.learnings) ? (args.learnings as unknown[]) : [];
      const accepted: NewLearning[] = [];
      const rejected: string[] = [];
      for (const [index, entry] of raw.entries()) {
        const item = entry && typeof entry === 'object' ? (entry as Args) : {};
        const area = LEARNING_AREAS.find((value) => value === item.area);
        const text = typeof item.text === 'string' ? item.text.trim() : '';
        const value = item.value && typeof item.value === 'object' && !Array.isArray(item.value)
          ? Object.fromEntries(Object.entries(item.value as Args).filter(([, v]) => typeof v === 'number' || typeof v === 'string' || (Array.isArray(v) && v.every((x) => typeof x === 'string')))) as NewLearning['value']
          : undefined;
        if (!area) rejected.push(`#${index + 1}: area must be one of ${LEARNING_AREAS.join(', ')}`);
        else if (text.length < 8 || text.length > 200) rejected.push(`#${index + 1}: text must be one rule of 8–200 characters`);
        else accepted.push({ area, text, value: value && Object.keys(value).length ? value : undefined });
      }
      // Measured before described: a reference analysed with analyze_reference_video brings its
      // real cut rate and palette, so those never depend on the model's reading.
      const referenceId = str(args, 'referenceId');
      if (referenceId) {
        const film = (await api.refsList().catch(() => [])).find((entry) => entry.id === referenceId);
        if (!film) return fail(`No analysed reference "${referenceId}". analyze_reference_video gives its id.`);
        if (film.cutEvery > 0) accepted.unshift({ area: 'pacing', text: `Cuts about every ${film.cutEvery.toFixed(1)} s (measured over ${film.cuts.length} cuts)`, value: { cutEvery: Math.round(film.cutEvery * 100) / 100 }, confidence: 0.7 });
        if (film.palette.length) accepted.unshift({ area: 'color', text: `Palette measured from the footage: ${film.palette.slice(0, 6).join(', ')}`, value: { palette: film.palette.slice(0, 6) }, confidence: 0.7 });
      }
      if (!accepted.length) return fail(`Nothing to learn: ${rejected.join('; ') || 'send learnings [{area, text, value?}]'}.`);
      const trained = addLearnings(kit, { kind, label, ref: typeof source?.ref === 'string' ? source.ref : referenceId }, accepted);
      const error = await saveDoc(host, { ...doc, kits: doc.kits.map((k) => (k.id === kit.id ? trained.kit : k)) });
      if (error) return fail(error);
      const taught = (trained.kit.learnings ?? []).filter((learning) => learning.sourceIds.includes(trained.sourceId));
      return done(
        `Trained "${kit.name}" from ${label}: ${trained.added} new, ${trained.strengthened} strengthened (other references agreed), ${trained.replaced} replaced by newer measurements.${rejected.length ? ` Skipped: ${rejected.join('; ')}.` : ''} The user can review them in the chat card and in Settings › Brand kit › Learnings.`,
        { kitId: kit.id, sourceId: trained.sourceId, learnings: taught.map(({ area, text, confidence }) => ({ area, text, confidence })) },
      );
    }

    case 'forget_training': {
      const kit = kitOf(host, project, args);
      if (!kit) return noKit(str(args, 'id'));
      const sourceId = str(args, 'sourceId');
      if (!sourceId || !(kit.sources ?? []).some((source) => source.id === sourceId)) return fail(`"${kit.name}" was not trained on "${sourceId ?? ''}". get_brand_kit {"section": "learnings"} lists its sources.`);
      const error = await saveDoc(host, { ...doc, kits: doc.kits.map((k) => (k.id === kit.id ? forgetSource(k, sourceId) : k)) });
      if (error) return fail(error);
      return done(`Forgot what "${kit.name}" learned from that source.`, { kitId: kit.id, sourceId });
    }

    case 'get_brand_guideline': {
      const kit = kitOf(host, project, args);
      if (!kit) return noKit(str(args, 'id'));
      const g = guidelineOf(kit);
      const part = str(args, 'part') ?? 'summary';
      const moveId = str(args, 'move');
      const aspect = str(args, 'aspect');
      if (moveId) {
        const move = g.moves.find((m) => m.id === moveId);
        if (!move) return fail(`No move "${moveId}". Moves: ${g.moves.map((m) => m.id).join(', ')}.`);
        return done(`${kit.name} — ${move.name}: ${move.frames} frames at ${move.fps} fps. ${move.description}`, { move });
      }
      const layouts = aspect ? g.layouts.filter((l) => l.aspect === aspect) : g.layouts;
      switch (part) {
        case 'summary':
          return done(`${kit.name} guideline (${g.source}). ${g.summary}`, {
            summary: g.summary, source: g.source, color: { ratio: g.color.ratio, stage: g.color.stage, roles: g.color.roles }, typeScale: g.typeScale, motion: g.motion,
            moves: g.moves.map((m) => ({ id: m.id, name: m.name, frames: m.frames, use: m.use, description: m.description })),
            layouts: layouts.map((l) => ({ id: l.id, aspect: l.aspect, use: l.use, zones: l.zones.map((z) => z.role) })),
            recipes: g.recipes.map((r) => ({ id: r.id, name: r.name, template: r.template, moves: r.moves, layout: r.layout, hold: r.hold })),
            howToUse: 'Build beats with the recipe templates (create_motion_scene {"template":"brand-title"|"brand-lower-third"|"brand-stat"|"brand-panel"|"brand-logo-sting"|"brand-end-card"|"brand-transition"}); they render these moves and layouts exactly. Other templates are recoloured, re-typed and re-timed to the brand automatically. Refine with update_brand_kit {"section":"guideline","patch":{…}}: moves, layouts and recipes merge by id.',
          });
        case 'color': return done(`${kit.name} colour usage: ${g.color.ratio}.`, { color: g.color });
        case 'type': return done(`${kit.name} type scale (px at 1080p).`, { typeScale: g.typeScale });
        case 'motion': return done(`${kit.name} motion.`, { motion: g.motion });
        case 'moves': return done(`${g.moves.length} moves, keyed frame by frame.`, { moves: g.moves });
        case 'layouts': return done(`${layouts.length} layouts${aspect ? ` for ${aspect}` : ''}; zones are fractions of the frame (x, y, w, h).`, { layouts });
        case 'recipes': return done(`${g.recipes.length} scene recipes.`, { recipes: g.recipes });
        case 'rules': return done(`${kit.name} dos and donts.`, { dos: g.dos, donts: g.donts, colorRules: g.color.rules, motionPrinciples: g.motion.principles });
        case 'all': return done(`${kit.name} guideline, complete.`, { guideline: { ...g, layouts } });
        default: return fail('part is one of summary, color, type, motion, moves, layouts, recipes, rules, all.');
      }
    }

    case 'extract_brand_from_url': {
      const url = str(args, 'url');
      if (!url || !/^https?:\/\//i.test(url)) return fail('url is required: the product or company website (https://…).');
      let page;
      try {
        page = await api.webPageSource(url);
      } catch (error) {
        return fail(`Could not read ${url}: ${errorText(error)}`);
      }
      const found = brandFromPage(page.url, page.html, page.stylesheets);
      const c = found.colors;
      const light = c.background ? relativeLuminance(c.background) > 0.5 : true;
      const suggestion = {
        brandName: found.name || undefined,
        tagline: found.description.slice(0, 90) || undefined,
        primary: c.primary ?? undefined,
        accent: c.accent ?? undefined,
        background: c.background ?? undefined,
        text: c.text ?? undefined,
        displayFont: found.fonts.display,
        bodyFont: found.fonts.body,
        style: light ? 'bold-startup' : 'tech-gradient',
      };
      return done(
        `Read ${found.name || url}: primary ${c.primary ?? '?'}, accent ${c.accent ?? '?'}, background ${c.background ?? '?'}, text ${c.text ?? '?'}; type ${found.fonts.declared.slice(0, 3).join(', ') || 'not declared'} → ${found.fonts.display}/${found.fonts.body} on this machine; ${found.logos.length} logo candidate${found.logos.length === 1 ? '' : 's'}. ` +
          'Check the candidates (the most-used colour on a site is not always its brand colour), then create_brand_kit with the real values, import_brand_logo {"url"|"svg"} for the logo, and write the guideline for this video with update_brand_kit {"section":"guideline"}.',
        { website: { ...found, logos: found.logos.map((l) => (l.svg ? { ...l, svg: l.svg.length > 6000 ? `${l.svg.slice(0, 6000)}…` : l.svg } : l)) }, createBrandKitArgs: suggestion },
      );
    }

    case 'check_brand_compliance': {
      const kit = kitOf(host, project, args);
      if (!kit) return noKit(str(args, 'id'));
      const comp = ctx.comp;
      if (!comp) return fail('There is no composition to check.');
      const report = complianceReport(project, comp, kit);
      return done(report.issues.length ? `${report.issues.length} off-brand item${report.issues.length === 1 ? '' : 's'} in ${comp.name}: ${report.issues.slice(0, 6).map((i) => `${i.clipId} ${i.problem}`).join('; ')}. Fix with update_motion_scene / apply_brand_kit {"restyle":true}, or rebuild with a brand-* template.` : `Everything in ${comp.name} (${report.checked} graphics) uses ${kit.name}'s colours and fonts.`, report);
    }

    default:
      return fail(`Bhippi has no brand kit tool called ${name}`);
  }
}

// ── brand compliance ─────────────────────────────────────────────────────────

const HEX_RE = /#[0-9a-fA-F]{6}\b/g;
const rgbOf = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const chromatic = (hex: string) => {
  const [r, g, b] = rgbOf(hex).map((c) => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const s = max === min ? 0 : (max - min) / (l > 0.5 ? 2 - max - min : max + min);
  return s > 0.22 && l > 0.08 && l < 0.92;
};

/** Every graphic in a comp (and the comps nested in it) checked against the kit's colours and fonts. */
export function complianceReport(project: Project, comp: Comp, kit: BrandKit) {
  const g = guidelineOf(kit);
  const palette = [...g.color.roles.map((r) => r.hex), ...g.color.stage.gradient, ...kit.colors.tokens.map((t) => t.hex)].filter((h) => /^#[0-9a-f]{6}$/i.test(h));
  const fonts = new Set([kit.typography.display.family, kit.typography.heading.family, kit.typography.body.family, kit.typography.caption.family, kit.typography.mono.family].map((f) => f.toLowerCase()));
  const near = (hex: string) => palette.some((p) => { const a = rgbOf(p); const b = rgbOf(hex); return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 70; });
  // Mixes between two brand colours (gradients, ramps, the brand's white and black) are on brand too.
  const anchors = [...palette, '#ffffff', '#000000'];
  const between = (hex: string) => anchors.some((a) => anchors.some((b) => {
    if (a === b) return false;
    const x = rgbOf(a); const y = rgbOf(b); const c = rgbOf(hex);
    const d = [y[0] - x[0], y[1] - x[1], y[2] - x[2]];
    const len = d[0] * d[0] + d[1] * d[1] + d[2] * d[2] || 1;
    const t = Math.max(0, Math.min(1, ((c[0] - x[0]) * d[0] + (c[1] - x[1]) * d[1] + (c[2] - x[2]) * d[2]) / len));
    return Math.hypot(c[0] - (x[0] + d[0] * t), c[1] - (x[1] + d[1] * t), c[2] - (x[2] + d[2] * t)) < 40;
  }));
  const issues: { clipId: string; comp: string; problem: string }[] = [];
  let checked = 0;
  const seen = new Set<string>();
  const visit = (c: Comp) => {
    if (seen.has(c.id)) return;
    seen.add(c.id);
    // A layered motion comp's scene is in the brand when any of its layer clips carries the brand
    // (the snapshot rides on one of them); an off-brand stack is reported once, not per layer.
    const stackOf = (clip: Comp['clips'][number]) => (clip.source.type === 'motion' ? clip.source.scene.stack?.id : undefined);
    const brandedStacks = new Set(c.clips.filter((clip) => clip.source.type === 'motion' && clip.source.scene.brand).map(stackOf).filter(Boolean));
    const reportedStacks = new Set<string>();
    for (const clip of c.clips) {
      const source = clip.source as { type: string } & Record<string, unknown>;
      if (source.type === 'comp' && typeof source.compId === 'string') {
        const inner = project.comps.find((x) => x.id === source.compId);
        if (inner) visit(inner);
        continue;
      }
      if (source.type !== 'motion' && source.type !== 'html' && source.type !== 'text') continue;
      checked++;
      const scene = source.type === 'motion' ? (source.scene as { brand?: unknown }) : null;
      const text = JSON.stringify(source.type === 'motion' ? { ...scene, brand: undefined } : source.type === 'html' ? { html: source.html, css: source.css } : { color: source.color });
      const off = [...new Set((text.match(HEX_RE) ?? []).map((h) => h.toLowerCase()))].filter((h) => chromatic(h) && !near(h) && !between(h));
      if (off.length) issues.push({ clipId: clip.id, comp: c.name, problem: `uses colours outside the brand: ${off.slice(0, 5).join(', ')}` });
      const fontHits = [...text.matchAll(/"font"\s*:\s*"([^"]+)"|font-family\s*:\s*([^;"}]+)/g)].map((m) => (m[1] ?? m[2]).split(',')[0].replace(/[\\"']/g, '').trim()).filter(Boolean);
      const offFonts = [...new Set(fontHits.filter((f) => !fonts.has(f.toLowerCase()) && !/^var\(/.test(f) && !/^(inherit|sans-serif|serif|monospace|system-ui)$/i.test(f)))];
      if (offFonts.length) issues.push({ clipId: clip.id, comp: c.name, problem: `uses fonts outside the brand: ${offFonts.slice(0, 4).join(', ')}` });
      const stack = stackOf(clip);
      if (scene && !scene.brand && !(stack && brandedStacks.has(stack)) && !(stack && reportedStacks.has(stack))) {
        if (stack) reportedStacks.add(stack);
        issues.push({ clipId: clip.id, comp: c.name, problem: 'motion scene was not built in the brand (rebuild with update_motion_scene or a brand-* template)' });
      }
    }
  };
  visit(comp);
  return { kit: kit.name, checked, issues };
}
