import fs from 'fs';

const path = 'C:/Users/aayus/AppData/Roaming/com.bhippi.videoeditor/projects/current.json';
const proj = JSON.parse(fs.readFileSync(path, 'utf8'));
const comp = proj.comps[0];

const richScenes = [
  {
    title: 'Cold-open hook establishing high-energy identity',
    start: 0.0,
    end: 5.9,
    description: 'Punch-in from 100% to 114% scale on subject framing, cutting raw head pause and superimposing kinetic title to hook viewer in first 2 seconds.',
    intent: 'Hook & Welcome: Introduce channel and prompt viewer curiosity with high-energy punch-in and kinetic title',
    visual: 'Fast push-in, kinetic title, high-energy montage',
    audio: 'Subtle riser on A3, music bed starts ducked -18dB on A2',
    prompt: 'Cinematic 16:9 video storyboard frame: tech speaker silhouette at desk in dark modern studio with floating neon holographic screens and cyan kinetic title AI MOVES FAST, volumetric atmospheric lighting',
    evidence: 'Sentence boundary at 5.90s verified against transcript'
  },
  {
    title: 'Introduce daily streaming cadence',
    start: 5.9,
    end: 15.47,
    description: 'Return to 100% neutral framing at 5.9s, then introduce lower-third with "DAILY LIVE STREAMS" anchored bottom-left.',
    intent: 'Context & Challenge: Daily streams and the fast pace of AI making old tutorials obsolete',
    visual: 'Streamer at desk, lower-third title, clean framing',
    audio: 'Whoosh transition SFX, dialogue on A1, music continues',
    prompt: 'Cinematic 16:9 video storyboard frame: streamer at desk with glowing monitors, modern dark cozy setup, lower-third graphic DAILY LIVE STREAMS with neon checklist items LEARN, BUILD, SHARE, GROW',
    evidence: 'Sentence boundary at 15.47s verified against transcript'
  },
  {
    title: 'Showcase breakthrough depth separation',
    start: 15.47,
    end: 27.25,
    description: 'Execute subject rotoscope matte on V1 shot, insert bold neon title "ADVANCED AI WORKFLOWS" with background/foreground separation.',
    intent: 'The New Paradigm: Discovering workflows that surpass older methods using AI depth separation',
    visual: 'Rotoscope matte, depth separation, before/after split',
    audio: 'Impact punch at 14.8s, music swells +4dB then ducks -16dB',
    prompt: 'Cinematic 16:9 video storyboard frame: comparison split screen BEFORE wireframe 3D mesh and AFTER glowing neon sneaker with cyan and purple particle aura, depth separation effects',
    evidence: 'Sentence boundary at 27.25s verified against transcript'
  },
  {
    title: 'Welcome newcomers with accessible onboarding',
    start: 27.25,
    end: 33.81,
    description: 'Alternative cut with 108% scale, overlay minimal floating graphics to welcome new members and encourage participation.',
    intent: 'Shared Mission: Learning together and pushing the boundaries of AI with accessible onboarding',
    visual: 'Character/mascot, clean UI checklist, friendly framing',
    audio: 'Warm chime accent, dialogue on A1, music ducked -17dB',
    prompt: 'Cinematic 16:9 video storyboard frame: cute friendly white 3D robot mascot with glowing blue eyes, dark tech background, modern UI card WELCOME CREATORS with green checklist items',
    evidence: 'Sentence boundary at 33.81s verified against transcript'
  },
  {
    title: 'Break down GitHub repositories',
    start: 33.81,
    end: 41.44,
    description: 'Wide framing composite, show repository structure and explain how to clone and contribute.',
    intent: 'Call to Experienced Devs: Invite coders and builders to share knowledge and explore repositories',
    visual: 'GitHub UI, callout graphics, cursor animation',
    audio: 'Subtle pop SFX, dialogue on A1, steady music on A2',
    prompt: 'Cinematic 16:9 video storyboard frame: dark modern GitHub web interface, Octocat logo, repository files, bold text Open Source Real Impact, glowing button Star repo with mouse pointer',
    evidence: 'Sentence boundary at 41.44s verified against transcript'
  },
  {
    title: 'Highlight collaborative problem solving',
    start: 41.44,
    end: 47.35,
    description: 'Use chat overlays and animated badges to show real community collaboration and problem solving.',
    intent: 'Personal Growth: Continuous curiosity and collaborative improvement mindset',
    visual: 'Chat bubbles, avatars, animated text',
    audio: 'Fast whoosh SFX, music crescendos +3dB',
    prompt: 'Cinematic 16:9 video storyboard frame: dark modern collaborative app with glowing message bubbles showing user avatars and messages, neon handwriting text Build Learn Together',
    evidence: 'Sentence boundary at 47.35s verified against transcript'
  },
  {
    title: 'Showcase community creations',
    start: 47.35,
    end: 58.11,
    description: 'Dynamic multi-window collage showing user-submitted creations with animated border highlights.',
    intent: 'Welcoming Beginners: Open invitation to newcomers and showcase of creations from all skill tiers',
    visual: 'Project cards gallery, creator highlights',
    audio: 'Upbeat ambient riser, clean voiceover',
    prompt: 'Cinematic 16:9 video storyboard frame: floating gallery montage showing fantasy landscape, sports car, and 3D character, glowing badge MADE BY OUR COMMUNITY, sleek dark UI layout',
    evidence: 'Sentence boundary at 58.11s verified against transcript'
  },
  {
    title: 'Call to action and next steps',
    start: 58.11,
    end: 69.15,
    description: 'High-impact wide perspective, bold central call to action with animated button states.',
    intent: 'Hands-on Exploration: Demystifying repos and taking the next steps in community journey',
    visual: 'Global movement visual, action buttons',
    audio: 'Inspirational build-up, punchy click accents',
    prompt: 'Cinematic 16:9 video storyboard frame: planet Earth from space at night with glowing city lights, bold title JOIN THE MOVEMENT, glowing green button GET STARTED, icons Learn Build Share Grow',
    evidence: 'Sentence boundary at 69.15s verified against transcript'
  },
  {
    title: 'End card with brand and tagline',
    start: 69.15,
    end: 76.974,
    description: 'Cinematic brand outro with logo lockup and subscribe prompt.',
    intent: 'Call to Action & Community Outro: Subscribe, like, comment, and engage with the AI community',
    visual: 'Brand identity, tagline animation',
    audio: 'Cinematic outro chord, subtle logo chime',
    prompt: 'Cinematic 16:9 video storyboard frame: epic dusk mountain range under starry night sky, bold modern typography AI COMMUNITY, subtitle CREATE • LEARN • BUILD • TOGETHER',
    evidence: 'Sentence boundary at 76.97s verified against transcript'
  }
];

comp.storyboard = richScenes;
fs.writeFileSync(path, JSON.stringify(proj, null, 2), 'utf8');
console.log('Successfully updated current.json with 9 rich storyboard scenes!');
