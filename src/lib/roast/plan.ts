// AI tools for planning and assembling a roast edit (docs/FUNNY-MODE-PLAN.md §3.2 steps 2, 5–7):
// save_beat_sheet, roast_move, validate_roast_edl, apply_roast_edl and edit_dna. Catalogue
// entries are in specs/plan.json. Like the other tool modules (motionTools.ts) the handlers call
// library functions and commit once; every edit is one undo step.

import { AUDIENCE_HINT, audienceArg, audienceLabel, compAudience, detectAudience, memeAudienceErrors, type AudienceSetting } from './audience';
import { memesApi } from './memes';
import { clipEnd, type AssetMap } from '../timeline';
import type { Comp, ToolResult } from '../types';
import { beatCounts, normalizeBeatSheet, type Word } from './beatSheet';
import { compareDna, deadZones, timelineDna } from './dna';
import { applyEdl, normalizeEvents, validateEdl, type ApplyOptions } from './edl';
import { prepareRoastCardImages } from './cards';
import { titleCardParams } from './moves';
import { measureFileDna } from './receipts';
import { resolveSfxCues } from './sfx';
import { FUNNY_BAND, type DnaFinding, type EdlReport, type RoastEdl, type RoastToolContext } from './types';

type Args = Record<string, unknown>;

export const PLAN_TOOLS = new Set(['save_beat_sheet', 'roast_move', 'validate_roast_edl', 'apply_roast_edl', 'edit_dna']);
/** The ones that only read (allowed in any production phase). */
export const PLAN_READ_TOOLS = new Set(['validate_roast_edl', 'edit_dna']);

const fail = (error: string, data: Record<string, unknown> = {}): ToolResult => ({ ok: false, error, ...data });
const done = (summary: string, data: Record<string, unknown> = {}): ToolResult => ({ ok: true, ...data, summary });
const str = (args: Args, key: string) => (typeof args[key] === 'string' && (args[key] as string).trim() ? (args[key] as string).trim() : undefined);
const numbers = (value: unknown): number[] | undefined => (Array.isArray(value) ? value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item)).sort((a, b) => a - b) : undefined);
const round = (value: number, places = 2) => Math.round(value * 10 ** places) / 10 ** places;
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, '0')}`;

function wordsOf(value: unknown): Word[] {
  if (!Array.isArray(value)) return [];
  return value.filter((word): word is Word => !!word && typeof word === 'object' && typeof (word as Word).text === 'string' && Number.isFinite((word as Word).start) && Number.isFinite((word as Word).end));
}

/**
 * The beat grid in timeline seconds: `beats` / `downbeats` passed in, or the plan's analysed
 * music (analyze_music_beats) mapped through its clip on this comp, as snap_cuts_to_beats does.
 */
export function beatGrid(comp: Comp, args: Args): Pick<ApplyOptions, 'beats' | 'downbeats'> {
  const beats = numbers(args.beats);
  const downbeats = numbers(args.downbeats);
  if (beats?.length || downbeats?.length) return { beats, downbeats };
  const music = comp.production?.music;
  const clip = music?.assetId ? comp.clips.find((item) => item.enabled && item.source.type === 'media' && item.source.assetId === music.assetId) : undefined;
  if (!music?.beats?.length || !clip) return {};
  const mapped = music.beats.map((beat) => clip.start + (beat - clip.in) / clip.speed).filter((time) => time >= clip.start - 1e-6 && time <= clipEnd(clip) + 1e-6);
  // analyze_music_beats marks every fourth beat a downbeat.
  return { beats: mapped, downbeats: mapped.filter((_, index) => index % 4 === 0) };
}

function describeReport(report: EdlReport): string {
  const lines: string[] = [];
  if (report.errors.length) lines.push(`Errors (${report.errors.length}):\n- ${report.errors.slice(0, 12).join('\n- ')}`);
  if (report.warnings.length) lines.push(`Warnings (${report.warnings.length}):\n- ${report.warnings.slice(0, 12).join('\n- ')}`);
  const dna = report.dna;
  lines.push(`Edit DNA: ${dna.cuts} cuts (${dna.cutsPerMinute.join(' / ')} a minute), median shot ${round(dna.medianShot)} s, longest static ${round(dna.longestStatic.seconds, 1)} s at ${clock(dna.longestStatic.start)}, events ${dna.eventsPerMinute.join(' / ')} a minute, SFX ${dna.sfxPerMinute.join(' / ')} a minute, music under ${Math.round(dna.musicCoverage * 100)} %, ${dna.memes} memes, ${dna.textEvents} text events.`);
  if (report.deadZones.length) lines.push(`Dead zones over ${FUNNY_BAND.maxStaticSeconds} s: ${report.deadZones.map((zone) => `${clock(zone.start)}–${clock(zone.end)}`).join(', ')}.`);
  return lines.join('\n');
}

const describeFindings = (findings: DnaFinding[]) => findings.map((finding) => `[${finding.severity}] ${finding.message}`).join('\n');

/**
 * Card pictures made export-safe before the (synchronous) executor builds the cards: the card
 * module keeps each inlined picture by its path or asset id, so the build finds it. Returns the
 * pictures that could not be read.
 */
async function inlineCardImages(edl: RoastEdl, ctx: RoastToolContext): Promise<string[]> {
  const missing: string[] = [];
  for (const event of edl.events) {
    try {
      if (event.move === 'card' && event.params) missing.push(...(await prepareRoastCardImages(event.template, event.params, ctx.assets)).missing);
      if (event.move === 'title_card' && event.photoAssetId) {
        const photo = ctx.assets.get(event.photoAssetId);
        if (photo) missing.push(...(await prepareRoastCardImages('roast-title-card', titleCardParams(event, photo), ctx.assets)).missing);
      }
    } catch {
      // No canvas (tests, a worker): the card falls back to the file path.
    }
  }
  return missing;
}

/** The EDL the model sent, made whole against the comp's existing plan. */
function edlFrom(comp: Comp, args: Args, ctx: RoastToolContext, replace: boolean): { edl: RoastEdl; errors: string[] } {
  const taken = replace ? [] : (comp.roast?.edl?.events ?? []).map((event) => event.id);
  const { events, errors } = normalizeEvents(args.events, { taken, assets: ctx.assets });
  return { edl: { version: 1, compId: comp.id, style: 'funny', events }, errors };
}

/**
 * Library sounds named only by id ("sfx-vine-boom") are fetched and imported before the
 * synchronous executor runs; returns the asset map it should see and anything that failed.
 */
async function withSounds(edl: RoastEdl, ctx: RoastToolContext): Promise<{ edl: RoastEdl; assets: AssetMap; problems: string[] }> {
  const { events, problems, assets } = await resolveSfxCues(edl.events, ctx);
  if (!assets.length) return { edl: { ...edl, events }, assets: ctx.assets, problems };
  const merged: AssetMap = new Map(ctx.assets);
  for (const asset of assets) merged.set(asset.id, asset);
  return { edl: { ...edl, events }, assets: merged, problems };
}

/** Every meme id a plan places (its events and their provenance). */
function edlMemeIds(edl: RoastEdl): string[] {
  return edl.events.flatMap((event) => [...('memeId' in event && typeof event.memeId === 'string' ? [event.memeId] : []), ...(event.provenance ?? []).flatMap((source) => (source.memeId ? [source.memeId] : []))]);
}

export async function runPlanTool(name: string, args: Args, ctx: RoastToolContext): Promise<ToolResult> {
  const project = ctx.current();
  const comp = ctx.pickComp(project, args);
  if (!comp) return fail('There is no composition to work on.');
  switch (name) {
    case 'save_beat_sheet': {
      const words = wordsOf(args.words);
      const checked = normalizeBeatSheet({ beats: args.beats }, comp.id, words);
      if (!checked.sheet.beats.length) return fail(`No usable beats. ${checked.errors.join(' ')}`.trim(), { errors: checked.errors });
      // Who the video is for, read from what is said (or as the user set it): it decides the memes.
      const asked = audienceArg(args.audience);
      if (asked === 'bad') return fail(AUDIENCE_HINT);
      const reading = detectAudience(checked.sheet.beats.map((beat) => beat.text));
      const kept = comp.roast?.audience?.source === 'user' && asked !== 'auto' ? comp.roast.audience : null;
      const audience: AudienceSetting = asked && asked !== 'auto'
        ? { audience: asked, confidence: 1, signals: ['set by the user'], source: 'user' }
        : kept ?? { ...reading, source: 'detected' };
      ctx.editComp(comp, (current) => ({ ...current, roast: { ...current.roast, beatSheet: checked.sheet, audience } }));
      const counts = beatCounts(checked.sheet);
      const profanity = checked.sheet.beats.flatMap((beat) => (beat.profanity ?? []).map((span) => ({ beatId: beat.id, ...span })));
      const punchlines = checked.sheet.beats.filter((beat) => beat.kinds.includes('punchline'));
      return done(
        `Saved ${checked.sheet.beats.length} beats on "${comp.name}": ${Object.entries(counts).map(([kind, count]) => `${count} ${kind}`).join(', ')}.`
        + `${punchlines.length ? ` Punchlines land at ${punchlines.slice(0, 8).map((beat) => `${round(beat.punchAt ?? beat.end)}s`).join(', ')}${punchlines.length > 8 ? '…' : ''}.` : ''}`
        + `${profanity.length ? ` ${profanity.length} profane word${profanity.length === 1 ? '' : 's'} found (bleep candidates): ${profanity.slice(0, 6).map((span) => `"${span.word}" ${round(span.start)}–${round(span.end)}s`).join(', ')}.` : ''}`
        + `${checked.errors.length ? ` Dropped: ${checked.errors.join(' ')}` : ''}${checked.warnings.length ? ` Notes: ${checked.warnings.slice(0, 6).join(' ')}` : ''}`
        + ` Audience: ${audience.audience === 'global' ? 'global (global memes only, plus local ones that crossed over; English echo words)' : `${audienceLabel(audience.audience)} (their own memes first, global ones welcome; search in their language)`}, ${audience.source === 'user' ? 'as set' : `detected: ${audience.signals.join('; ')}`}. Pass audience "global" or the viewers' country code (IN, US, BR, MX, JP…) to override — set it whenever the speech is plainly one country's.`,
        { beats: checked.sheet.beats.length, counts, profanity, errors: checked.errors, warnings: checked.warnings, audience },
      );
    }

    case 'roast_move': {
      const raw = args.event && typeof args.event === 'object' && !Array.isArray(args.event) ? args.event : null;
      if (!raw) return fail('event is required: a RoastEvent (move, at, duration, why, and the move\'s own fields).');
      const read = edlFrom(comp, { events: [raw] }, ctx, false);
      if (read.errors.length || !read.edl.events.length) return fail(read.errors.join(' ') || 'The event could not be read.');
      const { edl, assets, problems } = await withSounds(read.edl, ctx);
      const missing = await inlineCardImages(edl, ctx);
      const result = applyEdl(comp, ctx.current(), assets, edl, beatGrid(comp, args));
      if (missing.length) result.report.warnings.push(`card pictures not found (they will not export): ${missing.join(', ')}`);
      result.report.warnings.push(...problems);
      if (!result.report.ok) return fail(`The move was not applied.\n${describeReport(result.report)}`, { errors: result.report.errors, warnings: result.report.warnings });
      ctx.editComp(comp, () => result.comp);
      const event = edl.events[0];
      const made = result.applied[0];
      return done(`${event.id} ${event.move} at ${clock(event.at)} for ${round(event.duration)} s: ${made?.clipIds.length ?? 0} clip${made?.clipIds.length === 1 ? '' : 's'}${made?.keys?.length ? ` and keyframes on ${made.keys.length} existing clip propert${made.keys.length === 1 ? 'y' : 'ies'}` : ''}.${result.report.warnings.length ? `\nWarnings:\n- ${result.report.warnings.slice(0, 8).join('\n- ')}` : ''}`, {
        eventId: event.id, clipIds: made?.clipIds ?? [], warnings: result.report.warnings, dna: result.report.dna,
      });
    }

    case 'validate_roast_edl': {
      const replace = args.replace === true;
      const { edl, errors: read } = edlFrom(comp, args, ctx, replace);
      const errors = [...read, ...(await memeAudienceErrors(edlMemeIds(edl), compAudience(comp), memesApi.get))];
      const report = validateEdl(comp, project, ctx.assets, edl, { ...beatGrid(comp, args), replace });
      const all: EdlReport = { ...report, ok: report.ok && !errors.length, errors: [...errors, ...report.errors] };
      const findings = compareDna(all.dna, FUNNY_BAND);
      return done(`${all.ok ? 'The plan is valid' : 'The plan has problems'} (${edl.events.length} events).\n${describeReport(all)}${findings.length ? `\nAgainst the @funny band:\n${describeFindings(findings)}` : ''}`, { report: all, findings });
    }

    case 'apply_roast_edl': {
      const replace = args.replace === true;
      const read = edlFrom(comp, args, ctx, replace);
      const errors = [...read.errors, ...(await memeAudienceErrors(edlMemeIds(read.edl), compAudience(comp), memesApi.get))];
      if (!read.edl.events.length && !replace) return fail(errors.join(' ') || 'events is required.');
      const options = { ...beatGrid(comp, args), replace };
      const { edl, assets, problems } = await withSounds(read.edl, ctx);
      const missing = await inlineCardImages(edl, ctx);
      const result = applyEdl(comp, ctx.current(), assets, edl, options);
      if (missing.length) result.report.warnings.push(`card pictures not found (they will not export): ${missing.join(', ')}`);
      result.report.warnings.push(...problems);
      const report: EdlReport = { ...result.report, ok: result.report.ok && !errors.length, errors: [...errors, ...result.report.errors] };
      if (!report.ok) return fail(`Nothing was applied; fix these and send the plan again (validate_roast_edl checks without applying).\n${describeReport(report)}`, { report });
      ctx.editComp(comp, () => result.comp);
      const clips = result.applied.reduce((sum, entry) => sum + entry.clipIds.length, 0);
      const findings = compareDna(report.dna, FUNNY_BAND);
      return done(`Applied ${result.applied.length} roast events to "${comp.name}" as one step (${clips} clips${replace ? '; the previous plan was taken back first' : ''}).\n${describeReport(report)}${findings.length ? `\nAgainst the @funny band:\n${describeFindings(findings)}` : ''}`, {
        applied: result.applied, report, findings,
      });
    }

    case 'edit_dna': {
      const source = str(args, 'source') ?? (str(args, 'path') ? 'file' : 'timeline');
      if (source === 'file') {
        const path = str(args, 'path');
        if (!path) return fail('path is required to measure a file.');
        try {
          const dna = await measureFileDna(path);
          const findings = compareDna(dna, FUNNY_BAND);
          return done(`Edit DNA of ${path}: ${dna.cuts} cuts over ${round(dna.duration, 1)} s, median shot ${round(dna.medianShot)} s, longest static ${round(dna.longestStatic.seconds, 1)} s, ${dna.audioMeasured === false ? `sound not measured (${dna.notes?.[0] ?? 'no voice/music separation'})` : `SFX ${dna.sfxPerMinute.join(' / ')} a minute, music under ${Math.round(dna.musicCoverage * 100)} %`}${dna.onBeat !== null ? `, ${Math.round(dna.onBeat * 100)} % of cuts on the beat` : ''}${dna.greenShare !== null ? `, ${Math.round(dna.greenShare * 100)} % unkeyed green` : ''}.${findings.length ? `\n${describeFindings(findings)}` : '\nInside the @funny band.'}`, { dna, findings });
        } catch (error) {
          return fail(`The file could not be measured: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (source !== 'timeline') return fail('source must be timeline or file.');
      const grid = beatGrid(comp, args);
      const dna = timelineDna(comp, ctx.assets, { beats: grid.beats, project });
      const zones = deadZones(comp, FUNNY_BAND.maxStaticSeconds, ctx.assets, { project });
      const findings = compareDna(dna, FUNNY_BAND);
      return done(`${describeReport({ ok: true, errors: [], warnings: [], deadZones: zones, dna })}${findings.length ? `\nAgainst the @funny band:\n${describeFindings(findings)}` : '\nInside the @funny band.'}`, { dna, deadZones: zones, findings });
    }

    default:
      return fail(`No plan tool called ${name}`);
  }
}
