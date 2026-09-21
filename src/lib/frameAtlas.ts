/**
 * Frame Atlas Cinematic Reference & Taxonomy Engine
 * Extracted and adapted from Frame Atlas Collection Kit and Frame-Atlas.html
 */

export interface FrameAtlasTaxonomy {
  imageKind: string[];
  shotSize: string[];
  cameraAngle: string[];
  viewRelationship: string[];
  apparentColorTone: string[];
  perceivedTime: string[];
  setting: string[];
  visibleLightDirection: string[];
  lightQuality: string[];
  lightPatterns: string[];
  composition: string[];
  interpretiveMood: string[];
  movementEvidence: string[];
  rules: string[];
}

export interface FrameStudy {
  id: string;
  title: string;
  year?: number;
  director?: string;
  dp?: string;
  shot: string;
  lighting: string;
  palette: string[];
  tags: string[];
  aspect?: string;
  notes?: string;
}

export const FRAME_ATLAS_TAXONOMY: FrameAtlasTaxonomy = {
  imageKind: [
    'film_frame',
    'tv_episode_frame',
    'animation_frame',
    'production_still',
    'publicity_still',
    'music_video_frame',
    'commercial_frame',
    'photograph',
    'poster',
  ],
  shotSize: [
    'extreme_wide',
    'wide',
    'full',
    'medium_wide',
    'medium',
    'medium_close_up',
    'close_up',
    'extreme_close_up',
    'insert',
  ],
  cameraAngle: [
    'eye_level',
    'high',
    'low',
    'overhead',
    'ground_level',
    'dutch',
  ],
  viewRelationship: [
    'frontal',
    'profile',
    'rear',
    'over_shoulder',
    'point_of_view',
  ],
  apparentColorTone: [
    'warm',
    'cool',
    'mixed',
    'neutral',
    'monochrome',
  ],
  perceivedTime: [
    'daylight',
    'golden_hour_look',
    'blue_hour_look',
    'night_look',
    'dawn_or_dusk_look',
    'indeterminate',
  ],
  setting: [
    'interior',
    'exterior',
    'mixed',
  ],
  visibleLightDirection: [
    'front',
    'side',
    'back',
    'top',
    'underlight',
    'multiple',
  ],
  lightQuality: [
    'hard',
    'soft',
    'mixed',
  ],
  lightPatterns: [
    'silhouette',
    'rim_light',
    'window_pattern',
    'practical_in_frame',
    'screen_light_look',
    'volumetric_beams',
    'low_key',
    'high_key',
    'mixed_color_sources',
  ],
  composition: [
    'symmetry',
    'centered',
    'off_center',
    'negative_space',
    'leading_lines',
    'frame_within_frame',
    'foreground_layers',
    'diagonals',
    'deep_focus_look',
    'shallow_focus_look',
    'multiple_focal_points',
  ],
  interpretiveMood: [
    'intimate',
    'isolated',
    'tense',
    'calm',
    'joyful',
    'ominous',
    'nostalgic',
    'awe',
    'ambiguous',
  ],
  movementEvidence: [
    'static',
    'pan',
    'tilt',
    'dolly',
    'tracking',
    'crane',
    'handheld',
    'orbit',
    'zoom',
    'dolly_zoom',
  ],
  rules: [
    'Measure HEX values from actual image pixels with declared color-management rules.',
    'Never invent exact lens focal length or camera metadata from appearance alone.',
    'Camera movement requires temporal evidence or explicit camera blocking instructions.',
    'Mood and time-of-day appearance are interpretations; keep them aligned with narrative beat.',
    'Low-key and silhouette lighting are essential references, not defects.',
    'Foreground layering and depth planes give cinematic weight to flat compositions.',
  ],
};

export const FRAME_STUDIES: FrameStudy[] = [
  {
    id: 'tos-00',
    title: 'Scale before the story',
    year: 2012,
    shot: 'extreme_wide',
    lighting: 'Backlight + atmosphere',
    palette: ['#1A2229', '#3D4A54', '#7D8C94', '#C2CBD1'],
    tags: ['establishing', 'worldbuilding', 'architecture', 'haze', 'muted', 'scale', 'city', 'backlit', 'awe'],
    notes: 'Massive atmospheric architecture establishes environment scale before any subject dialogue begins.',
  },
  {
    id: 'spring-alpha',
    title: 'Small figure. Enormous unknown.',
    year: 2019,
    shot: 'wide',
    lighting: 'Shafts of volumetric light',
    palette: ['#0A121A', '#133547', '#25728C', '#68C3D4'],
    tags: ['blue', 'cyan', 'teal', 'low key', 'silhouette', 'scale', 'fantasy', 'mystery', 'volumetric', 'negative space', 'isolated'],
    notes: 'Volumetric light beams cutting through deep teal darkness create mystery and a feeling of isolation.',
  },
  {
    id: 'tos-04h',
    title: 'Technology between us',
    year: 2012,
    shot: 'close_up',
    lighting: 'Practical + graphic glow',
    palette: ['#0F0814', '#381647', '#00E5FF', '#FF007F'],
    tags: ['magenta', 'cyan', 'green', 'interface', 'layers', 'reaction', 'sci-fi', 'portrait', 'graphic overlay', 'intimate'],
    notes: 'HUD graphic glow casts vivid magenta and cyan highlights across the face, placing tech directly in the frame.',
  },
  {
    id: 'spring-final',
    title: 'Let the light feel like relief',
    year: 2019,
    shot: 'wide',
    lighting: 'Low sun / side light',
    palette: ['#1C2414', '#4D5E33', '#C2A14D', '#F4E5B0'],
    tags: ['golden', 'warm highlights', 'cool shadows', 'landscape', 'green', 'journey', 'relief', 'daylight', 'calm'],
    notes: 'Warm low-angle sunlight washing over lush greens after darkness delivers emotional resolution and calm.',
  },
  {
    id: 'tos-01',
    title: 'A conversation with breathing room',
    year: 2012,
    shot: 'medium_wide',
    lighting: 'Soft daylight',
    palette: ['#1F2926', '#4E6157', '#93A89C', '#DFE8E2'],
    tags: ['dialogue', 'green', 'canal', 'bridge', 'gesture', 'relationship', 'natural light', 'two people', 'calm'],
    notes: 'Natural diffused daylight with deep depth of field gives characters physical space to converse naturally.',
  },
  {
    id: 'sintel-flight',
    title: 'Reach into the frame',
    year: 2010,
    shot: 'medium',
    lighting: 'Warm directional light',
    palette: ['#301B0E', '#7A431F', '#D4853B', '#F5C87A'],
    tags: ['orange', 'gold', 'dragon', 'reaching', 'diagonal', 'fantasy', 'flight', 'action', 'warm sky', 'joyful'],
    notes: 'Strong diagonal composition with warm golden rim light pushes action directly toward the viewer.',
  },
  {
    id: 'tos-03a',
    title: 'A city under a cold sky',
    year: 2012,
    shot: 'extreme_wide',
    lighting: 'Diffuse sky + atmosphere',
    palette: ['#0B1721', '#1C3A52', '#5882A3', '#B0D0E6'],
    tags: ['blue', 'cyan', 'city', 'establishing', 'sci-fi', 'architecture', 'smoke', 'scale', 'cold daylight', 'ominous'],
    notes: 'Desaturated cyan-blue tones with drifting smoke establish a chilling dystopian metropolis.',
  },
  {
    id: 'tos-04b',
    title: 'A room inside the ruins',
    year: 2012,
    shot: 'wide',
    lighting: 'Practical lamps + daylight',
    palette: ['#1A1712', '#473B28', '#857859', '#D9CDB8'],
    tags: ['amber', 'olive', 'lamps', 'ruins', 'greenery', 'reveal', 'environment', 'threshold', 'layered', 'nostalgic'],
    notes: 'Layered doorway reveals interior contrast between warm practical tungsten bulbs and cool daylight.',
  },
  {
    id: 'tos-02',
    title: 'Make the foreground matter',
    year: 2012,
    shot: 'close_up',
    lighting: 'Colored practical glow',
    palette: ['#1E0A1A', '#521D47', '#B84D98', '#FFA8E5'],
    tags: ['amber', 'pink', 'magenta', 'science', 'prop', 'focus', 'portrait', 'experiment', 'layering', 'intimate'],
    notes: 'Shallow focus on a glowing translucent foreground prop creates depth and tactile intimacy.',
  },
  {
    id: 'tos-07',
    title: 'Put energy on the diagonal',
    year: 2012,
    shot: 'medium',
    lighting: 'Hard side light + haze',
    palette: ['#1E1609', '#543F1A', '#A3823D', '#FCE79F'],
    tags: ['gold', 'action', 'rope', 'haze', 'hard light', 'edge light', 'intensity', 'gesture', 'tense'],
    notes: 'Hard tungsten rim lighting slicing through dense haze emphasizes muscular effort and dynamic tension.',
  },
];

export interface FrameAtlasQueryOptions {
  mood?: string;
  shotSize?: string;
  lighting?: string;
  tone?: string;
  search?: string;
  limit?: number;
}

export interface FrameAtlasQueryResult {
  matches: FrameStudy[];
  recommendedPalette: string[];
  stylingDirectives: {
    shotSize: string;
    lighting: string;
    composition: string;
    cameraMovement: string;
    colorTone: string;
  };
}

export function queryFrameAtlas(options: FrameAtlasQueryOptions = {}): FrameAtlasQueryResult {
  const { mood, shotSize, lighting, tone, search, limit = 4 } = options;
  const searchLower = (search || '').toLowerCase();
  const moodLower = (mood || '').toLowerCase();
  const shotLower = (shotSize || '').toLowerCase();
  const lightLower = (lighting || '').toLowerCase();
  const toneLower = (tone || '').toLowerCase();

  const scored = FRAME_STUDIES.map((study) => {
    let score = 0;
    const studyTags = study.tags.map((t) => t.toLowerCase());

    if (moodLower && (studyTags.includes(moodLower) || study.notes?.toLowerCase().includes(moodLower))) {
      score += 5;
    }
    if (shotLower && (study.shot.toLowerCase().includes(shotLower) || studyTags.includes(shotLower))) {
      score += 4;
    }
    if (lightLower && (study.lighting.toLowerCase().includes(lightLower) || studyTags.includes(lightLower))) {
      score += 4;
    }
    if (toneLower && studyTags.includes(toneLower)) {
      score += 3;
    }
    if (searchLower) {
      if (study.title.toLowerCase().includes(searchLower)) score += 3;
      if (studyTags.some((t) => t.includes(searchLower))) score += 2;
      if (study.notes?.toLowerCase().includes(searchLower)) score += 2;
    }
    return { study, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const matches = scored.slice(0, Math.max(1, limit)).map((s) => s.study);

  // Derive recommended palette from top matches
  const palettePool = matches.flatMap((m) => m.palette);
  const recommendedPalette = Array.from(new Set(palettePool)).slice(0, 5);

  const topMatch = matches[0] || FRAME_STUDIES[0];
  const stylingDirectives = {
    shotSize: topMatch.shot,
    lighting: topMatch.lighting,
    composition: topMatch.tags.find((t) => ['diagonal', 'layered', 'silhouette', 'negative space', 'establishing'].includes(t)) || 'layered foreground',
    cameraMovement: moodLower.includes('tense') || moodLower.includes('action') ? 'handheld or dynamic tracking' : 'smooth cinematic dolly or slow push-in',
    colorTone: topMatch.tags.find((t) => ['golden', 'blue', 'teal', 'amber', 'magenta', 'cyan'].includes(t)) || 'cinematic neutral',
  };

  return {
    matches,
    recommendedPalette: recommendedPalette.length ? recommendedPalette : ['#0B0E14', '#1A2332', '#00E5FF', '#F5F7FA'],
    stylingDirectives,
  };
}

export interface WanPromptSpec {
  subject: string;
  background?: string;
  foreground?: string;
  cameraMovement?: string;
  lighting?: string;
  colorTone?: string;
  shotSize?: string;
  mood?: string;
  extraPrompt?: string;
}

export interface WanPromptResult {
  prompt: string;
  negativePrompt: string;
  frames: number;
  durationSeconds: number;
  width: number;
  height: number;
}

/**
 * Builds an ultra-detailed, cinematic prompt strictly formatted for local Wan 2.1 Diffusers.
 * Enforces maximum 5.0 seconds duration (at 16 fps, max 81 frames).
 */
export function buildWanCinematicPrompt(spec: WanPromptSpec): WanPromptResult {
  const {
    subject,
    background = 'atmospheric architectural environment with subtle volumetric haze and depth of field',
    foreground = 'subtle framing elements in soft focus creating depth layers',
    cameraMovement = 'slow smooth cinematic forward dolly tracking shot, steady and stabilized',
    lighting = 'cinematic natural lighting with gentle rim light and soft ambient bounce',
    colorTone = 'curated cinematic palette with balanced contrast and deep rich shadows',
    shotSize = 'medium shot',
    mood = 'focused, cinematic, premium quality',
    extraPrompt = '',
  } = spec;

  const promptParts = [
    `${shotSize} of ${subject}`,
    `Main Focus: ${subject}, distinct silhouette, sharp fine detail, photorealistic materials and realistic motion`,
    `Background: ${background}`,
    `Foreground: ${foreground}`,
    `Camera Movement: ${cameraMovement}`,
    `Lighting & Atmosphere: ${lighting}, volumetric light, realistic illumination`,
    `Color & Tone: ${colorTone}, 35mm film aesthetic, professional color grade, mood: ${mood}`,
  ];

  if (extraPrompt) {
    promptParts.push(extraPrompt);
  }

  const prompt = promptParts.join('. ');

  const negativePrompt = (
    'blurry, distorted, low quality, bad anatomy, deformed, ugly, flickering, stuttering, '
    + 'jittery camera, erratic movement, static frozen image, plastic skin, cartoon, 3d render artifacts, '
    + 'oversaturated, washed out, amateur phone footage, watermark, text, signature, logo, compression artifacts'
  );

  // Maximum allowed for Wan local model is 5 seconds (81 frames at 16 fps = 5.06s, which meets 4n+1 Wan requirement)
  const frames = 81;
  const durationSeconds = 5.0;

  return {
    prompt,
    negativePrompt,
    frames,
    durationSeconds,
    width: 832,
    height: 480,
  };
}
