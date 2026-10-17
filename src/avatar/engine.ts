// The avatar on screen: where it goes, what it does there, and how it answers the user.
//
// Everything here is plain DOM driven from one animation frame loop — no React state — so the
// avatar never re-renders the editor. It mirrors the chat (mirror.ts): whatever the chat is doing
// at this moment is what the character does — the tool call running (research, mixing,
// directing, drawing, polishing), a step the CLI is taking, writing the reply, thinking, waiting
// on the user's answer — and the moment the chat stops, it stops. What a call changed on the
// timeline (a cut, a clip added, deleted, moved or tweaked) is acted out as a short reaction right
// after it; reactions the chat has already left behind are dropped rather than played late. The
// user can pick it up (it laughs and wriggles, then falls where it is dropped), poke it, and —
// while the AI is working on the video — gets their cursor slapped for touching the edit. A
// Plugin Maker turn is different work: the avatar builds the plugin (its own lines and sparks)
// and leaves the edit open, because nothing in the video is being changed.

import { councilMember, type CouncilRole } from '../lib/council';
import { LINES, type ActivityKind, type ClipDiff } from './brain';
import type { AvatarEvent, Ghost, TurnOutcome } from './bus';
import { ChatMirror, type Desire } from './mirror';
import { GLYPH_H, drawText, textWidth, wrap } from './pixelFont';
import { CAT_NAP, FPS, KENNEL, poseAt, type AnimName, type AnimOptions } from './poses';
import { ART_H, ART_W, CHARACTERS, CAT_TOP, CX, FEET_Y, HAIR_TOP, HEAD_Y, TORSO_Y, handPoint, paint, type Character, type Gear } from './sprite';
import { isHero } from './heroes';
import { HERO_LINES, HERO_STRIKE, HERO_TRAVEL, type Strike } from './heroPoses';
import { FX_MS, LANDS, drawProjectile, type Projectile } from './fx';
import { releaseOf, startSwing, stepSwing, swingDegrees, swingStretch, type Swing } from './swing';

/** Screen pixels per art pixel. */
export const SCALE = 2;
const S = SCALE;
/** The art row the mouse holds when it picks the avatar up (a fistful of hair). */
const HOLD_Y = HAIR_TOP + 9;
const GRAVITY = 2600;
/** The art row of the body's centre of mass: what swings on the grip, and what it spins about in the air. */
const COM_Y = 48;
/** The centre of mass in the body element's own pixels (the rotation origin whenever it is not held). */
const COM_LOCAL = { x: CX * S, y: COM_Y * S };
/**
 * What counts as reaching into the edit while the AI works: grabbing a clip or a track control,
 * dragging a layer in a monitor, changing a value in the inspector. Playing, seeking, scrolling
 * and zooming are just looking, and never get slapped.
 */
const EDIT_TARGETS = [
  '[data-panel="timeline"] .tl-clip', '[data-panel="timeline"] .tl-heads button', '[data-panel="timeline"] .tl-heads input',
  '[data-panel="program"] .monitor-frame', '[data-panel="source"] .monitor-frame',
  '[data-panel="properties"] input', '[data-panel="properties"] select', '[data-panel="properties"] textarea',
  '[data-panel="properties"] [role="slider"]', '[data-panel="properties"] button',
].join(', ');
/** Once it has started on what the chat is doing, it keeps at it this long, so a burst of quick calls does not flicker. */
const DWELL_MS = 600;
/** A timeline reaction still waiting after this long is old news: dropped, not played late. */
const REACTION_STALE_MS = 4_000;
const MAX_REACTIONS = 4;

type Vec = { x: number; y: number };
/** One stretch of a trip: a walk or run along a level, or a hop between levels. */
type Leg = { from: Vec; to: Vec; t0: number; dur: number; arc: number; anim: AnimName; rope?: 'web' | 'grapple' };
type Spot = { x: number; y: number; sit?: boolean; slideTo?: number };

/** Timeline edits the chat just made. */
type EditKind = 'cut' | 'add' | 'delete' | 'push' | 'tweak';
/** How a turn closed, and what the user does to the character. */
type ReactionKind = EditKind | 'celebrate' | 'failed' | 'wave' | 'slap' | 'dizzy' | 'poked' | 'power';
type JobKind = ActivityKind | ReactionKind;

/** Live jobs done where the character stands; the rest go to their place first. */
const IN_PLACE = new Set<JobKind>(['think', 'talk', 'celebrate', 'failed', 'wave', 'dizzy', 'poked', 'power']);
/** The strike moves, which for a hero are done with its own power. */
const SPIN = new Set<AnimName>(['power', 'cut', 'kick', 'slap']);
const EDITS = new Set<JobKind>(['cut', 'add', 'delete', 'push', 'tweak']);
/** Long work that gets the "!" (or the lightbulb) as it begins. */
const WORK = new Set<JobKind>(['research', 'mix', 'direct', 'draw', 'polish', 'tinker']);

type Job = {
  kind: JobKind;
  anim: AnimName;
  role: CouncilRole | null;
  /** Mirrors what the chat is doing (it lasts while the chat does it); otherwise a short reaction. */
  live: boolean;
  /** The chat activity a live job stands for (mirror.ts Desire.key). */
  key?: string;
  /** A reaction is shown this long. */
  minMs: number;
  created: number;
  spot: () => Spot | null;
  clipId?: string;
  /** Deleted clips, left on the timeline as ghosts until the kick. */
  ghostEls?: HTMLElement[];
  color?: string;
  point?: Vec;
  line?: string | null;
  fast?: boolean;
  /** Where it performs, once it has gone there; polishing slides along to `slideTo`. */
  slide?: Spot;
  dir?: number;
  arrived: boolean;
  started: number;
  fired: Set<string>;
};

type Particle = {
  x: number; y: number; vx: number; vy: number; g: number;
  age: number; life: number; color: string;
  kind: 'px' | 'plus' | 'star' | 'text' | 'marks' | 'bulb';
  text?: string; size?: number; dir?: number;
};

const GEAR: Record<CouncilRole, Gear> = { researcher: 'glasses', audio: 'headphones', director: 'beret', animator: 'visor', comedian: 'clown-nose' };
const JOB_ANIM: Record<JobKind, AnimName> = {
  research: 'research', mix: 'mix', direct: 'direct', draw: 'draw', polish: 'polish', think: 'think', talk: 'talk', ask: 'ask', tinker: 'tweak',
  cut: 'cut', add: 'place', delete: 'kick', push: 'push', tweak: 'tweak', celebrate: 'celebrate', failed: 'dizzy', wave: 'wave', slap: 'slap',
  dizzy: 'dizzy', poked: 'poked', power: 'power',
};

/** The arrow cursor, in pixels: X outline, W fill. */
const CURSOR = [
  'X........', 'XX.......', 'XWX......', 'XWWX.....', 'XWWWX....', 'XWWWWX...', 'XWWWWWX..', 'XWWWWWWX.',
  'XWWWWXXXX', 'XWXWWX...', 'XX.XWWX..', 'X...XWWX.', '.....XWX.', '.....XX..',
];

const pick = <T,>(list: T[]): T => list[Math.floor(Math.random() * list.length)];
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const q = (selector: string) => document.querySelector<HTMLElement>(selector);
const rectOf = (selector: string) => q(selector)?.getBoundingClientRect() ?? null;
const clipEl = (id: string) => q(`.tl-clip[data-clip-id="${CSS.escape(id)}"]`);

export class AvatarEngine {
  private readonly layer: HTMLElement;
  private readonly fx: HTMLCanvasElement;
  private readonly fxCtx: CanvasRenderingContext2D;
  private readonly body: HTMLElement;
  private readonly sprite: HTMLCanvasElement;
  private readonly spriteCtx: CanvasRenderingContext2D;
  private readonly hitbox: HTMLElement;
  private readonly shadow: HTMLElement;
  private readonly bubbleEl: HTMLCanvasElement;
  private readonly tagEl: HTMLCanvasElement;

  private raf = 0;
  private last = performance.now();
  private visible = false;
  private stageCheck = 0;

  private mode: 'free' | 'held' | 'falling' = 'free';
  private pos: Vec = { x: -200, y: -200 };
  private vel: Vec = { x: 0, y: 0 };
  private facing: 1 | -1 = 1;
  private angle = 0;
  private angleVel = 0;
  /** In the hand: the body hanging from the grip (swing.ts). */
  private swing: Swing | null = null;
  /** Degrees per second it turns while flying after a throw. */
  private spin = 0;
  private travel: Leg | null = null;
  /** The legs still to go after the current one (run along a level, then hop down). */
  private legs: Omit<Leg, 't0' | 'from'>[] = [];
  private job: Job | null = null;
  /** Short reactions waiting their turn (timeline edits, the end of a turn, the user's pokes). */
  private queue: Job[] = [];
  private anim: AnimName = 'idle';
  private animT0 = performance.now();
  private opts: AnimOptions = {};
  /** Who is on screen (Settings › Avatar). */
  private character: Character;
  private lastKey = '';
  private sitting = false;
  private homeOverride: Vec | null = null;
  /** Stopped where the chat stopped: it stays put until the next turn (or the user moves it). */
  private parked = false;

  /** What the chat is doing, from the bus. */
  private readonly mirror = new ChatMirror();
  private lastActive = performance.now();
  private lastSlap = 0;
  private pointer: Vec | null = null;

  private held: { start: number; startPos: Vec; origin: Vec; midAir: boolean; grab: Vec; lifted: number; pointer: Vec; moved: number; lastLine: number; samples: { t: number; x: number; y: number }[] } | null = null;
  private fallFrom = 0;

  private bubble: { text: string; until: number; style: 'normal' | 'shout' | 'laugh'; lines: string[]; w: number; h: number; drawnAt: number } | null = null;
  private tag: CouncilRole | null = null;
  private particles: Particle[] = [];
  /** Things a hero has thrown, fired or spun out, drawn on the effects canvas until they are over. */
  private projectiles: Projectile[] = [];
  /** The line a swinging or grappling hero hangs from: drawn from its hand to the anchor. */
  private rope: { kind: 'rope-web' | 'rope-grapple'; anchor: Vec } | null = null;
  /** When a hero next shows off its power on a panel (idle flourish). */
  private nextFlourish = performance.now() + 15_000;
  private nextHa = 0;
  private lastJob: JobKind | null = null;
  private styled = new WeakMap<HTMLElement, Partial<Record<'transform' | 'display' | 'opacity' | 'transformOrigin', string>>>();
  private fxDirty = false;
  private timers: number[] = [];

  /** Right-click on the character: the host shows its menu (hide it, its settings) at that point. */
  private readonly menu?: (point: Vec) => void;

  constructor(layer: HTMLElement, character: Character = 'heli', menu?: (point: Vec) => void) {
    this.layer = layer;
    this.menu = menu;
    this.character = character;
    this.fx = this.el('canvas', 'avatar-fx') as HTMLCanvasElement;
    this.fxCtx = this.fx.getContext('2d')!;
    this.shadow = this.el('div', 'avatar-shadow');
    this.body = this.el('div', 'avatar-body');
    this.body.style.width = `${ART_W * S}px`;
    this.body.style.height = `${ART_H * S}px`;
    this.body.style.transformOrigin = `${CX * S}px ${HOLD_Y * S}px`;
    this.sprite = document.createElement('canvas');
    this.sprite.className = 'avatar-sprite';
    this.sprite.width = ART_W;
    this.sprite.height = ART_H;
    this.sprite.style.width = `${ART_W * S}px`;
    this.sprite.style.height = `${ART_H * S}px`;
    this.spriteCtx = this.sprite.getContext('2d')!;
    this.hitbox = document.createElement('div');
    this.hitbox.className = 'avatar-hitbox';
    this.fitHitbox();
    this.body.append(this.sprite, this.hitbox);
    this.tagEl = this.el('canvas', 'avatar-tag') as HTMLCanvasElement;
    this.bubbleEl = this.el('canvas', 'avatar-bubble') as HTMLCanvasElement;
    this.resize();

    this.hitbox.addEventListener('pointerdown', this.onGrab);
    this.hitbox.addEventListener('contextmenu', this.onMenu);
    this.hitbox.addEventListener('pointermove', this.onDrag);
    this.hitbox.addEventListener('pointerup', this.onDrop);
    this.hitbox.addEventListener('pointercancel', this.onDrop);
    this.hitbox.addEventListener('lostpointercapture', this.onDrop);
    document.addEventListener('pointerdown', this.onDocPointer, true);
    document.addEventListener('keydown', this.onKey, true);
    window.addEventListener('pointermove', this.onPointerMove, { passive: true });
    window.addEventListener('resize', this.onResize);

    let greeted = false;
    try { greeted = sessionStorage.getItem('bhippi-avatar-greeted') === '1'; sessionStorage.setItem('bhippi-avatar-greeted', '1'); } catch { /* private mode */ }
    if (!greeted) this.react(this.makeJob('wave', { line: `Hi! I'm ${this.name}`, minMs: 1600 }));
    this.raf = requestAnimationFrame(this.frame);
  }

  /** The row the top of its head reaches: the cat stands lower than the others. */
  private get top() {
    return this.character === 'cat' ? CAT_TOP : HAIR_TOP;
  }

  /** The grab-and-poke area over the drawing, sized to whoever is on screen. */
  private fitHitbox() {
    const cat = this.character === 'cat';
    const half = cat ? 20 : this.character === 'brute' ? 17 : 14;
    Object.assign(this.hitbox.style, { left: `${(CX - half) * S}px`, top: `${(this.top + 3) * S}px`, width: `${half * 2 * S + (cat ? 2 : 0)}px`, height: `${(FEET_Y - this.top - 3) * S}px` });
    this.hitbox.title = `${this.name} — drag me, poke me, right-click for options`;
  }

  private get name() {
    return CHARACTERS.find((entry) => entry.id === this.character)?.name ?? 'Heli';
  }

  /** A line in this character's own voice, else the shared one (brain.ts LINES). */
  private line(key: string): string {
    return pick(HERO_LINES[this.character]?.[key] ?? LINES[key]);
  }

  /** Swaps who is on screen, mid-animation; the next frame draws the new character. */
  setCharacter(character: Character) {
    if (character === this.character) return;
    this.character = character;
    this.fitHitbox();
    this.lastKey = '';
    this.rope = null;
    this.projectiles = [];
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.hitbox.removeEventListener('pointerdown', this.onGrab);
    this.hitbox.removeEventListener('contextmenu', this.onMenu);
    this.hitbox.removeEventListener('pointermove', this.onDrag);
    this.hitbox.removeEventListener('pointerup', this.onDrop);
    this.hitbox.removeEventListener('pointercancel', this.onDrop);
    this.hitbox.removeEventListener('lostpointercapture', this.onDrop);
    document.removeEventListener('pointerdown', this.onDocPointer, true);
    document.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('resize', this.onResize);
    for (const timer of this.timers) window.clearTimeout(timer);
    for (const job of [this.job, ...this.queue]) if (job) this.release(job);
    for (const el of document.querySelectorAll<HTMLElement>('.tl-clip[data-avatar]')) delete el.dataset.avatar;
    this.layer.replaceChildren();
  }

  // ── inputs ────────────────────────────────────────────────────────────────

  handle(event: AvatarEvent) {
    const now = performance.now();
    const change = this.mirror.apply(event, now);
    // Only real work wakes it: late news from a stopped turn does not.
    if (change.type !== 'none' || this.mirror.busy(now)) this.lastActive = now;
    switch (change.type) {
      case 'started':
        this.parked = false;
        this.say(change.plugin ? pick(LINES.pluginWake) : this.line('wake'), 1100);
        break;
      case 'edited':
        if (change.event.diff) this.fromDiff(change.event.diff, change.event.ghosts, now);
        break;
      case 'ended':
        this.finish(change.outcome, now, change.plugin);
        break;
    }
  }

  /** The last live turn closed. Stopped: drop everything, right where it stands. */
  private finish(outcome: TurnOutcome, now: number, plugin = false) {
    if (outcome === 'stopped' || outcome === 'failed') {
      for (const job of [this.job, ...this.queue]) if (job) this.release(job);
      this.queue = [];
      this.job = null;
      // A hop in the air lands; a walk or a run stops on the spot.
      this.legs = [];
      if (this.travel && !this.travel.arc) this.travel = null;
      this.tag = null;
      this.sitting = false;
      this.parked = true;
      this.setAnim('idle', now);
      if (outcome === 'failed') this.react(this.makeJob('failed', { line: this.line('failed'), minMs: 1400 }));
      else this.say(this.line('stopped'), 1600);
      return;
    }
    // Finished: the last edits it made play out first, then the thumbs-up.
    this.react(this.makeJob('celebrate', { line: plugin ? pick(LINES.pluginDone) : this.line('done'), minMs: 2300 }));
  }

  private fromDiff(diff: ClipDiff, ghosts: Ghost[], now: number) {
    let count = 0;
    if (ghosts.length) {
      const first = ghosts[0];
      // The deleted clips stay as ghosts where they stood until the avatar gets there and kicks them.
      this.react(this.makeJob('delete', { ghostEls: this.showGhosts(ghosts.slice(0, 6)), spot: () => this.pointOnTracks(first.x + Math.min(first.w / 2, 36), first.y), line: Math.random() < 0.5 ? this.line('delete') : null, created: now }));
      count++;
    }
    for (const cut of diff.cuts.slice(0, 2)) {
      this.react(this.makeJob('cut', { clipId: cut.id, spot: () => this.clipSpot(cut.id, 'left', -20), created: now }));
      count++;
    }
    for (const id of diff.added.slice(0, 3)) {
      const el = clipEl(id);
      if (!el) continue;
      // The clip waits, faded, until the avatar has carried it over and put it down.
      el.dataset.avatar = 'pending';
      this.later(() => { if (el.dataset.avatar === 'pending') delete el.dataset.avatar; }, REACTION_STALE_MS + 4000);
      this.react(this.makeJob('add', { clipId: id, color: getComputedStyle(el).backgroundColor, spot: () => this.clipSpot(id, 'mid', 0), line: Math.random() < 0.35 ? this.line('add') : null, created: now }));
      count++;
    }
    if (diff.moved.length && count < 4) this.react(this.makeJob('push', { clipId: diff.moved[0], spot: () => this.clipSpot(diff.moved[0], 'left', -18), created: now }));
    // A changed setting is a visit to the Properties panel when it is open, where the avatar fiddles with the controls.
    else if (diff.changed.length && count < 3) this.react(this.makeJob('tweak', { clipId: diff.changed[0], spot: () => this.panelSpot('properties', 0.5) ?? this.clipSpot(diff.changed[0], 'mid', -10), created: now }));
  }

  private makeJob(kind: JobKind, over: Partial<Job> = {}): Job {
    const spot = over.spot ?? (() => this.spotFor(kind));
    return {
      kind, anim: JOB_ANIM[kind], role: null, live: false, minMs: 900, created: performance.now(),
      arrived: false, started: 0, fired: new Set(), ...over, spot,
    };
  }

  /** The job that acts out what the chat is doing now. */
  private liveJob(want: Desire): Job {
    const line = want.kind === 'think' || want.kind === 'talk' ? null : Math.random() < 0.6 ? pick(LINES[want.kind]) : null;
    return this.makeJob(want.kind, { live: true, key: want.key, role: want.role, line });
  }

  /** Queues a short reaction; a fast model's edits never pile up into a backlog. */
  private react(job: Job) {
    this.queue.push(job);
    while (this.queue.filter((waiting) => EDITS.has(waiting.kind)).length > MAX_REACTIONS) {
      const index = this.queue.findIndex((waiting) => EDITS.has(waiting.kind));
      const [dropped] = this.queue.splice(index, 1);
      this.release(dropped);
    }
    for (const waiting of this.queue) waiting.fast = this.queue.length >= 2;
  }

  /** The next reaction still worth playing; timeline edits the chat has long moved past are dropped. */
  private nextReaction(now: number, take: boolean): Job | null {
    while (this.queue.length) {
      const next = this.queue[0];
      if (EDITS.has(next.kind) && now - next.created > REACTION_STALE_MS) {
        this.queue.shift();
        this.release(next);
        continue;
      }
      return take ? this.queue.shift()! : next;
    }
    return null;
  }

  /** Puts `next` in hand now; a reaction it interrupts waits to be finished, a live job simply resumes later. */
  private interrupt(next: Job) {
    const current = this.job;
    if (current && !current.live && current.kind !== next.kind && current.kind !== 'slap') {
      current.arrived = false;
      current.started = 0;
      current.fired.clear();
      current.created = performance.now();
      this.queue.unshift(current);
    }
    this.travel = null;
    this.legs = [];
    this.job = next;
  }

  /** Undo whatever a job left hanging (a clip waiting to be placed, ghosts waiting for the kick). */
  private release(job: Job) {
    for (const el of job.ghostEls ?? []) el.remove();
    job.ghostEls = [];
    if (job.kind === 'add' && job.clipId) {
      const el = clipEl(job.clipId);
      if (el?.dataset.avatar === 'pending') delete el.dataset.avatar;
    }
  }

  // ── where things are ──────────────────────────────────────────────────────

  private panel(id: string) {
    return rectOf(`[data-panel="${id}"]`);
  }

  private home(): Spot | null {
    const tl = this.panel('timeline') ?? rectOf('.timeline');
    if (!tl) return null;
    if (this.homeOverride && this.homeOverride.x > 20 && this.homeOverride.x < window.innerWidth - 20 && this.homeOverride.y < window.innerHeight) return { ...this.homeOverride };
    return { x: tl.right - 84, y: tl.top + 2 };
  }

  private spotFor(kind: JobKind): Spot | null {
    if (IN_PLACE.has(kind)) return null;
    const tl = this.panel('timeline') ?? rectOf('.timeline');
    if (!tl) return null;
    const edge = (fraction: number, sit = false): Spot => ({ x: tl.left + tl.width * fraction, y: tl.top + 2, sit });
    // Each kind of work goes to the panel it belongs to when that panel is open, else to the timeline as before.
    switch (kind) {
      case 'research': return this.panelSpot('project', 0.4, true) ?? this.panelSpot('source', 0.5, true) ?? edge(0.2, true);
      case 'draw': return this.panelSpot('storyboard', 0.5) ?? edge(0.42);
      case 'tinker': return this.panelSpot(this.mirror.buildingPlugin(performance.now()) ? 'plugins' : 'tools', 0.5) ?? edge(0.3);
      case 'ask': return this.panelSpot('chat', 0.5) ?? null;
      case 'direct': {
        const frame = rectOf('[data-panel="program"] .monitor-frame');
        return frame && frame.width > 120 ? { x: frame.right - 46, y: frame.bottom } : edge(0.55);
      }
      case 'mix': {
        const meters = this.panelSpot('meters', 0.5);
        if (meters) return meters;
        const divider = rectOf('.tl-divider');
        const scroll = rectOf('.tl-scroll');
        if (divider && scroll && divider.top > scroll.top && divider.top < scroll.bottom) return { x: scroll.left + scroll.width * 0.6, y: divider.top + 1 };
        return edge(0.6);
      }
      case 'polish': {
        const ruler = rectOf('.tl-ruler');
        const scroll = rectOf('.tl-scroll');
        if (!ruler || !scroll) return edge(0.3);
        const left = scroll.left + this.trackHead() + 30;
        return { x: left, y: ruler.bottom + 1, slideTo: scroll.right - 40 };
      }
      default: return this.home();
    }
  }

  /** A place on the top edge of a panel, when that panel is open and big enough to stand on. */
  private panelSpot(id: string, fraction: number, sit = false): Spot | null {
    const r = this.panel(id);
    if (!r || r.width < 90 || r.height < 60 || r.bottom < 0 || r.top > window.innerHeight - 40) return null;
    return { x: r.left + r.width * fraction, y: Math.max(r.top + 2, 70), sit };
  }

  private trackHead() {
    const scroll = q('.tl-scroll');
    const value = scroll ? parseFloat(getComputedStyle(scroll).getPropertyValue('--tl-head')) : NaN;
    return Number.isFinite(value) ? value : 150;
  }

  /** A point on the visible track area (clamped into it). */
  private pointOnTracks(x: number, y: number): Spot | null {
    const scroll = rectOf('.tl-scroll');
    if (!scroll) return this.home();
    return { x: clamp(x, scroll.left + this.trackHead() + 16, scroll.right - 16), y: clamp(y, scroll.top + 34, scroll.bottom - 8) + 3 };
  }

  private clipSpot(id: string, edge: 'left' | 'mid', offset: number): Spot | null {
    const el = clipEl(id);
    if (!el) return this.home();
    const r = el.getBoundingClientRect();
    const x = edge === 'left' ? r.left : r.left + Math.min(r.width / 2, 60);
    return this.pointOnTracks(x + offset * this.facingTo(x), r.top);
  }

  private facingTo(x: number): 1 | -1 {
    return x >= this.pos.x ? 1 : -1;
  }

  // ── the loop ──────────────────────────────────────────────────────────────

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    // Motion integrates in small steps; particles age on the real clock even when frames are sparse.
    const real = Math.max(0, (now - this.last) / 1000);
    const dt = Math.min(0.05, real);
    this.last = now;
    if (now - this.stageCheck > 400) {
      this.stageCheck = now;
      const show = !!(this.panel('timeline') ?? rectOf('.timeline'));
      if (show !== this.visible) {
        this.visible = show;
        this.layer.style.display = show ? '' : 'none';
        if (show && this.pos.x < 0) {
          const home = this.home();
          if (home) this.pos = { x: home.x, y: home.y };
        }
      }
    }
    if (!this.visible) return;
    if (this.mode === 'held') this.updateHeld(dt, now);
    else if (this.mode === 'falling') this.updateFalling(dt, now);
    else {
      // Standing up straight is the resting state: any tilt a grab or a drop left behind eases out.
      if (this.angle || this.angleVel) this.settleAngle(dt);
      this.updateFree(dt, now);
    }
    this.ambient(now);
    this.updateParticles(Math.min(0.25, real));
    this.render(now);
  };

  private setAnim(anim: AnimName, now: number, options: AnimOptions = {}) {
    const key = JSON.stringify(options);
    if (anim !== this.anim || key !== JSON.stringify(this.opts)) {
      // Woken up, the genie bursts back out of its lamp.
      if (this.anim === 'sleep' && anim !== 'sleep' && this.character === 'genie' && now - this.animT0 > 600) this.poof(this.pos.x, this.pos.y - 40);
      // Woken up, the puppy's kennel vanishes in a puff as it bounds out.
      if (this.anim === 'sleep' && anim !== 'sleep' && this.character === 'puppy' && now - this.animT0 > 700) {
        const [x, y] = this.artToScreen([KENNEL.x, FEET_Y - 12]);
        this.poof(x, y);
      }
      if (anim !== this.anim) this.animT0 = now;
      this.anim = anim;
      this.opts = options;
    }
  }

  private jobOptions(job: Job | null): AnimOptions {
    return { gear: job?.role ? [GEAR[job.role]] : [], color: job?.color };
  }

  private goTo(spot: Spot, now: number, anim: AnimName | null, fast = false) {
    const from = { ...this.pos };
    const to = { x: spot.x, y: spot.y };
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const travel = isHero(this.character) ? HERO_TRAVEL[this.character] : 'walk';
    const leg = (a: Vec, b: Vec): Omit<Leg, 't0' | 'from'> => {
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const level = Math.abs(b.y - a.y) <= 6;
      const speed = fast ? 620 : dist > 220 ? 420 : 140;
      // Hop between levels (a panel edge down to a clip); along one level it walks or runs.
      let arc = level ? 0 : Math.min(70, 22 + Math.abs(b.y - a.y) * 0.25);
      let dur = level ? clamp(dist / speed, 0.12, fast ? 0.4 : 1.8) : clamp(0.3 + Math.abs(b.y - a.y) / 900 + Math.abs(b.x - a.x) / 1400, 0.3, 0.75);
      let name: AnimName = anim ?? (arc ? 'jump' : speed > 200 ? 'run' : 'walk');
      let rope: Leg['rope'];
      // Heroes get around their own way (a carried clip keeps its plain walk): flying, swinging on a web, grappling up, leaping, pouncing.
      if (!anim) {
        switch (travel) {
          case 'fly': arc = 0; dur = clamp(dist / 650, 0.25, 1.2); name = 'fly'; break;
          case 'swing':
            if (dist > 90) { arc = clamp(dist * 0.3 + 20, 50, 130); dur = clamp(0.35 + dist / 900, 0.4, 0.95); name = 'swing'; rope = 'web'; }
            break;
          case 'grapple':
            if (b.y < a.y - 10) { arc = 18; dur = clamp(0.3 + (a.y - b.y) / 900, 0.35, 0.6); name = 'swing'; rope = 'grapple'; }
            else if (!level) { arc = 12; name = 'swing'; }
            break;
          case 'leap':
            if (dist > 140) { arc = clamp(dist * 0.28, 40, 130); dur = clamp(0.35 + dist / 1100, 0.45, 0.95); name = 'jump'; }
            break;
          case 'pounce':
            if (dist > 140) { arc = clamp(dist * 0.16, 24, 60); dur = clamp(0.25 + dist / 1500, 0.3, 0.6); name = 'jump'; }
            break;
          default: break;
        }
      }
      return { to: b, dur: dur * 1000, arc, anim: name, rope };
    };
    // A long way to another level: run along this one to above the target, then hop down (or up). Flyers, swingers and leapers go in one.
    const single = travel !== 'walk' && travel !== 'grapple' && !anim;
    this.legs = !single && Math.abs(dy) > 6 && Math.abs(dx) > 150
      ? [leg(from, { x: to.x - Math.sign(dx) * 70, y: from.y }), leg({ x: to.x - Math.sign(dx) * 70, y: from.y }, to)]
      : [leg(from, to)];
    if (Math.abs(dx) > 2) this.facing = dx > 0 ? 1 : -1;
    this.startLeg(now);
    this.sitting = false;
  }

  private startLeg(now: number) {
    const next = this.legs.shift();
    this.travel = next ? { ...next, from: { ...this.pos }, t0: now } : null;
    // A web swing hangs from a point high above the middle of the leap; a grapple is fired at where it is going.
    if (next?.rope === 'web') this.rope = { kind: 'rope-web', anchor: { x: (this.pos.x + next.to.x) / 2, y: Math.max(10, Math.min(this.pos.y, next.to.y) - 150) } };
    else if (next?.rope === 'grapple') this.rope = { kind: 'rope-grapple', anchor: { x: next.to.x, y: next.to.y - 10 } };
    else this.rope = null;
  }

  /** Where a hand is on screen right now, for whatever starts at it. */
  private handScreen(which: 'l' | 'r', now: number): Vec {
    const [x, y] = this.artToScreen(handPoint(poseAt(this.anim, (now - this.animT0) / 1000, { ...this.opts, character: this.character }), which));
    return { x, y };
  }

  /** The hero's own power leaves its hands: a web, a batarang, a blast… and what it does when it lands. */
  private fire(kind: Strike, to: Vec) {
    const now = performance.now();
    if (kind === 'smash') {
      const at = { x: this.pos.x + this.facing * 22, y: this.pos.y };
      this.projectiles.push({ kind: 'shock', from: at, to: at, t0: now, dur: FX_MS.smash, facing: this.facing });
      this.dust(at.x, at.y, 10);
      this.emit({ kind: 'text', text: 'SMASH!', x: at.x - 18, y: at.y - 60, vx: 0, vy: -40, color: '#ffc23d', life: 0.8 });
      this.rumble(at.x, 380);
      this.hitPanel(to);
      return;
    }
    let from = this.handScreen(kind === 'shield' ? 'l' : 'r', now);
    if (kind === 'beam') {
      const pose = poseAt(this.anim, (now - this.animT0) / 1000, { ...this.opts, character: this.character });
      const [x, y] = this.artToScreen([CX + pose.headX + pose.lean, HEAD_Y + pose.y + pose.headY - 6]);
      from = { x, y };
    }
    if (kind === 'swipe' || kind === 'claw') from = to;
    this.projectiles.push({ kind, from, to, t0: now, dur: FX_MS[kind], facing: this.facing });
    this.later(() => this.land(kind, to), FX_MS[kind] * LANDS[kind]);
  }

  /** The blow lands: sparks, a word, and the panel it hit flashes. */
  private land(kind: Strike, at: Vec) {
    const look: Record<Exclude<Strike, 'smash'>, [string, string]> = {
      web: ['THWIP!', '#ffffff'], batarang: ['THUNK!', '#8792a8'], card: ['HA!', '#c8102e'], swipe: ['SWISH!', '#ffffff'], blast: ['BZZT!', '#7df3ff'],
      beam: ['ZAP!', '#ffe040'], arrow: ['THUNK!', '#cdd5e5'], shield: ['CLANG!', '#c8222e'], claw: ['SLASH!', '#d8dfef'], whirl: ['WHOOSH!', '#9cc4ee'],
    };
    if (kind === 'smash') return;
    const [text, color] = look[kind];
    this.burst(at.x, at.y, color, 10);
    this.burst(at.x, at.y, '#ffffff', 5);
    this.emit({ kind: 'text', text, x: at.x - 14, y: at.y - 24, vx: 0, vy: -40, color, life: 0.8 });
    this.hitPanel(at);
  }

  /** Whatever panel is under a hit takes a quick flash (see avatar.css). */
  private hitPanel(at: Vec) {
    const el = document.elementFromPoint(at.x, at.y)?.closest<HTMLElement>('[data-panel]');
    if (!el || el.dataset.avatarHit) return;
    el.dataset.avatarHit = '1';
    this.later(() => delete el.dataset.avatarHit, 450);
  }

  /** A slam shakes the clips near it. */
  private rumble(x: number, radius: number) {
    for (const el of document.querySelectorAll<HTMLElement>('.tl-clip[data-clip-id]')) {
      const r = el.getBoundingClientRect();
      if (Math.abs(r.left + r.width / 2 - x) > radius || el.dataset.avatar === 'pending') continue;
      el.dataset.avatar = 'bump';
      this.later(() => { if (el.dataset.avatar === 'bump') delete el.dataset.avatar; }, 400);
    }
  }

  /** The exhaust of a flying hero: jets, golden sparks, a rush of wind. */
  private trail() {
    if (Math.random() > 0.8) return;
    const [x, y] = this.artToScreen([CX - 2, FEET_Y - 3]);
    const colours = this.character === 'ironclad' ? ['#7df3ff', '#ffffff', '#ffb52e'] : this.character === 'synth' ? ['#ffe040', '#fff0a0'] : ['#ffffff', '#9cc4ee'];
    this.emit({ kind: 'px', x: x + (Math.random() - 0.5) * 8, y: y + Math.random() * 6, vx: -this.facing * (60 + Math.random() * 60), vy: 20 + Math.random() * 40, color: pick(colours), life: 0.35 });
  }

  /** The leaper's landing: dust, a ring along the ground, clips knocked about. */
  private slam() {
    const at = { x: this.pos.x, y: this.pos.y };
    this.projectiles.push({ kind: 'shock', from: at, to: at, t0: performance.now(), dur: FX_MS.smash, facing: this.facing });
    this.dust(at.x, at.y, 10);
    this.rumble(at.x, 320);
  }

  /** Laughing, tingling, roaring: what a poke sets off for each character. */
  private pokedFx() {
    const head = this.pos.y - (FEET_Y - this.top) * S;
    const say = (text: string, color: string, n = 3) => {
      for (let i = 0; i < n; i++) this.emit({ kind: 'text', text, x: this.pos.x - 22 + i * 18, y: head + 14 - (i % 2) * 10, vx: (i - 1) * 14, vy: -34, color, life: 0.8 });
    };
    switch (this.character) {
      case 'spider': say('!', '#ff5a5a'); break;
      case 'jester': say('HA', '#7ee06a', 2); break;
      case 'brute': say('GRR', '#a8e060', 1); break;
      case 'chakra': say('!', '#ffd23d', 2); break;
      case 'ironclad': say('BEEP', '#7df3ff', 1); break;
      default: break;
    }
  }

  /** What is always going on around some characters, whatever they do: the jester's laugh. */
  private ambient(now: number) {
    if (this.character !== 'jester' || this.mode === 'held' || this.anim === 'sleep' || now < this.nextHa) return;
    this.nextHa = now + 1500 + Math.random() * 1700;
    const [x, y] = this.artToScreen([CX + 8, HEAD_Y - 10]);
    this.emit({ kind: 'text', text: pick(['HA', 'HAHA', 'HEE', 'HA HA']), x, y, vx: 14 * this.facing, vy: -34, color: '#7ee06a', life: 0.9 });
    if (!this.bubble && Math.random() < 0.3) this.say(pick(['HAHAHA!', 'HEE HEE!', 'HA HA HA!']), 1100, 'laugh');
  }

  private updateFree(dt: number, now: number) {
    const want = this.mirror.desired(now);
    if (this.travel) {
      // The chat moved on while it was on its way to the last thing: it turns round for the new work.
      const job = this.job;
      if (job?.live && !job.started && job.key !== want?.key && !this.travel.arc) {
        this.travel = null;
        this.legs = [];
        this.job = null;
      } else {
        const tr = this.travel;
        const u = clamp((now - tr.t0) / tr.dur, 0, 1);
        const e = tr.arc ? u : u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
        this.pos = { x: tr.from.x + (tr.to.x - tr.from.x) * e, y: tr.from.y + (tr.to.y - tr.from.y) * e - tr.arc * 4 * u * (1 - u) };
        this.setAnim(tr.anim, now, this.jobOptions(this.job));
        if (tr.anim === 'fly') this.trail();
        if (u >= 1) {
          this.pos = { ...tr.to };
          if (tr.arc) this.dust(this.pos.x, this.pos.y, 4);
          if (tr.arc && this.character === 'brute' && tr.dur > 400) this.slam();
          this.startLeg(now);
        }
        return;
      }
    }
    // What it is doing gives way the moment the chat does something else, or an edit it just made wants showing.
    const current = this.job;
    if (current?.live) {
      const settled = !current.started || now - current.started >= DWELL_MS || current.kind === 'think' || current.kind === 'talk';
      if (settled && (current.key !== want?.key || this.nextReaction(now, false))) this.endJob(current, now);
    }
    if (!this.job) this.job = this.nextReaction(now, true) ?? (want ? this.liveJob(want) : null);
    const job = this.job;
    if (job) {
      if (!job.arrived) {
        const spot = job.spot();
        job.arrived = true;
        if (spot && Math.hypot(spot.x - this.pos.x, spot.y - this.pos.y) > 4) {
          const carrying: AnimName | null = job.kind === 'add' ? 'carry' : null;
          if (job.kind === 'add') this.poof(this.pos.x, this.pos.y - 70);
          // Live work dashes over, so it arrives while the chat is still doing it.
          this.goTo(spot, now, carrying, job.fast || job.live || job.kind === 'slap');
          if (job.kind === 'slap' && job.point) this.facing = job.point.x >= spot.x ? 1 : -1;
          job.slide = spot;
          return;
        }
        job.slide = spot ?? undefined;
      }
      if (!job.started) this.beginJob(job, now);
      this.performJob(job, now, dt);
      // A live job lasts as long as the chat does that; a reaction, its own length.
      if (!job.live && now - job.started >= (job.fast ? job.minMs * 0.6 : job.minMs)) this.endJob(job, now);
      return;
    }
    // Idle heroes now and then show off their power on one of the panels.
    if (isHero(this.character) && !this.parked && now > this.nextFlourish && now - this.lastActive > 5000 && now - this.lastActive < 55_000) {
      this.nextFlourish = now + 20_000 + Math.random() * 25_000;
      const panels = [...document.querySelectorAll<HTMLElement>('[data-panel]')].map((el) => el.getBoundingClientRect()).filter((r) => r.width > 120 && r.height > 80);
      const r = panels.length ? pick(panels) : null;
      const point = r ? { x: r.left + r.width * (0.3 + Math.random() * 0.4), y: r.top + r.height * 0.4 } : { x: this.pos.x + 200 * this.facing, y: this.pos.y - 60 };
      this.react(this.makeJob('power', { point, minMs: 1800 }));
    }
    // Nothing to do: go home (unless it stopped where the chat stopped), then idle, and sleep when left alone.
    const home = this.home();
    if (!this.parked && home && Math.hypot(home.x - this.pos.x, home.y - this.pos.y) > 6 && now - this.lastActive > 700) {
      this.goTo(home, now, null);
      return;
    }
    this.tag = null;
    if (now - this.lastActive > 60_000) {
      this.setAnim('sleep', now);
      // The genie sleeps inside its lamp: a puff as it streams in, and the z's rise from the spout.
      // The puppy sets its kennel down with a bump of dust, and snores out of the doorway.
      const inLamp = this.character === 'genie';
      const inKennel = this.character === 'puppy';
      const slept = now - this.animT0;
      const reached = (ms: number) => slept >= ms && slept - dt * 1000 < ms;
      if (inLamp && reached(600)) this.poof(this.pos.x, this.pos.y - 40);
      if (inKennel && reached(KENNEL.landsAt * 1000)) {
        const [x, y] = this.artToScreen([KENNEL.x, FEET_Y]);
        this.dust(x, y, 8);
      }
      // The cat curls up after its stretch and its kneading; the z's rise from its curled-up head.
      const curled = this.character === 'cat';
      if (inLamp ? slept > 1100 : inKennel ? slept > KENNEL.asleepAt * 1000 : curled ? slept > CAT_NAP * 1000 : true) {
        const [kx, ky] = this.artToScreen(inKennel ? [KENNEL.x + 6, FEET_Y - 13] : [CX + 12, FEET_Y - 26]);
        const z = inLamp ? { x: this.pos.x + 12 * S * this.facing, y: this.pos.y - 14 * S } : inKennel || curled ? { x: kx, y: ky } : { x: this.pos.x + 14, y: this.pos.y - 92 };
        if (Math.floor(now / 1100) !== Math.floor((now - dt * 1000) / 1100)) this.emit({ kind: 'text', text: 'z', x: z.x, y: z.y, vx: 14 * (inLamp || inKennel || curled ? this.facing : 1), vy: -26, color: '#bfe6ff', life: 2 });
      }
    } else this.setAnim('idle', now);
  }

  private beginJob(job: Job, now: number) {
    job.started = now;
    // The first frame of long work: it notices the job ("!"); straight after thinking, an idea.
    if (WORK.has(job.kind)) {
      const head = this.pos.y - (FEET_Y - this.top) * S;
      if (this.lastJob === 'think') this.emit({ kind: 'bulb', x: this.pos.x + 26 * this.facing, y: head + 10, vx: 0, vy: -10, color: '#ffe066', life: 1.1 });
      else this.emit({ kind: 'marks', x: this.pos.x + 26 * this.facing, y: head + 22, vx: 0, vy: 0, color: '#ffc23d', life: 0.55, dir: this.facing });
    }
    this.lastJob = job.kind;
    this.tag = job.role;
    this.sitting = !!job.slide?.sit;
    if ((job.kind === 'slap' || job.kind === 'power') && job.point) this.facing = job.point.x >= this.pos.x ? 1 : -1;
    if (job.kind === 'push' || job.kind === 'tweak' || job.kind === 'cut') {
      const el = job.clipId ? clipEl(job.clipId) : null;
      if (el) this.facing = el.getBoundingClientRect().left + 10 >= this.pos.x ? 1 : -1;
    }
    if (job.kind === 'polish' || job.kind === 'research' || job.kind === 'draw' || job.kind === 'mix') this.facing = 1;
    // Writing the reply, and asking the user something: it turns to the chat.
    if (job.kind === 'talk' || job.kind === 'ask') {
      const chat = this.panel('chat');
      if (chat && chat.width > 0) this.facing = chat.left + chat.width / 2 >= this.pos.x ? 1 : -1;
    }
    this.setAnim(job.anim, now, this.jobOptions(job));
    if (job.line) this.say(job.line, 2200);
  }

  private performJob(job: Job, now: number, dt: number) {
    const t = (now - job.started) / 1000;
    const once = (key: string, at: number, fn: () => void) => { if (t >= at && !job.fired.has(key)) { job.fired.add(key); fn(); } };
    const every = (period: number, fn: () => void) => { if (Math.floor(t / period) !== Math.floor((t - dt) / period)) fn(); };
    const hand = (which: 'l' | 'r') => this.artToScreen(handPoint(poseAt(this.anim, t, { ...this.opts, character: this.character }), which));
    const overHead = this.pos.y - (FEET_Y - this.top) * S;
    this.setAnim(job.anim, now, this.jobOptions(job));
    // A hero cuts, deletes and slaps with its own power instead of scissors and a kick.
    const strike = isHero(this.character) ? HERO_STRIKE[this.character] : null;
    if (strike === 'whirl' && SPIN.has(job.anim)) every(0.07, () => this.emit({ kind: 'px', x: this.pos.x + (Math.random() - 0.5) * 40, y: this.pos.y - Math.random() * 50, vx: (Math.random() - 0.5) * 120, vy: -20, color: pick(['#ffffff', '#9cc4ee']), life: 0.4 }));
    switch (job.kind) {
      case 'power':
        once('fire', 0.3, () => {
          if (strike) this.fire(strike, job.point ?? { x: this.pos.x + 200 * this.facing, y: this.pos.y - 60 });
          if (Math.random() < 0.6) this.say(this.line('wake'), 1400);
        });
        break;
      case 'poked':
        if (job.anim === 'poked') once('fx', 0.02, () => this.pokedFx());
        break;
      case 'polish': {
        const slide = job.slide;
        if (slide?.slideTo !== undefined) {
          const dir = job.dir ?? 1;
          this.pos.x += dir * 70 * dt;
          this.facing = dir > 0 ? 1 : -1;
          if (this.pos.x > slide.slideTo) job.dir = -1;
          if (this.pos.x < slide.x) job.dir = 1;
        }
        every(0.1, () => { const [x, y] = hand('r'); this.sparkle(x, y + 8); });
        break;
      }
      case 'mix':
        every(0.45, () => this.emit({ kind: 'text', text: '*', x: this.pos.x + (Math.random() * 40 - 20), y: this.pos.y - 96, vx: 20 * (Math.random() - 0.3), vy: -46, color: pick(['#b57bff', '#ff8fd0', '#7fd6ff']), life: 1.4 }));
        break;
      case 'research':
        every(1.3, () => this.emit({ kind: 'text', text: pick(['?', '!', 'WWW', 'SRC', 'CC0', '?!']), x: this.pos.x - 10 + Math.random() * 30, y: this.pos.y - 100, vx: 0, vy: -30, color: pick(['#4fb3ff', '#ffd35a', '#ffffff']), life: 1.1 }));
        break;
      case 'draw': {
        every(0.3, () => {
          const frameNo = 1 + Math.floor(t / 0.3);
          const [x, y] = hand('l');
          this.emit({ kind: 'text', text: `F${frameNo}`, x: x - 6, y: y - 20, vx: -10, vy: -40, color: '#ff7a45', life: 0.8 });
        });
        break;
      }
      case 'direct': {
        const cycle = Math.floor(t / 3);
        once(`clap${cycle}`, cycle * 3 + 2.3, () => {
          const [x, y] = hand('r');
          this.burst(x + 8, y - 8, '#ffffff', 6);
          this.emit({ kind: 'text', text: 'CLAP!', x: x + 6, y: y - 22, vx: 10, vy: -30, color: '#ffc23d', life: 0.8 });
          if (Math.random() < 0.4) this.say(pick(LINES.direct), 1400);
        });
        break;
      }
      case 'tinker': {
        // Building a plugin reads as code going in, not a command running.
        const plugin = this.mirror.buildingPlugin(now);
        every(0.5, () => { const [x, y] = hand('r'); this.burst(x + 8 * this.facing, y - 10, '#ffd35a', 3); });
        every(1.6, () => this.emit({ kind: 'text', text: pick(plugin ? ['</>', '{ }', 'JS', 'UI', 'OK!'] : ['>_', 'RUN', 'OK!']), x: this.pos.x - 10 + Math.random() * 20, y: overHead + 8, vx: 0, vy: -30, color: plugin ? '#7fd6ff' : '#3ecf8e', life: 1 }));
        if (plugin) every(6, () => { if (Math.random() < 0.45) this.say(pick(LINES.plugin), 1600); });
        break;
      }
      case 'think':
        every(4.5, () => { if (Math.random() < 0.35) this.say(pick(LINES.think), 1400); });
        break;
      case 'talk':
        // Writing the reply: a typing bubble, like the chat's own.
        every(0.35, () => this.say(['.', '..', '...'][Math.floor(t / 0.35) % 3], 600));
        break;
      case 'ask':
        once('ask', 0.05, () => this.say(this.line('ask'), 2600));
        every(1.1, () => this.emit({ kind: 'text', text: '?', x: this.pos.x + 18 * this.facing, y: overHead - 4, vx: 6 * this.facing, vy: -28, color: '#ffd35a', life: 1 }));
        break;
      case 'cut': {
        if (strike) {
          once('fire', 0.25, () => {
            const el = job.clipId ? clipEl(job.clipId) : null;
            if (el) { const r = el.getBoundingClientRect(); this.fire(strike, { x: r.left, y: r.top + r.height / 2 }); }
            if (Math.random() < 0.4) this.say(this.line('cut'), 1200);
          });
        } else every(1 / 3, () => {
          if (Math.floor(t * 3) % 2 !== 1) return;
          const [x, y] = hand('r');
          this.burst(x + 18 * this.facing, y, '#ffffff', 4);
        });
        once('cutline', 0.34, () => {
          const el = job.clipId ? clipEl(job.clipId) : null;
          if (!el) return;
          const r = el.getBoundingClientRect();
          this.cutLine(r.left, r.top, r.height);
          this.emit({ kind: 'text', text: 'SNIP!', x: r.left - 12, y: r.top - 14, vx: 0, vy: -36, color: '#ffffff', life: 0.9 });
        });
        break;
      }
      case 'add':
        once('placed', 0.42, () => {
          const el = job.clipId ? clipEl(job.clipId) : null;
          if (el) {
            el.dataset.avatar = 'placed';
            this.later(() => { if (el.dataset.avatar === 'placed') delete el.dataset.avatar; }, 600);
          }
          this.dust(this.pos.x, this.pos.y, 6);
          this.sparkle(this.pos.x + 20 * this.facing, this.pos.y - 10);
        });
        break;
      case 'delete':
        if (strike) {
          once('fire', 0.2, () => {
            const ghost = job.ghostEls?.[0]?.getBoundingClientRect();
            if (ghost) this.fire(strike, { x: ghost.left + ghost.width / 2, y: ghost.top + ghost.height / 2 });
          });
        }
        once('kick', 0.3, () => this.launchGhosts(job));
        break;
      case 'push':
        once('bump', 0.1, () => this.bump(job.clipId));
        break;
      case 'tweak':
        every(0.5, () => { const [x, y] = hand('r'); this.burst(x + 8 * this.facing, y - 10, '#ffd35a', 3); this.bump(job.clipId); });
        break;
      case 'slap':
        if (strike) once('fire', 0.1, () => this.fire(strike, job.point ?? this.pos));
        once('hit', 0.2, () => {
          const p = job.point ?? this.pos;
          this.burst(p.x, p.y, '#ffffff', 10);
          this.burst(p.x, p.y, '#ffd35a', 6);
          this.emit({ kind: 'text', text: 'SLAP!', x: p.x - 14, y: p.y - 26, vx: 0, vy: -50, color: '#ff5a5a', life: 0.9 });
          this.flingCursor(p);
          this.say(this.line('slap'), 1700, 'shout');
        });
        break;
      case 'celebrate':
        if (t < 1.1) every(0.12, () => this.emit({ kind: 'px', x: this.pos.x + (Math.random() - 0.5) * 60, y: this.pos.y - 120, vx: (Math.random() - 0.5) * 120, vy: -60 - Math.random() * 80, g: 380, color: pick(['#ffb52e', '#4fb3ff', '#ff7a45', '#b57bff', '#3ecf8e']), life: 1.2 }));
        // The thumbs-up lands with a twinkle, as at the end of every sprite sheet.
        once('thumb', 1.15, () => {
          const [x, y] = hand('r');
          this.emit({ kind: 'star', x: x + 12 * this.facing, y: y - 16, vx: 0, vy: -6, color: '#ffe066', life: 0.9 });
          this.sparkle(x, y - 6);
        });
        break;
    }
  }

  private endJob(job: Job, now: number) {
    this.release(job);
    this.job = null;
    this.tag = null;
    this.sitting = false;
    if (job.kind === 'slap' || job.kind === 'dizzy' || job.kind === 'poked') this.lastActive = now;
  }

  // ── the user ──────────────────────────────────────────────────────────────

  private onPointerMove = (event: PointerEvent) => {
    this.pointer = { x: event.clientX, y: event.clientY };
  };

  private onResize = () => {
    this.resize();
    this.homeOverride = null;
  };

  private resize() {
    const dpr = window.devicePixelRatio || 1;
    this.fx.width = Math.round(window.innerWidth * dpr);
    this.fx.height = Math.round(window.innerHeight * dpr);
    this.fxCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.fxCtx.imageSmoothingEnabled = false;
  }

  private onMenu = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (this.mode === 'held') return;
    this.menu?.({ x: event.clientX, y: event.clientY });
  };

  private onGrab = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.hitbox.setPointerCapture(event.pointerId);
    const midAir = this.mode === 'falling';
    this.mode = 'held';
    this.travel = null;
    this.legs = [];
    const pointer = { x: event.clientX, y: event.clientY };
    this.held = { start: performance.now(), startPos: pointer, origin: { ...this.pos }, midAir, grab: { x: this.pos.x - pointer.x, y: this.pos.y - pointer.y }, lifted: 0, pointer, moved: 0, lastLine: 0, samples: [] };
    // It hangs from the very point under the pointer, posed exactly as it is: no jump, no turn.
    this.swing = startSwing(pointer, this.centreOfMass(), this.angle);
    this.spin = 0;
    this.hitbox.classList.add('grabbing');
  };

  private onDrag = (event: PointerEvent) => {
    if (this.mode !== 'held' || !this.held) return;
    const now = performance.now();
    this.held.moved = Math.max(this.held.moved, Math.hypot(event.clientX - this.held.startPos.x, event.clientY - this.held.startPos.y));
    this.held.samples.push({ t: now, x: event.clientX, y: event.clientY });
    this.held.samples = this.held.samples.filter((s) => now - s.t < 90);
    this.held.pointer = { x: event.clientX, y: event.clientY };
    if (!this.held.lifted && this.held.moved > 4) this.held.lifted = now;
  };

  private onDrop = (event: PointerEvent) => {
    if (this.mode !== 'held' || !this.held) return;
    const held = this.held;
    // Cleared before releasing: releasing fires lostpointercapture, which lands here again.
    this.held = null;
    if (this.hitbox.hasPointerCapture?.(event.pointerId)) this.hitbox.releasePointerCapture(event.pointerId);
    this.hitbox.classList.remove('grabbing');
    const now = performance.now();
    this.lastActive = now;
    const swing = this.swing;
    this.swing = null;
    if (!held.lifted && held.midAir) {
      // Caught mid-fall and let go without a lift: it carries on falling from where it hung.
      this.vel = { x: 0, y: 0 };
      this.mode = 'falling';
      return;
    }
    if (!held.lifted || !swing) {
      // A click, not a lift: a giggle where it stands, then back to work.
      this.mode = 'free';
      this.angle = 0;
      this.angleVel = 0;
      this.pos = held.origin;
      this.interrupt(this.makeJob('poked', { line: this.line('poked'), minMs: 700 }));
      return;
    }
    // Let go: it flies on with its body's real velocity (the hand's, plus the swing) and keeps
    // turning at the rate it was swinging. A still hand is a plain drop.
    const thrown = releaseOf(swing);
    this.vel = { x: clamp(thrown.velocity.x, -1600, 1600), y: clamp(thrown.velocity.y, -1500, 1300) };
    this.spin = thrown.spin;
    // Its feet are where the centre of mass sits over them, as it is turned now.
    this.pos = { x: swing.bob.x, y: swing.bob.y + (FEET_Y - COM_Y) * S };
    this.mode = 'falling';
    this.fallFrom = this.pos.y;
    this.bubble = null;
  };

  /** The body's centre of mass on screen (it turns about it when not held). */
  private centreOfMass() {
    return { x: this.pos.x, y: this.pos.y - (FEET_Y - COM_Y) * S };
  }

  /** The grip in the body element's own pixels: the centre of mass minus the rod. */
  private gripLocal(swing: Swing) {
    return { x: COM_LOCAL.x - swing.arm.x, y: COM_LOCAL.y - swing.arm.y };
  }

  /** Where its feet reference sits when the grip is at the pointer (the element is placed from it). */
  private feetFromGrip(swing: Swing) {
    const grip = this.gripLocal(swing);
    return { x: swing.pivot.x - grip.x + CX * S, y: swing.pivot.y - grip.y + FEET_Y * S };
  }

  private settleAngle(dt: number) {
    this.angleVel = 0;
    this.angle *= 1 - Math.min(1, dt * 12);
    if (Math.abs(this.angle) < 0.2) this.angle = 0;
  }

  private updateHeld(dt: number, now: number) {
    const held = this.held;
    if (!held?.lifted) return;
    // Lifted: it hangs from where it was grabbed and the physics does the rest — a shake swings
    // it, circles wind it up (fast enough and it goes right round the cursor), a yank stretches it.
    held.samples = held.samples.filter((s) => now - s.t < 90);
    if (this.swing) {
      stepSwing(this.swing, held.pointer, dt, { gravity: GRAVITY });
      this.angle = swingDegrees(this.swing);
      this.pos = this.feetFromGrip(this.swing);
    }
    this.sitting = false;
    this.setAnim('dangle', now);
    this.tag = null;
    if (now - held.lastLine > 1100) {
      held.lastLine = now;
      this.say(this.line('grabbed'), 1100, 'laugh');
    }
    if (Math.random() < dt * 3) this.emit({ kind: 'px', x: this.pos.x + (Math.random() - 0.5) * 30, y: this.pos.y - 90, vx: (Math.random() - 0.5) * 60, vy: -40, g: 300, color: '#bfe6ff', life: 0.6 });
  }

  private groundBelow(x: number, y: number): number {
    const floors = [window.innerHeight - 4];
    const tl = this.panel('timeline');
    if (tl && x > tl.left && x < tl.right) floors.push(tl.top + 2);
    const frame = rectOf('[data-panel="program"] .monitor-frame');
    if (frame && x > frame.left && x < frame.right) floors.push(frame.bottom);
    // Every open panel is something to land on: its top edge is a floor.
    for (const el of document.querySelectorAll<HTMLElement>('[data-panel]')) {
      const r = el.getBoundingClientRect();
      if (r.width > 90 && r.height > 60 && x > r.left && x < r.right) floors.push(r.top + 2);
    }
    // Over the tracks it lands on a clip, or the bottom of the track area.
    const scroll = rectOf('.tl-scroll');
    if (scroll && x > scroll.left && x < scroll.right) {
      floors.push(scroll.bottom - 4);
      for (const el of document.querySelectorAll<HTMLElement>('.tl-clip[data-clip-id]')) {
        const r = el.getBoundingClientRect();
        if (x > r.left && x < r.right && r.top > scroll.top + 30 && r.top < scroll.bottom) floors.push(r.top + 3);
      }
    }
    const below = floors.filter((f) => f >= y - 2);
    return below.length ? Math.min(...below) : window.innerHeight - 4;
  }

  private updateFalling(dt: number, now: number) {
    const before = this.pos.y;
    this.vel.y += GRAVITY * dt;
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    if (this.pos.x < 24 || this.pos.x > window.innerWidth - 24) {
      this.vel.x *= -0.5;
      // A wall knocks the spin back the other way.
      this.spin *= -0.6;
      this.pos.x = clamp(this.pos.x, 24, window.innerWidth - 24);
    }
    // Thrown spinning, it turns on through the air, slowed by the air; without a spin it rights itself.
    if (Math.abs(this.spin) > 30) {
      this.angle += this.spin * dt;
      this.spin *= Math.exp(-1.1 * dt);
    } else {
      this.spin = 0;
      const upright = Math.round(this.angle / 360) * 360;
      this.angle = upright + (this.angle - upright) * (1 - Math.min(1, dt * 8));
    }
    this.setAnim(this.vel.y < 0 ? 'jump' : 'fall', now);
    if (this.vel.x) this.facing = this.vel.x > 0 ? 1 : -1;
    const ground = this.groundBelow(this.pos.x, before);
    if (this.pos.y >= ground && this.vel.y > 0) {
      this.pos.y = ground;
      this.mode = 'free';
      // Whatever turn it came down on, it gets up the short way round; on its head, it is dizzy.
      const tilt = ((((this.angle + 180) % 360) + 360) % 360) - 180;
      const onItsHead = Math.abs(tilt) > 100 || Math.abs(this.spin) > 540;
      this.angle = tilt;
      this.angleVel = 0;
      this.spin = 0;
      const height = onItsHead ? Math.max(ground - this.fallFrom, 300) : ground - this.fallFrom;
      this.dust(this.pos.x, this.pos.y, height > 120 ? 10 : 5);
      this.homeOverride = { ...this.pos };
      this.parked = false;
      // It lands, then walks back to whatever the chat is doing.
      this.interrupt(this.makeJob(height > 260 ? 'dizzy' : 'poked', { minMs: height > 260 ? 1500 : 450, line: height > 260 ? this.line('dizzy') : null, anim: height > 260 ? 'dizzy' : 'land' }));
      if (height > 260) this.later(() => this.emit({ kind: 'star', x: this.pos.x, y: this.pos.y - 110, vx: 0, vy: -10, color: '#ffd35a', life: 1.2 }), 50);
    }
  }

  /** The user reached into the edit while the AI works on it. */
  private onDocPointer = (event: PointerEvent) => {
    if (!this.visible || !this.mirror.editBusy(performance.now())) return;
    const target = event.target as HTMLElement | null;
    if (!target || target.closest('.avatar-layer') || !target.closest(EDIT_TARGETS)) return;
    this.slapAt({ x: event.clientX, y: event.clientY });
  };

  private onKey = (event: KeyboardEvent) => {
    if (!this.visible || event.repeat || !this.mirror.editBusy(performance.now())) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable="true"], [data-panel="chat"]')) return;
    const key = event.key.toLowerCase();
    const mod = event.ctrlKey || event.metaKey;
    const edit = key === 'delete' || key === 'backspace' || (mod && ['z', 'y', 'x', 'v', 'd'].includes(key)) || (!mod && ['s', 'c'].includes(key));
    if (!edit) return;
    const tl = this.panel('timeline');
    this.slapAt(this.pointer ?? (tl ? { x: tl.left + tl.width / 2, y: tl.top + 60 } : this.pos));
  };

  private slapAt(point: Vec) {
    const now = performance.now();
    if (now - this.lastSlap < 900 || this.mode !== 'free') return;
    this.lastSlap = now;
    this.lastActive = now;
    // Drop what it is doing (it comes back to it), dash over and slap the cursor away.
    // Where the slapping hand lands relative to the feet (poses.ts, slap: armR [9, -3] from the shoulder at CX+6).
    const handX = (6 + 9) * S;
    const handY = (FEET_Y - (TORSO_Y + 2 - 3)) * S;
    const side: 1 | -1 = point.x >= this.pos.x ? 1 : -1;
    const spot: Spot = { x: clamp(point.x - handX * side, 20, window.innerWidth - 20), y: clamp(point.y + handY, 60, window.innerHeight - 4) };
    this.interrupt(this.makeJob('slap', { point, spot: () => spot, minMs: 1500 }));
  }

  // ── effects ───────────────────────────────────────────────────────────────

  private el(tag: 'div' | 'canvas', className: string) {
    const node = document.createElement(tag);
    node.className = className;
    this.layer.append(node);
    return node;
  }

  private later(fn: () => void, ms: number) {
    const id = window.setTimeout(() => { this.timers = this.timers.filter((t) => t !== id); fn(); }, ms);
    this.timers.push(id);
  }

  private artToScreen([ax, ay]: [number, number]): [number, number] {
    const flipped = this.facing < 0 ? CX - (ax - CX) : ax;
    return [this.pos.x + (flipped - CX) * S, this.pos.y + (ay - FEET_Y) * S];
  }

  private emit(p: Omit<Particle, 'age' | 'g'> & { g?: number }) {
    if (this.particles.length > 260) this.particles.shift();
    this.particles.push({ g: 0, ...p, age: 0 });
  }

  private sparkle(x: number, y: number) {
    this.emit({ kind: Math.random() < 0.5 ? 'plus' : 'star', x: x + (Math.random() - 0.5) * 18, y: y + (Math.random() - 0.5) * 8, vx: (Math.random() - 0.5) * 30, vy: -30 - Math.random() * 30, color: pick(['#ffffff', '#ffd35a', '#bfe6ff']), life: 0.55 });
  }

  private burst(x: number, y: number, color: string, n: number) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
      const speed = 90 + Math.random() * 90;
      this.emit({ kind: 'px', x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, g: 200, color, life: 0.35 + Math.random() * 0.2 });
    }
  }

  private dust(x: number, y: number, n: number) {
    for (let i = 0; i < n; i++) {
      const dir = i % 2 ? 1 : -1;
      this.emit({ kind: 'px', x: x + dir * (6 + Math.random() * 10), y: y - 2, vx: dir * (40 + Math.random() * 60), vy: -20 - Math.random() * 30, g: 60, color: pick(['#d9d4cc', '#b8b2a8', '#ffffff']), life: 0.45, size: 2 });
    }
  }

  private poof(x: number, y: number) {
    this.burst(x, y, '#ffffff', 8);
  }

  private say(text: string, ms: number, style: 'normal' | 'shout' | 'laugh' = 'normal') {
    const lines = wrap(text.toUpperCase(), 14);
    const w = Math.max(...lines.map(textWidth)) + 8;
    const h = lines.length * (GLYPH_H + 2) - 2 + 8;
    this.bubble = { text, until: performance.now() + ms, style, lines, w, h, drawnAt: 0 };
  }

  private drawBubble(now: number, flip: boolean) {
    const b = this.bubble!;
    const jitter = b.style !== 'normal';
    if (b.drawnAt && !(jitter && now - b.drawnAt > 90)) return;
    b.drawnAt = now;
    const tail = 4;
    const canvas = this.bubbleEl;
    if (canvas.width !== b.w || canvas.height !== b.h + tail) {
      canvas.width = b.w;
      canvas.height = b.h + tail;
      canvas.style.width = `${b.w * S}px`;
      canvas.style.height = `${(b.h + tail) * S}px`;
    }
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const ink = '#2a1a26';
    ctx.fillStyle = ink;
    ctx.fillRect(1, 0, b.w - 2, b.h);
    ctx.fillRect(0, 1, b.w, b.h - 2);
    ctx.fillStyle = b.style === 'shout' ? '#fff3f3' : '#ffffff';
    ctx.fillRect(1, 1, b.w - 2, b.h - 2);
    ctx.fillRect(2, 1, b.w - 4, 1);
    // The tail points down at the head.
    const tx = flip ? b.w - 7 : 4;
    for (let i = 0; i < tail; i++) {
      ctx.fillStyle = ink;
      ctx.fillRect(flip ? tx + i : tx - i + 2, b.h - 1 + i, 3 - Math.min(2, i) + 1, 1);
      ctx.fillStyle = b.style === 'shout' ? '#fff3f3' : '#ffffff';
      if (i < tail - 1) ctx.fillRect(flip ? tx + i + 1 : tx - i + 3, b.h - 1 + i, Math.max(0, 2 - i), 1);
    }
    ctx.fillStyle = b.style === 'shout' ? '#d62f3a' : ink;
    const seed = Math.floor(now / 90);
    b.lines.forEach((line, row) => {
      const x = Math.round((b.w - textWidth(line)) / 2);
      drawText(line, x, 4 + row * (GLYPH_H + 2), (px, py) => ctx.fillRect(px, py, 1, 1), jitter ? (i) => ((i * 7 + seed) % 3 === 0 ? -1 : 0) : undefined);
    });
  }

  private drawTag() {
    const role = this.tag!;
    const member = councilMember(role);
    if (!member) return;
    const text = member.name.toUpperCase();
    const w = textWidth(text) + 4;
    const h = GLYPH_H + 4;
    const canvas = this.tagEl;
    if (canvas.dataset.role === role) return;
    canvas.dataset.role = role;
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = `${w * S}px`;
    canvas.style.height = `${h * S}px`;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#2a1a26';
    drawText(text, 2, 2, (px, py) => { ctx.fillRect(px - 1, py, 3, 1); ctx.fillRect(px, py - 1, 1, 3); });
    ctx.fillStyle = member.color;
    drawText(text, 2, 2, (px, py) => ctx.fillRect(px, py, 1, 1));
  }

  private showGhosts(ghosts: Ghost[]) {
    return ghosts.map((ghost) => {
      const el = document.createElement('div');
      el.className = 'avatar-ghost';
      Object.assign(el.style, { left: `${ghost.x}px`, top: `${ghost.y}px`, width: `${ghost.w}px`, height: `${ghost.h}px`, background: ghost.color });
      this.layer.append(el);
      return el;
    });
  }

  private launchGhosts(job: Job) {
    const els = job.ghostEls ?? [];
    job.ghostEls = [];
    els.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      const dx = this.facing * (260 + Math.random() * 160) + i * 20;
      const dy = -(180 + Math.random() * 120);
      el.style.transform = `translate(${dx}px, ${dy}px) rotate(${this.facing * (400 + i * 90)}deg) scale(0.3)`;
      el.style.opacity = '0';
      this.later(() => {
        this.burst(r.left + r.width / 2 + dx, r.top + dy, '#ffffff', 8);
        this.emit({ kind: 'text', text: 'POOF', x: r.left + r.width / 2 + dx - 12, y: r.top + dy - 10, vx: 0, vy: -30, color: '#ffffff', life: 0.8 });
        el.remove();
      }, 620);
    });
    this.dust(this.pos.x, this.pos.y, 6);
  }

  private cutLine(x: number, y: number, h: number) {
    const el = document.createElement('div');
    el.className = 'avatar-cutline';
    Object.assign(el.style, { left: `${x - 1}px`, top: `${y - 6}px`, height: `${h + 12}px` });
    this.layer.append(el);
    this.later(() => el.remove(), 700);
  }

  private bump(clipId?: string) {
    const el = clipId ? clipEl(clipId) : null;
    if (!el || el.dataset.avatar === 'pending') return;
    el.dataset.avatar = 'bump';
    this.later(() => { if (el.dataset.avatar === 'bump') delete el.dataset.avatar; }, 400);
  }

  /** A pixel cursor knocked spinning out of the user's hand. */
  private flingCursor(p: Vec) {
    const el = document.createElement('canvas');
    el.className = 'avatar-cursor';
    el.width = CURSOR[0].length;
    el.height = CURSOR.length;
    Object.assign(el.style, { left: `${p.x}px`, top: `${p.y}px`, width: `${el.width * S}px`, height: `${el.height * S}px` });
    const ctx = el.getContext('2d')!;
    CURSOR.forEach((row, y) => [...row].forEach((c, x) => {
      if (c === '.') return;
      ctx.fillStyle = c === 'X' ? '#000000' : '#ffffff';
      ctx.fillRect(x, y, 1, 1);
    }));
    this.layer.append(el);
    requestAnimationFrame(() => {
      el.style.transform = `translate(${this.facing * 140}px, -90px) rotate(${this.facing * 540}deg)`;
      el.style.opacity = '0';
    });
    this.later(() => el.remove(), 700);
  }

  private updateParticles(dt: number) {
    if (!this.particles.length) return;
    for (const p of this.particles) {
      p.age += dt;
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.particles = this.particles.filter((p) => p.age < p.life);
  }

  // ── drawing ───────────────────────────────────────────────────────────────

  /** Writes a style only when it changed, so an idle avatar costs no style work at all. */
  private put(el: HTMLElement, prop: 'transform' | 'display' | 'opacity' | 'transformOrigin', value: string) {
    const seen = this.styled.get(el) ?? {};
    if (seen[prop] === value) return;
    seen[prop] = value;
    this.styled.set(el, seen);
    el.style[prop] = value;
  }

  private render(now: number) {
    const t = (now - this.animT0) / 1000;
    const key = `${this.anim}|${Math.floor(t * FPS)}|${JSON.stringify(this.opts)}`;
    if (key !== this.lastKey) {
      this.lastKey = key;
      paint(this.spriteCtx, poseAt(this.anim, t, { ...this.opts, character: this.character }));
    }
    const left = Math.round(this.pos.x - CX * S);
    const top = Math.round(this.pos.y - FEET_Y * S);
    const swing = this.mode === 'held' ? this.swing : null;
    const origin = swing ? this.gripLocal(swing) : COM_LOCAL;
    this.put(this.body, 'transformOrigin', `${origin.x.toFixed(1)}px ${origin.y.toFixed(1)}px`);
    let turn = `rotate(${this.angle.toFixed(1)}deg)`;
    if (swing) {
      // A yank stretches it along the grip, a push squashes it (a little: it is a body, not a rope).
      const stretch = clamp(swingStretch(swing), -0.15, 0.3) * 0.5;
      if (Math.abs(stretch) > 0.01) {
        const axis = ((Math.atan2(swing.arm.y, swing.arm.x) * 180) / Math.PI).toFixed(1);
        turn += ` rotate(${axis}deg) scale(${(1 + stretch).toFixed(3)}, ${(1 - stretch * 0.35).toFixed(3)}) rotate(${-Number(axis)}deg)`;
      }
    }
    this.put(this.body, 'transform', `translate3d(${left}px, ${top}px, 0) ${turn}`);
    // The golden hero's whirlwind: the sprite turns like a top (its width swings through zero and flips).
    let flip: number = this.facing;
    if (this.character === 'chakra' && SPIN.has(this.anim)) {
      const c = Math.cos(t * 16);
      flip *= Math.sign(c || 1) * Math.max(0.12, Math.abs(c));
    }
    this.put(this.sprite, 'transform', flip === 1 ? '' : flip === -1 ? 'scaleX(-1)' : `scaleX(${flip.toFixed(2)})`);
    // The shadow stays on the surface under a hop, and fades the higher it goes.
    const groundY = this.travel ? this.travel.from.y + (this.travel.to.y - this.travel.from.y) * clamp((now - this.travel.t0) / this.travel.dur, 0, 1) : this.pos.y;
    const lift = Math.max(0, groundY - this.pos.y);
    this.put(this.shadow, 'display', this.mode === 'free' && !this.sitting && this.anim !== 'research' && this.anim !== 'sleep' ? '' : 'none');
    this.put(this.shadow, 'transform', `translate3d(${Math.round(this.pos.x - 14 * S)}px, ${Math.round(groundY - 3 * S)}px, 0)`);
    this.put(this.shadow, 'opacity', String(clamp(0.45 - lift / 200, 0.1, 0.45)));

    if (this.tag && this.mode === 'free') {
      this.drawTag();
      this.put(this.tagEl, 'display', '');
      const w = this.tagEl.width * S;
      this.put(this.tagEl, 'transform', `translate3d(${Math.round(this.pos.x - w / 2)}px, ${Math.round(this.pos.y - (FEET_Y - this.top + 3) * S - this.tagEl.height * S)}px, 0)`);
    } else {
      this.put(this.tagEl, 'display', 'none');
      delete this.tagEl.dataset.role;
    }

    if (this.bubble && now > this.bubble.until) this.bubble = null;
    if (this.bubble) {
      const flip = this.pos.x + this.bubble.w * S + 30 > window.innerWidth;
      this.drawBubble(now, flip);
      this.put(this.bubbleEl, 'display', '');
      const bw = this.bubbleEl.width * S;
      const bh = this.bubbleEl.height * S;
      const headTop = this.pos.y - (FEET_Y - this.top - 2) * S - (this.tag ? 22 : 0);
      const x = flip ? this.pos.x - 10 - bw : this.pos.x + 10;
      this.put(this.bubbleEl, 'transform', `translate3d(${Math.round(clamp(x, 4, window.innerWidth - bw - 4))}px, ${Math.round(Math.max(4, headTop - bh))}px, 0)`);
    } else this.put(this.bubbleEl, 'display', 'none');

    const ctx = this.fxCtx;
    if (this.particles.length || this.projectiles.length || this.rope || this.fxDirty) {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      this.fxDirty = this.particles.length > 0 || this.projectiles.length > 0 || !!this.rope;
      // Webs and grapples hang from the hand; whatever a hero threw flies until it is over.
      if (this.rope) drawProjectile(ctx, { kind: this.rope.kind, from: this.handScreen('r', now), to: this.rope.anchor, t0: now, dur: 1000, facing: this.facing }, now, S);
      if (this.projectiles.length) this.projectiles = this.projectiles.filter((p) => drawProjectile(ctx, p, now, S));
      for (const p of this.particles) {
        // Pixel-game fade: blink out over the last third instead of going transparent.
        if (p.age > p.life * 0.66 && Math.floor(p.age * 20) % 2) continue;
        const x = Math.round(p.x / S) * S;
        const y = Math.round(p.y / S) * S;
        ctx.fillStyle = p.color;
        const dot = (dx: number, dy: number) => ctx.fillRect(x + dx * S, y + dy * S, S * (p.size ?? 1), S * (p.size ?? 1));
        if (p.kind === 'px') dot(0, 0);
        else if (p.kind === 'plus') { dot(0, 0); dot(1, 0); dot(-1, 0); dot(0, 1); dot(0, -1); }
        else if (p.kind === 'star') { dot(0, 0); dot(1, 0); dot(-1, 0); dot(0, 1); dot(0, -1); dot(2, 0); dot(-2, 0); dot(0, 2); dot(0, -2); }
        else if (p.kind === 'marks') {
          // Three emphasis strokes fanning out beside the head, like a comic "!".
          const d = p.dir ?? 1;
          const reach = Math.min(3, 1 + Math.floor(p.age * 14));
          for (const slope of [-1, 0, 1]) for (let i = 0; i < reach; i++) dot(d * (2 + i), slope * (2 + i) - (slope === 0 ? 0 : slope));
        } else if (p.kind === 'bulb') {
          // A lightbulb: an idea.
          const glass = ['.###.', '#####', '#####', '#####', '.###.', '.#=#.', '..=..'];
          glass.forEach((row, gy) => [...row].forEach((c, gx) => {
            if (c === '.') return;
            ctx.fillStyle = c === '=' ? '#8792a8' : gy === 1 && gx === 1 ? '#ffffff' : p.color;
            ctx.fillRect(x + (gx - 2) * S, y + (gy - 3) * S, S, S);
          }));
          if (Math.floor(p.age * 6) % 2 === 0) {
            ctx.fillStyle = '#ffe066';
            for (const [gx, gy] of [[-4, -3], [4, -3], [0, -6], [-4, 1], [4, 1]] as const) ctx.fillRect(x + gx * S, y + gy * S, S, S);
          }
        }
        else if (p.kind === 'text' && p.text) {
          const outline = '#2a1a26';
          ctx.fillStyle = outline;
          drawText(p.text, 0, 0, (px, py) => ctx.fillRect(x + (px - 1) * S, y + (py - 1) * S, 3 * S, 3 * S));
          ctx.fillStyle = p.color;
          drawText(p.text, 0, 0, (px, py) => ctx.fillRect(x + px * S, y + py * S, S, S));
        }
      }
    }
  }
}
