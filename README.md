# Helios

A desktop video editor with an AI producer built in. Helios looks and cuts like a professional NLE (multi-track timeline, ripple and roll edits, keyframes, nested comps, audio meters) and ships with a co-pilot that plans, gathers, edits and polishes a video through real tools on your timeline. Everything runs on your machine: the models, the media, the render.

Built with Tauri v2 + Rust, React 19 + TypeScript, FFmpeg. MIT licensed.

## What it does

- **Edit like a pro.** Selection, razor, ripple, roll, rate stretch, slip, slide, pen and type tools; unlimited video and audio tracks; nested sequences; real-time waveforms and meters; undo for everything, including what the AI does.
- **Let the AI produce.** Ask for a video and the co-pilot works in phases you control with buttons in the chat: **plan** (research, script, shot list, graphics, music) → **Start generating** → **gather** (local video, images, voice-over, downloads) → **Start editing** → **edit and polish** (cuts on speech, levels, beat sync, roto, graphics, captions, frame QA).
- **Generate locally.** Wan 2.1 / LTX text-to-video, SDXL images, SAM 2 / RVM rotoscoping, Depth Anything, Whisper transcription, Piper voice-over, Stable Audio sound effects, LaMa magic eraser. No cloud, no credits.
- **Motion graphics as code.** Graphics are HTML/CSS choreography that animates in the preview and exports as rendered frames with alpha:
  - **Crimson**, the house motion system: hook titles, teaching cards, side panels, comparisons, stat charts, timelines, lower thirds.
  - **The UI library**: the full React Bits catalogue (205 pieces) plus Animate.css, Open Props, Magic UI, Aceternity and Uiverse-style pieces, all deterministic and exportable. See [docs/REACT-BITS-LIBRARY.md](docs/REACT-BITS-LIBRARY.md).
- **Brand kits.** Define your brand once in Settings → Brand kit (logo, colours, type, voice, motion, imagery rules, layout, audio). Every graphic, caption, generated image and voice-over follows it, and the AI can create and edit kits itself. See [docs/BRAND-KIT.md](docs/BRAND-KIT.md).
- **Bring media in.** Import anything FFmpeg reads; download from YouTube, Instagram, TikTok, X and direct links with trimming and cropping; scrape article and page media for research.
- **Export.** Presets for YouTube 4K/1080p, Reels/Shorts 9:16, square, ProRes; a background render queue.

## How the AI works

The co-pilot is any model you connect: Claude, OpenAI-compatible APIs, local servers, or coding-agent CLIs (Claude Code, Codex, Gemini). It edits only through Helios tools (about 115 of them), so every change is a real, undoable timeline operation. A workflow guard keeps the phases honest: no media generation while planning, no timeline edits before the plan is saved.

Useful tools to know about:

| Area | Tools |
| --- | --- |
| Reading | `get_comp`, `analyze_clip_speech`, `inspect_clip_frames`, `run_frame_qa` |
| Planning | `online_research`, `save_video_blueprint`, `save_storyboard`, `query_frame_atlas` |
| Gathering | `generate_local_media`, `synthesize_speech_voiceover`, `download_online_media`, `scrape_videos` |
| Editing | `apply_edit`, `apply_recipe`, `place_clip`, `level_audio`, `snap_cuts_to_beats`, `rotoscope_clip`, `erase_subject_clip` |
| Graphics | `create_motion_graphic` (Crimson templates, `react-bits` pieces, custom HTML), `react_bits`, `add_text`, `add_captions` |
| Brand | `list_brand_kits`, `get_brand_kit`, `create_brand_kit`, `update_brand_kit`, `apply_brand_kit`, `render_brand_board`, `brand_kit_prompt` |

## Quick start

Requirements: Node.js 20 or 22, Rust 1.85+, FFmpeg on your PATH. Optional: `yt-dlp` for downloads, Python 3.10+ with PyTorch for the local models (Helios installs model weights from Settings → Local media).

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
| `src/lib/motionGuide.ts` | Crimson motion system |
| `src/lib/rbx/` | The animated UI library (React Bits and friends) |
| `src/lib/brandKit/` | Brand kit model, archetypes, DaisyUI themes, renderers |
| `src-tauri/src/` | Rust core: project store, FFmpeg render, providers, local model workers |
| `src-tauri/prompts/copilot.md` | The co-pilot's system prompt |
| `docs/` | Plans, references and the research behind the libraries |

## License

MIT. See `LICENSE`.
