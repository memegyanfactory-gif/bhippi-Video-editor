import { GenerationPlanCard } from './GenerationPlanCard';
import type { GenPlan } from '../lib/cloudGen';
import type { Asset } from '../lib/types';
import { modelVariants, variantModel } from '../lib/modelVariants';
import { rememberTurnPrompt } from '../lib/turnPrompts';
import { speedIndex, speedSteps } from '../lib/modelTiers';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { ArrowDown, ArrowUp, ChevronRight, CircleHelp, File as FileIcon, Film, Laugh, MapPin, Music, Paperclip, Pencil, Play, RotateCcw, SendHorizontal, X } from 'lucide-react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode, type RefObject } from 'react';
import { FaultCard } from '../components/FaultCard';
import { ModelPicker } from '../components/ModelPicker';
import { useToast } from '../components/ui';
import { permissionBrief, type Effort, type PermissionMode } from '../lib/permissions';
import { PermissionMenu, ThinkingSlider } from './ComposerControls';
import { ChatStatusBar, type AgentRun, type Connection } from './ChatStatusBar';
import { UsageMeter } from './UsageMeter';
import * as usage from '../lib/usage';
import { projectKey, recordTurn } from '../lib/tokenLedger';
import { routeTools, type Toolset } from '../lib/toolRouter';
import { GUIDED_BRIEF, modelTier, type GuidedSetting } from '../lib/modelProfile';
import type { HarnessId } from '../lib/harness';
import { trace } from '../lib/turnTrace';
import { type Interjection, type Step, type TextSegment, type ToolRun } from './Activity';
import { steer } from './steer';
import { AnswerBody, type SteerActions } from './AnswerBody';
import { ATTACHABLE, filesBrief, MAX_CHAT_IMAGES, pictureUrl, samePath, type ChatFile } from './attachments';
import { CopyAction } from './CopyAction';
import { appendText, settleText } from './segments';
import { CommandPanel, panelOrder } from './CommandPanel';
import { COMMANDS, matchCommands, type CommandContext } from './commands';
import { handoffFor, historyFor, seesImages } from './handoff';
import { annotationBrief, annotationLabel, annotations, sentAnnotation, usePendingAnnotations, type SentAnnotation } from '../lib/annotations';
import { uid } from '../lib/editor';
import { api, errorText, events, type ChatAttachment, type ReferenceFilm } from '../lib/ipc';
import { findStyle, styleInMessage, stylesMatching, type StyleDef, type StyleId } from '../lib/styles';
import { actionLogger } from '../lib/actionLogger';
import { avatarBus } from '../avatar/bus';
import type { TurnOutcome } from '../lib/ideagraph';
import { changeSummary, type TurnChange } from '../lib/turnChanges';
import { TrainingCard } from './TrainingCard';
import { BhippiMark, StatusDot, StopGlyph, type MarkState } from './BhippiMark';
import { useChatScroll } from './useChatScroll';
import { kitsInMessage, kitsMatching, kitTag } from '../lib/kitMention';
import { brandKitContext } from '../lib/brandKit';
import type { TrainedKit } from '../lib/brandKit/learnings';

/** m:ss for a place on the timeline. */
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
import { routeWorkflow, savedWorkflowChoice, saveWorkflowChoice, type WorkflowChoice } from '../lib/workflowRoute';
import type { ProviderInfo, TurnFault, Usage } from '../lib/types';

export type { ToolRun } from './Activity';

export type ChatMessage =
  | { id: string; role: 'user'; content: string; at: number; images?: string[]; /** Videos, audio and pictures attached from disk, shown as chips. */ files?: { name: string; kind: ChatAttachment['kind'] }[]; /** Monitor annotations sent with it: shown as chips, and their brief kept for later turns. */ annotations?: SentAnnotation[]; annotationBrief?: string }
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
type MentionHit = { kind: 'style'; style: StyleDef } | { kind: 'reference'; ref: ReferenceFilm } | { kind: 'kit'; kit: TrainedKit };

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

type WorkflowPhaseStatus = { phase?: string | null; gather?: { ready: number; total: number; pending: string[] } | null; frameSizeNeeded?: boolean } | null;

/** Plan and gather turns end when their phase closes; the user's button (Start generating, Start editing) moves on. */
const endsAtButton = (status: WorkflowPhaseStatus) => ['plan', 'planning', 'plan-ready', 'gathering', 'gathered'].includes(status?.phase ?? '');

/**
 * The standing instruction each turn carries. Telling a plan or gather turn not to stop before
 * verify_edit_workflow sent it past the user's button into timeline edits the guard refuses, so
 * those phases are told to finish their own work and end the turn.
 */
export function workflowInstruction(status: WorkflowPhaseStatus): string {
  // Understand the message before acting on it: chat gets a reply, only a request to build or edit
  // gets the workflow. The frame is the user's call, so a build on an empty timeline asks it first.
  const size = status?.frameSizeNeeded ? ' The timeline has no picture yet: before building, planning, notes or research for it, call choose_comp_size with a question worded for their request and the shape you would recommend (it skips the question when their words already settle the shape).' : '';
  return `${UNDERSTAND_FIRST}${size} For a request to make or change the video: ${phaseInstruction(status)}`;
}

/** Every turn starts by reading what the person actually wants. */
const UNDERSTAND_FIRST = 'Read the message and work out what the person wants before any tool. A greeting, thanks, small talk or a question about the app, the project or editing gets a short, natural reply in their tone, using what you know of the project (what is open, what was just made) where it helps — no tools, no todo list, no workflow, no questions about the video. When a request is vague, ask about the one thing that matters for it in your own words, tied to what they said, not a scripted form.';

function phaseInstruction(status: WorkflowPhaseStatus): string {
  if (!endsAtButton(status)) return 'Call editing_workflow_status first. In full mode, do NOT stop after analysis — execute all cuts, motion graphics, b-roll and sound design, then call verify_edit_workflow before ending your turn.';
  const phase = status?.phase;
  const next = phase === 'gathering' || phase === 'gathered' ? 'Start editing' : 'Start generating';
  return `Call editing_workflow_status first. The production is in the ${phase} phase: finish this phase and end your turn — the user presses ${next} to move on. Do not edit the timeline in this turn.`;
}

export type ChatApi = { clear: () => void; focus: () => void; /** `mode` runs this one turn in that editing workflow instead of the composer's. */ send: (text: string, options?: { mode?: 'full' | 'quick' }) => void; /** Replaces the transcript (opening a .bhippi that carries one). */ load: (messages: unknown[]) => void; /** Stops the turn that is running, if any. */ stop: () => void; /** Puts `text` in the composer (after anything typed) and focuses it, without sending. */ compose: (text: string) => void };

/**
 * Where the chat's latest turn stands, for a host that shows it while the chat is out of sight
 * (the Plugin Maker's corner badge): working and on which step, or how it ended.
 */
export type ChatActivity = { turnId: string; status: 'streaming' | 'done' | 'stopped' | 'error'; step: string | null } | null;

type Props = {
  apiRef: RefObject<ChatApi | null>;
  providers: ProviderInfo[];
  providerId: string | null;
  model: string | null;
  onChooseModel: (providerId: string, model: string | null) => void;
  /** How hard the model should think, for the providers that take a level. */
  effort: Effort;
  onEffort: (effort: Effort) => void;
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
  /** Told whenever the latest turn starts, moves on to another step, or ends. */
  onActivity?: (activity: ChatActivity) => void;
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
  /** `tier`: whether this turn's model runs guided (modelProfile.ts), so its calls are held to templates. */
  onStartWorkflow: (turnId: string, mode: 'full' | 'quick', tier?: 'full' | 'guided') => void;
  /** Whether the active comp has a planned production under way (Auto then keeps the full workflow). */
  productionActive?: () => boolean;
  workflowStatus: (turnId: string) => {
    mode: string; structurallyVerified: boolean; phase?: string | null;
    gather?: { ready: number; total: number; pending: string[] } | null;
  } | null;
  /** Tool calls the editor ran, by turn. */
  tools: Record<string, ToolRun[]>;
  /** Fires once per finished turn so the host can record the outcome (IdeaGraph brain). */
  onTurnDone?: (outcome: TurnOutcome) => void;
  /** Puts the project back to where it was before a turn's edits; false when it has moved on. */
  /** Resolves true once reverted; false when there was nothing to revert or the user said no. */
  onRevert: (turnId: string) => boolean | Promise<boolean>;
  canRevert: (turnId: string) => boolean;
  /** What a turn changed on the timelines (lib/turnChanges.ts), listed under its answer. */
  changesFor?: (turnId: string) => TurnChange[];
  onJumpToChange?: (change: TurnChange) => void;
  /** Brand kits (for `/train @Kit` and the training review card). */
  brandKits?: () => TrainedKit[];
  /** Changes one brand kit (the training card's Remove / Undo training). */
  onUpdateKit?: (kitId: string, change: (kit: TrainedKit) => TrainedKit) => void;
  /** The turn whose changes are tinted on the timeline; setting null hides the tint. */
  highlightedTurn?: string | null;
  onHighlightTurn?: (turnId: string | null) => void;
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
  /** Settings → General: whether models run the full production or the guided one (modelProfile.ts). */
  guidedMode?: GuidedSetting;
  /** Imports files attached to a message into the project (not the timeline), so the AI can use them by id. */
  onImportFiles?: (paths: string[]) => Promise<{ id: string; name: string; path: string }[]>;
  /** A fixed toolset that replaces the router's (the Plugin Maker's: no genres, no timeline playbooks). */
  toolset?: Toolset;
  /**
   * The harness this chat's turns run under (src/lib/harnesses.json): the backend swaps copilot.md
   * for its prompt and lets its turns see and call only its tools.
   */
  harness?: HarnessId;
  placeholder?: string;
  label?: string;
  /** This chat takes the Program monitor's annotations (the main chat, not the Plugin Maker's). */
  annotations?: boolean;
};



export function ChatPanel(props: Props) {
  const toast = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [images,setImages]=useState<string[]>([]);
  const imagesRef=useRef(images);imagesRef.current=images;
  /** Files attached to the next message besides its pictures: videos, audio and anything else (and where each picture came from). */
  const [files,setFiles]=useState<ChatFile[]>([]);
  const filesRef=useRef(files);filesRef.current=files;
  /**
   * Pictures pasted or dropped as browser files (screenshots from the clipboard): any image type
   * and size, shrunk to a JPEG when it is not PNG/JPEG/WebP or too big to send as it is.
   */
  async function addImages(dropped: File[]) {
    const pictures=dropped.filter(file=>file.type.startsWith('image/'));
    if(pictures.length<dropped.length)toast({tone:'info',title:'Drop videos from File Explorer',body:'Videos and audio attach when dragged from File Explorer or picked with the paperclip.'});
    const room=MAX_CHAT_IMAGES-imagesRef.current.length;
    if(pictures.length>room)toast({tone:'info',title:`${MAX_CHAT_IMAGES} pictures per message`,body:`Only the first ${Math.max(0,room)} were attached.`});
    const urls:string[]=[];
    for(const file of pictures.slice(0,Math.max(0,room))){
      try{urls.push(await pictureUrl(file));}catch(error){toast({tone:'error',title:`Could not attach ${file.name||'the picture'}`,body:errorText(error)});}
    }
    if(urls.length)setImages(current=>[...current,...urls].slice(0,MAX_CHAT_IMAGES));
  }
  /**
   * Files from disk (File Explorer drops, the paperclip): pictures go along as pictures; videos and
   * audio are imported into the project, so the AI can put them in the edit by id, and a video
   * also sends a few frames from across it so a model that sees can tell what is in it.
   */
  async function attachPaths(paths: string[]) {
    if(!paths.length)return;
    let prepared:ChatAttachment[];
    try{prepared=await api.chatPrepareAttachments(paths,3);}catch(error){toast({tone:'error',title:'Could not attach those files',body:errorText(error)});return;}
    const media=prepared.filter(item=>item.kind==='video'||item.kind==='audio');
    let imported:{id:string;name:string;path:string}[]=[];
    if(media.length&&propsRef.current.onImportFiles){
      try{imported=await propsRef.current.onImportFiles(media.map(item=>item.path));}catch(error){toast({tone:'error',title:'Could not import into the project',body:errorText(error)});}
    }
    const sees=seesImages(propsRef.current.providerId);
    const pictures=[...imagesRef.current];
    const added:ChatFile[]=[];
    let dropped=0;
    for(const item of prepared){
      if(item.error&&!item.images.length&&item.kind!=='audio')toast({tone:'error',title:`Could not read ${item.name}`,body:item.error});
      const asset=imported.find(entry=>samePath(entry.path,item.path));
      if(item.kind==='image'){
        if(!item.images.length)continue;
        if(pictures.length>=MAX_CHAT_IMAGES){dropped++;continue;}
        pictures.push(item.images[0]);
        added.push({name:item.name,kind:'image',path:item.path,frames:0});
        continue;
      }
      const frames=sees?item.images.slice(0,Math.max(0,MAX_CHAT_IMAGES-pictures.length)):[];
      pictures.push(...frames);
      added.push({name:item.name,kind:item.kind,path:item.path,assetId:asset?.id,duration:item.duration??undefined,times:item.times.slice(0,frames.length),frames:frames.length});
    }
    if(dropped)toast({tone:'info',title:`${MAX_CHAT_IMAGES} pictures per message`,body:`${dropped} more ${dropped===1?'was':'were'} left out.`});
    setImages(pictures);
    if(added.length)setFiles(current=>[...current,...added]);
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
      void attachPaths(event.payload.paths);
    });return()=>{void pending.then(off=>off()).catch(()=>undefined);};
  },[]);
  /** The paperclip: any picture, video or audio from disk. */
  const pickFiles=async()=>{
    const picked=await openDialog({multiple:true,title:'Attach to the message',filters:[{name:'Pictures, video and audio',extensions:ATTACHABLE}]});
    if(Array.isArray(picked))void attachPaths(picked);else if(typeof picked==='string')void attachPaths([picked]);
  };
  const [pickerOpen, setPickerOpen] = useState(false);
  const [levels, setLevels] = useState<Effort[]>([]);
  const [references, setReferences] = useState<ReferenceFilm[]>([]);
  const [attached, setAttached] = useState<ReferenceFilm | null>(null);
  // Which command row the keyboard is on, and whether Escape has closed the panel for this draft.
  const [commandRow, setCommandRow] = useState(0);
  const [commandsHidden, setCommandsHidden] = useState(false);
  /** Typed while a turn was still streaming: it goes as soon as the turn ends. */
  const [queued, setQueued] = useState<string | null>(null);
  const [askDraft, setAskDraft] = useState('');
  const [loaded, setLoaded] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const reserveRef = useRef<HTMLDivElement>(null);
  const scroll = useChatScroll(listRef, reserveRef);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  /** Replaces the transcript with one a .bhippi file carried, and makes it the saved chat log. */
  const loadTranscript = (saved: unknown[]) => {
    const valid = (saved as ChatMessage[]).filter((item) => item && (item.role === 'user' || item.role === 'assistant'));
    setMessages(valid.map((item) => (item.role === 'assistant' && item.status === 'streaming' ? { ...item, status: 'stopped' } : item)));
    scroll.reset();
    void api.chatLogSave(valid, props.logScope).catch(() => undefined);
  };
  /** Text into the composer (after anything typed), focused with the caret at the end; not sent. */
  const compose = (text: string) => {
    setDraft((current) => (current.trim() ? `${current.trimEnd()}
${text}` : text));
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      input.selectionStart = input.selectionEnd = input.value.length;
    });
  };
  useImperativeHandle(props.apiRef, () => ({
    compose,
    clear: () => {
      setMessages([]);
      scroll.reset();
      setDraft('');
      setImages([]);
      setFiles([]);
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
    stop: () => stopRef.current(),
  }), []);
  const stopRef = useRef<() => void>(() => undefined);
  const propsRef = useRef(props);
  propsRef.current = props;
  const levelsRef = useRef<Effort[]>([]);
  /** Turn ids the backend did not list last time it was asked; see the watchdog below. */
  const missing = useRef<Set<string>>(new Set());
  /** Per-turn facts for the IdeaGraph outcome hook: set on send/start, consumed on done. */
  const turnMeta = useRef(new Map<string, { provider: string; model: string | null; prompt: string }>());

  const streaming = messages.some((message) => message.role === 'assistant' && message.status === 'streaming');
  // The latest turn's state for the host: its status and the step it is on (the newest unfinished
  // step, else the newest one). Reported only when one of those changes, not on every streamed word.
  const latest = [...messages].reverse().find((message): message is Assistant => message.role === 'assistant');
  const latestStep = latest ? ([...latest.steps].reverse().find((step) => !step.done) ?? latest.steps[latest.steps.length - 1]) : undefined;
  const activityKey = latest ? `${latest.turnId}|${latest.status}|${latestStep ? `${latestStep.verb} ${latestStep.title}`.trim() : ''}` : '';
  useEffect(() => {
    if (!props.onActivity) return;
    props.onActivity(latest ? { turnId: latest.turnId, status: latest.status, step: latestStep ? `${latestStep.verb} ${latestStep.title}`.trim() || null : null } : null);
  }, [activityKey]);
  const sendRef = useRef<(text: string, mode?: 'full' | 'quick') => void>(() => undefined);
  /** Turns that were themselves an automatic finishing round ('pending' marks the next one sent). */
  const autoFinished = useRef(new Set<string>());
  /** Auto (the default) runs a request to make a video as Full and a targeted change as Quick; remembered. */
  const [workflowChoice, setWorkflowChoice] = useState<WorkflowChoice>(savedWorkflowChoice);
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
        trace(event.turnId, { ev: 'turn_start', provider: event.providerLabel, providerId: event.providerId, model: event.model ?? null });
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
        trace(event.turnId, { ev: 'turn_end', outcome: event.stopped ? 'stopped' : event.fault ? 'fault' : 'done', fault: event.fault ? { kind: event.fault.kind, title: event.fault.title } : null, elapsedMs: event.elapsedMs ?? null, usage: event.usage ?? null, notes: event.notes ?? [], replyChars: event.reply?.length ?? 0 });
        // Every finished turn goes on the project's bill, a subagent's too (it has no chat message).
        if (event.usage) {
          const folder = (propsRef.current.getContext() as { projectFolder?: { path?: string } | null }).projectFolder?.path;
          const who = turnMeta.current.get(event.turnId)?.provider ?? `${propsRef.current.providerId ?? 'bhippi'} (subagent)`;
          recordTurn(projectKey(folder), who, event.usage.inputTokens, event.usage.outputTokens);
        }
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
            turnId: event.turnId,
            provider: meta.provider,
            model: meta.model,
            prompt: meta.prompt,
            elapsedMs: event.elapsedMs,
            stopped: event.stopped,
            faultKind: event.fault?.kind ?? null,
            verified: propsRef.current.workflowStatus(event.turnId)?.structurallyVerified ?? null,
            tools: runs.map((run) => ({ name: run.name, status: run.status, ms: run.ms, changedProject: run.changedProject ?? false })),
          });
          // An edit turn that changed the timeline but stopped short of the Judge and verify gets
          // one automatic finishing round (never a second: that one reports whatever it reached).
          const status = propsRef.current.workflowStatus(event.turnId);
          const edited = runs.some((run) => run.changedProject);
          // A follow-up edit of a finished production, or an edit with no production at all, is held
          // to the same finish; only the plan and gather phases end at the user's button.
          const editing = !status?.phase || status.phase === 'editing' || status.phase === 'polishing' || status.phase === 'done';
          if (!event.stopped && !event.fault && edited && status && status.mode === 'full' && !status.structurallyVerified
            && editing && !autoFinished.current.has(event.turnId)) {
            const asked = meta.prompt && !meta.prompt.startsWith('[Automatic finishing round') ? ` The user's request, which verify_edit_workflow's asks must cover: "${meta.prompt.slice(0, 800)}"` : '';
            const finish = `[Automatic finishing round: the last turn ended before verify_edit_workflow.] ${continuePrompt(status)}${asked}`;
            setTimeout(() => {
              autoFinished.current.add('pending');
              sendRef.current(finish);
            }, 400);
          }
        }
      }
    });
    return () => {
      void pending.then((unlisten) => unlisten());
    };
  }, [patch]);

  const send = async (text: string, hiddenExtra?: string, modeOverride?: 'full' | 'quick') => {
    const attachedImages=[...imagesRef.current];
    const attachedFiles=[...filesRef.current];
    // Annotations from the Program monitor go with the next message that starts a turn; mid-turn
    // they wait, since a steer is words only.
    const notes = propsRef.current.annotations && !streaming ? annotations.list() : [];
    const message = text.trim() || (attachedFiles.some((file) => file.kind !== 'image') ? 'Please look at the attached files.' : attachedImages.length ? 'Please inspect the attached images.' : notes.length ? (notes.length === 1 ? 'Please apply my annotation.' : `Please apply my ${notes.length} annotations.`) : '');
    if (!message) {
      if (streaming && propsRef.current.annotations && annotations.list().length) toast({ tone: 'info', title: 'Annotations are waiting', body: 'They go with your next message once this response finishes.' });
      return;
    }
    const mode = propsRef.current.lockedMode ?? modeOverride ?? routeWorkflow(workflowChoice, message, propsRef.current.productionActive?.() ?? false);
    const taken = notes.length ? annotations.take() : [];
    const brief = annotationBrief(taken);
    // Each annotation's frame, outlined, for models that can see — after the user's own images.
    const snapshots = seesImages(propsRef.current.providerId) ? taken.flatMap((item) => (item.snapshot ? [item.snapshot] : [])) : [];
    const sentImages = [...attachedImages, ...snapshots].slice(0, MAX_CHAT_IMAGES);
    if (streaming) {
      if(sentImages.length||attachedFiles.length){toast({tone:'info',title:'Attachments ready',body:'They go with your next message once this response finishes.'});return;}
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
      setDraft('');
      return;
    }
    const { providerId, getContext } = propsRef.current;
    // "@funny" typed into a message switches the style on. The host's context is a render behind
    // the state change, so this send carries the style itself.
    const tagged = styleInMessage(message);
    // "@KitName" tags a brand kit for this turn: it replaces the project's kit in what the model
    // reads, with what the kit has learned (lib/kitMention.ts).
    const taggedKit = kitsInMessage(message, propsRef.current.brandKits?.() ?? [])[0];
    const kitOverride = taggedKit ? { brandKit: brandKitContext(taggedKit), brandKitTagged: `The user tagged @${kitTag(taggedKit.name)}: follow the "${taggedKit.name}" brand kit (and what it has learned) for this turn, whatever the project's kit is.` } : {};
    if (tagged && tagged.id !== propsRef.current.editStyle) propsRef.current.onStyle(tagged.id);
    const providerModels=propsRef.current.providers.find(p=>p.id===providerId)?.models||[];
    const model=variantModel(providerModels,propsRef.current.model,propsRef.current.effort);
    const turnId = uid();
    if (autoFinished.current.delete('pending')) autoFinished.current.add(turnId);
    rememberTurnPrompt(turnId, message);
    // How much of the craft this model carries: a guided model gets the one-call build and
    // Bhippi's own media first, and compact tool results (modelProfile.ts, chat.rs).
    const profile = modelTier(providerId, model, propsRef.current.guidedMode);
    const guided = profile.tier === 'guided' && !propsRef.current.toolset;
    propsRef.current.onStartWorkflow(turnId, mode, guided ? 'guided' : 'full');
    const history = historyFor(messages, providerId, model);
    // Who the new model is relieving, read straight off the transcript — so a cleared chat has
    // nobody to hand over from and starts clean.
    const handoff = handoffFor(messages, providerId, model);
    const provider = propsRef.current.providers.find((item) => item.id === providerId);
    turnMeta.current.set(turnId, { provider: provider?.label ?? 'Bhippi', model, prompt: message });
    const extra = [hiddenExtra, brief, filesBrief(attachedFiles)].filter(Boolean).join('\n\n');
    const assistant: Assistant = {
      id: uid(), role: 'assistant', turnId, providerId: providerId ?? 'bhippi', providerLabel: provider?.label ?? 'Bhippi', model,
      content: '', thinking: '', steps: [], status: 'streaming', notes: [], fault: null, usage: null, elapsedMs: null, limit: null,
    };
    // Your message goes to the top of the panel and the answer grows beneath it (useChatScroll).
    scroll.anchorNext();
    setMessages((items) => [...items, { id: uid(), role: 'user', content: message, at: Date.now(), images: sentImages, ...(attachedFiles.length ? { files: attachedFiles.map((file) => ({ name: file.name, kind: file.kind })) } : {}), ...(taken.length ? { annotations: taken.map(sentAnnotation), annotationBrief: brief } : {}) }, assistant]);
    setDraft('');
    actionLogger.user(`Chat Prompt: "${message.length > 80 ? message.slice(0, 77) + '...' : message}"`, { turnId, provider: provider?.label ?? 'Bhippi', model, images: sentImages.length });
    try {
      // The backend clamps or drops a level the model does not honour, so sending the chosen one
      // is safe; an empty list means this provider has no such setting at all.
      const level = !modelVariants(providerModels,model).length && levelsRef.current.includes(propsRef.current.effort) ? propsRef.current.effort : null;
      const phase = propsRef.current.workflowStatus(turnId)?.phase;
      const toolset = propsRef.current.toolset ?? routeTools(message, messages.filter((m) => m.role === 'user').map((m) => m.content), tagged?.id ?? propsRef.current.editStyle, phase, guided);
      trace(turnId, { ev: 'turn_sent', harness: propsRef.current.harness ?? 'editor', providerId, model, effort: level, messageChars: message.length, images: sentImages.length, historyTurns: history.length, phase: phase ?? null, permission: propsRef.current.permission, editStyle: tagged?.id ?? propsRef.current.editStyle ?? null, genres: toolset.genres, toolsWhole: toolset.full.length, playbook: toolset.playbook?.id ?? null, tier: profile.tier });
      const standing = propsRef.current.instruction ?? workflowInstruction(propsRef.current.workflowStatus(turnId));
      await api.chatSend({ turnId, providerId, model, effort: level, message: extra ? `${message}\n\n${extra}` : message, images: sentImages, history, handoff, context: { ...(getContext() as object), ...(tagged ? { editStyle: tagged.id } : {}), ...kitOverride, toolset, permission: permissionBrief(propsRef.current.permission), editingWorkflow: mode, modelTier: profile.tier, workflowInstruction: guided ? `${GUIDED_BRIEF}\n\n${standing}` : standing }, ...(propsRef.current.persona ? { persona: propsRef.current.persona } : {}), ...(propsRef.current.harness ? { harness: propsRef.current.harness } : {}) });
      setImages([]);
      setFiles([]);
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
    scroll.reset();
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

  stopRef.current = () => stop('Stopped by you');
  props.apiRef.current = { clear, compose, focus: () => inputRef.current?.focus(), send: (text: string, options?: { mode?: 'full' | 'quick' }) => sendRef.current(text, options?.mode), load: loadTranscript, stop: () => stopRef.current() };
  sendRef.current = (text: string, mode?: 'full' | 'quick') => void send(text, undefined, mode);

  // The Program monitor's "Send to chat": whatever is in the composer goes, with the annotations.
  const pendingNotes = usePendingAnnotations();
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const annotationSendRef = useRef<() => void>(() => undefined);
  annotationSendRef.current = () => {
    if (runIfCommand(draftRef.current)) return;
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
    brandKits: (props.brandKits?.() ?? []).map((kit) => ({ id: kit.id, name: kit.name })),
    // Training is not a production: a quick edit, whatever the composer is set to.
    sendInstructed: (visible, hidden) => void send(visible, hidden, 'quick'),
    hasAttachments: imagesRef.current.length + filesRef.current.length > 0,
    compact,
    say,
    send: (text) => void send(text),
    undo: () => props.onUndo(),
    revertLastTurn: () => {
      if (lastTurn) void Promise.resolve(props.onRevert(lastTurn.turnId)).then((done) => { if (done) say('Put the project back to before those edits.'); });
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
      ...kitsMatching(query, props.brandKits?.() ?? []).map((kit) => ({ kind: 'kit' as const, kit })),
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
    } else if (found.kind === 'kit') {
      // A tag in the message: this turn follows that kit (see send).
      setDraft(`${draft.slice(0, mention.at)}@${kitTag(found.kit.name)} `);
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

  // What every message the user sent offers on hover — a plain message and one sent mid-turn alike.
  const steerActions: SteerActions = {
    edit: (text) => {
      setDraft(text);
      requestAnimationFrame(() => {
        const input = inputRef.current;
        if (!input) return;
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      });
    },
    send: (text) => void send(text),
    streaming,
  };

  return (
    <div ref={rootRef} className={`chat${streaming ? ' working' : ''}`} aria-label={props.label ?? 'Bhippi AI'}>

      <div className="chat-scroll-wrap">
      <div className="chat-list" ref={listRef} role="log" aria-label="Conversation">
        {messages.length === 0 && loaded && (
          // An empty chat: the mark, one question, and a few things to ask for.
          <div className="chat-empty">
            <div className="chat-empty-inner">
              <BhippiMark className="chat-empty-mark" size={52} />
              <p className="chat-empty-title">What are we making?</p>
              <p className="chat-empty-sub">Ask for an edit, a cut, captions or a whole video. Bhippi works on the timeline you have open.</p>
              <div className="chat-empty-chips">
                {EMPTY_PROMPTS.map((prompt) => (
                  <button key={prompt} type="button" className="chat-chip" onClick={() => compose(prompt)}>{prompt}</button>
                ))}
              </div>
            </div>
          </div>
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
                {!!message.files?.some((file) => file.kind !== 'image') && <div className="chat-files">{message.files.filter((file) => file.kind !== 'image').map((file, index) => <span key={index} className="chat-file">{file.kind === 'video' ? <Film size={12} /> : file.kind === 'audio' ? <Music size={12} /> : <FileIcon size={12} />}<b>{file.name}</b></span>)}</div>}
                {!!message.images?.length && <div className="chat-images">{message.images.map((src,index)=><img key={index} src={src} alt={"Attached image "+(index+1)} />)}</div>}
              </div>
              <div className="msg-actions">
                <button
                  type="button"
                  className="msg-action"
                  title="Edit — put this message back in the composer"
                  aria-label="Edit message"
                  onClick={() => steerActions.edit(message.content)}
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
              steerActions={steerActions}
              workflow={props.workflowStatus(message.turnId)}
              tools={props.tools[message.turnId] ?? []}
              canRevert={props.canRevert(message.turnId)}
              changes={props.changesFor?.(message.turnId) ?? []}
              onJump={props.onJumpToChange}
              highlighted={!!props.highlightedTurn && props.highlightedTurn === message.turnId}
              kits={props.brandKits?.() ?? []}
              onUpdateKit={props.onUpdateKit}
              onHighlight={props.onHighlightTurn ? (on) => props.onHighlightTurn?.(on ? message.turnId : null) : undefined}
              onRevert={() => {
                void Promise.resolve(props.onRevert(message.turnId)).then((done) => {
                  if (done) patch(message.turnId, (item) => ({ ...item, notes: [...item.notes, 'Edits reverted'] }));
                });
              }}
              onRemedy={(action) => remedy(message, action)}
              onContinue={() => void send(continuePrompt(props.workflowStatus(message.turnId)))}
              asking={!!props.ask && message.id === lastAnswerId}
            />
          ),
        )}
        {/* Room held open under the newest answer so your message can sit at the top (useChatScroll). */}
        <div className="chat-reserve" ref={reserveRef} aria-hidden="true" />
      </div>
      <button type="button" className={`chat-jump${scroll.away ? ' show' : ''}${streaming ? ' live' : ''}`} onClick={scroll.jump} tabIndex={scroll.away ? 0 : -1} aria-hidden={!scroll.away}>
        <i className="chat-jump-dot" />
        <span>Jump to latest</span>
        <ArrowDown size={13} />
      </button>
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


      {props.productionBar}

      <form
        ref={formRef}
        className={`composer${panelOpen ? ' with-panel' : ''}`}
        onSubmit={(event) => {
          event.preventDefault();
          if (runIfCommand(draft)) return;
          void send(draft);
        }}
      >
        {mention && (
          <div className="cmd-panel" role="listbox" aria-label="Choose an edit style or attach a reference">
            {mention.hits.map((item, index) => {
              const active = index === Math.min(commandRow, mention.hits.length - 1);
              // One heading per kind, at its first row; the rows keep one running index for the arrows.
              const heading = index === 0 || mention.hits[index - 1].kind !== item.kind ? (item.kind === 'style' ? 'Style' : item.kind === 'kit' ? 'Brand kit' : 'Reference') : null;
              return (
                <div key={item.kind === 'style' ? `style:${item.style.id}` : item.kind === 'kit' ? `kit:${item.kit.id}` : `ref:${item.ref.id}`} className="cmd-section">
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
                    ) : item.kind === 'kit' ? (
                      <>
                        <span className="cmd-name">@{kitTag(item.kit.name)}</span>
                        <span className="cmd-summary">brand kit for this message{item.kit.learnings?.length ? ` · learned ${item.kit.learnings.length} things` : ''}</span>
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
        {messages.some(message=>message.role==='user'&&message.images?.length)&&<small>Images in this conversation may be sent again to {active?.label||'the selected provider'} as context.</small>}
        {images.length>0&&<><div className="chat-images">{images.map((src,index)=><div key={index}><img src={src} alt={'Image '+(index+1)}/><button type="button" aria-label={'Remove image '+(index+1)} onClick={()=>setImages(current=>current.filter((_,i)=>i!==index))}>×</button></div>)}</div><small>Sending shares these images with {active?.label||'the selected provider'}. Choose a vision-capable model.</small></>}
        {files.some(file=>file.kind!=='image')&&<div className="chat-files">{files.map((file,index)=>file.kind==='image'?null:<span key={index} className="chat-file" title={file.path}>{file.kind==='video'?<Film size={12}/>:file.kind==='audio'?<Music size={12}/>:<FileIcon size={12}/>}<b>{file.name}</b>{file.duration?<em>{file.duration.toFixed(1)} s</em>:null}{file.assetId?<em>in the project</em>:null}<button type="button" aria-label={'Remove '+file.name} onClick={()=>setFiles(current=>current.filter((_,i)=>i!==index))}>×</button></span>)}</div>}
        {(() => {
          // After a turn was stopped — by the user, or by switching model mid-answer — one click
          // hands the job on: the model now chosen reads what was done (handoff.ts) and carries on.
          const last = messages[messages.length - 1];
          if (streaming || !last || last.role !== 'assistant' || last.status !== 'stopped' || draft.trim()) return null;
          const to = active?.label ?? 'this model';
          return (
            <div className="composer-continue">
              <button type="button" className="btn btn-small" onClick={() => void send('Carry on with the task from where the last turn stopped. The work already done is listed above; do not redo it.')}
                title={`Send the job to ${to}${props.model ? ` · ${props.model}` : ''} to finish, with everything done so far`}>
                Continue with {to}
              </button>
            </div>
          );
        })()}
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
              void send(draft);
            }
            if (event.key === 'Escape') (event.target as HTMLTextAreaElement).blur();
          }}
          placeholder={streaming ? 'Add to what Bhippi is doing — it reads this at its next step…' : props.placeholder ?? (active?.kind === 'builtin' ? 'Try: add title "My Story" at 1s' : 'Ask for an edit or an idea…')}
          rows={2}
          aria-label="Message Bhippi AI"
        />
        <div className="composer-bar"><button type="button" className="icon-btn" aria-label="Attach files" title="Attach pictures, video or audio — or drop them here" onClick={()=>void pickFiles()}><Paperclip size={15}/></button>
          <ModelPicker
            providers={props.providers.filter((provider) => provider.usable && provider.enabled)}
            providerId={props.providerId}
            model={props.model}
            onSelect={chooseModel}
            onManage={props.onManageProviders}
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            // The picker's field had the keyboard and is gone once it closes: without this, what the
            // user types next reached the editor's shortcuts instead of the message box.
            onDone={() => window.setTimeout(() => inputRef.current?.focus(), 0)}
          />
          <div className="composer-options">{(levels.length > 0 || speeds.length > 1) && (
            <ThinkingSlider
              effort={props.effort}
              levels={levels}
              onSelect={props.onEffort}
              speeds={speeds}
              speedAt={speedIndex(speeds, props.model)}
              sends={props.model ? variantModel(active?.models ?? [], props.model, props.effort) : null}
              onSpeed={(next) => props.providerId && chooseModel(props.providerId, next)}
            />
          )}
          {!props.lockedMode && <select className="composer-select" aria-label="Editing workflow" title="Auto: asking for a video to be made runs the full workflow (analysis, storyboard, review); a targeted change runs as a quick edit. Full always runs the whole workflow; Quick never does." value={workflowChoice} onChange={(e) => { const next = e.target.value as WorkflowChoice; setWorkflowChoice(next); saveWorkflowChoice(next); }} disabled={streaming}>
            <option value="auto">Auto workflow</option><option value="full">Full workflow</option><option value="quick">Quick edit</option>
          </select>}
          <PermissionMenu mode={props.permission} onSelect={props.onPermission} />
          </div>
          {streaming ? (
            <>
              {/* Typed while it works: this goes into the running turn rather than waiting for it. */}
              {draft.trim() && <button type="submit" className="send-btn" title="Add to the running task (Enter)"><ArrowUp size={16} /></button>}
              <button type="button" className="send-btn stop" onClick={() => stop()} title="Stop" aria-label="Stop Bhippi"><StopGlyph /></button>
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

/** What an empty chat offers to start with; a tap puts it in the composer to edit or send. */
const EMPTY_PROMPTS = ['Cut the dead air', 'Add bold captions', 'Make a 9:16 short from the best 30 seconds'];

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
  return `Continue the EDIT/POLISH phase only. ${shared} Work just the next unfinished 5–12s batch — cuts, levels, beats, transitions, roto/erase, motion graphics, sound — run judge_edit (it runs the frame pass and scores the cut; fix its list and judge again until it passes or its rounds run out), then get_comp + verify_edit_workflow. Do not redo batches already on the timeline.`;
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

function AssistantMessage({ message, latest, workflow, tools, canRevert, onRevert, onRemedy, onContinue, onDropSteer, steerActions, changes: changesProp = [], onJump, highlighted = false, onHighlight, kits = [], onUpdateKit, asking = false }: { message: Assistant; latest: boolean; asking?: boolean; workflow: WorkflowView; tools: ToolRun[]; canRevert: boolean; onRevert: () => void; changes?: TurnChange[]; onJump?: (change: TurnChange) => void; highlighted?: boolean; onHighlight?: (on: boolean) => void; kits?: TrainedKit[]; onUpdateKit?: (kitId: string, change: (kit: TrainedKit) => TrainedKit) => void; onRemedy: (remedy: TurnFault['remedy']) => void; onContinue?: () => void; onDropSteer: (id: string) => void; steerActions?: SteerActions }) {
  const visible = message.content;
  const seconds = message.elapsedMs !== null ? `${(message.elapsedMs / 1000).toFixed(1)}s` : null;
  const streaming = message.status === 'streaming';
  // Every answer is Bhippi's; which provider wrote it stays out of the header.
  const changes = tools.filter((run) => run.status === 'done' && run.changedProject).length;
  const timelineChanges = changes > 0 ? changesProp : [];
  const line = streaming ? null : workflowLine(workflow, tools.length > 0);
  const meta = [message.model, seconds].filter(Boolean).join(' · ');
  const working = tools.some((run) => run.status === 'running') || message.steps.some((step) => !step.done);
  const thinkingLive = streaming && !visible && !working;
  // The mark plays "done" only for a turn seen finishing here, not for every answer a reload brings back.
  const wasStreaming = useRef(streaming);
  const [finishedHere, setFinishedHere] = useState(false);
  useEffect(() => {
    if (wasStreaming.current && message.status === 'done') setFinishedHere(true);
    wasStreaming.current = streaming;
  }, [message.status, streaming]);
  const mark: MarkState = message.status === 'stopped' || message.status === 'error' ? 'stopped'
    : asking ? 'waiting'
    : streaming ? (working ? 'editing' : visible ? 'idle' : 'thinking')
    : finishedHere ? 'done' : 'idle';
  return (
    <div className={`msg msg-assistant status-${message.status}${latest ? ' latest' : ''}`}>
      <div className="msg-meta">
        <span className="msg-avatar bhippi"><BhippiMark state={mark} size={20} /></span>
        <span className="msg-who">Bhippi</span>
        {message.status === 'stopped' && <span className="msg-flag">Stopped</span>}
      </div>
      {message.thinking && <ThinkingRow text={message.thinking} live={thinkingLive} />}
      <AnswerBody
        content={visible}
        segments={message.segments}
        steps={message.steps}
        runs={tools}
        steers={message.steers}
        streaming={streaming}
        thinking={!!message.thinking}
        onDropSteer={onDropSteer}
        steerActions={steerActions}
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
            <StatusDot state="done" size={14} />
            <span>{changes} change{changes === 1 ? '' : 's'} on the timeline</span>
            {canRevert && <button type="button" className="edits-undo" onClick={onRevert} title="Put the project back to before this answer's edits"><RotateCcw size={12} /> Undo turn</button>}
          </div>
          {timelineChanges.length > 0 && (
            <details className="edits-list">
              <summary>
                On the timeline: {changeSummary(timelineChanges)}
                {onHighlight && (
                  <button type="button" className="edits-show" onClick={(event) => { event.preventDefault(); onHighlight(!highlighted); }} title={highlighted ? 'Stop tinting these clips on the timeline' : 'Tint these clips on the timeline'}>
                    {highlighted ? 'Hide on timeline' : 'Show on timeline'}
                  </button>
                )}
              </summary>
              <ul>
                {timelineChanges.slice(0, 40).map((change) => (
                  <li key={`${change.compId}-${change.clipId}`}>
                    <button type="button" className={`edits-item ${change.kind}`} disabled={!onJump} onClick={() => onJump?.(change)} title={change.kind === 'removed' ? 'Go to where it was' : 'Go to it and select it'}>
                      <span className="edits-kind">{change.kind}</span>
                      <span className="edits-name">{change.name}</span>
                      <span className="edits-at">{clock(change.start)}</span>
                    </button>
                  </li>
                ))}
                {timelineChanges.length > 40 && <li className="edits-more">…and {timelineChanges.length - 40} more</li>}
              </ul>
            </details>
          )}
        </div>
      )}
      {onUpdateKit && tools.filter((run) => run.training).map((run) => (
        <TrainingCard key={run.callId} kit={kits.find((kit) => kit.id === run.training!.kitId)} sourceId={run.training!.sourceId} onChange={onUpdateKit} />
      ))}
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

/**
 * The model's reasoning, as one row. While it thinks the row shimmers, counts the seconds, and
 * shows its last few lines scrolling past; a second after it stops it folds to "Thought for 5s",
 * one click away. A reloaded answer has no clock to go by, so it just says "Thought process".
 */
function ThinkingRow({ text, live }: { text: string; live: boolean }) {
  const [started] = useState(() => Date.now());
  const [now, setNow] = useState(started);
  const [took, setTook] = useState<number | null>(null);
  const [chosen, setChosen] = useState<boolean | null>(null);
  const [lingering, setLingering] = useState(live);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [live]);
  useEffect(() => {
    if (live) {
      setLingering(true);
      return;
    }
    if (lingering) setTook(Math.max(1, Math.round((Date.now() - started) / 1000)));
    const handle = window.setTimeout(() => setLingering(false), 1000);
    return () => window.clearTimeout(handle);
  }, [live]);
  // While it streams, the window keeps its newest line in view.
  useEffect(() => {
    if (live && body.current) body.current.scrollTop = body.current.scrollHeight;
  }, [text, live]);
  const open = chosen ?? lingering;
  const seconds = Math.max(1, Math.round((now - started) / 1000));
  return (
    <div className={`think${open ? ' open' : ''}${live ? ' live' : ''}`}>
      <button type="button" className="think-btn" onClick={() => setChosen(!open)} aria-expanded={open}>
        <span className={live ? 'ai-shimmer' : undefined}>{live ? 'Thinking' : took ? `Thought for ${took}s` : 'Thought process'}</span>
        {live && <span className="think-time">· {seconds}s</span>}
        <ChevronRight size={12} className={`think-chevron${open ? ' rotate-90' : ''}`} />
      </button>
      <div className="think-fold" aria-hidden={!open}>
        <div>
          <div className="think-body" ref={body}>{text}</div>
        </div>
      </div>
    </div>
  );
}
