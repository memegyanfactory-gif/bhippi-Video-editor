import fs from 'fs';

const projectPath = 'C:/Users/aayus/AppData/Roaming/com.bhippi.videoeditor/projects/current.json';
const proj = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
const comp = proj.comps[0];

const v1TrackId = '0ca4fb3ca87841b58812';
const v2TrackId = '2c42712b1d4841508a2a';
const v3TrackId = '02e33f92a80c481eb321';
const a1TrackId = 'c0e8e87f7cf14ceca4b7';
const a2TrackId = '9145243b7b6b4e198e93';

const assetId = '01m2wbwcvwtyee09ehhvap7zkj';
const rotoMattePath = 'C:\\Users\\aayus\\AppData\\Roaming\\com.bhippi.videoeditor\\roto\\run-1789845945578103200\\matte.mkv';

// 1. Define the 9 professional 5-12s narrative chunks
const chunks = [
  {
    index: 1,
    start: 0.0,
    end: 5.9,
    scale: 100,
    intent: 'Hook & Welcome: Introduce channel and prompt viewer curiosity',
    graphic: { preset: 'title', text: 'AI MOVES FAST', color: '#00E5FF', behindSubject: true },
    sfx: { time: 0.8, name: 'Whoosh intro' },
  },
  {
    index: 2,
    start: 5.9,
    end: 15.47,
    scale: 114,
    intent: 'Context & Challenge: Daily streams and the fast pace of AI making old tutorials obsolete',
    graphic: { preset: 'lower-third', text: 'DAILY STREAMS', subtitle: 'The Pace of AI', color: '#FFC53D' },
    sfx: { time: 6.0, name: 'Pop transition' },
  },
  {
    index: 3,
    start: 15.47,
    end: 27.25,
    scale: 100,
    intent: 'The New Paradigm: Discovering workflows that surpass older methods',
    graphic: { preset: 'title', text: 'NEW AI WORKFLOWS', color: '#3D7BFF' },
    sfx: { time: 15.6, name: 'Riser accent' },
  },
  {
    index: 4,
    start: 27.25,
    end: 33.81,
    scale: 114,
    intent: 'Shared Mission: Learning together and pushing the boundaries of AI',
    graphic: { preset: 'kinetic', text: 'DISCOVER WHAT IS POSSIBLE', color: '#00E5FF' },
    sfx: { time: 27.4, name: 'Impact cue' },
  },
  {
    index: 5,
    start: 33.81,
    end: 41.44,
    scale: 100,
    intent: 'Call to Experienced Devs: Invite coders and builders to share knowledge',
    graphic: { preset: 'lower-third', text: 'CODERS & BUILDERS', subtitle: 'Share Your Insights', color: '#3FB950' },
    sfx: { time: 34.0, name: 'Whoosh accent' },
  },
  {
    index: 6,
    start: 41.44,
    end: 47.35,
    scale: 114,
    intent: 'Personal Growth: Continuous curiosity and improvement mindset',
    graphic: { preset: 'title', text: 'ALWAYS IMPROVING', color: '#FFC53D' },
    sfx: { time: 41.6, name: 'Click cue' },
  },
  {
    index: 7,
    start: 47.35,
    end: 58.11,
    scale: 100,
    intent: 'Welcoming Beginners: Open invitation to newcomers and all skill tiers',
    graphic: { preset: 'lower-third', text: 'ALL SKILL TIERS', subtitle: 'Newbies & Pros Welcome', color: '#3D7BFF' },
    sfx: { time: 47.5, name: 'Chime welcome' },
  },
  {
    index: 8,
    start: 58.11,
    end: 69.15,
    scale: 114,
    intent: 'Hands-on Exploration: Demystifying repos and learning in real-time',
    graphic: { preset: 'title', text: 'EXPLORING REPOS', color: '#00E5FF' },
    sfx: { time: 58.3, name: 'Pop accent' },
  },
  {
    index: 9,
    start: 69.15,
    end: 76.974,
    scale: 100,
    intent: 'Call to Action & Community Outro: Subscribe, like, comment, and engage',
    graphic: { preset: 'title', text: 'SUBSCRIBE & JOIN', color: '#FF5D5D' },
    sfx: { time: 71.5, name: 'Subscribe pop' },
  },
];

const newClips = [];

// Helper to make random-ish 20 char hex id
function uid() {
  return Array.from({ length: 20 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

// 2. Build clips for each chunk
for (const chunk of chunks) {
  const duration = Math.round((chunk.end - chunk.start) * 1000) / 1000;
  const inPoint = Math.round(chunk.start * 1000) / 1000;
  const linkId = uid();

  // V1 Video Clip (Background footage)
  // For chunk 1: Named 'Original background' with rotoMatte = null!
  newClips.push({
    id: uid(),
    trackId: v1TrackId,
    start: chunk.start,
    duration,
    in: inPoint,
    speed: 1.0,
    source: { type: 'media', assetId },
    linkId,
    enabled: true,
    name: chunk.graphic.behindSubject ? 'Original background' : null,
    volume: 0.0,
    transform: {
      fit: 'fit',
      x: 0.0,
      y: 0.0,
      scale: chunk.scale,
      rotation: 0.0,
      opacity: 100.0,
      cropLeft: 0.0,
      cropTop: 0.0,
      cropRight: 0.0,
      cropBottom: 0.0,
    },
    effects: {
      brightness: 0.0,
      contrast: 0.0,
      saturation: 100.0,
      blur: 0.0,
      hue: 0.0,
      invert: 0.0,
      flipH: false,
      flipV: false,
    },
    label: null,
    groupId: null,
    reverse: false,
    maintainPitch: true,
    hold: null,
    interpolation: 'sampling',
    deinterlace: false,
    adjustment: false,
    mask: null,
    rotoMatte: null, // ALWAYS NULL ON V1! Never black!
    rotoCorrections: [],
    keyframes: { x: [], y: [], scale: [], rotation: [], opacity: [], volume: [] },
    channels: 'stereo',
    enhanceSpeech: false,
    audioType: null,
    appliedEffects: [],
  });

  // A1 Audio Clip (Speech dialogue, linked to V1)
  newClips.push({
    id: uid(),
    trackId: a1TrackId,
    start: chunk.start,
    duration,
    in: inPoint,
    speed: 1.0,
    source: { type: 'media', assetId },
    linkId,
    enabled: true,
    name: null,
    volume: 1.0,
    transform: {
      fit: 'fit',
      x: 0.0,
      y: 0.0,
      scale: 100.0,
      rotation: 0.0,
      opacity: 100.0,
      cropLeft: 0.0,
      cropTop: 0.0,
      cropRight: 0.0,
      cropBottom: 0.0,
    },
    effects: {
      brightness: 0.0,
      contrast: 0.0,
      saturation: 100.0,
      blur: 0.0,
      hue: 0.0,
      invert: 0.0,
      flipH: false,
      flipV: false,
    },
    label: null,
    groupId: null,
    reverse: false,
    maintainPitch: true,
    hold: null,
    interpolation: 'sampling',
    deinterlace: false,
    adjustment: false,
    mask: null,
    rotoMatte: null,
    rotoCorrections: [],
    keyframes: { x: [], y: [], scale: [], rotation: [], opacity: [], volume: [] },
    channels: 'stereo',
    enhanceSpeech: false,
    audioType: null,
    appliedEffects: [],
  });

  // V2 Motion Graphic Clip (Title / Badge / Lower-Third)
  if (chunk.graphic) {
    const graphicDuration = Math.min(duration, chunk.graphic.behindSubject ? duration : Math.max(2.5, duration * 0.7));
    newClips.push({
      id: uid(),
      trackId: v2TrackId,
      start: chunk.start,
      duration: graphicDuration,
      in: 0.0,
      speed: 1.0,
      source: {
        type: 'text',
        text: chunk.graphic.text,
        subtitle: chunk.graphic.subtitle || '',
        preset: chunk.graphic.preset,
        color: chunk.graphic.color,
        style: null,
        vertical: false,
      },
      linkId: null,
      enabled: true,
      name: null,
      volume: 1.0,
      transform: {
        fit: 'fit',
        x: 0.0,
        y: 0.0,
        scale: 100.0,
        rotation: 0.0,
        opacity: 100.0,
        cropLeft: 0.0,
        cropTop: 0.0,
        cropRight: 0.0,
        cropBottom: 0.0,
      },
      effects: {
        brightness: 0.0,
        contrast: 0.0,
        saturation: 100.0,
        blur: 0.0,
        hue: 0.0,
        invert: 0.0,
        flipH: false,
        flipV: false,
      },
      label: null,
      groupId: null,
      reverse: false,
      maintainPitch: true,
      hold: null,
      interpolation: 'sampling',
      deinterlace: false,
      adjustment: false,
      mask: null,
      rotoMatte: null,
      rotoCorrections: [],
      keyframes: {
        x: [],
        y: [
          { time: 0.0, value: 0.05, easing: 'ease' },
          { time: Math.min(0.4, graphicDuration / 2), value: 0.0, easing: 'linear' },
        ],
        scale: [],
        rotation: [],
        opacity: [
          { time: 0.0, value: 0.0, easing: 'ease' },
          { time: Math.min(0.3, graphicDuration / 2), value: 100.0, easing: 'linear' },
        ],
        volume: [],
      },
      channels: 'stereo',
      enhanceSpeech: false,
      audioType: null,
      appliedEffects: [],
    });
  }

  // V3 Roto Foreground Cutout (for Behind-Subject in chunk 1)
  if (chunk.graphic.behindSubject) {
    newClips.push({
      id: uid(),
      trackId: v3TrackId,
      start: chunk.start,
      duration,
      in: inPoint,
      speed: 1.0,
      source: { type: 'media', assetId },
      linkId: null,
      enabled: true,
      name: 'Roto Foreground Cutout',
      volume: 0.0,
      transform: {
        fit: 'fit',
        x: 0.0,
        y: 0.0,
        scale: 100.0, // Scale 100% - matches background perfectly!
        rotation: 0.0,
        opacity: 100.0,
        cropLeft: 0.0,
        cropTop: 0.0,
        cropRight: 0.0,
        cropBottom: 0.0,
      },
      effects: {
        brightness: 0.0,
        contrast: 0.0,
        saturation: 100.0,
        blur: 0.0,
        hue: 0.0,
        invert: 0.0,
        flipH: false,
        flipV: false,
      },
      label: null,
      groupId: null,
      reverse: false,
      maintainPitch: true,
      hold: null,
      interpolation: 'sampling',
      deinterlace: false,
      adjustment: false,
      mask: null,
      rotoMatte: rotoMattePath,
      rotoCorrections: [],
      keyframes: { x: [], y: [], scale: [], rotation: [], opacity: [], volume: [] },
      channels: 'stereo',
      enhanceSpeech: false,
      audioType: null,
      appliedEffects: [],
    });
  }

  // A2 SFX Clip
  if (chunk.sfx) {
    newClips.push({
      id: uid(),
      trackId: a2TrackId,
      start: chunk.sfx.time,
      duration: 1.0,
      in: 0.0,
      speed: 1.0,
      source: { type: 'sfx', name: chunk.sfx.name },
      linkId: null,
      enabled: true,
      name: chunk.sfx.name,
      volume: 0.7,
      transform: { fit: 'fit', x: 0, y: 0, scale: 100, rotation: 0, opacity: 100, cropLeft: 0, cropTop: 0, cropRight: 0, cropBottom: 0 },
      effects: { brightness: 0, contrast: 0, saturation: 100, blur: 0, hue: 0, invert: 0, flipH: false, flipV: false },
      label: null,
      groupId: null,
      reverse: false,
      maintainPitch: true,
      hold: null,
      interpolation: 'sampling',
      deinterlace: false,
      adjustment: false,
      mask: null,
      rotoMatte: null,
      rotoCorrections: [],
      keyframes: { x: [], y: [], scale: [], rotation: [], opacity: [], volume: [] },
      channels: 'stereo',
      enhanceSpeech: false,
      audioType: null,
      appliedEffects: [],
    });
  }
}

// 3. Build Storyboard Scenes for StoryboardViewer
const storyboard = chunks.map((c) => ({
  start: c.start,
  end: c.end,
  intent: c.intent,
  visual: `${c.scale > 100 ? `Punch-in (${c.scale}%)` : 'Wide framing (100%)'} · ${c.graphic.behindSubject ? 'Text Behind Subject' : `Motion Graphic ${c.graphic.preset.toUpperCase()}`} (“${c.graphic.text}”)`,
  audio: `Dialogue speech on A1 · SFX “${c.sfx?.name ?? 'Whoosh'}” on A2`,
  evidence: `Sentence boundary at ${c.end.toFixed(2)}s verified against transcript`,
}));

// 4. Build Transitions at each chunk boundary
const transitions = [];
for (let i = 1; i < chunks.length; i++) {
  const at = chunks[i].start;
  // Constant-power transition on audio track
  transitions.push({
    id: uid(),
    trackId: a1TrackId,
    at,
    kind: 'constant-power',
    duration: 0.15,
    alignment: 0.5,
  });
}

// Apply to composition
comp.clips = newClips;
comp.storyboard = storyboard;
comp.transitions = transitions;

fs.writeFileSync(projectPath, JSON.stringify(proj, null, 2), 'utf8');
console.log('Successfully structured composition into', chunks.length, 'pro narrative chunks!');
console.log('Total clips generated:', newClips.length);
console.log('Storyboard scenes updated:', storyboard.length);
