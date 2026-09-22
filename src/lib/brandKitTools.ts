// Brand kit tools — the copilot's way to read, make, change, apply and show brand kits.
//
// Kits live in Settings (`Settings.brandKits`), the project keeps a pointer (`activeBrandKitId`).
// Reads are allowed in every phase; writes go through the host's settings callbacks so the panel,
// the tools and the system prompt always see the same document.

import type { ToolHost } from './aiTools';
import {
  ARCHETYPES, BRAND_KIT_SECTIONS, DAISY_THEMES, HOUSE_ARCHETYPE, assetDataUrl, assetText, brandBoard, brandKitContext, brandKitPrompt, brandKitSummary, brandKitTheme,
  brandedPrompt, daisyThemeSummary, daisyThemeToBrandColors, emptyBrandKitDoc, exportBrandKit, findArchetype, findDaisyTheme, findKit, importBrandKit, kitFromArchetype,
  mergeBrandKit, pickBrandKit, resolveActiveKit, retintGraphicHtml, validateBrandKit,
  type BrandKit, type BrandKitDoc, type BrandKitSection, type BrandLogo, type Corner, type LogoRole,
} from './brandKit';
import type { NewBrandKitInput } from './brandKit/build';
import { errorText } from './ipc';
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
]);

const fail = (error: string): ToolResult => ({ ok: false, error });
const done = (summary: string, data: Record<string, unknown> = {}): ToolResult => ({ ok: true, summary, ...data });
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
      return done(`Updated ${section} of "${next.name}".`, { id: next.id, section, value: sectionOf(next, section), summary: brandKitSummary(next) });
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
      const path = str(args, 'path');
      if (!path) return fail('path is required: the logo file (svg, png, webp, jpg).');
      const role: LogoRole = isRole(args.role) ? args.role : 'primary';
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

    default:
      return fail(`Helios has no brand kit tool called ${name}`);
  }
}
