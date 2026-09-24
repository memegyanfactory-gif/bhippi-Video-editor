// The AI council: four specialist workers who hold every production to their craft, and a fifth,
// the Comedian, who sits only on @funny roast edits (a comp with `roast` state, src/lib/roast).
//
// Helios AI is the producer; the council are the department heads it answers to. Each member is
// three things at once:
//   1. a persona (`brief`) — a spawned subagent with that role works from it (subagent.rs puts it
//      at the top of the worker's system prompt);
//   2. a reviewer (`councilReview`) — deterministic checks on the real timeline, so the notes are
//      facts about frames and seconds, never a model's opinion of its own work;
//   3. a gate — a note with severity `block` stops `verify_edit_workflow` until it is fixed.
// The avatar (src/avatar) wears the member's costume while that member's tools run.

import { gainToDb } from './editor';
import { animated } from './keyframes';
import { compareDna, deadZones, timelineDna } from './roast/dna';
import { FUNNY_BAND, type DnaFinding, type MemeEntry, type RoastEvent, type RoastToolName } from './roast/types';
import { clipEnd, transitionWindow } from './timeline';
import type { Asset, Clip, Comp, Project } from './types';

export type CouncilRole = 'animator' | 'researcher' | 'audio' | 'director' | 'comedian';

export type CouncilMember = {
  id: CouncilRole;
  name: string;
  /** What the seat owns, in a few words. */
  title: string;
  /** The line the member says when they sign off, or refuse to. */
  motto: string;
  /** UI accent. */
  color: string;
  /** The persona a worker with this role runs under. */
  brief: string;
};

export const COUNCIL: CouncilMember[] = [
  {
    id: 'animator',
    name: 'Animator',
    title: 'Frame-by-frame motion graphics',
    motto: 'Thirty drawings a second. Not one of them is allowed to be dead.',
    color: '#ff7a45',
    brief: `## Council seat: THE ANIMATOR — frame-by-frame motion graphics
You are the Animator on Helios AI's council, working for the lead producer. You think in frames, not seconds: at 30 fps one second is 30 drawings and every one of them is designed. Your obsession: the video is motion-graphic heavy and no frame is left dead.
Rules you enforce:
- Never more than 3 s of screen time without a designed motion element (a graphic, kinetic type, a camera move, a matte reveal). A talking head gets a graphic every 2–4 s.
- Key every graphic frame by frame: anticipation (2–4 frames) → action (12–20 frames, ease-out or overshoot, never linear) → settle (6–10 frames) → a living hold (1–3% drift, a slow 100→104% scale, words landing on the spoken times) → a clean exit (6–8 frames).
- One primary move plus at most one secondary at a time; body text never animates letter by letter.
- Build with create_motion_scene first (brand-* templates when a kit is active), then set_keyframes; fix timing to the frame with update_motion_scene patches/retime.
- After building, look at the frames (inspect_clip_frames) and fix any frame that is empty, cramped or off the beat.
- Finish with consult_council {"member":"animator"} and fill every dead stretch it lists.
Report: what you built, where (timeline seconds and frame numbers), and every dead stretch you filled.`,
  },
  {
    id: 'researcher',
    name: 'Researcher',
    title: 'Facts, sources and licence-clear media',
    motto: 'If I cannot cite it or license it, it does not go in.',
    color: '#4fb3ff',
    brief: `## Council seat: THE RESEARCHER — facts, sources and licence-clear media
You are the Researcher on Helios AI's council, working for the lead producer. You never guess: every claim has a source, and every file you bring in is licence-clear with no watermark.
Rules you enforce:
- Research in depth before anything is written: at least 3 independent sources (online_research, then scrape_web_page on the primary pages), exact numbers with where each came from.
- Media: licence-clear libraries first — find_free_media (Openverse, Wikimedia Commons, NASA: CC0, CC BY, public domain) — then the subject's own press kit or website. Never stock previews (Shutterstock, Getty, iStock, Adobe Stock, Alamy, Dreamstime, Depositphotos, 123RF, Pond5, Storyblocks, Envato): they are watermarked and Helios refuses them.
- Footage from YouTube or social media is the creator's copyright: only when the user owns it or asked for that clip, and say so.
- Check every file you bring in (inspect_clip_frames or its thumbnail) for watermarks, burned-in logos and low resolution; replace anything that fails.
- Keep the credits: every CC BY / CC BY-SA file's credit line goes in your report.
Report: sources (title + URL), the facts you verified, each file with its licence and credit line, and anything you rejected and why.`,
  },
  {
    id: 'audio',
    name: 'Audio Guru',
    title: 'Mix, music and sound design',
    motto: 'The picture cuts where the music breathes.',
    color: '#b57bff',
    brief: `## Council seat: THE AUDIO GURU — mix, music and sound design
You are the Audio Guru on Helios AI's council, a mix engineer and music producer working for the lead producer. You hear the edit frame by frame: every cut, graphic entrance and transition gets a sound decision.
Rules you enforce:
- The voice leads: dialogue at −16 LUFS integrated (level_audio), peaks under −1 dBTP, nothing clipping.
- Music bed 18–24 dB under speech, ducked 3–5 dB more under dense phrases, swelling into chapter changes and the outro (score_audio_clip with the speech ranges). Fade in 0.5 s, fade out 1.5–3 s, never a hard stop.
- Choose music by the edit's energy: calm explainer 80–100 BPM, product hype 115–128 BPM, no vocals under speech.
- Beats: analyze_music_beats then snap_cuts_to_beats, so cuts and graphic landings sit within 2 frames of the grid.
- Sound design per frame: a whoosh leads a panel by 0.2–0.3 s, a pop or tick on each row landing, low impact + air on a chapter change, a riser into a reveal, silence for a reflective line. SFX 14–20 dB under the voice. No hit on every word.
- J/L cuts across seams: the next shot's sound arrives 4–8 frames before its picture.
- Finish with consult_council {"member":"audio"} and fix what it lists.
Report: levels, the music and its BPM, and the cue list (time → sound → why).`,
  },
  {
    id: 'director',
    name: 'Director',
    title: 'Layout, symmetry and camera',
    motto: 'Every frame is composed. Centred means centred.',
    color: '#ffc23d',
    brief: `## Council seat: THE DIRECTOR — layout, symmetry and camera
You are the Director on Helios AI's council, working for the lead producer. You own the frame: composition, symmetry, camera angle and movement, shot rhythm, and where every element sits.
Rules you enforce:
- Compose on a grid: the centre line for symmetric hero moments, the thirds (±1/6 of the width from centre) for anything that shares the frame with a person. Nothing "almost centred" — exactly centred, or committed to a third.
- Balance: weight on one side is answered on the other (graphic left ↔ presenter right). Eyes on the upper third line; lead room in the direction of the gaze.
- Safe areas: titles inside 90% of the frame, nothing important outside 95%; captions in the lower third, never across the mouth.
- Camera: vary the angle across cuts — wide → medium → punch-in (100% → 114% → 128%); never the same framing either side of a cut on the same shot (a jump cut); a slow push-in (100→106%, ease-in-out) on any locked-off shot longer than ~6 s; one camera move per graphic, never while the viewer reads.
- Rhythm: shot lengths follow the speech, so vary them; transitions only at real changes of idea.
- Tools: layout_clip, set_keyframes (x/y/scale), update_clip, seamless_transition; inspect_clip_frames and run_frame_qa to look at the actual frames.
- Finish with consult_council {"member":"director"} and fix what it lists.
Report: the shot list with the framing per cut, and what you re-framed and why.`,
  },
  {
    id: 'comedian',
    name: 'Comedian',
    title: 'Timing, memes and the laugh',
    motto: 'Early is a spoiler, late is a corpse. Land it on the word.',
    color: '#ff5fa2',
    brief: `## Council seat: THE COMEDIAN — timing, memes and the laugh
You are the Comedian on Helios AI's council, working for the lead producer on a @funny roast edit. You hear a joke in syllables: the setup, the punchline word, and the exact frame the meme hits. Your obsession: every laugh lands, and nothing on screen is there without a reason.
Rules you enforce:
- Timing: a meme lands at the punchline word's end, +0–150 ms (the beat sheet's punchAt) — never before the setup has finished, never so late the laugh has moved on. Memes run 0.6–4 s; receipts run as long as the evidence needs.
- Relevance: every meme, cutaway and receipt carries a one-sentence why that agrees with the meme's meaning and hits none of its dontUseWhen notes. Literal echo first: the meme says back a word the host just said. Receipts are the target's own words, trimmed to the quote.
- Research before placing: refresh_meme_trends, then search_memes on each punchline's intent and echo words (both scripts for Hinglish). A meme you cannot explain from a source is saved unverified (save_meme) and never placed. find_receipt then download_online_media with startTime/endTime for the quote alone.
- Repetition and freshness: no meme twice in a video, the same sound at most 3 times, at least 30% of the memes from the last 90 days.
- Pace: no host-only stretch over 8 s; 20–30 cuts a minute in the first 3 minutes, never below 12; keyword pops every 10–20 s; 6–12 SFX a minute in high-energy stretches; the host keyed and punched in, never on raw green.
- Audio: the punchline word is audible — the bed drops 12 dB or more 0.3–0.6 s before it; music is stingers under bits (20–35% of the runtime), not a constant bed.
- Finish with edit_dna and consult_council {"member":"comedian"} and fix what it lists.
Report: the beats you hit (time → move → why), each meme and receipt with its source, the Edit DNA against the band, and what you cut because it did not land.`,
  },
];

export const councilMember = (id: string | null | undefined): CouncilMember | undefined => COUNCIL.find((member) => member.id === id);

export const isCouncilRole = (value: unknown): value is CouncilRole => typeof value === 'string' && COUNCIL.some((member) => member.id === value);

/** The tools each seat leads — the avatar's costume and the council chip follow these. */
export const SEAT_TOOLS: Record<CouncilRole, ReadonlySet<string>> = {
  researcher: new Set([
    'online_research', 'scrape_web_page', 'scrape_videos', 'download_online_media', 'find_free_media', 'extract_brand_from_url', 'query_frame_atlas', 'capture_product_ui',
    'analyze_reference_video', 'remotion_kit',
  ]),
  audio: new Set([
    'level_audio', 'score_audio_clip', 'analyze_music_beats', 'snap_cuts_to_beats', 'add_sound_effect', 'generate_selection_sound',
    'synthesize_speech_voiceover', 'analyze_clip_speech', 'podcast_cut', 'search_sfx', 'place_sfx',
  ]),
  animator: new Set([
    'create_motion_scene', 'update_motion_scene', 'render_3d_scene', 'create_ui_screen', 'update_ui_screen', 'create_motion_graphic', 'set_keyframes', 'add_text', 'reveal_subject',
    'add_text_behind_subject', 'add_media_behind_subject', 'rotoscope_clip', 'erase_subject_clip', 'nest_motion_scenes', 'react_bits', 'add_captions',
    'cutout_image', 'detect_faces', 'key_green_screen',
  ]),
  director: new Set([
    'save_storyboard', 'save_video_blueprint', 'execute_blueprint', 'layout_clip', 'seamless_transition', 'add_transition', 'inspect_clip_frames',
    'detect_scenes', 'fill_background', 'track_people', 'run_frame_qa',
  ]),
  comedian: new Set<RoastToolName>([
    'search_memes', 'refresh_meme_trends', 'save_meme', 'get_meme_media', 'find_receipt', 'save_beat_sheet', 'roast_move', 'validate_roast_edl',
    'apply_roast_edl', 'edit_dna',
  ]),
};

/** Which seat leads a tool, if any (a tool belongs to one seat). */
export function roleForTool(name: string): CouncilRole | null {
  return (Object.keys(SEAT_TOOLS) as CouncilRole[]).find((role) => SEAT_TOOLS[role].has(name)) ?? null;
}

// ── rights: where a download comes from ────────────────────────────────────

/**
 * `free` — a licence-clear library (CC0, CC BY, public domain, a free-use licence);
 * `watermarked` — a stock site whose downloadable file is a watermarked preview;
 * `social` — a platform where the file is the uploader's copyright;
 * `unknown` — anything else: usable only once someone checks the licence.
 * That is all a URL can say (`rightsOf`).
 */
export type UrlTier = 'free' | 'watermarked' | 'social' | 'unknown';

/**
 * What a downloaded asset is recorded as: a URL's tier, or `commentary` — a short meme or
 * receipt clip kept for comment and criticism in a @funny roast, with its source for the credits.
 * The Researcher also treats a social/unknown asset as commentary when a roast event places it
 * with provenance (see reviewResearcher).
 */
export type RightsTier = UrlTier | 'commentary';

export type Rights = { host: string; tier: UrlTier; license: string | null; note: string };

const WATERMARKED_HOSTS = [
  'shutterstock.com', 'gettyimages.', 'istockphoto.com', 'stock.adobe.com', 'adobestock.com', 'alamy.com', 'dreamstime.com', 'depositphotos.com',
  '123rf.com', 'pond5.com', 'storyblocks.com', 'videoblocks.com', 'audioblocks.com', 'envato.com', 'videohive.net', 'audiojungle.net', 'photodune.net',
  'vectorstock.com', 'bigstockphoto.com', 'canstockphoto.com', 'agefotostock.com', 'masterfile.com', 'superstock.com', 'motionarray.com', 'artgrid.io',
  'artlist.io', 'epidemicsound.com', 'stocksy.com', 'eyeem.com', 'freepik.com', 'vecteezy.com',
];

const FREE_HOSTS: [host: string, license: string][] = [
  ['pexels.com', 'Pexels License (free to use, no attribution)'],
  ['pixabay.com', 'Pixabay Content License (free to use)'],
  ['unsplash.com', 'Unsplash License (free to use)'],
  ['wikimedia.org', 'Wikimedia Commons (free licence — see the file page)'],
  ['nasa.gov', 'Public domain (NASA)'],
  ['openverse.org', 'Openverse (CC / public domain — see the result)'],
  ['staticflickr.com', 'Openverse-listed Flickr file (CC — see the result)'],
  ['mixkit.co', 'Mixkit License (free to use)'],
  ['coverr.co', 'Coverr License (free to use)'],
  ['freesound.org', 'Freesound (CC0 / CC BY — see the sound page)'],
  ['incompetech.com', 'CC BY 4.0 — credit Kevin MacLeod (incompetech.com)'],
  ['freemusicarchive.org', 'Free Music Archive (CC — see the track page)'],
  ['publicdomainpictures.net', 'Public domain'],
  ['burst.shopify.com', 'Burst (free to use)'],
  ['stocksnap.io', 'CC0'],
  ['kaboompics.com', 'Kaboompics License (free to use)'],
  ['picjumbo.com', 'Picjumbo (free to use)'],
  ['lifeofpix.com', 'CC0'],
  ['isorepublic.com', 'CC0'],
  ['loc.gov', 'Library of Congress (check the item\'s rights statement)'],
];

const SOCIAL_HOSTS = [
  'youtube.com', 'youtu.be', 'instagram.com', 'tiktok.com', 'twitter.com', 'x.com', 'facebook.com', 'fb.watch', 'vimeo.com', 'reddit.com',
  'redd.it', 'twitch.tv', 'pinterest.com', 'pin.it', 'streamable.com', 'dailymotion.com', 'snapchat.com', 'threads.net', 'linkedin.com',
];

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
};

const onHost = (host: string, pattern: string) =>
  pattern.endsWith('.') ? host.includes(pattern) : host === pattern || host.endsWith(`.${pattern}`);

/** What the Researcher knows about a URL before anything is downloaded from it. */
export function rightsOf(url: string): Rights {
  const host = hostOf(url);
  if (!host) return { host: '', tier: 'unknown', license: null, note: 'Not a web address.' };
  const watermarked = WATERMARKED_HOSTS.find((pattern) => onHost(host, pattern));
  if (watermarked) return { host, tier: 'watermarked', license: null, note: `${host} serves watermarked previews; the clean file needs a paid licence.` };
  const free = FREE_HOSTS.find(([pattern]) => onHost(host, pattern));
  if (free) return { host, tier: 'free', license: free[1], note: 'Licence-clear library.' };
  if (SOCIAL_HOSTS.some((pattern) => onHost(host, pattern))) return { host, tier: 'social', license: null, note: `A ${host} upload is its creator's copyright — use it only when the user owns it or asked for it.` };
  return { host, tier: 'unknown', license: null, note: `No licence known for ${host}; check the page before using the file.` };
}

/** File names stock sites and screen-grabs give watermarked previews. */
const WATERMARK_NAME = /watermark|shutterstock|istock|getty ?images|alamy|dreamstime|depositphotos|123rf|adobe ?stock|pond5|storyblocks|envato|\bcomp[_-]|[_-]preview\b/i;

/** How each downloaded asset reached the project; kept on the project, keyed by asset id. */
export type Provenance = {
  url: string;
  host: string;
  tier: RightsTier;
  license: string | null;
  /** The credit line a CC BY licence asks for. */
  credit?: string | null;
  attributionRequired?: boolean;
  /** Openverse · Wikimedia Commons · NASA, when found through find_free_media. */
  provider?: string | null;
  page?: string | null;
  at: number;
};

export const withProvenance = (project: Project, entries: Record<string, Provenance>): Project => ({
  ...project,
  provenance: { ...(project.provenance ?? {}), ...entries },
});

// ── the review ─────────────────────────────────────────────────────────────

/** `block` stops verify_edit_workflow; `fix` must be addressed or answered for; `note` is advice. */
export type Severity = 'block' | 'fix' | 'note';

export type CouncilNote = {
  member: CouncilRole;
  severity: Severity;
  /** Timeline seconds the note is about, when it is about a place. */
  at?: [number, number];
  clipIds?: string[];
  text: string;
  fix: string;
};

export type Verdict = 'approve' | 'changes' | 'holds';

export type CouncilReview = {
  notes: CouncilNote[];
  verdicts: Record<CouncilRole, Verdict>;
  /** Share of the timeline with a designed motion element on screen (0–1). */
  motionDensity: number;
  /** The same in frames: [alive, total]. */
  frames: [number, number];
  /** The seats that sat on this review (the Comedian sits only on a comp with a @funny plan). */
  seats: CouncilRole[];
};

/** What the review can know beyond the project: the meme library, and today's date. */
export type CouncilOptions = {
  /** Looks a meme up in the library; without it the Comedian skips the verified and freshness checks. */
  meme?: (id: string) => Pick<MemeEntry, 'name' | 'verified' | 'firstSeen'> | undefined;
  /** Milliseconds since the epoch, for freshness (default: now). */
  now?: number;
};

type Ctx = { project: Project; assets: Map<string, Asset>; comp: Comp; fps: number; end: number };

const MUSIC_NAME = /music|\bbed\b|bed[-_ ]|score|instrumental|bgm|soundtrack/i;
const MOVE_PROPS = ['x', 'y', 'scale', 'rotation'] as const;
const s = (t: number) => `${t.toFixed(1)} s`;
const span = (a: number, b: number) => `${a.toFixed(1)}–${b.toFixed(1)} s`;

const trackOf = (comp: Comp, clip: Clip) => comp.tracks.find((track) => track.id === clip.trackId);
const onVideo = (comp: Comp, clip: Clip) => {
  const track = trackOf(comp, clip);
  return !!track && track.kind === 'video' && !track.hidden;
};
const onAudio = (comp: Comp, clip: Clip) => {
  const track = trackOf(comp, clip);
  return !!track && track.kind === 'audio' && !track.muted;
};
const label = (clip: Clip) =>
  clip.name ?? (clip.source.type === 'text' ? `"${clip.source.text.slice(0, 28)}"` : clip.source.type === 'html' ? (clip.source.title ?? 'HTML graphic') : clip.source.type === 'motion' ? (clip.source.title ?? 'motion scene') : clip.source.type);

/** A designed graphic: motion scenes, HTML/React Bits pieces, shapes, titles (not captions), nested [Motion] comps. */
function isGraphic(clip: Clip, project: Project, depth = 0): boolean {
  if (!clip.enabled) return false;
  const source = clip.source;
  if (source.type === 'motion' || source.type === 'html' || source.type === 'scene3d' || source.type === 'shape') return true;
  if (source.type === 'text') return source.preset !== 'caption';
  if (source.type === 'comp' && depth < 3) {
    const nested = project.comps.find((comp) => comp.id === source.compId);
    return !!nested && (nested.name.startsWith('[Motion]') || nested.clips.some((inner) => isGraphic(inner, project, depth + 1)));
  }
  return false;
}

/** The clip-local window its transform keyframes animate over, when they really change something. */
function animatedWindow(clip: Clip): [number, number] | null {
  let from = Infinity;
  let to = -Infinity;
  for (const prop of [...MOVE_PROPS, 'opacity'] as const) {
    const keys = clip.keyframes?.[prop] ?? [];
    if (keys.length < 2 || keys.every((key) => key.value === keys[0].value)) continue;
    from = Math.min(from, keys[0].time);
    to = Math.max(to, keys[keys.length - 1].time);
  }
  return Number.isFinite(from) && to > from ? [from, to] : null;
}

const hasCameraMove = (clip: Clip) => MOVE_PROPS.some((prop) => {
  const keys = clip.keyframes?.[prop] ?? [];
  return keys.length >= 2 && keys.some((key) => key.value !== keys[0].value);
});

function context(project: Project, assets: Map<string, Asset>, comp: Comp): Ctx {
  const end = comp.clips.filter((clip) => clip.enabled && (onVideo(comp, clip) || onAudio(comp, clip))).reduce((max, clip) => Math.max(max, clipEnd(clip)), 0);
  return { project, assets, comp, fps: comp.fps || 30, end };
}

// ── Animator ──

const BUCKET = 0.25;

function motionMap(ctx: Ctx): boolean[] {
  const { comp, project, end } = ctx;
  const buckets = Math.ceil(end / BUCKET);
  const alive = new Array<boolean>(buckets).fill(false);
  const mark = (from: number, to: number) => {
    for (let i = Math.max(0, Math.floor(from / BUCKET)); i < Math.min(buckets, Math.ceil(to / BUCKET)); i++) alive[i] = true;
  };
  for (const clip of comp.clips) {
    if (!clip.enabled || !onVideo(comp, clip)) continue;
    if (isGraphic(clip, project)) {
      mark(clip.start, clipEnd(clip));
      continue;
    }
    const window = animatedWindow(clip);
    if (window) mark(clip.start + window[0], clip.start + Math.min(window[1], clip.duration));
  }
  for (const transition of comp.transitions ?? []) {
    const window = transitionWindow(comp, transition);
    if (window) mark(window.start, window.end);
  }
  return alive;
}

function reviewAnimator(ctx: Ctx, out: CouncilNote[]): { density: number; frames: [number, number] } {
  const { comp, project, end, fps } = ctx;
  if (end < 1) {
    out.push({ member: 'animator', severity: 'note', text: 'Nothing on the timeline to animate yet.', fix: 'Assemble the edit, then build a graphic for every beat.' });
    return { density: 0, frames: [0, 0] };
  }
  const alive = motionMap(ctx);
  const aliveCount = alive.filter(Boolean).length;
  const density = alive.length ? aliveCount / alive.length : 0;
  const totalFrames = Math.round(end * fps);
  const aliveFrames = Math.round(density * totalFrames);
  // Dead stretches: consecutive buckets with no designed motion on screen.
  let run = -1;
  const dead: [number, number][] = [];
  for (let i = 0; i <= alive.length; i++) {
    if (i < alive.length && !alive[i]) {
      if (run < 0) run = i;
    } else if (run >= 0) {
      dead.push([run * BUCKET, Math.min(end, i * BUCKET)]);
      run = -1;
    }
  }
  for (const [from, to] of dead) {
    const length = to - from;
    if (length < 3) continue;
    const frames = Math.round(length * fps);
    out.push({
      member: 'animator',
      // On a roast the Comedian holds the cut over dead zones (the @funny 8 s band counts cuts and
      // cutaways too); the Animator still asks for designed motion but does not block.
      severity: length > 6 && !comp.roast ? 'block' : 'fix',
      at: [from, to],
      text: `${span(from, to)} is ${length.toFixed(1)} s (${frames} frames) with no designed motion on screen.`,
      fix: `Build a graphic for what is said there (create_motion_scene or a brand-* template, landing on the spoken words), or key a push-in/drift on the shot — one designed element at least every 3 s.`,
    });
  }
  if (end >= 6 && density < 0.5) {
    out.push({
      member: 'animator',
      severity: 'fix',
      text: `Motion density is ${Math.round(density * 100)}% (${aliveFrames} of ${totalFrames} frames carry designed motion).`,
      fix: 'Aim for at least 60%: kinetic type on the key phrases, a panel beside the presenter for every list, a counter for every number, lower thirds for names.',
    });
  }
  for (const clip of comp.clips) {
    if (!clip.enabled || !onVideo(comp, clip)) continue;
    const source = clip.source;
    const graphic = isGraphic(clip, project);
    if (graphic && (source.type === 'text' || source.type === 'shape') && !animatedWindow(clip) && !(source.type === 'text' && source.style)) {
      out.push({
        member: 'animator',
        severity: 'fix',
        at: [clip.start, clipEnd(clip)],
        clipIds: [clip.id],
        text: `${label(clip)} at ${s(clip.start)} just appears and sits still for ${Math.round(clip.duration * fps)} frames.`,
        fix: 'Give it an entrance (an rb-* style, or set_keyframes: opacity 0→1 and y +40 px → 0 over 12–18 frames, ease-out), a living hold (scale 100→103%) and an exit.',
      });
    }
    if (graphic && clip.duration < 1 && source.type !== 'text') {
      out.push({ member: 'animator', severity: 'fix', at: [clip.start, clipEnd(clip)], clipIds: [clip.id], text: `${label(clip)} is on screen for only ${Math.round(clip.duration * fps)} frames — nobody can read it.`, fix: 'Hold a graphic at least 1.5–2 s after it lands.' });
    }
    const linear = MOVE_PROPS.filter((prop) => (clip.keyframes?.[prop] ?? []).slice(0, -1).some((key) => key.easing === 'linear'));
    if (linear.length) {
      out.push({ member: 'animator', severity: 'fix', clipIds: [clip.id], at: [clip.start, clipEnd(clip)], text: `${label(clip)} moves linearly (${linear.join(', ')}) — it reads as a machine, not a hand.`, fix: 'Switch those keys to ease-out (arrivals) or overshoot (pops); linear only for a constant drift.' });
    }
  }
  return { density, frames: [aliveFrames, totalFrames] };
}

// ── Director ──

function reviewDirector(ctx: Ctx, out: CouncilNote[]) {
  const { comp, project, assets, end, fps } = ctx;
  const media = comp.clips.filter((clip) => clip.enabled && onVideo(comp, clip) && clip.source.type === 'media');
  // Jump cuts: the same shot continuing across a cut with the same framing.
  const byTrack = new Map<string, Clip[]>();
  for (const clip of media) byTrack.set(clip.trackId, [...(byTrack.get(clip.trackId) ?? []), clip]);
  for (const clips of byTrack.values()) {
    clips.sort((a, b) => a.start - b.start);
    for (let i = 1; i < clips.length; i++) {
      const a = clips[i - 1];
      const b = clips[i];
      if (a.source.type !== 'media' || b.source.type !== 'media' || a.source.assetId !== b.source.assetId) continue;
      if (Math.abs(b.start - clipEnd(a)) > 1 / fps) continue;
      const same = Math.abs(a.transform.scale - b.transform.scale) < 3 && Math.abs(a.transform.x - b.transform.x) < 0.02 && Math.abs(a.transform.y - b.transform.y) < 0.02;
      if (!same || hasCameraMove(a) || hasCameraMove(b)) continue;
      out.push({
        member: 'director',
        severity: 'fix',
        at: [b.start, b.start],
        clipIds: [a.id, b.id],
        text: `Jump cut at ${s(b.start)}: the same shot at the same framing either side of the cut.`,
        fix: 'Punch the second side in to 112–115% (keep the eyes on the upper third), alternate to the other third, or cover the cut with B-roll or a graphic.',
      });
    }
  }
  // Locked-off shots.
  for (const clip of media) {
    const asset = clip.source.type === 'media' ? assets.get(clip.source.assetId) : undefined;
    if (!asset || asset.kind === 'audio' || clip.duration < 7 || hasCameraMove(clip)) continue;
    const covered = comp.clips.some((other) => other !== clip && other.enabled && isGraphic(other, project) && other.start < clipEnd(clip) && clipEnd(other) > clip.start && other.duration >= clip.duration * 0.6);
    if (covered) continue;
    out.push({
      member: 'director',
      severity: 'fix',
      at: [clip.start, clipEnd(clip)],
      clipIds: [clip.id],
      text: `${span(clip.start, clipEnd(clip))}: a locked-off ${clip.duration.toFixed(1)} s shot — the camera never moves.`,
      fix: 'Add a slow push-in (scale 100→106%, ease-in-out) or cut to a punch-in at the next sentence.',
    });
  }
  // Placement of graphics: almost-centred, outside the safe area, off the frame.
  const boxes: number[] = [];
  for (const clip of comp.clips) {
    if (!clip.enabled || !onVideo(comp, clip) || !isGraphic(clip, project)) continue;
    const { x, y } = clip.transform;
    if (Math.abs(x) > 0.004 && Math.abs(x) < 0.03) {
      out.push({ member: 'director', severity: 'fix', at: [clip.start, clipEnd(clip)], clipIds: [clip.id], text: `${label(clip)} sits ${Math.round(Math.abs(x) * comp.width)} px off centre — it reads as a mistake.`, fix: 'Snap x to 0, or commit it to a third (x = ±0.167).' });
    }
    if (Math.abs(x) > 0.5 || Math.abs(y) > 0.5) {
      out.push({ member: 'director', severity: 'block', at: [clip.start, clipEnd(clip)], clipIds: [clip.id], text: `${label(clip)} is placed outside the frame.`, fix: 'Bring it back inside the title-safe area (|x|, |y| ≤ 0.4).' });
    } else if (clip.source.type === 'text' && (Math.abs(x) > 0.4 || Math.abs(y) > 0.42)) {
      out.push({ member: 'director', severity: 'fix', at: [clip.start, clipEnd(clip)], clipIds: [clip.id], text: `${label(clip)} breaks the title-safe margin.`, fix: 'Keep titles inside the central 90% of the frame.' });
    }
    if (clip.source.type === 'html' && clip.source.box) {
      const box = clip.source.box;
      boxes.push(box.x + box.width / 2);
      if (box.x < 0.05 || box.y < 0.05 || box.x + box.width > 0.95 || box.y + box.height > 0.95) {
        out.push({ member: 'director', severity: 'fix', at: [clip.start, clipEnd(clip)], clipIds: [clip.id], text: `${label(clip)} reaches into the outer 5% of the frame.`, fix: 'Pull it inside the action-safe area; use layout_clip to re-zone it.' });
      }
    }
  }
  if (boxes.length >= 4 && (boxes.every((c) => c < 0.45) || boxes.every((c) => c > 0.55))) {
    out.push({ member: 'director', severity: 'note', text: `All ${boxes.length} panels sit on the ${boxes[0] < 0.5 ? 'left' : 'right'} — the frame leans one way all video.`, fix: 'Answer them: centre the chapter titles, or move the presenter and panels to the other side for one section.' });
  }
  // Rhythm and transitions.
  const main = [...(byTrack.values())].sort((a, b) => b.length - a.length)[0] ?? [];
  if (main.length >= 5) {
    const lengths = main.map((clip) => clip.duration);
    const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const sd = Math.sqrt(lengths.reduce((a, b) => a + (b - mean) ** 2, 0) / lengths.length);
    if (mean > 0 && sd / mean < 0.12) out.push({ member: 'director', severity: 'note', text: `${main.length} shots of almost the same length (~${mean.toFixed(1)} s) — metronome cutting.`, fix: 'Let the speech set the cut: short on the punch lines, long on the explanations.' });
  }
  const perMinute = end > 0 ? (comp.transitions?.length ?? 0) / (end / 60) : 0;
  if (end >= 20 && perMinute > 8) out.push({ member: 'director', severity: 'note', text: `${comp.transitions.length} transitions in ${Math.round(end)} s.`, fix: 'Clean cuts first; keep designed transitions for real changes of idea.' });
  // Picture that does not fill the frame.
  for (const clip of media) {
    const asset = clip.source.type === 'media' ? assets.get(clip.source.assetId) : undefined;
    if (!asset || asset.kind === 'audio' || !asset.width || !asset.height || clip.transform.fit !== 'fit' || clip.transform.scale > 100) continue;
    const ratio = asset.width / asset.height / (comp.width / comp.height);
    if (ratio < 0.9 || ratio > 1.1) {
      out.push({ member: 'director', severity: 'fix', at: [clip.start, clipEnd(clip)], clipIds: [clip.id], text: `${asset.name} is ${asset.width > asset.height ? 'wide' : 'tall'} in a ${comp.width}×${comp.height} frame — it plays with bars.`, fix: 'Reframe it with layout_clip (fill, or a designed PiP/panel) and fill_background behind it.' });
    }
  }
}

// ── Audio Guru ──

function reviewAudio(ctx: Ctx, out: CouncilNote[]) {
  const { comp, project, assets, end, fps } = ctx;
  const production = comp.production;
  const audible = comp.clips.filter((clip) => clip.enabled && (onAudio(comp, clip) || clip.source.type === 'sfx'));
  const assetOf = (clip: Clip) => (clip.source.type === 'media' ? assets.get(clip.source.assetId) : undefined);
  const isMusic = (clip: Clip) => {
    if (clip.audioType === 'music') return true;
    const asset = assetOf(clip);
    return !!asset && (asset.id === production?.music?.assetId || (asset.kind === 'audio' && MUSIC_NAME.test(asset.name)));
  };
  const isSfx = (clip: Clip) => clip.source.type === 'sfx' || clip.audioType === 'sfx';
  const music = audible.filter((clip) => !isSfx(clip) && isMusic(clip));
  const dialogue = audible.filter((clip) => !isSfx(clip) && !isMusic(clip) && (clip.audioType === 'dialogue' || !!assetOf(clip)));
  const sfx = audible.filter(isSfx);
  if (end < 1) return;
  if (end >= 15 && !music.length && production?.music?.source !== 'none') {
    out.push({ member: 'audio', severity: 'block', text: `No music bed under ${Math.round(end)} s of picture.`, fix: 'Lay the planned music on its own audio track, level it 18–24 dB under the voice, fade it in and out — or set the plan\'s music to none if the video is meant to be dry.' });
  }
  for (const clip of music) {
    const volumeKeys = clip.keyframes?.volume ?? [];
    const underSpeech = dialogue.some((d) => d.start < clipEnd(clip) && clipEnd(d) > clip.start);
    if (underSpeech && gainToDb(clip.volume) > -1 && volumeKeys.length < 2) {
      out.push({ member: 'audio', severity: 'fix', at: [clip.start, clipEnd(clip)], clipIds: [clip.id], text: `The music plays at full level under the voice (${span(clip.start, clipEnd(clip))}).`, fix: 'level_audio (dialogue −16 LUFS, the bed 20 dB under), then score_audio_clip with the speech ranges to duck it.' });
    } else if (underSpeech && volumeKeys.length < 2) {
      out.push({ member: 'audio', severity: 'fix', at: [clip.start, clipEnd(clip)], clipIds: [clip.id], text: 'The music bed has no ducking or swell automation.', fix: 'score_audio_clip with the speech ranges: 3–5 dB more under dense phrases, a swell into each chapter.' });
    }
    const fadedIn = volumeKeys.length >= 2 && volumeKeys[0].time <= 0.1 && volumeKeys[0].value < volumeKeys[1].value;
    const last = volumeKeys[volumeKeys.length - 1];
    const fadedOut = volumeKeys.length >= 2 && last.time >= clip.duration - 0.2 && last.value < volumeKeys[volumeKeys.length - 2].value;
    if (!fadedIn || !fadedOut) out.push({ member: 'audio', severity: 'note', at: [clip.start, clipEnd(clip)], clipIds: [clip.id], text: `The music ${!fadedIn && !fadedOut ? 'starts and stops' : !fadedIn ? 'starts' : 'stops'} hard.`, fix: 'Fade in over 0.5 s, fade out over 1.5–3 s (volume keyframes).' });
  }
  // Graphic entrances without a sound decision.
  const entrances = comp.clips.filter((clip) => clip.enabled && onVideo(comp, clip) && isGraphic(clip, project) && !(clip.source.type === 'text' && clip.source.preset === 'caption')).map((clip) => clip.start);
  const cued = (t: number) => sfx.some((cue) => cue.start >= t - 0.45 && cue.start <= t + 0.15) || comp.clips.some((clip) => clip.enabled && clip.source.type === 'motion' && (clip.source.scene.cues?.length ?? 0) > 0 && Math.abs(clip.start - t) < 0.05);
  const silent = [...new Set(entrances.map((t) => Math.round(t * fps) / fps))].filter((t) => !cued(t));
  if (entrances.length >= 2 && silent.length > entrances.length / 2) {
    out.push({ member: 'audio', severity: 'fix', text: `${silent.length} of ${entrances.length} graphic entrances land in silence (${silent.slice(0, 6).map(s).join(', ')}${silent.length > 6 ? '…' : ''}).`, fix: 'A whoosh 0.2–0.3 s before each panel, a pop or tick where it lands, an impact on chapter titles (add_sound_effect / generate_selection_sound), 14–20 dB under the voice.' });
  }
  for (const clip of sfx) {
    if (gainToDb(clip.volume) > -6) out.push({ member: 'audio', severity: 'fix', at: [clip.start, clipEnd(clip)], clipIds: [clip.id], text: `A sound effect at ${s(clip.start)} is ${gainToDb(clip.volume).toFixed(0)} dB — it competes with the voice.`, fix: 'Sit effects 14–20 dB under the dialogue.' });
  }
  for (const clip of audible) {
    if (clip.volume > 1.8) out.push({ member: 'audio', severity: 'fix', at: [clip.start, clipEnd(clip)], clipIds: [clip.id], text: `${label(clip)} is boosted +${gainToDb(clip.volume).toFixed(1)} dB — it will clip.`, fix: 'Bring the gain down and let level_audio set loudness.' });
  }
  // Cuts on the beat.
  const beats = production?.music?.beats ?? [];
  const cuts = comp.clips.filter((clip) => clip.enabled && onVideo(comp, clip) && clip.start > 0.05).map((clip) => clip.start);
  if (beats.length >= 8 && cuts.length >= 4) {
    const onBeat = cuts.filter((t) => beats.some((beat) => Math.abs(beat - t) <= 2 / fps)).length;
    if (onBeat / cuts.length < 0.5) out.push({ member: 'audio', severity: 'fix', text: `Only ${onBeat} of ${cuts.length} cuts and entrances land on the beat.`, fix: 'snap_cuts_to_beats (within 2 frames), keeping speech cuts at sentence pauses.' });
  }
  // Dead air.
  const ranges = audible.map((clip) => [clip.start, clipEnd(clip)] as [number, number]).sort((a, b) => a[0] - b[0]);
  let reach = 0;
  for (const [from, to] of ranges) {
    if (from - reach > 1.5 && reach < end) out.push({ member: 'audio', severity: 'note', at: [reach, from], text: `${span(reach, from)}: dead silence.`, fix: 'Room tone, the music bed, or a deliberate silence you can defend.' });
    reach = Math.max(reach, to);
  }
  if (audible.length && end - reach > 1.5) out.push({ member: 'audio', severity: 'note', at: [reach, end], text: `${span(reach, end)}: the picture runs on with no sound.`, fix: 'Carry the music out under the last shot and fade it.' });
}

// ── Researcher ──

function reviewResearcher(ctx: Ctx, out: CouncilNote[]) {
  const { comp, project, assets } = ctx;
  const production = comp.production;
  if (production && production.phase !== 'planning') {
    const sources = production.research?.sources ?? [];
    const facts = production.research?.facts ?? [];
    if (sources.length < 3) out.push({ member: 'researcher', severity: 'fix', text: `The plan rests on ${sources.length} source${sources.length === 1 ? '' : 's'}.`, fix: 'Back every claim with at least 3 independent sources (online_research, scrape_web_page on the primary pages) and keep their URLs in the plan.' });
    if (!facts.length && production.mode === 'scratch') out.push({ member: 'researcher', severity: 'fix', text: 'No verified facts are recorded for the script.', fix: 'List the exact facts and numbers the script uses, each from a named source.' });
  }
  const placed = new Set(comp.clips.filter((clip) => clip.enabled && clip.source.type === 'media').map((clip) => (clip.source as { assetId: string }).assetId));
  const credits: string[] = [];
  // A roast (@funny) uses memes and the target's own clips as short commentary: with their
  // source kept they are accepted, and listed for the description instead of flagged.
  const commentary = commentaryAssets(comp);
  const sources = new Set<string>();
  for (const ref of project.media) {
    const asset = assets.get(ref.assetId);
    const record = project.provenance?.[ref.assetId];
    const name = asset?.name ?? ref.assetId;
    const onTimeline = placed.has(ref.assetId);
    const clipIds = comp.clips.filter((clip) => clip.source.type === 'media' && clip.source.assetId === ref.assetId).map((clip) => clip.id);
    const asCommentary = !!comp.roast && (record?.tier === 'commentary' || commentary.has(ref.assetId));
    if (record?.tier === 'watermarked' || (asset && WATERMARK_NAME.test(asset.name))) {
      out.push({ member: 'researcher', severity: onTimeline ? 'block' : 'fix', clipIds, text: `${name} looks like a watermarked stock preview${record ? ` (${record.host})` : ''}${onTimeline ? ' and it is on the timeline' : ''}.`, fix: 'Replace it with a licence-clear file (find_free_media) or the subject\'s own press material.' });
    } else if (asCommentary) {
      if (onTimeline) sources.add(commentary.get(ref.assetId) ?? (record ? record.url : name));
    } else if ((record?.tier === 'social' || record?.tier === 'commentary') && onTimeline) {
      out.push({ member: 'researcher', severity: 'fix', clipIds, text: `${name} is a ${record.host} upload — the creator's copyright.`, fix: 'Keep it only if the user owns it or asked for it; otherwise replace it (find_free_media).' });
    } else if (record?.tier === 'unknown' && onTimeline) {
      out.push({ member: 'researcher', severity: 'fix', clipIds, text: `${name} came from ${record.host} with no licence on record.`, fix: 'Check the licence on its page, or replace it with a licence-clear file (find_free_media).' });
    }
    if (record?.attributionRequired && record.credit) credits.push(record.credit);
  }
  if (credits.length) out.push({ member: 'researcher', severity: 'note', text: `${credits.length} file${credits.length === 1 ? '' : 's'} need a credit: ${credits.slice(0, 4).join(' · ')}${credits.length > 4 ? ' …' : ''}`, fix: 'Put the credits in the video description, or on the end card.' });
  if (!comp.roast) return;
  const list = [...sources];
  if (list.length) out.push({ member: 'researcher', severity: 'note', text: `${list.length} meme/receipt clip${list.length === 1 ? ' is' : 's are'} used as commentary: ${list.slice(0, 4).join(' · ')}${list.length > 4 ? ' …' : ''}`, fix: 'Keep each one short (the moment itself) and list every source in the video description.' });
  for (const event of comp.roast.edl?.events ?? []) {
    if ((event.move === 'meme_cutaway' || event.move === 'receipt') && !event.provenance?.length && !memeOf(event)) {
      out.push({ member: 'researcher', severity: 'fix', at: [event.at, event.at + event.duration], text: `The ${event.move === 'receipt' ? 'receipt' : 'meme'} ${event.id} at ${s(event.at)} has no source on record.`, fix: 'Keep its URL, title and provider in the event\'s provenance (or its memeId), so the credits can name it.' });
    }
  }
}

// ── Comedian ──

/** The meme an event places, from its payload or its provenance. */
function memeOf(event: RoastEvent): string | undefined {
  return (event.move === 'meme_cutaway' ? event.memeId : undefined) ?? event.provenance?.find((entry) => entry.memeId)?.memeId;
}

/** The downloaded assets an event puts on screen: the ones whose rights matter. */
function eventAssets(event: RoastEvent): string[] {
  switch (event.move) {
    case 'meme_cutaway':
    case 'receipt':
    case 'side_cutout':
      return [event.assetId];
    case 'host_on_bg':
      return event.bgAssetId ? [event.bgAssetId] : [];
    case 'title_card':
      return event.photoAssetId ? [event.photoAssetId] : [];
    default:
      return [];
  }
}

/** Assets a roast event places with its provenance (memes, receipts, photos of people), with a source line each. */
function commentaryAssets(comp: Comp): Map<string, string> {
  const out = new Map<string, string>();
  for (const event of comp.roast?.edl?.events ?? []) {
    const memeId = memeOf(event);
    if (!event.provenance?.length && !memeId) continue;
    const source = event.provenance?.find((entry) => entry.url || entry.title);
    const line = source ? [source.title, source.url].filter(Boolean).join(' — ') : `meme ${memeId}`;
    for (const id of eventAssets(event)) out.set(id, line);
  }
  return out;
}

/** Moves that must say why they are funny (the contract: memes, cutaways and receipts). */
const NEEDS_WHY: ReadonlySet<RoastEvent['move']> = new Set(['meme_cutaway', 'receipt']);
/** A meme this far before the punchline's end is already stepping on the setup… */
const EARLY = 0.05;
/** …and this far after it, the laugh has moved on. */
const LATE = 0.35;
/** Without a beatId, a meme belongs to the punchline nearest it within this many seconds. */
const PUNCH_REACH = 1.5;
const SAME_SOUND_MAX = 3;
const FRESH_DAYS = 90;
const FRESH_SHARE = 0.3;
/** How far the bed must drop under a punchline, dB. */
const PUNCH_DUCK_DB = 12;

/** What to do about each Edit DNA metric out of band. */
const DNA_FIX: Partial<Record<DnaFinding['metric'], string>> = {
  greenShare: 'key_green_screen on the host (or rotoscope_clip), then put it on a background — never raw green.',
  cutsPerMinute: 'Jump-cut the ums and pauses (apply_recipe tighten), alternate 100% / 112–130% framing at each jump, and cut away to memes and receipts on the punchlines.',
  medianShot: 'Tighten the host shots and cut on the stressed words; let only receipts run long.',
  eventsPerMinute: 'Put something on the host every few seconds: keyword_pop (1–3 words), zoom_punch, emoji_pop, side_cutout, a card.',
  sfxPerMinute: 'A sound on every entry (whoosh, pop, boom) and none on plain words — 6–12 a minute in the busy stretches.',
  musicCoverage: 'Music as stingers under the bits (music_sting, 20–35% of the runtime), not a bed under everything.',
  onBeat: 'analyze_music_beats, then snap_cuts_to_beats inside the music.',
  memes: 'Find a meme for each punchline (search_memes on its intent and echo words) and place it with meme_cutaway.',
  textEvents: 'keyword_pop the stressed word every 10–20 s (memeImpact or roundedPop, behind the host for the big ones).',
};

/** The events on the timeline: applied ones whose clips still exist, or the whole plan before anything is applied. */
function liveEvents(comp: Comp): RoastEvent[] {
  const events = comp.roast?.edl?.events ?? [];
  const applied = comp.roast?.applied ?? [];
  if (!applied.length) return events;
  const present = new Set(comp.clips.map((clip) => clip.id));
  const live = new Set(applied.filter((entry) => !entry.clipIds.length || entry.clipIds.some((id) => present.has(id))).map((entry) => entry.eventId));
  return events.filter((event) => live.has(event.id));
}

const moveName = (event: RoastEvent) => (event.move === 'meme_cutaway' ? 'meme' : event.move.replace(/_/g, ' '));

/** The Comedian: only on a comp with a @funny plan. Returns whether the seat sat. */
function reviewComedian(ctx: Ctx, out: CouncilNote[], options: CouncilOptions): boolean {
  const { comp, project, assets } = ctx;
  const roast = comp.roast;
  if (!roast) return false;
  const push = (severity: Severity, text: string, fix: string, at?: [number, number], clipIds?: string[]) =>
    out.push({ member: 'comedian', severity, text, fix, ...(at ? { at } : {}), ...(clipIds?.length ? { clipIds } : {}) });
  const clipsOf = (event: RoastEvent) => roast.applied?.find((entry) => entry.eventId === event.id)?.clipIds ?? [];
  const events = [...liveEvents(comp)].sort((a, b) => a.at - b.at);
  const beats = roast.beatSheet?.beats ?? [];

  // Relevance: nothing goes on screen without a reason.
  for (const event of events) {
    if (NEEDS_WHY.has(event.move) && !event.why?.trim()) {
      push('block', `The ${moveName(event)} ${event.id} at ${s(event.at)} has no why — nobody can say what the joke is.`, 'Write one sentence: the joke, and why this meme or clip says it (it must agree with the meme\'s meaning and none of its dontUseWhen) — or cut it.', [event.at, event.at + event.duration], clipsOf(event));
    }
  }

  // Only memes whose meaning was checked against a source.
  const memes = events.map((event) => ({ event, id: memeOf(event) })).filter((entry): entry is { event: RoastEvent; id: string } => !!entry.id);
  if (options.meme) {
    for (const { event, id } of memes) {
      const entry = options.meme(id);
      const at: [number, number] = [event.at, event.at + event.duration];
      if (!entry) push('fix', `The meme at ${s(event.at)} (${id}) is not in the meme library, so its meaning cannot be checked.`, 'save_meme it with meaning, useWhen and dontUseWhen from its explainer (Know Your Meme, Wikipedia, Reddit), or swap it for a library meme.', at, clipsOf(event));
      else if (!entry.verified) push('block', `"${entry.name}" at ${s(event.at)} is unverified — its meaning was never checked against a source.`, 'Read its explainer and save_meme its meaning, useWhen and dontUseWhen, or swap it for a verified alternate.', at, clipsOf(event));
    }
  }

  // Timing: on the punchline word's end, +0–150 ms.
  for (const event of events) {
    if (event.move !== 'meme_cutaway') continue;
    const beat = event.beatId !== undefined
      ? beats.find((item) => item.id === event.beatId)
      : beats.filter((item) => item.punchAt !== undefined && Math.abs(item.punchAt - event.at) <= PUNCH_REACH).sort((a, b) => Math.abs(a.punchAt! - event.at) - Math.abs(b.punchAt! - event.at))[0];
    const punch = beat?.punchAt;
    if (punch === undefined) continue;
    const fix = `Move it to ${punch.toFixed(2)}–${(punch + 0.15).toFixed(2)} s: the end of the punchline word, +0–150 ms.`;
    if (event.at < punch - EARLY) push('fix', `The meme ${event.id} lands at ${event.at.toFixed(2)} s, ${(punch - event.at).toFixed(2)} s before the punchline ends (${punch.toFixed(2)} s) — it steps on the setup.`, fix, [event.at, punch], clipsOf(event));
    else if (event.at > punch + LATE) push('note', `The meme ${event.id} lands ${(event.at - punch).toFixed(2)} s after the punchline (${punch.toFixed(2)} s) — the laugh has moved on.`, fix, [punch, event.at], clipsOf(event));
  }

  // Repetition: each meme once.
  const byMeme = new Map<string, RoastEvent[]>();
  for (const { event, id } of memes) byMeme.set(id, [...(byMeme.get(id) ?? []), event]);
  for (const [id, uses] of byMeme) {
    if (uses.length < 2) continue;
    const name = options.meme?.(id)?.name ?? id;
    push('fix', `"${name}" is used ${uses.length} times (${uses.map((event) => s(event.at)).join(', ')}) — a meme lands once.`, 'Keep the one that lands best; swap the others to their alternates (roast_move with another meme).', [uses[0].at, uses[uses.length - 1].at], uses.flatMap(clipsOf));
  }

  // Repetition: the same sound at most 3 times a video (read off the timeline, where the sounds are).
  const sounds = new Map<string, { label: string; times: number[]; clipIds: string[] }>();
  for (const clip of comp.clips) {
    if (!clip.enabled) continue;
    const track = trackOf(comp, clip);
    if (!track || track.kind !== 'audio' || track.muted) continue;
    const onSfx = clip.source.type === 'sfx' || clip.audioType === 'sfx' || /^SFX\b/i.test(track.name.trim());
    if (!onSfx) continue;
    const key = clip.source.type === 'sfx' ? `kind:${clip.source.kind}` : clip.source.type === 'media' ? `asset:${clip.source.assetId}` : null;
    if (!key) continue;
    const name = clip.source.type === 'sfx' ? clip.source.kind : clip.source.type === 'media' ? (assets.get(clip.source.assetId)?.name ?? label(clip)) : label(clip);
    const entry = sounds.get(key) ?? { label: name, times: [], clipIds: [] };
    entry.times.push(clip.start);
    entry.clipIds.push(clip.id);
    sounds.set(key, entry);
  }
  for (const { label: name, times, clipIds } of sounds.values()) {
    if (times.length <= SAME_SOUND_MAX) continue;
    const sorted = [...times].sort((a, b) => a - b);
    push('fix', `The ${name} sound plays ${times.length} times (${sorted.slice(0, 6).map(s).join(', ')}${times.length > 6 ? '…' : ''}) — the ear hears the loop.`, `Keep it on the ${SAME_SOUND_MAX} biggest moments; swap the rest for other sounds (search_sfx).`, [sorted[0], sorted[sorted.length - 1]], clipIds);
  }

  // Freshness: at least 30% of the memes from the last 90 days.
  if (options.meme && memes.length >= 3) {
    const now = options.now ?? Date.now();
    const distinct = [...byMeme.keys()];
    const fresh = distinct.filter((id) => {
      const seen = options.meme?.(id)?.firstSeen;
      const time = seen ? Date.parse(seen) : NaN;
      return Number.isFinite(time) && now - time <= FRESH_DAYS * 86_400_000;
    }).length;
    if (distinct.length && fresh / distinct.length < FRESH_SHARE) {
      push('note', `Only ${fresh} of ${distinct.length} memes are from the last ${FRESH_DAYS} days — the edit feels dated.`, 'refresh_meme_trends, then swap a few evergreen memes for trending ones that fit the same beats (at least 30%).');
    }
  }

  // Audio: the punchline lands in space, with the bed dropped out under it.
  const music = comp.clips.filter((clip) => {
    if (!clip.enabled || !onAudio(comp, clip) || clip.source.type === 'sfx' || clip.audioType === 'sfx') return false;
    const asset = clip.source.type === 'media' ? assets.get(clip.source.assetId) : undefined;
    return clip.audioType === 'music' || /^Music\b/i.test(trackOf(comp, clip)?.name.trim() ?? '') || (!!asset && asset.kind === 'audio' && MUSIC_NAME.test(asset.name));
  });
  for (const beat of beats) {
    const punch = beat.punchAt;
    if (punch === undefined || !beat.kinds.includes('punchline')) continue;
    // A stinger that starts on the punch is the punctuation itself.
    const bed = music.find((clip) => clip.start <= punch - 0.3 && clipEnd(clip) >= punch);
    if (!bed) continue;
    const gain = (time: number) => gainToDb(animated(bed, 'volume', time, bed.volume));
    const level = gain(Math.max(bed.start, punch - 1.2));
    if (!Number.isFinite(level) || level < -60) continue;
    let dip = level;
    for (let time = punch - 0.6; time <= punch + 0.05; time += 0.05) dip = Math.min(dip, gain(time));
    if (level - dip < PUNCH_DUCK_DB) {
      push('fix', `The music runs through the punchline at ${s(punch)} (only ${Math.max(0, level - dip).toFixed(0)} dB down) — the joke has no space to land.`, `Drop the bed ${PUNCH_DUCK_DB} dB or more from 0.3–0.6 s before the punchline (score_audio_clip or volume keyframes), or end the stinger there.`, [punch - 0.6, punch], [bed.id]);
    }
  }

  // Pace: dead zones, then the rest of the Edit DNA against the band.
  const dnaOptions = { beats: comp.production?.music?.beats, project };
  for (const zone of deadZones(comp, FUNNY_BAND.maxStaticSeconds, assets, dnaOptions)) {
    push('block', `${span(zone.start, zone.end)} is ${(zone.end - zone.start).toFixed(1)} s of host with no cut and nothing happening — the band allows ${FUNNY_BAND.maxStaticSeconds} s.`, 'Land something in it: a jump cut with a punch-in, a keyword_pop, a zoom_punch or shake, a side_cutout, or a meme on the next punchline.', [zone.start, zone.end]);
  }
  for (const finding of compareDna(timelineDna(comp, assets, dnaOptions), FUNNY_BAND)) {
    if (finding.metric === 'longestStatic') continue;
    push(finding.severity, finding.message, DNA_FIX[finding.metric] ?? 'Bring the edit back inside the @funny band (edit_dna shows where).', finding.at ? [finding.at.start, finding.at.end] : undefined);
  }
  return true;
}

/** Runs the council's checks on a comp. `only` limits the review to some seats. */
export function councilReview(project: Project, assets: Map<string, Asset>, comp: Comp, only?: CouncilRole[], options: CouncilOptions = {}): CouncilReview {
  const ctx = context(project, assets, comp);
  const notes: CouncilNote[] = [];
  const wanted = (role: CouncilRole) => !only?.length || only.includes(role);
  const seats: CouncilRole[] = [];
  let motion = { density: 0, frames: [0, 0] as [number, number] };
  if (wanted('animator')) {
    motion = reviewAnimator(ctx, notes);
    seats.push('animator');
  }
  if (wanted('director')) {
    reviewDirector(ctx, notes);
    seats.push('director');
  }
  if (wanted('audio')) {
    reviewAudio(ctx, notes);
    seats.push('audio');
  }
  if (wanted('researcher')) {
    reviewResearcher(ctx, notes);
    seats.push('researcher');
  }
  if (wanted('comedian') && reviewComedian(ctx, notes, options)) seats.push('comedian');
  const order: Record<Severity, number> = { block: 0, fix: 1, note: 2 };
  notes.sort((a, b) => order[a.severity] - order[b.severity] || (a.at?.[0] ?? 0) - (b.at?.[0] ?? 0));
  const verdicts = Object.fromEntries(COUNCIL.map((member) => {
    const mine = notes.filter((note) => note.member === member.id);
    return [member.id, mine.some((note) => note.severity === 'block') ? 'holds' : mine.some((note) => note.severity === 'fix') ? 'changes' : 'approve'];
  })) as Record<CouncilRole, Verdict>;
  return { notes, verdicts, motionDensity: motion.density, frames: motion.frames, seats };
}

/** The review as the model reads it: one paragraph per seat, in the member's own terms. */
export function describeReview(review: CouncilReview, only?: CouncilRole[]): string {
  const lines: string[] = [];
  for (const member of COUNCIL) {
    if (only?.length && !only.includes(member.id)) continue;
    if (!review.seats.includes(member.id)) {
      // Asked for by name but did not sit: say why rather than a hollow approval.
      if (only?.includes(member.id)) lines.push(`${member.name} sits out — ${member.id === 'comedian' ? 'this comp has no @funny roast plan (save_beat_sheet, then apply_roast_edl)' : 'not reviewed'}.`);
      continue;
    }
    const mine = review.notes.filter((note) => note.member === member.id);
    const verdict = review.verdicts[member.id];
    const head = verdict === 'approve' ? 'approves' : verdict === 'holds' ? 'HOLDS THE CUT' : 'wants changes';
    lines.push(`${member.name} ${head}${member.id === 'animator' && review.frames[1] ? ` — ${review.frames[0]}/${review.frames[1]} frames in motion (${Math.round(review.motionDensity * 100)}%)` : ''}.`);
    for (const note of mine.slice(0, 8)) lines.push(`  [${note.severity}] ${note.text} → ${note.fix}`);
    if (mine.length > 8) lines.push(`  …and ${mine.length - 8} more.`);
  }
  return lines.join('\n');
}
