# Helios

A desktop video editor with an AI producer built in. Helios looks and cuts like a professional NLE (multi-track timeline, ripple and roll edits, keyframes, nested comps, audio meters) and ships with a co-pilot that plans, gathers, edits and polishes a video through real tools on your timeline. Everything runs on your machine: the models, the media, the render.

Built with Tauri v2 + Rust, React 19 + TypeScript, FFmpeg. MIT licensed.

## What it does

- **Edit like a pro.** Selection, razor, ripple, roll, rate stretch, slip, slide, pen and type tools; unlimited video and audio tracks; nested sequences; real-time waveforms and meters; undo for everything, including what the AI does.
- **Let the AI produce.** Ask for a video and the co-pilot works in phases you control with buttons in the chat: **plan** (research, script, shot list, graphics, music) → **Start generating** → **gather** (local video, images, voice-over, downloads) → **Start editing** → **edit and polish** (cuts on speech, levels, beat sync, roto, graphics, captions, frame QA).
- **Generate locally.** Wan 2.1 / LTX text-to-video, SDXL images, SAM 2 / RVM rotoscoping, Depth Anything, Whisper transcription, Piper voice-over, Stable Audio sound effects, LaMa magic eraser. No cloud, no credits.
- **After Effects-style motion engine.** A WebGL2 compositor draws motion scenes the same way in the preview and the export. It has:
  - layers with bezier-eased keyframes and expressions, parenting, masks, track mattes, 17 blend modes and motion blur;
  - 3D layers and a camera with real depth of field;
  - vector shape trees (SVG paths, gradient strokes, trim paths, repeaters, morphs, merge/offset/round-corner path operations) and 2,100+ Lucide icons;
  - layer styles (bevel, inner shadow and glow, gradient overlay);
  - a type engine for live typing, retyping, scattered glyphs and word-by-word animators timed to the voice-over.

  35 templates cover titles, subject reveals, stats and brand pieces. Timing, eases and beat recipes come from measured professional reference films (`motion_guide`). See [docs/MOTION-ENGINE.md](docs/MOTION-ENGINE.md).
- **Real 3D through Blender.** When Blender is installed, the AI renders 3D scenes headless in the background: glass and pearl orbs, gem crystals lit by gradient environments, device heroes, extruded logos. Draft renders use EEVEE; final renders use Cycles on the GPU. The frames come back with alpha and composite under 2D type, together with the camera and object tracks.
- **HTML motion graphics.** Graphics written as HTML/CSS animate in the preview and export as rendered frames with alpha:
  - **Crimson**, the house motion system: hook titles, teaching cards, side panels, comparisons, stat charts, timelines, lower thirds.
  - **The UI library**: the full React Bits catalogue (205 pieces) plus Animate.css, Open Props, Magic UI, Aceternity and Uiverse-style pieces, all deterministic and exportable. See [docs/REACT-BITS-LIBRARY.md](docs/REACT-BITS-LIBRARY.md).
- **Brand kits.** Define your brand once in Settings → Brand kit (logo, colours, type, voice, motion, imagery rules, layout, audio). Every graphic, caption, generated image and voice-over follows it, and the AI can create and edit kits itself. See [docs/BRAND-KIT.md](docs/BRAND-KIT.md).
- **Bring media in.** Import anything FFmpeg reads; download from YouTube, Instagram, TikTok, X and direct links with trimming and cropping; scrape article and page media for research.
- **Sound design.** 19 synthesised effects (UI ticks, keystrokes and typing beds, whooshes, glass pings, sub drops), levelled under the voice. Music analysis finds beats, bars, 4-bar phrases and drops, and cuts can be snapped to any of them.
- **Export.** Presets for YouTube 4K/1080p, Reels/Shorts 9:16, square, ProRes; a background render queue.

## How it compares

Helios combines four kinds of tools in one app: an editor, a motion-graphics tool, an AI producer and a local media generator. Most tools cover one or two of these. The tables below compare it with the tools people usually pair together to get the same result.

**Editing and production**

| | Helios | Premiere Pro | DaVinci Resolve | CapCut | Runway |
| --- | :---: | :---: | :---: | :---: | :---: |
| Multi-track NLE (ripple, roll, slip, slide, nesting) | ✅ | ✅ | ✅ | Basic | — |
| AI that edits the timeline through undoable tools | ✅ | Assistive features | Assistive features | Assistive features | — |
| Plan → gather → edit → polish workflow | ✅ | — | — | Templates | Prompt to clip |
| Transcript-based cutting and captions | ✅ Local | ✅ | ✅ Studio | ✅ Cloud | — |
| Beat, bar and phrase-aware cut snapping | ✅ | Partial | Partial | Auto-beat | — |
| Frame QA (safe area, face overlap, blank frames) | ✅ | — | — | — | — |
| Download from YouTube, Instagram, TikTok, X | ✅ | — | — | — | — |

**Motion graphics and 3D**

| | Helios | After Effects | Resolve (Fusion) | Remotion | Runway |
| --- | :---: | :---: | :---: | :---: | :---: |
| Keyframed layers, masks, mattes, blend modes | ✅ | ✅ | ✅ (nodes) | In code | — |
| 2.5D layers and camera with depth of field | ✅ | ✅ | ✅ | In code | — |
| Vector shapes, trim paths, repeaters, path operations | ✅ | ✅ | Partial | In code | — |
| Scenes built and revised by the AI from a chat | ✅ | — | — | An LLM writes code | Generative clips |
| Real 3D (glass, metal, extruded type) | ✅ Your Blender, headless | ✅ Advanced 3D | ✅ Fusion 3D | ✅ Three.js | Generative |
| Template library | 35 engine templates, 500+ HTML pieces | Marketplace | Templates | Community | — |
| Brand kit that every graphic follows | ✅ | Libraries (manual) | — | — | — |

**Privacy and cost**

| | Helios | Premiere Pro / After Effects | DaVinci Resolve | CapCut | Runway |
| --- | :---: | :---: | :---: | :---: | :---: |
| Footage stays on your machine | ✅ | Partly (cloud AI features) | ✅ | — | — |
| Local text-to-video and images | ✅ | Cloud (Firefly) | — | Cloud | Cloud |
| Local rotoscoping and clean plates | ✅ | Roto Brush, Content-Aware Fill | Magic Mask (Studio) | Cloud cutout | Cloud |
| Local voice-over | ✅ | — | — | Cloud | Cloud |
| Price | Free | Subscription | Free / Studio one-time | Free + Pro subscription | Credits |

✅ means built in; "—" means not offered. The other tools' columns describe their public feature sets at the time of writing and change often; check each vendor's site for current features and plans. Helios uses Blender only when it is installed on the user's machine, and runs it as a separate program.

## How the AI works

The co-pilot is any model you connect: Claude, OpenAI-compatible APIs, local servers, or coding-agent CLIs (Claude Code, Codex, Gemini). It edits only through Helios tools (about 150 of them), so every change is a real, undoable timeline operation. A workflow guard keeps the phases honest: no media generation while planning, no timeline edits before the plan is saved.

Useful tools to know about:

| Area | Tools |
| --- | --- |
| Reading | `get_comp`, `analyze_clip_speech`, `inspect_clip_frames`, `run_frame_qa` |
| Planning | `online_research`, `save_video_blueprint`, `save_storyboard`, `query_frame_atlas` |
| Gathering | `generate_local_media`, `synthesize_speech_voiceover`, `download_online_media`, `scrape_videos` |
| Editing | `apply_edit`, `apply_recipe`, `place_clip`, `level_audio`, `snap_cuts_to_beats`, `rotoscope_clip`, `erase_subject_clip` |
| Motion | `motion_guide`, `list_motion_templates`, `create_motion_scene`, `update_motion_scene`, `search_icons`, `svg_to_shape`, `track_motion` |
| 3D | `list_3d_presets`, `render_3d_scene` (headless Blender) |
| Graphics | `create_motion_graphic` (Crimson templates, `react-bits` pieces, custom HTML), `react_bits`, `add_text`, `add_captions` |
| Brand | `list_brand_kits`, `get_brand_kit`, `create_brand_kit`, `update_brand_kit`, `apply_brand_kit`, `render_brand_board`, `brand_kit_prompt` |

## Quick start

Requirements: Node.js 20 or 22, Rust 1.85+, FFmpeg on your PATH. Optional: `yt-dlp` for downloads, [Blender](https://www.blender.org) 4.2+ for 3D renders, Python 3.10+ with PyTorch for the local models (Helios installs model weights from Settings → Local media).

```bash
git clone https://github.com/memegyanfactory-gif/Helios.git
cd Helios
npm install
npm run dev        # Tauri desktop app with hot reload
npm run dev:web    # browser-only preview of the UI
```

Then open Settings → AI providers and connect a model, and Settings → Local media to install the models you want.

## Development

```bash
npm run typecheck   # tsc
npm run test:ui     # vitest (frontend)
npm test            # vitest + cargo test
npm run lint        # eslint + clippy
npm run bundle      # production build
```

Where things live:

| Path | What |
| --- | --- |
| `src/editor/` | Timeline, monitors, compositor, motion-graphic layer |
| `src/lib/aiTools.ts`, `src/lib/ai-tools.json` | The AI tool catalogue and its handlers |
| `src/lib/editWorkflow.ts` | The phase guard |
| `src/motion/` | The GPU motion engine (scene model, WebGL renderer, vector and type engines, templates) |
| `src/lib/motionTools.ts`, `src/lib/blender3d.ts` | Motion and 3D AI tools, Blender presets |
| `src/lib/motionGuide.ts` | Crimson motion system |
| `src/lib/rbx/` | The animated UI library (React Bits and friends) |
| `src/lib/brandKit/` | Brand kit model, archetypes, DaisyUI themes, renderers |
| `src-tauri/src/` | Rust core: project store, FFmpeg render, providers, local model workers, Blender bridge |
| `src-tauri/prompts/copilot.md` | The co-pilot's system prompt |
| `docs/` | Plans, references and the research behind the libraries |

## License

MIT. See `LICENSE`.
