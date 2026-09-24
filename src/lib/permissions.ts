// How much Helios AI is allowed to do to the project without being asked.
//
// The assistant edits the timeline directly, so the mode is a real safety control, not a label:
// "Plan only" lets it look and suggest, "Auto-edit" lets it build, and "Full access" also lets it
// throw work away. Everything it does is one Undo (or the turn's Revert) away either mode.

export type PermissionMode = 'plan' | 'edit' | 'full';

export const PERMISSION_MODES: { id: PermissionMode; label: string; hint: string }[] = [
  { id: 'plan', label: 'Plan only', hint: 'Reads the project and answers; makes no edits' },
  { id: 'edit', label: 'Auto-edit', hint: 'Adds and changes clips; will not delete your work' },
  { id: 'full', label: 'Full access', hint: 'Also deletes clips, tracks, comps and media' },
];

export const DEFAULT_PERMISSION: PermissionMode = 'edit';

/** Tools that only look at the project. Always allowed. */
const READS = new Set([
  'online_research',
  'scrape_web_page',
  'web_search',
  'web_fetch',
  'read_file',
  'list_directory',
  'glob_search',
  'grep_search',
  'local_media_capabilities',
  'generation_job',
  'list_effects',
  'list_learned_skills',
  'list_custom_tools',
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
  'refresh_meme_trends',
  'save_meme',
  'find_receipt',
  'search_sfx',
  'detect_faces',
  'validate_roast_edl',
  'edit_dna',
]);

/** Tools that throw something away, which only Full access may do. */
const DESTRUCTIVE = new Set([
  'delete_project_items',
  'delete_tracks',
  'delete_clips',
  'remove_range',
  'remove_transitions',
]);

export const allowTool = (mode: PermissionMode, name: string): { ok: true } | { ok: false; reason: string } => {
  if (READS.has(name) || ['editing_workflow_status', 'verify_edit_workflow', 'analyze_clip_speech', 'inspect_clip_frames', 'inspect_source_frames'].includes(name)) return { ok: true };
  if (mode === 'plan') {
    return { ok: false, reason: 'Helios AI is in Plan only mode, so it cannot change the project. Describe the edit you would make, or ask the user to switch to Auto-edit.' };
  }
  if (mode === 'edit' && DESTRUCTIVE.has(name)) {
    return { ok: false, reason: 'Helios AI is in Auto-edit mode, which does not delete anything. Say what you would remove and ask the user to switch to Full access, or achieve it without deleting.' };
  }
  return { ok: true };
};

// ── how hard the model should think ────────────────────────────────────────

export type Effort = 'low' | 'medium' | 'high' | 'max';

export const EFFORTS: { id: Effort; label: string; hint: string }[] = [
  { id: 'low', label: 'Fast', hint: 'Least thinking — quick edits and simple questions' },
  { id: 'medium', label: 'Balanced', hint: 'The default amount of thinking' },
  { id: 'high', label: 'Thorough', hint: 'More thinking, for multi-step edits' },
  { id: 'max', label: 'Maximum', hint: 'As much thinking as the model allows' },
];

export const DEFAULT_EFFORT: Effort = 'medium';

/** Providers whose backend passes the level through (see `effort_flag_args` in cli.rs). */
const HONOURS_EFFORT = new Set(['claude', 'codex', 'grok']);

export const supportsEffort = (providerId: string | null | undefined) => !!providerId && HONOURS_EFFORT.has(providerId);
