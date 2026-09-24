// One door into the @funny tools (docs/FUNNY-MODE-PLAN.md §3): aiTools.ts routes every roast tool
// name here, the way it routes the motion tools to motionTools.ts. Each package keeps its own
// handler; this file only says which one owns a name, which names only read, and keeps the small
// meme cache the Comedian's review needs (councilReview is synchronous, the library lives in Rust).

import type { Comp, ToolResult } from '../types';
import { ALPHA_TOOLS, runAlphaTool } from './alpha';
import { MEME_READ_TOOLS, MEME_TOOLS, memesApi, runMemeTool } from './memes';
import { PLAN_READ_TOOLS, PLAN_TOOLS, runPlanTool } from './plan';
import { RECEIPT_READ_TOOLS, RECEIPT_TOOLS, runReceiptTool } from './receipts';
import { SFX_READ_TOOLS, SFX_TOOLS, runSfxTool } from './sfx';
import type { MemeEntry, RoastToolContext, RoastToolName } from './types';

type Args = Record<string, unknown>;
type Handler = (name: string, args: Args, ctx: RoastToolContext) => Promise<ToolResult>;

const OWNERS: [ReadonlySet<string>, Handler][] = [
  [MEME_TOOLS, runMemeTool],
  [PLAN_TOOLS, runPlanTool],
  [RECEIPT_TOOLS, runReceiptTool],
  [SFX_TOOLS, runSfxTool],
  [ALPHA_TOOLS, runAlphaTool],
];

/** Every roast tool name (the catalogue lists exactly these; tests/roastTools.test.ts checks it). */
export const ROAST_TOOLS: ReadonlySet<string> = new Set(OWNERS.flatMap(([names]) => [...names]));

/** Roast tools that never change the project: allowed in Plan only and in any production phase. */
export const ROAST_READ_TOOLS: ReadonlySet<string> = new Set([
  ...MEME_READ_TOOLS, ...PLAN_READ_TOOLS, ...RECEIPT_READ_TOOLS, ...SFX_READ_TOOLS, 'detect_faces',
]);

/** Roast tools that fetch or make media: planned first, run in the gathering phase. */
export const ROAST_GATHER_TOOLS: ReadonlySet<RoastToolName> = new Set<RoastToolName>(['get_meme_media', 'cutout_image']);

/** Roast tools that plan or look without touching the timeline (allowed before the edit phase). */
export const ROAST_PREPARATION_TOOLS: ReadonlySet<RoastToolName> = new Set<RoastToolName>([
  'search_memes', 'refresh_meme_trends', 'save_meme', 'get_meme_media', 'find_receipt', 'search_sfx',
  'cutout_image', 'detect_faces', 'save_beat_sheet', 'validate_roast_edl', 'edit_dna',
]);

export async function runRoastTool(name: string, args: Args, ctx: RoastToolContext): Promise<ToolResult> {
  const owner = OWNERS.find(([names]) => names.has(name));
  if (!owner) return { ok: false, error: `${name} is not a roast tool.` };
  const result = await owner[1](name, args, ctx);
  rememberMemes(result);
  return result;
}

// ─── The meme cache for the Comedian ──────────────────────────────────────────────────────────

type MemeFacts = Pick<MemeEntry, 'name' | 'verified' | 'firstSeen'>;
const memeFacts = new Map<string, MemeFacts>();

const remember = (entry: unknown) => {
  const e = entry as Partial<MemeEntry> | null;
  if (e && typeof e.id === 'string' && typeof e.name === 'string') memeFacts.set(e.id, { name: e.name, verified: e.verified === true, firstSeen: e.firstSeen });
};

/** Keep what a meme tool just returned (search hits, a saved or fetched entry). */
function rememberMemes(result: ToolResult) {
  if (!result.ok) return;
  const hits = (result as { hits?: unknown }).hits;
  if (Array.isArray(hits)) for (const hit of hits) remember((hit as { entry?: unknown })?.entry ?? hit);
  remember((result as { entry?: unknown }).entry);
}

/** The lookup councilReview takes: what the library said about a meme id, if it has been seen. */
export const memeLookup = (id: string): MemeFacts | undefined => memeFacts.get(id);

/** Every meme id a comp's roast plan places. */
export function memeIdsOf(comp: Comp): string[] {
  const ids = new Set<string>();
  for (const event of comp.roast?.edl?.events ?? []) {
    if ('memeId' in event && typeof event.memeId === 'string') ids.add(event.memeId);
    for (const source of event.provenance ?? []) if (source.memeId) ids.add(source.memeId);
  }
  return [...ids];
}

/**
 * Fetch the library's facts for every meme the plan places, before a review. Search hits carry no
 * first-seen date, so entries seen only through a search are fetched again (a local call).
 */
export async function primeMemeCache(comp: Comp): Promise<void> {
  await Promise.all(memeIdsOf(comp).map(async (id) => {
    try {
      remember(await memesApi.get(id));
    } catch {
      // Unknown to the library: the Comedian reports it as not found.
    }
  }));
}
