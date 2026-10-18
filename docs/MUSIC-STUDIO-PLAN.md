# Bhippi Music Studio — design and engine spec

A full music production workstation inside Bhippi. One click on **Music** in the left rail turns the
editor into a pattern-and-playlist DAW (the FL Studio way of working), and every AI provider Bhippi
runs — Bhippi AI, Claude Code, Codex, Grok, Kimi, local models — can read the song and write it
through the same tools, note by note, knob by knob.

The song lives inside the Bhippi project (`project.music`), so it saves, undoes and travels with the
video. A finished song bounces to a WAV that lands in the media bin and can go straight onto the
video timeline, with its beat grid already known.

---

## 1. Goals

- **Feature parity with FL Studio's core**: Channel Rack + step sequencer, Piano Roll, Playlist with
  pattern / audio / automation clips, Mixer with inserts, sends and effect slots, Browser, native
  instruments, native effects, transport, recording-free composition.
- **More than FL**: AI is a first-class user (structured read-out of everything, music-theory tools,
  generators that write real notes, a mix analyser that reports clashes), and the song is part of a
  video project (score-to-picture, cut-aware structure, one-click bounce to the timeline).
- **Everything is data.** No hidden state in audio nodes: the song document fully describes the
  sound, so a model that edits JSON gets exactly what a human gets with the mouse.
- **Deterministic render.** Playback and bounce use the same graph builder; offline bounce in an
  `OfflineAudioContext` is sample-identical run to run (seeded noise).
- **Every provider, equal footing.** Tools live in `src/lib/ai-tools.json`, so the in-app model and
  every external CLI agent (through Bhippi's MCP bridge, `src-tauri/src/ai_tools.rs`) see the same
  catalogue. Nothing is gated to one provider.

## 2. Where things live

| Part | Path |
|---|---|
| Song data model (the contract) | `src/music/types.ts` |
| Music theory: notes, scales, chords, progressions, grooves | `src/music/theory.ts` |
| Pure song operations (create, edit, arrange, validate) | `src/music/model.ts` |
| Audio engine: instruments, effects, mixer graph, scheduler, offline bounce, WAV | `src/music/engine/` |
| Studio UI: rail toggle, toolbar, channel rack, piano roll, playlist, mixer, browser | `src/music/ui/` |
| AI tools (dispatcher half) | `src/lib/musicTools.ts` |
| AI tools (schema half) | `src/lib/ai-tools.json` (`music_*`) |
| Persistence | `Project.music` (TS) and `Project.music: Option<Value>` (Rust, UI owns the shape) |
| Bounced files | `Generated/Music/<name>.wav` via the `music_save_wav` command |

## 3. The studio, window by window (FL parity checklist)

### 3.1 Transport and toolbar
- Play / stop / record-arm-free; **Pattern mode vs Song mode** (FL's PAT/SONG switch).
- Tempo 20–999 BPM with fine tuning (decimal), tap tempo, time signature (numerator / denominator).
- Global swing (0–100 %) applied to the step grid, per-channel swing override.
- Master volume, master pitch (± 12 semitones).
- Metronome (click on beats, accent on bar), count-in.
- Loop: whole song, a playlist selection, or the current pattern.
- Position read-out in bars:beats:steps and in seconds; CPU / voice count meter.
- Pattern selector (create, clone, rename, colour, delete).
- Snap: none, 1/1 bar, 1/2, 1/4 beat, 1/8, 1/16 step, 1/32, triplets.
- Undo / redo through Bhippi's history (every song edit is a project commit).

### 3.2 Channel Rack (step sequencer)
- One row per channel: mute, solo, name, colour, volume knob, pan knob, mixer-insert number,
  instrument type icon, open-instrument button.
- Step grid per pattern: 16 steps per bar by default, any length (1–64 bars), per-step velocity,
  pan, pitch (note), fine pitch, release, modulation X/Y, **probability (more than FL)** and
  **ratchet / retrigger (more than FL)**.
- Graph editor lane under the steps for velocity / pan / pitch.
- Per-channel: swing amount, time offset (shuffle), polyphony (mono / max voices / slide),
  portamento, root note, pitch range, filter group.
- Channel routing to a mixer insert ("track" number). Fill every 2 / 4 / 8 steps, shift left/right,
  randomise, clone channel, channel groups / filters (Drums, Bass, Keys…).
- Steps and piano-roll notes are the same data: a step is a note of one step length, so switching
  between the two views never loses anything.

### 3.3 Instruments (native generators)
| Instrument | What it is | Key params |
|---|---|---|
| **Bhippi Synth** (3xOsc / Sytrus-lite) | 3 oscillators (sine, saw, square, triangle, noise, pulse w/ width), per-osc octave, semitone, detune, level, unison voices + spread | amp ADSR, filter (LP/HP/BP/notch, 12/24 dB) with cutoff, resonance, env amount, key-tracking; filter ADSR; 2 LFOs (rate, depth, shape, target pitch/cutoff/amp/pan, tempo sync); glide; velocity → amp/cutoff |
| **FM Synth** | 2-operator / 4-operator FM (DX-style) | ratio, index, operator envelopes, feedback, algorithm |
| **Drum Synth** (Drumaxx/FPC-lite) | synthesized kit pieces: kick, 808, snare, clap, closed hat, open hat, tom, rim, cowbell, crash, ride, shaker | tune, decay, tone, snap/noise mix, drive, pitch-sweep |
| **808 Bass** | sine with pitch drop, glide (slide notes), drive | decay, punch, glide time, distortion |
| **Sampler** (Audio Clip / DirectWave-lite) | plays any audio from the bin (or a generated one-shot), pitched by key | root note, start/end, loop, reverse, ADSR, filter, time-stretch off/pitch mode |
| **Pluck** | Karplus-Strong string | damping, brightness, decay |
| **Pad / Supersaw** | detuned saw stack with slow envelopes | voices, detune, width, attack |
| **Organ** | additive drawbar organ | 9 drawbars, percussion, rotary (chorus) |
| **Piano / Keys** | additive + noise hammer electric/acoustic-ish | brightness, decay, tine |
| **Noise / FX riser** | filtered noise sweeps, risers, downlifters, impacts | direction, length, filter sweep |

Every instrument parameter is a plain number in the channel's `params` record, documented in
`INSTRUMENT_SPECS` (types.ts) with min / max / default / unit so the UI renders knobs generically and
the AI knows the valid range.

### 3.4 Piano Roll
- Notes with start (steps, fractional allowed), length, key (MIDI 0–127), velocity, pan, fine pitch,
  release, **slide** (glide into the next note) and **porta**, colour/group, mute.
- Tools: draw, paint, select (marquee), slice, erase, mute, playback-from-here; drag to move,
  edge-drag to resize, Ctrl-drag to duplicate, arrow-nudge, Shift+arrow by octave.
- Grid with snap; bar / beat / step lines; key column with octave labels; scale highlighting
  (ghost rows outside the song key — **more than FL: snap-to-scale**).
- Velocity lane (and pan / pitch lanes) under the notes.
- Ghost notes from other channels in the same pattern.
- Tools menu: quantize (with strength, swing), legato, arpeggiate, strum, chordize (stamp chords),
  flip, randomize (velocity/timing humanise), **scale-correct (more)**, transpose, duplicate bar,
  **chord progression writer (more)**, **bassline from chords (more)**.
- Stamps: major, minor, 7ths, 9ths, sus, add9, power chords, every inversion.

### 3.5 Playlist (arrangement)
- Up to 500 tracks, each with name, colour, height, mute, solo, lock.
- Clips: **pattern clips** (instances of a pattern, can be resized/sliced, start offset),
  **audio clips** (bin audio, with gain, fade in/out, offset, stretch off), **automation clips**
  (a point curve that drives any parameter).
- Tools: draw, paint, slice, select, mute, delete, zoom; clips snap to the playlist grid.
- Markers (time markers, loop markers, **section markers: intro / verse / chorus / drop / bridge /
  outro — more**), time-signature changes, tempo automation.
- Song length follows the last clip; loop region on the timeline ruler.
- **Picture lane (more than FL)**: the active video comp's cuts and markers drawn above the
  playlist so music hits land on cuts.

### 3.6 Mixer
- Master + up to 125 insert tracks (default 16 shown), each with name, colour, volume fader (dB),
  pan, stereo width, mute, solo, phase invert, peak meter (L/R), **route (sends) to any insert or
  master** with send level, sidechain sends (for ducking).
- 10 effect slots per insert, each with on/off and dry/wet mix, drag reorder.
- Per-insert 3-band parametric EQ strip (like FL's insert EQ).
- Latency-free, all native effects (below).

### 3.7 Effects (native)
| Effect | Params |
|---|---|
| **Parametric EQ** (Fruity Parametric EQ 2-lite) | 7 bands: type (lowshelf, peaking, highshelf, lowpass, highpass, notch), freq, gain, Q |
| **Compressor** (Fruity Limiter-lite) | threshold, ratio, attack, release, knee, makeup |
| **Limiter** | ceiling, release (brickwall on master by default) |
| **Reverb** (Fruity Reeverb 2-lite) | size, decay, pre-delay, damping, mix (seeded IR generated in code) |
| **Delay** (Fruity Delay 3-lite) | time (tempo-synced or ms), feedback, ping-pong, filter, mix |
| **Chorus / Flanger / Phaser** | rate, depth, feedback, mix |
| **Distortion** (Fruity Blood Overdrive-lite) | drive, tone, curve (soft/hard/fold/bitcrush), mix |
| **Bitcrusher** | bits, sample-rate reduction |
| **Filter** (Autofilter) | type, cutoff, resonance, LFO rate/depth, envelope follower |
| **Stereo Shaper / Imager** | width, pan |
| **Sidechain Ducker** (Fruity Peak Controller-lite) | source insert, amount, attack, release — real sidechain from the routed source, or tempo-synced pump |
| **Gate / Transient shaper** | threshold / attack, sustain |
| **Tremolo / Autopan** | rate (synced), depth |

### 3.8 Browser
- Channel presets (instrument + params) by category: Drums, Bass, Leads, Pads, Keys, Plucks, FX.
- Pattern & groove templates (four-on-the-floor, trap hats, boom-bap, breakbeat, reggaeton dembow,
  afrobeats, house, DnB, lofi).
- Chord progressions by genre/mood (I–V–vi–IV, ii–V–I, i–VI–III–VII, …).
- Project bin audio (drag onto Playlist or into a Sampler).
- Song templates (empty, beat, lofi, trap, house, cinematic, corporate) that seed channels, mixer and
  patterns.

### 3.9 Automation
- Automation clips on the playlist targeting any channel param, mixer param (volume, pan, send), or
  effect param, or master tempo.
- Point curve: time (steps), value 0–1 normalised to the param range, curve tension per segment
  (hold / linear / smooth / exponential). LFO generator for automation (more).

### 3.10 Render / export
- Bounce song (or pattern, or loop region) to 44.1 / 48 kHz 16- or 24-bit WAV, with tail.
- **Stem export** (each insert to its own WAV) for the video timeline's audio mix.
- **Send to timeline**: imports the WAV to the bin (folder "Music") and lays it on the active comp as
  the music bed, with beat and downbeat times stored for snap_cuts_to_beats.

### 3.11 More than FL — the AI-native layer
- **Song read-out**: a compact text form of the whole song (tempo, key, channels, patterns as step
  strings `x...x...x...x...`, notes as `C4@0+4 v100`, playlist as section map, mixer chain) so a model
  can "see" it in a few hundred tokens; and a per-pattern piano-roll ASCII grid on request.
- **Note syntax**: tools accept notes as `{key:"C#4", start: 0, length: 2, velocity: 0.8}` or a
  compact string `"C4 0 4 100; E4 0 4 90"`, plus drum strings `"x---x---x---x-x-"` (x = hit,
  X = accent, o = ghost, r = ratchet, digits = velocity 1–9).
- **Theory engine**: scales (24 modes/scales), chords by roman numeral in key, progressions by
  genre, voice leading, bassline / arpeggio / melody-from-chords generators, humanise.
- **Generators that write real notes, not audio**: `music_generate` writes drums / bass / chords /
  melody / arp / fill patterns into the song from style + key + bars + density, deterministic via
  seed, so the model can then edit them.
- **Mix analysis**: an offline render measured per insert — peak / RMS / LUFS-ish loudness, clipping,
  low-end masking between kick and bass, stereo width, empty sections — reported as text.
- **Picture sync**: build the arrangement from the active comp (song length = comp length, drops on
  chosen cut times, sections from markers).

## 4. Data model (summary — `src/music/types.ts` is authoritative)

```
MusicProject
  version: 1
  name, bpm, timeSig [num, den], swing (0–1), key {root: 0–11, scale}, masterVolume, masterPitch
  stepsPerBeat (4), ppq-free: all time is in STEPS (1 step = 1/16 note at 4/4) as floats
  channels: Channel[]            // the Channel Rack
  patterns: Pattern[]            // notes per channel, length in bars
  playlist: { tracks: PlaylistTrack[], clips: PlaylistClip[], markers: Marker[], loop? }
  mixer: { inserts: MixerInsert[] }   // index 0 = Master
  automations: Automation[]      // curves referenced by automation clips
  view: { mode: 'pattern'|'song', activePatternId, selectedChannelId, ... }   // UI-only state

Channel   { id, name, color, instrument: InstrumentType, params: Record<string, number>,
            sampleAssetId?, volume 0–1.25, pan -1..1, mute, solo, insert (mixer index),
            swing?, polyphony, glide, rootKey }
Pattern   { id, name, color, bars, notes: Record<channelId, Note[]> }
Note      { id, key 0–127, start (steps), length (steps), velocity 0–1, pan?, fine?, slide?,
            probability?, ratchet?, mute? }
PlaylistClip { id, trackIndex, start (steps), length (steps), offset (steps),
               kind: 'pattern'|'audio'|'automation', patternId? | assetId?/gain/fadeIn/fadeOut | automationId? , muted }
MixerInsert { id, name, color, volume (dB), pan, width, mute, solo, invert,
              sends: [{to, level, sidechain?}], effects: Effect[], eq? }
Effect    { id, type: EffectType, enabled, mix 0–1, params: Record<string, number> }
Automation { id, name, target: AutomationTarget, points: [{t (steps), v 0–1, curve?}] }
```

Timing is always in **steps** (sixteenth notes at the default resolution). Seconds = steps ×
60 / (bpm × stepsPerBeat). Swing delays every odd step by `swing × stepSeconds × 0.5`.

## 5. Audio engine

- `engine/graph.ts` builds the node graph for an `AudioContext` or `OfflineAudioContext` from the
  song: channel → channel strip (gain, pan) → mixer insert input → effect chain → insert fader/pan
  → (sends) → master insert → limiter → destination. Rebuilt incrementally: when the song changes
  the engine diffs channel/insert/effect ids and updates params in place (no clicks).
- `engine/instruments/*.ts`: each instrument implements
  `noteOn(ctx, dest, note: {key, velocity, time, duration, pan, slideFrom?}, params) → voice`
  scheduling everything with sample-accurate `AudioParam` automation at `time`. Noise and IRs use a
  seeded PRNG so offline renders repeat exactly.
- `engine/effects/*.ts`: each effect is `create(ctx, params) → {input, output, set(params, time), dispose}`.
- `engine/scheduler.ts`: lookahead scheduler (25 ms tick, 120 ms horizon) for live playback in
  pattern mode (loops the active pattern) and song mode (walks playlist clips, loops region).
  Exposes position for the playhead (`requestAnimationFrame` reads `ctx.currentTime`).
- `engine/render.ts`: offline bounce `renderSong(song, {sampleRate, from, to, tail, stems?, loadSample})`
  → `AudioBuffer`(s); `engine/wav.ts`: 16/24-bit PCM WAV encoder; `engine/analyse.ts`: peak, RMS,
  crest, approximate LUFS (K-weighted), per-band energy for masking reports.
- Metering: an `AnalyserNode` per insert, read by the mixer UI at 30 fps.
- Sample loading: bin assets decoded through `fileSrc(asset.path)` + `decodeAudioData`, cached by
  asset id.

## 6. UI

The **Music** button sits in the left rail's footer above Settings. Clicking it toggles the music
studio, which covers the editor area (the project rail stays, so projects are still switchable)
and uses the app's dark theme. The studio has:

- top **toolbar** (transport, tempo, pattern picker, mode switch, snap, master meter, bounce,
  "Send to timeline", back to video);
- left **Browser** (instruments, presets, grooves, progressions, bin audio);
- centre, tabbed / split: **Playlist** (top) and **Channel Rack** or **Piano Roll** (bottom);
- **Mixer** as a bottom drawer or tab;
- **Instrument / Effect panel** floating: generic knob grid from the parameter specs.

Keyboard: Space play/stop, L pattern/song, F6 channel rack, F7 piano roll, F5 playlist, F9 mixer,
Ctrl+Z / Ctrl+Y through history, Delete, Ctrl+D duplicate, B/P/S/D/E tool keys in the piano roll,
QWERTY keyboard plays the selected channel (Z–M lower octave, Q–U upper).

## 7. AI tools

All tools are prefixed `music_` and work on `project.music`, creating a default song when absent.
Each write is one history commit labelled `AI: music …` so the user can undo any AI step.

| Tool | Does |
|---|---|
| `music_get_song` | The song read-out (§3.11): tempo, key, channels + params, patterns (step strings / note lists), playlist sections, mixer chains. `detail: summary|full`, `patternId` for one pattern, `grid: true` for an ASCII piano roll. |
| `music_studio_guide` | Instrument and effect parameter specs, scales, chord names, groove names, note syntax — the manual. |
| `music_new_song` | Fresh song from a template (empty / beat / lofi / trap / house / dnb / cinematic / corporate / pop / afrobeats), with name, bpm, key, scale. Asks nothing; replaces only with `replace: true`. |
| `music_set_song` | Tempo, time signature, swing, key, scale, master volume / pitch, name. |
| `music_add_channel` | Adds a channel: instrument type or preset name, name, params, insert (auto-assigns a free insert), sample asset. |
| `music_update_channel` | Changes channel params / volume / pan / mute / solo / insert / instrument; `delete: true` removes it. |
| `music_write_pattern` | Creates or edits a pattern: per channel, drum step strings or notes (objects or compact string), `mode: replace|merge|clear`, bars, name. Notes may be roman-numeral chords (`"chords": "vi-IV-I-V"`). |
| `music_edit_notes` | Note operations on a pattern+channel: transpose, quantize, humanize, legato, arpeggiate, strum, chordize, scale-correct, velocity scale, shift, duplicate, reverse, delete range. |
| `music_generate` | Writes parts with the theory engine: `part: drums|bass|chords|melody|arp|fill|counter|pad|riser`, style, bars, density, octave, seed, chord progression; into a pattern (new or given). |
| `music_arrange` | Playlist: add / move / delete clips (pattern, audio, automation), `sections` shorthand (`[{name:'intro', bars:8, patterns:[…]}]` builds the whole song), markers, loop. |
| `music_mixer` | Insert edits: volume, pan, width, mute, solo, sends, add / update / remove / reorder effects with params, EQ. |
| `music_automate` | Creates an automation clip for a target (channel/insert/effect param, tempo) with points or a shape (ramp up, ramp down, sweep, LFO, pump) over a range. |
| `music_analyze_mix` | Offline-renders and reports levels per insert, master peak / loudness, clipping, kick–bass masking, silence, too-dense / too-sparse sections. |
| `music_render` | Bounces song / pattern / range to WAV, imports into the bin (`Music` folder), optionally `place: true` on the active comp as the music bed (beats stored), `stems: true` for per-insert files. |
| `music_open_studio` | Shows / hides the music studio, focuses a window (playlist / rack / pianoroll / mixer) and a pattern / channel, so the user can watch. |

The tools are grouped as `music` in `toolRouter.ts`: they go out whole when the ask is about music,
a song, a beat, a melody, a track to compose, or when the studio is open; otherwise they are one
`tool_help` call away like every other group. The system prompt gets one line telling the model the
studio exists and to start with `music_get_song` / `music_studio_guide`.

### 7.1 A model's workflow (what the guide teaches)
1. `music_get_song` (or `music_new_song` from a template).
2. `music_set_song` key / tempo for the brief.
3. `music_generate` drums, bass, chords, melody into patterns — or write them with
   `music_write_pattern` for full control.
4. `music_arrange` with `sections` to lay out intro → verse → chorus → drop → outro.
5. `music_mixer` for EQ / compression / reverb / sidechain; `music_automate` for builds.
6. `music_analyze_mix` → fix what it reports.
7. `music_render` (`place: true` when it scores a video).

## 8. Persistence and undo
- `Project.music?: MusicProject | null` (TS) and `music: Option<serde_json::Value>` in
  `src-tauri/src/project.rs` (skip when none) — the UI owns the shape, like `luts`.
- Every edit, UI or AI, is `history.commit(p => ({...p, music: next}), label)`. Rapid UI gestures
  (knob drags, note drags) commit once on release; the live value during the drag is local state.
- UI-only state (scroll, zoom) is not part of the song.

## 9. Testing
- `tests/musicTheory.test.ts`: note names ↔ MIDI, scales, chord building, roman numerals.
- `tests/musicModel.test.ts`: song ops, step string parsing, arrangement sections, validation.
- `tests/musicTools.test.ts`: every `music_*` catalogue entry has a dispatcher case and a label;
  a full model-style session (new song → generate → arrange → mixer) yields a valid song.
- `tests/musicRender.test.ts`: the WAV encoder and timing maths (no audio device needed).

## 10. Roadmap after v1
- MIDI input (Web MIDI) and live recording into the piano roll; MIDI file import/export.
- Audio recording into the playlist.
- VST hosting through a Rust audio host (cpal + a plugin host) — out of the webview.
- Time-stretch / pitch-shift for audio clips (WSOLA in a worklet).
- AudioWorklet-based voices for lower CPU on big projects.
- Vocal synthesis tied to the TTS engine.

## 11. Studio v2: the LMMS-grade look and the per-project workspace switch

The first build worked but looked like the editor's panels with knobs on them. v2 gives the
studio its own studio-hardware identity, modelled on LMMS (github.com/LMMS/lmms,
`data/themes/default/style.css`) — its look only: LMMS is GPL and Bhippi is MIT, so no LMMS code
or artwork is copied; palette, proportions and behaviours are re-drawn here.

### 11.1 Visual system
| Token | Value | Use |
|---|---|---|
| `--ms-bg-0` | `#0c0e0f` | deepest wells: grids, rack lanes, meters |
| `--ms-bg-1` | `#14161a` | window bodies (LMMS editors / mixer channel) |
| `--ms-bg-2` | `#1b1f24` | panels, track headers |
| `--ms-bg-3` | `#262b30` | raised controls, toolbars (LMMS scale colour) |
| `--ms-bg-4` | `#3b424a` | hover / active strips |
| `--ms-line` | `#262b30` / `#3c444c` | fine grid / coarse (bar) grid |
| `--ms-text` | `#d1d8e4` | primary text |
| `--ms-dim` | `#8a94a3` | labels |
| `--ms-accent` | `#0bd556` | notes, active steps, play state (LMMS green) |
| `--ms-accent-2` | `#43b2ff` | selection, loop |
| `--ms-warn` / `--ms-clip` | `#d6ec52` / `#c12038` | meter warn / clip |
| `--ms-lcd` | `#040506` bg, `#43ff82` digits | LCD displays: position, tempo, CPU |

- Every window is a framed sub-window: a 26 px title strip with an icon, a gradient from
  `#3d454f` to `#262b30`, a 1 px `#090909` top line — the LMMS SubWindow.
- Grids alternate darker/lighter bar bands (`#0c0e0f` / `#14151a`), 2 px bar lines, 1 px beat lines.
- Clips: pattern/MIDI green `#21a14f`, sample `#2a333b` with orange text, automation violet
  `#663de1`; mini note previews in white at 85 %.
- Knobs draw a value arc (accent) over an inactive arc, a pointer line and a dark cap; faders
  have LED-segment meters (green → yellow → red) with peak hold.
- Icons on every control (lucide), consistent 14 px in toolbars, 12 px in rows.

### 11.2 Playhead ("position line")
- A 2 px white line with a fading tail gradient (LMMS `PositionLine`, tailGradient) in the
  Playlist, Piano Roll, Channel Rack and Automation lanes; red while recording.
- The ruler shows a playhead flag; the step grid lights the current step column; the toolbar LCD
  ticks bar:beat:tick at 60 fps; auto-scroll follows the line (page / continuous / off, like LMMS).

### 11.3 More detail
- Channel Rack: per-row LED activity flash on each hit, an instrument icon per type, step
  buttons with beat-group shading, velocity shown as fill height.
- Piano Roll: key column with real white/black key shading and the pressed key lit, note
  velocity as opacity, note names on long notes, a detuning/velocity lane switcher.
- Mixer: channel strips 76 px wide with LCD channel number, LED meters with peak hold, send
  knobs, effect chain list with power LEDs.
- Toolbar: LCD position / tempo / time-signature group, CPU-ish voice meter, master LED meter.
- Empty states with icon and one clear action.

### 11.4 Per-project workspace switch
- The rail's Music button moves to the title bar, beside the project name, as a two-way
  **Video | Music** switch (with the Beta · WIP tag).
- The choice is saved in the project (`Project.workspace: 'video' | 'music'`), so each open
  project tab keeps its own mode and reopens in it; switching tabs never changes another project.
- Each project tab is its own webview, so the studio bus, the engine and `studioOpen()` are
  per project already; the AI's project context now states the workspace and the song summary
  (name, tempo, key, channel / pattern counts) of *that* project, so a model working in one
  project never edits another project's song.

### 11.5 The song as a music layer on the timeline
- `src/music/timeline.ts` `placeSongLayer`: a bounce is laid once per composition on an audio track
  named **Music** (made when there is none), faded in and out, and remembered in
  `MusicProject.placements` (comp, clip, track, asset, bpm, beats, downbeats).
- Sending the song again — the studio's **Send to timeline** or `music_render {"place":true}` —
  swaps that clip's audio in place, keeping the start, level and track the editor set; a layer the
  editor deleted is placed fresh. `snap_cuts_to_beats` reads the placement's beats when the video
  has no production plan, so cutting to the AI's song needs no waveform analysis.

### 11.6 Theme
- Every `--ms-*` token is a Bhippi theme variable (`--deep`, `--app`, `--panel…`, `--line…`,
  `--text…`, `--accent`, `--blue-hi`, `--timecode` for the LCD digits, `--green/--amber/--red` for
  meters), so the studio matches the editor in every theme (default, minimal, midnight, obsidian,
  aurora) and accent. Canvas windows resolve the tokens to hex (`toHex`) and repaint when the theme
  changes (`useThemeVersion`).

### 11.7 Everything a person can do, the AI can do
- Every studio action maps to a music_* tool argument (audit in the 2026-10-18 session): transport
  (play / stop / rewind / play from a bar), PAT/SONG, metronome, snap, browser / playlist visibility
  and instrument / effect panels go through `music_open_studio` → `StudioRequest` → `StudioShell`.
  View-only gestures (zoom, scroll, auditioning) are the only things not exposed.
