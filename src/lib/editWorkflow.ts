import { JUDGE_ROUNDS, PASS_MARK } from './judge';
import { describeUncovered, uncoveredSpans } from './coverage';
import { councilMember, councilReview } from './council';
import type { Asset, Comp, Production, ProductionPhase, Project, ToolResult } from './types';
import { compDuration, needsFrameSize } from './timeline';

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
  // The plugin library, not the project: fine in any phase (call_plugin_action is gated like an edit).
  'plugin_sdk_reference',
  'list_plugins',
  'get_plugin',
  'save_plugin',
  'plugin_logs',
  'show_plugin',
  'online_research',
  'scrape_web_page',
  'capture_product_ui',
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
  'search_icons',
  'svg_to_shape',
  'motion_guide',
  'list_drawn_styles',
  'check_motion_arcs',
  'list_3d_presets',
  'list_ui_kinds',
  'list_transitions',
  'check_pacing',
  'list_character_actions',
  'list_characters',
  'get_motion_scene',
  'analyze_reference_video',
  'save_style_profile',
  'inspect_clip_frames',
  'inspect_source_frames',
  'local_media_capabilities',
  'cloud_generation_capabilities',
  'install_local_model',
  'generate_local_media',
  'generate_cloud_media',
  'generation_job',
  'import_generated_media',
  'save_video_blueprint',
  'execute_blueprint',
  'synthesize_speech_voiceover',
  'query_frame_atlas',
  'scrape_videos',
  'list_effects',
  'inspect_color',
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
  // The brain is the assistant's own memory: usable in every phase.
  'brain_remember',
  'brain_recall',
  'brain_forget',
  'brain_save_skill',
  'brain_load_skill',
  'import_brand_kit',
  'list_learned_skills',
  'list_custom_tools',
  'create_custom_tool',
  'update_custom_tool',
  'delete_custom_tool',
  'detect_scenes',
  'ask_user',
  'choose_shorts_format',
  'choose_comp_size',
  'set_playhead',
  // Production bookkeeping and analysis: they change the plan, never the timeline.
  'run_frame_qa',
  'judge_edit',
  'attach_production_asset',
  'finish_gathering',
  'analyze_music_beats',
  // @funny planning: the beat sheet, meme and sound research, receipts, faces and the EDL check
  // change the plan or the libraries, never the timeline. get_meme_media and cutout_image make
  // media, so the phase gate still holds them to GATHER.
  'save_beat_sheet',
  'search_memes',
  'find_memes_online',
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
  'generate_cloud_media',
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
/** Tools usable in any phase that still wait for the frame size of a picture-less comp: notes, memory, research, plugin writes. */
const HELD_FOR_SIZE = new Set([
  'write_file', 'edit_file', 'replace_file_content', 'save_plugin', 'brain_remember', 'brain_forget', 'brain_save_skill', 'export_brand_kit',
  'extract_brand_from_url', 'consult_council', 'wait_subagent',
]);

const ALWAYS_TOOLS = new Set([
  // A tool's own documentation (the catalogue sends most tools slim): reading it changes nothing.
  'tool_help',
  // The Director's debate proposes storyboards; the lead still saves one through save_storyboard.
  'propose_storyboards',
  // The plugin library, not the project: fine in any phase (call_plugin_action is gated like an edit).
  'plugin_sdk_reference',
  'list_plugins',
  'get_plugin',
  'save_plugin',
  'plugin_logs',
  'show_plugin',
  'list_motion_templates',
  'search_icons',
  'svg_to_shape',
  'motion_guide',
  'list_drawn_styles',
  'check_motion_arcs',
  'list_3d_presets',
  'list_ui_kinds',
  'list_transitions',
  'check_pacing',
  'list_character_actions',
  'list_characters',
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
  'inspect_color',
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
  // The brain is the assistant's own memory: usable in every phase.
  'brain_remember',
  'brain_recall',
  'brain_forget',
  'brain_save_skill',
  'brain_load_skill',
  'export_brand_kit',
  'list_learned_skills',
  'list_custom_tools',
  'list_subagents',
  'wait_subagent',
  'consult_council',
  'local_media_capabilities',
  'cloud_generation_capabilities',
  'ask_user',
  'choose_shorts_format',
  'choose_comp_size',
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
  /** The Judge's last verdict in this turn: the action count it saw, its score, how many rounds ran. */
  private judgeAtAction = -1;
  private judgeScore: number | null = null;
  private judgeRounds = 0;
  /** What the last frame-QA pass reported: verify needs each fixed, or waived with a reason. */
  private qaIssues: { kind: string; a: string; b: string }[] = [];
  /** The waivers the pending verify_edit_workflow call carries (verify itself only sees the project). */
  private pendingWaivers: unknown[] = [];
  /**
   * Shorts made this turn (create_shorts). Each is a comp of its own whose plan is the short itself,
   * so this turn may edit them all; verify checks every one.
   */
  private shorts = new Set<string>();
  /** Shorts that have had a frame-QA pass this turn. */
  private shortsQa = new Set<string>();
  /** The workflow comp is a short made earlier: its source plan stands in for a storyboard. */
  private shortComp = false;
  /** `askFrameSize` is off for plugins: they cannot ask the user, so they are never held for the size. */
  constructor(project: Project, assets: Map<string, Asset>, readonly mode: 'full' | 'quick' = 'full', readonly disableLocalGeneration = false, readonly askFrameSize = true) {
    const comp = project.comps.find(c => c.id === project.activeCompId) ?? project.comps[0];
    this.compId = comp?.id ?? '';
    this.shortComp = !!comp?.short;
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
  /**
   * The workflow comp and every comp nested in it at any depth — the layered "[Motion]" comps and
   * precomps a scene opens into are part of the edit, and their layer clips are edited in place.
   */
  private scopeComps(project: Project): Comp[] {
    const byId = new Map(project.comps.map(c => [c.id, c]));
    const seen = new Set<string>();
    const walk = (id: string) => {
      const comp = byId.get(id);
      if (!comp || seen.has(id)) return;
      seen.add(id);
      for (const clip of comp.clips) if (clip.source.type === 'comp') walk(clip.source.compId);
    };
    walk(this.compId);
    for (const id of this.shorts) walk(id);
    return [...seen].map(id => byId.get(id)!);
  }
  private outOfScope(comp: Comp): string {
    return `This turn edits "${comp.name}" and the comps nested in it; for a motion comp use update_motion_scene {"clipId":"<its holder clip id>"} or open_comp {"compId":"${this.compId}"}. Another composition needs a turn of its own.`;
  }
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
      structurallyVerified: this.finished && this.verifiedSnapshot === JSON.stringify(comp),
      // Rendered frames were looked at and scored after the last edit (judge_edit).
      visualQualityVerified: this.judgeAtAction === this.actions.length && this.judgeScore !== null && this.judgeScore >= PASS_MARK,
      judge: { score: this.judgeScore, current: this.judgeAtAction === this.actions.length && this.judgeAtAction >= 0, rounds: this.judgeRounds, passMark: PASS_MARK },
      frameSizeNeeded: this.frameSizePending(project) };
  }
  before(name: string, args: Args, project: Project): string | null {
    // A hard switch, not a phase gate: checked before the quick-mode bypass so a one-off Quick
    // edit turn cannot route around the setting either.
    if (this.disableLocalGeneration && name === 'generate_local_media' && LOCAL_GENERATION_TASKS.has(String(args.task))) return LOCAL_GENERATION_OFF;
    if (name === 'verify_edit_workflow') this.pendingWaivers = Array.isArray(args.acceptedQaIssues) ? args.acceptedQaIssues : [];
    // A timeline with no picture (empty, or audio only) has no size to take from footage: the user
    // picks the frame before anything is planned or built, in Quick edit too.
    const sizeGate = this.sizeGate(name, project);
    if (sizeGate) return sizeGate;
    if (this.mode === 'quick') return null;
    if (name === 'editing_workflow_status' || name === 'verify_edit_workflow') return null;
    const comp = this.comp(project);
    if (!comp) return 'The workflow composition no longer exists. Start a new turn for another composition.';
    // A short made this turn is planned by create_shorts itself: edit it freely (it is in scope).
    if (this.onShort(name, args, project)) return name.startsWith('mcp__') ? 'External tools cannot bypass this workflow. Use the native editing tools.' : null;
    // Reads are never refused over which comp they look at.
    const scope = ALWAYS_TOOLS.has(name) ? null : this.scopeComps(project);
    if (scope && typeof args.compId === 'string' && !scope.some(c => c.id === args.compId || c.name === args.compId)) return this.outOfScope(comp);
    const gate = this.phaseGate(name, args, comp);
    if (gate) return gate;
    if (preparation.has(name)) return null;
    if (project.activeCompId !== this.compId) return 'Return to the workflow composition before editing. This turn cannot silently edit a different active timeline.';
    const clipIds = [args.clipId, ...(Array.isArray(args.clipIds) ? args.clipIds : [])].filter((id): id is string => typeof id === 'string');
    // A clip of a nested comp, or a nested comp's own id (update_motion_scene takes either as clipId).
    const inScope = (id: string) => (scope ?? this.scopeComps(project)).some(c => c.id === id || c.clips.some(clip => clip.id === id));
    if (clipIds.some(id => !inScope(id))) return this.outOfScope(comp);
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
    // Shorts: the picked moments (with their scores and reasons) are the plan, one comp per short.
    if (name === 'create_shorts') return null;
    // Blueprint-first pipeline: once a blueprint exists and execution has started
    // (or the blueprint was saved this turn), timeline edits are blocked until
    // execute_blueprint runs and all assets are gathered. Asset gathering tools
    // (generate/download/voice-over) are in `preparation` and already passed.
    if (state.blueprintActive) return 'Blueprint saved — gather everything first, build later. Finish asset pre-production (voice-over, generated visuals, downloads — all imported into Generated), then call execute_blueprint before any timeline edit. Do not place, cut, or style clips yet.';
    if (!state.storyboardCurrent && !state.blueprintExecuted && !state.blueprintPlan && !this.shortComp) return 'Save or update a concise timed storyboard for the CURRENT timeline before further edits. Call save_storyboard; planned ranges must cover the composition without overlaps.';
    if (!this.capabilities && ['rotoscope_clip', 'depth_occlusion_clip'].includes(name)) return 'Call local_media_capabilities before choosing a local model. Unsupported tasks must be reported as unavailable.';
    if (name.startsWith('mcp__')) return 'External tools cannot bypass this workflow. Use the native editing tools, or select Quick edit for a separate explicitly scoped task.';
    return null;
  }
  /** Whether the user still has to pick the frame: the comp has no picture to take a size from and nobody chose one. */
  frameSizePending(project: Project): boolean {
    if (!this.askFrameSize) return false;
    const comp = this.comp(project);
    return comp ? needsFrameSize(comp) : !this.compId;
  }
  /**
   * Refuses everything but the question itself and library lookups until the user has chosen
   * the frame size of a comp that has no picture: the question comes first, before any planning,
   * research, notes or building.
   */
  private sizeGate(name: string, project: Project): string | null {
    // Shorts are built in comps of their own, at the frame choose_shorts_format asks for.
    // Library lookups are harmless; notes, research and builds wait for the answer.
    if (name === 'create_shorts' || (ALWAYS_TOOLS.has(name) && !HELD_FOR_SIZE.has(name)) || !this.frameSizePending(project)) return null;
    return 'Ask the frame size first: the timeline has no picture (empty or audio only), so its size is only the default. Call choose_comp_size now — before any plan, research, note or build — it asks the user and sets the comp; then carry on with the task.';
  }
  /** Whether a call works on a short made this turn: by compId, by its clips, or on the open short. */
  private onShort(name: string, args: Args, project: Project): boolean {
    if (!this.shorts.size || name === 'create_shorts') return false;
    const shortComps = project.comps.filter(c => this.shorts.has(c.id));
    if (typeof args.compId === 'string') return shortComps.some(c => c.id === args.compId || c.name === args.compId);
    const clipIds = [args.clipId, ...(Array.isArray(args.clipIds) ? args.clipIds : [])].filter((id): id is string => typeof id === 'string');
    if (clipIds.length) return clipIds.every(id => shortComps.some(c => c.clips.some(clip => clip.id === id)));
    return this.shorts.has(project.activeCompId ?? '');
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
    // The comp choose_comp_size made, when the project had none, is this turn's comp.
    if (name === 'choose_comp_size' && !this.comp(project) && typeof result.compId === 'string') this.compId = result.compId;
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
    if (name === 'local_media_capabilities' || name === 'cloud_generation_capabilities') this.capabilities = true;
    if (name === 'create_shorts' && Array.isArray(result.shorts)) {
      for (const short of result.shorts as { compId?: unknown }[]) if (typeof short?.compId === 'string') this.shorts.add(short.compId);
    }
    if (name === 'run_frame_qa') {
      const qaComp = typeof args.compId === 'string' ? project.comps.find(c => c.id === args.compId || c.name === args.compId)?.id : project.activeCompId;
      if (qaComp && this.shorts.has(qaComp)) this.shortsQa.add(qaComp);
    }
    if ((name === 'save_storyboard' || name === 'save_video_blueprint') && comp.production?.phase === 'plan-ready') this.closedPhase = 'plan';
    if (name === 'finish_gathering' && comp.production?.phase === 'gathered') this.closedPhase = 'gather';
    if (name === 'judge_edit' && typeof result.score === 'number') {
      this.judgeAtAction = this.actions.length;
      this.judgeScore = result.score;
      this.judgeRounds = typeof result.round === 'number' ? result.round : this.judgeRounds + 1;
    }
    // The Judge runs the Editor's frame pass first, so its verdict is a QA pass too.
    if (name === 'run_frame_qa' || (name === 'judge_edit' && Array.isArray(result.issues))) {
      this.qaAtAction = this.actions.length;
      this.qaIssues = Array.isArray(result.issues)
        ? (result.issues as { kind?: unknown; a?: unknown; b?: unknown }[]).map(issue => ({ kind: String(issue?.kind ?? ''), a: String(issue?.a ?? ''), b: String(issue?.b ?? '') }))
        : [];
    }
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
    if (name === 'generate_cloud_media' && Array.isArray(result.assets)) {
      for (const asset of result.assets) {
        if (typeof asset?.id === 'string') {
          this.unplaced.add(asset.id);
          this.generated.add(asset.id);
        }
      }
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
    // A recipe earns a receipt only for what it lays down, and a preview lays down nothing.
    const recipe = name === 'apply_recipe' && args.preview !== true ? String(args.name || '') : '';
    if (['hook', 'punch-ins', 'captions'].includes(recipe)) this.proVisual = true;
    // Designed sound counts: shaped music/SFX automation or built-in accents.
    if (name === 'score_audio_clip' || name === 'add_sound_effect' || name === 'generate_selection_sound') this.soundPass = true;
    if (recipe === 'music-bed') this.soundPass = true;
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
  /** Shorts made this turn: every one must exist, be sound, be QA'd, and hold nothing the council blocks. */
  private verifyShorts(project: Project, assets?: Map<string, Asset>): ToolResult {
    const problems: string[] = [];
    for (const id of this.shorts) {
      const short = project.comps.find(c => c.id === id);
      if (!short) continue;
      if (short.clips.some(c => !short.tracks.some(t => t.id === c.trackId) || !Number.isFinite(c.start) || !Number.isFinite(c.duration) || c.start < 0 || c.duration <= 0)) problems.push(`"${short.name}": invalid clip timing or a missing track`);
      if (this.mode === 'full' && !this.shortsQa.has(id)) problems.push(`"${short.name}": no frame QA yet — run_frame_qa {"compId":"${id}"} and fix what it finds`);
      const uncovered = assets ? uncoveredSpans(project, assets, short) : [];
      if (uncovered.length) problems.push(`"${short.name}": black frame edges — ${describeUncovered(uncovered, short, project, assets)}`);
      if (this.mode === 'full' && assets) {
        for (const note of councilReview(project, assets, short).notes.filter(n => n.severity === 'block')) problems.push(`"${short.name}" · ${councilMember(note.member)?.name}: ${note.text} → ${note.fix}`);
      }
    }
    const waivers = this.pendingWaivers.flatMap(raw => {
      const w = (raw && typeof raw === 'object' ? raw : {}) as Args;
      return typeof w.kind === 'string' && typeof w.a === 'string' && typeof w.reason === 'string' && w.reason.trim() && w.kind !== 'blank-frame' ? [{ kind: w.kind, a: w.a }] : [];
    });
    const open = this.mode === 'full' ? this.qaIssues.filter(issue => !waivers.some(w => w.kind === issue.kind && w.a === issue.a)) : [];
    if (open.length) problems.push(`the last frame-QA pass is not clear: ${open.slice(0, 6).map(issue => `${issue.kind} "${issue.a}"`).join('; ')} — fix and run it again, or pass acceptedQaIssues with a reason`);
    if (problems.length) return { ok: false, error: `The shorts are not finished:\n${problems.map(p => `- ${p}`).join('\n')}` };
    this.finished = true;
    return { ok: true, summary: `All ${this.shorts.size} shorts checked: cut, framed, QA'd and signed off by the council. This does not verify rendered frames or music taste.` };
  }
  verify(project: Project, assets?: Map<string, Asset>): ToolResult {
    if (this.shorts.size) return this.verifyShorts(project, assets);
    const status = this.status(project), comp = this.comp(project);
    const phase = this.phase(project);
    if (phase === 'plan-ready' || phase === 'gathering' || phase === 'gathered') return { ok: false, error: `Nothing to verify yet: the production is in the ${phase} phase. verify_edit_workflow belongs to the end of the editing phase, after the user has pressed Start editing and the timeline is assembled.` };
    if (this.mode === 'full' && (phase === 'editing' || phase === 'polishing') && !status.qaCurrent) return { ok: false, error: `Polish pass missing: call run_frame_qa after your last edit (it reports every graphic or caption overlapping the subject or another graphic, with contact sheets), fix what it finds, run it again until it is clear, then verify. ${JSON.stringify({ phase, actions: status.successfulActions.length })}` };
    // The QA pass must also have come back clear. Geometry flags some intended designs (a title set
    // behind the subject, a reveal), so each such issue can be waived with a reason — never a blank frame.
    const waivers = this.pendingWaivers.flatMap(raw => {
      const w = (raw && typeof raw === 'object' ? raw : {}) as Args;
      return typeof w.kind === 'string' && typeof w.a === 'string' && typeof w.reason === 'string' && w.reason.trim() && w.kind !== 'blank-frame'
        ? [{ kind: w.kind, a: w.a, reason: w.reason.trim() }] : [];
    });
    const waived = (issue: { kind: string; a: string }) => waivers.find(w => w.kind === issue.kind && w.a === issue.a);
    const open = this.mode === 'full' && status.qaCurrent ? this.qaIssues.filter(issue => !waived(issue)) : [];
    if (open.length) return { ok: false, error: `Frame QA is not clear: ${open.slice(0, 8).map(issue => `${issue.kind} "${issue.a}"${issue.b ? ` vs "${issue.b}"` : ''}`).join('; ')}${open.length > 8 ? ` (+${open.length - 8} more)` : ''}. Fix them and run run_frame_qa again, or pass acceptedQaIssues with a reason for each intentional one${open.some(issue => issue.kind === 'blank-frame') ? ' (a blank frame cannot be waived)' : ''}.` };
    const accepted = this.mode === 'full' && status.qaCurrent ? waivers.filter(w => this.qaIssues.some(issue => issue.kind === w.kind && issue.a === w.a)) : [];
    if (status.blueprintActive) return { ok: false, error: `Workflow incomplete: blueprint saved but not executed. Gather all assets, call execute_blueprint, then assemble. ${JSON.stringify(status)}` };
    const producing = this.producing(comp);
    const planOk = status.storyboardCurrent || status.blueprintExecuted || status.blueprintPlan || (producing && !!comp?.storyboard?.length) || this.shortComp;
    const analysed = producing || (!status.transcriptPending.length && !status.frameReviewPending.length);
    if (this.mode === 'full' && (!status.timelineRead || !status.finalTimelineRead || !planOk || !analysed || status.pendingJobs.length || status.pendingPlacement.length)) return { ok: false, error: `Workflow incomplete: ${JSON.stringify(status)}. Finish or explicitly report blocked work; do not claim completion.` };
    const needsPro = this.mode === 'full' && !!comp?.clips.some(c => c.enabled && c.source.type === 'media');
    // A later turn of a production being edited (a fix, the polish pass) is judged on the timeline
    // it leaves, not on what it did itself: the graphics and the sound design are already there.
    const onTimeline = (producing || this.shortComp) && comp ? {
      visual: comp.clips.some(c => c.enabled && (c.source.type === 'comp' || c.source.type === 'motion' || c.source.type === 'html' || c.source.type === 'text' || !!c.rotoMatte)),
      sound: comp.clips.some(c => c.enabled && c.source.type === 'sfx') || comp.tracks.filter(t => t.kind === 'audio' && comp.clips.some(c => c.enabled && c.trackId === t.id)).length > 1,
    } : null;
    if (needsPro) {
      if (!status.capabilitiesChecked) return { ok: false, error: `Pro pass missing: local image/video/audio/depth models were never checked. Call local_media_capabilities, then run the planned roto/depth/generation work or report the blocker. ${JSON.stringify(status)}` };
      if (!status.proVisualPass && !onTimeline?.visual) return { ok: false, error: `Pro visual pass missing: no motion graphics, roto/depth matte, or generated media placed. Add kinetic/title/lower-third motion graphics, isolate a subject (rotoscope_clip/depth_occlusion_clip) and layer text behind it, or generate+import+place a storyboard asset — or report the blocker. ${JSON.stringify(status)}` };
      if (!status.soundPass && !onTimeline?.sound) return { ok: false, error: `Sound pass missing: no shaped music/SFX. Lay the music bed, shape it with score_audio_clip (duck under dialogue, swell on beats), add whoosh/impact/riser accents — or report the blocker. ${JSON.stringify(status)}` };
      if (!status.storyboardRefs && !status.blueprintExecuted && !status.blueprintPlan && !onTimeline && !this.shortComp) return { ok: false, error: `Storyboard has no visual references: generate 1+ reference stills (local image model), import them, and attach their asset IDs as refs on the relevant scenes — or report the blocker. ${JSON.stringify(status)}` };
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
    // The Judge signs the production off: a current verdict at the pass mark, or the rounds spent.
    let judgeNote = '';
    if (this.mode === 'full' && comp.production && (phase === 'editing' || phase === 'polishing')) {
      const judgeCurrent = this.judgeAtAction === this.actions.length && this.judgeScore !== null;
      if (!judgeCurrent) return { ok: false, error: `The Judge has not scored this cut: call judge_edit${status.qaCurrent ? '' : ' (it runs the frame pass too)'} after your last edit, fix what it lists, then verify.` };
      if ((this.judgeScore ?? 0) < PASS_MARK) {
        if (this.judgeRounds < JUDGE_ROUNDS) return { ok: false, error: `The Judge scored ${this.judgeScore}/100 (pass mark ${PASS_MARK}). Fix its list and call judge_edit again (round ${this.judgeRounds + 1} of ${JUDGE_ROUNDS}).` };
        judgeNote = ` The Judge scored ${this.judgeScore}/100 after ${this.judgeRounds} rounds (below ${PASS_MARK}); the Token Council stopped the loop — tell the user what is still weak.`;
      } else judgeNote = ` The Judge scored ${this.judgeScore}/100.`;
    }
    this.finished = true;
    this.verifiedSnapshot = JSON.stringify(comp);
    const waiverNote = accepted.length ? ` Frame QA issues accepted as intended: ${accepted.map(w => `${w.kind} "${w.a}" (${w.reason})`).join('; ')}.` : '';
    return { ok: true, summary: `Workflow receipts and timeline structure checked.${waiverNote}${judgeNote}${judgeNote ? '' : ' This does not verify rendered frames, matte quality, music quality or unsupported model features.'}`, judgeScore: this.judgeScore, workflow: this.status(project), ...(accepted.length ? { acceptedQaIssues: accepted } : {}) };
  }
}
