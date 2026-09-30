// How much Bhippi AI is allowed to do to the project without being asked.
//
// The assistant edits the timeline directly, so the mode is a real safety control, not a label:
// "Plan only" lets it look and suggest, "Auto-edit" lets it build, and "Full access" also lets it
// throw work away. Everything it does is one Undo (or the turn's Revert) away either mode.

export type PermissionMode = 'plan' | 'edit' | 'full';

export const PERMISSION_MODES: { id: PermissionMode; label: string; hint: string }[] = [
  { id: 'plan', label: 'Plan only', hint: 'Reads the project and answers; makes no edits' },
  { id: 'edit', label: 'Auto-edit', hint: 'Adds, changes and cuts clips (all undoable); never deletes media, tracks or comps' },
  { id: 'full', label: 'Full access', hint: 'Also deletes tracks, comps, media and plugins' },
];

export const DEFAULT_PERMISSION: PermissionMode = 'edit';

/** The mode as the model reads it in the turn's context: what it may do and when to ask. */
export function permissionBrief(mode: PermissionMode) {
  const rules: Record<PermissionMode, { may: string; questions: string }> = {
    plan: {
      may: 'Plan only: read the project, research and propose. Do not change the project or any file; describe the edit you would make.',
      questions: 'Ask with ask_user (with options) only when the answer changes the plan and you cannot sensibly choose yourself.',
    },
    edit: {
      may: 'Auto-edit: add, change, trim, cut and remove clips, text, effects and transitions freely (every timeline edit is undoable). Do not delete tracks, comps, project media or plugins.',
      questions: 'Ask with ask_user (with options) only when the answer changes the edit and you cannot sensibly choose yourself; otherwise decide and say what you chose.',
    },
    full: {
      may: 'Full access: every tool, deletions included.',
      questions: 'Do not ask the user anything: choose the best option yourself, carry on, and say what you chose in your reply. The one exception is the frame: choose_comp_size and choose_shorts_format always ask.',
    },
  };
  return { mode, label: PERMISSION_MODES.find((item) => item.id === mode)?.label ?? mode, ...rules[mode] };
}

/** Tools that only look at the project. Always allowed. */
const READS = new Set([
  'tool_help',
  'list_caption_styles',
  'online_research',
  'scrape_web_page',
  'capture_product_ui',
  'web_search',
  'web_fetch',
  'read_file',
  'list_directory',
  'glob_search',
  'grep_search',
  'local_media_capabilities',
  'cloud_generation_capabilities',
  'generation_job',
  'list_effects',
  // Renders a frame and measures its colour; changes nothing.
  'inspect_color',
  'list_learned_skills',
  'list_custom_tools',
  // The brain is the assistant's own memory, never the project.
  'brain_remember',
  'brain_recall',
  'brain_forget',
  'brain_save_skill',
  'brain_load_skill',
  'get_project',
  'get_comp',
  'open_comp',
  'set_playhead',
  'set_in_out',
  'detect_scenes',
  'ask_user',
  'consult_council',
  // @funny research and measuring: they read the meme and sound libraries, captions and the timeline.
  // save_meme writes only the user's meme library, never the project.
  'search_memes',
  'find_memes_online',
  'refresh_meme_trends',
  'save_meme',
  'find_receipt',
  'search_sfx',
  'detect_faces',
  'validate_roast_edl',
  'edit_dna',
  // Vector catalogues and conversion: read-only, nothing touches the project.
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
  // Plugins: reading the library and a plugin's console.
  'plugin_sdk_reference',
  'list_plugins',
  'get_plugin',
  'plugin_logs',
]);

/** Tools that throw something away, which only Full access may do. */
const DESTRUCTIVE = new Set([
  'delete_project_items',
  'delete_tracks',
  'delete_clips',
  'remove_range',
  'remove_transitions',
  'delete_plugin',
]);

/** Whether a tool only looks — allowed in every mode, and to every plugin without asking. */
export const isReadTool = (name: string) =>
  READS.has(name) || ['editing_workflow_status', 'verify_edit_workflow', 'analyze_clip_speech', 'inspect_clip_frames', 'inspect_source_frames', 'analyze_song', 'review_frames', 'choose_shorts_format',
    // The frame size is the user's own answer, so even Plan only may ask it and apply it.
    'choose_comp_size'].includes(name);

/** Whether a tool throws work away (plugins ask before using one). */
export const isDestructiveTool = (name: string) => DESTRUCTIVE.has(name);

/**
 * What only Full access may do: delete things that are not timeline edits — tracks, comps, media,
 * plugins. Removing clips, ranges and transitions is an ordinary, undoable edit, and `apply_edit`
 * can do it anyway, so Auto-edit allows it rather than pretending to guard it.
 */
const FULL_ONLY = new Set(['delete_project_items', 'delete_tracks', 'delete_plugin']);

export const allowTool = (mode: PermissionMode, name: string): { ok: true } | { ok: false; reason: string } => {
  if (isReadTool(name)) return { ok: true };
  if (mode === 'plan') {
    return { ok: false, reason: 'Bhippi AI is in Plan only mode, so it cannot change the project. Describe the edit you would make, or ask the user to switch to Auto-edit.' };
  }
  if (mode === 'edit' && FULL_ONLY.has(name)) {
    return { ok: false, reason: 'Bhippi AI is in Auto-edit mode, which does not delete tracks, comps, project media or plugins. Say what you would delete and ask the user to switch to Full access.' };
  }
  return { ok: true };
};

// ── how hard the model should think ────────────────────────────────────────

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export const EFFORTS: { id: Effort; label: string; hint: string }[] = [
  { id: 'low', label: 'Fast', hint: 'Least thinking — quick edits and simple questions' },
  { id: 'medium', label: 'Balanced', hint: 'The default amount of thinking' },
  { id: 'high', label: 'Thorough', hint: 'More thinking, for multi-step edits' },
  { id: 'xhigh', label: 'Extra', hint: 'Between Thorough and Maximum, on the models that offer it' },
  { id: 'max', label: 'Maximum', hint: 'As much thinking as the model allows' },
];

export const DEFAULT_EFFORT: Effort = 'medium';

/** Providers whose backend passes the level through (see `effort_flag_args` in cli.rs). */
const HONOURS_EFFORT = new Set(['claude', 'codex', 'grok']);

export const supportsEffort = (providerId: string | null | undefined) => !!providerId && HONOURS_EFFORT.has(providerId);
