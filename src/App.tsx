// The editor shell: the Premiere workspace, its menus and keymap, the context menus, the dialogs,
// project files, and the bridge between Helios AI's tool calls and the project.
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { pictureDir } from '@tauri-apps/api/path';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { CircleCheck, Film, LoaderCircle, Mic, TriangleAlert, Upload, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { EditWorkflow } from './lib/editWorkflow';
import { automaticRotoEngine } from './lib/rotoEngine';
import { flushSync } from 'react-dom';
import { RENDERED_EFFECTS } from './lib/effectSupport';
import { LearningWorkspace } from './panels/LearningWorkspace';
import { ChatPanel, type ChatApi, type ToolRun } from './chat/ChatPanel';
import { StoryboardViewer } from './chat/StoryboardViewer';
import { HeaderBar, MenuBar, type MenuGroup, type Mode } from './components/AppChrome';
import { ResourceMonitor } from './components/ResourceMonitor';
import { ProviderLogo } from './components/ProviderLogo';
import { useToast } from './components/ui';
import { MenuList, Panel, Splitter, type MenuItem } from './components/workspace';
import { CompAudio } from './editor/Compositor';
import { ProgramMonitor, type ProgramApi } from './editor/ProgramMonitor';
import { SourceMonitor, type SourceApi, type SourceRange } from './editor/SourceMonitor';
import { DEFAULT_DISPLAY, dropClips, LABELS, Timeline, type DisplaySettings, type IncomingDrag, type TimelineApi } from './editor/Timeline';
import { AudioMeters, DEFAULT_METERS, ToolsPanel, TOOL_LABEL } from './editor/ToolsAndMeters';
import { aiContext, runTool, TOOL_SPECS } from './lib/aiTools';
import { recordTurnOutcome, type TurnOutcome } from './lib/ideagraph';
import { applyTheme, resolveTheme } from './lib/theme';
import { allowTool, DEFAULT_EFFORT, DEFAULT_PERMISSION, type Effort, type PermissionMode } from './lib/permissions';
import { rotoscope } from './lib/roto';
import type { AgentRun, Connection } from './chat/ChatStatusBar';
import { setMutes, type MuteState } from './lib/audio';
import type { CaptionStyle } from './lib/captionStyles';
import { capitalize, clamp, DEFAULT_EFFECTS, DEFAULT_TRANSFORM, parseCaptions, safeFileName, STILL_DEFAULT, timecode, uid } from './lib/editor';
import { useHistory } from './lib/history';
import { api, errorText, events, type McpStatus } from './lib/ipc';
import { playhead, usePlaying } from './lib/playhead';
import { makeStickFigure } from './lib/stickFigure';
import { StickFigureDialog } from './components/StickFigureDialog';
import { generateSelectionSound } from './lib/generateSound';
import { registerSfx } from './lib/sfx';
import {
  addFrameHold, addTracks, addTransition, clipEnd, clipsForSource, compDuration, deleteTracks, editPoints, emptyTracks, freeTrack, healProject, insertFrameHold, ITEM_LABEL, loadProject, moveClips, nestClips,
  newClip, newComp, newItem, newProject, nextPoint, pasteAttributes, placeClips, razor, removeAttributes, removeClips, removeRange, replaceSource, setGrouped, setLinked, setSpeed, sourceInfo,
  sourceLimit, sourceOut, sourceTimeAt, synchronize, textSource, toggleMarker, trackIndex, trackLabel, tracksOf, transitionsOnSelection, trimEdge, updateComp, updateTrack, withLinked, wouldCycle,
  type AssetMap,
} from './lib/timeline';
import type { AppInfo, Asset, Clip, Comp, ExportOptions, HeliosDocument, ItemKind, Job, PanelId, Project, ProviderInfo, Settings, Tool, WorkspaceLayout } from './lib/types';
import { ProjectPanel, type DragPayload, type EffectPreset, type ProjectTab } from './panels/ProjectPanel';
import { PropertiesPanel } from './panels/PropertiesPanel';
import { EffectControlsPanel } from './panels/EffectControlsPanel';
import { createAppliedEffect } from './lib/effectFilters';
import { ALL_EFFECTS, type EffectDefinition } from './lib/effectsCatalog';
import {
  AttributesDialog, AudioGainDialog, ChannelsDialog, ClipInfoDialog, CompDialog, ConfirmDialog, FieldOptionsDialog, FrameHoldDialog, ItemDialog, MarkerDialog, ProjectSettingsDialog, RenameDialog, SceneDetectionDialog,
  ShortcutsDialog, SpeedDialog, SynchronizeDialog, type CompDraft, type ItemDraft, type ProjectSettingsResult,
} from './settings/Dialogs';
import { ExportDialog } from './settings/ExportDialog';
import { HomeScreen } from './settings/HomeScreen';
import { SettingsModal, type SettingsTab } from './settings/SettingsModal';
import { SHORTCUTS } from './lib/shortcuts';
import { FXConsoleModal } from './components/FXConsoleModal';
import { loadFxSettings, loadFxSnapshots, saveFxSnapshots } from './lib/fxConsole';
import { getLiveMousePos } from './lib/mouseTracker';
import type { FxSnapshot } from './lib/types';

/**
 * How narrow each panel may be dragged.
 *
 * These are the same numbers the stylesheet uses, and they have to be: a splitter that allows a
 * width the CSS then refuses leaves the panel rendering wider than the layout believes, and its
 * contents spill over the panel beside it. The chat's floor is set by its composer row — model,
 * thinking, permission and send, side by side without wrapping.
 */
const PANEL_MIN = { chat: 436, source: 260, properties: 260, project: 260, top: 220 } as const;

const DEFAULT_LAYOUT: WorkspaceLayout = { chatWidth: 448, topHeight: 460, sourceWidth: 460, propertiesWidth: 330, projectWidth: 340, hidden: [], meters: DEFAULT_METERS };
const EMPTY_SETTINGS: Settings = {
  disabledProviders: [], providerId: null, model: null, effort: null, permission: null, awesomeLook: false, ffmpegPath: null, chatOpen: true, timelineHeight: null, timelineZoom: null,
  export: { resolution: null, fps: null, quality: null, folder: null }, layout: null, recentProjects: [], projectPath: null, theme: null,
  ideagraphBin: null, ideagraphBrain: null, ideagraphRecord: null,
  speech: { transcribeEngine: null, transcribeModel: null, whisperPath: null, piperPath: null, voice: null, hindiVoice: null, voiceMode: null, speed: null },
};

/** When the saved choice is unusable, prefer agents the user is signed in to, then local, then cloud. */
const PREFERENCE = ['claude', 'codex', 'gemini', 'ollama', 'lmstudio', 'anthropic', 'openai', 'google', 'openrouter', 'groq', 'xai', 'deepseek', 'mistral', 'moonshot', 'opencode', 'grok', 'antigravity', 'helios'];

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || (target.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes((target as HTMLInputElement).type)));

type Clipboard = { clips: Clip[]; comp: string } | null;
type ContextMenu = { anchor: DOMRect; items: MenuItem[] } | null;

/**
 * A one-line reading of a tool call's arguments, for the activity list.
 *
 * It is what the call was *asked* for, shown while it runs and before there is any result — three
 * fields is enough to tell two calls apart without turning the chat into a JSON dump.
 */
function describeArgs(args: Record<string, unknown>): string {
  return Object.entries(args)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .slice(0, 3)
    .map(([name, value]) => {
      if (Array.isArray(value)) return `${name}: ${value.length}`;
      if (typeof value === 'object') return name;
      const text = String(value);
      return `${name}: ${text.length > 44 ? `${text.slice(0, 44)}…` : text}`;
    })
    .join(' · ');
}

export default function App() {
  const toast = useToast();
  const history = useHistory(newProject());
  const { project } = history;
  const [learningOpen, setLearningOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [savedProject, setSavedProject] = useState<Project | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [settings, setSettings] = useState<Settings>(EMPTY_SETTINGS);
  const permission = (settings.permission as PermissionMode | null) ?? DEFAULT_PERMISSION;
  const effort = (settings.effort as Effort | null) ?? DEFAULT_EFFORT;
  // Purely a look: remembered with the other chat choices so it survives a restart.
  const awesome = settings.awesomeLook ?? false;
  const isPlaying = usePlaying();
  // The tool-call listener is registered once, so it reads the current mode through a ref.
  // What the chat can reach. Helios' own tools are always there; MCP servers join as they connect.
  const [mcpServers, setMcpServers] = useState<McpStatus[]>([]);
  const refreshConnections = useCallback(() => {
    void api.mcpServers().then(setMcpServers).catch(() => setMcpServers([]));
  }, []);
  useEffect(() => refreshConnections(), [refreshConnections]);
  const connections: Connection[] = [
    { id: 'helios', label: 'Helios project tools', kind: 'builtin', state: 'ready', detail: 'built in', tools: TOOL_SPECS.length },
    ...mcpServers.map((server) => ({
      id: server.id,
      label: server.label,
      kind: 'mcp' as const,
      state: server.state,
      detail: server.detail,
      tools: server.tools.length,
    })),
  ];

  // Agents the chat has started. They live here so the map survives switching panels.
  const [agents, setAgents] = useState<AgentRun[]>([]);
  const stopAgent = (id: string) => {
    void api.chatStop(id).catch(() => undefined);
    setAgents((current) => current.map((agent) => (agent.id === id ? { ...agent, state: 'failed', summary: 'Stopped' } : agent)));
  };

  // A question the assistant is waiting on, rendered as a card in the chat.
  // A queue, not a slot: a turn can ask several things, and each tool call is waiting on its own
  // answer. Keeping only the newest would strand the others and lose the answers already given.
  // The reference edits follow. Its guideline is added to the context every turn, so the model is
  // working from the same reading of the film the editor is.
  const [referenceId, setReferenceId] = useState<string | null>(null);
  const [referenceBrief, setReferenceBrief] = useState<string | null>(null);
  useEffect(() => {
    if (!referenceId) return setReferenceBrief(null);
    let alive = true;
    void api.refsBrief(referenceId).then((brief) => alive && setReferenceBrief(brief)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [referenceId]);

  const [pendingAsks, setPendingAsks] = useState<{ question: string; options: string[]; context: string | null; answer: (value: string) => void }[]>([]);
  const permissionRef = useRef<PermissionMode>(permission);
  permissionRef.current = permission;
  const [assets, setAssets] = useState<Asset[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [jobs, setJobs] = useState<Record<string, Job>>({});
  const [selection, setSelection] = useState<string[]>([]);
  const [transitionSelection, setTransitionSelection] = useState<string | null>(null);
  const [binSelection, setBinSelection] = useState<string[]>([]);
  const [binFolder, setBinFolder] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('edit');
  const [tool, setTool] = useState<Tool>('select');
  const [snapping, setSnapping] = useState(true);
  const [linkedSelection, setLinkedSelection] = useState(true);
  const [nestComps, setNestComps] = useState(true);
  const [display, setDisplay] = useState<DisplaySettings>(DEFAULT_DISPLAY);
  const [zoom, setZoom] = useState(60);
  const [mutes, setMuteState] = useState<MuteState>({ all: false, program: false, source: false });
  const [focused, setFocused] = useState<PanelId>('timeline');
  const [maximized, setMaximized] = useState<PanelId | null>(null);
  const [layout, setLayout] = useState<WorkspaceLayout>(DEFAULT_LAYOUT);
  const [projectTab, setProjectTab] = useState<ProjectTab>('project');
  const [chatTab, setChatTab] = useState<'chat' | 'providers'>('chat');
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [sourceRanges, setSourceRanges] = useState<Record<string, SourceRange>>({});
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null);
  const [inspectorTab, setInspectorTab] = useState<'properties' | 'effects'>('properties');
  const [exportOpen, setExportOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [fxConsoleOpen, setFxConsoleOpen] = useState(false);
  const [fxConsoleAnchor, setFxConsoleAnchor] = useState<{ x: number; y: number } | null>(null);
  const lastMousePos = useRef<{ x: number; y: number }>({ x: 400, y: 250 });
  const [menu, setMenu] = useState<ContextMenu>(null);
  const [dialog, setDialog] = useState<ReactNode>(null);
  const [incoming, setIncoming] = useState<IncomingDrag | null>(null);
  const [dragLabel, setDragLabel] = useState<string | null>(null);
  const [fileHover, setFileHover] = useState(false);
  const [toolRuns, setToolRuns] = useState<Record<string, ToolRun[]>>({});
  const [recordingTrack, setRecordingTrack] = useState<string | null>(null);
  const clipboard = useRef<Clipboard>(null);
  const timelineApi = useRef<TimelineApi | null>(null);
  const programApi = useRef<ProgramApi | null>(null);
  const sourceApi = useRef<SourceApi | null>(null);
  const chatApi = useRef<ChatApi | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const layoutStart = useRef(layout);
  const turnSnapshots = useRef(new Map<string, Project>());
  const editWorkflows = useRef(new Map<string, EditWorkflow>());
  const renderOriginals = useRef(new Map<string, Clip['source']>());
  const recorder = useRef<{ stop: () => void } | null>(null);
  const stageRefProxy = useMemo(() => ({ get current() { return programApi.current?.getStage() ?? null; } }), []);

  const assetMap: AssetMap = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);
  const offline = useMemo(() => new Set(project.media.filter((ref) => ref.offline).map((ref) => ref.assetId)), [project.media]);
  const comp = useMemo(() => project.comps.find((item) => item.id === project.activeCompId) ?? project.comps[0], [project]);
  const sourceAsset = sourceId ? assetMap.get(sourceId) : undefined;
  const dirty = !!savedProject && savedProject !== project;
  const selectedClips = useMemo(() => (comp ? comp.clips.filter((clip) => selection.includes(clip.id)) : []), [comp, selection]);
  const fps = comp?.fps ?? 30;
  const frame = 1 / fps;

  // ── boot ───────────────────────────────────────────────────────────────
  const refreshAssets = useCallback(() => api.libraryList().then(setAssets).catch(() => undefined), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [appInfo, stored, library, loadedProject, jobList, startup] = await Promise.all([api.appInfo(), api.settingsGet(), api.libraryList(), api.projectLoad(), api.jobsList(), api.startupFile()]);
      if (cancelled) return;
      setInfo(appInfo);
      registerSfx(appInfo.sfx);
      setSettings({ ...EMPTY_SETTINGS, ...stored, export: { ...EMPTY_SETTINGS.export, ...stored.export } });
      // A layout saved before these floors existed is raised to them rather than left overlapping.
      if (stored.layout) {
        const saved = { ...DEFAULT_LAYOUT, ...stored.layout, meters: { ...DEFAULT_METERS, ...(stored.layout.meters ?? {}) } };
        setLayout({
          ...saved,
          chatWidth: Math.max(PANEL_MIN.chat, saved.chatWidth),
          sourceWidth: Math.max(PANEL_MIN.source, saved.sourceWidth),
          propertiesWidth: Math.max(PANEL_MIN.properties, saved.propertiesWidth),
          projectWidth: Math.max(PANEL_MIN.project, saved.projectWidth),
          topHeight: Math.max(PANEL_MIN.top, saved.topHeight),
        });
      }
      if (stored.timelineZoom) setZoom(stored.timelineZoom);
      setAssets(library);
      const map = new Map(library.map((asset) => [asset.id, asset]));
      const opened = loadProject(loadedProject, map);
      history.reset(opened);
      setSavedProject(opened);
      setJobs(Object.fromEntries(jobList.map((job) => [job.id, job])));
      setLoaded(true);
      api.providersList().then(setProviders).catch(() => undefined);
      if (startup) void openProjectFile(startup);
    })().catch((error) => toast({ tone: 'error', title: 'Helios could not load your project', body: errorText(error) }));
    return () => {
      cancelled = true;
    };
    // Boot runs once.
  }, []);

  useEffect(() => setMutes(mutes), [mutes]);

  useEffect(() => {
    const subscriptions = [
      events.library(() => void refreshAssets()),
      events.providers(setProviders),
      events.tools((ffmpeg) => setInfo((current) => (current ? { ...current, ffmpeg } : current))),
      events.openFile((path) => void openProjectFile(path)),
      events.job((job) => {
        setJobs((current) => ({ ...current, [job.id]: job }));
        if (job.kind === 'export' && job.status === 'done' && job.result?.path) {
          const path = job.result.path;
          toast({ tone: 'success', title: 'Export complete', body: path.split(/[\\/]/).pop(), actions: [{ label: 'Open', run: () => void api.openPath(path) }, { label: 'Show in folder', run: () => void api.revealPath(path) }] });
        } else if (job.kind === 'export' && job.status === 'error') {
          toast({ tone: 'error', title: 'Export failed', body: job.message.slice(0, 400) });
        } else if (job.kind === 'install' && job.status !== 'running') {
          toast({ tone: job.status === 'done' ? 'success' : 'error', title: job.status === 'done' ? job.label.replace('Installing', 'Installed') : `${job.label} failed`, body: job.message.slice(0, 300) });
        }
      }),
    ];
    return () => subscriptions.forEach((pending) => void pending.then((unlisten) => unlisten()));
  }, [refreshAssets, toast]);

  // ── AI tool calls ──────────────────────────────────────────────────────
  const toolHost = useMemo(() => ({
    history,
    assets: () => assetMap,
    selection: () => selection,
    setSelection,
    ask: (question: { question: string; options: string[]; context: string | null }) =>
      new Promise<string>((resolve) => {
        // The turn is waiting on this, so the card stays until it is answered or skipped.
        setPendingAsks((current) => [...current, { ...question, answer: resolve }]);
      }),
    importMedia: async (paths: string[], targetFolderId?: string | null) => {
      const result = await api.libraryImport(paths);
      await refreshAssets();
      const all = [...result.imported, ...result.existing];
      if (all.length) {
        history.commit((current) => ({
          ...current,
          media: [
            ...current.media.map((ref) =>
              targetFolderId && all.some((a) => a.id === ref.assetId) ? { ...ref, folderId: targetFolderId } : ref,
            ),
            ...all
              .filter((asset) => !current.media.some((ref) => ref.assetId === asset.id))
              .map((asset) => ({ assetId: asset.id, folderId: targetFolderId ?? null, offline: false })),
          ],
        }), 'Import');
      }
      return all;
    },
    speak: async (text: string, voice: string | null, mode: string, name?: string) => {
      const asset = await api.speechGenerate(text, voice, mode, name);
      await refreshAssets();
      history.commit(
        (current) => (current.media.some((ref) => ref.assetId === asset.id)
          ? current
          : { ...current, media: [...current.media, { assetId: asset.id, folderId: null, offline: false }] }),
        'Voice-over',
      );
      return asset;
    },
    setReference: (id: string | null) => setReferenceId(id),
  }), [history, assetMap, selection, refreshAssets]);
  /**
   * Separates the subject of the selected clip from its background, and remembers it against the
   * asset. The model must be explicitly downloaded in Model Center; the matte and subject track are cached,
   * so a second clip of the same file is instant.
   */
  const rotoAbort = useRef<AbortController|null>(null);
  useEffect(()=>()=>rotoAbort.current?.abort(),[]);
  const [rotoBusy, setRotoBusy] = useState(false);
  const [rotoProgress, setRotoProgress] = useState<string | null>(null);
  const autoRoto = useCallback(async () => {
    if(rotoAbort.current){rotoAbort.current.abort();setRotoProgress('Stopping after the current frame…');return;}
    const project = history.current();
    const comp = project.comps.find((item) => item.id === project.activeCompId) ?? project.comps[0];
    const clip = comp?.clips.find((item) => selection.includes(item.id) && item.source.type === 'media');
    if (!clip || clip.source.type !== 'media') {
      toast({ tone: 'info', title: 'Select a clip first', body: 'Pick a video clip in the timeline, then roto it.' });
      return;
    }
    const asset = assetMap.get(clip.source.assetId);
    if (!asset) return;

    if (asset.kind !== 'video' || comp.tracks.find(track => track.id === clip.trackId)?.locked) {
      toast({ tone: 'info', title: 'Choose an unlocked video clip' }); return;
    }
    if (clip.reverse || clip.hold !== null || clip.speed !== 1) {
      toast({ tone: 'info', title: 'Run Roto at normal speed first', body: 'Choose a forward clip without a frame hold for this pass.' }); return;
    }

    const engine = automaticRotoEngine(settings.localRotoEngine, clip.rotoCorrections ?? [], comp.fps);
    const model = engine === 'rvm' ? await api.matteModel().catch(() => null) : { id: 'sam2.1-vitmatte-experimental', path: '' };
    if (!model) {
      setSettingsTab('speech');
      toast({tone:'info',title:'Choose a matting model',body:'Download Robust Video Matting in Model Center, then run Auto Roto again. No model was downloaded automatically.'});
      return;
    }
    if(rotoAbort.current)return;
    const abort=new AbortController();rotoAbort.current=abort;

    setRotoBusy(true);
      toast({ tone: 'info', title: `Separating ${asset.name}`, body: engine === 'rvm' ? 'Running automatic person Roto. For a selected object with SAM, add a foreground point on the first frame and run again.' : 'Tracking your selected subject with SAM and refining its edges. The tool button stays lit while it works.' });
    try {
      const result = await rotoscope(
        asset.id,
        { from: clip.in, seconds: clip.duration * clip.speed, fps: (asset.fps && Number.isFinite(asset.fps) && asset.fps > 0 ? asset.fps : comp?.fps ?? 25), modelPath: model.path, model: model.id, signal: abort.signal, engine, points: clip.rotoCorrections ?? [] },
        (progress) => setRotoProgress(progress.total > 1 ? `${progress.stage} — ${progress.done} of ${progress.total}` : progress.stage),
      );
      if (abort.signal.aborted) throw new Error('Roto cancelled; the cached result was not applied.');
      const live = history.current().comps.find(entry => entry.id === comp.id)?.clips.find(item => item.id === clip.id);
      if (!live || live.in !== clip.in || live.duration !== clip.duration || live.speed !== clip.speed || live.reverse !== clip.reverse || JSON.stringify(live.source) !== JSON.stringify(clip.source)) throw new Error('The clip changed during Roto. The cached matte was kept, but was not attached to the changed clip.');
      if (result.matte) {
        history.commit(
          (current) => ({
            ...current,
            comps: current.comps.map((entry) => entry.id !== comp.id ? entry : {
              ...entry,
              clips: entry.clips.map((item) => item.id === clip.id && item.in === clip.in && item.duration === clip.duration && item.speed === clip.speed && item.reverse === clip.reverse && JSON.stringify(item.source) === JSON.stringify(clip.source) ? { ...item, rotoMatte: result.matte } : item),
            }),
          }),
          'Apply Roto Matte',
        );
      }
      toast({
        tone: 'success',
        title: `${asset.name} separated`,
        body: `${result.frames} frames. The matte is now applied to the selected layer and cached locally.`,
      });
    } catch (error) {
      toast({ tone: abort.signal.aborted?'info':'error', title: abort.signal.aborted?'Roto cancelled':'Could not separate the subject', body: errorText(error) });
    } finally {
      rotoAbort.current=null;
      setRotoBusy(false);
      setRotoProgress(null);
    }
  }, [assetMap, history, selection, toast, settings.localRotoEngine]);

  const hostRef = useRef(toolHost);
  hostRef.current = toolHost;
  const toolAborts = useRef(new Map<string, { turnId: string; controller: AbortController }>());
  useEffect(() => {
    const pending = events.chat(event => {
      if (event.event === 'done') for (const entry of toolAborts.current.values()) if (entry.turnId === event.turnId) entry.controller.abort();
    });
    return () => { void pending.then(unlisten => unlisten()); for (const entry of toolAborts.current.values()) entry.controller.abort(); };
  }, []);

  useEffect(() => {
    const pending = events.toolCall(async (call) => {
      const controller = new AbortController();
      toolAborts.current.set(call.callId, { turnId: call.turnId, controller });
      if (!turnSnapshots.current.has(call.turnId)) turnSnapshots.current.set(call.turnId, hostRef.current.history.current());
      // Reads of the project are how the assistant looks at the screen; listing them as work would
      // bury the edits under noise. Everything else goes up the moment it starts, so a call that is
      // taking its time is visibly taking its time rather than simply absent.
      const shown = call.name !== 'get_project' && call.name !== 'get_comp';
      const started = Date.now();
      if (shown) {
        setToolRuns((current) => ({
          ...current,
          [call.turnId]: [
            ...(current[call.turnId] ?? []),
            { callId: call.callId, name: call.name, request: describeArgs(call.args), summary: '', status: 'running' as const, at: started, ms: null },
          ],
        }));
      }
      let result;
      const projectBeforeTool = hostRef.current.history.current();
      // What the assistant may do without asking is the user's choice, not the model's.
      const permitted = allowTool(permissionRef.current, call.name);
      let workflow = editWorkflows.current.get(call.turnId);
      if (!workflow) {
        workflow = new EditWorkflow(hostRef.current.history.current(), hostRef.current.assets());
        editWorkflows.current.set(call.turnId, workflow);
      }
      if (!permitted.ok) {
        result = { ok: false as const, error: permitted.reason };
      } else {
        try {
          const args = (call.args && typeof call.args === 'object' ? call.args : {}) as Record<string, unknown>;
          const project = hostRef.current.history.current();
          const blocked = workflow.before(call.name, args, project) || (call.name === 'save_storyboard' ? workflow.validateStoryboard(args, project) : null);
          if (blocked) result = { ok: false as const, error: blocked };
          else if (call.name === 'editing_workflow_status') result = { ok: true as const, summary: 'Actual workflow receipts; pending steps must be completed before editing.', workflow: workflow.status(project) };
          else if (call.name === 'verify_edit_workflow') result = workflow.verify(project);
          else {
            const host = hostRef.current;
            const synchronousHost = { ...host, history: { ...host.history,
              commit: (...args: Parameters<typeof host.history.commit>) => flushSync(() => host.history.commit(...args)),
              view: (...args: Parameters<typeof host.history.view>) => flushSync(() => host.history.view(...args)),
              undo: () => flushSync(() => host.history.undo()),
            } };
            result = await runTool(synchronousHost, call.name, call.args, controller.signal);
            workflow.record(call.name, args, result, hostRef.current.history.current());
          }
        } catch (error) {
          result = { ok: false as const, error: errorText(error) };
        }
      }
      const summary = result.ok ? (result.summary ?? 'done') : result.error;
      const changedProject = result.ok && hostRef.current.history.current() !== projectBeforeTool;
      toolAborts.current.delete(call.callId);
      if (shown) {
        const status = result.ok ? ('done' as const) : permitted.ok ? ('failed' as const) : ('denied' as const);
        const ms = Date.now() - started;
        setToolRuns((current) => ({
          ...current,
          [call.turnId]: (current[call.turnId] ?? []).map((run) => (run.callId === call.callId ? { ...run, summary, status, ms, changedProject } : run)),
        }));
      }
      await api.chatToolResult(call.turnId, call.callId, result).catch(() => undefined);
    });
    return () => void pending.then((unlisten) => unlisten());
  }, []);

  const revertTurn = (turnId: string) => {
    const snapshot = turnSnapshots.current.get(turnId);
    if (!snapshot) return false;
    history.commit(snapshot, 'Revert AI edits');
    turnSnapshots.current.delete(turnId);
    return true;
  };

  // ── persistence ────────────────────────────────────────────────────────
  /** Why the last autosave was refused, so one broken project is reported once, not per edit. */
  const saveFault = useRef<string | null>(null);
  useEffect(() => {
    if (!loaded) return;
    const snapshot = healProject(project);
    const handle = window.setTimeout(() => {
      api.projectSave(snapshot)
        .then(() => {
          // Coming back from a refused save is worth saying; staying saved is not.
          if (!saveFault.current) return;
          saveFault.current = null;
          toast({ tone: 'success', title: 'Saving again', timeout: 2500 });
        })
        .catch((error) => {
          const reason = errorText(error);
          if (saveFault.current === reason) return;
          saveFault.current = reason;
          toast({ tone: 'error', title: 'Could not autosave', body: reason, timeout: 9000 });
        });
    }, 500);
    return () => window.clearTimeout(handle);
  }, [project, loaded, toast]);

  const saveSettings = useCallback((patch: Partial<Settings>) => {
    const next = { ...settingsRef.current, ...patch };
    setSettings(next);
    api.settingsSave(next).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const handle = window.setTimeout(() => saveSettings({ timelineZoom: zoom, layout }), 700);
    return () => window.clearTimeout(handle);
  }, [zoom, layout, loaded, saveSettings]);

  useEffect(() => {
    if (!comp) return;
    setSelection((current) => current.filter((id) => comp.clips.some((clip) => clip.id === id)));
    setTransitionSelection((current) => (current && comp.transitions.some((item) => item.id === current) ? current : null));
  }, [comp]);

  // The color theme is surface only: Minimalist flattens the chrome, nothing else changes.
  useEffect(() => {
    applyTheme(resolveTheme(settings));
  }, [settings]);

  // ── project files ──────────────────────────────────────────────────────
  const documentFor = (value: Project): HeliosDocument => ({
    format: 'helios', version: 3, savedAt: new Date().toISOString(), project: value,
    assets: assets.filter((asset) => value.media.some((ref) => ref.assetId === asset.id)),
  });

  const rememberRecent = (path: string) => {
    const recents = [path, ...settingsRef.current.recentProjects.filter((item) => item !== path)].slice(0, 12);
    saveSettings({ recentProjects: recents, projectPath: path });
  };

  const writeProject = async (path: string, keepPath: boolean): Promise<boolean> => {
    const target = path.toLowerCase().endsWith('.helios') ? path : `${path}.helios`;
    try {
      await api.projectFileWrite(target, documentFor(history.current()));
      if (keepPath) {
        setSavedProject(history.current());
        rememberRecent(target);
      }
      toast({ tone: 'success', title: 'Saved', body: target.split(/[\\/]/).pop(), timeout: 2200 });
      return true;
    } catch (error) {
      toast({ tone: 'error', title: 'Could not save', body: errorText(error) });
      return false;
    }
  };

  const saveAs = async (keepPath = true): Promise<boolean> => {
    const path = await api.pickSavePath(keepPath ? 'Save project as' : 'Save a copy', `${safeFileName(project.name)}.helios`, 'Helios project', ['helios']);
    if (!path) return false;
    return writeProject(path, keepPath);
  };

  const saveProject = async (): Promise<boolean> => (settingsRef.current.projectPath ? writeProject(settingsRef.current.projectPath, true) : saveAs());

  const openProjectFile = async (path: string) => {
    try {
      const raw = (await api.projectFileRead(path)) as HeliosDocument;
      const bundled = Array.isArray(raw.assets) ? raw.assets : [];
      if (bundled.length) {
        await api.libraryAdopt(bundled).catch(() => ({}));
        await refreshAssets();
      }
      const library = await api.libraryList();
      setAssets(library);
      const opened = loadProject(raw.project ?? raw, new Map(library.map((asset) => [asset.id, asset])));
      history.reset(opened);
      setSavedProject(opened);
      setSelection([]);
      playhead.seek(0);
      rememberRecent(path);
      setMode('edit');
      toast({ tone: 'success', title: 'Project opened', body: path.split(/[\\/]/).pop(), timeout: 2500 });
    } catch (error) {
      toast({ tone: 'error', title: 'Could not open that project', body: errorText(error) });
    }
  };

  const guardUnsaved = (next: () => void, title: string) => {
    if (!dirty) return next();
    setDialog(
      <ConfirmDialog
        title={title}
        body={`Save changes to “${project.name}” first?`}
        confirmLabel="Save"
        discardLabel="Don't Save"
        onConfirm={() => { setDialog(null); void saveProject().then((ok: boolean) => { if (ok) next(); }); }}
        onDiscard={() => { setDialog(null); next(); }}
        onClose={() => setDialog(null)}
      />,
    );
  };

  const openProject = () =>
    guardUnsaved(async () => {
      const picked = await api.pickOpenPath('Open project', 'Helios project', ['helios']);
      if (picked) await openProjectFile(picked);
    }, 'Open another project');

  const newProjectNow = () =>
    guardUnsaved(() => {
      const fresh = newProject();
      history.reset({ ...fresh, media: project.media, captionStyle: project.captionStyle });
      setSavedProject(null);
      saveSettings({ projectPath: null });
      setSelection([]);
      playhead.seek(0);
      setMode('edit');
    }, 'New project');

  // Closing the window asks about unsaved work.
  useEffect(() => {
    const window_ = getCurrentWindow();
    const pending = window_.onCloseRequested((event) => {
      if (!savedProject || savedProject === history.current()) return;
      event.preventDefault();
      setDialog(
        <ConfirmDialog
          title="Close Helios"
          body={`Save changes to “${history.current().name}” before closing?`}
          confirmLabel="Save and close"
          discardLabel="Close without saving"
          onConfirm={() => { setDialog(null); void saveProject().then((ok: boolean) => { if (ok) void window_.destroy(); }); }}
          onDiscard={() => { setDialog(null); void window_.destroy(); }}
          onClose={() => setDialog(null)}
        />,
      );
    });
    return () => void pending.then((unlisten) => unlisten());
  }, [savedProject, history]);

  // ── layout ─────────────────────────────────────────────────────────────
  const hidden = (panel: PanelId) => layout.hidden.includes(panel);
  const setPanelVisible = (panel: PanelId, visible: boolean) => {
    setLayout((current) => ({ ...current, hidden: visible ? current.hidden.filter((id) => id !== panel) : [...new Set([...current.hidden, panel])] }));
    if (!visible && maximized === panel) setMaximized(null);
  };
  const showPanel = (panel: PanelId, tab?: ProjectTab) => {
    setPanelVisible(panel, true);
    setFocused(panel);
    if (tab) setProjectTab(tab);
  };
  const toggleMax = (panel: PanelId) => setMaximized((current) => (current === panel ? null : panel));
  const resize = (key: keyof Omit<WorkspaceLayout, 'hidden' | 'meters'>, min: number, max: number, sign = 1) => (delta: number) =>
    setLayout((current) => ({ ...current, [key]: clamp((layoutStart.current[key] as number) + delta * sign, min, max) }));
  const beginResize = () => {
    layoutStart.current = layout;
  };

  // ── editing helpers ────────────────────────────────────────────────────
  const editComp = (change: (current: Comp) => Comp, label: string) => {
    if (!comp) return;
    history.commit((current) => updateComp(current, comp.id, change), label);
  };
  const limit = useCallback((clip: Clip) => sourceLimit(history.current(), assetMap, clip), [history, assetMap]);
  const targetedTracks = () => (comp ? comp.tracks.filter((track) => track.targeted && !track.locked).map((track) => track.id) : []);

  const importFiles = useCallback(async (paths: string[], drop?: { x: number; y: number }) => {
    if (!paths.length) return;
    try {
      const result = await api.libraryImport(paths);
      await refreshAssets();
      const all = [...result.imported, ...result.existing];
      if (all.length) {
        history.commit((current) => {
          let next = { ...current, media: [...current.media, ...all.filter((asset) => !current.media.some((ref) => ref.assetId === asset.id)).map((asset) => ({ assetId: asset.id, folderId: binFolder, offline: false }))] };
          const target = drop ? timelineApi.current?.dropTarget(drop.x, drop.y) : null;
          const active = next.comps.find((item) => item.id === next.activeCompId);
          if (target && active) {
            let cursor = target.time;
            let build = active;
            for (const asset of all) {
              const result_ = dropClips(next, new Map(assets.map((item) => [item.id, item])) as AssetMap, build, { kind: 'source', source: { type: 'media', assetId: asset.id }, label: asset.name, x: 0, y: 0, ctrl: false }, { ...target, time: cursor }, nestComps);
              build = placeClips(result_.comp, result_.clips, 'overwrite');
              cursor += result_.clips[0]?.duration ?? STILL_DEFAULT;
            }
            next = updateComp(next, active.id, () => build);
          }
          return next;
        }, 'Import');
      }
      if (result.imported.length) toast({ tone: 'success', title: `Imported ${result.imported.length} file${result.imported.length === 1 ? '' : 's'}`, body: result.imported.map((asset) => asset.name).join(', ').slice(0, 160) });
      for (const failure of result.failed.slice(0, 3)) toast({ tone: 'error', title: `Skipped ${failure.path.split(/[\\/]/).pop()}`, body: failure.reason });
    } catch (error) {
      toast({ tone: 'error', title: 'Import failed', body: errorText(error) });
      if (errorText(error).includes('FFmpeg')) setSettingsTab('media');
    }
  }, [assets, binFolder, history, nestComps, refreshAssets, toast]);

  const pickFiles = useCallback(async () => {
    const extensions = info?.extensions ?? ['mp4', 'mov', 'mkv', 'webm', 'mp3', 'wav', 'm4a', 'png', 'jpg'];
    const picked = await openDialog({ multiple: true, title: 'Import media', filters: [{ name: 'Media', extensions }] });
    if (picked) await importFiles(Array.isArray(picked) ? picked : [picked]);
  }, [importFiles, info]);

  const sourceEdit = (asset: Asset, range: SourceRange, mode: 'insert' | 'overwrite') => {
    if (!comp) return;
    const at = playhead.get();
    const clips = clipsForSource(project, assetMap, { type: 'media', assetId: asset.id }, { start: at, videoTrack: comp.sourceVideo, audioTrack: comp.sourceAudio, in: range.in, duration: Math.max(frame, range.out - range.in) });
    if (!clips.length) return toast({ tone: 'info', title: 'Nothing to edit in', body: 'Patch a track in the timeline header first.' });
    editComp(() => placeClips(comp, clips, mode), mode === 'insert' ? 'Insert' : 'Overwrite');
    setSelection(clips.map((clip) => clip.id));
    playhead.seek(at + clips[0].duration);
  };

  const openInSource = (assetId: string, range?: SourceRange) => {
    setSourceId(assetId);
    if (range) setSourceRanges((current) => ({ ...current, [assetId]: range }));
    showPanel('source');
  };

  const openComp = (compId: string) => {
    history.view((current) => ({ ...current, activeCompId: compId, openCompIds: current.openCompIds.includes(compId) ? current.openCompIds : [...current.openCompIds, compId] }));
    setSelection([]);
    playhead.seek(0);
    showPanel('timeline');
  };

  const closeComp = (compId: string) => {
    history.view((current) => {
      const open = current.openCompIds.filter((id) => id !== compId);
      const active = current.activeCompId === compId ? (open[open.length - 1] ?? null) : current.activeCompId;
      return { ...current, openCompIds: open, activeCompId: active ?? current.comps[0]?.id ?? null };
    });
  };

  const deleteSelection = (ripple: boolean) => {
    if (!comp || !selection.length) return;
    if (transitionSelection) {
      editComp((current) => ({ ...current, transitions: current.transitions.filter((item) => item.id !== transitionSelection) }), 'Delete Transition');
      setTransitionSelection(null);
      return;
    }
    editComp((current) => removeClips(current, linkedSelection ? withLinked(current, selection) : selection, ripple), ripple ? 'Ripple Delete' : 'Clear');
    setSelection([]);
  };

  const copySelection = (cut: boolean) => {
    if (!comp || !selection.length) return;
    clipboard.current = { clips: selectedClips.map((clip) => ({ ...clip })), comp: comp.id };
    if (cut) deleteSelection(false);
    toast({ tone: 'info', title: cut ? 'Cut' : 'Copied', body: `${selectedClips.length} clip${selectedClips.length === 1 ? '' : 's'} — Ctrl+V pastes at the playhead.`, timeout: 1800 });
  };

  const paste = (insert: boolean) => {
    const board = clipboard.current;
    if (!board || !comp) return;
    const at = playhead.get();
    const earliest = Math.min(...board.clips.map((clip) => clip.start));
    let next = comp;
    const links = new Map<string, string>();
    const placed: Clip[] = [];
    for (const clip of board.clips) {
      const kind = tracksOf(comp, 'video').some((track) => track.id === clip.trackId) ? 'video' : 'audio';
      const index = Math.max(0, trackIndex(board.comp === comp.id ? comp : next, clip.trackId));
      let track = tracksOf(next, kind)[index];
      if (!track) {
        next = addTracks(next, kind, index + 1 - tracksOf(next, kind).length).comp;
        track = tracksOf(next, kind)[index];
      }
      const linkId = clip.linkId ? (links.get(clip.linkId) ?? links.set(clip.linkId, uid()).get(clip.linkId) ?? null) : null;
      placed.push({ ...clip, id: uid(), linkId, trackId: track.id, start: at + (clip.start - earliest) });
    }
    editComp(() => placeClips(next, placed, insert ? 'insert' : 'overwrite'), insert ? 'Paste Insert' : 'Paste');
    setSelection(placed.map((clip) => clip.id));
  };

  const addEdit = (allTracks: boolean) => {
    if (!comp) return;
    const at = playhead.get();
    const tracks = allTracks ? null : targetedTracks();
    editComp((current) => razor(current, at, tracks), allTracks ? 'Add Edit to All Tracks' : 'Add Edit');
  };

  const markIn = () => editComp((current) => ({ ...current, inPoint: playhead.get(), outPoint: current.outPoint !== null && current.outPoint <= playhead.get() ? null : current.outPoint }), 'Mark In');
  const markOut = () => editComp((current) => ({ ...current, outPoint: playhead.get(), inPoint: current.inPoint !== null && current.inPoint >= playhead.get() ? null : current.inPoint }), 'Mark Out');
  const markClip = () => {
    const clip = selectedClips[0] ?? (comp ? comp.clips.find((item) => item.start <= playhead.get() && clipEnd(item) > playhead.get() && targetedTracks().includes(item.trackId)) : undefined);
    if (clip) editComp((current) => ({ ...current, inPoint: clip.start, outPoint: clipEnd(clip) }), 'Mark Clip');
  };
  const markSelection = () => {
    if (!selectedClips.length) return;
    editComp((current) => ({ ...current, inPoint: Math.min(...selectedClips.map((clip) => clip.start)), outPoint: Math.max(...selectedClips.map(clipEnd)) }), 'Mark Selection');
  };
  const clearInOut = () => editComp((current) => ({ ...current, inPoint: null, outPoint: null }), 'Clear In and Out');
  const addMarker = () => editComp((current) => toggleMarker(current, playhead.get()), 'Add Marker');
  const removeRangeNow = (mode: 'lift' | 'extract') => {
    if (!comp || comp.inPoint === null || comp.outPoint === null || comp.outPoint <= comp.inPoint) {
      toast({ tone: 'info', title: 'Mark In and Out first', body: mode === 'lift' ? 'Lift removes the range and leaves a gap.' : 'Extract removes the range and closes the gap.' });
      return;
    }
    const at = comp.inPoint;
    editComp((current) => removeRange(current, current.inPoint ?? 0, current.outPoint ?? 0, mode), mode === 'lift' ? 'Lift' : 'Extract');
    playhead.seek(at);
  };

  const goToPoint = (direction: 1 | -1, anyTrack: boolean) => {
    if (!comp) return;
    const tracks = anyTrack ? null : targetedTracks();
    const target = nextPoint([...editPoints(comp, tracks), ...comp.markers.map((marker) => marker.time)], playhead.get(), direction);
    if (target !== null) playhead.seek(target);
  };

  const nudge = (frames: number, tracksToo = false) => {
    if (!comp || !selection.length) return;
    const shift = tracksToo ? { video: frames > 0 ? 1 : -1, audio: frames > 0 ? 1 : -1 } : { video: 0, audio: 0 };
    const result = moveClips(comp, linkedSelection ? withLinked(comp, selection) : selection, tracksToo ? 0 : frames * frame, shift, 'overwrite');
    if (result) {
      editComp(() => result.comp, 'Nudge');
      setSelection(result.ids);
    }
  };

  const trimToPlayhead = (side: 'previous' | 'next', ripple: boolean) => {
    if (!comp) return;
    const at = playhead.get();
    const tracks = targetedTracks();
    let next = comp;
    for (const trackId of tracks) {
      const clips = next.clips.filter((clip) => clip.trackId === trackId).sort((a, b) => a.start - b.start);
      const target = side === 'previous' ? [...clips].reverse().find((clip) => clip.start < at - 1e-4) : clips.find((clip) => clipEnd(clip) > at + 1e-4);
      if (!target) continue;
      next = trimEdge(next, target.id, side === 'previous' ? 'out' : 'in', at, ripple ? 'ripple' : 'normal', limit, { minDuration: frame });
    }
    editComp(() => next, ripple ? 'Ripple Trim to Playhead' : 'Extend Edit to Playhead');
  };

  const clipVolume = (deltaDb: number) => {
    if (!comp || !selection.length) return;
    editComp((current) => ({ ...current, clips: current.clips.map((clip) => (selection.includes(clip.id) ? { ...clip, volume: clamp(clip.volume * 10 ** (deltaDb / 20), 0, 8) } : clip)) }), 'Clip Volume');
  };

  const trackHeights = (kind: 'video' | 'audio' | 'all', delta: number) => {
    if (!comp) return;
    history.view((current) => updateComp(current, comp.id, (target) => ({ ...target, tracks: target.tracks.map((track) => (kind === 'all' || track.kind === kind ? { ...track, height: clamp(track.height + delta, 28, 260) } : track)) })));
  };

  const applyEffect = (effect: EffectPreset | EffectDefinition, clipIds = selection) => {
    if (!comp || !clipIds.length) return toast({ tone: 'info', title: 'Select a clip first', body: `Then apply ${effect.label}.`, timeout: 2500 });
    if (!RENDERED_EFFECTS.has(effect.id)) return toast({ tone: 'info', title: 'Effect unavailable', body: 'This legacy catalog entry has no complete render implementation.' });
    const fxSettings = loadFxSettings();
    const effectiveApply = { ...(effect.apply || {}), ...(fxSettings.overrides[effect.id]?.apply || {}) };
    const fullDef = ALL_EFFECTS.find((e) => e.id === effect.id) || {
      id: effect.id,
      label: effect.label,
      group: (effect as EffectDefinition).group || 'Distort',
      hint: '',
      apply: effectiveApply,
    };
    const newApplied = createAppliedEffect(fullDef);

    editComp((current) => ({
      ...current,
      clips: current.clips.map((clip) => {
        if (!clipIds.includes(clip.id)) return clip;
        const existing = clip.appliedEffects || [];
        return { ...clip, appliedEffects: [...existing, { ...newApplied, id: uid() }] };
      }),
    }), `Apply ${effect.label}`);

    setInspectorTab('effects');
    toast({ tone: 'success', title: `Applied ${effect.label}`, body: `Configured on layer. Inspected in Effect Controls.`, timeout: 2500 });
  };

  const reimportSnapshot = async (snapshot: FxSnapshot) => {
    try {
      const res = await fetch(snapshot.dataUrl);
      const blob = await res.blob();
      const bytes = [...new Uint8Array(await blob.arrayBuffer())];
      let asset: Asset;
      try {
        asset = await api.saveRecording(bytes, 'png');
        await refreshAssets();
      } catch {
        asset = {
          id: uid(),
          name: `${snapshot.compName || 'Snapshot'} ${snapshot.time.toFixed(2)}s.png`,
          path: snapshot.dataUrl,
          kind: 'image',
          duration: 0,
          width: snapshot.width,
          height: snapshot.height,
          fps: 0,
          hasAudio: false,
          videoCodec: '',
          audioCodec: '',
          size: bytes.length,
          importedAt: new Date().toISOString(),
          thumbnail: snapshot.dataUrl,
          filmstrip: null,
          waveform: null,
          proxy: null,
          preview: 'ready',
          missing: false,
          peaks: null,
        };
        setAssets((curr) => [...curr, asset]);
      }
      history.commit((current) => ({
        ...current,
        media: [...current.media, { assetId: asset.id, folderId: binFolder, offline: false }],
      }), 'Import Snapshot');
      toast({ tone: 'success', title: 'Snapshot re-imported to Project Bin', body: asset.name });
    } catch (err) {
      toast({ tone: 'error', title: 'Failed to re-import snapshot', body: errorText(err) });
    }
  };

  const addText = (preset: Parameters<typeof textSource>[0]) => {
    if (!comp) return;
    const at = playhead.get();
    const duration = preset === 'caption' ? 2.5 : 3;
    const free = freeTrack(comp, 'video', at, at + duration);
    const clip = newClip({ trackId: free.track.id, start: at, duration, source: textSource(preset, { style: project.captionStyle }) });
    editComp(() => placeClips(free.comp, [clip], 'overwrite'), 'New Text Layer');
    setSelection([clip.id]);
    showPanel('properties');
  };

  const soundSelectionMenu = (ids:string[]) => (['whoosh','impact','chime','pop','riser'] as const).map(kind=>({
    label:kind[0].toUpperCase()+kind.slice(1)+' · local procedural',
    onSelect:()=>{if(!comp)return;try{const result=generateSelectionSound(comp,ids,kind);editComp(()=>result.comp,'Generate Sound for Selection');setSelection(result.ids);}catch(error){toast({tone:'error',title:'Could not generate sound',body:String(error)});}}
  }));

  const addSfx = (kind: Parameters<typeof clipsForSource>[2] extends never ? never : 'whoosh' | 'impact' | 'chime' | 'pop' | 'riser') => {
    if (!comp) return;
    const at = playhead.get();
    const source = { type: 'sfx' as const, kind };
    const duration = sourceInfo(project, assetMap, source).length;
    const free = freeTrack(comp, 'audio', at, at + duration, 0);
    const clip = newClip({ trackId: free.track.id, start: at, duration, source, volume: 0.7 });
    editComp(() => placeClips(free.comp, [clip], 'overwrite'), 'Add Sound Effect');
    setSelection([clip.id]);
  };

  const captionStyleChosen = (style: CaptionStyle) => {
    const captions = comp?.clips.filter((clip) => clip.source.type === 'text' && clip.source.preset === 'caption' && selection.includes(clip.id)) ?? [];
    history.commit((current) => {
      const next = { ...current, captionStyle: style.id };
      if (!comp) return next;
      return updateComp(next, comp.id, (target) => ({
        ...target,
        clips: target.clips.map((clip) => {
          const chosen = captions.length ? captions.some((item) => item.id === clip.id) : clip.source.type === 'text' && clip.source.preset === 'caption';
          return chosen && clip.source.type === 'text' ? { ...clip, source: { ...clip.source, style: style.id } } : clip;
        }),
      }));
    }, 'Caption Style');
  };

  const importCaptions = async (file: File) => {
    const cues = parseCaptions(await file.text());
    if (!cues.length || !comp) {
      toast({ tone: 'error', title: 'No captions found', body: `${file.name} has no readable SRT or VTT cues.` });
      return;
    }
    const free = freeTrack(comp, 'video', Math.min(...cues.map((cue) => cue.start)), Math.max(...cues.map((cue) => cue.end)));
    const clips = cues.map((cue) => newClip({ trackId: free.track.id, start: cue.start, duration: Math.max(0.1, cue.end - cue.start), source: textSource('caption', { text: cue.text, style: project.captionStyle }) }));
    editComp(() => placeClips(free.comp, clips, 'overwrite'), 'Import Captions');
    toast({ tone: 'success', title: `Imported ${clips.length} captions`, body: file.name });
  };

  // ── export ─────────────────────────────────────────────────────────────
  const startExport = useCallback(async (options: ExportOptions, folder: string) => {
    setExportOpen(false);
    saveSettings({ export: { resolution: options.resolution, fps: options.fps, quality: options.quality, folder } });
    try {
      await api.exportStart(history.current(), options);
      toast({ tone: 'info', title: 'Export started', body: 'Progress is in the status bar.', timeout: 2500 });
    } catch (error) {
      toast({ tone: 'error', title: 'Export could not start', body: errorText(error) });
    }
  }, [history, saveSettings, toast]);

  const exportFrame = async () => {
    if (!comp) return;
    const at = playhead.get();
    const base = await pictureDir().catch(() => '');
    const path = await saveDialog({ title: 'Export frame', defaultPath: `${base ? `${base}\\` : ''}${safeFileName(comp.name)} ${timecode(at, fps).replace(/:/g, '-')}.png`, filters: [{ name: 'PNG image', extensions: ['png'] }] });
    if (!path) return;
    try {
      const written = await api.exportFrame(history.current(), comp.id, at, path.toLowerCase().endsWith('.png') ? path : `${path}.png`);
      toast({ tone: 'success', title: 'Frame exported', body: written.split(/[\\/]/).pop(), actions: [{ label: 'Open', run: () => void api.openPath(written) }, { label: 'Show in folder', run: () => void api.revealPath(written) }] });
    } catch (error) {
      toast({ tone: 'error', title: 'Could not export the frame', body: errorText(error) });
    }
  };

  // ── voice-over ─────────────────────────────────────────────────────────
  const voiceOver = async (trackId: string) => {
    if (recordingTrack) {
      recorder.current?.stop();
      return;
    }
    if (!comp) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const media = new MediaRecorder(stream);
      media.ondataavailable = (event) => event.data.size && chunks.push(event.data);
      const startedAt = playhead.get();
      media.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        setRecordingTrack(null);
        playhead.setPlaying(false);
        const blob = new Blob(chunks, { type: chunks[0]?.type || 'audio/webm' });
        const bytes = [...new Uint8Array(await blob.arrayBuffer())];
        try {
          const asset = await api.saveRecording(bytes, 'webm');
          await refreshAssets();
          history.commit((current) => {
            const active = current.comps.find((item) => item.id === comp.id);
            if (!active) return current;
            const clips = clipsForSource({ ...current, media: [...current.media, { assetId: asset.id, folderId: null, offline: false }] }, new Map([[asset.id, asset]]) as AssetMap, { type: 'media', assetId: asset.id }, { start: startedAt, videoTrack: null, audioTrack: trackId, duration: asset.duration });
            return updateComp({ ...current, media: [...current.media, { assetId: asset.id, folderId: null, offline: false }] }, comp.id, (target) => placeClips(target, clips, 'overwrite'));
          }, 'Voice-over');
          toast({ tone: 'success', title: 'Voice-over recorded', body: `${asset.duration.toFixed(1)}s on ${trackLabel(comp, trackId)}` });
        } catch (error) {
          toast({ tone: 'error', title: 'Could not save the recording', body: errorText(error) });
        }
      };
      media.start();
      recorder.current = { stop: () => media.stop() };
      setRecordingTrack(trackId);
      playhead.setPlaying(true, 1);
      toast({ tone: 'info', title: 'Recording…', body: 'Click the microphone again to stop.', timeout: 3000 });
    } catch (error) {
      toast({ tone: 'error', title: 'No microphone', body: errorText(error) });
    }
  };

  // ── drag from the panels ───────────────────────────────────────────────
  const startPanelDrag = (payload: DragPayload, event: ReactPointerEvent) => {
    const origin = { x: event.clientX, y: event.clientY };
    let dragging = false;
    const move = (moveEvent: PointerEvent) => {
      if (!dragging && Math.hypot(moveEvent.clientX - origin.x, moveEvent.clientY - origin.y) < 6) return;
      dragging = true;
      setDragLabel(payload.label);
      // Effects have no timeline ghost: they land on whatever clip is under the pointer.
      if (payload.kind !== 'effect') setIncoming({ ...payload, x: moveEvent.clientX, y: moveEvent.clientY, ctrl: moveEvent.ctrlKey } as IncomingDrag);
    };
    const up = (upEvent: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setIncoming(null);
      setDragLabel(null);
      if (!dragging) return;
      dropPayload(payload, upEvent);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const dropPayload = (payload: DragPayload, event: PointerEvent) => {
    if (!comp) return;
    const target = timelineApi.current?.dropTarget(event.clientX, event.clientY);
    if (payload.kind === 'transition') {
      if (!target?.trackId) return;
      editComp((current) => addTransition(current, target.trackId as string, target.time, payload.transition, 1), 'Apply Transition');
      return;
    }
    if (payload.kind === 'effect') {
      const hit = document.elementsFromPoint(event.clientX, event.clientY).map((element) => (element as HTMLElement).closest<HTMLElement>('.tl-clip[data-clip-id]')).find((element) => element);
      const clipId = hit?.dataset.clipId;
      applyEffect(payload.effect, clipId ? [clipId] : selection);
      return;
    }
    if (!target) return;
    if (payload.source.type === 'comp' && wouldCycle(project, comp.id, payload.source.compId)) {
      toast({ tone: 'error', title: 'That would nest a comp inside itself' });
      return;
    }
    const result = dropClips(project, assetMap, comp, { kind: 'source', source: payload.source, label: payload.label, in: payload.in, duration: payload.duration, x: event.clientX, y: event.clientY, ctrl: event.ctrlKey }, target, nestComps);
    if (!result.clips.length) return;
    editComp(() => placeClips(result.comp, result.clips, event.ctrlKey ? 'insert' : 'overwrite'), 'Drop');
    setSelection(result.clips.map((clip) => clip.id));
  };

  // ── files dropped from Explorer ────────────────────────────────────────
  useEffect(() => {
    const pending = getCurrentWebview().onDragDropEvent((event) => {
      const payload = event.payload;
      if (payload.type === 'enter' || payload.type === 'over') setFileHover(true);
      else if (payload.type === 'leave') setFileHover(false);
      else if (payload.type === 'drop') {
        setFileHover(false);
        const ratio = window.devicePixelRatio || 1;
        const point = { x: payload.position.x / ratio, y: payload.position.y / ratio };
        if (document.elementFromPoint(point.x, point.y)?.closest('.chat')) return;
        const heliosFile = payload.paths.find((path) => path.toLowerCase().endsWith('.helios'));
        if (heliosFile) void openProjectFile(heliosFile);
        else void importFiles(payload.paths, point);
      }
    });
    return () => void pending.then((unlisten) => unlisten());
  }, [importFiles]);

  // ── context menus ──────────────────────────────────────────────────────
  const showMenu = (event: { clientX: number; clientY: number }, items: MenuItem[]) => setMenu({ anchor: new DOMRect(event.clientX, event.clientY, 0, 0), items });

  const clipMenu = (event: { clientX: number; clientY: number }, clipId: string, at: number) => {
    if (!comp) return;
    const clip = comp.clips.find((item) => item.id === clipId);
    if (!clip) return;
    const ids = selection.includes(clipId) ? selection : [clipId];
    const clips = comp.clips.filter((item) => ids.includes(item.id));
    const asset = clip.source.type === 'media' ? assetMap.get(clip.source.assetId) : undefined;
    const isMedia = clip.source.type === 'media';
    const linked = !!clip.linkId;
    const grouped = !!clip.groupId;
    const audioClips = clips.filter((item) => tracksOf(comp, 'audio').some((track) => track.id === item.trackId) || (item.source.type === 'media' && assetMap.get((item.source as { assetId: string }).assetId)?.hasAudio));
    const setFit = (fit: 'fit' | 'fill') => editComp((current) => ({ ...current, clips: current.clips.map((item) => (ids.includes(item.id) ? { ...item, transform: { ...item.transform, fit, scale: 100 } } : item)) }), fit === 'fit' ? 'Fit to Frame' : 'Fill Frame');
    showMenu(event, [
      { label: 'Cut', shortcut: 'Ctrl+X', onSelect: () => copySelection(true) },
      { label: 'Copy', shortcut: 'Ctrl+C', onSelect: () => copySelection(false) },
      { label: 'Paste Attributes…', shortcut: 'Ctrl+Alt+V', disabled: !clipboard.current?.clips.length, onSelect: () => setDialog(
        <AttributesDialog title="Paste Attributes" action="Paste" onClose={() => setDialog(null)} onSubmit={(set) => {
          setDialog(null);
          const from = clipboard.current?.clips[0];
          if (from) editComp((current) => pasteAttributes(current, ids, from, set, limit), 'Paste Attributes');
        }} />) },
      { label: 'Remove Attributes…', onSelect: () => setDialog(
        <AttributesDialog title="Remove Attributes" action="Remove" onClose={() => setDialog(null)} onSubmit={(set) => {
          setDialog(null);
          editComp((current) => removeAttributes(current, ids, set, limit), 'Remove Attributes');
        }} />) },
      { label: 'Clear', shortcut: 'Delete', onSelect: () => deleteSelection(false) },
      { label: 'Ripple Delete', shortcut: 'Shift+Delete', onSelect: () => deleteSelection(true) },
      { separator: true },
      { label: 'Edit Original', shortcut: 'Ctrl+E', disabled: !asset, onSelect: () => asset && void api.openPath(asset.path) },
      { label: 'Edit Clip in Adobe Audition', disabled: true },
      { label: 'License…', disabled: true },
      { label: 'Replace With Comp…', submenu: project.comps.filter((item) => item.id !== comp.id && !wouldCycle(project, comp.id, item.id)).map((item) => ({ label: item.name, onSelect: () => editComp((current) => replaceSource(current, ids, { type: 'comp', compId: item.id }, 0), 'Replace With Comp') })) },
      { label: 'Replace With Clip', submenu: [
        { label: 'From Source Monitor', disabled: !sourceAsset, onSelect: () => sourceAsset && editComp((current) => replaceSource(current, ids, { type: 'media', assetId: sourceAsset.id }, sourceRanges[sourceAsset.id]?.in ?? 0), 'Replace With Clip') },
        { label: 'From Source Monitor, Match Frame', disabled: !sourceAsset, onSelect: () => sourceAsset && editComp((current) => replaceSource(current, ids, { type: 'media', assetId: sourceAsset.id }, sourceApi.current?.time() ?? 0), 'Replace With Clip') },
        { separator: true },
        ...project.media.slice(0, 20).map((ref) => ({ label: assetMap.get(ref.assetId)?.name ?? 'Media', onSelect: () => editComp((current) => replaceSource(current, ids, { type: 'media', assetId: ref.assetId }, 0), 'Replace With Clip') })),
      ] },
      { label: 'Render and Replace…', disabled: !info?.ffmpeg.found, onSelect: () => void renderAndReplace(clip) },
      { label: 'Restore Unrendered', disabled: !renderOriginals.current.has(clip.id), onSelect: () => {
        const original = renderOriginals.current.get(clip.id);
        if (original) {
          editComp((current) => ({ ...current, clips: current.clips.map((item) => (item.id === clip.id ? { ...item, source: original } : item)) }), 'Restore Unrendered');
          renderOriginals.current.delete(clip.id);
        }
      } },
      { label: 'Restore Captions from Source Clip', disabled: true },
      { separator: true },
      { label: 'Enable', shortcut: 'Shift+E', checked: clips.every((item) => item.enabled), onSelect: () => editComp((current) => ({ ...current, clips: current.clips.map((item) => (ids.includes(item.id) ? { ...item, enabled: !clips.every((entry) => entry.enabled) } : item)) }), 'Enable') },
      {
        label: linked ? 'Unlink' : 'Link',
        shortcut: 'Ctrl+L',
        disabled: !linked && ids.length < 2,
        onSelect: () => {
          editComp((current) => setLinked(current, ids, !linked), linked ? 'Unlink' : 'Link');
          // Unlinking leaves both halves selected, and a selection of two still drags as two —
          // which looks exactly like the unlink not having worked. Narrow it to the clip that was
          // right-clicked, so the next drag moves that one alone.
          if (linked && clipId) setSelection([clipId]);
        },
      },
      { label: 'Group', shortcut: 'Ctrl+G', disabled: ids.length < 2, onSelect: () => editComp((current) => setGrouped(current, ids, true), 'Group') },
      { label: 'Ungroup', shortcut: 'Ctrl+Shift+G', disabled: !grouped, onSelect: () => editComp((current) => setGrouped(current, ids, false), 'Ungroup') },
      { label: 'Synchronize…', disabled: ids.length < 2, onSelect: () => setDialog(<SynchronizeDialog onClose={() => setDialog(null)} onSubmit={(mode) => { setDialog(null); editComp((current) => synchronize(current, ids, mode), 'Synchronize'); }} />) },
      { label: 'Merge Clips…', disabled: ids.length < 2, onSelect: () => nest(ids, 'Merged Clip', true) },
      { label: 'Nest…', onSelect: () => setDialog(<RenameDialog title="Nest" name="Nested Comp" onClose={() => setDialog(null)} onSubmit={(name) => { setDialog(null); nest(ids, name, true); }} />) },
      { label: 'Make Subcomp', onSelect: () => nest(ids, `${comp.name} Sub`, false) },
      { label: 'Multi-Camera', disabled: true },
      { separator: true },
      { label: 'Label', submenu: [
        { label: 'None', checked: !clip.label, onSelect: () => editComp((current) => ({ ...current, clips: current.clips.map((item) => (ids.includes(item.id) ? { ...item, label: null } : item)) }), 'Label') },
        ...LABELS.map((name) => ({ label: capitalize(name), checked: clip.label === name, onSelect: () => editComp((current) => ({ ...current, clips: current.clips.map((item) => (ids.includes(item.id) ? { ...item, label: name as Clip['label'] } : item)) }), 'Label') })),
      ] },
      { separator: true },
      { label: 'Speed/Duration…', shortcut: 'Ctrl+R', onSelect: () => speedDialog(clip, ids) },
      { label: 'Scene Edit Detection…', disabled: !isMedia, onSelect: () => sceneDialog(clip) },
      { label: 'Ignore Transcript', disabled: true },
      { separator: true },
      { label: 'Generate Sound for Selection', submenu: soundSelectionMenu(ids) },
      { label: 'Audio Gain…', shortcut: 'Shift+G', disabled: !audioClips.length, onSelect: () => gainDialog(audioClips) },
      { label: 'Audio Channels…', disabled: !audioClips.length, onSelect: () => setDialog(<ChannelsDialog clip={clip} onClose={() => setDialog(null)} onSubmit={(channels) => { setDialog(null); editComp((current) => ({ ...current, clips: current.clips.map((item) => (ids.includes(item.id) ? { ...item, channels } : item)) }), 'Audio Channels'); }} />) },
      { label: 'Auto-Tag Audio Types', disabled: !audioClips.length, onSelect: () => editComp((current) => ({
        ...current,
        clips: current.clips.map((item) => {
          if (!ids.includes(item.id)) return item;
          const media = item.source.type === 'media' ? assetMap.get(item.source.assetId) : undefined;
          const audioType = item.source.type === 'sfx' ? 'sfx' : media?.kind === 'audio' ? 'music' : media?.kind === 'video' ? 'dialogue' : 'ambience';
          return { ...item, audioType };
        }),
      }), 'Auto-Tag Audio Types') },
      { label: 'Enable Enhance Speech', checked: clips.every((item) => item.enhanceSpeech), disabled: !audioClips.length, onSelect: () => editComp((current) => ({ ...current, clips: current.clips.map((item) => (ids.includes(item.id) ? { ...item, enhanceSpeech: !clips.every((entry) => entry.enhanceSpeech) } : item)) }), 'Enhance Speech') },
      { separator: true },
      { label: 'Frame Hold Options…', onSelect: () => setDialog(<FrameHoldDialog clip={clip} comp={comp} onClose={() => setDialog(null)} onSubmit={(draft) => {
        setDialog(null);
        const source = draft.at === 'playhead' ? sourceTimeAt(clip, playhead.get()) : draft.at === 'in' ? clip.in : sourceOut(clip) - frame;
        editComp((current) => ({ ...current, clips: current.clips.map((item) => (ids.includes(item.id) ? { ...item, hold: source } : item)) }), 'Frame Hold');
      }} />) },
      { label: 'Add Frame Hold', onSelect: () => editComp((current) => addFrameHold(current, ids, playhead.get()), 'Add Frame Hold') },
      { label: 'Insert Frame Hold Segment', onSelect: () => editComp((current) => insertFrameHold(current, clip.id, playhead.get(), 2), 'Insert Frame Hold Segment') },
      { label: 'Field Options…', onSelect: () => setDialog(<FieldOptionsDialog clip={clip} onClose={() => setDialog(null)} onSubmit={(deinterlace) => { setDialog(null); editComp((current) => ({ ...current, clips: current.clips.map((item) => (ids.includes(item.id) ? { ...item, deinterlace } : item)) }), 'Field Options'); }} />) },
      { label: 'Time Interpolation', submenu: ([['sampling', 'Frame Sampling'], ['blending', 'Frame Blending'], ['optical-flow', 'Optical Flow']] as const).map(([value, label]) => ({
        label, checked: clip.interpolation === value, onSelect: () => editComp((current) => ({ ...current, clips: current.clips.map((item) => (ids.includes(item.id) ? { ...item, interpolation: value } : item)) }), 'Time Interpolation'),
      })) },
      { separator: true },
      { label: 'Scale to Frame Size', onSelect: () => setFit('fit') },
      { label: 'Fit to frame', onSelect: () => setFit('fit') },
      { label: 'Fill frame', onSelect: () => setFit('fill') },
      { label: 'Adjustment Layer', checked: clip.adjustment, onSelect: () => editComp((current) => ({ ...current, clips: current.clips.map((item) => (ids.includes(item.id) ? { ...item, adjustment: !clip.adjustment } : item)) }), 'Adjustment Layer') },
      { separator: true },
      { label: 'Link Media…', disabled: !asset, onSelect: () => void relink(clip) },
      { label: 'Make Offline…', disabled: !asset, onSelect: () => asset && history.commit((current) => ({ ...current, media: current.media.map((ref) => (ref.assetId === asset.id ? { ...ref, offline: true } : ref)) }), 'Make Offline') },
      { label: 'Rename…', onSelect: () => setDialog(<RenameDialog title="Rename Clip" name={clip.name ?? sourceInfo(project, assetMap, clip.source).name} onClose={() => setDialog(null)} onSubmit={(name) => { setDialog(null); editComp((current) => ({ ...current, clips: current.clips.map((item) => (item.id === clip.id ? { ...item, name } : item)) }), 'Rename'); }} />) },
      { label: 'Reveal in Project', onSelect: () => {
        const id = clip.source.type === 'media' ? clip.source.assetId : clip.source.type === 'comp' ? clip.source.compId : clip.source.type === 'item' ? clip.source.itemId : null;
        if (id) {
          showPanel('project', 'project');
          setBinSelection([id]);
          setBinFolder(null);
        }
      } },
      { label: 'Reveal in Explorer', disabled: !asset, onSelect: () => asset && void api.revealPath(asset.path) },
      { label: 'Properties', onSelect: () => setDialog(<ClipInfoDialog clip={clip} comp={comp} asset={asset} item={clip.source.type === 'item' ? project.items.find((entry) => entry.id === (clip.source as { itemId: string }).itemId) : undefined} nested={clip.source.type === 'comp' ? project.comps.find((entry) => entry.id === (clip.source as { compId: string }).compId) : undefined} onClose={() => setDialog(null)} />) },
      { separator: true },
      { label: 'Show Clip Keyframes', submenu: [
        { label: display.keyframes ? 'Hide keyframes' : 'Show Opacity / Volume', checked: display.keyframes, onSelect: () => setDisplay({ ...display, keyframes: !display.keyframes }) },
      ] },
    ]);
    void at;
  };

  const nest = (ids: string[], name: string, replace: boolean) => {
    if (!comp) return;
    const result = nestClips(history.current(), comp.id, ids, name, replace);
    if (!result) return;
    history.commit(() => result.project, replace ? 'Nest' : 'Make Subcomp');
    setSelection(result.clipIds);
    if (!replace) openComp(result.compId);
  };

  const speedDialog = (clip: Clip, ids: string[]) => {
    if (!comp) return;
    setDialog(
      <SpeedDialog clip={clip} comp={comp} onClose={() => setDialog(null)} onSubmit={(draft) => {
        setDialog(null);
        editComp((current) => setSpeed(current, ids, { speed: draft.speed / 100, duration: draft.linked ? undefined : draft.duration, ripple: draft.ripple, reverse: draft.reverse, maintainPitch: draft.maintainPitch, interpolation: draft.interpolation, limit }), 'Speed / Duration');
      }} />,
    );
  };

  const gainDialog = (clips: Clip[]) => {
    setDialog(
      <AudioGainDialog clips={clips} onClose={() => setDialog(null)} onSubmit={async (draft) => {
        setDialog(null);
        if (!comp) return;
        if (draft.mode === 'set' || draft.mode === 'adjust') {
          const factor = 10 ** (draft.db / 20);
          editComp((current) => ({ ...current, clips: current.clips.map((clip) => (clips.some((item) => item.id === clip.id) ? { ...clip, volume: clamp(draft.mode === 'set' ? factor : clip.volume * factor, 0, 8) } : clip)) }), 'Audio Gain');
          return;
        }
        const targets = draft.mode === 'normalizeAll' ? clips : clips.slice(0, 1);
        for (const clip of targets) {
          if (clip.source.type !== 'media') continue;
          const asset = assetMap.get(clip.source.assetId);
          if (!asset?.hasAudio) continue;
          try {
            const peak = await api.audioPeak(asset.id, clip.in, sourceOut(clip));
            const gain = clamp(10 ** ((draft.db - peak) / 20), 0, 8);
            editComp((current) => ({ ...current, clips: current.clips.map((item) => (item.id === clip.id ? { ...item, volume: gain } : item)) }), 'Normalize');
          } catch (error) {
            toast({ tone: 'error', title: 'Could not measure the peak', body: errorText(error) });
          }
        }
      }} />,
    );
  };

  const sceneDialog = (clip: Clip) => {
    if (clip.source.type !== 'media') return;
    const assetId = clip.source.assetId;
    setDialog(
      <SceneDetectionDialog busy={false} onClose={() => setDialog(null)} onSubmit={async (action, sensitivity) => {
        setDialog(null);
        try {
          const cuts = await api.detectScenes(assetId, clip.in, sourceOut(clip), sensitivity);
          const times = cuts.map((sourceTime) => clip.start + (sourceTime - clip.in) / clip.speed).filter((at) => at > clip.start + 0.05 && at < clipEnd(clip) - 0.05);
          if (!times.length) return toast({ tone: 'info', title: 'No scene changes found' });
          if (action === 'markers') editComp((current) => ({ ...current, markers: [...current.markers, ...times.map((at) => ({ id: uid(), time: at, name: 'Scene', color: '#4EA3FF' }))].sort((a, b) => a.time - b.time) }), 'Scene Markers');
          else editComp((current) => times.reduce((next, at) => razor(next, at, null, [clip.id]), current), 'Scene Cuts');
          toast({ tone: 'success', title: `${times.length} scene changes`, body: action === 'markers' ? 'Markers added' : 'Cuts applied' });
        } catch (error) {
          toast({ tone: 'error', title: 'Scene detection failed', body: errorText(error) });
        }
      }} />,
    );
  };

  const relink = async (clip: Clip) => {
    if (clip.source.type !== 'media') return;
    const asset = assetMap.get(clip.source.assetId);
    const picked = await openDialog({ title: `Link media for ${asset?.name ?? 'clip'}`, multiple: false, filters: [{ name: 'Media', extensions: info?.extensions ?? ['mp4'] }] });
    if (typeof picked !== 'string') return;
    try {
      await api.libraryRelink(clip.source.assetId, picked);
      await refreshAssets();
      history.commit((current) => ({ ...current, media: current.media.map((ref) => (ref.assetId === (clip.source as { assetId: string }).assetId ? { ...ref, offline: false } : ref)) }), 'Link Media');
      toast({ tone: 'success', title: 'Media relinked', body: picked.split(/[\\/]/).pop() });
    } catch (error) {
      toast({ tone: 'error', title: 'Could not link that file', body: errorText(error) });
    }
  };

  /** Renders one clip (with its effects) to a new file and points the clip at it. */
  const renderAndReplace = async (clip: Clip) => {
    if (!comp) return;
    const folder = settingsRef.current.export.folder ?? '';
    const name = `${safeFileName(comp.name)}-${clip.id.slice(0, 6)}.mp4`;
    const path = await saveDialog({ title: 'Render and Replace', defaultPath: folder ? `${folder}\\${name}` : name, filters: [{ name: 'MP4 video', extensions: ['mp4'] }] });
    if (!path) return;
    const single = { ...newComp({ name: `${comp.name} render`, width: comp.width, height: comp.height, fps: comp.fps }) };
    const rendered = placeClips(single, [{ ...clip, id: uid(), start: 0, trackId: tracksOf(single, tracksOf(comp, 'video').some((track) => track.id === clip.trackId) ? 'video' : 'audio')[0].id, linkId: null }], 'overwrite');
    const staging: Project = { ...history.current(), comps: [...history.current().comps, rendered] };
    try {
      await api.exportStart(staging, { output: path, compId: rendered.id, resolution: null, fps: null, quality: 'high', inToOut: false });
      toast({ tone: 'info', title: 'Rendering…', body: 'The clip is replaced when the render finishes.' });
      const done = (job: Job) => job.kind === 'export' && job.status === 'done' && job.result?.path === path;
      const unlisten = await events.job(async (job) => {
        if (!done(job)) return;
        const result = await api.libraryImport([path]);
        await refreshAssets();
        const asset = [...result.imported, ...result.existing][0];
        if (asset) {
          renderOriginals.current.set(clip.id, clip.source);
          history.commit((current) => updateComp({ ...current, media: [...current.media, { assetId: asset.id, folderId: null, offline: false }] }, comp.id, (target) => ({
            ...target,
            clips: target.clips.map((item) => (item.id === clip.id ? { ...item, source: { type: 'media', assetId: asset.id }, in: 0, effects: { ...DEFAULT_EFFECTS }, transform: { ...DEFAULT_TRANSFORM, fit: item.transform.fit }, speed: 1, keyframes: { x: [], y: [], scale: [], rotation: [], opacity: [], volume: [] } } : item)),
          })), 'Render and Replace');
          toast({ tone: 'success', title: 'Rendered and replaced', body: asset.name });
        }
        unlisten();
      });
    } catch (error) {
      toast({ tone: 'error', title: 'Could not render', body: errorText(error) });
    }
  };

  const trackMenu = (event: React.MouseEvent, trackId: string) => {
    if (!comp) return;
    const track = comp.tracks.find((item) => item.id === trackId);
    if (!track) return;
    showMenu(event, [
      { label: 'Rename…', onSelect: () => setDialog(<RenameDialog title="Rename Track" name={track.name || trackLabel(comp, trackId)} onClose={() => setDialog(null)} onSubmit={(name) => { setDialog(null); editComp((current) => updateTrack(current, trackId, { name }), 'Rename Track'); }} />) },
      { separator: true },
      { label: `Add ${track.kind === 'video' ? 'Video' : 'Audio'} Track`, onSelect: () => editComp((current) => addTracks(current, track.kind, 1, trackId).comp, 'Add Track') },
      { label: 'Add Tracks…', onSelect: () => setDialog(<RenameDialog title="Add Tracks" name="1" onClose={() => setDialog(null)} onSubmit={(value) => { setDialog(null); editComp((current) => addTracks(current, track.kind, Math.max(1, Math.min(20, Number(value) || 1)), trackId).comp, 'Add Tracks'); }} />) },
      { label: 'Delete Track', onSelect: () => editComp((current) => deleteTracks(current, [trackId]), 'Delete Track') },
      { label: 'Delete Empty Tracks', onSelect: () => editComp((current) => deleteTracks(current, emptyTracks(current)), 'Delete Empty Tracks') },
      { separator: true },
      { label: 'Lock Track', checked: track.locked, onSelect: () => editComp((current) => updateTrack(current, trackId, { locked: !track.locked }), 'Lock Track') },
      { label: 'Sync Lock', checked: track.syncLock, onSelect: () => editComp((current) => updateTrack(current, trackId, { syncLock: !track.syncLock }), 'Sync Lock') },
      { label: 'Target Track', checked: track.targeted, onSelect: () => editComp((current) => updateTrack(current, trackId, { targeted: !track.targeted }), 'Target Track') },
      ...(track.kind === 'video'
        ? [{ label: 'Toggle Track Output', checked: !track.hidden, onSelect: () => editComp((current) => updateTrack(current, trackId, { hidden: !track.hidden }), 'Track Output') } as MenuItem]
        : [
            { label: 'Mute Track', checked: track.muted, onSelect: () => editComp((current) => updateTrack(current, trackId, { muted: !track.muted }), 'Mute Track') } as MenuItem,
            { label: 'Solo Track', checked: track.solo, onSelect: () => editComp((current) => updateTrack(current, trackId, { solo: !track.solo }), 'Solo Track') } as MenuItem,
            { label: recordingTrack === trackId ? 'Stop Voice-over' : 'Voice-over Record', onSelect: () => void voiceOver(trackId) } as MenuItem,
          ]),
    ]);
  };

  const emptyMenu = (event: React.MouseEvent, trackId: string | null, at: number) => {
    if (!comp) return;
    showMenu(event, [
      { label: 'Paste', shortcut: 'Ctrl+V', disabled: !clipboard.current, onSelect: () => paste(false) },
      { label: 'Paste Insert', shortcut: 'Ctrl+Shift+V', disabled: !clipboard.current, onSelect: () => paste(true) },
      { separator: true },
      { label: 'Ripple Delete', disabled: !trackId, onSelect: () => trackId && editComp((current) => {
        const gapTrack = current.clips.some((clip) => clip.trackId === trackId) ? trackId : null;
        return gapTrack ? removeRange(current, at, at, 'extract') : current;
      }, 'Ripple Delete') },
      { label: 'Add Marker', shortcut: 'M', onSelect: addMarker },
      { separator: true },
      { label: 'Zoom to Sequence', shortcut: '\\', onSelect: () => timelineApi.current?.fit() },
      { label: 'Comp Settings…', onSelect: () => compSettings() },
    ]);
  };

  const compSettings = () => {
    if (!comp) return;
    setDialog(
      <CompDialog title="Comp Settings" draft={{ name: comp.name, width: comp.width, height: comp.height, fps: comp.fps }} onClose={() => setDialog(null)}
        onSubmit={(draft: CompDraft) => { setDialog(null); editComp((current) => ({ ...current, ...draft }), 'Comp Settings'); }} />,
    );
  };

  /** After Effects-style Project Settings: the real current project, not the app settings. */
  const projectSettings = () => {
    setDialog(
      <ProjectSettingsDialog project={project} comp={comp} filePath={settingsRef.current.projectPath} onClose={() => setDialog(null)}
        onSubmit={(result: ProjectSettingsResult) => {
          setDialog(null);
          if (result.activeCompId && result.activeCompId !== project.activeCompId) {
            history.view((current) => ({
              ...current,
              activeCompId: result.activeCompId,
              openCompIds: current.openCompIds.includes(result.activeCompId!) ? current.openCompIds : [...current.openCompIds, result.activeCompId!],
            }));
          }
          history.commit((current) => {
            const next = { ...current, name: result.name, captionStyle: result.captionStyle };
            return result.activeCompId
              ? updateComp(next, result.activeCompId, (target) => ({ ...target, width: result.width, height: result.height, fps: result.fps }))
              : next;
          }, 'Project Settings');
        }} />,
    );
  };

  const newCompDialog = () => {
    setDialog(
      <CompDialog title="New Comp" draft={{ name: `Comp ${project.comps.length + 1}`, width: comp?.width ?? 1920, height: comp?.height ?? 1080, fps: comp?.fps ?? 30 }} onClose={() => setDialog(null)}
        onSubmit={(draft: CompDraft) => {
          setDialog(null);
          const created = newComp(draft);
          created.folderId = binFolder;
          history.commit((current) => ({ ...current, comps: [...current.comps, created], activeCompId: created.id, openCompIds: [...current.openCompIds, created.id] }), 'New Comp');
          setSelection([]);
          playhead.seek(0);
        }} />,
    );
  };

  const newItemDialog = (kind: ItemKind) => {
    const base = newItem(kind, { width: comp?.width ?? 1920, height: comp?.height ?? 1080 });
    setDialog(
      <ItemDialog draft={{ kind, name: base.name, color: base.color, duration: base.duration, width: base.width, height: base.height }} onClose={() => setDialog(null)}
        onSubmit={(draft: ItemDraft) => {
          setDialog(null);
          const item = { ...base, ...draft, folderId: binFolder };
          history.commit((current) => ({ ...current, items: [...current.items, item] }), `New ${ITEM_LABEL[kind]}`);
          setBinSelection([item.id]);
        }} />,
    );
  };

  const newFolder = () => setDialog(
    <RenameDialog title="New Folder" name="Folder" onClose={() => setDialog(null)} onSubmit={(name) => {
      setDialog(null);
      const folder = { id: uid(), name, parentId: binFolder };
      history.commit((current) => ({ ...current, folders: [...current.folders, folder] }), 'New Folder');
    }} />,
  );

  const newItemMenu: MenuItem[] = [
    { label: 'Comp…', shortcut: 'Ctrl+N', onSelect: newCompDialog },
    { separator: true },
    ...(['adjustment-layer', 'bars-and-tone', 'black-video', 'color-matte', 'transparent-video', 'countdown'] as ItemKind[]).map((kind) => ({ label: `${ITEM_LABEL[kind]}…`, onSelect: () => newItemDialog(kind) })),
  ];

  const deleteBinItems = (ids: string[]) => {
    if (!ids.length) return;
    const inUse = ids.filter((id) => project.comps.some((item) => item.clips.some((clip) => (clip.source.type === 'media' && clip.source.assetId === id) || (clip.source.type === 'comp' && clip.source.compId === id) || (clip.source.type === 'item' && clip.source.itemId === id))));
    const remove = () => {
      history.commit((current) => {
        const comps = current.comps.filter((item) => !ids.includes(item.id)).map((item) => ({
          ...item,
          clips: item.clips.filter((clip) => !((clip.source.type === 'media' && ids.includes(clip.source.assetId)) || (clip.source.type === 'comp' && ids.includes(clip.source.compId)) || (clip.source.type === 'item' && ids.includes(clip.source.itemId)))),
        }));
        const kept = comps.length ? comps : [newComp({ name: 'Comp 1' })];
        return {
          ...current,
          comps: kept,
          items: current.items.filter((item) => !ids.includes(item.id)),
          media: current.media.filter((ref) => !ids.includes(ref.assetId)),
          folders: current.folders.filter((folder) => !ids.includes(folder.id)),
          activeCompId: kept.some((item) => item.id === current.activeCompId) ? current.activeCompId : kept[0].id,
          openCompIds: current.openCompIds.filter((id) => kept.some((item) => item.id === id)),
        };
      }, 'Delete');
      setBinSelection([]);
    };
    if (!inUse.length) return remove();
    setDialog(
      <ConfirmDialog title="Delete from project" body={`${inUse.length} of these are used on a timeline. Deleting removes those clips too. The files on disk are never deleted.`} confirmLabel="Delete"
        onConfirm={() => { setDialog(null); remove(); }} onClose={() => setDialog(null)} />,
    );
  };

  const binEntryMenu = (event: React.MouseEvent, ids: string[]) => {
    const compEntry = project.comps.find((item) => ids.includes(item.id));
    const assetEntry = assets.find((asset) => ids.includes(asset.id));
    const itemEntry = project.items.find((item) => ids.includes(item.id));
    showMenu(event, [
      ...(compEntry ? [{ label: 'Open in Timeline', onSelect: () => openComp(compEntry.id) } as MenuItem, { label: 'Comp Settings…', onSelect: () => { openComp(compEntry.id); compSettings(); } } as MenuItem] : []),
      ...(assetEntry ? [{ label: 'Open in Source Monitor', onSelect: () => openInSource(assetEntry.id) } as MenuItem] : []),
      { label: 'Rename…', onSelect: () => setDialog(
        <RenameDialog title="Rename" name={compEntry?.name ?? itemEntry?.name ?? assetEntry?.name ?? ''} onClose={() => setDialog(null)} onSubmit={(name) => {
          setDialog(null);
          history.commit((current) => ({
            ...current,
            comps: current.comps.map((item) => (ids.includes(item.id) ? { ...item, name } : item)),
            items: current.items.map((item) => (ids.includes(item.id) ? { ...item, name } : item)),
            folders: current.folders.map((item) => (ids.includes(item.id) ? { ...item, name } : item)),
          }), 'Rename');
        }} />) },
      { label: 'Duplicate', disabled: !compEntry && !itemEntry, onSelect: () => history.commit((current) => ({
        ...current,
        comps: compEntry ? [...current.comps, { ...compEntry, id: uid(), name: `${compEntry.name} copy`, clips: compEntry.clips.map((clip) => ({ ...clip, id: uid() })) }] : current.comps,
        items: itemEntry ? [...current.items, { ...itemEntry, id: uid(), name: `${itemEntry.name} copy` }] : current.items,
      }), 'Duplicate') },
      { separator: true },
      { label: 'New Folder with Selection', onSelect: () => setDialog(<RenameDialog title="New Folder" name="Folder" onClose={() => setDialog(null)} onSubmit={(name) => {
        setDialog(null);
        const folder = { id: uid(), name, parentId: binFolder };
        history.commit((current) => ({
          ...current,
          folders: [...current.folders, folder],
          comps: current.comps.map((item) => (ids.includes(item.id) ? { ...item, folderId: folder.id } : item)),
          items: current.items.map((item) => (ids.includes(item.id) ? { ...item, folderId: folder.id } : item)),
          media: current.media.map((ref) => (ids.includes(ref.assetId) ? { ...ref, folderId: folder.id } : ref)),
        }), 'New Folder');
      }} />) },
      { label: 'Move to Project Root', onSelect: () => history.commit((current) => ({
        ...current,
        comps: current.comps.map((item) => (ids.includes(item.id) ? { ...item, folderId: null } : item)),
        items: current.items.map((item) => (ids.includes(item.id) ? { ...item, folderId: null } : item)),
        media: current.media.map((ref) => (ids.includes(ref.assetId) ? { ...ref, folderId: null } : ref)),
      }), 'Move') },
      { separator: true },
      ...(assetEntry ? [
        { label: 'Reveal in Explorer', onSelect: () => void api.revealPath(assetEntry.path) } as MenuItem,
        { label: 'Make Offline…', onSelect: () => history.commit((current) => ({ ...current, media: current.media.map((ref) => (ids.includes(ref.assetId) ? { ...ref, offline: true } : ref)) }), 'Make Offline') } as MenuItem,
      ] : []),
      { label: 'Delete', shortcut: 'Delete', onSelect: () => deleteBinItems(ids) },
    ]);
  };

  const binPanelMenu = (event: React.MouseEvent) => showMenu(event, [
    { label: 'Paste', disabled: true },
    { separator: true },
    { label: 'New Comp…', shortcut: 'Ctrl+N', onSelect: newCompDialog },
    { label: 'New Folder', shortcut: 'Ctrl+/', onSelect: newFolder },
    { label: 'New Item', submenu: newItemMenu },
    { separator: true },
    { label: 'Import…', shortcut: 'Ctrl+I', onSelect: () => void pickFiles() },
    { label: 'Find…', shortcut: 'Ctrl+F', onSelect: () => (document.querySelector('[data-role="bin-search"]') as HTMLInputElement | null)?.focus() },
    { separator: true },
    { label: 'Reveal Project in Explorer', disabled: !settings.projectPath, onSelect: () => settings.projectPath && void api.revealPath(settings.projectPath) },
  ]);

  // ── menus ──────────────────────────────────────────────────────────────
  const hasClips = !!comp && comp.clips.length > 0;
  const menus: MenuGroup[] = [
    { label: 'File', items: [
      { label: 'New Project', shortcut: 'Ctrl+Alt+N', onSelect: newProjectNow },
      { label: 'New Comp…', shortcut: 'Ctrl+N', onSelect: newCompDialog },
      { label: 'New Item', submenu: newItemMenu.slice(2) },
      { separator: true },
      { label: 'Open Project…', shortcut: 'Ctrl+O', onSelect: () => void openProject() },
      { label: 'Open Recent', disabled: !settings.recentProjects.length, submenu: settings.recentProjects.map((path) => ({ label: path.split(/[\\/]/).pop() ?? path, onSelect: () => guardUnsaved(() => void openProjectFile(path), 'Open another project') })) },
      { separator: true },
      { label: 'Save', shortcut: 'Ctrl+S', onSelect: () => void saveProject() },
      { label: 'Save As…', shortcut: 'Ctrl+Shift+S', onSelect: () => void saveAs() },
      { label: 'Save a Copy…', shortcut: 'Ctrl+Alt+S', onSelect: () => void saveAs(false) },
      { label: 'Revert', disabled: !settings.projectPath || !dirty, onSelect: () => settings.projectPath && void openProjectFile(settings.projectPath) },
      { separator: true },
      { label: 'Import…', shortcut: 'Ctrl+I', onSelect: () => void pickFiles() },
      { label: 'Export', submenu: [
        { label: 'Media…', shortcut: 'Ctrl+M', disabled: !hasClips, onSelect: () => setExportOpen(true) },
        { label: 'Frame…', shortcut: 'Ctrl+Shift+E', disabled: !hasClips, onSelect: () => void exportFrame() },
      ] },
      { separator: true },
      { label: 'Project Settings…', onSelect: projectSettings },
      { label: 'Reveal Project Data Folder', onSelect: () => info && void api.openPath(info.dataDir) },
      { separator: true },
      { label: 'Exit', shortcut: 'Ctrl+Q', onSelect: () => void getCurrentWindow().close() },
    ] },
    { label: 'Edit', items: [
      { label: `Undo${history.undoLabel && history.canUndo ? ` ${history.undoLabel}` : ''}`, shortcut: 'Ctrl+Z', disabled: !history.canUndo, onSelect: history.undo },
      { label: `Redo${history.redoLabel ? ` ${history.redoLabel}` : ''}`, shortcut: 'Ctrl+Shift+Z', disabled: !history.canRedo, onSelect: history.redo },
      { separator: true },
      { label: 'Cut', shortcut: 'Ctrl+X', disabled: !selection.length, onSelect: () => copySelection(true) },
      { label: 'Copy', shortcut: 'Ctrl+C', disabled: !selection.length, onSelect: () => copySelection(false) },
      { label: 'Paste', shortcut: 'Ctrl+V', disabled: !clipboard.current, onSelect: () => paste(false) },
      { label: 'Paste Insert', shortcut: 'Ctrl+Shift+V', disabled: !clipboard.current, onSelect: () => paste(true) },
      { label: 'Clear', shortcut: 'Delete', disabled: !selection.length, onSelect: () => deleteSelection(false) },
      { label: 'Ripple Delete', shortcut: 'Shift+Delete', disabled: !selection.length, onSelect: () => deleteSelection(true) },
      { label: 'Duplicate', shortcut: 'Ctrl+Shift+/', disabled: !selection.length, onSelect: () => {
        if (!comp) return;
        const result = moveClips(comp, linkedSelection ? withLinked(comp, selection) : selection, Math.max(...selectedClips.map(clipEnd)) - Math.min(...selectedClips.map((clip) => clip.start)), { video: 0, audio: 0 }, 'overwrite', true);
        if (result) {
          editComp(() => result.comp, 'Duplicate');
          setSelection(result.ids);
        }
      } },
      { separator: true },
      { label: 'Select All', shortcut: 'Ctrl+A', onSelect: () => comp && setSelection(comp.clips.map((clip) => clip.id)) },
      { label: 'Deselect All', shortcut: 'Ctrl+Shift+A', onSelect: () => { setSelection([]); setTransitionSelection(null); } },
      { label: 'Find…', shortcut: 'Ctrl+F', onSelect: () => { showPanel('project', 'project'); (document.querySelector('[data-role="bin-search"]') as HTMLInputElement | null)?.focus(); } },
      { separator: true },
      { label: 'Keyboard Shortcuts…', shortcut: 'Ctrl+Alt+K', onSelect: () => setShortcutsOpen(true) },
      { label: 'Settings…', shortcut: 'Ctrl+,', onSelect: () => setSettingsTab('providers') },
    ] },
    { label: 'Clip', items: [
      { label: 'Generate Sound for Selection', disabled: !selectedClips.length, submenu: soundSelectionMenu(selection) },
      { label: 'Speed/Duration…', shortcut: 'Ctrl+R', disabled: !selectedClips.length, onSelect: () => selectedClips[0] && speedDialog(selectedClips[0], selection) },
      { label: 'Audio Gain…', shortcut: 'Shift+G', disabled: !selectedClips.length, onSelect: () => gainDialog(selectedClips) },
      { label: 'Audio Channels…', disabled: !selectedClips.length, onSelect: () => selectedClips[0] && setDialog(<ChannelsDialog clip={selectedClips[0]} onClose={() => setDialog(null)} onSubmit={(channels) => { setDialog(null); editComp((current) => ({ ...current, clips: current.clips.map((item) => (selection.includes(item.id) ? { ...item, channels } : item)) }), 'Audio Channels'); }} />) },
      { separator: true },
      { label: 'Enable', shortcut: 'Shift+E', disabled: !selectedClips.length, checked: selectedClips.every((clip) => clip.enabled), onSelect: () => editComp((current) => ({ ...current, clips: current.clips.map((clip) => (selection.includes(clip.id) ? { ...clip, enabled: !selectedClips.every((item) => item.enabled) } : clip)) }), 'Enable') },
      {
        label: 'Link / Unlink',
        shortcut: 'Ctrl+L',
        disabled: !selectedClips.length,
        onSelect: () => {
          const wasLinked = selectedClips.some((clip) => clip.linkId);
          editComp((current) => setLinked(current, selection, !wasLinked), wasLinked ? 'Unlink' : 'Link');
          // Same reason as the clip menu: after unlinking, keep only the first of the pair.
          if (wasLinked && selection.length > 1) setSelection([selection[0]]);
        },
      },
      { label: 'Group', shortcut: 'Ctrl+G', disabled: selection.length < 2, onSelect: () => editComp((current) => setGrouped(current, selection, true), 'Group') },
      { label: 'Ungroup', shortcut: 'Ctrl+Shift+G', disabled: !selectedClips.some((clip) => clip.groupId), onSelect: () => editComp((current) => setGrouped(current, selection, false), 'Ungroup') },
      { label: 'Nest…', disabled: !selection.length, onSelect: () => setDialog(<RenameDialog title="Nest" name="Nested Comp" onClose={() => setDialog(null)} onSubmit={(name) => { setDialog(null); nest(selection, name, true); }} />) },
      { separator: true },
      { label: 'Add Frame Hold', disabled: !selection.length, onSelect: () => editComp((current) => addFrameHold(current, selection, playhead.get()), 'Add Frame Hold') },
      { label: 'Scale to Frame Size', disabled: !selection.length, onSelect: () => editComp((current) => ({ ...current, clips: current.clips.map((clip) => (selection.includes(clip.id) ? { ...clip, transform: { ...clip.transform, fit: 'fit', scale: 100 } } : clip)) }), 'Scale to Frame Size') },
      { label: 'Fill Frame', disabled: !selection.length, onSelect: () => editComp((current) => ({ ...current, clips: current.clips.map((clip) => (selection.includes(clip.id) ? { ...clip, transform: { ...clip.transform, fit: 'fill', scale: 100 } } : clip)) }), 'Fill Frame') },
      { separator: true },
      { label: 'Open in Source Monitor', disabled: selectedClips[0]?.source.type !== 'media', onSelect: () => {
        const clip = selectedClips[0];
        if (clip?.source.type === 'media') openInSource(clip.source.assetId, { in: clip.in, out: sourceOut(clip) });
      } },
      { label: 'Match Frame', shortcut: 'F', disabled: !comp, onSelect: matchFrame },
    ] },
    { label: 'Comp', items: [
      { label: 'Create Stick Figure…', disabled: !comp, onSelect:()=>setDialog(<StickFigureDialog onClose={()=>setDialog(null)} onCreate={(motion,duration,color,thickness)=>{if(!comp)return;const figure=makeStickFigure(comp.width,comp.height,comp.fps,motion,duration,color,thickness);history.commit(current=>({...current,comps:[...current.comps,figure],activeCompId:figure.id,openCompIds:[...current.openCompIds,figure.id]}),'Create Stick Figure');setDialog(null);setSelection([]);}}/>) },
      { label: 'Comp Settings…', disabled: !comp, onSelect: compSettings },
      { label: 'Add Edit', shortcut: 'Ctrl+K', disabled: !hasClips, onSelect: () => addEdit(false) },
      { label: 'Add Edit to All Tracks', shortcut: 'Ctrl+Shift+K', disabled: !hasClips, onSelect: () => addEdit(true) },
      { label: 'Trim Edit', submenu: [
        { label: 'Ripple Trim Previous Edit to Playhead', shortcut: 'Q', onSelect: () => trimToPlayhead('previous', true) },
        { label: 'Ripple Trim Next Edit to Playhead', shortcut: 'W', onSelect: () => trimToPlayhead('next', true) },
        { label: 'Extend Previous Edit to Playhead', shortcut: 'Shift+Q', onSelect: () => trimToPlayhead('previous', false) },
        { label: 'Extend Next Edit to Playhead', shortcut: 'Shift+W', onSelect: () => trimToPlayhead('next', false) },
      ] },
      { separator: true },
      { label: 'Apply Video Transition', shortcut: 'Ctrl+D', disabled: !selection.length, onSelect: () => editComp((current) => transitionsOnSelection(current, selection, { video: 'cross-dissolve', audio: 'constant-power' }, 1), 'Apply Transition') },
      { label: 'Apply Audio Transition', shortcut: 'Ctrl+Shift+D', disabled: !selection.length, onSelect: () => editComp((current) => transitionsOnSelection(current, selection, { video: 'cross-dissolve', audio: 'constant-power' }, 1), 'Apply Transition') },
      { separator: true },
      { label: 'Lift', shortcut: ';', onSelect: () => removeRangeNow('lift') },
      { label: 'Extract', shortcut: "'", onSelect: () => removeRangeNow('extract') },
      { separator: true },
      { label: 'Add Tracks…', disabled: !comp, onSelect: () => comp && editComp((current) => addTracks(current, 'video', 1).comp, 'Add Track') },
      { label: 'Delete Empty Tracks', disabled: !comp, onSelect: () => editComp((current) => deleteTracks(current, emptyTracks(current)), 'Delete Empty Tracks') },
      { separator: true },
      { label: 'Snap in Timeline', shortcut: 'S', checked: snapping, onSelect: () => setSnapping((value) => !value) },
      { label: 'Linked Selection', checked: linkedSelection, onSelect: () => setLinkedSelection((value) => !value) },
      { label: 'Zoom In', shortcut: '=', onSelect: () => timelineApi.current?.zoomBy(1.3) },
      { label: 'Zoom Out', shortcut: '-', onSelect: () => timelineApi.current?.zoomBy(1 / 1.3) },
      { label: 'Zoom to Sequence', shortcut: '\\', onSelect: () => timelineApi.current?.toggleFit() },
    ] },
    { label: 'Markers', items: [
      { label: 'Mark In', shortcut: 'I', onSelect: markIn },
      { label: 'Mark Out', shortcut: 'O', onSelect: markOut },
      { label: 'Mark Clip', shortcut: 'X', onSelect: markClip },
      { label: 'Mark Selection', shortcut: '/', disabled: !selection.length, onSelect: markSelection },
      { separator: true },
      { label: 'Go to In', shortcut: 'Shift+I', onSelect: () => playhead.seek(comp?.inPoint ?? 0) },
      { label: 'Go to Out', shortcut: 'Shift+O', onSelect: () => playhead.seek(comp?.outPoint ?? (comp ? compDuration(comp) : 0)) },
      { label: 'Clear In', shortcut: 'Ctrl+Shift+I', onSelect: () => editComp((current) => ({ ...current, inPoint: null }), 'Clear In') },
      { label: 'Clear Out', shortcut: 'Ctrl+Shift+O', onSelect: () => editComp((current) => ({ ...current, outPoint: null }), 'Clear Out') },
      { label: 'Clear In and Out', shortcut: 'Ctrl+Shift+X', onSelect: clearInOut },
      { separator: true },
      { label: 'Add Marker', shortcut: 'M', onSelect: addMarker },
      { label: 'Go to Next Marker', shortcut: 'Shift+M', onSelect: () => { const target = nextPoint(comp?.markers.map((marker) => marker.time) ?? [], playhead.get(), 1); if (target !== null) playhead.seek(target); } },
      { label: 'Go to Previous Marker', shortcut: 'Ctrl+Shift+M', onSelect: () => { const target = nextPoint(comp?.markers.map((marker) => marker.time) ?? [], playhead.get(), -1); if (target !== null) playhead.seek(target); } },
      { label: 'Clear Current Marker', shortcut: 'Ctrl+Alt+M', onSelect: () => editComp((current) => toggleMarker(current, playhead.get()), 'Clear Marker') },
      { label: 'Clear All Markers', shortcut: 'Ctrl+Alt+Shift+M', disabled: !comp?.markers.length, onSelect: () => editComp((current) => ({ ...current, markers: [] }), 'Clear All Markers') },
      { label: 'Edit Marker…', disabled: !comp?.markers.length, onSelect: () => {
        const marker = comp?.markers.reduce((closest, item) => (Math.abs(item.time - playhead.get()) < Math.abs(closest.time - playhead.get()) ? item : closest), comp.markers[0]);
        if (marker) markerDialog(marker.id);
      } },
    ] },
    { label: 'Graphics and Titles', items: [
      { label: 'New Text Layer', shortcut: 'Ctrl+T', onSelect: () => addText('title') },
      { label: 'New Kinetic Text', onSelect: () => addText('kinetic') },
      { label: 'New Lower Third', onSelect: () => addText('lower-third') },
      { label: 'New Caption', onSelect: () => addText('caption') },
      { separator: true },
      { label: 'New Rectangle', shortcut: 'Ctrl+Alt+R', onSelect: () => { setTool('rectangle'); showPanel('program'); } },
      { label: 'New Ellipse', shortcut: 'Ctrl+Alt+E', onSelect: () => { setTool('ellipse'); showPanel('program'); } },
      { label: 'New Polygon', onSelect: () => { setTool('polygon'); showPanel('program'); } },
      { separator: true },
      { label: 'Caption Styles…', onSelect: () => showPanel('project', 'graphics') },
      { label: 'Import Captions…', onSelect: () => showPanel('project', 'graphics') },
    ] },
    { label: 'View', items: [
      ...(Object.keys(TOOL_LABEL) as Tool[]).slice(0, 9).map((id) => ({ label: TOOL_LABEL[id], checked: tool === id, onSelect: () => setTool(id) })),
      { separator: true },
      { label: 'Mute All Audio', checked: mutes.all, onSelect: () => setMuteState({ ...mutes, all: !mutes.all }) },
      { label: 'Mute Program Monitor', checked: mutes.program, onSelect: () => setMuteState({ ...mutes, program: !mutes.program }) },
      { label: 'Mute Source Monitor', checked: mutes.source, onSelect: () => setMuteState({ ...mutes, source: !mutes.source }) },
      { separator: true },
      { label: 'Show Video Thumbnails', checked: display.thumbnails, onSelect: () => setDisplay({ ...display, thumbnails: !display.thumbnails }) },
      { label: 'Show Audio Waveform', checked: display.waveforms, onSelect: () => setDisplay({ ...display, waveforms: !display.waveforms }) },
      { label: 'Show Clip Keyframes', checked: display.keyframes, onSelect: () => setDisplay({ ...display, keyframes: !display.keyframes }) },
      { separator: true },
      { label: 'Expand All Tracks', shortcut: 'Shift+=', onSelect: () => trackHeights('all', 40) },
      { label: 'Minimize All Tracks', shortcut: 'Shift+-', onSelect: () => trackHeights('all', -40) },
    ] },
    { label: 'Learning', items: [{label:'Reference learning workspace…',onSelect:()=>setLearningOpen(true)}] },
    { label: 'Window', items: [
      ...([['project', 'Project', 'Shift+1'], ['source', 'Source Monitor', 'Shift+2'], ['timeline', 'Timeline', 'Shift+3'], ['program', 'Program Monitor', 'Shift+4'], ['properties', 'Properties', 'Shift+5'], ['meters', 'Audio Meters', 'Shift+6'], ['tools', 'Tools', 'Shift+7'], ['chat', 'Helios AI', 'Ctrl+Alt+L']] as [PanelId, string, string][]).map(([id, label, shortcut]) => ({
        label, shortcut, checked: !hidden(id), onSelect: () => setPanelVisible(id, hidden(id)),
      })),
      { separator: true },
      { label: maximized ? 'Restore Panel Size' : 'Maximize Panel Under Cursor', shortcut: '`', onSelect: () => toggleMax(maximized ?? focused) },
      { label: 'Reset Workspace', onSelect: () => { setLayout(DEFAULT_LAYOUT); setMaximized(null); } },
    ] },
    { label: 'Help', items: [
      { label: 'Keyboard Shortcuts', shortcut: 'Ctrl+Alt+K', onSelect: () => setShortcutsOpen(true) },
      { label: 'AI Providers…', onSelect: () => setSettingsTab('providers') },
      { label: 'Speech & Voice…', onSelect: () => setSettingsTab('speech') },
      { label: 'FFmpeg & Media…', onSelect: () => setSettingsTab('media') },
      { label: 'About Helios', onSelect: () => setSettingsTab('about') },
    ] },
  ];

  function matchFrame() {
    if (!comp) return;
    const at = playhead.get();
    const clip = comp.clips.find((item) => item.start <= at && clipEnd(item) > at && item.source.type === 'media' && targetedTracks().includes(item.trackId))
      ?? comp.clips.find((item) => item.start <= at && clipEnd(item) > at && item.source.type === 'media');
    if (clip?.source.type === 'media') {
      openInSource(clip.source.assetId, { in: clip.in, out: sourceOut(clip) });
      toast({ tone: 'info', title: 'Matched frame', body: `${timecode(sourceTimeAt(clip, at), fps)} in the source`, timeout: 2000 });
    }
  }

  const markerDialog = (markerId: string) => {
    const marker = comp?.markers.find((item) => item.id === markerId);
    if (!marker || !comp) return;
    setDialog(
      <MarkerDialog marker={marker} comp={comp} onClose={() => setDialog(null)}
        onSubmit={(next) => { setDialog(null); editComp((current) => ({ ...current, markers: current.markers.map((item) => (item.id === markerId ? next : item)).sort((a, b) => a.time - b.time) }), 'Edit Marker'); }}
        onDelete={() => { setDialog(null); editComp((current) => ({ ...current, markers: current.markers.filter((item) => item.id !== markerId) }), 'Delete Marker'); }} />,
    );
  };

  // ── keyboard ───────────────────────────────────────────────────────────
  const keyHandler = useRef<(event: KeyboardEvent) => void>(() => undefined);
  keyHandler.current = (event: KeyboardEvent) => {
    const ctrl = event.ctrlKey || event.metaKey;
    const shift = event.shiftKey;
    const alt = event.altKey;
    const key = event.key.toLowerCase();
    const run = (action: () => void) => {
      event.preventDefault();
      action();
    };
    if (isTyping(event.target) || settingsTab || exportOpen || shortcutsOpen || dialog || menu) {
      if (event.key === 'Escape' && menu) setMenu(null);
      return;
    }
    // File and app-wide
    if (ctrl && alt && key === 'n') return run(newProjectNow);
    if (ctrl && !alt && key === 'n') return run(newCompDialog);
    if (ctrl && key === 'o') return run(() => void openProject());
    if (ctrl && alt && key === 's') return run(() => void saveAs(false));
    if (ctrl && shift && key === 's') return run(() => void saveAs());
    if (ctrl && key === 's') return run(() => void saveProject());
    if (ctrl && key === 'i') return run(() => void pickFiles());
    if (ctrl && shift && key === 'e') return run(() => void exportFrame());
    if (ctrl && key === 'm') return run(() => hasClips && setExportOpen(true));
    if (ctrl && key === 'q') return run(() => void getCurrentWindow().close());
    if (ctrl && key === '/') return run(newFolder);
    if (ctrl && alt && key === 'k') return run(() => setShortcutsOpen(true));
    if (ctrl && alt && key === 'l') return run(() => setPanelVisible('chat', hidden('chat')));
    if (ctrl && key === ',') return run(() => setSettingsTab('providers'));
    if (ctrl && key === 'f') return run(() => { showPanel('project', 'project'); (document.querySelector('[data-role="bin-search"]') as HTMLInputElement | null)?.focus(); });
    if (ctrl && (key === ' ' || event.code === 'Space')) {
      return run(() => {
        setFxConsoleAnchor(getLiveMousePos());
        setFxConsoleOpen((curr) => !curr);
      });
    }
    if (mode === 'home') return;
    // Edit
    if (ctrl && key === 'z') return run(() => (shift ? history.redo() : history.undo()));
    if (ctrl && key === 'y') return run(history.redo);
    if (ctrl && alt && key === 'v') return run(() => selectedClips[0] && clipMenu({ clientX: 200, clientY: 200 }, selectedClips[0].id, playhead.get()));
    if (ctrl && shift && key === 'v') return run(() => paste(true));
    if (ctrl && key === 'v') return run(() => paste(false));
    if (ctrl && key === 'c') return run(() => copySelection(false));
    if (ctrl && key === 'x') return run(() => copySelection(true));
    if (ctrl && shift && key === 'a') return run(() => { setSelection([]); setTransitionSelection(null); });
    if (ctrl && key === 'a') return run(() => comp && setSelection(comp.clips.map((clip) => clip.id)));
    if (ctrl && key === 'e') return run(() => {
      const clip = selectedClips[0];
      if (clip?.source.type === 'media') void api.openPath(assetMap.get(clip.source.assetId)?.path ?? '');
    });
    // Clip and comp
    if (ctrl && key === 'r') return run(() => selectedClips[0] && speedDialog(selectedClips[0], selection));
    if (ctrl && shift && key === 'g') return run(() => editComp((current) => setGrouped(current, selection, false), 'Ungroup'));
    if (ctrl && key === 'g') return run(() => editComp((current) => setGrouped(current, selection, true), 'Group'));
    if (ctrl && key === 'l') return run(() => editComp((current) => setLinked(current, selection, !selectedClips.some((clip) => clip.linkId)), 'Link'));
    if (ctrl && shift && key === 'k') return run(() => addEdit(true));
    if (ctrl && key === 'k') return run(() => addEdit(false));
    if (ctrl && shift && key === 'd') return run(() => editComp((current) => transitionsOnSelection(current, selection, { video: 'cross-dissolve', audio: 'constant-power' }, 1), 'Apply Transition'));
    if (ctrl && key === 'd') return run(() => editComp((current) => transitionsOnSelection(current, selection, { video: 'cross-dissolve', audio: 'constant-power' }, 1), 'Apply Transition'));
    if (ctrl && key === 't') return run(() => addText('title'));
    if (ctrl && alt && key === 'r') return run(() => setTool('rectangle'));
    if (ctrl && alt && key === 'e') return run(() => setTool('ellipse'));
    if (ctrl && shift && key === '/') return run(() => {
      if (!comp || !selection.length) return;
      const span = Math.max(...selectedClips.map(clipEnd)) - Math.min(...selectedClips.map((clip) => clip.start));
      const result = moveClips(comp, linkedSelection ? withLinked(comp, selection) : selection, span, { video: 0, audio: 0 }, 'overwrite', true);
      if (result) {
        editComp(() => result.comp, 'Duplicate');
        setSelection(result.ids);
      }
    });
    // Markers
    if (ctrl && shift && key === 'i') return run(() => editComp((current) => ({ ...current, inPoint: null }), 'Clear In'));
    if (ctrl && shift && key === 'o') return run(() => editComp((current) => ({ ...current, outPoint: null }), 'Clear Out'));
    if (ctrl && shift && key === 'x') return run(clearInOut);
    if (ctrl && alt && shift && key === 'm') return run(() => editComp((current) => ({ ...current, markers: [] }), 'Clear All Markers'));
    if (ctrl && alt && key === 'm') return run(() => editComp((current) => toggleMarker(current, playhead.get()), 'Clear Marker'));
    if (ctrl && shift && key === 'm') return run(() => { const target = nextPoint(comp?.markers.map((marker) => marker.time) ?? [], playhead.get(), -1); if (target !== null) playhead.seek(target); });
    // Track heights and panels
    if (ctrl && (key === '=' || key === '+')) return run(() => trackHeights('video', 16));
    if (ctrl && key === '-') return run(() => trackHeights('video', -16));
    if (alt && (key === '=' || key === '+')) return run(() => trackHeights('audio', 16));
    if (alt && key === '-') return run(() => trackHeights('audio', -16));
    if (shift && (key === '=' || key === '+')) return run(() => trackHeights('all', 40));
    if (shift && key === '_') return run(() => trackHeights('all', -40));
    if (shift && ['1', '2', '3', '4', '5', '6', '7'].includes(event.key)) {
      const panels: PanelId[] = ['project', 'source', 'timeline', 'program', 'properties', 'meters', 'tools'];
      return run(() => showPanel(panels[Number(event.key) - 1]));
    }
    if (ctrl) return;
    const sourceFocused = focused === 'source' && !!sourceAsset;
    // Transport and navigation
    switch (event.key) {
      case ' ':
        return run(() => (sourceFocused ? sourceApi.current?.toggle() : programApi.current?.toggle()));
      case 'ArrowLeft':
      case 'ArrowRight': {
        const direction = event.key === 'ArrowLeft' ? -1 : 1;
        if (alt) return run(() => nudge(direction * (shift ? 5 : 1)));
        const frames = (shift ? 5 : 1) * direction;
        return run(() => (sourceFocused ? sourceApi.current?.step(frames) : programApi.current?.step(frames)));
      }
      case 'ArrowUp':
        if (alt) return run(() => nudge(1, true));
        return run(() => goToPoint(-1, shift));
      case 'ArrowDown':
        if (alt) return run(() => nudge(-1, true));
        return run(() => goToPoint(1, shift));
      case 'Home':
        return run(() => playhead.seek(0));
      case 'End':
        return run(() => comp && playhead.seek(compDuration(comp)));
      case 'PageUp':
      case 'PageDown':
        return run(() => {
          const span = 5;
          playhead.seek(Math.max(0, playhead.get() + (event.key === 'PageDown' ? span : -span)));
        });
      case 'Delete':
      case 'Backspace':
        return run(() => deleteSelection(shift));
      case 'Escape':
        return run(() => { setSelection([]); setTransitionSelection(null); setTool('select'); });
      case '`':
      case '~':
        return run(() => {
          if (maximized) {
            setMaximized(null);
            return;
          }
          let target: PanelId | null = null;
          if (typeof document !== 'undefined') {
            const { x, y } = getLiveMousePos();
            const elements = document.elementsFromPoint(x, y);
            for (const el of elements) {
              const panelEl = el.closest('[data-panel]');
              const id = panelEl?.getAttribute('data-panel') as PanelId | null;
              if (id && ['chat', 'source', 'program', 'properties', 'project', 'timeline'].includes(id)) {
                target = id;
                break;
              }
            }
          }
          const panelToToggle = target ?? focused;
          setFocused(panelToToggle);
          toggleMax(panelToToggle);
        });
      case '=':
      case '+':
        return run(() => timelineApi.current?.zoomBy(1.3));
      case '-':
        return run(() => timelineApi.current?.zoomBy(1 / 1.3));
      case '\\':
        return run(() => timelineApi.current?.toggleFit());
      case ',':
        return run(() => sourceAsset && sourceEdit(sourceAsset, sourceRanges[sourceAsset.id] ?? { in: 0, out: sourceAsset.kind === 'image' ? STILL_DEFAULT : sourceAsset.duration }, 'insert'));
      case '.':
        return run(() => sourceAsset && sourceEdit(sourceAsset, sourceRanges[sourceAsset.id] ?? { in: 0, out: sourceAsset.kind === 'image' ? STILL_DEFAULT : sourceAsset.duration }, 'overwrite'));
      case ';':
        return run(() => removeRangeNow('lift'));
      case "'":
        return run(() => removeRangeNow('extract'));
      case '/':
        return run(markSelection);
      case '[':
        return run(() => clipVolume(shift ? -6 : -1));
      case ']':
        return run(() => clipVolume(shift ? 6 : 1));
      default:
        break;
    }
    switch (key) {
      case 'i':
        return run(() => (shift ? playhead.seek(comp?.inPoint ?? 0) : sourceFocused ? sourceApi.current?.markIn() : markIn()));
      case 'o':
        return run(() => (shift ? playhead.seek(comp?.outPoint ?? (comp ? compDuration(comp) : 0)) : sourceFocused ? sourceApi.current?.markOut() : markOut()));
      case 'x':
        return run(() => (sourceFocused ? sourceApi.current?.markClip() : markClip()));
      case 'm':
        return run(() => (shift ? (() => { const target = nextPoint(comp?.markers.map((marker) => marker.time) ?? [], playhead.get(), 1); if (target !== null) playhead.seek(target); })() : addMarker()));
      case 'j':
        return run(() => programApi.current?.shuttle(-1));
      case 'k':
        return run(() => (shift ? programApi.current?.playAround() : programApi.current?.shuttle(0)));
      case 'l':
        return run(() => programApi.current?.shuttle(1));
      case 'q':
        return run(() => trimToPlayhead('previous', !shift));
      case 'w':
        return run(() => trimToPlayhead('next', !shift));
      case 'e':
        return run(() => (shift ? editComp((current) => ({ ...current, clips: current.clips.map((clip) => (selection.includes(clip.id) ? { ...clip, enabled: !selectedClips.every((item) => item.enabled) } : clip)) }), 'Enable') : trimToPlayhead('next', false)));
      case 'f':
        return run(matchFrame);
      case 'r':
        return run(() => (shift ? matchFrame() : setTool('rate-stretch')));
      case 'v':
        return run(() => setTool('select'));
      case 'a':
        return run(() => setTool(shift ? 'track-backward' : 'track-forward'));
      case 'b':
        return run(() => setTool('ripple'));
      case 'n':
        return run(() => setTool('rolling'));
      case 'c':
        return run(() => setTool('razor'));
      case 'y':
        return run(() => setTool('slip'));
      case 'u':
        return run(() => setTool('slide'));
      case 'p':
        return run(() => setTool('pen'));
      case 'h':
        return run(() => setTool('hand'));
      case 'z':
        return run(() => setTool('zoom'));
      case 't':
        return run(() => setTool('type'));
      case 'g':
        return run(() => selectedClips.length && gainDialog(selectedClips));
      case 's':
        return run(() => setSnapping((value) => !value));
      default:
        break;
    }
  };

  useEffect(() => {
    const listener = (event: KeyboardEvent) => keyHandler.current(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  // A click on empty workspace hands the keyboard back to the editor.
  useEffect(() => {
    const blur = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (!isTyping(target) && !target.closest('input, textarea, select') && isTyping(document.activeElement)) (document.activeElement as HTMLElement).blur();
    };
    window.addEventListener('pointerdown', blur, true);
    return () => window.removeEventListener('pointerdown', blur, true);
  }, []);

  // Track mouse coordinates globally so FX Console appears right where the cursor points
  useEffect(() => {
    const trackMouse = (e: MouseEvent | PointerEvent) => {
      if (e.clientX !== undefined && e.clientY !== undefined && (e.clientX > 0 || e.clientY > 0)) {
        lastMousePos.current = { x: e.clientX, y: e.clientY };
      }
    };
    window.addEventListener('mousemove', trackMouse, { capture: true, passive: true });
    window.addEventListener('pointermove', trackMouse, { capture: true, passive: true });
    return () => {
      window.removeEventListener('mousemove', trackMouse, { capture: true } as any);
      window.removeEventListener('pointermove', trackMouse, { capture: true } as any);
    };
  }, []);

  // ── providers ──────────────────────────────────────────────────────────
  const chatProviders = providers.filter((row) => row.usable && row.enabled);
  const providerId = useMemo(() => {
    if (settings.providerId && chatProviders.some((row) => row.id === settings.providerId)) return settings.providerId;
    return PREFERENCE.find((id) => chatProviders.some((row) => row.id === id)) ?? 'helios';
  }, [settings.providerId, chatProviders]);
  const model = providerId === settings.providerId ? settings.model : null;

  // ── panels ─────────────────────────────────────────────────────────────
  const panel = (id: PanelId, tabs: { id: string; label: ReactNode }[], active: string, children: ReactNode, extras: Partial<Parameters<typeof Panel>[0]> = {}) => (
    <Panel id={id} tabs={tabs} active={active} maximized={maximized === id} onMaximize={() => toggleMax(id)} onClose={id === 'timeline' || id === 'program' ? undefined : () => setPanelVisible(id, false)} focused={focused === id} onFocus={() => setFocused(id)} {...extras}>
      {children}
    </Panel>
  );

  const chatPanel = panel('chat', [{ id: 'chat', label: 'Helios AI' }, { id: 'providers', label: 'Providers' }], chatTab, (
    <>
      <div className="chat-host" style={{ display: chatTab === 'chat' ? undefined : 'none' }}>
        {!!comp?.storyboard?.length && (
          <StoryboardViewer
            scenes={comp.storyboard}
            fps={comp.fps}
            compName={comp.name}
            onSeek={(t) => playhead.seek(t)}
            onUpdateScenes={(nextScenes) => {
              history.commit(
                (current) => ({
                  ...current,
                  comps: current.comps.map((c) => (c.id === comp.id ? { ...c, storyboard: nextScenes } : c)),
                }),
                'Update Storyboard Frames',
              );
            }}
            onPlayToggle={() => playhead.setPlaying(!playhead.isPlaying())}
            isPlaying={isPlaying}
          />
        )}
        <ChatPanel apiRef={chatApi} providers={providers} providerId={providerId} model={model} onChooseModel={(id, chosen) => saveSettings({ providerId: id, model: chosen })}
          effort={effort} onEffort={(value) => saveSettings({ effort: value })}
          permission={permission} onPermission={(value) => saveSettings({ permission: value })}
          awesome={awesome} onAwesome={(value) => saveSettings({ awesomeLook: value })} onUndo={history.undo}
          onReference={setReferenceId}
          ask={pendingAsks[0] ?? null} askCount={pendingAsks.length}
          onAnswer={(value) => {
            const [head, ...rest] = pendingAsks;
            head?.answer(value);
            setPendingAsks(rest);
          }}
          connections={connections} agents={agents} onStopAgent={stopAgent} onManageConnections={() => setSettingsTab('providers')}
          onManageProviders={() => setSettingsTab('providers')} getContext={() => ({ ...(aiContext(history.current(), assetMap, selection) as object), reference: referenceBrief })} tools={toolRuns}
          onTurnDone={(outcome: TurnOutcome) => {
            // The brain learns every turn's tool outcomes; recording never disturbs the chat.
            if (!settingsRef.current.ideagraphRecord || !outcome.tools.length) return;
            void recordTurnOutcome(outcome).catch(() => undefined);
          }}
          onStartWorkflow={(turnId, mode) => editWorkflows.current.set(turnId, new EditWorkflow(history.current(), assetMap, mode))}
          workflowStatus={(turnId) => { const flow = editWorkflows.current.get(turnId); return flow ? flow.status(history.current()) : null; }}
          onRevert={revertTurn} canRevert={(turnId) => turnSnapshots.current.has(turnId)} />
      </div>
      {chatTab === 'providers' && <ProvidersQuick providers={providers} activeId={providerId} onUse={(id) => { saveSettings({ providerId: id, model: null }); setChatTab('chat'); }} onManage={() => setSettingsTab('providers')} onToggle={(row, enabled) => void api.providerSetEnabled(row.id, enabled).then(setProviders)} />}
    </>
  ), { onTab: (id) => setChatTab(id as 'chat' | 'providers'), menu: [{ label: 'New Conversation', onSelect: () => chatApi.current?.clear() }, { label: 'Manage AI Providers…', onSelect: () => setSettingsTab('providers') }], className: 'panel-chat' });

  const sourcePanel = panel('source', [{ id: 'source', label: `Source: ${sourceAsset?.name ?? '(no clips)'}` }], 'source', (
    <SourceMonitor asset={sourceAsset} range={sourceAsset ? sourceRanges[sourceAsset.id] : undefined} onRange={(range) => sourceAsset && setSourceRanges((current) => ({ ...current, [sourceAsset.id]: range }))}
      onInsert={(asset, range, mode) => sourceEdit(asset, range, mode)} onDragOut={(item, event) => startPanelDrag({ kind: 'source', source: item.source, label: item.label, in: item.in, duration: item.duration }, event)}
      patch={{ video: comp?.sourceVideo ?? null, audio: comp?.sourceAudio ?? null }} apiRef={sourceApi} />
  ), { menu: [{ label: 'Close Clip', onSelect: () => setSourceId(null), disabled: !sourceAsset }] });

  const programPanel = panel('program', [{ id: 'program', label: `Program: ${comp?.name ?? '—'}` }], 'program', (
    <ProgramMonitor project={project} comp={comp} assets={assetMap} offline={offline} history={history} selection={selection} onSelect={setSelection} tool={tool} onTool={setTool}
      onImport={() => void pickFiles()} onMarkIn={markIn} onMarkOut={markOut} onAddMarker={addMarker} onLift={() => removeRangeNow('lift')} onExtract={() => removeRangeNow('extract')}
      onExportFrame={() => void exportFrame()} apiRef={programApi} />
  ), { menu: [{ label: 'Export Frame…', onSelect: () => void exportFrame(), disabled: !hasClips }, { label: 'Clear In and Out', onSelect: clearInOut }] });

  const propertiesPanel = panel(
    'properties',
    [
      { id: 'properties', label: 'Properties' },
      { id: 'effects', label: 'Effect Controls' },
    ],
    inspectorTab,
    inspectorTab === 'effects' ? (
      <EffectControlsPanel
        project={project}
        comp={comp}
        assets={assetMap}
        history={history}
        selection={selection}
        onOpenFXConsole={() => {
          setFxConsoleAnchor(getLiveMousePos());
          setFxConsoleOpen(true);
        }}
      />
    ) : (
      <PropertiesPanel
        project={project}
        comp={comp}
        assets={assetMap}
        history={history}
        selection={selection}
        transition={transitionSelection}
        onOpenGraphics={() => showPanel('project', 'graphics')}
        onSpeedDialog={() => selectedClips[0] && speedDialog(selectedClips[0], selection)}
        onAudioGain={() => gainDialog(selectedClips)}
      />
    ),
    { onTab: (id) => setInspectorTab(id as 'properties' | 'effects') }
  );

  const projectPanel = panel('project', [{ id: 'project', label: `Project: ${project.name}` }, { id: 'effects', label: 'Effects' }, { id: 'subtitles', label: 'Subtitles' }, { id: 'graphics', label: 'Graphics' }, { id: 'audio', label: 'Audio' }], projectTab, (
    <ProjectPanel tab={projectTab} project={project} assets={assets} history={history} folder={binFolder} onFolder={setBinFolder} selection={binSelection} onSelect={setBinSelection}
      clipSelection={selection} onDragStart={startPanelDrag} onOpenComp={openComp} onOpenInSource={(id) => openInSource(id)} onEntryMenu={binEntryMenu} onPanelMenu={binPanelMenu}
      onImport={() => void pickFiles()} onNewComp={newCompDialog} onNewFolder={newFolder} onNewItem={newItemDialog} onDelete={deleteBinItems}
      onRename={(id, name) => history.commit((current) => ({
        ...current,
        comps: current.comps.map((item) => (item.id === id ? { ...item, name } : item)),
        items: current.items.map((item) => (item.id === id ? { ...item, name } : item)),
        folders: current.folders.map((item) => (item.id === id ? { ...item, name } : item)),
      }), 'Rename')}
      onAddText={addText} onAddSfx={addSfx} onCaptionStyle={captionStyleChosen} onImportCaptions={(file) => void importCaptions(file)} onApplyEffect={(effect) => applyEffect(effect)}
      comp={comp} playheadTime={playhead.get()} stageRef={stageRefProxy}
      onOpenQuickModal={() => {
        setFxConsoleAnchor(getLiveMousePos());
        setFxConsoleOpen(true);
      }}
      onReimportSnapshot={(snap) => void reimportSnapshot(snap)}
      onSeek={(seconds) => playhead.set(seconds)} />
  ), { onTab: (id) => setProjectTab(id as ProjectTab), menu: [{ label: 'New Comp…', onSelect: newCompDialog }, { label: 'New Item', submenu: newItemMenu.slice(2) }, { label: 'Import…', onSelect: () => void pickFiles() }] });

  const timelinePanel = panel('timeline', [{ id: 'timeline', label: comp?.name ?? 'Timeline' }], 'timeline', (
    <Timeline project={project} assets={assetMap} comp={comp} history={history} selection={selection} onSelect={setSelection} transition={transitionSelection} onSelectTransition={setTransitionSelection}
      tool={tool} onTool={setTool} zoom={zoom} onZoom={setZoom} snapping={snapping} onSnapping={setSnapping} linkedSelection={linkedSelection} onLinkedSelection={setLinkedSelection}
      nestComps={nestComps} onNestComps={setNestComps} display={display} onDisplay={setDisplay} onActivateComp={(id) => history.view((current) => ({ ...current, activeCompId: id }))}
      onCloseComp={closeComp} onOpenComp={openComp} onOpenInSource={openInSource} onClipMenu={(event, clipId, at) => clipMenu(event, clipId, at)} onTrackMenu={trackMenu} onEmptyMenu={emptyMenu}
      onMarkerEdit={markerDialog} onAddMarker={addMarker} onVoiceOver={(trackId) => void voiceOver(trackId)} recordingTrack={recordingTrack} incoming={incoming} apiRef={timelineApi} />
  ), { menu: [{ label: 'Comp Settings…', onSelect: compSettings }, { label: 'Zoom to Sequence', onSelect: () => timelineApi.current?.fit() }, { label: 'Add Marker', onSelect: addMarker }] });

  const runningJobs = Object.values(jobs).filter((job) => job.status === 'running');
  const exportJob = runningJobs.find((job) => job.kind === 'export');
  const mediaJobs = runningJobs.filter((job) => job.kind === 'media');
  const installJobs = runningJobs.filter((job) => job.kind === 'install');
  const maximizedContent: Record<PanelId, ReactNode> = { chat: chatPanel, source: sourcePanel, program: programPanel, properties: propertiesPanel, project: projectPanel, timeline: timelinePanel, meters: null, tools: null };
  const maximizedPanel = maximized && maximizedContent[maximized] ? maximized : null;

  return (
    <div className="app">
      <MenuBar menus={menus} />
      {learningOpen && <LearningWorkspace project={project} assets={assetMap} history={history} jobs={Object.values(jobs)} onClose={() => setLearningOpen(false)} />}
      <HeaderBar
        resourceMonitor={<ResourceMonitor jobs={Object.values(jobs)} runs={Object.values(toolRuns).flat()} onCancelJob={(id) => void api.jobCancel(id)} />}
        mode={mode} onHome={() => setMode('home')} onImport={() => { setMode('edit'); void pickFiles(); }} onEdit={() => setMode('edit')} onExport={() => { setMode('edit'); setExportOpen(true); }}
        exportDisabled={!hasClips || !!exportJob} title={`${project.name}${dirty ? ' *' : ''}`} saved={!dirty} chatOpen={!hidden('chat')} onToggleChat={() => setPanelVisible('chat', hidden('chat'))}
        muted={mutes.all} onToggleMute={() => setMuteState({ ...mutes, all: !mutes.all })} programMaximized={maximized === 'program'} onToggleProgramMax={() => toggleMax('program')}
        onSettings={() => setSettingsTab('providers')} providerBadge={<ProviderLogo id={providerId} size={24} />}
      />

      {mode === 'home' && (
        <HomeScreen project={project} info={info} jobs={Object.values(jobs)} providers={providers} assetCount={project.media.length} onEdit={() => setMode('edit')} onNewProject={newProjectNow}
          onImport={() => { setMode('edit'); void pickFiles(); }} onProviders={() => setSettingsTab('providers')} onShortcuts={() => setShortcutsOpen(true)} onOpen={() => void openProject()}
          recents={settings.recentProjects} onOpenRecent={(path) => guardUnsaved(() => void openProjectFile(path), 'Open another project')} />
      )}
      {/* One tree for every view: the chat keeps its place, so a running turn keeps streaming through Home, hide, and maximize. */}
      <main className={`workspace${maximizedPanel ? ' maximized' : ''}`} style={{ display: mode === 'home' ? 'none' : undefined }}>
        <div className="ws-left" style={maximizedPanel === 'chat' ? { flex: 1 } : { width: layout.chatWidth, display: hidden('chat') || maximizedPanel ? 'none' : undefined }}>{chatPanel}</div>
        {maximizedPanel ? (
          maximizedPanel !== 'chat' && maximizedContent[maximizedPanel]
        ) : (
          <>
            {!hidden('chat') && <Splitter direction="vertical" onDrag={resize('chatWidth', PANEL_MIN.chat, 720)} onStart={beginResize} />}
            <div className="ws-main">
              <div className="ws-top" style={{ height: layout.topHeight }}>
                {!hidden('source') && (
                  <>
                    <div className="ws-cell" style={{ width: layout.sourceWidth }}>{sourcePanel}</div>
                    <Splitter direction="vertical" onDrag={resize('sourceWidth', PANEL_MIN.source, 1200)} onStart={beginResize} />
                  </>
                )}
                <div className="ws-cell grow">{programPanel}</div>
                {!hidden('properties') && (
                  <>
                    <Splitter direction="vertical" onDrag={resize('propertiesWidth', PANEL_MIN.properties, 700, -1)} onStart={beginResize} />
                    <div className="ws-cell" style={{ width: layout.propertiesWidth }}>{propertiesPanel}</div>
                  </>
                )}
              </div>
              <Splitter direction="horizontal" onDrag={resize('topHeight', PANEL_MIN.top, window.innerHeight - 280)} onStart={beginResize} />
              <div className="ws-bottom">
                {!hidden('project') && (
                  <>
                    <div className="ws-cell" style={{ width: layout.projectWidth }}>{projectPanel}</div>
                    <Splitter direction="vertical" onDrag={resize('projectWidth', PANEL_MIN.project, 900)} onStart={beginResize} />
                  </>
                )}
                {!hidden('tools') && <ToolsPanel tool={tool} onTool={setTool} onAutoRoto={() => void autoRoto()} rotoBusy={rotoBusy} rotoProgress={rotoProgress} />}
                <div className="ws-cell grow">{timelinePanel}</div>
                {!hidden('meters') && <AudioMeters prefs={layout.meters ?? DEFAULT_METERS} onPrefs={(meters) => setLayout((current) => ({ ...current, meters }))} mutes={mutes} onMutes={setMuteState} />}
              </div>
            </div>
          </>
        )}
      </main>

      <footer className="statusbar">
        <button type="button" className={`status-item${info && !info.ffmpeg.found ? ' warn' : ''}`} onClick={() => setSettingsTab('media')} title={info?.ffmpeg.path ?? 'FFmpeg'}>
          {!info ? <LoaderCircle size={12} className="spin" /> : info.ffmpeg.found ? <CircleCheck size={12} /> : <TriangleAlert size={12} />}
          {info?.ffmpeg.found ? 'FFmpeg ready' : 'FFmpeg missing'}
        </button>
        <span className="status-item muted">{comp ? `${comp.width}×${comp.height} · ${comp.fps} fps · ${comp.clips.length} clips · ${timecode(compDuration(comp), fps)}` : 'no comp'}</span>
        {recordingTrack && <span className="status-item warn"><Mic size={12} /> Recording…</span>}
        {mediaJobs.length > 0 && <span className="status-item"><LoaderCircle size={12} className="spin" /> Preparing {mediaJobs.length} media…</span>}
        {installJobs.map((job) => <span key={job.id} className="status-item"><LoaderCircle size={12} className="spin" /> {job.label}…</span>)}
        {exportJob && (
          <span className="status-item export-progress">
            <LoaderCircle size={12} className="spin" />
            {exportJob.message}
            <span className="progress"><span style={{ width: `${Math.round(exportJob.progress * 100)}%` }} /></span>
            <button type="button" className="icon-btn small" onClick={() => void api.jobCancel(exportJob.id)} title="Cancel export"><X size={12} /></button>
          </span>
        )}
        <div className="toolbar-spacer" />
        <span className="status-item muted">{TOOL_LABEL[tool] ?? 'Selection'}</span>
        <button type="button" className="status-item" onClick={() => setSettingsTab('providers')} title="AI providers">
          <ProviderLogo id={providerId} size={12} /> {providers.find((row) => row.id === providerId)?.label ?? 'Helios'}
          {providers.length === 0 && <LoaderCircle size={11} className="spin" />}
        </button>
        <span className="status-item muted">v{info?.version}</span>
      </footer>

      {dragLabel && incoming && <div className="drag-ghost" style={{ left: incoming.x + 12, top: incoming.y + 12 }}><Film size={13} /> {dragLabel}</div>}
      {fileHover && (
        <div className="file-drop"><Upload size={36} /><strong>Drop to import</strong><span>Drop on the timeline to place it there</span></div>
      )}
      {menu && <MenuList items={menu.items} anchor={menu.anchor} onClose={() => setMenu(null)} />}
      {dialog}
      {settingsTab && <SettingsModal tab={settingsTab} onTab={setSettingsTab} onClose={() => setSettingsTab(null)} info={info} onTools={(ffmpeg) => setInfo((current) => (current ? { ...current, ffmpeg } : current))} settings={settings} onSettings={(next) => saveSettings(next)} providers={providers} onProviders={setProviders} jobs={Object.values(jobs)} />}
      {exportOpen && comp && <ExportDialog project={project} comp={comp} prefs={settings.export} onClose={() => setExportOpen(false)} onExport={(options, folder) => void startExport(options, folder)} />}
      {shortcutsOpen && <ShortcutsDialog shortcuts={SHORTCUTS} onClose={() => setShortcutsOpen(false)} />}
      <FXConsoleModal
        open={fxConsoleOpen}
        anchorPos={fxConsoleAnchor}
        onClose={() => setFxConsoleOpen(false)}
        onApplyEffect={(eff) => applyEffect(eff)}
        comp={comp}
        playheadTime={playhead.get()}
        selectedClipIds={selection}
        stageRef={stageRefProxy}
        onSnapshotCaptured={(snap) => {
          const snaps = [snap, ...loadFxSnapshots()];
          saveFxSnapshots(snaps);
        }}
        onExportFrame={() => void exportFrame()}
        onReimportSnapshot={(snap) => void reimportSnapshot(snap)}
      />
      {/* The program's sound keeps playing while a panel is maximized or Home is open. */}
      {mode === 'home' && comp && <div hidden><CompAudio project={project} assets={assetMap} offline={offline} playing={false} rate={1} comp={comp} time={playhead.get()} /></div>}
    </div>
  );
}

function ProvidersQuick({ providers, activeId, onUse, onManage, onToggle }: { providers: ProviderInfo[]; activeId: string | null; onUse: (id: string) => void; onManage: () => void; onToggle: (row: ProviderInfo, enabled: boolean) => void }) {
  const ready = providers.filter((row) => row.usable);
  const others = providers.filter((row) => !row.usable);
  return (
    <div className="providers-quick">
      <div className="pq-intro">
        <span className="muted">Pick who answers in this chat.</span>
        <button type="button" className="btn btn-small" onClick={onManage}>Manage…</button>
      </div>
      {ready.map((row) => (
        <div key={row.id} className={`pq-row${row.id === activeId ? ' active' : ''}`}>
          <ProviderLogo id={row.id} size={18} />
          <div className="pq-text"><strong>{row.label}</strong><span>{row.version ?? (row.detectedPort ? `localhost:${row.detectedPort}` : row.kind === 'cloud_api' ? `${row.models.length} models` : row.kind === 'builtin' ? 'offline commands' : '')}</span></div>
          {row.id === activeId ? <span className="pill tone-ok">In use</span> : <button type="button" className="btn btn-small" onClick={() => onUse(row.id)} disabled={!row.enabled}>Use</button>}
          {row.kind !== 'builtin' && <button type="button" className="btn btn-small btn-ghost" onClick={() => onToggle(row, !row.enabled)}>{row.enabled ? 'Off' : 'On'}</button>}
        </div>
      ))}
      {others.length > 0 && <div className="pq-heading">Not set up</div>}
      {others.map((row) => (
        <div key={row.id} className="pq-row dim">
          <ProviderLogo id={row.id} size={18} />
          <div className="pq-text"><strong>{row.label}</strong><span>{row.kind === 'cli' ? 'not installed' : row.kind === 'cloud_api' ? 'needs an API key' : 'not running'}</span></div>
          <button type="button" className="btn btn-small btn-ghost" onClick={onManage}>Set up</button>
        </div>
      ))}
    </div>
  );
}
