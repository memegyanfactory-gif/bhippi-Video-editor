// The live transport (docs/MUSIC-STUDIO-PLAN.md §5): a look-ahead scheduler. Every 25 ms it schedules the
// next stretch (to 120 ms ahead) in one-step chunks, so notes, audio clips, automation and metronome clicks
// land sample-accurately on the AudioContext clock however late a timer fires.
//
//  - Pattern mode loops the active (or given) pattern. Song mode plays the playlist from `from` to the end of
//    the loop region (song.playlist.loop, else the whole song) and then loops from its start.
//  - The song can change while it plays: the note/clip lists are rebuilt on the next tick from the same step
//    cursor; voices already scheduled in the look-ahead window finish as they were.
//  - Tempo automation is handled by the TempoMap (step ↔ seconds); `position()` reads it back.
import { stepsPerBar, type MusicProject } from '../types';
import type { PlayMode } from './api';
import { planAutomation, scheduleAutomation, type AutomationPlan } from './automation';
import { TempoMap, expandAudioClips, expandEvents, playLengthSteps, type AudioClipEvent, type NoteEvent } from './events';
import type { MixerGraph } from './graph';
import type { Performer } from './performer';
import { unplugAll } from './util';

const TICK_MS = 25;
const LOOKAHEAD = 0.12;
const EPS = 1e-6;

export type StartOptions = { from?: number; mode: PlayMode; patternId?: string };

type Anchor = { time: number; step: number; steps: number; seconds: number };

export class Scheduler {
  metronome = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private mode: PlayMode = 'pattern';
  private patternId: string | undefined;
  private dirty = true;
  private events: NoteEvent[] = [];
  private audio: AudioClipEvent[] = [];
  private plan: AutomationPlan = [];
  private map!: TempoMap;
  private segStart = 0;
  private segEnd = 1;
  private cursor = 0;
  private cursorTime = 0;
  private anchors: Anchor[] = [];
  private readonly lastAuto = new Map<string, number>();

  constructor(private readonly ctx: AudioContext, private readonly graph: MixerGraph, private readonly performer: Performer, private song: MusicProject) {}

  get playing(): boolean {
    return this.running;
  }

  setSong(song: MusicProject): void {
    this.song = song;
    this.dirty = true;
  }

  start(options: StartOptions): void {
    this.stop();
    const song = this.song;
    this.mode = options.mode;
    this.patternId = options.patternId ?? (options.mode === 'pattern' ? song.view.activePatternId ?? undefined : undefined);
    this.layout();
    const loop = this.mode === 'song' ? song.playlist.loop : null;
    const wanted = options.from ?? (loop && loop.end > loop.start ? loop.start : 0);
    const length = this.segEnd - this.segStart;
    this.cursor = this.mode === 'pattern' ? (((wanted % length) + length) % length) : wanted >= this.segEnd || wanted < 0 ? this.segStart : wanted;
    this.cursorTime = this.ctx.currentTime + 0.06;
    this.anchors = [];
    this.lastAuto.clear();
    this.prepareAudio(true);
    this.graph.update(song, { reset: true });
    this.graph.sync(this.cursorTime);
    this.running = true;
    this.timer = setInterval(this.tick, TICK_MS);
    this.tick();
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    const was = this.running;
    this.running = false;
    this.anchors = [];
    if (was) {
      this.performer.stopAll(this.ctx.currentTime);
      this.graph.update(this.song, { reset: true });
    }
  }

  /** The playhead in steps (pattern-relative in pattern mode); 0 when stopped. */
  position(): number {
    if (!this.running || !this.anchors.length) return 0;
    const ctx = this.ctx;
    const now = ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
    let anchor = this.anchors[0];
    for (const a of this.anchors) {
      if (a.time <= now) anchor = a;
      else break;
    }
    if (anchor.time > now) return anchor.step;
    return anchor.step + Math.min(1, Math.max(0, (now - anchor.time) / anchor.seconds)) * anchor.steps;
  }

  // -------------------------------------------------------------------------------------------

  /** (Re)builds the loop window, tempo map and note list from the current song. */
  private layout(): void {
    const song = this.song;
    const length = Math.max(stepsPerBar(song), playLengthSteps(song, { mode: this.mode, patternId: this.patternId }));
    const loop = this.mode === 'song' ? song.playlist.loop : null;
    if (loop && loop.end > loop.start + EPS) {
      this.segStart = Math.max(0, loop.start);
      this.segEnd = loop.end;
    } else {
      this.segStart = 0;
      this.segEnd = length;
    }
    this.plan = this.mode === 'song' ? planAutomation(song) : [];
    this.map = new TempoMap(song, this.segEnd + 1, this.plan);
    this.events = expandEvents(song, { mode: this.mode, patternId: this.patternId, tempo: this.map, to: this.mode === 'song' ? this.segEnd : undefined }).sort((a, b) => a.step - b.step);
    this.dirty = false;
  }

  /** Audio clips from the cursor to the end of the loop; at a pass start the clips already under way are included. */
  private prepareAudio(passStart: boolean): void {
    if (this.mode !== 'song') {
      this.audio = [];
      return;
    }
    const clips = expandAudioClips(this.song, { from: this.cursor, to: this.segEnd, tempo: this.map });
    this.audio = passStart ? clips : clips.filter((c) => c.clipStart >= this.cursor - EPS);
  }

  private readonly tick = (): void => {
    if (!this.running) return;
    const now = this.ctx.currentTime;
    if (this.dirty) {
      this.layout();
      if (this.cursor >= this.segEnd - EPS || this.cursor < this.segStart) this.cursor = this.segStart;
      this.prepareAudio(false);
    }
    // Fell far behind (a throttled tab): jump ahead instead of dumping a burst of late notes.
    if (this.cursorTime < now - 0.05) this.skipTo(now + 0.02);
    for (let guard = 0; this.cursorTime < now + LOOKAHEAD && guard < 512; guard++) this.chunk();
  };

  private skipTo(time: number): void {
    const target = this.map.stepAt(this.map.timeAt(this.cursor) + (time - this.cursorTime));
    const span = this.segEnd - this.segStart;
    this.cursor = target >= this.segEnd ? this.segStart + ((target - this.segStart) % span) : target;
    this.cursorTime = time;
  }

  /** Schedules from the cursor to the next whole step (or the loop end). */
  private chunk(): void {
    const a = this.cursor;
    const b = Math.min(Math.floor(a + EPS) + 1, this.segEnd);
    const t0 = this.map.timeAt(a);
    const base = this.cursorTime;
    const timeOf = (step: number) => base + this.map.timeAt(step) - t0;

    let lo = 0;
    let hi = this.events.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.events[mid].step < a - EPS) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < this.events.length && this.events[i].step < b - EPS; i++) {
      const ev = this.events[i];
      this.performer.note(ev, base + ev.time - t0);
    }
    for (const clip of this.audio) if (clip.step >= a - EPS && clip.step < b - EPS) this.performer.audioClip(clip, base + clip.time - t0);
    scheduleAutomation(this.plan, this.graph, a, b, timeOf, this.lastAuto);
    if (this.metronome) this.clicks(a, b, timeOf);

    const seconds = this.map.timeAt(b) - t0;
    this.anchors.push({ time: base, step: a, steps: b - a, seconds });
    if (this.anchors.length > 96) this.anchors.splice(0, this.anchors.length - 64);
    this.cursorTime = base + seconds;
    this.cursor = b;
    if (b >= this.segEnd - EPS) {
      this.cursor = this.segStart;
      this.prepareAudio(true);
    }
  }

  /** A click on every beat in [a, b), accented on the bar. */
  private clicks(a: number, b: number, timeOf: (step: number) => number): void {
    const song = this.song;
    const beat = (song.stepsPerBeat * 4) / song.timeSig[1];
    const bar = stepsPerBar(song);
    for (let m = Math.ceil(a / beat - EPS); m * beat < b - EPS; m++) {
      const step = m * beat;
      const accent = Math.abs(step / bar - Math.round(step / bar)) < EPS;
      this.click(timeOf(step), accent);
    }
  }

  private click(time: number, accent: boolean): void {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = accent ? 1568 : 1046;
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(accent ? 0.5 : 0.32, time + 0.001);
    gain.gain.setTargetAtTime(0, time + 0.001, 0.012);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(time);
    osc.stop(time + 0.12);
    osc.onended = () => unplugAll([osc, gain]);
  }
}
