import { GenerationPlanCard } from './GenerationPlanCard';
import type { GenPlan } from '../lib/cloudGen';
import type { Asset } from '../lib/types';
import { modelVariants, variantModel } from '../lib/modelVariants';
import { rememberTurnPrompt } from '../lib/turnPrompts';
import { speedIndex, speedSteps } from '../lib/modelTiers';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { ArrowUp, Brain, Check, ChevronRight, CircleHelp, CircleStop, Copy, Laugh, MapPin, Paperclip, Pencil, Play, RotateCcw, SendHorizontal, X } from 'lucide-react';
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { FaultCard } from '../components/FaultCard';
import { ModelPicker } from '../components/ModelPicker';
import { useToast } from '../components/ui';
import { permissionBrief, type Effort, type PermissionMode } from '../lib/permissions';
import { PermissionMenu, ThinkingSlider } from './ComposerControls';
import { ChatStatusBar, type AgentRun, type Connection } from './ChatStatusBar';
import { UsageMeter } from './UsageMeter';
import * as usage from '../lib/usage';
import { type Interjection, type Step, type TextSegment, type ToolRun } from './Activity';
import { steer } from './steer';
import { AnswerBody } from './AnswerBody';
import { appendText, settleText } from './segments';
import { CommandPanel, panelOrder } from './CommandPanel';
import { COMMANDS, matchCommands, type CommandContext } from './commands';
import { handoffFor, historyFor, seesImages } from './handoff';
import { annotationBrief, annotationLabel, annotations, sentAnnotation, usePendingAnnotations, type SentAnnotation } from '../lib/annotations';
import { copyText } from '../lib/clipboard';
import { uid } from '../lib/editor';
import { api, errorText, events, type ReferenceFilm } from '../lib/ipc';
import { findStyle, styleInMessage, stylesMatching, type StyleDef, type StyleId } from '../lib/styles';
import { actionLogger } from '../lib/actionLogger';
import { avatarBus } from '../avatar/bus';
import type { TurnOutcome } from '../lib/ideagraph';
import type { ProviderInfo, TurnFault, Usage } from '../lib/types';

export type { ToolRun } from './Activity';

export type ChatMessage =
  | { id: string; role: 'user'; content: string; at: number; images?: string[]; /** Monitor annotations sent with it: shown as chips, and their brief kept for later turns. */ annotations?: SentAnnotation[]; annotationBrief?: string }
  | {
      id: string;
      role: 'assistant';
      turnId: string;
      providerId: string;
      providerLabel: string;
      model: string | null;
      content: string;
      /**
       * The same words, split wherever work happened between them, so they can be shown in
       * order with that work. Absent on turns saved before this existed.
       */
      segments?: TextSegment[];
      /** What the user sent while this turn worked, and whether it has reached the model yet. */
      steers?: Interjection[];
      thinking: string;
      steps: Step[];
      status: 'streaming' | 'done' | 'stopped' | 'error';
      notes: string[];
      fault: TurnFault | null;
      usage: Usage | null;
      elapsedMs: number | null;
      /**
       * Where the account stood when this turn ran, exactly as the provider reported it. The
       * whole reading is kept, not just the worst number, because the chat log is what seeds the
       * meter after a restart — a stripped copy would leave it saying it knows nothing while the
       * answer was sitting in the transcript.
       */
      limit: {
        status: string;
        used: number;
        sessionUsed: number | null;
        sessionResetsAt: number | null;
        weeklyUsed: number | null;
        weeklyResetsAt: number | null;
      } | null;
    };

type Assistant = Extract<ChatMessage, { role: 'assistant' }>;

/** One row of the `@` list: an edit style, or a reference film. */
type MentionHit = { kind: 'style'; style: StyleDef } | { kind: 'reference'; ref: ReferenceFilm };

/**
 * The hidden note a retry sends with the prompt again. A turn that got somewhere is continued, not
 * restarted: the transcript already holds every completed edit, so resending the bare prompt
 * redoes the whole pipeline and stalls in the same place — the note points at the first
 * unfinished step. A turn that never got going (Bhippi could not prepare it, or it was refused
 * before a word) is simply sent again; telling the model work was done would have it skip parts
 * of a request it never started.
 */
export function retryNote(message: Pick<Assistant, 'content' | 'steps'>, runs: readonly ToolRun[], status: WorkflowPhaseStatus = null): string | undefined {
  const progressed = runs.length > 0 || message.steps.length > 0 || message.content.trim().length > 0;
  if (!progressed) return undefined;
  // A plan or gather turn ends at the user's button, not at verify: continue just that phase.
  if (endsAtButton(status)) return `[Continuing after an interruption — do not redo completed work. ${continuePrompt(status)}]`;
  return '[Continuing after an interruption — do not redo completed edits. First read the current timeline with get_comp, identify the first unfinished step of the request, continue from there in 5–12s batches, and finish with verify_edit_workflow.]';
}

type WorkflowPhaseStatus = { phase?: string | null; gather?: { ready: number; total: number; pending: string[] } | null } | null;

/** Plan and gather turns end when their phase closes; the user's button (Start generating, Start editing) moves on. */
const endsAtButton = (status: WorkflowPhaseStatus) => ['plan', 'planning', 'plan-ready', 'gathering', 'gathered'].includes(status?.phase ?? '');

/**
 * The standing instruction each turn carries. Telling a plan or gather turn not to stop before
 * verify_edit_workflow sent it past the user's button into timeline edits the guard refuses, so
 * those phases are told to finish their own work and end the turn.
 */
export function workflowInstruction(status: WorkflowPhaseStatus): string {
  if (!endsAtButton(status)) return 'Call editing_workflow_status first. In full mode, do NOT stop after analysis — execute all cuts, motion graphics, b-roll and sound design, then call verify_edit_workflow before ending your turn.';
  const phase = status?.phase;
  const next = phase === 'gathering' || phase === 'gathered' ? 'Start editing' : 'Start generating';
  return `Call editing_workflow_status first. The production is in the ${phase} phase: finish this phase and end your turn — the user presses ${next} to move on. Do not edit the timeline in this turn.`;
}

export type ChatApi = { clear: () => void; focus: () => void; /** `mode` runs this one turn in that editing workflow instead of the composer's. */ send: (text: string, options?: { mode?: 'full' | 'quick' }) => void; /** Replaces the transcript (opening a .bhippi that carries one). */ load: (messages: unknown[]) => void };

type Props = {
  apiRef: RefObject<ChatApi | null>;
  providers: ProviderInfo[];
  providerId: string | null;
  model: string | null;
  onChooseModel: (providerId: string, model: string | null) => void;
  /** How hard the model should think, for the providers that take a level. */
  effort: Effort;
  onEffort: (effort: Effort) => void;
  /** The animated look: nothing but surface, so the chat can be plain when that is wanted. */
  awesome: boolean;
  onAwesome: (on: boolean) => void;
  /** Undo the last edit, for `/undo`. */
  onUndo: () => void;
  /** The user started a new conversation (/clear, New Conversation): the host drops per-conversation project state such as the production pipeline. Not fired for a compaction, which continues the same work. */
  onClear?: () => void;
  /** The reference edits should follow from here on, or null to stop following one. */
  onReference: (id: string | null) => void;
  /** The edit style every turn works in until it is cleared (`@funny`, src/lib/styles.ts), and the setter. */
  editStyle: StyleId | null;
  onStyle: (id: StyleId | null) => void;
  /** A question the assistant is waiting on, and the answer going back to it. */
  ask: { question: string; options: string[]; context: string | null } | null;
  /** The cloud generation plan the AI is waiting on, with the project's media for thumbnails. */
  genPlan?: { plan: GenPlan; assets: Map<string, Asset> } | null;
  onGenPlan?: (plan: GenPlan | null) => void;
  /** How many are waiting, so the card can say which one this is. */
  askCount: number;
  onAnswer: (answer: string) => void;
  /** What this chat can reach, and the agents it has started. */
  connections: Connection[];
  agents: AgentRun[];
  onStopAgent: (id: string) => void;
  onManageConnections: () => void;
  /** What the assistant may change without asking. */
  permission: PermissionMode;
  onPermission: (mode: PermissionMode) => void;
  onManageProviders: () => void;
  /** The project summary sent with each turn (src/lib/aiTools.ts `aiContext`). */
  getContext: () => unknown;
  onStartWorkflow: (turnId: string, mode: 'full' | 'quick') => void;
  workflowStatus: (turnId: string) => {
    mode: string; structurallyVerified: boolean; phase?: string | null;
    gather?: { ready: number; total: number; pending: string[] } | null;
  } | null;
  /** Tool calls the editor ran, by turn. */
  tools: Record<string, ToolRun[]>;
  /** Fires once per finished turn so the host can record the outcome (IdeaGraph brain). */
  onTurnDone?: (outcome: TurnOutcome) => void;
  /** Puts the project back to where it was before a turn's edits; false when it has moved on. */
  onRevert: (turnId: string) => boolean;
  canRevert: (turnId: string) => boolean;
  /** The production phase dock, docked low right above the composer rather than the transcript. */
  productionBar?: ReactNode;
  /**
   * A chat with its own conversation — the Plugin Maker's. `logScope` keeps its transcript apart
   * from the main chat's, `persona` leads the system prompt of every turn, `lockedMode` fixes the
   * editing workflow (and hides its picker), and `instruction` replaces the workflow's standing
   * instruction.
   */
  logScope?: string;
  persona?: string;
  lockedMode?: 'full' | 'quick';
  instruction?: string;
  placeholder?: string;
  label?: string;
  /** This chat takes the Program monitor's annotations (the main chat, not the Plugin Maker's). */
  annotations?: boolean;
};


/** A light running round the composer's outline while a turn is being written.
 *
 * Drawn as an SVG outline rather than a gradient behind a border-shaped mask: a gradient has to
 * rotate about the centre, so on a box this wide the bright part crosses it as a diagonal bar
 * instead of following the edge. A dash running along the outline is the thing itself.
 * `pathLength` renormalises the perimeter to 100, so the dash lengths in the stylesheet are
 * percentages of it and the streak holds its shape at any panel width. */
function ComposerStreak() {
  return (
    <svg className="composer-streak" aria-hidden="true">
      <rect className="rail" x="0.5" y="0.5" width="calc(100% - 1px)" height="calc(100% - 1px)" rx="6" ry="6" pathLength="100" />
      <rect className="tail" x="0.5" y="0.5" width="calc(100% - 1px)" height="calc(100% - 1px)" rx="6" ry="6" pathLength="100" />
      <rect className="head" x="0.5" y="0.5" width="calc(100% - 1px)" height="calc(100% - 1px)" rx="6" ry="6" pathLength="100" />
    </svg>
  );
}

/** One sent message taking off from the composer and landing in the transcript.
 *
 * `pad` is the composer's top edge off the bottom of the panel and `rise` the climb from there;
 * ChatPanel measures both against the live layout, so the rocket leaves the real chat bar and
 * lands in the real transcript however the panel has been dragged. Everything else — the flash,
 * the shock, the fire, the smoke, the flight — is in the stylesheet under `.launch`; this only
 * lays out the pieces and hands each one its angle, reach and delay. */
function Launch({ text, pad, rise, drift }: { text: string; pad: number; rise: number; drift: number }) {
  const vars = { '--pad': `${pad}px`, '--rise': `${rise}px`, '--drift': `${drift}px` } as CSSProperties;
  return (
    <div className="launch" style={vars} aria-hidden="true">
      <span className="launch-flash" />
      <span className="launch-shock" />
      {/* Smoke stays behind after the craft has gone, which is what makes it read as a launch. */}
      {Array.from({ length: 12 }).map((_, index) => (
        <span
          key={index}
          className={`launch-puff p-${index % 3}`}
          style={{
            '--x': `${18 + (index / 11) * 64}%`,
            '--dx': `${(index % 5) * 13 - 26}px`,
            animationDelay: `${index * 26}ms`,
          } as CSSProperties}
        />
      ))}
      {/* Fire: thrown out of the pad, mostly downward and sideways, never straight through it. */}
      {Array.from({ length: 22 }).map((_, index) => (
        <span
          key={index}
          className={`launch-spark k-${index % 5}`}
          style={{
            '--a': `${10 + (index / 21) * 160 + (index % 3) * 5}deg`,
            '--r': `${38 + (index % 5) * 16}px`,
            '--d': `${(index % 6) * 22}ms`,
          } as CSSProperties}
        />
      ))}
      <div className="launch-craft">
        <span className="craft-body">
          <span className="craft-text">{text}</span>
          <span className="craft-flame" />
        </span>
      </div>
      <span className="launch-impact" />
    </div>
  );
}

export function ChatPanel(props: Props) {
  const toast = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [images,setImages]=useState<string[]>([]);
  const imageInput=useRef<HTMLInputElement>(null);
  const imagesRef=useRef(images);imagesRef.current=images;
  async function addImages(files: File[]) {
    try {
      if(files.length+imagesRef.current.length>4)throw new Error('Attach at most four images.');
      const urls=await Promise.all(files.map(file=>new Promise<string>((resolve,reject)=>{
        if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>4*1024*1024)return reject(new Error('Use PNG, JPEG, or WebP files up to 4 MB.'));
        const reader=new FileReader();reader.onerror=()=>reject(new Error('Could not read '+file.name));reader.onload=()=>resolve(String(reader.result));reader.readAsDataURL(file);
      })));
      setImages(current=>[...current,...urls].slice(0,4));
    }catch(error){toast({tone:'error',title:'Image attachment',body:errorText(error)});}
  }
  useEffect(()=>{
    const pending=getCurrentWebview().onDragDropEvent(event=>{
      if(event.payload.type!=='drop')return;
      const ratio=window.devicePixelRatio||1,point=event.payload.position;
      const box=rootRef.current?.getBoundingClientRect();
      if(!box||point.x/ratio<box.left||point.x/ratio>box.right||point.y/ratio<box.top||point.y/ratio>box.bottom)return;
      // Another chat (the Plugin Maker's) may be drawn over this one; the drop is for the one on top.
      const hit=document.elementFromPoint(point.x/ratio,point.y/ratio);
      if(hit&&!rootRef.current?.contains(hit))return;
      if(event.payload.paths.length+imagesRef.current.length>4){toast({tone:'error',title:'Too many images',body:'Attach at most four images.'});return;}
      void api.chatReadImages(event.payload.paths).then(urls=>setImages(current=>[...current,...urls].slice(0,4))).catch(error=>toast({tone:'error',title:'Image attachment',body:errorText(error)}));
    });return()=>{void pending.then(off=>off()).catch(()=>undefined);};
  },[]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [levels, setLevels] = useState<Effort[]>([]);
  const [references, setReferences] = useState<ReferenceFilm[]>([]);
  const [attached, setAttached] = useState<ReferenceFilm | null>(null);
  // Which command row the keyboard is on, and whether Escape has closed the panel for this draft.
  const [commandRow, setCommandRow] = useState(0);
  const [commandsHidden, setCommandsHidden] = useState(false);
  /** One sent message taking off: what it said, and the two distances the flight needs. */
  const [launch, setLaunch] = useState<{ id: number; text: string; pad: number; rise: number; drift: number } | null>(null);
  /** Typed while a turn was still streaming: it goes as soon as the turn ends. */
  const [queued, setQueued] = useState<string | null>(null);
  const [askDraft, setAskDraft] = useState('');
  const [loaded, setLoaded] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  /** Replaces the transcript with one a .bhippi file carried, and makes it the saved chat log. */
  const loadTranscript = (saved: unknown[]) => {
    const valid = (saved as ChatMessage[]).filter((item) => item && (item.role === 'user' || item.role === 'assistant'));
    setMessages(valid.map((item) => (item.role === 'assistant' && item.status === 'streaming' ? { ...item, status: 'stopped' } : item)));
    void api.chatLogSave(valid, props.logScope).catch(() => undefined);
  };
  useImperativeHandle(props.apiRef, () => ({
    clear: () => {
      setMessages([]);
      setDraft('');
      setImages([]);
      setQueued(null);
      setAttached(null);
      if (props.annotations) annotations.reset();
      void api.chatLogSave([], props.logScope).catch(() => undefined);
    },
    focus: () => {
      inputRef.current?.focus();
    },
    send: (text: string) => {
      sendRef.current(text);
    },
    load: (saved: unknown[]) => loadTranscript(saved),
  }), []);
  /** Whether the transcript is following the newest words, set by the reader's own scrolling. */
  const pinned = useRef(true);
  const propsRef = useRef(props);
  propsRef.current = props;
  const levelsRef = useRef<Effort[]>([]);
  /** Turn ids the backend did not list last time it was asked; see the watchdog below. */
  const missing = useRef<Set<string>>(new Set());
  /** Per-turn facts for the IdeaGraph outcome hook: set on send/start, consumed on done. */
  const turnMeta = useRef(new Map<string, { provider: string; model: string | null; prompt: string }>());

  const streaming = messages.some((message) => message.role === 'assistant' && message.status === 'streaming');
  const sendRef = useRef<(text: string, mode?: 'full' | 'quick') => void>(() => undefined);
  const [workflowMode, setWorkflowMode] = useState<'full' | 'quick'>('full');
  const active = props.providers.find((provider) => provider.id === props.providerId);
  /** The chosen model's sizes (Flash-Lite · Flash · Pro…), for the speed rail. */
  const speeds = speedSteps(active?.models ?? [], props.model);

  // Filed references, including the ones that ship with Bhippi. Re-read whenever the composer is
  // about to offer them, so a renamed or deleted reference is never still on the menu.
  const loadReferences = useCallback(() => {
    void api.refsList().then(setReferences).catch(() => undefined);
  }, []);
  useEffect(() => loadReferences(), [loadReferences]);

  // The steps come from the backend's own table, so the control cannot offer a level that would
  // not reach the model (src-tauri `effort_levels`, crates/bhippi-providers/src/effort.rs).
  useEffect(() => {
    if (!props.providerId) {
      levelsRef.current = [];
      return setLevels([]);
    }
    const variants = modelVariants(active?.models || [], props.model);
    if (variants.length) { const list=variants.map(v=>v.effort);setLevels(list);levelsRef.current=list;return; }
    setLevels([]);levelsRef.current=[];
    let alive = true;
    void api.effortLevels(props.providerId, props.model)
      .then((list) => {
        if (!alive) return;
        setLevels(list as Effort[]);
        levelsRef.current = list as Effort[];
      })
      .catch(() => {
        if (!alive) return;
        setLevels([]);
        levelsRef.current = [];
      });
    return () => {
      alive = false;
    };
  }, [props.providerId, props.model, active?.models]);

  useEffect(() => {
    api.chatLogLoad(props.logScope)
      .then((saved) => {
        const valid = (saved as ChatMessage[]).filter((item) => item && (item.role === 'user' || item.role === 'assistant'));
        setMessages(valid.map((item) => (item.role === 'assistant' && item.status === 'streaming' ? { ...item, status: 'stopped' } : item)));
        // What each provider last said about its plan is in this transcript; without replaying it
        // the meter would claim to know nothing while the number sits a few lines above it.
        for (const item of valid) {
          if (item.role !== 'assistant' || !item.limit) continue;
          usage.record(item.providerId, item.model, {
            status: item.limit.status,
            sessionUsed: item.limit.sessionUsed ?? null,
            sessionResetsAt: item.limit.sessionResetsAt ?? null,
            weeklyUsed: item.limit.weeklyUsed ?? null,
            weeklyResetsAt: item.limit.weeklyResetsAt ?? null,
            // Older entries kept only the worst figure, without saying which window it was.
            planUsed: item.limit.used,
          });
        }
      })
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (!loaded || streaming) return;
    const handle = window.setTimeout(() => void api.chatLogSave(messages, propsRef.current.logScope).catch(() => undefined), 300);
    return () => window.clearTimeout(handle);
  }, [messages, loaded, streaming]);

  // Following the newest words takes two things. New content is one: that is the effect below.
  // The other is the transcript losing height under a turn that is still writing — the composer
  // grows as a draft wraps, and the stream bar and the queued note appear and go. Each takes
  // room from the list without a message changing, which is how the last line ends up half cut
  // off with no way to reach it. A ResizeObserver on the list catches every one of them.
  useEffect(() => {
    const node = listRef.current;
    if (!node) return;
    const follow = () => {
      if (pinned.current) node.scrollTop = node.scrollHeight;
    };
    // Scrolling away stops it following; coming back within a line or two starts it again.
    const onScroll = () => {
      pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < 120;
    };
    node.addEventListener('scroll', onScroll, { passive: true });
    const observer = new ResizeObserver(follow);
    observer.observe(node);
    const content = new MutationObserver(follow);
    content.observe(node, { childList: true, subtree: true, characterData: true });
    node.addEventListener('load', follow, true);
    follow();
    return () => {
      node.removeEventListener('scroll', onScroll);
      observer.disconnect();
      content.disconnect();
      node.removeEventListener('load', follow, true);
    };
  }, []);

  useEffect(() => {
    const node = listRef.current;
    if (!node || !pinned.current) return;
    // A frame later, so markdown that reflows after it mounts is measured at its real height.
    const frame = requestAnimationFrame(() => {
      node.scrollTop = node.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [messages, props.tools]);

  const patch = useCallback((turnId: string, change: (message: Assistant) => Assistant) => {
    setMessages((items) => items.map((item) => (item.role === 'assistant' && item.turnId === turnId ? change(item) : item)));
  }, []);

  /**
   * A turn that ended before reading what the user sent it: those messages go as the next one, in
   * the order they were written, and the notes in the old turn say so.
   */
  const flushSteers = useCallback((turnId: string) => {
    const left = steer.take(turnId);
    if (!left.length) return;
    const ids = new Set(left.map((item) => item.id));
    patch(turnId, (message) => ({ ...message, steers: (message.steers ?? []).map((item) => (ids.has(item.id) ? { ...item, state: 'next' } : item)) }));
    setQueued((current) => [current, ...left.map((item) => item.text)].filter(Boolean).join('\n\n'));
  }, [patch]);

  // A message reached the running turn with a tool result (App.tsx): it now sits where it was read.
  useEffect(() => steer.onDelivered((turnId, ids) => {
    const now = Date.now();
    patch(turnId, (message) => ({ ...message, steers: (message.steers ?? []).map((item) => (ids.includes(item.id) ? { ...item, state: 'delivered', at: now } : item)) }));
  }), [patch]);

  const dropSteer = (turnId: string, id: string) => {
    steer.drop(turnId, id);
    patch(turnId, (message) => ({ ...message, steers: (message.steers ?? []).filter((item) => item.id !== id) }));
  };

  /**
   * Closes a turn the backend is no longer running.
   *
   * A turn leaves the writing state only when its closing event arrives, and that event is the
   * one thing that frees the composer. When the task behind it is gone — it panicked, the window
   * reloaded under it, the event was dropped — no such event is ever coming, and the chat waits
   * for a turn that does not exist: messages queue instead of sending, and picking another model
   * changes the label but nothing else. So the backend is asked which turns it still has, and the
   * rest are closed here. Two misses in a row are needed before acting, because a turn just sent
   * is not registered until `chat_send` returns.
   */
  useEffect(() => {
    if (!streaming) {
      missing.current.clear();
      return;
    }
    const handle = window.setInterval(() => {
      void api.chatActiveTurns()
        .then((live) => {
          const alive = new Set(live);
          setMessages((items) => {
            const absent = items.filter(
              (item): item is Assistant => item.role === 'assistant' && item.status === 'streaming' && !alive.has(item.turnId),
            );
            const lost = new Set(absent.filter((item) => missing.current.has(item.turnId)).map((item) => item.turnId));
            missing.current = new Set(absent.map((item) => item.turnId));
            if (lost.size === 0) return items;
            // The avatar stops with the transcript (telling it twice is harmless).
            for (const turnId of lost) {
              avatarBus.turn(turnId, false, 'failed');
              flushSteers(turnId);
            }
            return items.map((item) =>
              item.role === 'assistant' && lost.has(item.turnId)
                ? {
                    ...item,
                    status: 'error',
                    steps: item.steps.map((step) => ({ ...step, done: true })),
                    fault: {
                      kind: 'unknown',
                      title: 'That answer stopped coming',
                      summary: `${item.providerLabel} ended without finishing, and nothing more is on its way.`,
                      fix: 'Ask again, or pick another provider — everything said so far is handed over to it.',
                      remedy: 'retry',
                      actionLabel: 'Ask again',
                      resetsAt: null,
                      provider: item.providerLabel,
                      providerId: item.providerId,
                      detail: '',
                    },
                  }
                : item,
            );
          });
        })
        .catch(() => undefined);
    }, 4000);
    return () => window.clearInterval(handle);
  }, [streaming]);

  useEffect(() => {
    const pending = events.chat((event) => {
      if (event.event === 'start') {
        actionLogger.ai(`Chat Turn Started: ${event.providerLabel} (${event.model ?? 'default'})`, { turnId: event.turnId });
        patch(event.turnId, (message) => ({ ...message, providerId: event.providerId, providerLabel: event.providerLabel, model: event.model }));
        const meta = turnMeta.current.get(event.turnId);
        turnMeta.current.set(event.turnId, { provider: event.providerLabel, model: event.model, prompt: meta?.prompt ?? '' });
      } else if (event.event === 'delta') {
        const delta = event.delta;
        patch(event.turnId, (message) => {
          // A turn the user stopped, or one the watchdog closed, stays closed: a chunk that was
          // already in flight must not put it back to writing and lock the composer again.
          if (message.status !== 'streaming') return message;
          switch (delta.kind) {
            case 'text':
              return { ...message, ...appendText(message, delta.delta, propsRef.current.tools[message.turnId] ?? [], Date.now()) };
            case 'thinking':
              return { ...message, thinking: message.thinking + delta.delta };
            case 'step': {
              const existing = message.steps.find((step) => step.id === delta.id);
              const steps = existing
                ? message.steps.map((step) => (step.id === delta.id ? { ...step, done: step.done || delta.done, title: delta.title || step.title, detail: delta.detail || step.detail } : step))
                : [...message.steps, { id: delta.id, verb: delta.verb, title: delta.title, detail: delta.detail, done: delta.done, at: Date.now() }];
              return { ...message, steps };
            }
            case 'limit': {
              const used = Math.max(delta.sessionUsed ?? 0, delta.weeklyUsed ?? 0);
              // The meter in the bar keeps the full reading, per provider, across restarts.
              usage.record(message.providerId, message.model, delta);
              return {
                ...message,
                limit: {
                  status: delta.status,
                  used,
                  sessionUsed: delta.sessionUsed,
                  sessionResetsAt: delta.sessionResetsAt,
                  weeklyUsed: delta.weeklyUsed,
                  weeklyResetsAt: delta.weeklyResetsAt,
                },
              };
            }
            default:
              return message;
          }
        });
      } else if (event.event === 'subagent_update') {
        // Subagent progress is displayed in the status bar agents chip and map.
      } else if (event.event === 'done') {
        if (event.fault) {
          actionLogger.error(`Chat Turn Error [${event.turnId}]: ${event.fault.title} — ${event.fault.summary}`, event.fault);
        } else if (event.stopped) {
          actionLogger.ai(`Chat Turn Stopped [${event.turnId}]`);
        } else {
          actionLogger.ai(`Chat Turn Completed [${event.turnId}] in ${event.elapsedMs ?? 0}ms`, { usage: event.usage });
        }
        // A turn refused for a limit is the clearest signal there is: that provider is out until
        // whatever time it named. The meter goes red on it rather than waiting for the next turn.
        if (event.fault?.kind.startsWith('rate_limited')) {
          patch(event.turnId, (message) => {
            usage.recordExhausted(message.providerId, message.model, event.fault?.resetsAt ?? null);
            return message;
          });
        } else if (!event.fault && !event.stopped) {
          // A turn that answered proves the provider is not out, whatever an earlier refusal said.
          patch(event.turnId, (message) => {
            usage.recordSuccess(message.providerId);
            return message;
          });
        }
        patch(event.turnId, (message) => {
          if (event.usage) usage.recordTokens(message.providerId, message.model, event.usage.inputTokens, event.usage.outputTokens);
          return {
            ...message,
            ...settleText(message, event.reply),
            status: event.stopped ? 'stopped' : event.fault ? 'error' : 'done',
            // The workflow's own state is shown under the answer (AssistantMessage); repeating it here printed it twice.
            notes: event.notes,
            fault: event.fault,
            usage: event.usage,
            elapsedMs: event.elapsedMs,
            steps: message.steps.map((step) => ({ ...step, done: true })),
          };
        });
        // Whatever the user sent that the turn never read (it made no more tool calls) goes next.
        flushSteers(event.turnId);
        // One outcome per finished turn for the IdeaGraph brain; failures to record never disturb chat.
        const meta = turnMeta.current.get(event.turnId);
        turnMeta.current.delete(event.turnId);
        if (meta) {
          const runs = propsRef.current.tools[event.turnId] ?? [];
          propsRef.current.onTurnDone?.({
            provider: meta.provider,
            model: meta.model,
            prompt: meta.prompt,
            elapsedMs: event.elapsedMs,
            stopped: event.stopped,
            faultKind: event.fault?.kind ?? null,
            verified: propsRef.current.workflowStatus(event.turnId)?.structurallyVerified ?? null,
            tools: runs.map((run) => ({ name: run.name, status: run.status, ms: run.ms, changedProject: run.changedProject ?? false })),
          });
        }
      }
    });
    return () => {
      void pending.then((unlisten) => unlisten());
    };
  }, [patch]);

  /**
   * Measures the flight and starts it. The overlay takes itself back out when it lands.
   *
   * The craft lands on the message it *is* — so the climb is measured to where that message
   * actually ends up, not to a fixed height. A short prompt sent into a full transcript lands a
   * few dozen pixels up; the first message of a conversation flies most of the panel. The drift
   * is the same idea sideways: a user message sits right-aligned, so the flight curves over to it
   * rather than going straight up and then jumping.
   */
  const liftOff = (text: string) => {
    const message = text.trim();
    // Mid-turn, the message goes into the running answer, not up to a bubble of its own.
    if (!message || !propsRef.current.awesome || streaming) return;
    const root = rootRef.current;
    const form = formRef.current;
    const pad = form ? form.offsetHeight + 16 : 104;
    const start = { id: Date.now(), text: message.length > 46 ? `${message.slice(0, 45)}…` : message, pad, rise: 0, drift: 0 };

    // The message is not in the DOM until React has committed it, so the target is measured on
    // the next frame and the flight begins then.
    requestAnimationFrame(() => {
      const list = listRef.current;
      const bubbles = list?.querySelectorAll<HTMLElement>('.msg-user');
      const bubble = bubbles?.[bubbles.length - 1];
      const rootBox = root?.getBoundingClientRect();
      let rise = root ? Math.max(90, root.clientHeight - pad - 76) : 220;
      let drift = 0;
      if (bubble && rootBox) {
        const target = bubble.getBoundingClientRect();
        // From the top of the composer to the middle of the bubble, and across to its centre.
        rise = Math.max(56, rootBox.bottom - pad - (target.top + target.height / 2));
        drift = target.left + target.width / 2 - (rootBox.left + rootBox.width / 2);
      }
      setLaunch({ ...start, rise, drift });
    });
  };

  // The flight is 1.42s; this clears the overlay once it is over, so nothing animates at rest.
  useEffect(() => {
    if (!launch) return;
    const handle = window.setTimeout(() => setLaunch(null), 1600);
    return () => window.clearTimeout(handle);
  }, [launch]);

  const send = async (text: string, hiddenExtra?: string, modeOverride?: 'full' | 'quick') => {
    const mode = propsRef.current.lockedMode ?? modeOverride ?? workflowMode;
    const attachedImages=[...imagesRef.current];
    // Annotations from the Program monitor go with the next message that starts a turn; mid-turn
    // they wait, since a steer is words only.
    const notes = propsRef.current.annotations && !streaming ? annotations.list() : [];
    const message = text.trim() || (attachedImages.length ? 'Please inspect the attached images.' : notes.length ? (notes.length === 1 ? 'Please apply my annotation.' : `Please apply my ${notes.length} annotations.`) : '');
    if (!message) {
      if (streaming && propsRef.current.annotations && annotations.list().length) toast({ tone: 'info', title: 'Annotations are waiting', body: 'They go with your next message once this response finishes.' });
      return;
    }
    const taken = notes.length ? annotations.take() : [];
    const brief = annotationBrief(taken);
    // Each annotation's frame, outlined, for models that can see — after the user's own images.
    const snapshots = seesImages(propsRef.current.providerId) ? taken.flatMap((item) => (item.snapshot ? [item.snapshot] : [])) : [];
    const sentImages = [...attachedImages, ...snapshots].slice(0, 4);
    if (streaming) {
      if(sentImages.length){toast({tone:'info',title:'Images ready',body:'Send these images after the current response finishes.'});return;}
      // The Claude app's behaviour: a message typed while it works goes into the running turn and
      // the model folds it into what it is doing (src/chat/steer.ts), rather than waiting for the end.
      const running = [...messages].reverse().find((item): item is Assistant => item.role === 'assistant' && item.status === 'streaming');
      if (running) {
        const id = uid();
        steer.push(running.turnId, { id, text: message });
        patch(running.turnId, (item) => ({ ...item, steers: [...(item.steers ?? []), { id, text: message, at: Date.now(), state: 'waiting' }] }));
        actionLogger.user(`Chat Steer: "${message.length > 80 ? message.slice(0, 77) + '...' : message}"`, { turnId: running.turnId });
      } else {
        setQueued((current) => [current, message].filter(Boolean).join('\n\n'));
      }
      pinned.current = true;
      setDraft('');
      return;
    }
    const { providerId, getContext } = propsRef.current;
    // "@funny" typed into a message switches the style on. The host's context is a render behind
    // the state change, so this send carries the style itself.
    const tagged = styleInMessage(message);
    if (tagged && tagged.id !== propsRef.current.editStyle) propsRef.current.onStyle(tagged.id);
    const providerModels=propsRef.current.providers.find(p=>p.id===providerId)?.models||[];
    const model=variantModel(providerModels,propsRef.current.model,propsRef.current.effort);
    const turnId = uid();
    rememberTurnPrompt(turnId, message);
    propsRef.current.onStartWorkflow(turnId, mode);
    const history = historyFor(messages, providerId, model);
    // Who the new model is relieving, read straight off the transcript — so a cleared chat has
    // nobody to hand over from and starts clean.
    const handoff = handoffFor(messages, providerId, model);
    const provider = propsRef.current.providers.find((item) => item.id === providerId);
    turnMeta.current.set(turnId, { provider: provider?.label ?? 'Bhippi', model, prompt: message });
    const extra = [hiddenExtra, brief].filter(Boolean).join('\n\n');
    const assistant: Assistant = {
      id: uid(), role: 'assistant', turnId, providerId: providerId ?? 'bhippi', providerLabel: provider?.label ?? 'Bhippi', model,
      content: '', thinking: '', steps: [], status: 'streaming', notes: [], fault: null, usage: null, elapsedMs: null, limit: null,
    };
    pinned.current = true;
    setMessages((items) => [...items, { id: uid(), role: 'user', content: message, at: Date.now(), images: sentImages, ...(taken.length ? { annotations: taken.map(sentAnnotation), annotationBrief: brief } : {}) }, assistant]);
    setDraft('');
    actionLogger.user(`Chat Prompt: "${message.length > 80 ? message.slice(0, 77) + '...' : message}"`, { turnId, provider: provider?.label ?? 'Bhippi', model, images: sentImages.length });
    try {
      // The backend clamps or drops a level the model does not honour, so sending the chosen one
      // is safe; an empty list means this provider has no such setting at all.
      const level = !modelVariants(providerModels,model).length && levelsRef.current.includes(propsRef.current.effort) ? propsRef.current.effort : null;
      await api.chatSend({ turnId, providerId, model, effort: level, message: extra ? `${message}\n\n${extra}` : message, images: sentImages, history, handoff, context: { ...(getContext() as object), ...(tagged ? { editStyle: tagged.id } : {}), permission: permissionBrief(propsRef.current.permission), editingWorkflow: mode, workflowInstruction: propsRef.current.instruction ?? workflowInstruction(propsRef.current.workflowStatus(turnId)) }, ...(propsRef.current.persona ? { persona: propsRef.current.persona } : {}) });
      setImages([]);
    } catch (error) {
      actionLogger.error(`Chat Send Error: ${errorText(error)}`, { turnId, error });
      // The backend rejects with a message; a thrown Error means building the request failed here,
      // before any provider saw it, so pointing at another provider would only send the user in circles.
      const ours = error instanceof Error;
      patch(turnId, (item) => ({
        ...item,
        status: 'error',
        fault: ours
          ? { kind: 'unknown', title: 'Bhippi could not prepare this message', summary: errorText(error), fix: 'This is a Bhippi problem, not the provider, so switching providers will not help. Try again; if it repeats, copy the details and report it.', remedy: 'retry', actionLabel: 'Try again', resetsAt: null, provider: item.providerLabel, providerId: item.providerId, detail: error.stack ?? '' }
          : { kind: 'unknown', title: 'Could not start', summary: errorText(error), fix: 'Pick another provider or refresh providers in Settings.', remedy: 'switch_provider', actionLabel: 'Switch provider', resetsAt: null, provider: item.providerLabel, providerId: item.providerId, detail: '' },
      }));
    }
  };

  const lastUserMessage = (before: string) => {
    const index = messages.findIndex((item) => item.id === before);
    for (let i = index - 1; i >= 0; i--) {
      const item = messages[i];
      if (item.role === 'user') return item;
    }
    return null;
  };

  const remedy = (message: Assistant, action: TurnFault['remedy']) => {
    if (action === 'retry') {
      const last = lastUserMessage(message.id);
      if (last) void send(last.content, [retryNote(message, propsRef.current.tools[message.turnId] ?? [], propsRef.current.workflowStatus(message.turnId)), last.annotationBrief].filter(Boolean).join('\n\n'));
    } else if (action === 'switch_provider') {
      setPickerOpen(true);
    } else if (action === 'compact') {
      // Compacting continues the same work in a shorter transcript; the pipeline stays.
      clear({ keepProduction: true });
    } else if (action === 'update') {
      api.providerInstall(message.providerId)
        .then(() => toast({ tone: 'info', title: `Updating ${message.providerLabel}…`, body: 'Watch progress in the status bar.' }))
        .catch((error) => toast({ tone: 'error', title: 'Could not update', body: errorText(error) }));
    } else if (action === 'sign_in') {
      toast({ tone: 'info', title: `Sign in to ${message.providerLabel}`, body: message.fault?.fix ?? 'Run the CLI once in a terminal to sign in, then try again.', timeout: 12000 });
    }
  };

  /**
   * Ends every turn still writing — in the transcript, not only in the backend.
   *
   * The backend's answer is neither awaited nor required. `chat_stop` returns false for a turn it
   * no longer knows, and a turn whose task has died never sends a closing event; a stop that only
   * asked and then waited would leave the message writing for ever. That matters more than it
   * sounds, because a turn stuck writing sends every later message to the queue instead of to a
   * provider — which is what made switching model look like it hung the chat. The transcript is
   * settled here so the composer is always free afterwards.
   */
  const stop = (note?: string) => {
    for (const message of messages) {
      if (message.role !== 'assistant' || message.status !== 'streaming') continue;
      void api.chatStop(message.turnId).catch(() => undefined);
      // The avatar stops the moment the user does, not when (or if) the backend's closing event arrives.
      avatarBus.turn(message.turnId, false, 'stopped');
      flushSteers(message.turnId);
    }
    setMessages((items) =>
      items.map((item) =>
        item.role === 'assistant' && item.status === 'streaming'
          ? { ...item, status: 'stopped', notes: note ? [...item.notes, note] : item.notes, steps: item.steps.map((step) => ({ ...step, done: true })) }
          : item,
      ),
    );
  };

  const clear = (options?: { keepProduction?: boolean }) => {
    if (streaming) stop();
    setMessages([]);
    // Nothing is being carried over, so the next turn is a first turn: no handover note, and the
    // queued message from the old conversation does not arrive in the new one.
    setQueued(null);
    if (props.annotations) annotations.reset();
    for (const item of messages) if (item.role === 'assistant') steer.take(item.turnId);
    missing.current.clear();
    // A fresh conversation is a fresh task: the production dock from the old one used to stay
    // docked above the composer because it lives on the comp, not in the transcript.
    if (!options?.keepProduction) props.onClear?.();
  };

  /**
   * Moves the conversation to another provider or model, whether or not one is mid-answer.
   *
   * The picker must never be a dead end: a turn in flight is ended here rather than left to
   * finish, because the user asking for a different model has already decided this one's answer
   * is not the one they want. Anything typed while it was writing stays queued and goes to the
   * new provider instead, which is the handover the switch was asking for.
   */
  const chooseModel = (nextProvider: string, nextModel: string | null) => {
    const changed = nextProvider !== props.providerId || nextModel !== props.model;
    if (changed && streaming) {
      const to = props.providers.find((item) => item.id === nextProvider)?.label ?? 'another provider';
      stop(`Stopped — handed over to ${to}`);
    }
    props.onChooseModel(nextProvider, nextModel);
  };

  props.apiRef.current = { clear, focus: () => inputRef.current?.focus(), send: (text: string, options?: { mode?: 'full' | 'quick' }) => sendRef.current(text, options?.mode), load: loadTranscript };
  sendRef.current = (text: string, mode?: 'full' | 'quick') => void send(text, undefined, mode);

  // The Program monitor's "Send to chat": whatever is in the composer goes, with the annotations.
  const pendingNotes = usePendingAnnotations();
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const annotationSendRef = useRef<() => void>(() => undefined);
  annotationSendRef.current = () => {
    if (runIfCommand(draftRef.current)) return;
    liftOff(draftRef.current || (annotations.list().length === 1 ? 'Please apply my annotation.' : 'Please apply my annotations.'));
    void send(draftRef.current);
  };
  useEffect(() => (props.annotations ? annotations.onSendRequest(() => annotationSendRef.current()) : undefined), [props.annotations]);

  // A message typed mid-turn waits here, then goes by itself.
  useEffect(() => {
    if (streaming || queued === null) return;
    const text = queued;
    setQueued(null);
    sendRef.current(text);
  }, [streaming, queued]);

  /** Writes a message into the transcript from Bhippi itself, without calling a provider. */
  const say = (text: string) => {
    setMessages((items) => [...items, {
      id: uid(), role: 'assistant', turnId: uid(), providerId: 'bhippi', providerLabel: 'Bhippi', model: null,
      content: text, thinking: '', steps: [], status: 'done', notes: [], fault: null, usage: null, elapsedMs: null, limit: null,
    }]);
  };

  /**
   * Keeps the last exchange and replaces everything before it with a recap of what was asked and
   * what came of it. The recap is built here rather than asked for, so /compact costs nothing and
   * always says the same thing about the same conversation.
   */
  const compact = () => {
    if (streaming) stop();
    setMessages((items) => {
      if (items.length <= 2) return items;
      const keep = items.slice(-2);
      const older = items.slice(0, -2);
      const asks = older.filter((item) => item.role === 'user').map((item) => `· ${item.content.replace(/\s+/g, ' ').slice(0, 90)}`);
      const edits = older.filter((item) => item.role === 'assistant').reduce((total, item) => total + (propsRef.current.tools[item.turnId]?.length ?? 0), 0);
      const recap = [
        `**Earlier in this conversation** (${older.length} messages, ${edits} tool call${edits === 1 ? '' : 's'}):`,
        ...asks.slice(-8),
      ].join('\n');
      return [{
        id: uid(), role: 'assistant', turnId: uid(), providerId: 'bhippi', providerLabel: 'Bhippi', model: null,
        content: recap, thinking: '', steps: [], status: 'done', notes: ['Compacted'], fault: null, usage: null, elapsedMs: null, limit: null,
      } as ChatMessage, ...keep];
    });
  };

  const describeContext = () => {
    const context = propsRef.current.getContext() as Record<string, unknown> | null;
    if (!context) return 'There is no project open to describe.';
    const lines = Object.entries(context).map(([key, value]) => {
      if (Array.isArray(value)) return `· ${key}: ${value.length}`;
      if (value && typeof value === 'object') return `· ${key}: ${Object.keys(value as object).length} fields`;
      return `· ${key}: ${String(value)}`;
    });
    return `This is what I am told about your project each turn:\n\n${lines.join('\n')}`;
  };

  const allRuns = messages.flatMap((item) => (item.role === 'assistant' ? props.tools[item.turnId] ?? [] : []));

  const lastTurn = [...messages].reverse().find((item): item is Assistant => item.role === 'assistant' && item.providerId !== 'bhippi');
  /** The newest answer keeps its actions showing, the way ChatGPT's does; older ones show them on hover. */
  const lastAnswerId = messages.length && messages[messages.length - 1].role === 'assistant' ? messages[messages.length - 1].id : null;

  const commandContext: CommandContext = {
    clear,
    compact,
    say,
    send: (text) => void send(text),
    undo: () => props.onUndo(),
    revertLastTurn: () => {
      if (lastTurn && props.onRevert(lastTurn.turnId)) say('Put the project back to before those edits.');
      else say('There is nothing of mine left to revert — press Ctrl+Z to step back instead.');
    },
    openModelPicker: () => setPickerOpen(true),
    openProviders: () => props.onManageProviders(),
    setEffort: (value) => props.onEffort(value),
    setPermission: (value) => props.onPermission(value),
    effortLevels: levels,
    permission: props.permission,
    effort: props.effort,
    describeContext,
    toggleAwesome: () => props.onAwesome(!props.awesome),
    awesome: props.awesome,
    references: references.map((item) => ({ id: item.id, name: item.name, pack: item.pack, cutEvery: item.cutEvery })),
    useReference: (id) => attachReference(id),
    editStyle: props.editStyle,
    setStyle: (id) => props.onStyle(id),
    canRevert: !!lastTurn && props.canRevert(lastTurn.turnId),
  };

  /** Attaches a reference to the conversation. No message: the chip above the composer says so. */
  const attachReference = (id: string | null) => {
    setAttached(id ? references.find((item) => item.id === id) ?? null : null);
    props.onReference(id);
  };

  /**
   * `@` attaches a reference, the way `@` attaches a file everywhere else. It is deliberately not
   * `/ref`: a slash command runs and is over, while an attachment stays on the conversation, and
   * the gesture should say which of the two is happening. Edit styles (`@funny`) are offered first:
   * one stays on for every turn until its chip is cleared.
   */
  const mention = (() => {
    const match = /(^|\s)@([\w-]*)$/.exec(draft);
    if (!match || commandsHidden) return null;
    const query = match[2].toLowerCase();
    const hits: MentionHit[] = [
      ...stylesMatching(query).map((style) => ({ kind: 'style' as const, style })),
      ...references.filter((item) => item.name.toLowerCase().startsWith(query)).map((ref) => ({ kind: 'reference' as const, ref })),
    ];
    return hits.length ? { at: match.index + match[1].length, query, hits } : null;
  })();

  /** Puts `@name ` in the draft and attaches it (or switches the style on), leaving the caret ready to keep typing. */
  const pickMention = (index: number) => {
    if (!mention) return;
    const found = mention.hits[index];
    if (!found) return;
    if (found.kind === 'style') {
      setDraft(`${draft.slice(0, mention.at)}${found.style.label} `);
      props.onStyle(found.style.id);
    } else {
      setDraft(`${draft.slice(0, mention.at)}@${found.ref.name} `);
      attachReference(found.ref.id);
    }
    setCommandRow(0);
    inputRef.current?.focus();
  };
  const activeStyle = findStyle(props.editStyle);

  // ── the command panel ────────────────────────────────────────────────────
  const match = commandsHidden ? null : matchCommands(draft);
  const ordered = match ? panelOrder(match.matches) : [];
  const argumentOptions = match && match.matches.length === 1 && match.query === match.matches[0].name && draft.includes(' ')
    ? (match.matches[0].options?.(commandContext) ?? []).filter((option) => option.toLowerCase().startsWith(match.argument.trim().toLowerCase()))
    : [];
  const panelOpen = !!match && (argumentOptions.length > 0 || ordered.length > 0);
  const row = Math.min(commandRow, Math.max(0, (argumentOptions.length > 0 ? argumentOptions.length : ordered.length) - 1));

  /** Completes the highlighted row: a name gets typed out, a value runs the command. */
  const choose = (index: number) => {
    if (!match) return;
    if (argumentOptions.length > 0) {
      const command = match.matches[0];
      command.run(commandContext, argumentOptions[index] ?? '');
      setDraft('');
      setCommandRow(0);
      return;
    }
    const command = ordered[index];
    if (!command || command.disabled?.(commandContext)) return;
    if (command.args) {
      // Takes a value: type the name and let the panel offer them.
      setDraft(`${command.name} `);
      setCommandRow(0);
      inputRef.current?.focus();
      return;
    }
    command.run(commandContext, '');
    setDraft('');
    setCommandRow(0);
  };

  /** A whole line that is a command runs instead of being sent to a provider. */
  const runIfCommand = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed.startsWith('/')) return false;
    const [name, ...rest] = trimmed.split(/\s+/);
    const command = COMMANDS.find((item) => item.name === name.toLowerCase());
    if (!command) {
      say(`There is no ${name} command. Type / to see what there is.`);
      setDraft('');
      return true;
    }
    const why = command.disabled?.(commandContext);
    if (why) say(why);
    else command.run(commandContext, rest.join(' '));
    setDraft('');
    return true;
  };

  return (
    <div ref={rootRef} className={`chat${props.awesome ? ' awesome' : ''}${streaming ? ' working' : ''}`} aria-label={props.label ?? 'Bhippi AI'}>

      <div className="chat-list" ref={listRef}>
        {messages.length === 0 && (
          // An empty chat says nothing: the mark and name, barely there, and room to start typing.
          <div className="chat-empty" aria-hidden="true"><div><img src="/bhippi.png" alt="" /><span>Bhippi</span></div></div>
        )}
        {messages.map((message) =>
          message.role === 'user' ? (
            <div key={message.id} className="msg-user-row">
              <div className="msg msg-user">
                {message.content}
                {!!message.annotations?.length && (
                  <div className="msg-annots">
                    {message.annotations.map((item) => (
                      <span key={item.n} className="msg-annot" title={`${item.timecode} · ${item.label}${item.note ? ` — ${item.note}` : ''}`}>
                        <MapPin size={10} /><b>#{item.n}</b> {item.timecode} · {item.label}{item.note ? <em> — {item.note}</em> : null}
                      </span>
                    ))}
                  </div>
                )}
                {!!message.images?.length && <div className="chat-images">{message.images.map((src,index)=><img key={index} src={src} alt={"Attached image "+(index+1)} />)}</div>}
              </div>
              <div className="msg-actions">
                <button
                  type="button"
                  className="msg-action"
                  title="Edit — put this message back in the composer"
                  aria-label="Edit message"
                  onClick={() => {
                    setDraft(message.content);
                    requestAnimationFrame(() => {
                      const input = inputRef.current;
                      if (!input) return;
                      input.focus();
                      input.setSelectionRange(input.value.length, input.value.length);
                    });
                  }}
                >
                  <Pencil size={13} />
                </button>
                <CopyAction text={message.content} label="Copy message" />
                <button
                  type="button"
                  className="msg-action"
                  title={streaming ? 'Send this again into the running turn' : 'Send this again'}
                  aria-label="Send again"
                  onClick={() => void send(message.content)}
                >
                  <SendHorizontal size={13} />
                </button>
              </div>
            </div>
          ) : (
            <AssistantMessage
              key={message.id}
              message={message}
              latest={message.id === lastAnswerId}
              onDropSteer={(id) => dropSteer(message.turnId, id)}
              workflow={props.workflowStatus(message.turnId)}
              tools={props.tools[message.turnId] ?? []}
              canRevert={props.canRevert(message.turnId)}
              onRevert={() => {
                if (props.onRevert(message.turnId)) patch(message.turnId, (item) => ({ ...item, notes: [...item.notes, 'Edits reverted'] }));
                else toast({ tone: 'info', title: 'Use Undo instead', body: 'The project changed after these edits, so press Ctrl+Z to step back.' });
              }}
              onRemedy={(action) => remedy(message, action)}
              onContinue={() => void send(continuePrompt(props.workflowStatus(message.turnId)))}
            />
          ),
        )}
      </div>

      {props.genPlan && props.onGenPlan && (
        <GenerationPlanCard key={props.genPlan.plan.items.map((item) => item.key).join()} plan={props.genPlan.plan} assets={props.genPlan.assets} onDone={props.onGenPlan} />
      )}

      {props.ask && (
        // One question at a time, with its place in the queue: four at once is a form, and a form
        // is not a conversation.
        <div className="ask-card" key={props.ask.question}>
          <div className="ask-head">
            <CircleHelp size={12} />
            <span>Bhippi AI is asking</span>
            {props.askCount > 1 && <span className="ask-count">1 of {props.askCount}</span>}
          </div>
          <p className="ask-question">{props.ask.question}</p>
          {props.ask.context && <p className="ask-context">{props.ask.context}</p>}
          {props.ask.options.length > 0 && (
            <div className="ask-options">
              {props.ask.options.map((option, index) => (
                <button
                  key={`${index}:${option}`}
                  type="button"
                  className="ask-option"
                  style={{ animationDelay: `${index * 40}ms` }}
                  onClick={() => { props.onAnswer(option); setAskDraft(''); }}
                >
                  {option}
                </button>
              ))}
            </div>
          )}
          <form
            className="ask-reply"
            onSubmit={(event) => {
              event.preventDefault();
              if (!askDraft.trim()) return;
              props.onAnswer(askDraft.trim());
              setAskDraft('');
            }}
          >
            <input
              value={askDraft}
              onChange={(event) => setAskDraft(event.target.value)}
              placeholder={props.ask.options.length ? 'Or type your own answer…' : 'Type your answer…'}
              aria-label="Your answer"
              autoFocus
            />
            <button type="submit" className="ask-send" disabled={!askDraft.trim()} aria-label="Send answer">
              <ArrowUp size={13} />
            </button>
          </form>
          <button
            type="button"
            className="ask-skip"
            onClick={() => { props.onAnswer('The editor skipped this question — decide for yourself and say what you chose.'); setAskDraft(''); }}
          >
            Skip this one — decide for me
          </button>
        </div>
      )}

      {queued !== null && (
        <div className="queued-note">
          <span className="queued-label">Next</span>
          <span className="queued-text">{queued}</span>
          <button type="button" className="queued-drop" onClick={() => setQueued(null)} title="Do not send this">
            <X size={11} />
          </button>
        </div>
      )}

      {launch && <Launch key={launch.id} {...launch} />}

      {streaming && (
        <div className="chat-stream-bar" aria-hidden="true">
          <div className="particle-field">
            {Array.from({ length: 42 }).map((_, column) => (
              <div key={column} className="particle-col">
                <span className={`particle c-${(column * 3) % 5}`} />
              </div>
            ))}
          </div>
        </div>
      )}

      {props.productionBar}

      <form
        ref={formRef}
        className={`composer${panelOpen ? ' with-panel' : ''}`}
        onSubmit={(event) => {
          event.preventDefault();
          if (runIfCommand(draft)) return;
          liftOff(draft);
          void send(draft);
        }}
      >
        {props.awesome && streaming && <ComposerStreak />}
        {mention && (
          <div className="cmd-panel" role="listbox" aria-label="Choose an edit style or attach a reference">
            {mention.hits.map((item, index) => {
              const active = index === Math.min(commandRow, mention.hits.length - 1);
              // One heading per kind, at its first row; the rows keep one running index for the arrows.
              const heading = index === 0 || mention.hits[index - 1].kind !== item.kind ? (item.kind === 'style' ? 'Style' : 'Reference') : null;
              return (
                <div key={item.kind === 'style' ? `style:${item.style.id}` : `ref:${item.ref.id}`} className="cmd-section">
                  {heading && <div className="cmd-group">{heading}</div>}
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={`cmd-row${active ? ' active' : ''}`}
                    onMouseEnter={() => setCommandRow(index)}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      pickMention(index);
                    }}
                  >
                    {item.kind === 'style' ? (
                      <>
                        <span className="cmd-name">{item.style.label}<span className="cmd-args"> style</span></span>
                        <span className="cmd-summary">{item.style.description}{item.style.id === props.editStyle ? ' · on' : ''}</span>
                      </>
                    ) : (
                      <>
                        <span className="cmd-name">@{item.ref.name}</span>
                        <span className="cmd-summary">
                          {item.ref.pack ?? 'reference'}
                          {item.ref.seconds > 0 ? ` · ${Math.round(item.ref.seconds)}s, a cut every ${item.ref.cutEvery.toFixed(1)}s` : ''}
                        </span>
                      </>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {panelOpen && !mention && (
          <CommandPanel
            matches={ordered}
            options={argumentOptions}
            active={row}
            context={commandContext}
            onActive={setCommandRow}
            onChoose={choose}
          />
        )}
        {attached && (
          <div className="attached-ref">
            <Paperclip size={11} />
            <span className="attached-name">{attached.name}</span>
            <span className="attached-detail">{attached.pack ?? 'reference'}{attached.seconds > 0 ? ` · a cut every ${attached.cutEvery.toFixed(1)}s` : ''}</span>
            <button type="button" onClick={() => attachReference(null)} aria-label="Detach reference"><X size={11} /></button>
          </div>
        )}
        {activeStyle && (
          <div className="attached-ref attached-style" title="Every turn edits in this style until you clear it">
            <Laugh size={11} />
            <span className="attached-name">{activeStyle.label}</span>
            <span className="attached-detail">{activeStyle.description}</span>
            <button type="button" onClick={() => props.onStyle(null)} aria-label={`Turn off the ${activeStyle.label} style`}><X size={11} /></button>
          </div>
        )}
        {props.annotations && pendingNotes.length > 0 && (
          <div className="annot-queue" aria-label="Annotations waiting to be sent">
            <div className="annot-queue-head">
              <MapPin size={11} />
              <span className="attached-name">{pendingNotes.length} annotation{pendingNotes.length === 1 ? '' : 's'} added</span>
              <span className="attached-detail">{streaming ? 'go with your next message' : 'go with this message'}</span>
              <button type="button" onClick={() => annotations.clear()} aria-label="Remove all annotations" title="Remove all"><X size={11} /></button>
            </div>
            <ul>
              {pendingNotes.map((item) => (
                <li key={item.id}>
                  {item.snapshot && <img src={item.snapshot} alt="" />}
                  <b>#{item.n}</b>
                  <span className="annot-where">{item.timecode} · {annotationLabel(item)}</span>
                  <span className="annot-note">{item.note || '(pointed at)'}</span>
                  <button type="button" onClick={() => annotations.remove(item.id)} aria-label={`Remove annotation ${item.n}`}><X size={10} /></button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <input hidden ref={imageInput} type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={e=>{void addImages(Array.from(e.target.files||[]));e.target.value='';}} />
        {messages.some(message=>message.role==='user'&&message.images?.length)&&<small>Images in this conversation may be sent again to {active?.label||'the selected provider'} as context.</small>}
        {images.length>0&&<><div className="chat-images">{images.map((src,index)=><div key={index}><img src={src} alt={'Image '+(index+1)}/><button type="button" aria-label={'Remove image '+(index+1)} onClick={()=>setImages(current=>current.filter((_,i)=>i!==index))}>×</button></div>)}</div><small>Sending shares these images with {active?.label||'the selected provider'}. Choose a vision-capable model.</small></>}
        <textarea
          onPaste={e=>{const files=Array.from(e.clipboardData.files);if(files.some(f=>f.type.startsWith('image/'))){e.preventDefault();void addImages(files);}}}
          onDragOver={e=>{if(e.dataTransfer.types.includes('Files'))e.preventDefault();}}
          onDrop={e=>{if(e.dataTransfer.files.length){e.preventDefault();e.stopPropagation();void addImages(Array.from(e.dataTransfer.files));}}}
          ref={inputRef}
          value={draft}
          onChange={(event) => {
            const next = event.target.value;
            // Re-read the references the moment an attachment is being typed, so the menu shows
            // what is on disk rather than what was there when the panel mounted.
            if (next.endsWith('@') && !draft.endsWith('@')) loadReferences();
            setDraft(next);
            setCommandsHidden(false);
            setCommandRow(0);
          }}
          onKeyDown={(event) => {
            if (mention) {
              const count = mention.hits.length;
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                return setCommandRow((value) => (value + 1) % count);
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                return setCommandRow((value) => (value - 1 + count) % count);
              }
              if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing)) {
                event.preventDefault();
                return pickMention(Math.min(commandRow, count - 1));
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                return setCommandsHidden(true);
              }
            }
            if (panelOpen) {
              const count = argumentOptions.length > 0 ? argumentOptions.length : ordered.length;
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                return setCommandRow((value) => (value + 1) % count);
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                return setCommandRow((value) => (value - 1 + count) % count);
              }
              if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing)) {
                event.preventDefault();
                return choose(row);
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                return setCommandsHidden(true);
              }
            }
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (runIfCommand(draft)) return;
              liftOff(draft);
              void send(draft);
            }
            if (event.key === 'Escape') (event.target as HTMLTextAreaElement).blur();
          }}
          placeholder={streaming ? 'Add to what Bhippi is doing — it reads this at its next step…' : props.placeholder ?? (active?.kind === 'builtin' ? 'Try: add title "My Story" at 1s' : 'Ask for an edit or an idea…')}
          rows={2}
          aria-label="Message Bhippi AI"
        />
        <div className="composer-bar"><button type="button" className="icon-btn" aria-label="Attach images" title="Attach images" onClick={()=>imageInput.current?.click()}><Paperclip size={15}/></button>
          <ModelPicker
            providers={props.providers.filter((provider) => provider.usable && provider.enabled)}
            providerId={props.providerId}
            model={props.model}
            onSelect={chooseModel}
            onManage={props.onManageProviders}
            open={pickerOpen}
            onOpenChange={setPickerOpen}
          />
          <div className="composer-options">{(levels.length > 0 || speeds.length > 1) && (
            <ThinkingSlider
              effort={props.effort}
              levels={levels}
              awesome={props.awesome}
              onAwesome={props.onAwesome}
              onSelect={props.onEffort}
              speeds={speeds}
              speedAt={speedIndex(speeds, props.model)}
              sends={props.model ? variantModel(active?.models ?? [], props.model, props.effort) : null}
              onSpeed={(next) => props.providerId && chooseModel(props.providerId, next)}
            />
          )}
          {!props.lockedMode && <select className="composer-select" aria-label="Editing workflow" title="Full workflow enforces transcript, every-frame review and a timed storyboard. Quick edit is for a targeted change." value={workflowMode} onChange={e => setWorkflowMode(e.target.value as 'full' | 'quick')} disabled={streaming}>
            <option value="full">Full workflow</option><option value="quick">Quick edit</option>
          </select>}
          <PermissionMenu mode={props.permission} onSelect={props.onPermission} />
          </div>
          {streaming ? (
            <>
              {/* Typed while it works: this goes into the running turn rather than waiting for it. */}
              {draft.trim() && <button type="submit" className="send-btn" title="Add to the running task (Enter)"><ArrowUp size={16} /></button>}
              <button type="button" className="send-btn stop" onClick={() => stop()} title="Stop"><CircleStop size={16} /></button>
            </>
          ) : (
            <button type="submit" className="send-btn" disabled={!draft.trim() && !images.length && !(props.annotations && pendingNotes.length)} title="Send (Enter)"><ArrowUp size={16} /></button>
          )}
        </div>
      </form>

      <ChatStatusBar
        usage={<UsageMeter provider={active} model={props.model} onSwitch={props.onManageProviders} />}
        runs={allRuns}
        connections={props.connections}
        agents={props.agents}
        onStopAgent={props.onStopAgent}
        onManageConnections={props.onManageConnections}
      />
    </div>
  );
}

/**
 * What "Continue Workflow" tells the model to do next. One generic paragraph covering every
 * phase used to be sent no matter what — so a model still mid-GATHER would read the EDIT/POLISH
 * half of the same paragraph, jump ahead, and re-emit the same batch of timeline edits that just
 * got refused, over and over, with the button visibly doing nothing. Naming the actual phase and
 * the actual pending shots (from live production state, not the model's own stale plan) points it
 * at the one thing left to do.
 */
function continuePrompt(status: WorkflowPhaseStatus): string {
  const phase = status?.phase ?? null;
  const shared = 'Call editing_workflow_status first and trust what it reports over anything you planned earlier — the project may already be further along than your last reply assumed.';
  if (phase === 'gathering') {
    const pending = status?.gather?.pending ?? [];
    const named = pending.length
      ? ` Still pending: ${pending.slice(0, 6).join('; ')}${pending.length > 6 ? ` (+${pending.length - 6} more)` : ''}.`
      : '';
    return `Continue the GATHER phase only.${named} ${shared} Generate or download ONLY the shots still pending (one call per shot, with sceneIndex so it attaches to the plan), attach_production_asset each real result, and do not touch the timeline or plan edit-phase work yet. Once every shot has a real attached asset, call finish_gathering and end your turn.`;
  }
  if (phase === 'gathered') {
    return `Gathering is finished. ${shared} Attach any real result still unattached with attach_production_asset, then end your turn with a short summary of what was gathered — the user presses Start editing.`;
  }
  if (phase === 'plan-ready' || phase === null || phase === 'planning') {
    return `Continue the PLAN phase only. ${shared} Finish research, script, shots (with sceneIndex, script/prompt, graphics, transition, SFX, music per beat) and save it with save_storyboard or save_video_blueprint, then end your turn — do not generate media yet.`;
  }
  return `Continue the EDIT/POLISH phase only. ${shared} Work just the next unfinished 5–12s batch — cuts, levels, beats, transitions, roto/erase, motion graphics, sound — run run_frame_qa until it is clear, then get_comp + verify_edit_workflow. Do not redo batches already on the timeline.`;
}

/** A copy button that says it worked. */
function CopyAction({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const toast = useToast();
  return (
    <button
      type="button"
      className={`msg-action${copied ? ' copied' : ''}`}
      title={copied ? 'Copied' : label}
      aria-label={label}
      disabled={!text.trim()}
      onClick={() => {
        void copyText(text).then((done) => {
          if (!done) {
            toast({ tone: 'error', title: 'Copy failed', body: 'Select the text and press Ctrl+C instead.' });
            return;
          }
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1100);
        });
      }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}

type WorkflowView = { mode: string; structurallyVerified: boolean; phase?: string | null; nextUserAction?: string | null; phaseClosedThisTurn?: string | null } | null;

/** Where a full-workflow turn left the edit, in one line — or nothing, for a turn that did no work (a greeting, a question). */
function workflowLine(workflow: WorkflowView, worked: boolean): { tone: 'ok' | 'next' | 'warn'; text: string } | null {
  if (workflow?.mode !== 'full' || (!worked && !workflow.nextUserAction)) return null;
  if (workflow.structurallyVerified) return { tone: 'ok', text: 'Workflow steps and timeline structure verified. Render, matte and audio quality still need review.' };
  if (workflow.nextUserAction === 'start-generating') return { tone: 'next', text: 'Plan saved. Review it above, then press Start generating.' };
  if (workflow.nextUserAction === 'start-editing') return { tone: 'next', text: 'Everything is gathered. Press Start editing when you are ready.' };
  if (workflow.phase === 'gathering') return { tone: 'next', text: 'Gathering in progress. The assistant closes this phase with finish_gathering.' };
  return { tone: 'warn', text: 'The workflow is not finished — some stages have not run or could not be verified.' };
}

function AssistantMessage({ message, latest, workflow, tools, canRevert, onRevert, onRemedy, onContinue, onDropSteer }: { message: Assistant; latest: boolean; workflow: WorkflowView; tools: ToolRun[]; canRevert: boolean; onRevert: () => void; onRemedy: (remedy: TurnFault['remedy']) => void; onContinue?: () => void; onDropSteer: (id: string) => void }) {
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const visible = message.content;
  const seconds = message.elapsedMs !== null ? `${(message.elapsedMs / 1000).toFixed(1)}s` : null;
  const streaming = message.status === 'streaming';
  // Every answer is Bhippi's; which provider wrote it stays out of the header.
  const changes = tools.filter((run) => run.status === 'done' && run.changedProject).length;
  const line = streaming ? null : workflowLine(workflow, tools.length > 0);
  const meta = [message.model, seconds].filter(Boolean).join(' · ');
  return (
    <div className={`msg msg-assistant status-${message.status}${latest ? ' latest' : ''}`}>
      <div className="msg-meta">
        <span className="msg-avatar bhippi"><img src="/bhippi.png" alt="" /></span>
        <span className="msg-who">Bhippi</span>
        {message.status === 'stopped' && <span className="msg-flag">Stopped</span>}
      </div>
      {message.thinking && (
        <button type="button" className={`thinking${streaming && !visible ? ' live' : ''}`} onClick={() => setThinkingOpen((value) => !value)} aria-expanded={thinkingOpen}>
          <Brain size={12} className="thinking-icon" />
          <span className="thinking-label">{streaming && !visible ? 'Thinking' : 'Thought process'}</span>
          <ChevronRight size={12} className={`thinking-chevron${thinkingOpen ? ' rotate-90' : ''}`} />
        </button>
      )}
      {thinkingOpen && <div className="thinking-body">{message.thinking}</div>}
      <AnswerBody
        content={visible}
        segments={message.segments}
        steps={message.steps}
        runs={tools}
        steers={message.steers}
        streaming={streaming}
        thinking={!!message.thinking}
        onDropSteer={onDropSteer}
      />
      {line && (
        <div className={`workflow-note ${line.tone}`} role="status">
          <span>{line.text}</span>
          {line.tone === 'warn' && onContinue && (
            <button type="button" className="workflow-continue" onClick={onContinue}>
              <Play size={10} /> Continue
            </button>
          )}
        </div>
      )}
      {changes > 0 && !streaming && (
        <div className="edits-card">
          <div className="edits-head">
            <Check size={13} /> {changes} project change{changes === 1 ? '' : 's'} applied
            {canRevert && <button type="button" className="btn btn-small btn-ghost" onClick={onRevert}><RotateCcw size={12} /> Revert</button>}
          </div>
        </div>
      )}
      {message.notes.length > 0 && <div className="notes">{message.notes.map((note, index) => <div key={index}>{note}</div>)}</div>}
      {message.limit && message.limit.used >= 0.8 && (
        <div className="limit-note">{message.providerLabel} plan usage at {Math.round(message.limit.used * 100)}%</div>
      )}
      {message.fault && <FaultCard fault={message.fault} onAct={onRemedy} />}
      {!streaming && visible.trim() && (
        <div className="msg-actions">
          <CopyAction text={visible} label="Copy answer" />
          {meta && <span className="msg-actions-meta">{meta}</span>}
        </div>
      )}
    </div>
  );
}

