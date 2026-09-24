import { describeUncovered, uncoveredSpans } from './coverage';
import { councilMember, councilReview } from './council';
import type { Asset, Comp, Production, ProductionPhase, Project, ToolResult } from './types';
import { compDuration } from './timeline';

type Args = Record<string, unknown>;
export type StoryboardSceneInput = { start: number; end: number; intent?: unknown; visual?: unknown; audio?: unknown; evidence?: unknown; refs?: unknown };
export type VideoBlueprintSceneInput = { start: number; end: number; narration?: unknown; visual?: unknown; mediaSource?: unknown; visualPrompt?: unknown; mediaUrl?: unknown; assetId?: unknown; audio?: unknown };

/**
 * Shared storyboard gate: structure (coverage, 5–12s batches) plus pro content
 * (per-beat visual improvement thinking with layout/assets, sound design, evidence).
 * Pure so both the UI executor and the workflow guard enforce identical rules.
 *
 * Every failing scene is reported in ONE message so the model can fix them all
 * in a single retry instead of guessing one at a time. Technique use is proven
 * by tool receipts at verify time (roto/depth mattes, placed generations,
 * shaped audio) — never by magic words here, so no keyword gate lives here.
 */
export function storyboardContentError(scenes: StoryboardSceneInput[], fps: number, duration: number, knownIds?: Set<string>): string | null {
  if (!Array.isArray(scenes) || !scenes.length) return 'Supply a nonempty timed storyboard.';
  if (scenes.length > 100) return 'Supply up to 100 concise timed scenes.';
  if (scenes.some(s => !s || !Number.isFinite(s.start) || !Number.isFinite(s.end) || s.end <= s.start)) return 'Storyboard scenes need valid increasing time ranges.';
  const ordered = [...scenes].sort((a, b) => a.start - b.start);
  for (const scene of ordered) {
    if (scene.end - scene.start > 12.5) return `Split ${(scene.start).toFixed(1)}–${(scene.end).toFixed(1)}s into 5–12s batches: one scene per narrative beat.`;
  }
  let end = 0;
  for (const scene of ordered) {
    if (Math.abs(scene.start - end) > 1 / fps) return 'Storyboard scenes must cover the timeline in order, without gaps or overlaps. Include intentional pauses as scenes.';
    end = scene.end;
  }
  if (Math.abs(end - duration) > 1 / fps) return 'Storyboard end must match the current composition duration.';
  const problems: string[] = [];
  ordered.forEach((scene, i) => {
    const n = i + 1;
    const text = (key: string) => (typeof scene[key as keyof StoryboardSceneInput] === 'string' ? (scene[key as keyof StoryboardSceneInput] as string) : '');
    if (text('intent').trim().length < 20) problems.push(`Scene ${n}: intent needs the beat purpose in ≥20 chars (hook, insight, payoff, pause).`);
    else if (text('visual').trim().length < 120) problems.push(`Scene ${n}: visual needs ≥120 chars of improvement thinking — what changes vs raw footage, which images/PNGs/green-screen graphics go where, layout/position/scale, and the technique for this beat. Currently ${text('visual').trim().length} chars.`);
    else if (text('audio').trim().length < 40) problems.push(`Scene ${n}: audio needs ≥40 chars of sound design — music bed behaviour (duck/swell/crescendo), SFX (whoosh/impact/riser/pop), crossfades, or explicit silence. Currently ${text('audio').trim().length} chars.`);
    else if (text('evidence').trim().length < 12) problems.push(`Scene ${n}: evidence needs the transcript quote or frame observation this beat is based on (or explicitly unknown).`);
    else if (scene.refs !== undefined) {
      if (!Array.isArray(scene.refs) || scene.refs.length > 4) problems.push(`Scene ${n}: refs must be an array of up to 4 imported/generated asset IDs used as visual references.`);
      else for (const ref of scene.refs) {
        if (typeof ref !== 'string' || !ref.trim()) { problems.push(`Scene ${n}: refs must be imported/generated asset IDs, never invented.`); break; }
        if (knownIds && !knownIds.has(ref)) { problems.push(`Scene ${n}: ref "${ref}" is not an imported asset. Generate/import the reference image first, then attach its real asset ID.`); break; }
      }
    }
  });
  if (!problems.length) return null;
  const shown = problems.slice(0, 5).join(' ');
  return problems.length > 5 ? `${shown} Plus ${problems.length - 5} more scene(s) with the same kind of detail missing — fix all scenes in one re-save.` : shown;
}

/**
 * Blueprint gate for from-scratch video creation ("make this video").
 * Unlike the storyboard (which plans edits on existing footage), the blueprint
 * DEFINES its own timeline, so coverage is checked against contiguity from 0 —
 * not against the current comp duration (which is usually empty).
 *
 * Every failing scene is reported in ONE message so the model fixes them all
 * in a single retry.
 */
export function videoBlueprintContentError(scenes: VideoBlueprintSceneInput[], knownIds?: Set<string>): string | null {
  if (!Array.isArray(scenes) || !scenes.length) return 'Supply a nonempty blueprint: script plus timed scenes.';
  if (scenes.length > 100) return 'Supply up to 100 concise timed blueprint scenes.';
  if (scenes.some(s => !s || !Number.isFinite(s.start) || !Number.isFinite(s.end) || s.end <= s.start)) return 'Blueprint scenes need valid increasing time ranges.';
  const ordered = [...scenes].sort((a, b) => a.start - b.start);
  for (const scene of ordered) {
    if (scene.end - scene.start > 12.5) return `Split ${(scene.start).toFixed(1)}–${(scene.end).toFixed(1)}s into 5–12s batches: one scene per narrative beat.`;
  }
  let end = 0;
  for (const scene of ordered) {
    if (Math.abs(scene.start - end) > 0.01) return 'Blueprint scenes must start at 0 and run contiguously without gaps or overlaps. Include intentional pauses as scenes.';
    end = scene.end;
  }
  const problems: string[] = [];
  ordered.forEach((scene, i) => {
    const n = i + 1;
    const text = (key: string) => (typeof scene[key as keyof VideoBlueprintSceneInput] === 'string' ? (scene[key as keyof VideoBlueprintSceneInput] as string) : '');
    const source = text('mediaSource').trim();
    if (text('narration').trim().length < 10) problems.push(`Scene ${n}: narration needs the spoken text for this beat (≥10 chars).`);
    else if (text('visual').trim().length < 40) problems.push(`Scene ${n}: visual needs ≥40 chars of visual direction for this beat. Currently ${text('visual').trim().length} chars.`);
    else if (!['generate', 'download', 'existing'].includes(source)) problems.push(`Scene ${n}: mediaSource must be "generate", "download", or "existing".`);
    else if (text('audio').trim().length < 20) problems.push(`Scene ${n}: audio needs ≥20 chars of sound design for this beat. Currently ${text('audio').trim().length} chars.`);
    else if (source === 'generate' && text('visualPrompt').trim().length < 20) problems.push(`Scene ${n}: visualPrompt needs a ≥20-char generation prompt when mediaSource is "generate".`);
    else if (source === 'download' && !text('mediaUrl').trim()) problems.push(`Scene ${n}: mediaUrl is required when mediaSource is "download".`);
    else if (source === 'existing') {
      const id = text('assetId').trim();
      if (!id) problems.push(`Scene ${n}: assetId is required when mediaSource is "existing".`);
      else if (knownIds && !knownIds.has(id)) problems.push(`Scene ${n}: asset "${id}" is not imported. Import it first, then reference its real asset ID.`);
    }
  });
  if (!problems.length) return null;
  const shown = problems.slice(0, 5).join(' ');
  return problems.length > 5 ? `${shown} Plus ${problems.length - 5} more scene(s) with missing detail — fix all scenes in one re-save.` : shown;
}
const preparation = new Set([
  'online_research',
  'scrape_web_page',
  'web_search',
  'web_fetch',
  'read_file',
  'write_file',
  'edit_file',
  'replace_file_content',
  'list_directory',
  'glob_search',
  'grep_search',
  'run_command',
  'bash',
  'download_online_media',
  // Licence-clear search in PLAN; its downloads are held to GATHER by the phase gate.
  'find_free_media',
  'consult_council',
  // Bringing files into the bin never touches the timeline: it must not wait on transcription.
  'import_media',
  'organize_bin',
  'create_project_guideline',
  'create_folder',
  'get_project',
  'get_comp',
  'open_comp',
  'editing_workflow_status',
  'verify_edit_workflow',
  'analyze_clip_speech',
  // Motion engine planning: templates are read and a reference's style is learned before editing.
  'list_motion_templates',
  'get_motion_scene',
  'analyze_reference_video',
  'save_style_profile',
  'inspect_clip_frames',
  'inspect_source_frames',
  'local_media_capabilities',
  'install_local_model',
  'generate_local_media',
  'generation_job',
  'import_generated_media',
  'save_video_blueprint',
  'execute_blueprint',
  'synthesize_speech_voiceover',
  'query_frame_atlas',
  'scrape_videos',
  'list_effects',
  'list_recipes',
  'react_bits',
  'remotion_kit',
  'list_brand_kits',
  'get_brand_kit',
  'get_brand_guideline',
  'extract_brand_from_url',
  'check_brand_compliance',
  'list_brand_archetypes',
  'brand_kit_prompt',
  'export_brand_kit',
  // Making and choosing a kit writes settings and the project's kit pointer, never the timeline:
  // the brand is planned before anything is gathered. (apply_brand_kit and render_brand_board do
  // edit the timeline, and stay behind the editing gate.)
  'create_brand_kit',
  'update_brand_kit',
  'delete_brand_kit',
  'set_active_brand_kit',
  'import_brand_logo',
  'import_brand_kit',
  'list_learned_skills',
  'list_custom_tools',
  'create_custom_tool',
  'update_custom_tool',
  'delete_custom_tool',
  'detect_scenes',
  'ask_user',
  'set_playhead',
  // Production bookkeeping and analysis: they change the plan, never the timeline.
  'run_frame_qa',
  'attach_production_asset',
  'finish_gathering',
  'analyze_music_beats',
  // @funny planning: the beat sheet, meme and sound research, receipts, faces and the EDL check
  // change the plan or the libraries, never the timeline. get_meme_media and cutout_image make
  // media, so the phase gate still holds them to GATHER.
  'save_beat_sheet',
  'search_memes',
  'refresh_meme_trends',
  'save_meme',
  'get_meme_media',
  'find_receipt',
  'search_sfx',
  'cutout_image',
  'detect_faces',
  'validate_roast_edl',
  'edit_dna',
]);
const timing = (comp: Comp) => JSON.stringify([comp.fps, comp.clips.map(c => [c.id, c.trackId, c.source, c.start, c.in, c.duration, c.speed, c.reverse, c.hold, c.enabled])]);

/**
 * Tools that fetch or make media. They belong to the GATHER phase: refused while the plan is
 * being written, allowed once the user has pressed Start generating, and allowed again during
 * the edit for fixes.
 */
const GATHER_TOOLS = new Set([
  'generate_local_media',
  'generation_job',
  'import_generated_media',
  'download_online_media',
  'scrape_videos',
  'synthesize_speech_voiceover',
  'erase_subject_clip',
  'attach_production_asset',
  'finish_gathering',
  // @funny: a meme clip and a cut-out photo are gathered media like any download.
  'get_meme_media',
  'cutout_image',
]);

/** `generate_local_media` tasks the "disable local generation" setting turns off — image and
 * video only; local voice/music (`task: "audio"`) and the erase model are unaffected. */
const LOCAL_GENERATION_TASKS = new Set(['image', 'image-edit', 'image-inpaint', 'video']);

const LOCAL_GENERATION_OFF =
  'Local image/video generation is turned off (Settings → Local Media). Source real footage instead: ' +
  '`online_research` (`gatherMedia: true`) to find and download footage for the subject, or `download_online_media` / ' +
  '`scrape_videos` for a specific URL. For a shot with no real footage to find — an abstract or technical concept, e.g. ' +
  '"how a git repository works" — research it first with `online_research`, then build an animated explainer instead of a ' +
  'video: `create_motion_graphic` (the `teaching-card` layout, or custom html/css/js) using the facts you found. The user ' +
  'can turn local generation back on in Settings → Local Media if they want it for this project.';

/** Reads and bookkeeping that are fine in any phase, including after a phase has just closed. */
const ALWAYS_TOOLS = new Set([
  'list_motion_templates',
  'get_motion_scene',
  'editing_workflow_status',
  'verify_edit_workflow',
  'get_project',
  'get_comp',
  'open_comp',
  'read_file',
  'write_file',
  'edit_file',
  'replace_file_content',
  'list_directory',
  'glob_search',
  'grep_search',
  'list_effects',
  'list_recipes',
  'react_bits',
  'remotion_kit',
  'list_brand_kits',
  'get_brand_kit',
  'get_brand_guideline',
  'extract_brand_from_url',
  'check_brand_compliance',
  'list_brand_archetypes',
  'brand_kit_prompt',
  'export_brand_kit',
  'list_learned_skills',
  'list_custom_tools',
  'list_subagents',
  'wait_subagent',
  'consult_council',
  'local_media_capabilities',
  'ask_user',
  'set_playhead',
  'analyze_music_beats',
  // @funny reads: the libraries, captions and the measured edit.
  'search_memes',
  'find_receipt',
  'search_sfx',
  'validate_roast_edl',
  'edit_dna',
]);

const isPlanTool = (name: string) => name === 'save_storyboard' || name === 'save_video_blueprint';

/** What the chat should offer the user next for a production in this phase. */
export const nextUserAction = (phase: ProductionPhase | null | undefined): 'start-generating' | 'start-editing' | null =>
  phase === 'plan-ready' ? 'start-generating' : phase === 'gathered' ? 'start-editing' : null;

/** Receipts worth carrying from the planning turn into the gathering and editing turns. */
export type WorkflowReceipts = NonNullable<Production['receipts']>;

/** Every planned shot that must be gathered, flattened with a readable label. */
export function gatherShots(comp: Comp): { sceneIndex: number; shotIndex: number; label: string; status: string; kind: string }[] {
  const production = comp.production;
  if (!production) return [];
  const scenes: { shots?: { kind: string; status?: string; script?: string; prompt?: string; url?: string; assetId?: string }[]; mediaSource?: string; assetId?: string; status?: string }[] =
    production.mode === 'scratch' ? (comp.videoBlueprint?.scenes ?? []) : (comp.storyboard ?? []);
  const out: { sceneIndex: number; shotIndex: number; label: string; status: string; kind: string }[] = [];
  scenes.forEach((scene, sceneIndex) => {
    const shots = scene.shots ?? [];
    if (!shots.length && scene.mediaSource && scene.mediaSource !== 'existing') {
      out.push({ sceneIndex, shotIndex: 0, label: `Scene ${sceneIndex + 1}: ${scene.mediaSource}`, status: scene.assetId ? 'ready' : (scene.status ?? 'pending'), kind: scene.mediaSource });
      return;
    }
    shots.forEach((shot, shotIndex) => {
      if (shot.kind === 'existing' || shot.kind === 'sfx') return;
      const text = (shot.script ?? shot.prompt ?? shot.url ?? '').slice(0, 48);
      out.push({ sceneIndex, shotIndex, label: `Scene ${sceneIndex + 1} shot ${shotIndex + 1} (${shot.kind}): ${text}`, status: shot.assetId ? 'ready' : (shot.status ?? 'pending'), kind: shot.kind });
    });
  });
  if (production.music && production.music.source !== 'none' && production.music.source !== 'existing') {
    out.push({ sceneIndex: -1, shotIndex: 0, label: `Music: ${production.music.prompt ?? production.music.url ?? production.music.source}`, status: production.music.assetId ? 'ready' : (production.music.status ?? 'pending'), kind: 'music' });
  }
  return out;
}

const MUSIC_NAME = /music|\bbed\b|bed[-_ ]|score|instrumental|bgm|soundtrack/i;

/** Per-turn receipts come only from successful tools, never from assistant prose. */
export class EditWorkflow {
  private compId: string;
  private sources: { clipId: string; assetId: string; speech: boolean; frames: number; seen: Set<number> }[];
  private transcripts = new Set<string>();
  private inspected = '';
  private planned = '';
  private capabilities = false;
  private actions: string[] = [];
  private jobs = new Set<string>();
  private audioJobs = new Set<string>();
  private generated = new Set<string>();
  private unplaced = new Set<string>();
  private proVisual = false;
  private soundPass = false;
  private storyboardRefs = false;
  private blueprintSaved = false;
  private blueprintExecuted = false;
  private finished = false;
  private reviewedActions = 0;
  private verifiedSnapshot = '';
  /** A phase closed in this turn (plan saved, gathering finished): only reads may follow, the user presses the next button. */
  private closedPhase: 'plan' | 'gather' | null = null;
  /** How many timeline actions had run when the last frame-QA pass was taken; -1 = never. */
  private qaAtAction = -1;
  constructor(project: Project, assets: Map<string, Asset>, readonly mode: 'full' | 'quick' = 'full', readonly disableLocalGeneration = false) {
    const comp = project.comps.find(c => c.id === project.activeCompId) ?? project.comps[0];
    this.compId = comp?.id ?? '';
    const musicAssetId = comp?.production?.music?.assetId ?? null;
    this.sources = (comp?.clips ?? []).filter(c => c.enabled && c.source.type === 'media' && !comp.tracks.find(t => t.id === c.trackId)?.hidden && !comp.tracks.find(t => t.id === c.trackId)?.muted).flatMap(c => {
      if (c.source.type !== 'media') return [];
      const asset = assets.get(c.source.assetId);
      // The production's own chosen music bed is never dialogue — forcing it through
      // analyze_clip_speech blocked editing outright on a machine with no transcription engine
      // configured, for a Kevin MacLeod instrumental track that has nothing to transcribe.
      // Before a production exists there is no music.assetId yet, so an audio-only asset named
      // like a bed (music-bed-*.mp3, score, bgm, instrumental) counts as music too.
      const isMusicBed = asset?.id === musicAssetId || (asset?.kind === 'audio' && MUSIC_NAME.test(asset.name));
      return asset ? [{ clipId: c.id, assetId: asset.id, speech: !isMusicBed && (asset.hasAudio || asset.kind === 'audio'), frames: asset.kind === 'video' && comp.tracks.find(t => t.id === c.trackId)?.kind !== 'audio' ? Math.ceil(c.duration * comp.fps) : 0, seen: new Set<number>() }] : [];
    });
    // A production carries the planning turn's receipts forward. They only count while the
    // timeline is exactly what was analysed; any cut since then means a fresh look.
    const receipts = comp?.production?.receipts;
    // What was said in a file does not change when the timeline is cut: transcripts (kept per
    // asset) and the model check carry over whatever happened since.
    if (comp && receipts) {
      for (const id of receipts.transcribed) this.transcripts.add(id);
      this.capabilities = receipts.capabilities;
    }
    if (comp && receipts && receipts.fingerprint === timing(comp)) {
      for (const source of this.sources) for (const frame of receipts.framesSeen[source.clipId] ?? []) source.seen.add(frame);
      if (receipts.planned) this.planned = timing(comp);
      this.inspected = timing(comp);
    }
  }
  /**
   * Whether the production is past planning and gathering with its analysis on record: the plan
   * was made from transcribed, scanned footage, so later turns edit and polish without scanning
   * every clip again (they still read the timeline first).
   */
  private producing(comp: Comp | undefined): boolean {
    const production = comp?.production;
    return !!production?.receipts && (production.phase === 'editing' || production.phase === 'polishing' || production.phase === 'done');
  }
  /** The receipts worth stamping on the production when a plan is saved. */
  receipts(project: Project): WorkflowReceipts | null {
    const comp = this.comp(project);
    if (!comp) return null;
    const framesSeen: Record<string, number[]> = {};
    for (const source of this.sources) framesSeen[source.clipId] = [...source.seen].sort((a, b) => a - b);
    return { fingerprint: timing(comp), transcribed: [...this.transcripts], framesSeen, capabilities: this.capabilities, planned: !!this.planned && this.planned === timing(comp) };
  }
  private phase(project: Project): ProductionPhase | null {
    return this.comp(project)?.production?.phase ?? null;
  }
  private comp(project: Project) { return project.comps.find(c => c.id === this.compId); }
  status(project: Project) {
    const comp = this.comp(project);
    const pendingSpeech = [...new Set(this.sources.filter(s => s.speech && !this.transcripts.has(s.assetId)).map(s => s.clipId))];
    const pendingFrames = this.sources.filter(s => {
      const required = Math.min(s.frames, 6);
      return s.seen.size < required;
    }).map(s => {
      let next = 0; while (s.seen.has(next)) next++;
      const stride = s.frames > 6 ? Math.max(1, Math.floor(s.frames / 6)) : 1;
      return { clipId: s.clipId, reviewed: s.seen.size, total: Math.min(s.frames, 6), clipTotalFrames: s.frames, nextFrame: next, strideFrames: stride };
    });
    const fingerprint = comp ? timing(comp) : '';
    const production = comp?.production ?? null;
    const shots = comp && production ? gatherShots(comp) : [];
    return { mode: this.mode, compId: this.compId, transcriptPending: pendingSpeech, frameReviewPending: pendingFrames,
      phase: production?.phase ?? null, productionMode: production?.mode ?? null, nextUserAction: nextUserAction(production?.phase),
      gather: { ready: shots.filter(s => s.status === 'ready').length, total: shots.length, pending: shots.filter(s => s.status !== 'ready').map(s => s.label) },
      qaCurrent: this.qaAtAction === this.actions.length && this.qaAtAction >= 0, phaseClosedThisTurn: this.closedPhase,
      timelineRead: !!fingerprint && fingerprint === this.inspected, storyboardCurrent: !!fingerprint && fingerprint === this.planned,
      capabilitiesChecked: this.capabilities, proVisualPass: this.proVisual, soundPass: this.soundPass, storyboardRefs: this.storyboardRefs,
      blueprintSaved: this.blueprintSaved, blueprintExecuted: this.blueprintExecuted,
      // Pre-execution: blueprint saved (status draft/ready, or legacy without status)
      // blocks timeline edits until execute_blueprint runs (status becomes executing).
      blueprintActive: !!comp?.videoBlueprint && (comp.videoBlueprint.status === 'draft' || comp.videoBlueprint.status === 'ready' || (!comp.videoBlueprint.status && !this.blueprintExecuted)),
      // Post-execution plan: an executed blueprint counts as the plan, like a storyboard.
      blueprintPlan: !!comp?.videoBlueprint && (comp.videoBlueprint.status === 'executing' || comp.videoBlueprint.status === 'done' || this.blueprintExecuted),
      pendingJobs: [...this.jobs], pendingPlacement: [...this.unplaced], successfulActions: [...this.actions],
      finalTimelineRead: this.reviewedActions === this.actions.length,
      structurallyVerified: this.finished && this.verifiedSnapshot === JSON.stringify(comp), visualQualityVerified: false };
  }
  before(name: string, args: Args, project: Project): string | null {
    // A hard switch, not a phase gate: checked before the quick-mode bypass so a one-off Quick
    // edit turn cannot route around the setting either.
    if (this.disableLocalGeneration && name === 'generate_local_media' && LOCAL_GENERATION_TASKS.has(String(args.task))) return LOCAL_GENERATION_OFF;
    if (this.mode === 'quick') return null;
    if (name === 'editing_workflow_status' || name === 'verify_edit_workflow') return null;
    const comp = this.comp(project);
    if (!comp) return 'The workflow composition no longer exists. Start a new turn for another composition.';
    if (typeof args.compId === 'string' && ![this.compId, comp.name].includes(args.compId)) return 'This full-edit workflow is bound to its initial composition. Start another turn to edit another composition.';
    const gate = this.phaseGate(name, args, comp);
    if (gate) return gate;
    if (preparation.has(name)) return null;
    if (project.activeCompId !== this.compId) return 'Return to the workflow composition before editing. This turn cannot silently edit a different active timeline.';
    const clipIds = [args.clipId, ...(Array.isArray(args.clipIds) ? args.clipIds : [])].filter((id): id is string => typeof id === 'string');
    if (clipIds.some(id => !comp.clips.some(c => c.id === id))) return 'All edited clips must belong to the workflow composition.';
    const state = this.status(project);
    if (!state.timelineRead) return 'Read the current timeline with get_comp before editing or planning. Timing changed or has not been inspected.';
    if (this.producing(comp)) {
      if (name.startsWith('mcp__')) return 'External tools cannot bypass this workflow. Use the native editing tools, or select Quick edit for a separate explicitly scoped task.';
      return null;
    }
    if (state.transcriptPending.length) {
      const shown = state.transcriptPending.slice(0, 4).map(id => `analyze_clip_speech {"clipId":"${id}"}`).join(' then ');
      const more = state.transcriptPending.length > 4 ? ` plus ${state.transcriptPending.length - 4} more clip(s) from editing_workflow_status` : '';
      return `Transcribe first, one clip per call: ${shown}${more}. Do not generate subtitles just to transcribe.`;
    }
    if (state.frameReviewPending.length) {
      const shown = state.frameReviewPending.slice(0, 4).map(p => `inspect_clip_frames {"clipId":"${p.clipId}","textOnly":true} (${p.reviewed}/${p.total} scanned)`).join(' then ');
      const more = state.frameReviewPending.length > 4 ? ` plus ${state.frameReviewPending.length - 4} more clip(s) from editing_workflow_status` : '';
      return `Frame scan missing — run now, one clip per call, text-only (no images): ${shown}${more}. Request images only later, for the one batch needing roto points or behind-subject placement.`;
    }
    // Local-model discovery must happen before planning, so the storyboard's visual
    // thinking names real installed adapters (image/video/audio/depth) instead of wishes.
    if (!state.capabilitiesChecked) return 'Call local_media_capabilities before saving the storyboard or editing, so the visual plan uses the actual installed image/video/audio/depth models.';
    if (name === 'save_storyboard' || name === 'save_video_blueprint') return null;
    // Blueprint-first pipeline: once a blueprint exists and execution has started
    // (or the blueprint was saved this turn), timeline edits are blocked until
    // execute_blueprint runs and all assets are gathered. Asset gathering tools
    // (generate/download/voice-over) are in `preparation` and already passed.
    if (state.blueprintActive) return 'Blueprint saved — gather everything first, build later. Finish asset pre-production (voice-over, generated visuals, downloads — all imported into Generated), then call execute_blueprint before any timeline edit. Do not place, cut, or style clips yet.';
    if (!state.storyboardCurrent && !state.blueprintExecuted && !state.blueprintPlan) return 'Save or update a concise timed storyboard for the CURRENT timeline before further edits. Call save_storyboard; planned ranges must cover the composition without overlaps.';
    if (!this.capabilities && ['rotoscope_clip', 'depth_occlusion_clip'].includes(name)) return 'Call local_media_capabilities before choosing a local model. Unsupported tasks must be reported as unavailable.';
    if (name.startsWith('mcp__')) return 'External tools cannot bypass this workflow. Use the native editing tools, or select Quick edit for a separate explicitly scoped task.';
    return null;
  }
  /**
   * The production phases. The model plans, the user presses Start generating, the model
   * gathers, the user presses Start editing, the model edits and polishes. Tools from a later
   * phase are refused with the reason, and once a phase closes in a turn only reads may follow.
   */
  private phaseGate(name: string, args: Args, comp: Comp): string | null {
    if (ALWAYS_TOOLS.has(name)) return null;
    if (this.closedPhase === 'plan') return 'The plan is saved and this phase is closed. Do not call more tools: end your turn with a short summary of the plan (script, shots, graphics, music). The user reviews it and presses Start generating.';
    if (this.closedPhase === 'gather') return 'Gathering is finished and this phase is closed. Do not call more tools: end your turn with a short summary of what was gathered. The user presses Start editing.';
    const phase = comp.production?.phase ?? null;
    const gatherMedia = name === 'online_research' && args.gatherMedia === true;
    const scrapeMedia = (name === 'scrape_web_page' && args.downloadVideos === true) || (name === 'find_free_media' && args.download === true);
    if (name === 'run_command' || name === 'bash') return null;
    if (phase === null) {
      // No plan saved yet: media gathering waits for one; timeline tools fall through to the
      // step-by-step prerequisites below (read, transcribe, scan, capabilities, storyboard).
      if (GATHER_TOOLS.has(name) || gatherMedia || scrapeMedia) {
        const planTool = comp.clips.some(c => c.enabled && c.source.type === 'media') ? 'save_storyboard' : 'save_video_blueprint';
        return 'Planning comes first: research the subject (online_research with gatherMedia false, scrape_web_page for facts and links), write the script, break it into 5-7 s shots with a script and prompt each, choose the motion graphic, transition, SFX and music per beat, then ' + planTool + ' and end your turn. Media is generated only after the user presses Start generating. (For a one-off generation the user can switch the composer to Quick edit.)';
      }
      return null;
    }
    if (phase === 'planning' || phase === 'plan-ready') {
      if (isPlanTool(name)) return null;
      if (GATHER_TOOLS.has(name) || gatherMedia || scrapeMedia) {
        const planTool = comp.clips.some(c => c.enabled && c.source.type === 'media') ? 'save_storyboard' : 'save_video_blueprint';
        return phase === 'plan-ready'
          ? 'The plan is waiting for the user to press Start generating. Do not generate or download media yet; end your turn.'
          : 'Planning comes first: research the subject (online_research with gatherMedia false, scrape_web_page for facts and links), write the script, break it into 5-7 s shots with a script and prompt each, choose the motion graphic, transition, SFX and music per beat, then ' + planTool + ' and end your turn. Media is generated only after the user presses Start generating. (For a one-off generation the user can switch the composer to Quick edit.)';
      }
      if (!preparation.has(name)) {
        return phase === 'plan-ready'
          ? 'The plan is waiting for the user to press Start generating; there is nothing to edit yet. End your turn.'
          : 'No timeline edits before the plan is saved. Finish planning first (research, script, shots, graphics, save the plan), then end your turn.';
      }
      return null;
    }
    if (phase === 'gathering') {
      if (GATHER_TOOLS.has(name) || preparation.has(name) || gatherMedia || scrapeMedia) return null;
      return 'Gathering phase: no timeline edits until the user presses Start editing. Generate or download every planned shot (one text-to-video shot per call, 5-7 s, with sceneIndex so it attaches to the plan), the voice-over and the music, then call finish_gathering and end your turn.';
    }
    if (phase === 'gathered') {
      if (name === 'attach_production_asset') return null;
      if (GATHER_TOOLS.has(name) || scrapeMedia || !preparation.has(name)) return 'Everything is gathered and the plan is waiting for the user to press Start editing. End your turn.';
      return null;
    }
    return null;
  }
  validateStoryboard(args: Args, project: Project): string | null {
    if (this.mode === 'quick') return null;
    const comp = this.comp(project);
    if (!comp) return 'Supply a nonempty timed storyboard.';
    const knownIds = new Set<string>([
      ...project.media.map(m => m.assetId),
      ...project.items.map(i => i.id),
      ...project.comps.map(c => c.id),
    ]);
    return storyboardContentError(Array.isArray(args.scenes) ? (args.scenes as StoryboardSceneInput[]) : [], comp.fps, compDuration(comp), knownIds);
  }
  record(name: string, args: Args, result: ToolResult, project: Project) {
    // An audio-only clip this machine cannot transcribe must not hold every later tool hostage:
    // once the attempt has failed for lack of an engine, stop demanding it.
    if (!result.ok && name === 'analyze_clip_speech' && /Nothing on this machine can transcribe/.test(String(result.error ?? ''))) {
      const source = this.sources.find(s => s.clipId === args.clipId && s.frames === 0);
      if (source) this.transcripts.add(source.assetId);
    }
    if (!result.ok) return;
    const comp = this.comp(project);
    if (!comp) return;
    if ((name === 'get_comp' && result.id === this.compId) || (name === 'get_project' && (result.activeComp as { id?: string })?.id === this.compId)) { this.inspected = timing(comp); this.reviewedActions = this.actions.length; }
    if (name === 'analyze_clip_speech') {
      const source = this.sources.find(s => s.clipId === args.clipId);
      if (source && result.transcript) this.transcripts.add(source.assetId);
    }
    if (name === 'inspect_clip_frames') {
      const source = this.sources.find(s => s.clipId === args.clipId);
      if (source && Array.isArray(result.frames)) {
        const hasImages = Array.isArray(result.images) && result.images.length === result.frames.length;
        const isTextOnly = result.textOnly === true || args.textOnly === true || (Array.isArray(result.images) && result.images.length > 0);
        if (hasImages || isTextOnly) {
          for (const frame of result.frames) {
            if (Number.isInteger(frame) && frame >= 0 && frame < source.frames) source.seen.add(frame);
          }
        }
      }
    }
    if (name === 'inspect_source_frames') {
      const source = this.sources.find(s => s.clipId === args.clipId);
      if (source && Array.isArray(result.times) && result.times.length) {
        for (const t of result.times) {
          if (typeof t === 'number' && Number.isFinite(t)) {
            source.seen.add(Math.min(source.frames - 1, Math.max(0, Math.floor(t * comp.fps))));
          }
        }
      }
    }
    if (name === 'local_media_capabilities') this.capabilities = true;
    if ((name === 'save_storyboard' || name === 'save_video_blueprint') && comp.production?.phase === 'plan-ready') this.closedPhase = 'plan';
    if (name === 'finish_gathering' && comp.production?.phase === 'gathered') this.closedPhase = 'gather';
    if (name === 'run_frame_qa') this.qaAtAction = this.actions.length;
    // An @funny beat sheet is a timed plan of the current timeline, like a storyboard.
    if (name === 'save_beat_sheet') this.planned = timing(comp);
    if (name === 'save_storyboard') {
      this.planned = timing(comp);
      const scenes = Array.isArray(args.scenes) ? (args.scenes as StoryboardSceneInput[]) : [];
      this.storyboardRefs = scenes.some(s => s && Array.isArray(s.refs) && s.refs.length > 0);
    }
    // Blueprint-first receipts: saving opens the gate, executing lifts it.
    if (name === 'save_video_blueprint') {
      this.blueprintSaved = true;
      this.blueprintExecuted = false;
    }
    if (name === 'execute_blueprint') {
      this.blueprintExecuted = true;
    }
    if (name === 'generate_local_media') {
      if (typeof result.jobId === 'string') {
        this.jobs.add(result.jobId);
        if (args.task === 'audio') this.audioJobs.add(result.jobId);
      }
      if (Array.isArray(result.assets) && result.assets.length) {
        if (typeof result.jobId === 'string') {
          this.jobs.delete(result.jobId);
          this.audioJobs.delete(result.jobId);
        }
        for (const asset of result.assets) {
          if (typeof asset?.id === 'string') {
            this.unplaced.add(asset.id);
            this.generated.add(asset.id);
          }
        }
        if (args.task === 'audio') this.soundPass = true;
      }
    }
    // Import is the receipt that a successful generated artifact really reached the project.
    if (name === 'import_generated_media' && typeof args.jobId === 'string' && Array.isArray(result.assets) && result.assets.length) {
      this.jobs.delete(args.jobId);
      const wasAudio = this.audioJobs.delete(args.jobId);
      for (const asset of result.assets) {
        if (typeof asset?.id === 'string') {
          this.unplaced.add(asset.id);
          this.generated.add(asset.id);
        }
      }
      if (wasAudio) this.soundPass = true;
    }
    for (const clip of comp.clips) {
      if (clip.source.type === 'media' && clip.enabled) {
        if (this.unplaced.delete(clip.source.assetId) && this.generated.has(clip.source.assetId)) {
          this.proVisual = true;
          this.storyboardRefs = true;
        }
      }
    }
    // Subject isolation counts as the pro-visual pass even before inserts are layered.
    if ((name === 'rotoscope_clip' || name === 'depth_occlusion_clip') && (result as { frames?: unknown }).frames !== undefined) this.proVisual = true;
    if (name === 'add_text_behind_subject' || name === 'add_media_behind_subject') this.proVisual = true;
    // Motion graphics: titles, kinetic typography, lower-thirds, shape layers, and transitions
    if (name === 'add_text' || name === 'create_item' || name === 'add_transition') this.proVisual = true;
    if (name === 'apply_recipe' && ['hook', 'punch-ins', 'pro-chunk-edit', 'captions'].includes(String(args.name || ''))) this.proVisual = true;
    // Designed sound counts: shaped music/SFX automation or built-in accents.
    if (name === 'score_audio_clip' || name === 'add_sound_effect' || name === 'generate_selection_sound') this.soundPass = true;
    if (name === 'apply_recipe' && ['music-bed', 'pro-chunk-edit'].includes(String(args.name || ''))) this.soundPass = true;
    const audioTracks = comp.tracks.filter(t => t.kind === 'audio');
    if (audioTracks.length > 1 && comp.clips.some(c => c.enabled && comp.tracks.find(t => t.id === c.trackId)?.kind === 'audio' && c.trackId !== audioTracks[0].id)) {
      this.soundPass = true;
    }
    if (!preparation.has(name) && name !== 'save_storyboard') {
      this.actions.push(name);
      this.finished = false;
      this.inspected = timing(comp);
      if (this.planned) this.planned = timing(comp);
    }
  }
  verify(project: Project, assets?: Map<string, Asset>): ToolResult {
    const status = this.status(project), comp = this.comp(project);
    const phase = this.phase(project);
    if (phase === 'plan-ready' || phase === 'gathering' || phase === 'gathered') return { ok: false, error: `Nothing to verify yet: the production is in the ${phase} phase. verify_edit_workflow belongs to the end of the editing phase, after the user has pressed Start editing and the timeline is assembled.` };
    if (this.mode === 'full' && (phase === 'editing' || phase === 'polishing') && !status.qaCurrent) return { ok: false, error: `Polish pass missing: call run_frame_qa after your last edit (it reports every graphic or caption overlapping the subject or another graphic, with contact sheets), fix what it finds, run it again until it is clear, then verify. ${JSON.stringify({ phase, actions: status.successfulActions.length })}` };
    if (status.blueprintActive) return { ok: false, error: `Workflow incomplete: blueprint saved but not executed. Gather all assets, call execute_blueprint, then assemble. ${JSON.stringify(status)}` };
    const producing = this.producing(comp);
    const planOk = status.storyboardCurrent || status.blueprintExecuted || status.blueprintPlan || (producing && !!comp?.storyboard?.length);
    const analysed = producing || (!status.transcriptPending.length && !status.frameReviewPending.length);
    if (this.mode === 'full' && (!status.timelineRead || !status.finalTimelineRead || !planOk || !analysed || status.pendingJobs.length || status.pendingPlacement.length)) return { ok: false, error: `Workflow incomplete: ${JSON.stringify(status)}. Finish or explicitly report blocked work; do not claim completion.` };
    const needsPro = this.mode === 'full' && !!comp?.clips.some(c => c.enabled && c.source.type === 'media');
    // A later turn of a production being edited (a fix, the polish pass) is judged on the timeline
    // it leaves, not on what it did itself: the graphics and the sound design are already there.
    const onTimeline = producing && comp ? {
      visual: comp.clips.some(c => c.enabled && (c.source.type === 'comp' || c.source.type === 'motion' || c.source.type === 'html' || c.source.type === 'text' || !!c.rotoMatte)),
      sound: comp.clips.some(c => c.enabled && c.source.type === 'sfx') || comp.tracks.filter(t => t.kind === 'audio' && comp.clips.some(c => c.enabled && c.trackId === t.id)).length > 1,
    } : null;
    if (needsPro) {
      if (!status.capabilitiesChecked) return { ok: false, error: `Pro pass missing: local image/video/audio/depth models were never checked. Call local_media_capabilities, then run the planned roto/depth/generation work or report the blocker. ${JSON.stringify(status)}` };
      if (!status.proVisualPass && !onTimeline?.visual) return { ok: false, error: `Pro visual pass missing: no motion graphics, roto/depth matte, or generated media placed. Add kinetic/title/lower-third motion graphics, isolate a subject (rotoscope_clip/depth_occlusion_clip) and layer text behind it, or generate+import+place a storyboard asset — or report the blocker. ${JSON.stringify(status)}` };
      if (!status.soundPass && !onTimeline?.sound) return { ok: false, error: `Sound pass missing: no shaped music/SFX. Lay the music bed, shape it with score_audio_clip (duck under dialogue, swell on beats), add whoosh/impact/riser accents — or report the blocker. ${JSON.stringify(status)}` };
      if (!status.storyboardRefs && !status.blueprintExecuted && !status.blueprintPlan && !onTimeline) return { ok: false, error: `Storyboard has no visual references: generate 1+ reference stills (local image model), import them, and attach their asset IDs as refs on the relevant scenes — or report the blocker. ${JSON.stringify(status)}` };
    }
    if (!comp || comp.clips.some(c => !comp.tracks.some(t => t.id === c.trackId) || !Number.isFinite(c.start) || !Number.isFinite(c.duration) || c.start < 0 || c.duration <= 0)) return { ok: false, error: 'Timeline contains invalid clip timing or missing tracks.' };
    // Picture scaled down, moved or cropped with nothing behind it renders black at the edges.
    const uncovered = assets ? uncoveredSpans(project, assets, comp) : [];
    if (uncovered.length) return { ok: false, error: `Black frame edges: ${describeUncovered(uncovered, comp, project, assets)} Fix them, then verify again.` };
    // The council signs the cut off: a blocking note from any seat is unfinished work.
    if (this.mode === 'full' && assets) {
      const holds = councilReview(project, assets, comp).notes.filter((note) => note.severity === 'block');
      if (holds.length) return { ok: false, error: `The council holds the cut. Fix these, then consult_council and verify again:\n${holds.map((note) => `- ${councilMember(note.member)?.name}: ${note.text} → ${note.fix}`).join('\n')}` };
    }
    this.finished = true;
    this.verifiedSnapshot = JSON.stringify(comp);
    return { ok: true, summary: 'Workflow receipts and timeline structure checked. This does not verify rendered frames, matte quality, music quality or unsupported model features.', workflow: this.status(project) };
  }
}
