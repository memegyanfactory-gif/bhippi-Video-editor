import type { Asset, Comp, Project, ToolResult } from './types';
import { compDuration } from './timeline';

type Args = Record<string, unknown>;
export type StoryboardSceneInput = { start: number; end: number; intent?: unknown; visual?: unknown; audio?: unknown; evidence?: unknown; refs?: unknown };

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
  'create_project_guideline',
  'create_folder',
  'get_project',
  'get_comp',
  'open_comp',
  'editing_workflow_status',
  'verify_edit_workflow',
  'analyze_clip_speech',
  'inspect_clip_frames',
  'inspect_source_frames',
  'local_media_capabilities',
  'install_local_model',
  'generate_local_media',
  'generation_job',
  'import_generated_media',
  'list_effects',
  'list_recipes',
  'list_learned_skills',
  'list_custom_tools',
  'create_custom_tool',
  'update_custom_tool',
  'delete_custom_tool',
  'detect_scenes',
  'ask_user',
  'set_playhead',
]);
const timing = (comp: Comp) => JSON.stringify([comp.fps, comp.clips.map(c => [c.id, c.trackId, c.source, c.start, c.in, c.duration, c.speed, c.reverse, c.hold, c.enabled])]);

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
  private finished = false;
  private reviewedActions = 0;
  private verifiedSnapshot = '';
  constructor(project: Project, assets: Map<string, Asset>, readonly mode: 'full' | 'quick' = 'full') {
    const comp = project.comps.find(c => c.id === project.activeCompId) ?? project.comps[0];
    this.compId = comp?.id ?? '';
    this.sources = (comp?.clips ?? []).filter(c => c.enabled && c.source.type === 'media' && !comp.tracks.find(t => t.id === c.trackId)?.hidden && !comp.tracks.find(t => t.id === c.trackId)?.muted).flatMap(c => {
      if (c.source.type !== 'media') return [];
      const asset = assets.get(c.source.assetId);
      return asset ? [{ clipId: c.id, assetId: asset.id, speech: asset.hasAudio || asset.kind === 'audio', frames: asset.kind === 'video' && comp.tracks.find(t => t.id === c.trackId)?.kind !== 'audio' ? Math.ceil(c.duration * comp.fps) : 0, seen: new Set<number>() }] : [];
    });
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
    return { mode: this.mode, compId: this.compId, transcriptPending: pendingSpeech, frameReviewPending: pendingFrames,
      timelineRead: !!fingerprint && fingerprint === this.inspected, storyboardCurrent: !!fingerprint && fingerprint === this.planned,
      capabilitiesChecked: this.capabilities, proVisualPass: this.proVisual, soundPass: this.soundPass, storyboardRefs: this.storyboardRefs,
      pendingJobs: [...this.jobs], pendingPlacement: [...this.unplaced], successfulActions: [...this.actions],
      finalTimelineRead: this.reviewedActions === this.actions.length,
      structurallyVerified: this.finished && this.verifiedSnapshot === JSON.stringify(comp), visualQualityVerified: false };
  }
  before(name: string, args: Args, project: Project): string | null {
    if (this.mode === 'quick') return null;
    if (name === 'editing_workflow_status' || name === 'verify_edit_workflow') return null;
    const comp = this.comp(project);
    if (!comp) return 'The workflow composition no longer exists. Start a new turn for another composition.';
    if (typeof args.compId === 'string' && ![this.compId, comp.name].includes(args.compId)) return 'This full-edit workflow is bound to its initial composition. Start another turn to edit another composition.';
    if (preparation.has(name)) return null;
    if (project.activeCompId !== this.compId) return 'Return to the workflow composition before editing. This turn cannot silently edit a different active timeline.';
    const clipIds = [args.clipId, ...(Array.isArray(args.clipIds) ? args.clipIds : [])].filter((id): id is string => typeof id === 'string');
    if (clipIds.some(id => !comp.clips.some(c => c.id === id))) return 'All edited clips must belong to the workflow composition.';
    const state = this.status(project);
    if (!state.timelineRead) return 'Read the current timeline with get_comp before editing or planning. Timing changed or has not been inspected.';
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
    if (name === 'save_storyboard') return null;
    if (!state.storyboardCurrent) return 'Save or update a concise timed storyboard for the CURRENT timeline before further edits. Call save_storyboard; planned ranges must cover the composition without overlaps.';
    if (!this.capabilities && ['rotoscope_clip', 'depth_occlusion_clip'].includes(name)) return 'Call local_media_capabilities before choosing a local model. Unsupported tasks must be reported as unavailable.';
    if (name.startsWith('mcp__')) return 'External tools cannot bypass this workflow. Use the native editing tools, or select Quick edit for a separate explicitly scoped task.';
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
    if (name === 'save_storyboard') {
      this.planned = timing(comp);
      const scenes = Array.isArray(args.scenes) ? (args.scenes as StoryboardSceneInput[]) : [];
      this.storyboardRefs = scenes.some(s => s && Array.isArray(s.refs) && s.refs.length > 0);
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
  verify(project: Project): ToolResult {
    const status = this.status(project), comp = this.comp(project);
    if (this.mode === 'full' && (!status.timelineRead || !status.finalTimelineRead || !status.storyboardCurrent || status.transcriptPending.length || status.frameReviewPending.length || status.pendingJobs.length || status.pendingPlacement.length)) return { ok: false, error: `Workflow incomplete: ${JSON.stringify(status)}. Finish or explicitly report blocked work; do not claim completion.` };
    const needsPro = this.mode === 'full' && !!comp?.clips.some(c => c.enabled && c.source.type === 'media');
    if (needsPro) {
      if (!status.capabilitiesChecked) return { ok: false, error: `Pro pass missing: local image/video/audio/depth models were never checked. Call local_media_capabilities, then run the planned roto/depth/generation work or report the blocker. ${JSON.stringify(status)}` };
      if (!status.proVisualPass) return { ok: false, error: `Pro visual pass missing: no motion graphics, roto/depth matte, or generated media placed. Add kinetic/title/lower-third motion graphics, isolate a subject (rotoscope_clip/depth_occlusion_clip) and layer text behind it, or generate+import+place a storyboard asset — or report the blocker. ${JSON.stringify(status)}` };
      if (!status.soundPass) return { ok: false, error: `Sound pass missing: no shaped music/SFX. Lay the music bed, shape it with score_audio_clip (duck under dialogue, swell on beats), add whoosh/impact/riser accents — or report the blocker. ${JSON.stringify(status)}` };
      if (!status.storyboardRefs) return { ok: false, error: `Storyboard has no visual references: generate 1+ reference stills (local image model), import them, and attach their asset IDs as refs on the relevant scenes — or report the blocker. ${JSON.stringify(status)}` };
    }
    if (!comp || comp.clips.some(c => !comp.tracks.some(t => t.id === c.trackId) || !Number.isFinite(c.start) || !Number.isFinite(c.duration) || c.start < 0 || c.duration <= 0)) return { ok: false, error: 'Timeline contains invalid clip timing or missing tracks.' };
    this.finished = true;
    this.verifiedSnapshot = JSON.stringify(comp);
    return { ok: true, summary: 'Workflow receipts and timeline structure checked. This does not verify rendered frames, matte quality, music quality or unsupported model features.', workflow: this.status(project) };
  }
}
