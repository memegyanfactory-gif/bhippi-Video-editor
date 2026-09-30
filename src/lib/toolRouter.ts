// Token Council, rule 3: send the tools this video needs, not all of them.
//
// Every provider used to receive all ~190 tool definitions (~58 K tokens) on every step. The
// router reads what is being made (the message, the recent asks, the edit style) and names the
// tools that go out whole: a core every edit uses, plus the groups for the kinds of video
// detected. Every other tool still goes out, as a one-line entry whose parameters are one
// `tool_help` call away (src-tauri/src/ai_tools.rs `slim`), so nothing becomes unreachable.
//
// The detected kind also picks the playbook the model starts from (motionDirection.ts), so the
// studied beats and timing arrive with the brief instead of waiting for a discovery call.
import { playbook } from './motionDirection';

export type Genre = 'saas' | 'motion' | 'character2d' | '3d' | 'documentary' | 'meme' | 'edit' | 'shorts';

/** Used by every production: the workflow, reads, the plan, basic timeline edits, sound, QA. */
export const CORE_TOOLS = [
  'tool_help', 'editing_workflow_status', 'verify_edit_workflow', 'get_project', 'get_comp', 'ask_user', 'choose_comp_size',
  'save_storyboard', 'propose_storyboards', 'save_video_blueprint', 'execute_blueprint', 'attach_production_asset', 'finish_gathering',
  'place_clip', 'add_text', 'update_clip', 'delete_clips', 'split_clips', 'remove_range', 'add_tracks', 'import_media',
  'add_transition', 'seamless_transition', 'set_keyframes', 'add_marker', 'undo',
  'analyze_clip_speech', 'inspect_clip_frames', 'local_media_capabilities', 'find_free_media', 'download_online_media',
  'add_sound_effect', 'search_sfx', 'place_sfx', 'level_audio', 'analyze_music_beats', 'add_captions', 'set_caption_style',
  'motion_guide', 'list_motion_templates', 'create_motion_scene', 'get_motion_scene', 'update_motion_scene',
  'run_frame_qa', 'judge_edit', 'consult_council', 'check_pacing', 'write_file', 'edit_file',
] as const;

/** Bhippi's own score and background plates: no generator needed. Whole for the graphics-led kinds of video. */
const BUILTIN_MEDIA = ['compose_music', 'make_background'];

/**
 * What a model on the guided tier (modelProfile.ts) gets whole besides the kind of video's tools:
 * the one-call build and Bhippi's own media, which carry the craft a weaker model gets wrong.
 */
export const GUIDED_TOOLS = ['build_edit_from_brief', 'add_graphic', ...BUILTIN_MEDIA];

export const GENRE_TOOLS: Record<Genre, readonly string[]> = {
  saas: [
    'create_ui_screen', 'update_ui_screen', 'list_ui_kinds', 'capture_product_ui', 'extract_brand_from_url', 'scrape_web_page', 'online_research',
    'get_brand_guideline', 'apply_brand_kit', 'check_brand_compliance', 'create_motion_sequence', 'add_fx', 'search_icons', 'react_bits',
    'synthesize_speech_voiceover', 'add_voiceover', 'add_shape', ...BUILTIN_MEDIA,
  ],
  motion: [
    'create_motion_graphic', 'create_motion_sequence', 'add_fx', 'list_drawn_styles', 'check_motion_arcs', 'react_bits', 'remotion_kit',
    'import_lottie', 'list_transitions', 'svg_to_shape', 'search_icons', 'nest_motion_scenes', 'split_motion_layers', 'add_shape',
    'analyze_reference_video', 'save_style_profile', 'get_brand_guideline', ...BUILTIN_MEDIA,
  ],
  character2d: [
    'list_characters', 'list_character_actions', 'create_character', 'animate_character', 'lip_sync_character', 'create_motion_sequence',
    'add_fx', 'list_drawn_styles', 'check_motion_arcs', 'synthesize_speech_voiceover', 'add_voiceover', 'create_stick_figure',
  ],
  '3d': [
    'list_3d_presets', 'render_3d_scene', 'generate_local_media', 'generate_cloud_media', 'cloud_generation_capabilities', 'generation_job',
    'import_generated_media', 'depth_occlusion_clip', 'create_motion_sequence', 'add_fx',
  ],
  documentary: [
    'online_research', 'scrape_web_page', 'scrape_videos', 'query_frame_atlas', 'synthesize_speech_voiceover', 'add_voiceover', 'detect_scenes',
    'color_grade', 'inspect_color', 'score_audio_clip', 'track_people', 'layout_clip', 'fill_background', 'rotoscope_clip',
    'add_text_behind_subject', 'frame_hold', 'set_mask', 'create_project_guideline',
  ],
  meme: [
    'search_memes', 'find_memes_online', 'refresh_meme_trends', 'save_meme', 'get_meme_media', 'find_receipt', 'cutout_image', 'detect_faces',
    'key_green_screen', 'save_beat_sheet', 'roast_move', 'validate_roast_edl', 'apply_roast_edl', 'edit_dna', 'frame_hold',
  ],
  edit: [
    'apply_edit', 'list_recipes', 'apply_recipe', 'podcast_cut', 'detect_scenes', 'snap_cuts_to_beats', 'normalize_audio', 'color_grade',
    'inspect_color', 'layout_clip', 'fill_background', 'split_screen', 'frame_hold', 'set_mask', 'rotoscope_clip', 'track_people',
    'reveal_subject', 'erase_subject_clip', 'add_text_behind_subject', 'add_media_behind_subject', 'list_learned_skills', 'apply_learned_skill',
  ],
  shorts: ['choose_shorts_format', 'create_shorts', 'podcast_cut', 'layout_clip', 'track_people', 'fill_background', 'apply_recipe', 'list_recipes'],
};

/** Words that mark each kind of video (whole words, any case; Hinglish included where common). */
const SIGNALS: Record<Genre, RegExp> = {
  saas: /\b(saas|app|software|product|dashboard|ui|ux|feature|launch|demo|landing|website|startup|download|pricing|signup|onboarding)\b/i,
  motion: /\b(motion|graphics?|kinetic|animated?|animation|typography|title card|logo|brand film|explainer|infographic|lottie|hand[- ]?drawn|riso|sketch|doodle)\b/i,
  character2d: /\b(characters?|cartoon|mascot|2d|lip[- ]?sync|avatar|person walking|kai|priya|mira)\b/i,
  '3d': /\b(3d|three[- ]d|blender|cgi|isometric|3-d|glb)\b/i,
  documentary: /\b(documentary|docu|story of|history|interview|investigat|narrat|archival|case study|biography|explains? why)\b/i,
  meme: /\b(memes?|funny|roast|comedy|joke|reaction|viral|troll|shitpost|@funny|mazak|masti)\b/i,
  // Not "edit" or "cut" alone: nearly every ask says them.
  edit: /\b(trim|tighten|podcast|vlog|b-?roll|colou?r grade|grading|jump cuts?|footage|raw clips?|talking head|interview cut)\b/i,
  shorts: /\b(shorts?|reels?|tiktok|vertical|9:16|clips? for (instagram|youtube))\b/i,
};

/** Which playbook opens each kind of video (motionDirection.ts ids). */
export const PLAYBOOK_FOR: Record<Genre, string> = {
  saas: 'product-launch',
  character2d: 'character-explainer',
  '3d': '3d-promo',
  documentary: 'documentary',
  meme: 'meme-edit',
  shorts: 'normal-edit',
  motion: 'kinetic-type',
  edit: 'normal-edit',
};

/**
 * The premium films by name: an ask that names one opens its playbook (motionDirection.ts), which
 * carries what those films taught. Checked in order; the first that matches wins. Only names of
 * films: "to the song", a "demo reel", "brand identity" colours or a "real product" shot are
 * ordinary asks that keep their own playbook.
 */
const FILM_SIGNALS: [string, RegExp][] = [
  ['product-demo', /\b(product demo|demo (film|video))\b/i],
  ['identity-film', /\b(identity film|brand identity (film|video)|logo (reveal|film|animation)|glass (logo|mark))\b/i],
  ['kinetic-explainer', /\b((kinetic|motion[- ]design) explainer|crimson (look|explainer|brief))\b/i],
  ['fluid-saas', /\b(fluid (saas|film|video|launch)|relume)\b/i],
  ['launch-film', /\b(launch (film|video)|product film|real (app|ui)|meet \w+ film)\b/i],
];

/**
 * Tools that belong to one phase of a production: a turn in another phase gets them slim (still
 * callable through tool_help). Most of a production's steps are edit steps, and the plan tools'
 * schemas alone are ~12 K characters.
 */
const PLAN_ONLY = ['save_storyboard', 'propose_storyboards', 'save_video_blueprint'];
const GATHER_ONLY = ['execute_blueprint', 'attach_production_asset', 'finish_gathering'];
const EDIT_ONLY = [
  'place_clip', 'update_clip', 'delete_clips', 'split_clips', 'remove_range', 'add_tracks', 'add_transition', 'seamless_transition', 'set_keyframes',
  'add_marker', 'undo', 'run_frame_qa', 'judge_edit', 'add_captions', 'set_caption_style', 'level_audio', 'add_sound_effect', 'place_sfx',
  'create_motion_scene', 'update_motion_scene', 'get_motion_scene', 'build_edit_from_brief',
];

function forPhase(full: Set<string>, phase: string | null | undefined) {
  const drop = (names: string[]) => names.forEach((name) => full.delete(name));
  if (phase === 'editing' || phase === 'polishing' || phase === 'done') drop([...PLAN_ONLY, ...GATHER_ONLY]);
  else if (phase === 'planning' || phase === 'plan-ready') drop([...EDIT_ONLY, ...GATHER_ONLY]);
  else if (phase === 'gathering' || phase === 'gathered') drop([...PLAN_ONLY, ...EDIT_ONLY]);
  // No production yet (a quick edit, or a plan about to start): every phase's tools stay whole.
}

export type Toolset = { genres: Genre[]; full: string[]; playbook?: { id: string; title: string; beats: unknown; look: unknown; timing: unknown; rules: unknown; gaps?: unknown; templates?: unknown; vary?: unknown } };

/**
 * The kinds of video in this ask (the message first, then recent asks for a follow-up like
 * "continue"), and the tools to send whole for them.
 */
export function routeTools(message: string, earlier: string[] = [], editStyle?: string | null, phase?: string | null, guided = false): Toolset {
  const detect = (text: string) => (Object.keys(SIGNALS) as Genre[]).filter((genre) => SIGNALS[genre].test(text));
  let genres = detect(message);
  if (!genres.length) genres = detect(earlier.slice(-4).join('\n'));
  if (editStyle === 'funny' && !genres.includes('meme')) genres.push('meme');
  // Nothing recognisable: an ordinary edit with motion graphics covers most asks.
  if (!genres.length) genres = ['edit', 'motion'];
  const full = new Set<string>(CORE_TOOLS);
  for (const genre of genres) for (const tool of GENRE_TOOLS[genre]) full.add(tool);
  if (guided) for (const tool of GUIDED_TOOLS) full.add(tool);
  forPhase(full, phase);
  // A drawn look (riso, sketchbook, paper) opens with the hand-made playbook built from the drawn films.
  const drawn = /\b(hand[- ]?drawn|hand[- ]?made|riso|sketch(book)?|doodle|paper|ink|crayon|pencil)\b/i.test(`${message}\n${earlier.slice(-4).join('\n')}`);
  const film = FILM_SIGNALS.find(([, signal]) => signal.test(`${message}\n${earlier.slice(-4).join('\n')}`))?.[0];
  // A walkthrough or tutorial of software reads differently from an ad for it.
  const walkthrough = /\b(walkthrough|tutorial|how to use|onboarding|step by step|demo of)\b/i.test(message);
  const opening = drawn ? 'hand-made' : film ?? (genres.includes('saas') && walkthrough ? 'ui-walkthrough' : PLAYBOOK_FOR[genres[0]]);
  const book = opening ? playbook(opening) : null;
  return {
    genres,
    full: [...full],
    ...(book ? { playbook: { id: book.id, title: book.title, beats: book.beats, look: book.look, timing: book.timing, rules: book.rules, ...(book.gaps ? { gaps: book.gaps } : {}), ...(book.templates ? { templates: book.templates } : {}), ...(book.vary ? { vary: book.vary } : {}) } } : {}),
  };
}
