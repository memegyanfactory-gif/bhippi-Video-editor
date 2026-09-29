// The editor shell: the Premiere workspace, its menus and keymap, the context menus, the dialogs,
// project files, and the bridge between Bhippi AI's tool calls and the project.
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { turnPrompt } from './lib/turnPrompts';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { pictureDir } from '@tauri-apps/api/path';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { CircleCheck, Film, LoaderCircle, MessageSquare, Mic, Puzzle, TriangleAlert, Upload, Terminal as TerminalIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { actionLogger } from './lib/actionLogger';
import { crashReporter } from './lib/crashReporter';
import { TerminalPanel } from './panels/TerminalPanel';
import { EditWorkflow } from './lib/editWorkflow';
import { TranscriptPanel } from './panels/TranscriptPanel';
import { jobsStore, LiveJobs } from './lib/jobsStore';
import { fillMissingCardFrames, requestCardFrames, withCardPicture, type FrameHost } from './lib/storyboardFrames';
import { describeMoved, organizeBin } from './lib/binOrganize';
import { advance as advanceProduction, userAdvance } from './lib/production';
import { ProductionBar } from './chat/ProductionBar';
import { automaticRotoEngine } from './lib/rotoEngine';
import { flushSync } from 'react-dom';
import { RENDERED_EFFECTS } from './lib/effectSupport';
import { LearningWorkspace } from './panels/LearningWorkspace';
import { ChatPanel, type ChatActivity, type ChatApi, type ToolRun } from './chat/ChatPanel';
import { StoryboardViewer } from './chat/StoryboardViewer';
import { steer } from './chat/steer';
import { HeaderBar, MenuBar, type MenuGroup, type Mode } from './components/AppChrome';
import { ResourceMonitor } from './components/ResourceMonitor';
import { GenerationJobsMenu } from './components/GenerationJobsMenu';
import { htmlClipsForExport } from './lib/htmlFrames';
import { motionClipsForExport } from './motion/exportFrames';
import { exportScale, prerenderForExport, prerenderStill } from './lib/exportPrepare';
import { fiwnCaptionsForExport } from './lib/fiwn/export';
import { clipFrameWindow } from './lib/exportWindow';
import { renderProgress, type RenderStage } from './lib/renderProgress';
import { sfxClipFields, sfxTrack } from './lib/sfxLevels';
import { RenderWindow } from './components/RenderWindow';
import { ErrorBoundary, takeLastCrash } from './components/ErrorBoundary';
import { ProviderLogo } from './components/ProviderLogo';
import { useToast } from './components/ui';
import { MenuList, Panel, Splitter, type MenuItem } from './components/workspace';
import { CompAudio } from './editor/Compositor';
import { ProgramMonitor, type ProgramApi } from './editor/ProgramMonitor';
import { SourceMonitor, type SourceApi, type SourceRange } from './editor/SourceMonitor';
import { DEFAULT_DISPLAY, dropClips, dropIntoEmpty, LABELS, Timeline, type DisplaySettings, type IncomingDrag, type TimelineApi } from './editor/Timeline';
import { AudioMeters, DEFAULT_METERS, ToolsPanel, TOOL_LABEL } from './editor/ToolsAndMeters';
import { aiContext, generatedFolderId, quickContext, rootFolderId, runTool, TOOL_SPECS, warmCustomTools } from './lib/aiTools';
import { AI_WORK_BIN, aiWorkOutputDir, readyOutputs } from './lib/aiWork';
import { scopeFromClips } from './lib/quickScope';
import { repairArgs } from './lib/argRepair';
import { readDedupeFor } from './lib/readDedupe';
import { configureTrace, toolEvent, trace } from './lib/turnTrace';
import { ledgerBrief, projectKey } from './lib/tokenLedger';
import { customToolsBrief } from './lib/customTools';
import { brandKitContext, brandKitQuickContext, resolveActiveKit } from './lib/brandKit';
import { recordTurnOutcome, type TurnOutcome } from './lib/ideagraph';
import { applyTheme, resolveGlass, resolveMotion, resolveTheme } from './lib/theme';
import { allowTool, DEFAULT_EFFORT, DEFAULT_PERMISSION, type Effort, type PermissionMode } from './lib/permissions';
import { rotoscope } from './lib/roto';
import type { AgentRun, Connection } from './chat/ChatStatusBar';
import { NO_MUTES, setMutes, type MuteState } from './lib/audio';
import type { CaptionStyle } from './lib/captionStyles';
import { capitalize, clamp, DEFAULT_EFFECTS, DEFAULT_TRANSFORM, parseCaptions, safeFileName, STILL_DEFAULT, timecode, uid } from './lib/editor';
import { useHistory } from './lib/history';
import { isUnsaved } from './lib/unsaved';
import { diffTurn, type TurnChange } from './lib/turnChanges';
import { fillerIndices, silentRanges, speechClips } from './lib/cleanup';
import { loadPeaks, type Peaks } from './lib/peaks';
import { correctCaptions, cutRangesForWords, timelineWords } from './lib/transcriptText';

import { HistoryDialog } from './settings/HistoryDialog';
import { guidedRefusal } from './lib/modelProfile';
import { suggestFromCorrection } from './lib/correctionLearning';
import { addLearnings } from './lib/brandKit/learnings';
import { RestoreBackupDialog } from './settings/RestoreBackupDialog';
import { captionCues, toSrt, toVtt } from './lib/captionFiles';
import { TrackMixDialog } from './settings/TrackMixDialog';
import { api, errorText, events, type McpStatus } from './lib/ipc';
import { updater, useUpdaterPick } from './lib/updater';
import { playhead, usePlaying } from './lib/playhead';
import { makeStickFigure } from './lib/stickFigure';
import { StickFigureDialog } from './components/StickFigureDialog';
import { generateSelectionSound } from './lib/generateSound';
import { registerSfx } from './lib/sfx';
import {
  addFrameHold, addTracks, addTransition, clipEnd, exportFrameRate, fitToFillSpeed, slideClip, slipClip, threePointEdit, trimEdge, whereSourcePlays, type TrimMode, clipsForSource, closeGap, compDuration, deleteBinEntries, deleteTracks, editPoints, emptyTracks, freeTrack, gapAt, healProject, insertFrameHold, ITEM_LABEL, loadProject, moveClips, nestClips,
  newClip, newComp, newItem, newProject, nextPoint, pasteAttributes, pasteClips, placeClips, quarantineScripts, razor, removeAttributes, removeClips, removeRange, replaceSource, restoreScripts, setGrouped, setLinked, setSpeed, sourceInfo,
  sourceLimit, sourceOut, sourceTimeAt, synchronize, textSource, toggleMarker, trackIndex, trackLabel, trackOf, tracksOf, transitionsOnSelection, trimToPlayhead, updateComp, updateTrack, withLinked, wouldCycle,
  type AssetMap, type ClipboardEntry,
} from './lib/timeline';
import { isLayeredComp, splitMotionComps } from './lib/motionStack';
import { isHtmlLayered, splitHtmlComp } from './lib/htmlLayers';
import type { AppInfo, Asset, Clip, ClipSource, Comp, ExportOptions, BhippiDocument, ItemKind, Job, PanelId, Project, ProviderInfo, Settings, Tool, ToolResult, WorkspaceLayout, ProductionPhase } from './lib/types';
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
import { RenderQueueDialog } from './settings/RenderQueueDialog';
import { channelForFormat, findFormat } from './lib/exportPresets';
import { duplicateComp as copyComp, aspectLabel, describeReformat, reformatComp } from './lib/reformat';
import { HomeScreen } from './settings/HomeScreen';
import { Onboarding } from './onboarding/Onboarding';
import { Tour, type TourStepId } from './onboarding/Tour';
import { registerStorageRoot, UNTITLED_PROJECT } from './lib/storage';
import { exportFolderFor } from './lib/exportFolder';

/** “D:\Work\My Reel.bhippi” → “My Reel”. */
const projectNameFromPath = (path: string) => (path.split(/[\\/]/).pop() ?? '').replace(/\.bhippi$/i, '').trim();
import { rewritePaths, storyboardDocs } from './lib/projectDocs';
import { SettingsModal, type SettingsTab } from './settings/SettingsModal';
import type { GenPlan } from './lib/cloudGen';
import { isSetUp } from './settings/ProvidersSettings';
import { settingsSync } from './lib/settingsSync';
import { commandFor, findCommand, keymapFrom } from './lib/keymap';
import { FXConsoleModal } from './components/FXConsoleModal';
import { loadFxSettings, loadFxSnapshots, saveFxSnapshots } from './lib/fxConsole';
import { getLiveMousePos } from './lib/mouseTracker';
import type { FxSnapshot } from './lib/types';
import type { StyleId } from './lib/styles';
import { setBrandKitDoc } from './lib/brandKit/activeStore';
import { licenseStore, useLicense } from './license/licenseStore';
import { Avatar } from './avatar/Avatar';
import { avatarBus } from './avatar/bus';
import { setAvatarColours } from './avatar/sprite';
import { KNOWN_TOOLS } from './lib/aiTools';
import { cancelPluginJob, pluginEvents, pluginMenuItems, setPluginEditor, type PluginMenuPlace } from './plugins/bridge';
import { pluginChecker } from './plugins/testRunner';
import { checkRevocations } from './plugins/market';
import { PluginMarket } from './plugins/PluginMarket';
import { PLUGIN_MAKER_BRIEF, PLUGIN_MAKER_TOOLSET } from './plugins/brief';
import { harnessRefusal } from './lib/harness';
import { makerActivityKey, MakerStatusBadge, PluginMaker } from './plugins/PluginMaker';
import { CornerStack, DownloadsBadge } from './components/DownloadsBadge';
import { BackgroundPlugins, panelPlugins, PluginClipRenderers, pluginGlyph, PluginMark, PLUGINS_HOME, PluginsHome, PluginsPanelBody } from './plugins/PluginsPanel';
import { pluginClipIds } from './plugins/clipRender';
import { loadPlugins, patchPlugin, pluginsBrief, usePlugins } from './plugins/store';
import { DockArea, PanelDragOverlay, usePanelDrag } from './components/DockArea';
import { activatePanel, defaultTree, frameOf, leafPanels, movePanel, panelsIn, readTree, removePanel, resizeSplit, showPanel as showInTree, withSplitPanels, type DockDrop, type DockNode, type DockPanelId } from './lib/dockTree';
import { PluginFrame } from './plugins/PluginFrame';
import { selectedPlugin, setPluginChecker } from './plugins/aiTools';
import { CHARACTERS_TAB, CharactersIcon, CharactersWindow } from './characters/CharactersWindow';

/**
 * How narrow each panel may be dragged.
 *
 * These are the same numbers the stylesheet uses, and they have to be: a splitter that allows a
 * width the CSS then refuses leaves the panel rendering wider than the layout believes, and its
 * contents spill over the panel beside it. The chat's floor is set by its composer row — model,
 * thinking, permission and send, side by side without wrapping.
 */
const PANEL_MIN = { chat: 436, transcript: 240, source: 260, properties: 260, project: 260, plugins: 240, top: 220 } as const;
/** The smallest a panel of the editing area may be dragged, px along its row or column. */
const DOCK_PANEL_MIN: Partial<Record<string, number>> = { program: 320, timeline: 280, storyboard: 240, transcript: 240, source: 260, properties: 260, project: 240, plugins: 240, effects: 220, subtitles: 240, graphics: 240, audio: 220, 'effect-controls': 260 };
/** Panel names for the Window menu, drag labels and drop hints. */
const PANEL_NAMES: Record<string, string> = { project: 'Project', source: 'Source Monitor', program: 'Program Monitor', properties: 'Properties', timeline: 'Timeline', meters: 'Audio Meters', tools: 'Tools', storyboard: 'Storyboard', transcript: 'Transcription', plugins: 'Plugins', effects: 'Effects', subtitles: 'Subtitles', graphics: 'Graphics', audio: 'Audio', 'effect-controls': 'Effect Controls' };
/** A tab of a stacked frame that belongs to another panel than the one showing (see `panel`). */
const STACK_TAB = 'dock:';
/** How long a Full-workflow turn may work with no plan saved before Bhippi reminds it to save one. */
const PLAN_NUDGE_MS = 10 * 60_000;

/**
 * A saved layout made current: its dock tree, or — for a layout saved before panels could be
 * dragged anywhere — the old fixed rows rebuilt as one (what was closed stays closed).
 */
function layoutTree(saved: Partial<WorkspaceLayout>): DockNode | null {
  const stored = readTree(saved.tree);
  // Saved before Effects, Subtitles, Graphics, Audio and Effect Controls were panels of their own.
  if (stored) return saved.panelsSplit ? stored : withSplitPanels(stored);
  const hidden = new Set(saved.hidden ?? DEFAULT_LAYOUT.hidden);
  let tree: DockNode | null = defaultTree();
  for (const panel of ['properties', 'project', 'meters', 'tools'] as const) if (hidden.has(panel)) tree = removePanel(tree, panel);
  // The old Storyboard & Transcription panel comes back as the Storyboard panel.
  if (!hidden.has('transcript')) tree = showInTree(tree, 'storyboard');
  if (!hidden.has('source')) tree = showInTree(tree, 'source');
  if (!hidden.has('plugins')) tree = showInTree(tree, 'plugins');
  for (const item of saved.docked ?? []) if (typeof item?.id === 'string') tree = showInTree(tree, `plugin:${item.id}`);
  return tree;
}

// A fresh install starts with the Plugins panel closed: Plugins › Show Plugins Panel (or Window › Plugins) opens it.
const DEFAULT_LAYOUT: WorkspaceLayout = { chatWidth: 448, transcriptWidth: 320, topHeight: 460, sourceWidth: 460, propertiesWidth: 330, projectWidth: 340, pluginsWidth: 360, hidden: ['transcript', 'source', 'plugins'], meters: DEFAULT_METERS, storyboardDocked: true, sourceClosed: true, docked: [] };
/** A fresh default layout: its own dock tree (ids are per layout). */
const freshLayout = (): WorkspaceLayout => ({ ...DEFAULT_LAYOUT, hidden: [], tree: defaultTree() });
const EMPTY_SETTINGS: Settings = {
  disabledProviders: [], providerId: null, model: null, effort: null, permission: null, ffmpegPath: null, chatOpen: true, timelineHeight: null, timelineZoom: null,
  disableLocalGeneration: true,
  export: { resolution: null, fps: null, quality: null, folder: null }, layout: null, recentProjects: [], projectPath: null, theme: null,
  ideagraphBin: null, ideagraphBrain: null, ideagraphRecord: null,
  speech: { transcribeEngine: null, transcribeModel: null, whisperPath: null, ttsPath: null, voice: null, hindiVoice: null, elevenlabsModel: null, openaiTtsModel: null, voiceMode: 'auto', speed: null },
};

/** When the saved choice is unusable, prefer agents the user is signed in to, then local, then cloud. */
const PREFERENCE = ['claude', 'codex', 'ollama', 'lmstudio', 'anthropic', 'openai', 'google', 'openrouter', 'groq', 'xai', 'deepseek', 'mistral', 'moonshot', 'opencode-zen', 'opencode', 'grok', 'antigravity', 'bhippi'];

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || (target.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes((target as HTMLInputElement).type)));

type Clipboard = { clips: ClipboardEntry[]; comp: string } | null;
type ContextMenu = { anchor: DOMRect; items: MenuItem[] } | null;

/**
 * A one-line reading of a tool call's arguments, for the activity list.
 *
 * It is what the call was *asked* for, shown while it runs and before there is any result — three
 * fields is enough to tell two calls apart without turning the chat into a JSON dump.
 */
/**
 * What a tool call was asked to do, for its row in the chat while it runs. Written for the person
 * reading it: ids are left out when there is anything else to say, keys become words, and times
 * read as the timeline shows them ("start 0:04.2", not "start: 4.2").
 */
const ARG_ID = /^ids?$|Ids?$/;
const ARG_TIME = /^(start|end|at|time|from|to|in|out|duration|seconds|offset)$|(Start|End|Time|At|Seconds|Duration)$/;
const argWords = (key: string) => key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase();
const argTime = (seconds: number) => `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, '0')}`;
function describeArgs(args: Record<string, unknown>): string {
  const given = Object.entries(args).filter(([, value]) => value !== null && value !== undefined && value !== '');
  const readable = given.filter(([name]) => !ARG_ID.test(name));
  return (readable.length ? readable : given)
    .slice(0, 3)
    .map(([name, value]) => {
      if (Array.isArray(value)) return `${value.length} ${argWords(name)}`;
      if (typeof value === 'object') return argWords(name);
      if (typeof value === 'number' && ARG_TIME.test(name) && value >= 0) return `${argWords(name)} ${argTime(value)}`;
      const text = String(value);
      return `${argWords(name)}: ${text.length > 44 ? `${text.slice(0, 44)}…` : text}`;
    })
    .join(' · ');
}

/** Where files dragged in from Explorer would land, and what dropping them there does. */
type FileHover = { zone: 'chat' | 'sketch' | 'timeline' | 'bin' | 'project'; rect: { left: number; top: number; width: number; height: number } | null; title: string; detail: string; what: string; key: string };

const PICTURE_EXT = /\.(png|jpe?g|webp|gif|bmp|tiff?|avif|heic|heif)$/i;
const VIDEO_EXT = /\.(mp4|mov|mkv|webm|avi|m4v|wmv|mts|m2ts|flv|mpe?g|3gp)$/i;
const AUDIO_EXT = /\.(mp3|wav|m4a|aac|flac|ogg|opus|wma|aiff?)$/i;

/** "2 videos and a picture", from the dragged paths. */
function describeFiles(paths: string[]): string {
  const count = (test: RegExp) => paths.filter((path) => test.test(path)).length;
  const parts: string[] = [];
  const add = (n: number, one: string, many: string) => { if (n) parts.push(n === 1 ? one : `${n} ${many}`); };
  add(count(VIDEO_EXT), 'a video', 'videos');
  add(count(PICTURE_EXT), 'a picture', 'pictures');
  add(count(AUDIO_EXT), 'an audio file', 'audio files');
  const other = paths.length - count(VIDEO_EXT) - count(PICTURE_EXT) - count(AUDIO_EXT);
  add(other, paths.some((path) => path.toLowerCase().endsWith('.bhippi')) && other === 1 ? 'a Bhippi project' : 'a file', 'files');
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0] ?? 'files';
}

/** Whether a screen point is over a timeline panel — geometry, since a drag overlay may cover it. */
const overTimeline = (x: number, y: number) => [...document.querySelectorAll<HTMLElement>('.timeline')].some((node) => {
  const rect = node.getBoundingClientRect();
  return rect.width > 0 && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
});

/** Crash detection: set while Bhippi runs, cleared by a clean close. Still set at launch = the last session ended uncleanly. */
const RUNNING_KEY = 'bhippi.session.running';
function endedUncleanly(): boolean {
  try {
    return localStorage.getItem(RUNNING_KEY) === 'true';
  } catch {
    return false;
  }
}
function markRunning(running: boolean) {
  try {
    localStorage.setItem(RUNNING_KEY, String(running));
  } catch {
    // Without storage there is no crash notice; nothing else depends on it.
  }
}

export default function App() {
  const toast = useToast();
  // A crash the last session hit (the error boundary kept it): say so once, with the message.
  useEffect(() => {
    const crash = takeLastCrash();
    if (crash) toast({ tone: 'error', title: 'Bhippi recovered from an error', body: `${crash.message} — details are in crash.log in the Bhippi data folder.`, timeout: 12000 });
  }, [toast]);
  const history = useHistory(newProject());
  const { project } = history;
  const [learningOpen, setLearningOpen] = useState(false);
  /** The Plugin Maker workspace, and the plugin it has open (null: a new one). */
  const [makerOpen, setMakerOpen] = useState(false);
  // Once opened, the Plugin Maker stays mounted (hidden while the user is back in the editor), so a
  // build it is running keeps going and its chat, questions and progress are there on return.
  const [makerMounted, setMakerMounted] = useState(false);
  useEffect(() => { if (makerOpen) setMakerMounted(true); }, [makerOpen]);
  /** The Maker chat's latest turn, for the corner badge shown while the Maker is out of sight. */
  const [makerActivity, setMakerActivity] = useState<ChatActivity>(null);
  // What the user has already seen of it: anything shown while the Maker is open counts.
  const [makerSeen, setMakerSeen] = useState('');
  useEffect(() => { if (makerOpen) setMakerSeen(makerActivityKey(makerActivity)); }, [makerOpen, makerActivity]);
  const [marketOpen, setMarketOpen] = useState(false);
  const [makerPlugin, setMakerPlugin] = useState<string | null>(null);
  const [pluginTab, setPluginTab] = useState<string | null>(null);
  /** A plugin being dragged toward the editing area to dock it (src/plugins/dock.tsx). */
  const makerChatApi = useRef<ChatApi | null>(null);
  /** The Plugins panel was asked for while it has no plugin tabs, so it shows its empty state. */
  /** The Characters window (a built-in tab of the Plugins panel), and which studio it shows. */
  const [charactersOpen, setCharactersOpen] = useState(false);
  const [charactersMode, setCharactersMode] = useState<'2d' | '3d'>('2d');
  const { plugins } = usePlugins();
  const [loaded, setLoaded] = useState(false);
  const [savedProject, setSavedProject] = useState<Project | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [settings, setSettings] = useState<Settings>(EMPTY_SETTINGS);
  // Brand kits for code without a settings handle (Motion panel, inspector rebuilds).
  useEffect(() => setBrandKitDoc(settings.brandKits ?? null), [settings.brandKits]);
  const permission = (settings.permission as PermissionMode | null) ?? DEFAULT_PERMISSION;
  const effort = (settings.effort as Effort | null) ?? DEFAULT_EFFORT;
  // Purely a look: remembered with the other chat choices so it survives a restart.
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState(280);
  const [terminalErrorCount, setTerminalErrorCount] = useState(0);

  useEffect(() => {
    return actionLogger.subscribe((logs) => {
      const errs = logs.filter((l) => l.category === 'error' || l.level === 'error').length;
      setTerminalErrorCount(errs);
    });
  }, []);

  const isPlaying = usePlaying();
  // The tool-call listener is registered once, so it reads the current mode through a ref.
  // What the chat can reach. Bhippi's own tools are always there; MCP servers join as they connect.
  const [mcpServers, setMcpServers] = useState<McpStatus[]>([]);
  const refreshConnections = useCallback(() => {
    void api.mcpServers().then(setMcpServers).catch(() => setMcpServers([]));
  }, []);
  useEffect(() => refreshConnections(), [refreshConnections]);
  const connections: Connection[] = [
    { id: 'bhippi', label: 'Bhippi project tools', kind: 'builtin', state: 'ready', detail: 'built in', tools: TOOL_SPECS.length },
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
  // Remembered across restarts: a reference the user chose keeps steering until they clear it.
  const [referenceId, setReferenceIdState] = useState<string | null>(() => {
    try { return localStorage.getItem('bhippi.activeReference'); } catch { return null; }
  });
  const setReferenceId = useCallback((id: string | null) => {
    setReferenceIdState(id);
    try {
      if (id) localStorage.setItem('bhippi.activeReference', id);
      else localStorage.removeItem('bhippi.activeReference');
    } catch {
      // Storage blocked: the reference still applies for this session.
    }
  }, []);
  // The edit style (`@funny`, src/lib/styles.ts) every turn works in until the chat's chip clears
  // it; the backend puts the style's brief in the prompt when the context names it.
  const [editStyle, setEditStyle] = useState<StyleId | null>(null);
  const [referenceBrief, setReferenceBrief] = useState<string | null>(null);
  useEffect(() => {
    if (!referenceId) return setReferenceBrief(null);
    let alive = true;
    void api.refsBrief(referenceId).then((brief) => alive && setReferenceBrief(brief)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [referenceId]);

  const [pendingAsks, setPendingAsks] = useState<{ question: string; options: string[]; context: string | null; answer: (value: string) => void; /** Asked by a Plugin Maker turn: shown in the Maker's chat, not the main one. */ maker: boolean }[]>([]);
  // Each chat shows only its own turns' questions, oldest first.
  const mainAsks = pendingAsks.filter((item) => !item.maker);
  const makerAsks = pendingAsks.filter((item) => item.maker);
  const answerAsk = (item: (typeof pendingAsks)[number] | undefined, value: string) => {
    if (!item) return;
    item.answer(value);
    setPendingAsks((current) => current.filter((entry) => entry !== item));
  };
  /** The cloud generation plan the AI is waiting on (generate_cloud_media), one at a time. */
  const [pendingGen, setPendingGen] = useState<{ plan: GenPlan; resolve: (plan: GenPlan | null) => void } | null>(null);
  const permissionRef = useRef<PermissionMode>(permission);
  permissionRef.current = permission;
  const [assets, setAssets] = useState<Asset[]>([]);
  const assetsRef = useRef(assets);
  assetsRef.current = assets;
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  // Jobs as of their last status change. Live progress is in jobsStore, read by <LiveJobs> where it
  // is drawn, so a progress tick never re-renders the editor (see lib/jobsStore.ts).
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
  const [mutes, setMuteState] = useState<MuteState>(NO_MUTES);
  const [focused, setFocused] = useState<PanelId>('timeline');
  const [maximized, setMaximized] = useState<PanelId | null>(null);
  const [layout, setLayout] = useState<WorkspaceLayout>(freshLayout);
  const [chatTab, setChatTab] = useState<'chat' | 'providers'>('chat');
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [sourceRanges, setSourceRanges] = useState<Record<string, SourceRange>>({});
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null);
  /** First run: the storage + models onboarding, until Settings.onboarded is true. */
  const [onboarding, setOnboarding] = useState(false);
  /** The welcome tour over the editor; starts on its own once, after the first-run setup. */
  const [tour, setTour] = useState(false);
  const tourOffered = useRef(false);
  /** The open project's folder under the storage root (storage.rs), for paths built in the UI. */
  const projectDirRef = useRef<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  /** The edit point keyboard trims act on (a clip's In or Out), selected by clicking an edge or Shift+T. */
  const [selectedEdit, setSelectedEdit] = useState<{ clipId: string; edge: 'in' | 'out' } | null>(null);
  /** K held down (J/L then step frames: slow jog). Tracked from the physical key, as the keymap reads keys. */
  const kHeld = useRef(false);
  useEffect(() => {
    const down = (event: KeyboardEvent) => { if (event.code === 'KeyK' && !event.ctrlKey && !event.metaKey && !event.altKey) kHeld.current = true; };
    const up = (event: KeyboardEvent) => { if (event.code === 'KeyK') kHeld.current = false; };
    const blur = () => { kHeld.current = false; };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down, true); window.removeEventListener('keyup', up, true); window.removeEventListener('blur', blur); };
  }, []);
  /** Where Match Frame parks the Source monitor (a new nonce parks again). */
  const [sourcePark, setSourcePark] = useState<{ assetId: string; time: number; nonce: number } | null>(null);
  /** Edit › History…: every undo step, to jump to. */
  const [historyOpen, setHistoryOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [fxConsoleOpen, setFxConsoleOpen] = useState(false);
  const [fxConsoleAnchor, setFxConsoleAnchor] = useState<{ x: number; y: number } | null>(null);
  const lastMousePos = useRef<{ x: number; y: number }>({ x: 400, y: 250 });
  const [menu, setMenu] = useState<ContextMenu>(null);
  const [dialog, setDialog] = useState<ReactNode>(null);
  // When the license gate covers the app (signed out, no key, revoked), close what was open under it.
  const licenseBlocked = useLicense().blocked;
  useEffect(() => {
    if (!licenseBlocked) return;
    setSettingsTab(null);
    setMenu(null);
    setExportOpen(false);
    setQueueOpen(false);
    setShortcutsOpen(false);
    setFxConsoleOpen(false);
    setTour(false);
  }, [licenseBlocked]);
  const [incoming, setIncoming] = useState<IncomingDrag | null>(null);
  const [dragLabel, setDragLabel] = useState<string | null>(null);
  const [fileHover, setFileHover] = useState<FileHover | null>(null);
  /** What is being dragged in, from the drag's enter event (the later events carry no paths). */
  const draggedFiles = useRef('files');
  const [toolRuns, setToolRuns] = useState<Record<string, ToolRun[]>>({});
  const [recordingTrack, setRecordingTrack] = useState<string | null>(null);
  const clipboard = useRef<Clipboard>(null);
  const timelineApi = useRef<TimelineApi | null>(null);
  const programApi = useRef<ProgramApi | null>(null);
  const sourceApi = useRef<SourceApi | null>(null);
  const chatApi = useRef<ChatApi | null>(null);
  const settingsRef = useRef(settings);
  // The storyboard frame queue's view of the app, refreshed every render (see frameHost below).
  const frameHostRef = useRef<FrameHost | null>(null);
  settingsRef.current = settings;
  // Read through refs at each event, so a turn traces into the project that was open when it began.
  configureTrace({ enabled: () => settingsRef.current.turnTraces !== false, project: () => projectDirRef.current });
  const layoutStart = useRef(layout);
  const restoreBackupRef = useRef<(path: string) => Promise<void>>(async () => undefined);
  /** The latest history and file opener, for handlers registered once. */
  const live = useRef<{ history: typeof history; openProjectFile: (path: string, fromRecents?: boolean) => Promise<void> }>(null!);
  const turnSnapshots = useRef(new Map<string, Project>());
  /** The project as each AI turn left it, so Revert knows whether anything changed since. */
  const turnResults = useRef(new Map<string, Project>());
  /** What each AI turn changed (lib/turnChanges.ts), for the chat's change list. */
  const turnChanges = useRef(new Map<string, TurnChange[]>());
  /** Corrections already offered as learnings this session (lib/correctionLearning.ts), by key. */
  const offeredCorrections = useRef(new Set<string>());
  /** The clips the last AI turn added or changed, tinted on the timeline until the next turn or until hidden. */
  const [aiHighlight, setAiHighlight] = useState<{ turnId: string; clipIds: Set<string> } | null>(null);
  const editWorkflows = useRef(new Map<string, EditWorkflow>());
  /** Turns started from the Plugin Maker's chat (docs/PLUGIN-PLATFORM-PLAN.md). */
  const makerTurns = useRef(new Set<string>());
  /** Turns whose model runs guided (modelProfile.ts): their graphics come from templates only. */
  const guidedTurns = useRef(new Set<string>());
  const renderOriginals = useRef(new Map<string, Clip['source']>());
  const recorder = useRef<{ stop: () => void } | null>(null);
  const stageRefProxy = useMemo(() => ({ get current() { return programApi.current?.getStage() ?? null; } }), []);

  const assetMap: AssetMap = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);
  const offline = useMemo(() => new Set(project.media.filter((ref) => ref.offline).map((ref) => ref.assetId)), [project.media]);
  const comp = useMemo(() => project.comps.find((item) => item.id === project.activeCompId) ?? project.comps[0], [project]);
  const sourceAsset = sourceId ? assetMap.get(sourceId) : undefined;
  const dirty = isUnsaved(project, savedProject, settings.projectPath);
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
      if (!stored.onboarded) setOnboarding(true);
      void api.storageInfo().then((storage) => { registerStorageRoot(storage.root); projectDirRef.current = storage.projectDir; }).catch(() => undefined);
      void warmCustomTools({ dataDir: appInfo.dataDir, ffmpeg: appInfo.ffmpeg.path });
      settingsStore.apply(stored);
      // A fresh install is marked so the welcome tour follows the setup; older installs stay unset.
      if (!stored.onboarded && stored.tourSeen == null) settingsStore.save({ tourSeen: false });
      // The layout the last session left, its panels where the user put them (a layout from before
      // panels could be dragged anywhere is rebuilt as a tree once, keeping what was closed closed).
      if (stored.layout) {
        const saved = { ...DEFAULT_LAYOUT, ...stored.layout, meters: { ...DEFAULT_METERS, ...(stored.layout.meters ?? {}) } };
        setLayout({
          ...saved,
          hidden: saved.hidden.includes('chat') ? ['chat'] : [],
          chatWidth: Math.max(PANEL_MIN.chat, saved.chatWidth),
          tree: layoutTree(stored.layout) ?? defaultTree(),
          panelsSplit: true,
          docked: [],
        });
      }
      if (stored.timelineZoom) setZoom(stored.timelineZoom);
      setAssets(library);
      const map = new Map(library.map((asset) => [asset.id, asset]));
      const opened = loadProject(loadedProject, map);
      history.reset(opened);
      setSavedProject(opened);
      // The last session did not close cleanly (a crash, a power cut, a kill): what is on screen
      // is its last autosave, which may hold edits never saved to the project file.
      if (endedUncleanly() && (opened.media.length || opened.comps.some((comp) => comp.clips.length))) {
        if (stored.projectPath) setSavedProject({ ...opened });
        toast({ tone: 'info', title: 'Bhippi closed unexpectedly last time', body: 'Your work is back as of the last autosave (every half second). Older versions are in File › Restore from Backup….', timeout: 12000, actions: [{ label: 'Show backups', run: () => setDialog(<RestoreBackupDialog projectName={opened.name} onClose={() => setDialog(null)} onRestore={(path) => { setDialog(null); void restoreBackupRef.current(path); }} />) }] });
      }
      markRunning(true);
      jobsStore.reset(jobList);
      setJobs(Object.fromEntries(jobList.map((job) => [job.id, job])));
      setLoaded(true);
      api.providersList().then(setProviders).catch(() => undefined);
      if (startup) void openProjectFile(startup);
    })().catch((error) => toast({ tone: 'error', title: 'Bhippi could not load your project', body: errorText(error) }));
    return () => {
      cancelled = true;
    };
    // Boot runs once.
  }, []);

  useEffect(() => setMutes(mutes), [mutes]);

  // Backend events, subscribed once. They read the latest history and file opener through a ref:
  // re-subscribing on every edit (history changes with each one) left a gap in which a job event —
  // "export complete", a finished generation — could arrive with nobody listening.
  useEffect(() => {
    const subscriptions = [
      events.library(() => {
        actionLogger.system('Library refreshed');
        void refreshAssets();
      }),
      events.providers(setProviders),
      events.tools((ffmpeg) => {
        actionLogger.system('FFmpeg tool status', ffmpeg);
        setInfo((current) => (current ? { ...current, ffmpeg } : current));
      }),
      events.openFile((path) => {
        actionLogger.user(`Open File: ${path}`, { path });
        // Behind the license gate a double-clicked project waits until Bhippi is unlocked.
        if (licenseStore.get().blocked) {
          const unsubscribe = licenseStore.subscribe(() => {
            if (licenseStore.get().blocked) return;
            unsubscribe();
            void live.current.openProjectFile(path);
          });
          return;
        }
        void live.current.openProjectFile(path);
      }),
      events.job((job) => {
        // A progress tick updates the store (and the progress bars reading it) and nothing else.
        if (!jobsStore.put(job)) return;
        actionLogger.system(`Job [${job.kind}]: ${job.label} (${job.status})`, job);
        setJobs((current) => ({ ...current, [job.id]: job }));
        if (job.kind === 'export' && job.status === 'done' && job.result?.path) {
          const path = job.result.path;
          toast({ tone: 'success', title: 'Export complete', body: path.split(/[\\/]/).pop(), actions: [{ label: 'Open', run: () => void api.openPath(path) }, { label: 'Show in folder', run: () => void api.revealPath(path) }] });
          // The very first finished render asks once how Bhippi is doing.
          crashReporter.afterRender();
        } else if (job.kind === 'export' && job.status === 'error') {
          toast({ tone: 'error', title: 'Export failed', body: job.message.slice(0, 400) });
        } else if (job.kind === 'generation' && job.status === 'done' && (job.result as { path?: string })?.path) {
          const path = (job.result as { path?: string }).path!;
          const filename = path.split(/[\\/]/).pop();
          void (async () => {
            try {
              const res = await api.libraryImport([path]);
              await refreshAssets();
              const all = [...res.imported, ...res.existing];
              if (all.length > 0) {
                const { history: latest } = live.current;
                const currentProject = latest.current();
                const targetFolder = generatedFolderId(currentProject, (fn) => latest.commit(fn, 'Generated Folder'));
                latest.commit((current) => ({
                  ...current,
                  media: [
                    ...current.media.map((ref) =>
                      all.some((a) => a.id === ref.assetId) ? { ...ref, folderId: targetFolder } : ref,
                    ),
                    ...all
                      .filter((asset) => !current.media.some((ref) => ref.assetId === asset.id))
                      .map((asset) => ({ assetId: asset.id, folderId: targetFolder, offline: false })),
                  ],
                }), 'Import Generated Media');
              }
            } catch (err) {
              console.error('Failed to auto-import generated media', err);
            }
          })();
          toast({ tone: 'success', title: 'Generation complete', body: `${filename || job.label} added to Generated folder`, actions: [{ label: 'Show in folder', run: () => void api.revealPath(path) }] });
        } else if (job.kind === 'generation' && (job.status === 'error' || job.status === 'cancelled')) {
          toast({ tone: 'error', title: 'Generation failed', body: job.message.slice(0, 400) });
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
    permission: () => permissionRef.current,
    ask: (question: { question: string; options: string[]; context: string | null }, signal?: AbortSignal, turnId?: string) =>
      new Promise<string>((resolve) => {
        // The turn is waiting on this, so the card stays until it is answered or skipped — or the
        // turn ends (Stop, an error), when nobody is left to read the answer and the card goes.
        const entry = { ...question, answer: resolve, maker: !!turnId && makerTurns.current.has(turnId) };
        if (signal?.aborted) return resolve('The turn ended before the editor answered.');
        signal?.addEventListener('abort', () => {
          setPendingAsks((current) => current.filter((item) => item !== entry));
          resolve('The turn ended before the editor answered.');
        }, { once: true });
        setPendingAsks((current) => [...current, entry]);
      }),
    approveGeneration: (plan: GenPlan, signal?: AbortSignal) =>
      new Promise<GenPlan | null>((resolve) => {
        // Like a question card: it waits for Generate or Cancel, and goes if the turn ends.
        if (signal?.aborted) return resolve(null);
        const entry = { plan, resolve };
        signal?.addEventListener('abort', () => {
          setPendingGen((current) => (current === entry ? null : current));
          resolve(null);
        }, { once: true });
        setPendingGen(entry);
      }),
    importMedia: async (paths: string[], targetFolderId?: string | null) => {
      const result = await api.libraryImport(paths);
      await refreshAssets();
      const all = [...result.imported, ...result.existing];
      // Say why, rather than hand the AI an empty list: a 691-byte "video" that was really an
      // error page came back as "could not be imported" and nothing more.
      if (!all.length && result.failed.length) {
        throw new Error(result.failed.map((failure) => `${failure.path.split(/[\\/]/).pop()}: ${failure.reason}`).join('; '));
      }
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
      const currentSettings = await api.settingsGet().catch(() => settings);
      // No voice named anywhere: the backend picks — a cloud voice when a key is saved, else Kokoro.
      const chosenVoice = voice || currentSettings.speech.voice || null;
      const chosenMode = (mode && mode !== 'auto') ? mode : (currentSettings.speech.voiceMode || 'auto');
      const asset = await api.speechGenerate(text, chosenVoice, chosenMode, name);
      await refreshAssets();
      const currentProject = history.current();
      const targetFolder = generatedFolderId(currentProject, (fn) => history.commit(fn, 'Generated Folder'));
      history.commit(
        (current) => (current.media.some((ref) => ref.assetId === asset.id)
          ? current
          : { ...current, media: [...current.media, { assetId: asset.id, folderId: targetFolder, offline: false }] }),
        'Voice-over',
      );
      return asset;
    },
    setReference: (id: string | null) => setReferenceId(id),
    // Brand kits live in Settings; tools read the current document and persist changes through the same path the panel uses.
    settings: () => settingsRef.current,
    saveSettings: async (next: Settings) => {
      const saved = await api.settingsSave(next);
      settingsStore.apply(saved);
      return saved;
    },
  }), [history, assetMap, selection, refreshAssets]);
  // What a CLI agent finishes in <project>/AI Work/Output comes into the "AI Work" bin as it appears
  // (src/lib/aiWork.ts): looked at every few seconds while a turn runs, and again as it ends, so the
  // work shows in the Project panel instead of piling up on disk where nobody sees it.
  const aiWorkSizes = useRef(new Map<string, number>());
  const aiWorkLooking = useRef(false);
  const syncAiWork = useCallback(async () => {
    const projectDir = projectDirRef.current;
    if (!projectDir || aiWorkLooking.current) return;
    aiWorkLooking.current = true;
    try {
      const listing = await api.fsListDirectory(aiWorkOutputDir(projectDir), true, 3, 500).catch(() => null);
      if (!listing) return;
      const { ready, sizes } = readyOutputs(listing.entries, assetsRef.current.map((asset) => asset.path), aiWorkSizes.current);
      aiWorkSizes.current = sizes;
      if (!ready.length) return;
      const folder = rootFolderId(history.current(), (change) => history.commit(change, 'AI Work Folder'), AI_WORK_BIN);
      const imported = await toolHost.importMedia(ready, folder);
      actionLogger.ai(`AI Work: brought ${imported.length} finished file${imported.length === 1 ? '' : 's'} into the Project panel`, { paths: ready });
    } catch (error) {
      actionLogger.error(`AI Work: could not bring the finished files in: ${errorText(error)}`, { error });
    } finally {
      aiWorkLooking.current = false;
    }
  }, [history, toolHost]);
  // The timers below run once for the app's life and read the latest callbacks through refs: the
  // history changes with every edit, and a timer restarted on each one might never fire mid-turn.
  const syncAiWorkRef = useRef(syncAiWork);
  syncAiWorkRef.current = syncAiWork;
  const historyRef = useRef(history);
  historyRef.current = history;
  useEffect(() => {
    const timer = window.setInterval(() => { if (chatApi.current?.busy()) void syncAiWorkRef.current(); }, 4000);
    return () => window.clearInterval(timer);
  }, []);
  // A Full-workflow turn that has worked for ten minutes with no plan saved is reminded, once, to
  // save it: until then the user sees no storyboard, no scenes and no Start button, only a turn
  // that seems to do nothing (29 Sep: 50 minutes of rendering with nothing in the project).
  const latestTurn = useRef<{ turnId: string; at: number; nudged: boolean } | null>(null);
  useEffect(() => {
    const timer = window.setInterval(() => {
      const turn = latestTurn.current;
      if (!turn || turn.nudged || !chatApi.current?.busy() || Date.now() - turn.at < PLAN_NUDGE_MS) return;
      const flow = editWorkflows.current.get(turn.turnId);
      const state = flow?.mode === 'full' ? flow.status(historyRef.current.current()) : null;
      if (!state || state.phase !== null || state.blueprintSaved || state.blueprintPlan || state.storyboardCurrent) return;
      turn.nudged = true;
      steer.nudge(turn.turnId, 'This Full-workflow turn has worked for 10 minutes and no plan is saved yet, so the user sees nothing: no storyboard, no scenes, no Start button. Save the plan now (save_video_blueprint from scratch, save_storyboard on footage; a scene you will make with your own renderer is mediaSource "render"), then end the turn with its summary so the user can review it and press Start generating.');
      actionLogger.ai('Plan reminder: a Full-workflow turn has run 10 minutes without saving a plan', { turnId: turn.turnId });
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);
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

  // Plugins (src/plugins): the bridge runs their calls against the same host and rules as the AI's.
  useEffect(() => {
    void loadPlugins();
    // The Plugin Maker's plugin_test / plugin_screenshot run plugins against a scratch copy of the project.
    setPluginChecker(pluginChecker);
    // bhippi.com's signed revocation list: a plugin pulled from the marketplace is turned off on
    // every machine, at start and every six hours. An unreachable or unsigned list changes nothing.
    const revocations = () => void checkRevocations().then((pulled) => {
      for (const { plugin, reason } of pulled) toast({ tone: 'error', title: `“${plugin.name}” was turned off`, body: `It was pulled from the plugin marketplace: ${reason}`, timeout: 15000 });
    }, () => undefined);
    const firstCheck = window.setTimeout(revocations, 20_000);
    const everySixHours = window.setInterval(revocations, 6 * 3600 * 1000);
    setPluginEditor({
      host: () => {
        const host = hostRef.current;
        return { ...host, history: { ...host.history,
          commit: (...args: Parameters<typeof host.history.commit>) => flushSync(() => host.history.commit(...args)),
          view: (...args: Parameters<typeof host.history.view>) => flushSync(() => host.history.view(...args)),
          undo: () => flushSync(() => host.history.undo()),
          squash: (...args: Parameters<typeof host.history.squash>) => flushSync(() => host.history.squash(...args)),
        } };
      },
      runTool: (host, name, args) => runTool(host, name, args),
      known: KNOWN_TOOLS,
      toolSpecs: () => TOOL_SPECS,
      permission: () => permissionRef.current,
      disableLocalGeneration: () => settingsRef.current.disableLocalGeneration ?? true,
      toast: (tone, title, body) => toast({ tone, title, body }),
      // A plugin only suggests: the message goes to Bhippi AI when the user clicks Send.
      chat: (message, pluginName) => toast({
        tone: 'info', title: `“${pluginName}” suggests asking Bhippi AI`, body: message.replace(/^\[From the “[^”]*” plugin\] /, '').slice(0, 400),
        actions: [{ label: 'Send to Bhippi AI', run: () => chatApi.current?.send(message) }, { label: 'Dismiss', run: () => undefined }],
      }),
      projectPath: () => settingsRef.current.projectPath,
      ai: () => ({ providerId: settingsRef.current.providerId, model: settingsRef.current.model }),
      job: (job) => {
        if (!jobsStore.put(job)) return;
        setJobs((current) => ({ ...current, [job.id]: job }));
      },
    });
    return () => {
      window.clearTimeout(firstCheck);
      window.clearInterval(everySixHours);
    };
  }, [toast]);
  useEffect(() => pluginEvents.project(), [project]);
  useEffect(() => pluginEvents.selection(selection), [selection]);
  // bhippi.on('export'): when an export starts, and how it ends.
  useEffect(() => {
    let last = renderProgress.get();
    return renderProgress.subscribe(() => {
      const now = renderProgress.get();
      const running = now.open && now.status === 'running';
      if (running && (!(last.open && last.status === 'running') || now.startedAt !== last.startedAt)) pluginEvents.export('started', now.output);
      else if (!running && now.status !== 'running' && now.status !== last.status) pluginEvents.export(now.status, now.output);
      last = now;
    });
  }, []);
  useEffect(() => {
    let last = 0;
    return playhead.subscribe(() => {
      const now = performance.now();
      if (now - last < 200) return;
      last = now;
      pluginEvents.playhead(playhead.get());
    });
  }, []);
  const toolAborts = useRef(new Map<string, { turnId: string; controller: AbortController }>());
  useEffect(() => {
    const pending = events.chat(event => {
      // The avatar mirrors every turn, the council workers' included (their turn id is the subagent id):
      // thinking, writing the reply, the steps a CLI takes by itself, and how the turn closed.
      // A Plugin Maker turn builds a plugin: the avatar acts that out and leaves the edit open.
      if (event.event === 'start') avatarBus.turn(event.turnId, true, undefined, makerTurns.current.has(event.turnId));
      else if (event.event === 'delta') {
        const delta = event.delta;
        if (delta.kind === 'thinking') avatarBus.chat(event.turnId, 'thinking');
        else if (delta.kind === 'text') avatarBus.chat(event.turnId, 'writing');
        else if (delta.kind === 'step') avatarBus.step(event.turnId, delta.id, delta.verb, delta.title, delta.done);
      }
      if (event.event === 'done') {
        actionLogger.ai(`AI Turn Completed [${event.turnId}]`);
        for (const entry of toolAborts.current.values()) if (entry.turnId === event.turnId) entry.controller.abort();
        avatarBus.turn(event.turnId, false, event.stopped ? 'stopped' : event.fault ? 'failed' : 'done');
      } else if (event.event === 'subagent_update') {
        if (event.state !== 'running') avatarBus.turn(event.subagentId, false, event.state === 'done' ? 'done' : 'failed');
        actionLogger.ai(`Subagent [${event.subagentId}]: ${event.label} (${event.state})`, event);
        setAgents((current) => {
          const idx = current.findIndex((a) => a.id === event.subagentId);
          const entry: AgentRun = {
            id: event.subagentId,
            label: event.label,
            state: event.state,
            model: null,
            elapsedMs: event.elapsedMs,
            tokens: null,
            summary: event.summary,
          };
          if (idx >= 0) {
            const next = [...current];
            next[idx] = entry;
            return next;
          }
          return [...current, entry];
        });
      }
    });
    return () => { void pending.then(unlisten => unlisten()); for (const entry of toolAborts.current.values()) entry.controller.abort(); };
  }, []);

  useEffect(() => {
    const pending = events.toolCall(async (sent) => {
      // Mended against the schema once, so the guard, the tool and the log all see the same call.
      const call = { ...sent, args: repairArgs(sent.name, sent.args) };
      const controller = new AbortController();
      toolAborts.current.set(call.callId, { turnId: call.turnId, controller });
      if (!turnSnapshots.current.has(call.turnId)) {
        turnSnapshots.current.set(call.turnId, hostRef.current.history.current());
        setAiHighlight((current) => (current && current.turnId !== call.turnId ? null : current));
      }
      // Reads of the project are how the assistant looks at the screen; listing them as work would
      // bury the edits under noise. Everything else goes up the moment it starts, so a call that is
      // taking its time is visibly taking its time rather than simply absent.
      const shown = call.name !== 'get_project' && call.name !== 'get_comp';
      const started = Date.now();
      actionLogger.ai(`AI Tool: ${call.name}`, { turnId: call.turnId, callId: call.callId, args: call.args });
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
      avatarBus.toolStart(call.turnId, call.callId, call.name, call.args);
      // A Plugin Maker turn may call only the Maker's own tools (src/lib/harness.ts; the backend
      // refuses the rest too). Within them, what the assistant may do without asking is the user's
      // choice, not the model's.
      const maker = makerTurns.current.has(call.turnId);
      const outside = maker ? harnessRefusal('plugin-maker', call.name) : null;
      const guidedBlock = !outside && guidedTurns.current.has(call.turnId) ? guidedRefusal(call.name, (call.args && typeof call.args === 'object' ? call.args : {}) as Record<string, unknown>) : null;
      const permitted = outside ? { ok: false as const, reason: outside } : guidedBlock ? { ok: false as const, reason: guidedBlock } : allowTool(permissionRef.current, call.name);
      let workflow = editWorkflows.current.get(call.turnId);
      if (!workflow) {
        // Rebuilt after "New conversation" cleared it mid-turn: a Plugin Maker turn stays quick and never asks for a frame size.
        workflow = new EditWorkflow(hostRef.current.history.current(), hostRef.current.assets(), maker ? 'quick' : 'full', settingsRef.current.disableLocalGeneration ?? true, !maker);
        editWorkflows.current.set(call.turnId, workflow);
      }
      if (!permitted.ok) {
        result = { ok: false as const, error: permitted.reason };
      } else {
        try {
          const args = (call.args && typeof call.args === 'object' ? call.args : {}) as Record<string, unknown>;
          const project = hostRef.current.history.current();
          // The Maker builds plugins, not a video: the edit workflow's phases never gate its tools.
          const blocked = maker ? null : workflow.before(call.name, args, project) || (call.name === 'save_storyboard' ? workflow.validateStoryboard(args, project) : null);
          // Flagged separately from an ordinary tool failure: every other call from the same
          // blind batch is refused for the identical reason (wrong phase, unread timeline,
          // missing prerequisite), so a CLI-protocol turn can stop burning through the rest of
          // that batch the moment it sees this, instead of repeating the same refusal dozens of
          // times before the model gets a chance to react (see chat.rs's text() loop).
          if (blocked) result = { ok: false as const, error: blocked, guardBlocked: true };
          else if (call.name === 'editing_workflow_status') {
            const st = workflow.status(project);
            const summary = st.timelineRead
              ? 'Actual workflow receipts; pending steps must be completed before editing.'
              : 'Workflow initialized. Call get_comp next to inspect the comp timeline before planning or editing.';
            result = { ok: true as const, summary, workflow: st };
          }
          else if (call.name === 'verify_edit_workflow') result = workflow.verify(project, hostRef.current.assets(), turnPrompt(call.turnId));
          else {
            const host = hostRef.current;
            const turnWorkflow = workflow;
            const synchronousHost = { ...host, history: { ...host.history,
              commit: (...args: Parameters<typeof host.history.commit>) => flushSync(() => host.history.commit(...args)),
              view: (...args: Parameters<typeof host.history.view>) => flushSync(() => host.history.view(...args)),
              undo: () => flushSync(() => host.history.undo()),
            },
            // The same checks as above, for each call a custom tool makes on the model's behalf.
            guard: (name: string, stepArgs: Record<string, unknown>) => {
              const outsideHarness = maker ? harnessRefusal('plugin-maker', name) : null;
              if (outsideHarness) return outsideHarness;
              const allowed = allowTool(permissionRef.current, name);
              if (!allowed.ok) return allowed.reason;
              const rawStep = guidedTurns.current.has(call.turnId) ? guidedRefusal(name, stepArgs) : null;
              if (rawStep) return rawStep;
              return turnWorkflow.before(name, stepArgs, hostRef.current.history.current());
            },
            record: (name: string, stepArgs: Record<string, unknown>, stepResult: ToolResult) => turnWorkflow.record(name, stepArgs, stepResult, hostRef.current.history.current()),
            };
            result = await runTool(synchronousHost, call.name, call.args, controller.signal, call.turnId);
            workflow.record(call.name, args, result, hostRef.current.history.current());
            // A saved plan carries this turn's analysis receipts forward, so the gathering and
            // editing turns start from the transcripts and frame scans already done.
            if (result.ok && (call.name === 'save_storyboard' || call.name === 'save_video_blueprint')) {
              const receipts = workflow.receipts(hostRef.current.history.current());
              const compId = workflow.status(hostRef.current.history.current()).compId;
              if (receipts && compId) flushSync(() => hostRef.current.history.commit((current) => updateComp(current, compId, (c) => (c.production ? { ...c, production: { ...c.production, receipts } } : c)), 'AI: plan receipts'));
              // Every card gets a picture as the plan lands: frames of the edit always; generated
              // concepts only when local generation is on (they occupy the GPU for minutes).
              const planned = compId ?? hostRef.current.history.current().activeCompId;
              if (planned && frameHostRef.current) fillMissingCardFrames(frameHostRef.current, planned, !(settingsRef.current.disableLocalGeneration ?? true));
            }
          }
          if (call.name === 'verify_edit_workflow' && result.ok) {
            const compId = workflow.status(hostRef.current.history.current()).compId;
            if (compId) flushSync(() => hostRef.current.history.commit((current) => updateComp(current, compId, (c) => (c.production && c.production.phase !== 'done' ? { ...c, production: advanceProduction(c.production, 'done') } : c)), 'AI: production verified'));
          }
        } catch (error) {
          result = { ok: false as const, error: errorText(error) };
        }
      }
      // Always text: the activity list renders it, and a tool that put an object here crashed the chat.
      const told: unknown = result.ok ? (result.summary ?? 'done') : result.error;
      const summary = typeof told === 'string' ? told : JSON.stringify(told) ?? String(told);
      const changedProject = result.ok && hostRef.current.history.current() !== projectBeforeTool;
      toolAborts.current.delete(call.callId);
      avatarBus.toolEnd(call.turnId, call.callId, call.name, result.ok, projectBeforeTool, hostRef.current.history.current());
      const ms = Date.now() - started;
      if (result.ok) {
        actionLogger.ai(`Tool Finished: ${call.name} (${ms}ms) - ${summary}`, { result });
      } else {
        actionLogger.error(`Tool Failed: ${call.name} - ${summary}`, { error: result.error, callId: call.callId, args: call.args });
      }
      if (shown) {
        const status = result.ok ? ('done' as const) : permitted.ok ? ('failed' as const) : ('denied' as const);
        setToolRuns((current) => ({
          ...current,
          [call.turnId]: (current[call.turnId] ?? []).map((run) => (run.callId === call.callId ? { ...run, summary, status, ms, changedProject, ...(result.ok && call.name === 'train_brand_kit' && typeof result.kitId === 'string' && typeof result.sourceId === 'string' ? { training: { kitId: result.kitId, sourceId: result.sourceId } } : {}) } : run)),
        }));
      }
      // Anything the user typed while this turn works goes back with this result, so the model reads it now.
      // A repeat of a read the model already holds goes back as a one-line note (Token Council).
      const reply = readDedupeFor(call.turnId).pass(call.name, call.args, result);
      trace(call.turnId, toolEvent({ name: call.name, callId: call.callId, sentArgs: sent.args, args: call.args, result, reply, permitted: permitted.ok, ms, changedProject }));
      await api.chatToolResult(call.turnId, call.callId, steer.attach(call.turnId, reply)).catch(() => undefined);
    });
    return () => void pending.then((unlisten) => unlisten());
  }, []);

  /**
   * Puts the project back to before an AI turn. Straight away when nothing has changed since the
   * turn ended; otherwise it asks first, because the snapshot is the whole project — the user's
   * own edits and any later turn since would go with it (one Ctrl+Z brings them back).
   */
  const revertTurn = (turnId: string): Promise<boolean> => {
    const snapshot = turnSnapshots.current.get(turnId);
    if (!snapshot) return Promise.resolve(false);
    const apply = () => {
      history.commit(snapshot, 'Revert AI edits');
      turnSnapshots.current.delete(turnId);
      turnResults.current.delete(turnId);
      return true;
    };
    const after = turnResults.current.get(turnId);
    if (after && after === history.current()) return Promise.resolve(apply());
    return new Promise((resolve) => setDialog(
      <ConfirmDialog
        title="Revert these AI edits?"
        body="The project has changed since this turn — your own edits, or a later AI turn. Reverting puts the whole project back to how it was before this turn, so those later changes are undone too. Ctrl+Z straight after brings them back."
        confirmLabel="Revert anyway"
        onConfirm={() => { setDialog(null); resolve(apply()); }}
        onClose={() => { setDialog(null); resolve(false); }}
      />,
    ));
  };

  /**
   * The user pressed Start generating or Start editing. The phase moves in the project first —
   * deterministically, so the guard opens the right tools whatever the model does — and then the
   * model is told what the phase asks of it.
   */
  /** A new conversation ends the current production: the dock goes, and the workflow guard starts clean. Undoable like any edit. */
  const endConversation = () => {
    const active = history.current();
    const target = active.comps.find((c) => c.id === active.activeCompId) ?? active.comps[0];
    if (target?.production) history.commit((current) => updateComp(current, target.id, (c) => ({ ...c, production: null })), 'New conversation');
    editWorkflows.current.clear();
  };
  /**
   * Full access runs the pipeline through: a turn that ends with the plan saved, or with
   * everything gathered, presses Start generating / Start editing itself — once per step, never
   * after a stop, an error or while a question waits for the user. Other modes wait for the button.
   */
  const autoAdvanced = useRef(new Set<string>());
  const pendingAsksRef = useRef(mainAsks);
  pendingAsksRef.current = mainAsks;
  const autoAdvance = (outcome: TurnOutcome) => {
    if (outcome.stopped || outcome.faultKind) return;
    if (((settingsRef.current.permission as PermissionMode | null) ?? DEFAULT_PERMISSION) !== 'full') return;
    window.setTimeout(() => {
      const current = history.current();
      const target = current.comps.find((item) => item.id === current.activeCompId);
      const phase = target?.production?.phase;
      const next = phase === 'plan-ready' ? 'gathering' : phase === 'gathered' ? 'editing' : null;
      if (!target || !next || pendingAsksRef.current.length) return;
      const key = `${target.id}:${next}:${target.production?.updatedAt ?? 0}`;
      if (autoAdvanced.current.has(key)) return;
      autoAdvanced.current.add(key);
      toast({ tone: 'info', title: next === 'gathering' ? 'Full access: generating now' : 'Full access: editing now', body: 'Bhippi carries on without waiting for the button. Switch to Auto-edit to review each step first.', timeout: 4500 });
      advanceProductionPhase(target.id, next);
    }, 700);
  };

  /** Main-chat turns started so far: a phase start checks that its message really began a turn. */
  const turnStarts = useRef(0);
  /**
   * Moves the production to `phase` and tells the model, as one step. It waits for the chat to be
   * idle first (a message sent while a turn is still closing went into that turn and was lost, so
   * the phase moved on with nobody working and no button left to press), and if no turn has
   * started a few seconds later it puts the phase back, so the button is there to press again.
   */
  const advanceProductionPhase = (compId: string, phase: 'gathering' | 'editing' | ProductionPhase) => {
    const message = phase === 'gathering'
      ? 'Start generating. The plan is approved: begin the GATHER phase now. Call editing_workflow_status, then gather every planned shot one call at a time with its sceneIndex — text-to-video shots 5–7 s from their own script and prompt (generate_cloud_media when cloud generation is on — every generated shot in one call so the editor approves them together — otherwise generate_local_media task video, wait true), images, downloads and scrapes into their research folders, the voice-over (synthesize_speech_voiceover) and the music bed. Retry a failed generation once with a simpler prompt. When everything has a real asset, call finish_gathering and end your turn with a short list of what was gathered. Do not touch the timeline.'
      : 'Start editing. Everything is gathered: begin the EDIT phase now. Call editing_workflow_status and get_comp, then (from scratch) execute_blueprint or (footage) work the saved storyboard beat by beat: cuts and pacing, level_audio, analyze_music_beats + snap_cuts_to_beats, seamless_transition on beats, rotoscope_clip → erase_subject_clip → add_text_behind_subject where planned, each beat\'s planned graphic — with a brand kit active, its brand-* recipe via create_motion_scene; otherwise a motion-engine template via create_motion_scene, or a Crimson HTML template via create_motion_graphic where the engine has none; layout_clip where the beat has a side panel, SFX on events, captions. Then POLISH: run_frame_qa, fix every overlap, run it again until clear, and finish with get_comp + verify_edit_workflow. Do not stop until verify passes or you have named the exact blocker.';
    const label = phase === 'gathering' ? 'Start generating' : 'Start editing';
    const deliver = (tries: number) => {
      const chat = chatApi.current;
      if (!chat) return;
      if (chat.busy() && tries > 0) {
        window.setTimeout(() => deliver(tries - 1), 400);
        return;
      }
      const before = history.current().comps.find((c) => c.id === compId)?.production?.phase ?? null;
      history.commit((current) => updateComp(current, compId, (c) => (c.production ? { ...c, production: advanceProduction(c.production, phase) } : c)), label);
      const started = turnStarts.current;
      // A production phase is the full workflow, whatever the composer is set to.
      chat.send(message, { mode: 'full' });
      window.setTimeout(() => {
        if (turnStarts.current !== started || !before) return;
        history.commit((current) => updateComp(current, compId, (c) => (c.production && c.production.phase === phase ? { ...c, production: { ...c.production, phase: before } } : c)), `${label} (did not start)`);
        toast({ tone: 'error', title: 'The assistant did not start', body: `Press ${label} again (the button is above the message box).`, timeout: 8000 });
      }, 4000);
    };
    // Up to a minute for a closing turn to settle.
    window.setTimeout(() => deliver(150), 50);
  };

  /**
   * The polish pass: the model looks at every frame of the whole timeline (or the in/out
   * selection), fixes what is off and checks again until it is clear. A production being edited
   * runs it in its own workflow; any other timeline in Quick edit, so it is not first sent back to
   * transcribe and storyboard footage it is only polishing.
   */
  const polishEdit = () => {
    const target = history.current().comps.find((entry) => entry.id === history.current().activeCompId);
    if (!target) return;
    const selection = target.inPoint !== null && target.outPoint !== null && target.outPoint > target.inPoint;
    const range = selection ? `the in/out selection ${timecode(target.inPoint!, target.fps)}–${timecode(target.outPoint!, target.fps)} of "${target.name}" (run_frame_qa with "selection": true)` : `the whole timeline of "${target.name}"`;
    const produced = !!target.production && ['editing', 'polishing', 'done'].includes(target.production.phase);
    const message = `Polish ${range}. This is the final look-and-improve pass: make what is there better, do not re-plan or add new sections. `
      + '1) editing_workflow_status and get_comp. '
      + '2) run_frame_qa over that range. It renders frames with the motion graphics drawn in and reports anything off the frame or outside the safe area, blank or white frames, black edges, graphics over the face, collisions. '
      + '3) Fix every problem at its source: a footage card or panel outside the frame → layout_clip (its slots sit inside the safe area) or update_motion_scene patches (motion comps are layered: patch the layer by its id); a white, blank or flat frame → a designed background plate under it (the project\'s generated gradient on V1, fill_background) and background "none" on full-frame brand templates over it; black edges → fill_background; overlaps → move, shrink or retime one of them. '
      + '4) Look at the contact frames yourself: contrast, reading time, one focal point, nothing cramped against an edge; improve what looks weak. '
      + '5) run_frame_qa again until it is clear, then get_comp and verify_edit_workflow. Say what you changed and anything you could not fix.';
    chatApi.current?.send(message, { mode: produced ? 'full' : 'quick' });
  };

  // ── persistence ────────────────────────────────────────────────────────
  /** Why the last autosave was refused, so one broken project is reported once, not per edit. */
  const saveFault = useRef<string | null>(null);
  /** Set once the window is closing without saving, so a waiting autosave cannot bring the discarded edits back. */
  const discarding = useRef(false);
  useEffect(() => {
    if (!loaded) return;
    const handle = window.setTimeout(() => {
      if (discarding.current) return;
      // Healed here, once the edits have settled, not synchronously on every change (each frame of a drag).
      api.projectSave(healProject(project))
        .then(() => {
          void api.storageProjectDir().then((dir) => { projectDirRef.current = dir; }).catch(() => undefined);
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

  // Media deleted (or put back) in Explorer shows as offline (or online) when the window comes
  // back into focus. The check is one stat per file; the library only reloads when it changed.
  useEffect(() => {
    const onFocus = () => {
      void api.libraryMissing().then((missing) => {
        const gone = new Set(missing);
        if (assetsRef.current.some((asset) => !!asset.missing !== gone.has(asset.id))) void refreshAssets();
      }).catch(() => undefined);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshAssets]);

  const settingsStore = useMemo(() => settingsSync(EMPTY_SETTINGS, settingsRef, setSettings), []);
  const saveSettings = useCallback((patch: Partial<Settings>) => settingsStore.save(patch), [settingsStore]);
  // The user's own avatar colours (Settings › Avatar) repaint every drawing of the characters.
  useEffect(() => setAvatarColours(settings.avatarColors), [settings.avatarColors]);

  // The welcome tour: once, on a fresh install, after the setup closes — unless switched off.
  useEffect(() => {
    if (!loaded || onboarding || licenseBlocked || tourOffered.current) return;
    if (settings.tourSeen !== false || settings.tour === false) return;
    tourOffered.current = true;
    setMode('edit');
    setTour(true);
  }, [loaded, onboarding, licenseBlocked, settings.tourSeen, settings.tour]);
  const startTour = useCallback(() => {
    setSettingsTab(null);
    setMaximized(null);
    setMode('edit');
    setTour(true);
  }, []);
  const tourStep = useCallback((id: TourStepId) => setChatTab(id === 'providers' ? 'providers' : 'chat'), []);
  const endTour = useCallback(() => {
    setTour(false);
    setChatTab('chat');
    saveSettings({ tourSeen: true });
  }, [saveSettings]);

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
  // Only when the look itself changes: settings also save the layout and zoom every few hundred ms,
  // and each of those used to re-apply the theme and notify every plugin page.
  const theme = resolveTheme(settings);
  const glass = resolveGlass(settings);
  const motion = resolveMotion(settings);
  const themeKey = JSON.stringify([theme, glass, motion]);
  useEffect(() => {
    applyTheme(theme, glass, motion);
    pluginEvents.theme();
  }, [themeKey]);

  // ── project files ──────────────────────────────────────────────────────
  /**
   * Everything a .bhippi needs to open complete: the project, its media, and in `extras` the
   * brand kit (so it opens with its look on a machine that never had the kit), the chat
   * transcript and the project folder its files were sorted into.
   */
  const documentFor = async (value: Project): Promise<BhippiDocument> => {
    const [chat, projectFolder] = await Promise.all([
      api.chatLogLoad().catch(() => [] as unknown[]),
      api.storageProjectDir().catch(() => null),
    ]);
    return {
      format: 'bhippi', version: 3, savedAt: new Date().toISOString(), project: value,
      assets: assets.filter((asset) => value.media.some((ref) => ref.assetId === asset.id)),
      extras: { brandKit: resolveActiveKit(settingsRef.current.brandKits, value), chat, projectFolder },
    };
  };

  const samePath = (a: string, b: string) => a.replace(/\//g, '\\').toLowerCase() === b.replace(/\//g, '\\').toLowerCase();
  const rememberRecent = (path: string) => {
    const recents = [path, ...settingsRef.current.recentProjects.filter((item) => !samePath(item, path))].slice(0, 12);
    saveSettings({ recentProjects: recents, projectPath: path });
  };
  const forgetRecent = (path: string) => {
    const recents = settingsRef.current.recentProjects.filter((item) => item !== path);
    if (recents.length !== settingsRef.current.recentProjects.length) saveSettings({ recentProjects: recents });
  };

  // Recent projects are only offered while their file is still on disk: checked whenever the list
  // changes, Home shows, or the window comes back into focus (a file moved or deleted meanwhile).
  // Until a check answers, an entry counts as missing, so nothing stale is ever clickable.
  const [recentFound, setRecentFound] = useState<ReadonlySet<string>>(() => new Set());
  const recentKey = settings.recentProjects.join('\n');
  const checkRecents = useCallback(async () => {
    const paths = settingsRef.current.recentProjects;
    if (!paths.length) { setRecentFound(new Set()); return; }
    const found = await api.projectFilesExist(paths).catch(() => paths.map(() => false));
    setRecentFound(new Set(paths.filter((_, index) => found[index])));
  }, []);
  useEffect(() => { void checkRecents(); }, [recentKey, mode, checkRecents]);
  useEffect(() => {
    const onFocus = () => void checkRecents();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [checkRecents]);
  const usableRecents = settings.recentProjects.filter((path) => recentFound.has(path));
  const openRecent = (path: string) => guardUnsaved(() => void openProjectFile(path, true), 'Open another project');

  const writeProject = async (path: string, keepPath: boolean): Promise<boolean> => {
    const target = path.toLowerCase().endsWith('.bhippi') ? path : `${path}.bhippi`;
    try {
      // The save gathers every file the project uses (AI downloads, generated media, voice-overs,
      // roto runs, storyboard pictures, the AI's guidelines…) into the folder the .bhippi owns and
      // files each comp's plan under Documents/Storyboard/ — see src-tauri/src/bundle.rs.
      let base = history.current();
      // Saving to a new file (Save As, or the first save of an untitled project) names the project
      // after that file, so the Project tab and the title bar read what the user typed. A plain Save
      // to the same file keeps a name set in Project Settings.
      const stem = projectNameFromPath(target);
      const samePath = settingsRef.current.projectPath?.toLowerCase() === target.toLowerCase();
      if (keepPath && stem && base.name !== stem && (!samePath || base.name === UNTITLED_PROJECT)) {
        const renamed = { ...base, name: stem };
        history.view((current) => (current === base ? renamed : { ...current, name: stem }));
        base = renamed;
      }
      const report = await api.projectFileSave(target, await documentFor(base), keepPath, storyboardDocs(base));
      if (keepPath) {
        // From now on the project reads its media from that folder: point the open project there.
        const moved = rewritePaths(base, report.rewrites);
        if (moved !== base) history.view((current) => (current === base ? moved : rewritePaths(current, report.rewrites)));
        setSavedProject(moved);
        rememberRecent(target);
        void pluginEvents.session('saved', target);
        projectDirRef.current = report.projectFolder;
        void api.storageSetProject(base.name).catch(() => undefined);
        void refreshAssets();
      }
      const gathered = report.copied + report.moved;
      const folderName = report.projectFolder.split(/[\\/]/).pop();
      const detail = [
        gathered ? `${gathered} file${gathered === 1 ? '' : 's'} gathered into “${folderName}”` : null,
        report.failures.length ? `${report.failures.length} could not be copied: ${report.failures[0]}` : null,
      ].filter(Boolean).join(' · ');
      toast({
        tone: report.failures.length ? 'error' : 'success',
        title: 'Saved',
        body: [target.split(/[\\/]/).pop(), detail].filter(Boolean).join(' — '),
        timeout: report.failures.length ? 9000 : 2600,
        actions: [{ label: 'Open folder', run: () => void api.openPath(report.projectFolder) }],
      });
      return true;
    } catch (error) {
      toast({ tone: 'error', title: 'Could not save', body: errorText(error) });
      return false;
    }
  };

  const saveAs = async (keepPath = true): Promise<boolean> => {
    // Unsaved projects are offered their own project folder (<storage root>/<name>/Project).
    await api.storageSetProject(project.name).catch(() => undefined);
    const folder = await api.storageDir('project').catch(() => null);
    const path = await api.pickSavePath(keepPath ? 'Save project as' : 'Save a copy', `${safeFileName(project.name)}.bhippi`, 'Bhippi project', ['bhippi'], folder);
    if (!path) return false;
    return writeProject(path, keepPath);
  };

  const saveProject = async (): Promise<boolean> => (settingsRef.current.projectPath ? writeProject(settingsRef.current.projectPath, true) : saveAs());

  const openProjectFile = async (path: string, fromRecents = false) => {
    // Checked again right before opening: the file may have gone since the list was drawn.
    if (fromRecents) {
      const [there] = await api.projectFilesExist([path]).catch(() => [false]);
      if (!there) {
        void checkRecents();
        toast({ tone: 'error', title: 'Project not found', body: `${path} was moved or deleted.` });
        return;
      }
    }
    try {
      const raw = (await api.projectFileRead(path)) as BhippiDocument;
      const bundled = Array.isArray(raw.assets) ? raw.assets : [];
      if (bundled.length) {
        await api.libraryAdopt(bundled).catch(() => ({}));
        await refreshAssets();
      }
      const library = await api.libraryList();
      setAssets(library);
      // A graphic's script runs with the app's own rights, so the scripts of a file from elsewhere
      // wait until the user says they trust it. Projects made here and the autosave never come
      // through this path.
      const { project: loaded, count: scripts } = quarantineScripts(loadProject(raw.project ?? raw, new Map(library.map((asset) => [asset.id, asset]))));
      // A file saved before projects took their file's name still says “Untitled project” inside.
      const opened = loaded.name === UNTITLED_PROJECT && projectNameFromPath(path) ? { ...loaded, name: projectNameFromPath(path) } : loaded;
      history.reset(opened);
      setSavedProject(opened);
      setSelection([]);
      playhead.seek(0);
      rememberRecent(path);
      void pluginEvents.session('opened', path);
      void api.storageSetProject(opened.name).catch(() => undefined);
      // What the file carries beyond the project: its brand kit (added if this machine lacks it)
      // and the chat transcript.
      const extras = raw.extras;
      const kit = extras?.brandKit;
      if (kit?.id) {
        const doc = settingsRef.current.brandKits ?? { kits: [], activeId: null };
        if (!doc.kits.some((entry) => entry.id === kit.id)) saveSettings({ brandKits: { kits: [...doc.kits, kit], activeId: doc.activeId ?? kit.id } });
      }
      // The chat is the file's own: one without a transcript opens with an empty chat, not the
      // previous project's (which the next save would otherwise write into this file). The last
      // project's AI turns go too, so an old Revert cannot put that project back over this one.
      chatApi.current?.load(Array.isArray(extras?.chat) ? extras.chat : []);
      turnSnapshots.current.clear();
      turnResults.current.clear();
      turnChanges.current.clear();
      setAiHighlight(null);
      editWorkflows.current.clear();
      setToolRuns({});
      setPendingAsks([]);
      setMode('edit');
      if (scripts) askToRunScripts(scripts, opened);
      toast({ tone: 'success', title: 'Project opened', body: path.split(/[\\/]/).pop(), timeout: 2500 });
    } catch (error) {
      toast({ tone: 'error', title: 'Could not open that project', body: errorText(error) });
    }
  };

  // What the once-subscribed backend events call (see the subscription effect above).
  live.current = { history, openProjectFile };

  /** File › Restore from Backup…: a backup loaded into the open project as one undo step. */
  const restoreBackup = async (path: string) => {
    try {
      const raw = (await api.projectFileRead(path)) as BhippiDocument;
      const bundled = Array.isArray(raw.assets) ? raw.assets : [];
      if (bundled.length) await api.libraryAdopt(bundled).catch(() => ({}));
      const library = await api.libraryList();
      setAssets(library);
      const restored = loadProject(raw.project ?? raw, new Map(library.map((asset) => [asset.id, asset])));
      // The open project keeps its own name and file; only its contents go back.
      const current = history.current();
      history.commit(() => ({ ...restored, name: current.name }), 'Restore Backup');
      toast({ tone: 'success', title: 'Backup restored', body: 'Ctrl+Z undoes it. Save to keep it in the project file.', timeout: 5000 });
    } catch (error) {
      toast({ tone: 'error', title: 'Could not restore that backup', body: errorText(error) });
    }
  };

  restoreBackupRef.current = restoreBackup;

  const hasHeldScripts = project.comps.some((comp) => comp.clips.some((clip) => clip.source.type === 'html' && !!clip.source.quarantinedJs));
  /** Puts back the graphic scripts an opened file held back (File › Enable Graphic Scripts). */
  const enableScripts = () => {
    const current = history.current();
    const restored = restoreScripts(current);
    if (restored !== current) history.commit(() => restored, 'Enable Graphic Scripts');
  };
  const askToRunScripts = (count: number, opened: Project) => {
    setDialog(
      <ConfirmDialog
        title="Run graphic scripts?"
        body={`This project contains ${count} motion-graphic script${count === 1 ? '' : 's'}. Scripts can run commands on your PC. Only run them if you trust the person who sent this file. Run them?`}
        confirmLabel="Run them"
        discardLabel="Not now"
        onConfirm={() => {
          setDialog(null);
          // Straight after opening, trusting the file is part of opening it: no undo step, nothing unsaved.
          if (history.current() !== opened) return enableScripts();
          const restored = restoreScripts(opened);
          history.reset(restored);
          setSavedProject(restored);
        }}
        onDiscard={() => setDialog(null)}
        onClose={() => setDialog(null)}
      />,
    );
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
      const picked = await api.pickOpenPath('Open project', 'Bhippi project', ['bhippi']);
      if (picked) await openProjectFile(picked);
    }, 'Open another project');

  const newProjectNow = () =>
    guardUnsaved(() => {
      const fresh = newProject();
      history.reset(fresh);
      void api.storageSetProject(fresh.name).catch(() => undefined);
      setSavedProject(null);
      saveSettings({ projectPath: null });
      void pluginEvents.session('opened', null);
      setSelection([]);
      setBinFolder(null);
      setSourceId(null);
      setToolRuns({});
      setPendingAsks([]);
      playhead.seek(0);
      chatApi.current?.clear();
      turnSnapshots.current.clear();
      turnResults.current.clear();
      turnChanges.current.clear();
      setAiHighlight(null);
      editWorkflows.current.clear();
      renderOriginals.current.clear();
      setMode('edit');
      toast({ tone: 'info', title: 'New project', body: 'Started a fresh, clean, empty project.', timeout: 2000 });
    }, 'New project');

  // Closing the window asks about unsaved work in a project that has a file. An untitled project
  // closes without asking: the session autosave is its copy and reopens it next launch.
  // "Close without saving" puts the session back to the file as last saved; otherwise the autosave
  // would reopen the discarded edits next launch, marked as saved. Registered once and read
  // through a ref, so the listener is not torn down and re-added on every edit.
  const closeState = useRef({ savedProject, path: settings.projectPath, current: history.current, save: saveProject });
  closeState.current = { savedProject, path: settings.projectPath, current: history.current, save: saveProject };
  /** The user already chose to stop the AI's turn and close: the second close request goes on. */
  const stopTurnAndClose = useRef(false);
  useEffect(() => {
    const window_ = getCurrentWindow();
    const pending = window_.onCloseRequested((event) => {
      // Closing mid-turn stops the AI: say so first. The chat is saved as it goes and the AI's
      // finished pieces are in the project's AI Work folder, so stopping keeps what was done, and
      // the turn reopens as interrupted with Continue to carry on.
      if (chatApi.current?.busy() && !stopTurnAndClose.current) {
        event.preventDefault();
        setDialog(
          <ConfirmDialog
            title="Bhippi AI is still working"
            top
            body="Closing stops this turn. Everything it has done so far is kept: the chat is saved, and finished pieces are in the project's AI Work folder. Next time, press Continue to carry on from there."
            confirmLabel="Stop and close"
            onConfirm={() => {
              setDialog(null);
              stopTurnAndClose.current = true;
              chatApi.current?.stop();
              // A moment for the stopped transcript to be written, then the usual close (which still asks about unsaved changes).
              window.setTimeout(() => void window_.close(), 800);
            }}
            onClose={() => setDialog(null)}
          />,
        );
        return;
      }
      const { savedProject: saved, path, current } = closeState.current;
      // A clean close (the next launch will not offer crash recovery).
      markRunning(false);
      if (!path || !saved || saved === current()) return;
      event.preventDefault();
      setDialog(
        <ConfirmDialog
          title="Close Bhippi"
          top
          body={`Save changes to “${current().name}” before closing?`}
          confirmLabel="Save and close"
          discardLabel="Close without saving"
          onConfirm={() => { setDialog(null); void closeState.current.save().then((ok: boolean) => { if (ok) void window_.destroy(); }); }}
          onDiscard={() => {
            setDialog(null);
            discarding.current = true;
            void api.projectSave(healProject(saved)).catch(() => undefined).finally(() => void window_.destroy());
          }}
          onClose={() => { markRunning(true); setDialog(null); }}
        />,
      );
    });
    return () => void pending.then((unlisten) => unlisten());
  }, []);

  // Updates from bhippi.com (lib/updater.ts): checked in the background once the project is in.
  // Installing closes Bhippi, so the work is saved first. A project with a file is saved to it when
  // it has changes, as closing the window does. Every project is also flushed to the autosave that
  // reopens it, so an edit still in the autosave's half-second wait is not lost; for the session
  // project (no file) that is its only copy, so the install waits for it rather than asking where
  // to save.
  useEffect(() => {
    updater.setBeforeInstall(async () => {
      const path = settingsRef.current.projectPath;
      if (path && savedProject && savedProject !== history.current() && !(await saveProject())) return false;
      try {
        await api.projectSave(healProject(history.current()));
        return true;
      } catch (error) {
        if (path) return true;
        toast({ tone: 'error', title: 'Could not save before updating', body: `${errorText(error)} The update is still ready in Settings › About.` });
        return false;
      }
    });
  });
  useEffect(() => {
    if (loaded) updater.start(() => settingsRef.current.autoUpdate !== false);
  }, [loaded]);
  // Only the phase and version the toast needs: the whole state changes with every download
  // progress event, and the app must not re-render for those.
  const updateNews = useUpdaterPick(({ phase, info }) => ((phase === 'ready' || phase === 'available') && info?.latest ? `${phase} ${info.latest}` : null));
  const announced = useRef('');
  useEffect(() => {
    if (!updateNews || announced.current === updateNews) return;
    const [phase, version] = updateNews.split(' ');
    // With automatic downloads on, "available" is only a moment before the download starts (the
    // store starts one after every check that finds an update): say nothing until it is ready.
    if (phase === 'available' && settingsRef.current.autoUpdate !== false && !updater.get().info?.dev) return;
    announced.current = updateNews;
    toast(
      phase === 'ready'
        ? { tone: 'success', title: `Bhippi ${version} is ready`, body: 'Install it now, or any time from Settings › About. Your project is saved first.', timeout: 15000, actions: [{ label: 'Restart and install', run: () => void updater.install() }] }
        : { tone: 'info', title: `Bhippi ${version} is available`, body: 'Download it from Settings › About.', timeout: 10000, actions: [{ label: 'Open', run: () => setSettingsTab('about') }] },
    );
  }, [updateNews, toast]);

  // ── layout ─────────────────────────────────────────────────────────────
  /** The editing area's dock tree (lib/dockTree.ts); every panel but the chat lives in it. */
  const tree = useMemo(() => readTree(layout.tree), [layout.tree]);
  const treeOf = (current: WorkspaceLayout) => readTree(current.tree);
  const openPanels = useMemo(() => new Set<string>(panelsIn(tree)), [tree]);
  const hidden = (panel: PanelId) => (panel === 'chat' ? layout.hidden.includes('chat') : !openPanels.has(panel));
  // Plugins docked in the editing area are panels there, not tabs in the Plugins panel.
  const dockedIds = useMemo(() => new Set([...openPanels].filter((panel) => panel.startsWith('plugin:')).map((panel) => panel.slice(7))), [openPanels]);
  // Plugins that draw a clip in this project keep a hidden page running to draw it (clipRender.ts).
  const clipPluginKey = pluginClipIds(project).join(',');
  const clipPlugins = useMemo(() => (clipPluginKey ? clipPluginKey.split(',') : []), [clipPluginKey]);
  // The Plugins panel always has the built-in Characters tab, so it shows unless the user hid it.
  const shownPlugins = panelPlugins(plugins, dockedIds);
  const showPlugins = !hidden('plugins');
  /** The tree after `change`, for the layout state. */
  const editTree = (change: (current: DockNode | null) => DockNode | null) => setLayout((current) => ({ ...current, tree: change(treeOf(current)) }));
  const setPanelVisible = (panel: PanelId, visible: boolean) => {
    if (panel === 'chat') setLayout((current) => ({ ...current, hidden: visible ? current.hidden.filter((id) => id !== 'chat') : [...new Set([...current.hidden, 'chat' as PanelId])] }));
    else editTree((current) => (visible ? showInTree(current, panel as DockPanelId) : removePanel(current, panel as DockPanelId)));
    if (!visible && maximized === panel) setMaximized(null);
  };
  // A question from Bhippi AI is answered in the chat, and the turn waits on it: bring the chat
  // back (and out from under a maximized panel) so the card and its options are never hidden.
  useEffect(() => {
    if (!mainAsks.length) return;
    setLayout((current) => (current.hidden.includes('chat') ? { ...current, hidden: current.hidden.filter((id) => id !== 'chat') } : current));
    setMaximized((current) => (current && current !== 'chat' ? null : current));
  }, [mainAsks.length]);
  /** Opens a panel (or brings its tab to the front); `tab` names one of the panels that were Project's tabs. */
  const showPanel = (panel: PanelId, tab?: ProjectTab) => {
    const target: PanelId = tab && tab !== 'project' ? tab : panel;
    setPanelVisible(target, true);
    setFocused(target);
  };
  const toggleMax = (panel: PanelId) => setMaximized((current) => (current === panel ? null : panel));
  const resize = (key: keyof Omit<WorkspaceLayout, 'hidden' | 'meters'>, min: number, max: number, sign = 1) => (delta: number) =>
    setLayout((current) => ({ ...current, [key]: clamp((layoutStart.current[key] as number) + delta * sign, min, max) }));
  const beginResize = () => {
    layoutStart.current = layout;
  };

  // ── panels dragged anywhere in the editing area ───────────────────────
  const dockAreaRef = useRef<HTMLDivElement>(null);
  const panelName = useCallback((panel: DockPanelId) => PANEL_NAMES[panel] ?? (panel.startsWith('plugin:') ? plugins.find((item) => item.id === panel.slice(7))?.name ?? 'Plugin' : panel), [plugins]);
  const dropPanel = useCallback((panel: DockPanelId, drop: DockDrop) => {
    if (panel.startsWith('plugin:')) {
      const id = panel.slice(7);
      // Dropped back on the Plugins panel: it goes back to being one of its tabs.
      if (drop.panel === 'plugins' && drop.edge === 'center') {
        editTree((current) => removePanel(current, panel));
        setPluginTab(id);
        return;
      }
      const plugin = plugins.find((item) => item.id === id);
      if (plugin && !(plugin.enabled && plugin.panel)) void patchPlugin(id, { enabled: true, panel: true });
    }
    editTree((current) => movePanel(current, panel, drop));
    setMaximized(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plugins]);
  const { drag: panelDrag, begin: beginPanelDrag } = usePanelDrag(dockAreaRef, panelName, dropPanel);

  // ── plugins docked in the editing area ─────────────────────────────────
  /** Puts a plugin in the editing area as a panel of its own (on the right edge; drag it anywhere from there). */
  const dockPlugin = (id: string) => {
    const plugin = plugins.find((item) => item.id === id);
    if (plugin && !(plugin.enabled && plugin.panel)) void patchPlugin(id, { enabled: true, panel: true });
    editTree((current) => showInTree(current, `plugin:${id}`));
  };
  /** Takes a plugin out of the editing area and shows it as its tab in the Plugins panel again. */
  const undockPlugin = (id: string) => {
    editTree((current) => showInTree(removePanel(current, `plugin:${id}`), 'plugins'));
    setPluginTab(id);
  };
  /** Closes a docked plugin: out of the editing area and not a Plugins panel tab either (Plugins › Show as Panel brings it back). */
  const closeDockedPlugin = (id: string) => {
    editTree((current) => removePanel(current, `plugin:${id}`));
    void patchPlugin(id, { panel: false });
  };
  const dragPlugin = (id: string, _name: string, event: ReactPointerEvent) => beginPanelDrag(`plugin:${id}`, event);

  // ── named workspaces (Window › Workspaces) ─────────────────────────────
  const workspaces = settings.workspaces ?? [];
  const saveWorkspaceAs = () => setDialog(
    <RenameDialog title="Save Workspace As" name={settings.workspaceName ?? 'My workspace'} onClose={() => setDialog(null)} onSubmit={(name) => {
      setDialog(null);
      const clean = name.trim();
      if (!clean) return;
      saveSettings({ workspaces: [...workspaces.filter((item) => item.name !== clean), { name: clean, layout: { ...layout } }], workspaceName: clean });
      toast({ tone: 'success', title: `Workspace “${clean}” saved`, body: 'Pick it any time from Window › Workspaces.', timeout: 3000 });
    }} />,
  );
  const applyWorkspace = (name: string) => {
    const saved = workspaces.find((item) => item.name === name);
    if (!saved) return;
    setLayout({ ...DEFAULT_LAYOUT, ...saved.layout, hidden: saved.layout.hidden?.includes('chat') ? ['chat'] : [], tree: layoutTree(saved.layout) ?? defaultTree(), panelsSplit: true, docked: [] });
    setMaximized(null);
    saveSettings({ workspaceName: name });
  };
  const deleteWorkspace = (name: string) => saveSettings({ workspaces: workspaces.filter((item) => item.name !== name), workspaceName: settings.workspaceName === name ? null : settings.workspaceName ?? null });

  // ── editing helpers ────────────────────────────────────────────────────
  const editComp = (change: (current: Comp) => Comp, label: string) => {
    if (!comp) return;
    history.commit((current) => updateComp(current, comp.id, change), label);
  };
  const limit = useCallback((clip: Clip) => sourceLimit(history.current(), assetMap, clip), [history, assetMap]);
  const targetedTracks = () => (comp ? comp.tracks.filter((track) => track.targeted && !track.locked).map((track) => track.id) : []);

  const showPanelRef = useRef(showPanel);
  showPanelRef.current = showPanel;

  /** After a drop lands: select it and, when it made or filled an empty comp, show it from the start. */
  const landDrop = useCallback(({ compId, clips }: { compId: string; clips: Clip[] }) => {
    if (!clips.length) return;
    setSelection(clips.map((clip) => clip.id));
    if (clips.some((clip) => clip.start > 0.001)) return;
    playhead.seek(0);
    showPanelRef.current('timeline');
    // Fit once the new comp has rendered, so the whole drop is on screen.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (history.current().activeCompId === compId) timelineApi.current?.fit();
    }));
  }, [history]);

  const importFiles = useCallback(async (paths: string[], drop?: { x: number; y: number }) => {
    if (!paths.length) return;
    try {
      const result = await api.libraryImport(paths);
      const all = [...result.imported, ...result.existing];
      // The drop places clips from what the import just returned — the asset list in state doesn't
      // hold new files yet, and reading them from it placed picture-only clips with no sound.
      const map = new Map(assets.map((item) => [item.id, item])) as AssetMap;
      for (const asset of all) map.set(asset.id, asset);
      if (result.imported.length) setAssets((current) => [...current, ...result.imported.filter((asset) => !current.some((item) => item.id === asset.id))]);
      void refreshAssets();
      if (all.length) {
        let placed: { compId: string; clips: Clip[] } | null = null;
        history.commit((current) => {
          let next = { ...current, media: [...current.media, ...all.filter((asset) => !current.media.some((ref) => ref.assetId === asset.id)).map((asset) => ({ assetId: asset.id, folderId: binFolder, offline: false }))] };
          if (!drop) return next;
          const active = next.comps.find((item) => item.id === next.activeCompId) ?? null;
          if (overTimeline(drop.x, drop.y) && (!active || !active.clips.length)) {
            const made = dropIntoEmpty(next, map, active, all.map((asset) => ({ source: { type: 'media', assetId: asset.id } as ClipSource, label: asset.name })), nestComps);
            if (made) {
              placed = { compId: made.compId, clips: made.clips };
              return made.project;
            }
          }
          const target = timelineApi.current?.dropTarget(drop.x, drop.y);
          if (target && active) {
            let cursor = target.time;
            let build = active;
            const clips: Clip[] = [];
            for (const asset of all) {
              const result_ = dropClips(next, map, build, { kind: 'source', source: { type: 'media', assetId: asset.id }, label: asset.name, x: 0, y: 0, ctrl: false }, { ...target, time: cursor }, nestComps);
              build = placeClips(result_.comp, result_.clips, 'overwrite');
              clips.push(...result_.clips);
              cursor += result_.clips[0]?.duration ?? STILL_DEFAULT;
            }
            next = updateComp(next, active.id, () => build);
            placed = { compId: active.id, clips };
          }
          return next;
        }, 'Import');
        if (placed) landDrop(placed);
      }
      if (result.imported.length) toast({ tone: 'success', title: `Imported ${result.imported.length} file${result.imported.length === 1 ? '' : 's'}`, body: result.imported.map((asset) => asset.name).join(', ').slice(0, 160) });
      for (const failure of result.failed.slice(0, 3)) toast({ tone: 'error', title: `Skipped ${failure.path.split(/[\\/]/).pop()}`, body: failure.reason });
    } catch (error) {
      toast({ tone: 'error', title: 'Import failed', body: errorText(error) });
      if (errorText(error).includes('FFmpeg')) setSettingsTab('media');
    }
  }, [assets, binFolder, history, landDrop, nestComps, refreshAssets, toast]);

  /**
   * Files attached to a chat message: into the project's media (a "Chat attachments" bin), never
   * onto the timeline — the AI places them when the user asks. Answers what is now in the project.
   */
  const importForChat = useCallback(async (paths: string[]) => {
    const result = await api.libraryImport(paths);
    const all = [...result.imported, ...result.existing];
    if (result.imported.length) setAssets((current) => [...current, ...result.imported.filter((asset) => !current.some((item) => item.id === asset.id))]);
    void refreshAssets();
    if (all.length) {
      history.commit((current) => {
        const fresh = all.filter((asset) => !current.media.some((ref) => ref.assetId === asset.id));
        if (!fresh.length) return current;
        let folder = current.folders.find((item) => item.name === 'Chat attachments' && !item.parentId);
        const folders = folder ? current.folders : [...current.folders, (folder = { id: uid(), name: 'Chat attachments', parentId: null })];
        return { ...current, folders, media: [...current.media, ...fresh.map((asset) => ({ assetId: asset.id, folderId: folder!.id, offline: false }))] };
      }, 'Attach to chat');
    }
    for (const failure of result.failed.slice(0, 3)) toast({ tone: 'error', title: `Could not import ${failure.path.split(/[\\/]/).pop()}`, body: failure.reason });
    return all.map((asset) => ({ id: asset.id, name: asset.name, path: asset.path }));
  }, [history, refreshAssets, toast]);

  const openCharacters = (mode?: '2d' | '3d') => {
    if (mode) setCharactersMode(mode);
    setCharactersOpen(true);
  };
  // A character from the Characters window: the PNG is already in the library, so it joins the project's media.
  const addCharacter = useCallback((asset: Asset, name: string) => {
    setAssets((current) => (current.some((item) => item.id === asset.id) ? current : [...current, asset]));
    void refreshAssets();
    history.commit((current) => (current.media.some((ref) => ref.assetId === asset.id)
      ? current
      : { ...current, media: [...current.media, { assetId: asset.id, folderId: null, offline: false }] }), `Add character ${name}`);
    toast({ tone: 'success', title: `Added ${name}`, body: 'The character is in the project media as a transparent PNG.', timeout: 3000 });
  }, [history, refreshAssets, toast]);

  const pickFiles = useCallback(async () => {
    const extensions = info?.extensions ?? ['mp4', 'mov', 'mkv', 'webm', 'mp3', 'wav', 'm4a', 'png', 'jpg'];
    const picked = await openDialog({ multiple: true, title: 'Import media', filters: [{ name: 'Media', extensions }] });
    if (picked) await importFiles(Array.isArray(picked) ? picked : [picked]);
  }, [importFiles, info]);

  /**
   * Insert / Overwrite from the Source monitor, by Premiere's three-point rules (lib/timeline.ts
   * `threePointEdit`): the timeline's In and Out, when marked, decide where it lands and how long
   * it is; otherwise the playhead. `fit` (Fit to Fill) retimes the whole source range to the
   * timeline In→Out instead.
   */
  const sourceEdit = (asset: Asset, range: SourceRange, mode: 'insert' | 'overwrite', fit = false) => {
    if (!comp) return;
    const marks = { in: comp.inPoint, out: comp.outPoint };
    const speed = fit ? fitToFillSpeed(marks, range) : null;
    if (fit && !speed) return toast({ tone: 'info', title: 'Mark In and Out in the timeline first', body: 'Fit to Fill plays the source In→Out across the timeline In→Out.' });
    const available = asset.kind === 'image' || !asset.duration ? Infinity : asset.duration - range.in;
    const edit = speed
      ? { start: marks.in!, in: range.in, duration: Math.max(frame, range.out - range.in), note: null }
      : threePointEdit(marks, playhead.get(), range, available, frame);
    const clips = clipsForSource(project, assetMap, { type: 'media', assetId: asset.id }, { start: edit.start, videoTrack: comp.sourceVideo, audioTrack: comp.sourceAudio, in: edit.in, duration: edit.duration });
    if (!clips.length) return toast({ tone: 'info', title: 'Nothing to edit in', body: 'Patch a track in the timeline header first.' });
    const ids = clips.map((clip) => clip.id);
    // From the comp as it is now (an AI edit may have landed since this render), not the render's copy.
    editComp((current) => {
      const placed = placeClips(current, clips, mode);
      return speed ? setSpeed(placed, ids, { speed, duration: marks.out! - marks.in!, limit }) : placed;
    }, speed ? 'Fit to Fill' : mode === 'insert' ? 'Insert' : 'Overwrite');
    setSelection(ids);
    playhead.seek(speed ? marks.out! : edit.start + edit.duration);
    if (edit.note) toast({ tone: 'info', title: mode === 'insert' ? 'Inserted' : 'Overwritten', body: edit.note, timeout: 4000 });
  };

  const openInSource = (assetId: string, range?: SourceRange) => {
    setSourceId(assetId);
    if (range) setSourceRanges((current) => ({ ...current, [assetId]: range }));
    showPanel('source');
  };

  // ── one-click clean-ups (lib/cleanup.ts) ───────────────────────────────
  /** Extracts `ranges` (latest first) from the active comp as one undo step. */
  const cutRanges = (ranges: { start: number; end: number }[], label: string) => {
    if (!comp || !ranges.length) return;
    editComp((current) => ranges.reduce((next, range) => removeRange(next, range.start, range.end, 'extract'), current), label);
  };
  const removeSilences = async () => {
    if (!comp) return;
    const clips = speechClips(comp);
    const assetIds = [...new Set(clips.map((clip) => (clip.source as { assetId: string }).assetId))];
    const loaded = new Map<string, Peaks>();
    for (const id of assetIds) {
      const path = assetMap.get(id)?.peaks;
      const peaks = path ? await loadPeaks(path) : null;
      if (peaks) loaded.set(id, peaks);
    }
    if (!loaded.size) return toast({ tone: 'info', title: 'No speech to check', body: clips.length ? 'The audio levels are still being prepared; try again in a moment.' : 'Remove Silences looks at dialogue on audio tracks (not music or effects).' });
    const ranges = silentRanges(comp, assetMap, (id) => loaded.get(id) ?? null);
    if (!ranges.length) return toast({ tone: 'info', title: 'No long pauses found', body: 'Nothing quieter than −38 dB for 0.6 s or more.', timeout: 3000 });
    const seconds = ranges.reduce((sum, range) => sum + range.end - range.start, 0);
    cutRanges(ranges, 'Remove Silences');
    toast({ tone: 'success', title: `Removed ${ranges.length} silence${ranges.length === 1 ? '' : 's'}`, body: `${seconds.toFixed(1)} s shorter. Ctrl+Z puts them back.`, timeout: 4000 });
  };
  const removeFillers = async () => {
    if (!comp) return;
    const ids = [...new Set(speechClips(comp).map((clip) => (clip.source as { assetId: string }).assetId))];
    const found = ids.length ? await api.transcriptsCached(ids).catch(() => []) : [];
    if (!found.length) return toast({ tone: 'info', title: 'Transcribe first', body: 'Remove Filler Words reads the transcript: open Window › Transcription and press Transcribe.' });
    const words = timelineWords(comp, assetMap, new Map(found.map((transcript) => [transcript.assetId, transcript])));
    const fillers = fillerIndices(words);
    if (!fillers.size) return toast({ tone: 'info', title: 'No filler words found', timeout: 3000 });
    cutRanges(cutRangesForWords(words, fillers), 'Remove Filler Words');
    toast({ tone: 'success', title: `Removed ${fillers.size} filler word${fillers.size === 1 ? '' : 's'}`, body: 'Ctrl+Z puts them back.', timeout: 4000 });
  };
  /** A 9:16 copy of the comp, reframed to fill (the original stays as it is), opened. */
  const makeVerticalCopy = () => {
    if (!comp) return;
    let report = '';
    let madeId: string | null = null;
    history.commit((current) => {
      const copied = copyComp(current, comp.id, `${comp.name} Vertical`);
      if (!copied) return current;
      const reformatted = reformatComp(copied.project, copied.compId, { width: 1080, height: 1920 }, 'fill');
      report = describeReformat(reformatted.report, 'fill');
      madeId = copied.compId;
      return { ...reformatted.project, activeCompId: copied.compId, openCompIds: [...reformatted.project.openCompIds, copied.compId] };
    }, 'Make Vertical Copy');
    if (madeId) toast({ tone: 'success', title: 'Vertical copy made', body: `${report}. The original comp is unchanged.`, timeout: 5000 });
  };

  /**
   * Right-click › Ask Bhippi AI: the chat opens with the clips named (and selected, which the AI
   * reads as `selectedClipIds`), ready for the request. Nothing is sent until the user does.
   */
  const askAboutClips = (clips: Clip[]) => {
    if (!clips.length || !comp) return;
    setSelection(clips.map((clip) => clip.id));
    setPanelVisible('chat', true);
    setChatTab('chat');
    const start = Math.min(...clips.map((clip) => clip.start));
    const end = Math.max(...clips.map(clipEnd));
    const names = [...new Set(clips.map((clip) => clip.name ?? sourceInfo(project, assetMap, clip.source).name))].slice(0, 3).join(', ');
    // The clips go with the message as a scope chip: Auto runs it as a Quick edit that works there.
    chatApi.current?.attachScope(scopeFromClips(project, assetMap, comp, clips.map((clip) => clip.id)));
    chatApi.current?.compose(`About the ${clips.length === 1 ? 'selected clip' : `${clips.length} selected clips`} (${names}${clips.length > 3 ? '…' : ''}, ${timecode(start, fps)}–${timecode(end, fps)}): `);
  };

  /** File › Export › Captions: the active comp's captions as SubRip or WebVTT. */
  const hasCaptions = !!comp?.clips.some((clip) => clip.source.type === 'text' && clip.source.preset === 'caption');
  const exportCaptions = async (format: 'srt' | 'vtt') => {
    if (!comp) return;
    const cues = captionCues(comp);
    if (!cues.length) return toast({ tone: 'info', title: 'No captions in this comp' });
    const folder = exportFolderFor(settingsRef.current.export, await api.storageDir('exports').catch(() => null));
    const path = await api.pickSavePath(`Save captions (.${format})`, `${safeFileName(comp.name)}.${format}`, format === 'srt' ? 'SubRip captions' : 'WebVTT captions', [format], folder);
    if (!path) return;
    try {
      await api.fsWriteFile(path, format === 'srt' ? toSrt(cues) : toVtt(cues), true);
      toast({ tone: 'success', title: `Saved ${cues.length} captions`, body: path.split(/[\\/]/).pop(), timeout: 3000, actions: [{ label: 'Show in folder', run: () => void api.revealPath(path) }] });
    } catch (error) {
      toast({ tone: 'error', title: 'Could not save the captions', body: errorText(error) });
    }
  };

  // Opt-in (the active kit's Learnings): after an AI turn, a correction by the user that reads as a
  // preference is offered as a learning for the kit — never saved without the click.
  useEffect(() => {
    const kit = resolveActiveKit(settingsRef.current.brandKits ?? null, project);
    if (!kit?.learnFromCorrections || !aiHighlight) return;
    const afterTurn = turnResults.current.get(aiHighlight.turnId);
    if (!afterTurn || afterTurn === project || history.undoLabel.startsWith('AI: ')) return;
    const timer = window.setTimeout(() => {
      const suggestion = suggestFromCorrection(afterTurn, history.current(), aiHighlight.clipIds);
      if (!suggestion || offeredCorrections.current.has(suggestion.key)) return;
      offeredCorrections.current.add(suggestion.key);
      toast({
        tone: 'info', title: `Remember this for “${kit.name}”?`, body: `${suggestion.why} Next time: ${suggestion.learning.text.toLowerCase()}.`, timeout: 12000,
        actions: [{ label: 'Remember', run: () => {
          const doc = settingsRef.current.brandKits;
          if (!doc) return;
          const current = doc.kits.find((entry) => entry.id === kit.id);
          if (!current) return;
          const { kit: trained } = addLearnings(current, { kind: 'file', label: 'Your corrections' }, [suggestion.learning]);
          saveSettings({ brandKits: { ...doc, kits: doc.kits.map((entry) => (entry.id === kit.id ? trained : entry)) } });
        } }, { label: 'Not this', run: () => undefined }],
      });
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [project]);

  /** A change the AI made, from the chat's list: its comp open, the playhead on it, the clip selected. */
  const jumpToChange = (change: TurnChange) => {
    if (history.current().activeCompId !== change.compId) openComp(change.compId);
    playhead.seek(change.start);
    timelineApi.current?.reveal(change.start);
    if (change.kind !== 'removed') setSelection([change.clipId]);
  };

  const openComp = (compId: string) => {
    history.view((current) => ({ ...current, activeCompId: compId, openCompIds: current.openCompIds.includes(compId) ? current.openCompIds : [...current.openCompIds, compId] }));
    setSelection([]);
    playhead.seek(0);
    showPanel('timeline');
  };

  // A motion comp that still holds its graphic as one clip opens as its layers — one clip per
  // track, drawing exactly as before — however it became the timeline on screen: the bin, a
  // double-click, a timeline tab that was already open, a project opening on it, the assistant.
  // One undo step; the clips that nest it are untouched.
  useEffect(() => {
    const current = history.current();
    const active = current.comps.find((entry) => entry.id === current.activeCompId);
    if (!active) return;
    if (active.name.startsWith('[Motion]') && !isLayeredComp(active)) {
      const opened = splitMotionComps(current, [active.id]);
      if (opened.split.length) history.commit(() => opened.project, 'Open Motion Layers');
    } else if (active.name.startsWith('[MOGRT]') && !isHtmlLayered(active)) {
      const opened = splitHtmlComp(current, active.id);
      if (opened) history.commit(() => opened, 'Open Graphic Layers');
    }
  }, [project.activeCompId]);

  const closeComp = (compId: string) => {
    history.view((current) => {
      const open = current.openCompIds.filter((id) => id !== compId);
      const active = current.activeCompId === compId ? (open[open.length - 1] ?? null) : current.activeCompId;
      return { ...current, openCompIds: open, activeCompId: active ?? current.comps[0]?.id ?? null };
    });
  };

  const deleteTransition = (id: string) => {
    editComp((current) => ({ ...current, transitions: current.transitions.filter((item) => item.id !== id) }), 'Delete Transition');
    setTransitionSelection(null);
  };

  const deleteSelection = (ripple: boolean) => {
    if (!comp) return;
    // A selected transition goes first: selecting one does not always clear the clip selection.
    if (transitionSelection) return deleteTransition(transitionSelection);
    if (!selection.length) return;
    editComp((current) => removeClips(current, linkedSelection ? withLinked(current, selection) : selection, ripple), ripple ? 'Ripple Delete' : 'Clear');
    setSelection([]);
  };

  const copySelection = (cut: boolean) => {
    if (!comp || !selection.length) return;
    clipboard.current = { clips: selectedClips.map((clip) => ({ clip: { ...clip }, kind: trackOf(comp, clip.trackId)?.kind ?? 'video', index: Math.max(0, trackIndex(comp, clip.trackId)) })), comp: comp.id };
    if (cut) deleteSelection(false);
    toast({ tone: 'info', title: cut ? 'Cut' : 'Copied', body: `${selectedClips.length} clip${selectedClips.length === 1 ? '' : 's'} — Ctrl+V pastes at the playhead.`, timeout: 1800 });
  };

  const paste = (insert: boolean) => {
    const board = clipboard.current;
    if (!board || !comp) return;
    const pasted = pasteClips(history.current(), comp.id, board, playhead.get(), insert ? 'insert' : 'overwrite');
    if (pasted.ids.length) history.commit(() => pasted.project, insert ? 'Paste Insert' : 'Paste');
    if (pasted.skipped.length) toast({ tone: 'info', title: 'Not pasted', body: `${pasted.skipped.length} comp${pasted.skipped.length === 1 ? '' : 's'} would end up inside ${pasted.skipped.length === 1 ? 'itself' : 'themselves'}.` });
    if (pasted.ids.length) setSelection(pasted.ids);
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

  /**
   * Keyboard trimming. An edit point is selected by clicking a clip's edge (without dragging) or
   * with Shift+T; Ctrl+Left/Right then trim it by frames in the active tool's mode (Ripple tool:
   * ripple, Rolling tool: roll, Rate Stretch: stretch; otherwise a plain trim), and the playhead
   * follows the edit.
   */
  const trimMode = (): TrimMode => (tool === 'ripple' ? 'ripple' : tool === 'rolling' ? 'rolling' : tool === 'rate-stretch' ? 'stretch' : 'normal');
  const selectNearestEdit = () => {
    const current = history.current().comps.find((item) => item.id === comp?.id);
    if (!current) return;
    const at = playhead.get();
    const tracks = targetedTracks();
    let best: { clipId: string; edge: 'in' | 'out'; time: number } | null = null;
    for (const clip of current.clips) {
      if (tracks.length && !tracks.includes(clip.trackId)) continue;
      for (const [edge, time] of [['in', clip.start], ['out', clipEnd(clip)]] as const) {
        const distance = Math.abs(time - at);
        const bestDistance = best ? Math.abs(best.time - at) : Infinity;
        // At a cut (an Out and an In at the same time) the outgoing clip's Out is chosen.
        if (distance < bestDistance - 1e-9 || (Math.abs(distance - bestDistance) < 1e-9 && edge === 'out')) best = { clipId: clip.id, edge, time };
      }
    }
    if (!best) return;
    setSelectedEdit({ clipId: best.clipId, edge: best.edge });
    playhead.seek(best.time);
  };
  const trimSelectedEdit = (frames: number) => {
    if (!comp || !selectedEdit) return toast({ tone: 'info', title: 'Select an edit point first', body: 'Click a clip edge, or press Shift+T for the one nearest the playhead.', timeout: 3000 });
    const current = history.current().comps.find((item) => item.id === comp.id);
    const clip = current?.clips.find((item) => item.id === selectedEdit.clipId);
    if (!current || !clip) return setSelectedEdit(null);
    const edgeTime = selectedEdit.edge === 'in' ? clip.start : clipEnd(clip);
    const mode = trimMode();
    const next = trimEdge(current, clip.id, selectedEdit.edge, edgeTime + frames * frame, mode, limit, { alone: !linkedSelection });
    if (next === current) return;
    editComp(() => next, mode === 'ripple' ? 'Ripple Trim' : mode === 'rolling' ? 'Rolling Edit' : mode === 'stretch' ? 'Rate Stretch' : 'Trim');
    const moved = next.clips.find((item) => item.id === clip.id);
    if (moved) playhead.seek(selectedEdit.edge === 'in' ? moved.start : clipEnd(moved));
  };
  const slipOrSlide = (kind: 'slip' | 'slide', frames: number) => {
    if (!comp || !selection.length) return;
    const current = history.current().comps.find((item) => item.id === comp.id);
    if (!current) return;
    let next = current;
    for (const id of selection) next = kind === 'slip' ? slipClip(next, id, frames * frame, limit) : slideClip(next, id, frames * frame, limit);
    if (next !== current) editComp(() => next, kind === 'slip' ? 'Slip' : 'Slide');
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

  const trimAtPlayhead = (side: 'previous' | 'next', ripple: boolean) => {
    if (!comp) return;
    const at = playhead.get();
    const tracks = targetedTracks();
    editComp((current) => trimToPlayhead(current, tracks, at, side, ripple, limit, frame), ripple ? 'Ripple Trim to Playhead' : 'Extend Edit to Playhead');
    // Q takes off the head of the clip under the playhead: what was shown there now starts at its old start.
    if (side === 'previous' && ripple) {
      const starts = comp.clips.filter((clip) => tracks.includes(clip.trackId) && clip.start < at - 1e-4 && clipEnd(clip) > at + 1e-4).map((clip) => clip.start);
      if (starts.length) playhead.seek(Math.min(...starts));
    }
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

    showPanelRef.current('effect-controls');
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

  const soundSelectionMenu = (ids:string[]) => (['whoosh','impact','chime','pop','riser','boom','scratch','bleep','swish','ding','glitch'] as const).map(kind=>({
    label:kind[0].toUpperCase()+kind.slice(1)+' · local procedural',
    onSelect:()=>{if(!comp)return;try{const result=generateSelectionSound(comp,ids,kind);editComp(()=>result.comp,'Generate Sound for Selection');setSelection(result.ids);}catch(error){toast({tone:'error',title:'Could not generate sound',body:String(error)});}}
  }));

  const addSfx = (kind: import('./lib/types').SfxKind) => {
    if (!comp) return;
    const at = playhead.get();
    const source = { type: 'sfx' as const, kind };
    const duration = sourceInfo(project, assetMap, source).length;
    const free = sfxTrack(comp, at, at + duration);
    const clip = newClip({ trackId: free.track.id, start: at, duration, source, ...sfxClipFields(kind) });
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
  const startExport = useCallback(async (options: ExportOptions, folder: string, preset: string | null = null) => {
    setExportOpen(false);
    const { output: _output, compId: _compId, inToOut: _inToOut, ...last } = options;
    void _output; void _compId; void _inToOut;
    const current = settingsRef.current.export;
    // The folder is remembered for this project only (lib/exportFolder.ts).
    const folderFor = await api.storageDir('exports').catch(() => null);
    saveSettings({ export: { ...current, resolution: options.resolution, fps: options.fps, quality: options.quality, folder, folderFor, format: options.format, channel: channelForFormat(options.format) ?? 'rgb', encoder: options.encoder ?? null, last, preset } });
    // One render window for the whole export (no toast per frame): pre-render stages, then the
    // FFmpeg encode job, with a live picture of the frame being rendered.
    const project = history.current();
    // Audio-only formats render no picture: nothing to pre-render.
    const picture = findFormat(options.format).video;
    // Graphics are drawn at the export's frame rate and size, not the comp's: a 60 fps or 4K export
    // of a 30 fps 1080p comp gets 60 fps, 4K graphics instead of held or upscaled frames.
    const exported = project.comps.find((entry) => entry.id === options.compId);
    const fps = options.fps ?? undefined;
    const scale = exported ? exportScale(exported, options.resolution) : 1;
    // In→Out renders only the graphics frames inside the range (lib/exportWindow.ts).
    const range = options.inToOut && exported && exported.inPoint !== null && exported.outPoint !== null && exported.outPoint > exported.inPoint ? { start: exported.inPoint, end: exported.outPoint } : null;
    const framesOf = (target: { clip: Clip; comp: Comp }) => {
      const top = target.comp.id === options.compId;
      const window = clipFrameWindow(top ? target.clip.start : 0, target.clip.duration, exportFrameRate(fps ?? target.comp.fps), top ? range : null);
      return window ? window.last - window.first + 1 : 0;
    };
    const graphicsTargets = picture ? htmlClipsForExport(project, options.compId).filter((t) => framesOf(t) > 0) : [];
    const sceneTargets = picture ? motionClipsForExport(project, options.compId).filter((t) => framesOf(t) > 0) : [];
    const captionTargets = picture && !options.fastCaptions ? fiwnCaptionsForExport(project, options.compId).filter((t) => framesOf(t) > 0) : [];
    const stages: RenderStage[] = [...(graphicsTargets.length ? ['graphics' as const] : []), ...(sceneTargets.length ? ['scenes' as const] : []), ...(captionTargets.length ? ['captions' as const] : []), 'encoding'];
    const totalFrames = [...graphicsTargets, ...sceneTargets, ...captionTargets].reduce((sum, target) => sum + framesOf(target), 0);
    const signal = renderProgress.start(stages, totalFrames, options.output);
    const onItem = (title: string, index: number, count: number, frames: number) => renderProgress.item(title, index, count, frames);
    const onFrame = (done: number) => renderProgress.frame(done);
    const onCanvas = (canvas: HTMLCanvasElement | OffscreenCanvas) => void renderProgress.preview(canvas);
    try {
      // Motion graphics are live DOM in the preview; the export gets them as rendered frames
      // with alpha, so cards, charts and panels animate in the MP4 exactly as they do here.
      // Motion scenes (the GPU engine) render frame-exact off-screen with the preview's own code.
      const prepared = picture ? await prerenderForExport(project, options.compId, assetsRef.current, { fps, scale, signal, range, fastCaptions: options.fastCaptions, onStage: (stage) => renderProgress.stage(stage), onItem, onFrame, onCanvas }) : project;
      if (signal.aborted) throw new Error('export cancelled');
      // Captions beside the video (same name), when asked for in the Export dialog.
      if (options.captionsSidecar && exported) {
        const cues = captionCues(exported, range);
        if (cues.length) {
          const sidecar = options.output.replace(/\.[^.\\/]+$/, '') + `.${options.captionsSidecar}`;
          await api.fsWriteFile(sidecar, options.captionsSidecar === 'srt' ? toSrt(cues) : toVtt(cues), true).catch((error) => toast({ tone: 'error', title: 'Could not save the captions file', body: errorText(error) }));
        }
      }
      const jobId = await api.exportStart(prepared, options);
      renderProgress.encoding(jobId);
    } catch (error) {
      const text = errorText(error);
      if (signal.aborted || /cancel/i.test(text)) renderProgress.finish('cancelled');
      else renderProgress.finish('error', { error: `Export could not start: ${text}` });
    }
  }, [history, saveSettings, toast]);

  const exportFrame = async () => {
    if (!comp) return;
    const at = playhead.get();
    const base = await pictureDir().catch(() => '');
    const path = await saveDialog({ title: 'Export frame', defaultPath: `${base ? `${base}\\` : ''}${safeFileName(comp.name)} ${timecode(at, fps).replace(/:/g, '-')}.png`, filters: [{ name: 'PNG image', extensions: ['png'] }] });
    if (!path) return;
    try {
      // The frame's motion scenes and graphics are rendered first, or the PNG would leave them out.
      const prepared = await prerenderStill(history.current(), comp.id, at, assetsRef.current);
      const written = await api.exportFrame(prepared, comp.id, at, path.toLowerCase().endsWith('.png') ? path : `${path}.png`);
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
    // Onto a timeline with nothing on it: the comp is made (or fitted) to the source, as with files.
    if (payload.kind === 'source' && (!comp || !comp.clips.length) && overTimeline(event.clientX, event.clientY)) {
      if (!comp && payload.source.type === 'comp') return openComp(payload.source.compId);
      if (comp && payload.source.type === 'comp' && wouldCycle(project, comp.id, payload.source.compId)) return;
      const made = dropIntoEmpty(project, assetMap, comp ?? null, [{ source: payload.source, label: payload.label }], nestComps);
      if (!made) return;
      history.commit(() => made.project, comp ? 'Drop' : 'New Comp from Clip');
      landDrop({ compId: made.compId, clips: made.clips });
      return;
    }
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
      toast({ tone: 'error', title: 'That would put a comp inside itself' });
      return;
    }
    const result = dropClips(project, assetMap, comp, { kind: 'source', source: payload.source, label: payload.label, in: payload.in, duration: payload.duration, x: event.clientX, y: event.clientY, ctrl: event.ctrlKey }, target, nestComps);
    if (!result.clips.length) return;
    editComp(() => placeClips(result.comp, result.clips, event.ctrlKey ? 'insert' : 'overwrite'), 'Drop');
    setSelection(result.clips.map((clip) => clip.id));
  };

  // ── files dropped from Explorer ────────────────────────────────────────
  /** The area under the pointer while files are dragged in, and what a drop there does. */
  const hoverAt = (x: number, y: number, what: string): FileHover => {
    const under = document.elementFromPoint(x, y);
    const box = (node: Element | null | undefined) => {
      const rect = node?.getBoundingClientRect();
      return rect && rect.width > 0 ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null;
    };
    const chat = under?.closest('.chat');
    if (chat) return { zone: 'chat', rect: box(chat), what, title: 'Attach to your message', detail: 'Pictures go to the AI; videos and audio are added to the project and shared as frames.', key: 'chat' };
    const sketch = under?.closest('.sketch-editor');
    if (sketch) return { zone: 'sketch', rect: box(sketch), what, title: 'Add to the sketch', detail: 'Dropped pictures go on the storyboard card.', key: 'sketch' };
    if (overTimeline(x, y)) {
      const target = timelineApi.current?.dropTarget(x, y);
      const timeline = [...document.querySelectorAll('.timeline')].find((node) => { const r = node.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; });
      if (!comp) return { zone: 'timeline', rect: box(timeline), what, title: 'Start a comp with these', detail: 'A new comp at the first video’s size, the clips end to end from 00:00.', key: 'timeline-new' };
      if (!comp.clips.length) return { zone: 'timeline', rect: box(timeline), what, title: 'Place on the timeline', detail: `“${comp.name}” takes the first video's size; clips go end to end from 00:00.`, key: 'timeline-empty' };
      const at = target ? timecode(target.time, comp.fps) : null;
      const track = target?.trackId ? trackLabel(comp, target.trackId) : target ? `a new ${target.kind} track` : null;
      return { zone: 'timeline', rect: box(timeline), what, title: 'Place on the timeline', detail: at ? `At ${at}${track ? ` on ${track}` : ''}, one after another.` : 'Where you let go.', key: `timeline-${at}-${track}` };
    }
    const bin = under?.closest('.bin');
    if (bin) {
      const folder = binFolder ? project.folders.find((item) => item.id === binFolder)?.name : null;
      return { zone: 'bin', rect: box(bin), what, title: 'Import into the Project panel', detail: folder ? `Into the “${folder}” folder. Nothing goes on the timeline.` : 'Into the project. Nothing goes on the timeline.', key: `bin-${binFolder}` };
    }
    return { zone: 'project', rect: null, what, title: what === 'a Bhippi project' ? 'Open this project' : 'Import into the project', detail: 'Drop on the timeline to place it, on the chat to show it to the AI.', key: 'project' };
  };
  const hoverAtRef = useRef(hoverAt);
  hoverAtRef.current = hoverAt;

  useEffect(() => {
    const pending = getCurrentWebview().onDragDropEvent((event) => {
      const payload = event.payload;
      if (payload.type === 'enter' || payload.type === 'over') {
        if (payload.type === 'enter') draggedFiles.current = describeFiles(payload.paths);
        const ratio = window.devicePixelRatio || 1;
        const next = hoverAtRef.current(payload.position.x / ratio, payload.position.y / ratio, draggedFiles.current);
        // `over` fires on every mouse move: only a new place or time re-renders.
        setFileHover((current) => (current?.key === next.key ? current : next));
      } else if (payload.type === 'leave') setFileHover(null);
      else if (payload.type === 'drop') {
        setFileHover(null);
        if (licenseStore.get().blocked) return;
        const ratio = window.devicePixelRatio || 1;
        const point = { x: payload.position.x / ratio, y: payload.position.y / ratio };
        if (document.elementFromPoint(point.x, point.y)?.closest('.chat, .sketch-editor')) return;
        const bhippiFile = payload.paths.find((path) => path.toLowerCase().endsWith('.bhippi'));
        if (bhippiFile) void openProjectFile(bhippiFile);
        else void importFiles(payload.paths, point);
      }
    });
    return () => void pending.then((unlisten) => unlisten());
  }, [importFiles]);

  // ── context menus ──────────────────────────────────────────────────────
  /** Opens a context menu; `plugin` adds the entries running plugins offer there (bhippi.menu). */
  const showMenu = (event: { clientX: number; clientY: number }, items: MenuItem[], plugin?: { where: PluginMenuPlace; context: Record<string, unknown> }) => {
    const offered = plugin ? pluginMenuItems(plugin.where, plugin.context) : [];
    const extra: MenuItem[] = offered.length ? [{ separator: true }, { label: 'Plugins', submenu: offered.map((item) => ({ label: item.label, onSelect: item.run })) }] : [];
    setMenu({ anchor: new DOMRect(event.clientX, event.clientY, 0, 0), items: [...items, ...extra] });
  };

  /** Paste Attributes… onto these clips from the first copied clip (the clip menu and Ctrl+Alt+V). */
  const pasteAttributesDialog = (ids: string[]) => setDialog(
    <AttributesDialog title="Paste Attributes" action="Paste" onClose={() => setDialog(null)} onSubmit={(set) => {
      setDialog(null);
      const from = clipboard.current?.clips[0]?.clip;
      if (from) editComp((current) => pasteAttributes(current, ids, from, set, limit), 'Paste Attributes');
    }} />,
  );

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
      { label: `Ask Bhippi AI about ${clips.length === 1 ? 'this clip' : `these ${clips.length} clips`}…`, onSelect: () => askAboutClips(clips) },
      { separator: true },
      { label: 'Cut', shortcut: 'Ctrl+X', onSelect: () => copySelection(true) },
      { label: 'Copy', shortcut: 'Ctrl+C', onSelect: () => copySelection(false) },
      { label: 'Paste Attributes…', shortcut: 'Ctrl+Alt+V', disabled: !clipboard.current?.clips.length, onSelect: () => pasteAttributesDialog(ids) },
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
      { label: 'Make Comp…', onSelect: () => setDialog(<RenameDialog title="Make Comp" name="New Comp" onClose={() => setDialog(null)} onSubmit={(name) => { setDialog(null); nest(ids, name, true); }} />) },
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
      { label: 'Link Media…', disabled: clip.source.type !== 'media', onSelect: () => void relink(clip) },
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
    ], { where: 'clip', context: { clipIds: ids, compId: comp.id, time: at } });
    void at;
  };

  const nest = (ids: string[], name: string, replace: boolean) => {
    if (!comp) return;
    const result = nestClips(history.current(), comp.id, ids, name, replace);
    if (!result) return;
    history.commit(() => result.project, replace ? 'Make Comp' : 'Make Subcomp');
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
    if (clip.source.type === 'media') await relinkAsset(clip.source.assetId);
  };

  /** Points an offline (or any) media entry at a file the user picks; every clip of it follows. */
  const relinkAsset = async (assetId: string) => {
    const asset = assetMap.get(assetId);
    const picked = await openDialog({ title: `Link media for ${asset?.name ?? 'offline media'}`, multiple: false, filters: [{ name: 'Media', extensions: info?.extensions ?? ['mp4'] }] });
    if (typeof picked !== 'string') return;
    try {
      await api.libraryRelink(assetId, picked);
      await refreshAssets();
      history.commit((current) => ({ ...current, media: current.media.map((ref) => (ref.assetId === assetId ? { ...ref, offline: false } : ref)) }), 'Link Media');
      toast({ tone: 'success', title: 'Media relinked', body: picked.split(/[\\/]/).pop() });
    } catch (error) {
      toast({ tone: 'error', title: 'Could not link that file', body: errorText(error) });
    }
  };

  /** Renders one clip (with its effects) to a new file and points the clip at it. */
  const renderAndReplace = async (clip: Clip) => {
    if (!comp) return;
    const folder = exportFolderFor(settingsRef.current.export, await api.storageDir('exports').catch(() => null)) ?? '';
    const name = `${safeFileName(comp.name)}-${clip.id.slice(0, 6)}.mp4`;
    const path = await saveDialog({ title: 'Render and Replace', defaultPath: folder ? `${folder}\\${name}` : name, filters: [{ name: 'MP4 video', extensions: ['mp4'] }] });
    if (!path) return;
    const single = { ...newComp({ name: `${comp.name} render`, width: comp.width, height: comp.height, fps: comp.fps }) };
    const rendered = placeClips(single, [{ ...clip, id: uid(), start: 0, trackId: tracksOf(single, tracksOf(comp, 'video').some((track) => track.id === clip.trackId) ? 'video' : 'audio')[0].id, linkId: null }], 'overwrite');
    const staging: Project = { ...history.current(), comps: [...history.current().comps, rendered] };
    try {
      await api.exportStart(staging, { output: path, compId: rendered.id, resolution: null, fps: null, quality: 'high', inToOut: false, format: 'mp4' });
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
      ...(track.kind === 'audio' ? [{ label: 'Track Volume & Pan…', onSelect: () => setDialog(<TrackMixDialog name={track.name || trackLabel(comp, trackId)} gain={track.gain ?? 0} pan={track.pan ?? 0} onClose={() => setDialog(null)} onPreview={(mix) => history.preview((current) => updateComp(current, comp.id, (target) => updateTrack(target, trackId, mix)))} onSubmit={() => { setDialog(null); history.settle('Track Volume & Pan'); }} onCancel={() => { history.cancel(); setDialog(null); }} />) } as MenuItem] : []),
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

  const emptyMenu = (event: React.MouseEvent, trackId: string | null, at: number, transitionId?: string) => {
    if (!comp) return;
    showMenu(event, [
      ...(transitionId ? [{ label: 'Clear', shortcut: 'Delete', onSelect: () => deleteTransition(transitionId) }, { separator: true } as MenuItem] : []),
      { label: 'Paste', shortcut: 'Ctrl+V', disabled: !clipboard.current, onSelect: () => paste(false) },
      { label: 'Paste Insert', shortcut: 'Ctrl+Shift+V', disabled: !clipboard.current, onSelect: () => paste(true) },
      { separator: true },
      { label: 'Ripple Delete', disabled: !trackId || !gapAt(comp, trackId, at), onSelect: () => trackId && editComp((current) => closeGap(current, trackId, at), 'Ripple Delete') },
      { label: 'Add Marker', shortcut: 'M', onSelect: addMarker },
      { separator: true },
      { label: 'Zoom to Sequence', shortcut: '\\', onSelect: () => timelineApi.current?.fit() },
      { label: 'Comp Settings…', onSelect: () => compSettings() },
    ], { where: 'timeline', context: { compId: comp.id, trackId, time: at } });
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
          // A new shape re-fits the footage and rebuilds the motion graphics (lib/reformat.ts).
          const apply = (current: Project): { project: Project; reformatted: string } => {
            let next = { ...current, name: result.name, captionStyle: result.captionStyle };
            let reformatted = '';
            if (!result.activeCompId) return { project: next, reformatted };
            const target = next.comps.find((entry) => entry.id === result.activeCompId);
            if (target && (target.width !== result.width || target.height !== result.height) && target.clips.length) {
              const reshaped = reformatComp(next, target.id, { width: result.width, height: result.height }, result.reframe ?? 'fill');
              next = reshaped.project;
              reformatted = describeReformat(reshaped.report, result.reframe ?? 'fill');
            }
            return { project: updateComp(next, result.activeCompId, (entry) => ({ ...entry, width: result.width, height: result.height, fps: result.fps, sizeChosen: true })), reformatted };
          };
          const { reformatted } = apply(history.current());
          history.commit((current) => apply(current).project, reformatted ? `Reformat to ${aspectLabel(result.width, result.height)}` : 'Project Settings');
          if (reformatted) toast({ tone: 'success', title: `Comp is now ${result.width}×${result.height} (${aspectLabel(result.width, result.height)})`, body: reformatted });
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
          created.sizeChosen = true;
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
      history.commit((current) => deleteBinEntries(current, ids), 'Delete');
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
    const folderEntry = project.folders.find((item) => ids.includes(item.id));
    // Media entries of the selection, found or not: an offline one may have no library record left.
    const mediaIds = project.media.filter((ref) => ids.includes(ref.assetId)).map((ref) => ref.assetId);
    const offlineIds = mediaIds.filter((id) => offline.has(id) || !assetMap.get(id) || assetMap.get(id)?.missing);
    const videoIds = mediaIds.filter((id) => assetMap.get(id)?.kind === 'video' && !assetMap.get(id)?.missing);
    showMenu(event, [
      // Offline media leads with the fix.
      ...(offlineIds.length ? [{ label: offlineIds.length > 1 ? `Link Media… (${offlineIds.length} offline, one at a time)` : 'Link Media…', onSelect: () => void (async () => { for (const id of offlineIds) await relinkAsset(id); })() } as MenuItem, { separator: true } as MenuItem] : []),
      ...(compEntry ? [{ label: 'Open in Timeline', onSelect: () => openComp(compEntry.id) } as MenuItem, { label: 'Comp Settings…', onSelect: () => { openComp(compEntry.id); compSettings(); } } as MenuItem] : []),
      ...(assetEntry ? [{ label: 'Open in Source Monitor', onSelect: () => openInSource(assetEntry.id) } as MenuItem] : []),
      // A lighter copy for smooth previews (4K, long-GOP): the monitor's PROXY toggle switches to it.
      ...(videoIds.length ? [{ label: videoIds.length > 1 ? `Create Proxies (${videoIds.length})` : assetMap.get(videoIds[0])?.proxy && assetMap.get(videoIds[0])?.preview === 'native' ? 'Re-create Proxy' : 'Create Proxy', onSelect: () => { for (const id of videoIds) void api.libraryMakeProxy(id).catch((error) => toast({ tone: 'error', title: 'Could not make a proxy', body: errorText(error) })); toast({ tone: 'info', title: `Making ${videoIds.length === 1 ? 'a proxy' : `${videoIds.length} proxies`}`, body: 'Previews switch to it when it is ready (the PROXY toggle on the Program monitor).', timeout: 4000 }); } } as MenuItem] : []),
      // One comp, item or folder at a time: media names come from the file (a media entry has no
      // name of its own to change), and one name typed for many entries would give them all it.
      { label: 'Rename…', disabled: ids.length !== 1 || !(compEntry || itemEntry || folderEntry), onSelect: () => setDialog(
        <RenameDialog title="Rename" name={compEntry?.name ?? itemEntry?.name ?? folderEntry?.name ?? ''} onClose={() => setDialog(null)} onSubmit={(name) => {
          setDialog(null);
          history.commit((current) => ({
            ...current,
            comps: current.comps.map((item) => (ids.includes(item.id) ? { ...item, name } : item)),
            items: current.items.map((item) => (ids.includes(item.id) ? { ...item, name } : item)),
            folders: current.folders.map((item) => (ids.includes(item.id) ? { ...item, name } : item)),
          }), 'Rename');
        }} />) },
      { label: 'Duplicate', disabled: !compEntry && !itemEntry, onSelect: () => history.commit((current) => {
        // A comp is copied whole (lib/reformat.ts): fresh track, clip, link, group and transition
        // ids, its own copies of the layered motion comps it holds.
        const copied = compEntry ? copyComp(current, compEntry.id, `${compEntry.name} copy`)?.project ?? current : current;
        return { ...copied, items: itemEntry ? [...copied.items, { ...itemEntry, id: uid(), name: `${itemEntry.name} copy` }] : copied.items };
      }, 'Duplicate') },
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
        ...(!offlineIds.includes(assetEntry.id) ? [{ label: 'Link Media…', onSelect: () => void relinkAsset(assetEntry.id) } as MenuItem] : []),
        { label: 'Make Offline…', onSelect: () => history.commit((current) => ({ ...current, media: current.media.map((ref) => (ids.includes(ref.assetId) ? { ...ref, offline: true } : ref)) }), 'Make Offline') } as MenuItem,
      ] : []),
      { label: 'Delete', shortcut: 'Delete', onSelect: () => deleteBinItems(ids) },
    ], { where: 'media', context: { ids } });
  };

  const binPanelMenu = (event: React.MouseEvent) => showMenu(event, [
    { label: 'Paste', disabled: true },
    { separator: true },
    { label: 'New Comp…', shortcut: 'Ctrl+N', onSelect: newCompDialog },
    { label: 'New Folder', shortcut: 'Ctrl+/', onSelect: newFolder },
    { label: 'New Item', submenu: newItemMenu },
    ...(offline.size || project.media.some((ref) => !assetMap.get(ref.assetId) || assetMap.get(ref.assetId)?.missing) ? [{ label: 'Link Offline Media…', onSelect: () => void (async () => { for (const ref of project.media) if (offline.has(ref.assetId) || !assetMap.get(ref.assetId) || assetMap.get(ref.assetId)?.missing) await relinkAsset(ref.assetId); })() } as MenuItem] : []),
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
      { label: 'New File', onSelect: newProjectNow },
      { label: 'New Comp…', shortcut: 'Ctrl+N', onSelect: newCompDialog },
      { label: 'New Item', submenu: newItemMenu.slice(2) },
      { separator: true },
      { label: 'Open Project…', shortcut: 'Ctrl+O', onSelect: () => void openProject() },
      { label: 'Open Recent', disabled: !usableRecents.length, submenu: usableRecents.map((path) => ({ label: path.split(/[\\/]/).pop() ?? path, onSelect: () => openRecent(path) })) },
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
        { label: 'Captions (.srt)…', disabled: !hasCaptions, onSelect: () => void exportCaptions('srt') },
        { label: 'Captions (.vtt)…', disabled: !hasCaptions, onSelect: () => void exportCaptions('vtt') },
      ] },
      { separator: true },
      { label: 'Restore from Backup…', onSelect: () => setDialog(<RestoreBackupDialog projectName={history.current().name} onClose={() => setDialog(null)} onRestore={(path) => { setDialog(null); void restoreBackup(path); }} />) },
      { label: 'Project Settings…', onSelect: projectSettings },
      { label: 'Enable Graphic Scripts', disabled: !hasHeldScripts, onSelect: enableScripts },
      { label: 'Open Project Folder', onSelect: () => void api.storageOpen(null).catch((error) => toast({ tone: 'error', title: 'Could not open the project folder', body: errorText(error) })) },
      { label: 'Reveal Bhippi Data Folder', onSelect: () => info && void api.openPath(info.dataDir) },
      { separator: true },
      { label: 'Exit', shortcut: 'Ctrl+Q', onSelect: () => void getCurrentWindow().close() },
    ] },
    { label: 'Edit', items: [
      { label: `Undo${history.undoLabel && history.canUndo ? ` ${history.undoLabel}` : ''}`, shortcut: 'Ctrl+Z', disabled: !history.canUndo, onSelect: history.undo },
      { label: `Redo${history.redoLabel ? ` ${history.redoLabel}` : ''}`, shortcut: 'Ctrl+Shift+Z', disabled: !history.canRedo, onSelect: history.redo },
      { label: 'History…', disabled: !history.canUndo && !history.canRedo, onSelect: () => setHistoryOpen(true) },
      { separator: true },
      { label: 'Cut', shortcut: 'Ctrl+X', disabled: !selection.length, onSelect: () => copySelection(true) },
      { label: 'Copy', shortcut: 'Ctrl+C', disabled: !selection.length, onSelect: () => copySelection(false) },
      { label: 'Paste', shortcut: 'Ctrl+V', disabled: !clipboard.current, onSelect: () => paste(false) },
      { label: 'Paste Insert', shortcut: 'Ctrl+Shift+V', disabled: !clipboard.current, onSelect: () => paste(true) },
      { label: 'Clear', shortcut: 'Delete', disabled: !selection.length && !transitionSelection, onSelect: () => deleteSelection(false) },
      { label: 'Ripple Delete', shortcut: 'Shift+Delete', disabled: !selection.length && !transitionSelection, onSelect: () => deleteSelection(true) },
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
      { label: 'Settings…', shortcut: 'Ctrl+,', onSelect: () => setSettingsTab('general') },
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
      { label: 'Make Comp…', disabled: !selection.length, onSelect: () => setDialog(<RenameDialog title="Make Comp" name="New Comp" onClose={() => setDialog(null)} onSubmit={(name) => { setDialog(null); nest(selection, name, true); }} />) },
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
      { label: 'Reverse Match Frame', shortcut: 'Shift+R', disabled: !comp || !sourceAsset, onSelect: reverseMatchFrame },
      { label: 'Fit to Fill (Overwrite)', disabled: !sourceAsset || comp?.inPoint == null || comp?.outPoint == null, onSelect: () => { if (sourceAsset) sourceEdit(sourceAsset, sourceRanges[sourceAsset.id] ?? { in: 0, out: sourceAsset.kind === 'image' ? STILL_DEFAULT : sourceAsset.duration }, 'overwrite', true); } },
    ] },
    { label: 'Comp', items: [
      { label: 'Create Stick Figure…', disabled: !comp, onSelect:()=>setDialog(<StickFigureDialog onClose={()=>setDialog(null)} onCreate={(motion,duration,color,thickness)=>{if(!comp)return;const figure=makeStickFigure(comp.width,comp.height,comp.fps,motion,duration,color,thickness);history.commit(current=>({...current,comps:[...current.comps,figure],activeCompId:figure.id,openCompIds:[...current.openCompIds,figure.id]}),'Create Stick Figure');setDialog(null);setSelection([]);}}/>) },
      { label: 'Comp Settings…', disabled: !comp, onSelect: compSettings },
      { separator: true },
      { label: 'Remove Silences', disabled: !hasClips, onSelect: () => void removeSilences() },
      { label: 'Remove Filler Words', disabled: !hasClips, onSelect: () => void removeFillers() },
      { label: 'Make Vertical Copy (9:16)', disabled: !hasClips || !comp || comp.height > comp.width, onSelect: makeVerticalCopy },
      { separator: true },
      { label: 'Add Edit', shortcut: 'Ctrl+K', disabled: !hasClips, onSelect: () => addEdit(false) },
      { label: 'Add Edit to All Tracks', shortcut: 'Ctrl+Shift+K', disabled: !hasClips, onSelect: () => addEdit(true) },
      { label: 'Trim Edit', submenu: [
        { label: 'Ripple Trim Previous Edit to Playhead', shortcut: 'Q', onSelect: () => trimAtPlayhead('previous', true) },
        { label: 'Ripple Trim Next Edit to Playhead', shortcut: 'W', onSelect: () => trimAtPlayhead('next', true) },
        { label: 'Extend Previous Edit to Playhead', shortcut: 'Shift+Q', onSelect: () => trimAtPlayhead('previous', false) },
        { label: 'Extend Next Edit to Playhead', shortcut: 'Shift+W', onSelect: () => trimAtPlayhead('next', false) },
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
    { label: 'Plugins', items: [
      { label: 'Characters…', onSelect: () => openCharacters() },
      { separator: true },
      { label: 'Custom Plugin…', onSelect: () => { setMakerPlugin(null); setMakerOpen(true); } },
      { label: 'Plugin Maker', onSelect: () => setMakerOpen(true) },
      { label: 'Plugin Marketplace…', onSelect: () => setMarketOpen(true) },
      { label: 'Show Plugins Panel', checked: showPlugins, onSelect: () => setPanelVisible('plugins', !showPlugins) },
      ...(plugins.length ? [{ separator: true } as MenuItem] : []),
      ...plugins.map((item) => ({
        label: `${pluginGlyph(item)} ${item.name}`,
        submenu: [
          { label: 'Show as Panel', checked: item.enabled && item.panel, onSelect: () => { void patchPlugin(item.id, { panel: !(item.enabled && item.panel), enabled: true }); if (!(item.enabled && item.panel)) { setPanelVisible('plugins', true); setPluginTab(item.id); } } },
          { label: 'Run in Background', checked: item.background, onSelect: () => void patchPlugin(item.id, { background: !item.background }) },
          { label: 'Enabled', checked: item.enabled, onSelect: () => void patchPlugin(item.id, { enabled: !item.enabled }) },
          { separator: true } as MenuItem,
          { label: 'Edit in Plugin Maker…', onSelect: () => { setMakerPlugin(item.id); setMakerOpen(true); } },
        ] as MenuItem[],
      })),
    ] },
    { label: 'Window', items: [
      ...([['project', 'Project', 'Shift+1'], ['source', 'Source Monitor', 'Shift+2'], ['timeline', 'Timeline', 'Shift+3'], ['program', 'Program Monitor', 'Shift+4'], ['properties', 'Properties', 'Shift+5'], ['meters', 'Audio Meters', 'Shift+6'], ['tools', 'Tools', 'Shift+7'], ['storyboard', 'Storyboard', 'Shift+8'], ['transcript', 'Transcription', 'Shift+9'], ['effects', 'Effects', ''], ['effect-controls', 'Effect Controls', ''], ['subtitles', 'Subtitles', ''], ['graphics', 'Graphics', ''], ['audio', 'Audio', ''], ['chat', 'Bhippi AI', 'Ctrl+Alt+L']] as [PanelId, string, string][]).map(([id, label, shortcut]) => ({
        label, shortcut, checked: !hidden(id), onSelect: () => setPanelVisible(id, hidden(id)),
      })),
      { label: 'Plugins', checked: showPlugins, onSelect: () => setPanelVisible('plugins', !showPlugins) },
      { separator: true },
      { label: maximized ? 'Restore Panel Size' : 'Maximize Panel Under Cursor', shortcut: '`', onSelect: () => toggleMax(maximized ?? focused) },
      { label: 'Workspaces', submenu: [
        ...workspaces.map((item): MenuItem => ({ label: item.name, checked: settings.workspaceName === item.name, onSelect: () => applyWorkspace(item.name) })),
        ...(workspaces.length ? [{ separator: true } as MenuItem] : []),
        { label: 'Save Workspace As…', onSelect: saveWorkspaceAs },
        ...(settings.workspaceName && workspaces.some((item) => item.name === settings.workspaceName) ? [
          { label: `Update “${settings.workspaceName}”`, onSelect: () => saveSettings({ workspaces: workspaces.map((item) => (item.name === settings.workspaceName ? { ...item, layout: { ...layout } } : item)) }) } as MenuItem,
          { label: `Reset to “${settings.workspaceName}”`, onSelect: () => applyWorkspace(settings.workspaceName!) } as MenuItem,
        ] : []),
        ...(workspaces.length ? [{ label: 'Delete Workspace', submenu: workspaces.map((item): MenuItem => ({ label: item.name, onSelect: () => deleteWorkspace(item.name) })) } as MenuItem] : []),
      ] },
      { label: 'Reset to Default Workspace', onSelect: () => { setLayout((current) => ({ ...freshLayout(), chatWidth: current.chatWidth, meters: current.meters })); setMaximized(null); saveSettings({ workspaceName: null }); } },
    ] },
    { label: 'Help', items: [
      { label: 'Keyboard Shortcuts', shortcut: 'Ctrl+Alt+K', onSelect: () => setShortcutsOpen(true) },
      { label: 'AI Providers…', onSelect: () => setSettingsTab('providers') },
      { label: 'Generation Connectors…', onSelect: () => setSettingsTab('connectors') },
      { label: 'Speech & Voice…', onSelect: () => setSettingsTab('speech') },
      { label: 'FFmpeg & Media…', onSelect: () => setSettingsTab('media') },
      { label: 'About Bhippi Video Editor', onSelect: () => setSettingsTab('about') },
    ] },
  ];

  function matchFrame() {
    if (!comp) return;
    const at = playhead.get();
    const clip = comp.clips.find((item) => item.start <= at && clipEnd(item) > at && item.source.type === 'media' && targetedTracks().includes(item.trackId))
      ?? comp.clips.find((item) => item.start <= at && clipEnd(item) > at && item.source.type === 'media');
    if (clip?.source.type === 'media') {
      const sourceTime = sourceTimeAt(clip, at);
      openInSource(clip.source.assetId, { in: clip.in, out: sourceOut(clip) });
      // Parked on the very frame, not the start of the clip.
      setSourcePark({ assetId: clip.source.assetId, time: sourceTime, nonce: Date.now() });
      toast({ tone: 'info', title: 'Matched frame', body: `${timecode(sourceTime, fps)} in the source`, timeout: 2000 });
    }
  }

  /** Reverse Match Frame: where the Source monitor's frame plays in this comp; playhead there, clip selected. */
  function reverseMatchFrame() {
    if (!comp || !sourceAsset) return;
    const t = sourceApi.current?.time() ?? 0;
    const at = playhead.get();
    const hits = whereSourcePlays(comp, sourceAsset.id, t, at);
    if (!hits.length) return toast({ tone: 'info', title: 'Not in this comp', body: `${timecode(t, sourceAsset.fps ?? fps)} of ${sourceAsset.name} is not used in ${comp.name}.`, timeout: 3000 });
    playhead.seek(hits[0].time);
    timelineApi.current?.reveal(hits[0].time);
    setSelection([hits[0].clip.id]);
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
  // The keys each command runs on: the defaults with the user's changes (Keyboard Shortcuts).
  const keymap = useMemo(() => keymapFrom(settings.shortcuts), [settings.shortcuts]);
  keyHandler.current = (event: KeyboardEvent) => {
    const run = (action: () => void) => {
      event.preventDefault();
      action();
    };
    // Nothing reaches the editor while the license gate covers it.
    if (licenseStore.get().blocked) return;
    if (isTyping(event.target) || settingsTab || exportOpen || shortcutsOpen || dialog || menu) {
      if (event.key === 'Escape' && menu) setMenu(null);
      return;
    }
    const id = commandFor(keymap, event);
    if (!id) return;
    // Only file and app commands work on the home screen.
    if (mode === 'home' && !findCommand(id)?.app) return;
    if (id === 'copy' || id === 'cut') {
      // Selected prose (chat, settings, anywhere else text is selectable) wants a plain clipboard
      // copy, not the timeline's clip-copy — this used to preventDefault and hijack Ctrl+C/X even
      // when nothing in the timeline was selected, so copying chat text silently did nothing.
      const selectedText = window.getSelection();
      if (selectedText && !selectedText.isCollapsed && selectedText.toString().length > 0) return;
    }
    const duplicate = () => {
      if (!comp || !selection.length) return;
      const span = Math.max(...selectedClips.map(clipEnd)) - Math.min(...selectedClips.map((clip) => clip.start));
      const result = moveClips(comp, linkedSelection ? withLinked(comp, selection) : selection, span, { video: 0, audio: 0 }, 'overwrite', true);
      if (result) {
        editComp(() => result.comp, 'Duplicate');
        setSelection(result.ids);
      }
    };
    const panels: PanelId[] = ['project', 'source', 'timeline', 'program', 'properties', 'meters', 'tools', 'storyboard', 'transcript'];
    const sourceFocused = focused === 'source' && !!sourceAsset;
    const step = (frames: number) => (sourceFocused ? sourceApi.current?.step(frames) : programApi.current?.step(frames));
    const sourceRange = () => sourceAsset && (sourceRanges[sourceAsset.id] ?? { in: 0, out: sourceAsset.kind === 'image' ? STILL_DEFAULT : sourceAsset.duration });
    const seekMarker = (direction: 1 | -1) => { const target = nextPoint(comp?.markers.map((marker) => marker.time) ?? [], playhead.get(), direction); if (target !== null) playhead.seek(target); };
    const maximizeUnderCursor = () => {
      if (maximized) {
        setMaximized(null);
        return;
      }
      let target: PanelId | null = null;
      if (typeof document !== 'undefined') {
        const { x, y } = getLiveMousePos();
        for (const el of document.elementsFromPoint(x, y)) {
          const id = el.closest('[data-panel]')?.getAttribute('data-panel') as PanelId | null;
          if (id && ['chat', 'source', 'program', 'properties', 'project', 'timeline'].includes(id)) {
            target = id;
            break;
          }
        }
      }
      const panelToToggle = target ?? focused;
      setFocused(panelToToggle);
      toggleMax(panelToToggle);
    };
    const perform = (name: string): (() => void) | null => {
      switch (name) {
        // File and app-wide
        case 'newProject': return newProjectNow;
        case 'newComp': return newCompDialog;
        case 'open': return () => void openProject();
        case 'saveCopy': return () => void saveAs(false);
        case 'saveAs': return () => void saveAs();
        case 'save': return () => void saveProject();
        case 'import': return () => void pickFiles();
        case 'exportFrame': return () => void exportFrame();
        case 'export': return () => hasClips && setExportOpen(true);
        case 'quit': return () => void getCurrentWindow().close();
        case 'newFolder': return newFolder;
        case 'shortcuts': return () => setShortcutsOpen(true);
        case 'toggleChat': return () => setPanelVisible('chat', hidden('chat'));
        case 'settings': return () => setSettingsTab('general');
        case 'find': return () => { showPanel('project', 'project'); (document.querySelector('[data-role="bin-search"]') as HTMLInputElement | null)?.focus(); };
        case 'fxConsole': return () => {
          setFxConsoleAnchor(getLiveMousePos());
          setFxConsoleOpen((curr) => !curr);
        };
        // Edit
        case 'undo': return history.undo;
        case 'redo': return history.redo;
        case 'pasteAttributes': return () => { if (selectedClips.length && clipboard.current?.clips.length) pasteAttributesDialog(selectedClips.map((clip) => clip.id)); };
        case 'pasteInsert': return () => paste(true);
        case 'paste': return () => paste(false);
        case 'copy': return () => copySelection(false);
        case 'cut': return () => copySelection(true);
        case 'clear': return () => deleteSelection(false);
        case 'rippleDelete': return () => deleteSelection(true);
        case 'deselectAll': return () => { setSelection([]); setTransitionSelection(null); };
        case 'selectAll': return () => comp && setSelection(comp.clips.map((clip) => clip.id));
        case 'editOriginal': return () => {
          const clip = selectedClips[0];
          if (clip?.source.type === 'media') void api.openPath(assetMap.get(clip.source.assetId)?.path ?? '');
        };
        case 'duplicate': return duplicate;
        // Tools
        case 'toolSelect': return () => setTool('select');
        case 'toolTrackForward': return () => setTool('track-forward');
        case 'toolTrackBackward': return () => setTool('track-backward');
        case 'toolRipple': return () => setTool('ripple');
        case 'toolRolling': return () => setTool('rolling');
        case 'toolRateStretch': return () => setTool('rate-stretch');
        case 'toolRazor': return () => setTool('razor');
        case 'toolSlip': return () => setTool('slip');
        case 'toolSlide': return () => setTool('slide');
        case 'toolPen': return () => setTool('pen');
        case 'toolHand': return () => setTool('hand');
        case 'toolZoom': return () => setTool('zoom');
        case 'toolType': return () => setTool('type');
        case 'rectangle': return () => setTool('rectangle');
        case 'ellipse': return () => setTool('ellipse');
        case 'newTitle': return () => addText('title');
        // Playback
        case 'playToggle': return () => (sourceFocused ? sourceApi.current?.toggle() : programApi.current?.toggle());
        // J / K / L drive the focused monitor. With K held, J and L step one frame each (and keep
        // stepping while held, through key repeat): Premiere's slow jog.
        case 'shuttleBack': return () => (kHeld.current ? step(-1) : sourceFocused ? sourceApi.current?.shuttle(-1) : programApi.current?.shuttle(-1));
        case 'shuttleStop': return () => (sourceFocused ? sourceApi.current?.shuttle(0) : programApi.current?.shuttle(0));
        case 'shuttleForward': return () => (kHeld.current ? step(1) : sourceFocused ? sourceApi.current?.shuttle(1) : programApi.current?.shuttle(1));
        case 'playAround': return () => programApi.current?.playAround();
        case 'playInToOut': return () => programApi.current?.playInToOut();
        case 'stepBack': return () => step(-1);
        case 'stepForward': return () => step(1);
        case 'stepBack5': return () => step(-5);
        case 'stepForward5': return () => step(5);
        case 'previousEdit': return () => goToPoint(-1, false);
        case 'nextEdit': return () => goToPoint(1, false);
        case 'previousEditAny': return () => goToPoint(-1, true);
        case 'nextEditAny': return () => goToPoint(1, true);
        case 'goStart': return () => playhead.seek(0);
        case 'goEnd': return () => comp && playhead.seek(compDuration(comp));
        case 'jumpBack': return () => playhead.seek(Math.max(0, playhead.get() - 5));
        case 'jumpForward': return () => playhead.seek(playhead.get() + 5);
        // Marking
        case 'markIn': return () => (sourceFocused ? sourceApi.current?.markIn() : markIn());
        case 'markOut': return () => (sourceFocused ? sourceApi.current?.markOut() : markOut());
        case 'markClip': return () => (sourceFocused ? sourceApi.current?.markClip() : markClip());
        case 'markSelection': return markSelection;
        case 'goIn': return () => playhead.seek(comp?.inPoint ?? 0);
        case 'goOut': return () => playhead.seek(comp?.outPoint ?? (comp ? compDuration(comp) : 0));
        case 'clearIn': return () => editComp((current) => ({ ...current, inPoint: null }), 'Clear In');
        case 'clearOut': return () => editComp((current) => ({ ...current, outPoint: null }), 'Clear Out');
        case 'clearInOut': return clearInOut;
        case 'addMarker': return addMarker;
        case 'nextMarker': return () => seekMarker(1);
        case 'previousMarker': return () => seekMarker(-1);
        case 'clearMarker': return () => editComp((current) => toggleMarker(current, playhead.get()), 'Clear Marker');
        case 'clearAllMarkers': return () => editComp((current) => ({ ...current, markers: [] }), 'Clear All Markers');
        // Editing
        case 'insert': return () => { const range = sourceRange(); if (sourceAsset && range) sourceEdit(sourceAsset, range, 'insert'); };
        case 'overwrite': return () => { const range = sourceRange(); if (sourceAsset && range) sourceEdit(sourceAsset, range, 'overwrite'); };
        case 'fitToFill': return () => { const range = sourceRange(); if (sourceAsset && range) sourceEdit(sourceAsset, range, 'overwrite', true); };
        case 'addEdit': return () => addEdit(false);
        case 'addEditAll': return () => addEdit(true);
        case 'rippleTrimPrevious': return () => trimAtPlayhead('previous', true);
        case 'rippleTrimNext': return () => trimAtPlayhead('next', true);
        case 'extendPrevious': return () => trimAtPlayhead('previous', false);
        case 'extendNext': return () => trimAtPlayhead('next', false);
        case 'lift': return () => removeRangeNow('lift');
        case 'extract': return () => removeRangeNow('extract');
        case 'applyTransition': return () => editComp((current) => transitionsOnSelection(current, selection, { video: 'cross-dissolve', audio: 'constant-power' }, 1), 'Apply Transition');
        case 'speed': return () => selectedClips[0] && speedDialog(selectedClips[0], selection);
        case 'enableToggle': return () => editComp((current) => ({ ...current, clips: current.clips.map((clip) => (selection.includes(clip.id) ? { ...clip, enabled: !selectedClips.every((item) => item.enabled) } : clip)) }), 'Enable');
        case 'link': return () => editComp((current) => setLinked(current, selection, !selectedClips.some((clip) => clip.linkId)), 'Link');
        case 'group': return () => editComp((current) => setGrouped(current, selection, true), 'Group');
        case 'ungroup': return () => editComp((current) => setGrouped(current, selection, false), 'Ungroup');
        case 'gain': return () => selectedClips.length && gainDialog(selectedClips);
        case 'matchFrame': return matchFrame;
        case 'reverseMatchFrame': return reverseMatchFrame;
        case 'selectNearestEdit': return selectNearestEdit;
        case 'trimBack': return () => trimSelectedEdit(-1);
        case 'trimForward': return () => trimSelectedEdit(1);
        case 'trimBack5': return () => trimSelectedEdit(-5);
        case 'trimForward5': return () => trimSelectedEdit(5);
        case 'slipLeft': return () => slipOrSlide('slip', -1);
        case 'slipRight': return () => slipOrSlide('slip', 1);
        case 'slideLeft': return () => slipOrSlide('slide', -1);
        case 'slideRight': return () => slipOrSlide('slide', 1);
        case 'nudgeLeft': return () => nudge(-1);
        case 'nudgeRight': return () => nudge(1);
        case 'nudgeLeft5': return () => nudge(-5);
        case 'nudgeRight5': return () => nudge(5);
        case 'nudgeUp': return () => nudge(1, true);
        case 'nudgeDown': return () => nudge(-1, true);
        case 'volumeDown': return () => clipVolume(-1);
        case 'volumeUp': return () => clipVolume(1);
        case 'volumeDown6': return () => clipVolume(-6);
        case 'volumeUp6': return () => clipVolume(6);
        // Timeline
        case 'snap': return () => setSnapping((value) => !value);
        // Zoom keys act on the focused panel, as in Premiere: the monitor under focus zooms its picture.
        case 'zoomIn': return () => (focused === 'program' ? programApi.current?.zoomStep(1) : focused === 'source' ? sourceApi.current?.zoomStep(1) : timelineApi.current?.zoomBy(1.3));
        case 'zoomOut': return () => (focused === 'program' ? programApi.current?.zoomStep(-1) : focused === 'source' ? sourceApi.current?.zoomStep(-1) : timelineApi.current?.zoomBy(1 / 1.3));
        case 'zoomFit': return () => (focused === 'program' ? programApi.current?.zoomFit() : focused === 'source' ? sourceApi.current?.zoomFit() : timelineApi.current?.toggleFit());
        case 'videoTaller': return () => trackHeights('video', 16);
        case 'videoShorter': return () => trackHeights('video', -16);
        case 'audioTaller': return () => trackHeights('audio', 16);
        case 'audioShorter': return () => trackHeights('audio', -16);
        case 'allTaller': return () => trackHeights('all', 40);
        case 'allShorter': return () => trackHeights('all', -40);
        // Panels
        case 'maximize': return maximizeUnderCursor;
        case 'escape': return () => { setSelection([]); setTransitionSelection(null); setSelectedEdit(null); setTool('select'); };
        default: {
          const panel = /^panel(\d)$/.exec(name);
          return panel ? () => showPanel(panels[Number(panel[1]) - 1]) : null;
        }
      }
    };
    const action = perform(id);
    if (action) run(action);
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
      window.removeEventListener('mousemove', trackMouse, { capture: true });
      window.removeEventListener('pointermove', trackMouse, { capture: true });
    };
  }, []);

  // ── providers ──────────────────────────────────────────────────────────
  const chatProviders = providers.filter((row) => row.usable && row.enabled);
  const providerId = useMemo(() => {
    if (settings.providerId && chatProviders.some((row) => row.id === settings.providerId)) return settings.providerId;
    return PREFERENCE.find((id) => chatProviders.some((row) => row.id === id)) ?? 'bhippi';
  }, [settings.providerId, chatProviders]);
  // A saved model the provider's live list no longer offers shows (and sends) as Auto; the
  // backend applies the same rule, so a retired id never reaches the vendor.
  const model = useMemo(() => {
    if (providerId !== settings.providerId || !settings.model) return null;
    const row = chatProviders.find((item) => item.id === providerId);
    const live = row && (row.kind === 'cloud_api' || row.kind === 'local_server') && row.health.state === 'healthy' && row.models.length > 0;
    return live && !row.models.includes(settings.model) ? null : settings.model;
  }, [providerId, settings.providerId, settings.model, chatProviders]);
  // What a crash report says the editor was doing: sizes and modes only, never names or file paths.
  useEffect(() => {
    crashReporter.setContextProvider(() => ({
      tool,
      selectedClips: selection.length,
      comps: project.comps.length,
      media: project.media.length,
      activeComp: comp ? { width: comp.width, height: comp.height, fps: comp.fps, tracks: comp.tracks.length, clips: comp.clips.length, clipKinds: [...new Set(comp.clips.map((clip) => clip.source.type))] } : null,
      aiProvider: providerId,
      aiModel: model,
      openPanels: { settings: settingsTab, export: exportOpen, terminal: terminalOpen },
    }));
  });
  useEffect(() => () => crashReporter.setContextProvider(null), []);

  // ── panels ─────────────────────────────────────────────────────────────
  const frameHost: FrameHost = {
    project: () => history.current(),
    commit: (change, label) => history.commit(change, label),
    framePath: (name) => {
      // Storyboard frames belong to the project: <project folder>/Storyboard (export_frame makes it).
      const projectDir = projectDirRef.current;
      if (projectDir) {
        const sep = projectDir.includes('\\') ? '\\' : '/';
        return `${projectDir}${sep}Storyboard${sep}${name}`;
      }
      if (!info) throw new Error('Bhippi is still starting up');
      const sep = info.dataDir.includes('\\') ? '\\' : '/';
      return `${info.dataDir}${sep}thumbnails${sep}${name}`;
    },
    kit: () => resolveActiveKit(settingsRef.current.brandKits, history.current()),
    assets: () => assetsRef.current,
  };
  frameHostRef.current = frameHost;
  const requestFrames = (kind: 'auto' | 'edit' | 'concept', indices?: number[]) => { if (comp) requestCardFrames(frameHost, comp.id, kind, indices); };
  // A picture the user made by hand for a card: a sketch (kept editable on the scene) or a photo.
  const cardPicture = (index: number, picture: { thumbnail: string; sketch?: unknown }) => { if (comp) history.commit((current) => withCardPicture(current, comp.id, index, picture), picture.sketch ? `Storyboard sketch · scene ${index + 1}` : `Storyboard photo · scene ${index + 1}`); };
  const hasStoryboard = !!comp?.storyboard?.length || !!comp?.videoBlueprint?.scenes?.length;

  /**
   * A panel's tabs as its frame shows them: when other panels share the frame (a stack), each of
   * them is one more tab — a click brings it to the front, a drag takes that panel out. The
   * panel's own tabs (a plugin list, a chat's Providers) behave as before.
   */
  const stackTabs = (id: PanelId, tabs: { id: string; label: ReactNode }[], onTab?: (tab: string) => void, onTabPointerDown?: (tab: string, event: React.PointerEvent) => void) => {
    const frame = id === 'chat' ? null : frameOf(tree, id as DockPanelId);
    const members = frame ? leafPanels(frame) : [id as DockPanelId];
    return {
      tabs: members.flatMap((member) => (member === id ? tabs : [{ id: `${STACK_TAB}${member}`, label: panelName(member) }])),
      onTab: (tab: string) => {
        if (tab.startsWith(STACK_TAB)) { const member = tab.slice(STACK_TAB.length) as DockPanelId; editTree((current) => activatePanel(current, member)); setFocused(member as PanelId); }
        else onTab?.(tab);
      },
      onTabPointerDown: (tab: string, event: React.PointerEvent) => {
        if (tab.startsWith(STACK_TAB)) beginPanelDrag(tab.slice(STACK_TAB.length) as DockPanelId, event);
        else if (onTabPointerDown) onTabPointerDown(tab, event);
        else if (id !== 'chat') beginPanelDrag(id as DockPanelId, event);
      },
    };
  };
  const panel = (id: PanelId, tabs: { id: string; label: ReactNode }[], active: string, children: ReactNode, extras: Partial<Parameters<typeof Panel>[0]> = {}) => {
    const { onTab, onTabPointerDown, ...rest } = extras;
    // Any editing-area panel is moved by dragging one of its tabs (DockArea.tsx); the chat stays put.
    const stacked = stackTabs(id, tabs, onTab, onTabPointerDown ?? undefined);
    return (
      <Panel id={id} tabs={stacked.tabs} active={active} maximized={maximized === id} onMaximize={() => toggleMax(id)} onClose={id === 'timeline' || id === 'program' ? undefined : () => setPanelVisible(id, false)} focused={focused === id} onFocus={() => setFocused(id)}
        onTab={stacked.onTab} onTabPointerDown={id === 'chat' ? onTabPointerDown : stacked.onTabPointerDown} {...rest}>
        {children}
      </Panel>
    );
  };

  // The Plugins panel: one tab per plugin shown as a panel, or an invitation to build one.
  const activePlugin = shownPlugins.find((item) => item.id === pluginTab)?.id ?? PLUGINS_HOME;
  const openMaker = (id: string | null) => { setMakerPlugin(id); setMakerOpen(true); };
  const pluginsPanel = panel('plugins', [
    { id: PLUGINS_HOME, label: <span className="plugin-tab-label" title="Every plugin you have installed or created"><Puzzle size={13} /> Plugins</span> },
    ...shownPlugins.map((item) => ({ id: item.id, label: <span className="plugin-tab-label" title={item.description}><PluginMark plugin={item} size={14} /> {item.name}</span> })),
  ], activePlugin, (
    <PluginsPanelBody active={activePlugin} skip={makerOpen ? makerPlugin : null} docked={dockedIds} onMaker={() => openMaker(null)} onOpenInMaker={openMaker}
      builtin={{ id: PLUGINS_HOME, body: (
        <PluginsHome onOpen={setPluginTab} onMarket={() => setMarketOpen(true)} onMaker={() => openMaker(null)} onOpenInMaker={openMaker}
          docked={dockedIds} onDragOut={(plugin, event) => dragPlugin(plugin.id, plugin.name, event)}
          builtins={[{ id: CHARACTERS_TAB, name: 'Characters', description: 'Build 2D and 3D characters for this project', icon: <CharactersIcon size={48} />, banner: 'characters/character-plugin-icon.png', onOpen: () => openCharacters('2d') }]} />
      ) }} />
  ), {
    onTab: setPluginTab,
    // A plugin's tab can be dragged into the editing area to dock it there.
    onTabPointerDown: (id, event) => {
      const item = shownPlugins.find((entry) => entry.id === id);
      // A plugin's tab drags that plugin out; the Plugins tab moves the whole panel.
      if (item) dragPlugin(item.id, item.name, event);
      else beginPanelDrag('plugins', event);
    },
    menu: [
      { label: 'Custom Plugin…', onSelect: () => openMaker(null) },
      { label: 'Marketplace…', onSelect: () => setMarketOpen(true) },
      ...(shownPlugins.some((item) => item.id === activePlugin) ? [
        { label: 'Edit in Plugin Maker…', onSelect: () => openMaker(activePlugin) },
        { label: 'Dock in Editing Area', onSelect: () => dockPlugin(activePlugin) },
        { label: 'Remove from Panel', onSelect: () => void patchPlugin(activePlugin, { panel: false }) },
      ] : []),
    ],
  });

  /** A plugin docked in the editing area: its own panel, dragged by its tab to move it or send it back. */
  const dockedPanel = (item: { id: string }) => {
    const plugin = plugins.find((entry) => entry.id === item.id);
    const name = plugin?.name ?? 'Plugin';
    // It shares its frame like any panel: the other panels there are tabs beside it.
    const stacked = stackTabs(`plugin:${item.id}` as PanelId, [{ id: item.id, label: <span className="plugin-tab-label" title={`${plugin?.description ? `${plugin.description}\n` : ''}Drag to move it, or onto the Plugins panel to put it back.`}>{plugin && <PluginMark plugin={plugin} size={14} />} {name}</span> }], undefined, (_, event) => dragPlugin(item.id, name, event));
    return (
      <Panel id={`plugin:${item.id}`} className="docked-plugin" active={item.id} maximized={false} focused={false} onFocus={() => undefined} onClose={() => closeDockedPlugin(item.id)}
        tabs={stacked.tabs} onTab={stacked.onTab}
        onTabPointerDown={stacked.onTabPointerDown}
        menu={[
          { label: 'Return to Plugins Panel', onSelect: () => undockPlugin(item.id) },
          ...(plugin ? [{ label: 'Edit in Plugin Maker…', onSelect: () => openMaker(item.id) }] : []),
          { label: 'Close', onSelect: () => closeDockedPlugin(item.id) },
        ]}>
        {makerOpen && makerPlugin === item.id ? (
          <div className="plugin-frame-empty">“{name}” is open in the Plugin Maker. <button type="button" className="btn" onClick={() => openMaker(item.id)}>Go there</button></div>
        ) : (
          <PluginFrame pluginId={item.id} />
        )}
      </Panel>
    );
  };
  const chatPanel = panel('chat', [{ id: 'chat', label: 'Bhippi AI' }, { id: 'providers', label: 'Providers' }], chatTab, (
    <>
      <div className="chat-host" style={{ display: chatTab === 'chat' ? undefined : 'none' }}>
        {/* The storyboard lives only in the Storyboard & Transcription panel in the editing area — the chat stays chat. */}
        {/* Once verified there's nothing left to press and nothing left to track — the dock
            vanishes rather than sitting there as a permanent row of green checks. Saving a
            plan for the next task starts a fresh production (see parseProduction), which
            brings the dock back. */}
        <ChatPanel apiRef={chatApi} annotations projectName={project.name} providers={providers} providerId={providerId} model={model} onChooseModel={(id, chosen) => saveSettings({ providerId: id, model: chosen })}
          productionBar={comp?.production && comp.production.phase !== 'done' && (
            <ProductionBar
              comp={comp}
              busy={Object.values(toolRuns).flat().some((run) => run.status === 'running')}
              onAdvance={(phase) => advanceProductionPhase(comp.id, phase)}
              onPolish={polishEdit}
            />
          )}
          effort={effort} onEffort={(value) => saveSettings({ effort: value })}
          permission={permission} onPermission={(value) => saveSettings({ permission: value })} guidedMode={settings.aiGuidedMode ?? 'auto'} onImportFiles={importForChat}
          onUndo={history.undo} onClear={endConversation}
          onReference={setReferenceId}
          editStyle={editStyle} onStyle={setEditStyle}
          ask={mainAsks[0] ?? null} askCount={mainAsks.length}
          onAnswer={(value) => answerAsk(mainAsks[0], value)}
          connections={connections} agents={agents} onStopAgent={stopAgent} onManageConnections={() => setSettingsTab('providers')}
          genPlan={pendingGen ? { plan: pendingGen.plan, assets: assetMap } : null}
          onGenPlan={(plan) => { pendingGen?.resolve(plan); setPendingGen(null); }}
          onManageProviders={() => setSettingsTab('providers')} getContext={(turn) => {
            const kit = resolveActiveKit(settingsRef.current.brandKits, history.current());
            const kits = settingsRef.current.brandKits?.kits ?? [];
            // A Quick edit changes what is there: the scoped part of the timeline and the kit's look,
            // not the reference film, the other kits and the storyboard a production plans with.
            const quick = turn?.mode === 'quick';
            const summary = quick ? quickContext(history.current(), assetMap, selection, turn?.scope ?? null) : aiContext(history.current(), assetMap, selection);
            return { ...(summary as object), ...(quick ? {} : { reference: referenceBrief }), ...(editStyle ? { editStyle } : {}), brandKit: kit ? (quick ? brandKitQuickContext(kit) : brandKitContext(kit)) : null, ...(quick ? {} : { brandKits: kits.map((k) => ({ id: k.id, name: k.name, style: k.style, industry: k.industry, tagline: k.tagline, active: k.id === kit?.id })) }), customTools: customToolsBrief(), plugins: pluginsBrief(), cloudGeneration: settingsRef.current.cloudGeneration?.enabled ? 'on: connected cloud video/image generators may be used; call cloud_generation_capabilities before planning a generated shot, and pass the images the editor attached as referenceAssetIds' : 'off: never call generate_cloud_media', tokenBudget: ledgerBrief(projectKey(projectDirRef.current)), projectFolder: projectDirRef.current ? { path: projectDirRef.current, note: 'The open project folder. Downloads, generated media, voice-overs, roto and exports are filed here automatically; save research notes and scraped pages you write yourself under its Research subfolder. todos/… files you write land in its Guidelines folder, where the user reads them in the Project panel. Your own shell and file tools start in its "AI Work" subfolder (the aiWork path): keep scripts, caches and test renders there. Put every finished piece meant for the edit (a rendered scene, a still, a stem) in "AI Work/Output" (the aiWorkOutput path): Bhippi brings each new file there into the "AI Work" bin of the Project panel as it appears, so the user sees the work arrive. Never leave finished work only in a scratch folder.', aiWork: aiWorkOutputDir(projectDirRef.current).replace(/[\\/]Output$/, ''), aiWorkOutput: aiWorkOutputDir(projectDirRef.current) } : null }; }} tools={toolRuns}
          onTurnDone={(outcome: TurnOutcome) => {
            // A render finished in the turn's last seconds: two looks, so its size is seen settled.
            void syncAiWorkRef.current();
            window.setTimeout(() => void syncAiWorkRef.current(), 2500);
            if (outcome.turnId && turnSnapshots.current.has(outcome.turnId)) {
              const after = history.current();
              // The turn is one undo step, named after what was asked (unless the user edited meanwhile).
              const asked = outcome.prompt.replace(/\s+/g, ' ').trim();
              history.squashTurn(turnSnapshots.current.get(outcome.turnId)!, `AI: "${asked.length > 48 ? `${asked.slice(0, 47)}…` : asked}"`);
              turnResults.current.set(outcome.turnId, after);
              const changes = diffTurn(turnSnapshots.current.get(outcome.turnId)!, after, (clip) => clip.name ?? sourceInfo(after, assetMap, clip.source).name);
              turnChanges.current.set(outcome.turnId, changes);
              const shown = changes.filter((change) => change.kind !== 'removed').map((change) => change.clipId);
              setAiHighlight(shown.length ? { turnId: outcome.turnId, clipIds: new Set(shown) } : null);
            }
            autoAdvance(outcome);
            // The brain learns from every turn (on unless turned off); recording never disturbs the chat.
            if (settingsRef.current.ideagraphRecord === false) return;
            void recordTurnOutcome(outcome).catch(() => undefined);
          }}
          onStartWorkflow={(turnId, mode, tier, scope) => {
            turnStarts.current += 1;
            latestTurn.current = { turnId, at: Date.now(), nudged: false };
            if (tier === 'guided') guidedTurns.current.add(turnId);
            editWorkflows.current.set(turnId, new EditWorkflow(history.current(), assetMap, mode, settingsRef.current.disableLocalGeneration ?? true, true, scope ?? null));
          }}
          workflowStatus={(turnId) => { const flow = editWorkflows.current.get(turnId); return flow ? flow.status(history.current()) : null; }}
          onRevert={revertTurn} canRevert={(turnId) => turnSnapshots.current.has(turnId)}
          changesFor={(turnId) => turnChanges.current.get(turnId) ?? []} onJumpToChange={jumpToChange}
          brandKits={() => settingsRef.current.brandKits?.kits ?? []}
          onUpdateKit={(kitId, change) => { const doc = settingsRef.current.brandKits; if (doc) saveSettings({ brandKits: { ...doc, kits: doc.kits.map((kit) => (kit.id === kitId ? { ...change(kit), updatedAt: new Date().toISOString() } : kit)) } }); }}
          highlightedTurn={aiHighlight?.turnId ?? null}
          onHighlightTurn={(turnId) => { const changes = turnId ? turnChanges.current.get(turnId) ?? [] : []; const ids = changes.filter((change) => change.kind !== 'removed').map((change) => change.clipId); setAiHighlight(turnId && ids.length ? { turnId, clipIds: new Set(ids) } : null); }}
          productionActive={() => { const current = history.current(); const active = current.comps.find((item) => item.id === current.activeCompId); return !!active?.production && active.production.phase !== 'done'; }}
          canvasBlank={() => { const current = history.current(); const active = current.comps.find((item) => item.id === current.activeCompId); return !active || !active.clips.some((clip) => active.tracks.find((track) => track.id === clip.trackId)?.kind === 'video'); }} />
      </div>
      {chatTab === 'providers' && <ProvidersQuick providers={providers} activeId={providerId} onUse={(id) => { saveSettings({ providerId: id, model: null }); setChatTab('chat'); }} onManage={() => setSettingsTab('providers')} onToggle={(row, enabled) => void settingsStore.setProviderEnabled(row.id, enabled).then(setProviders)} />}
    </>
  ), { onTab: (id) => setChatTab(id as 'chat' | 'providers'), menu: [{ label: 'New Conversation', onSelect: () => { chatApi.current?.clear(); endConversation(); } }, { label: 'Manage AI Providers…', onSelect: () => setSettingsTab('providers') }], className: 'panel-chat' });

  const sourcePanel = panel('source', [{ id: 'source', label: `Source: ${sourceAsset?.name ?? '(no clips)'}` }], 'source', (
    <SourceMonitor parkAt={sourcePark} asset={sourceAsset} range={sourceAsset ? sourceRanges[sourceAsset.id] : undefined} onRange={(range) => sourceAsset && setSourceRanges((current) => ({ ...current, [sourceAsset.id]: range }))}
      onInsert={(asset, range, mode) => sourceEdit(asset, range, mode)} onDragOut={(item, event) => startPanelDrag({ kind: 'source', source: item.source, label: item.label, in: item.in, duration: item.duration }, event)}
      patch={{ video: comp?.sourceVideo ?? null, audio: comp?.sourceAudio ?? null }} apiRef={sourceApi} />
  ), { menu: [{ label: 'Close Clip', onSelect: () => setSourceId(null), disabled: !sourceAsset }] });

  // Reloads the Transcription panel whenever any transcription finishes (the AI's included).
  const transcriptRefresh = Object.values(jobs).filter((job) => job.kind === 'transcribe' && job.status === 'done').map((job) => job.id).join(',');
  // The storyboard and the transcription are two panels, each placed and closed on its own.
  const storyboardPanel = panel('storyboard', [{ id: 'storyboard', label: 'Storyboard' }], 'storyboard', (
      hasStoryboard && comp ? (
        <StoryboardViewer
          variant="panel"
          scenes={comp.storyboard ?? []}
          fps={comp.fps}
          compName={comp.name}
          onSeek={(t) => playhead.seek(t)}
          blueprint={comp.videoBlueprint ?? null}
          compId={comp.id}
          aspect={comp.width / Math.max(1, comp.height)}
          onRequestFrames={requestFrames}
          onCardPicture={cardPicture}
          actionLabel={userAdvance(comp.production?.phase) === 'gathering' ? 'Start generating' : userAdvance(comp.production?.phase) === 'editing' ? 'Start editing' : null}
          onExecuteBlueprint={userAdvance(comp.production?.phase) ? () => advanceProductionPhase(comp.id, userAdvance(comp.production?.phase)!) : undefined}
          executing={Object.values(toolRuns).flat().some((run) => run.status === 'running')}
          onPlayToggle={() => playhead.setPlaying(!playhead.isPlaying())}
          isPlaying={isPlaying}
        />
      ) : (
        <div className="transcript-empty"><span>No storyboard for this comp yet. Ask Bhippi AI to plan the video — each scene then shows here with its frame.</span></div>
      )
  ));
  const transcriptPanel = panel('transcript', [{ id: 'transcript', label: 'Transcription' }], 'transcript', (
    <TranscriptPanel project={project} comp={comp} assets={assetMap} refreshKey={transcriptRefresh}
      onCutRanges={(ranges, words) => {
        // Latest first, so each cut leaves the earlier ones where they were; one undo step.
        editComp((current) => ranges.reduce((next, range) => removeRange(next, range.start, range.end, 'extract'), current), `Cut ${words} Word${words === 1 ? '' : 's'}`);
        if (ranges.length) playhead.seek(Math.min(...ranges.map((range) => range.start)));
      }}
      onWordCorrected={(at, from, to) => {
        // The correction reaches the captions already on the timeline (only when one has the word).
        if (comp && correctCaptions(comp, at, from, to) !== comp) editComp((current) => correctCaptions(current, at, from, to), 'Correct Caption Word');
      }} />
  ));

  const programPanel = panel('program', [{ id: 'program', label: `Program: ${comp?.name ?? '—'}` }], 'program', (
    <ProgramMonitor project={project} comp={comp} assets={assetMap} offline={offline} history={history} selection={selection} onSelect={setSelection} tool={tool} onTool={setTool}
      onImport={() => void pickFiles()} onMarkIn={markIn} onMarkOut={markOut} onAddMarker={addMarker} onLift={() => removeRangeNow('lift')} onExtract={() => removeRangeNow('extract')}
      onExportFrame={() => void exportFrame()} apiRef={programApi}
      previewCache={{ enabled: settings.previewCacheEnabled ?? true, budgetMb: settings.previewCacheMb ?? 1536 }}
      onPreviewCache={(next) => saveSettings({ previewCacheEnabled: next.enabled, previewCacheMb: next.budgetMb })} />
  ), { menu: [{ label: 'Export Frame…', onSelect: () => void exportFrame(), disabled: !hasClips }, { label: 'Clear In and Out', onSelect: clearInOut }] });

  const propertiesPanel = panel('properties', [{ id: 'properties', label: 'Properties' }], 'properties', (
    <PropertiesPanel
      project={project}
      comp={comp}
      assets={assetMap}
      history={history}
      selection={selection}
      transition={transitionSelection}
      onOpenGraphics={() => showPanel('graphics')}
      onSpeedDialog={() => selectedClips[0] && speedDialog(selectedClips[0], selection)}
      onAudioGain={() => gainDialog(selectedClips)}
    />
  ));
  const effectControlsPanel = panel('effect-controls', [{ id: 'effect-controls', label: 'Effect Controls' }], 'effect-controls', (
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
  ));

  // Files every loose bin entry into its category folder (Footage, B-roll, Motion Graphics…).
  const organizeBinNow = () => {
    const { project: organized, moved } = organizeBin(history.current(), assetMap);
    if (!moved.length) return toast({ tone: 'info', title: 'Bin already organised', body: 'Nothing loose to file.', timeout: 2500 });
    history.commit(() => organized, 'Organize Bin');
    toast({ tone: 'success', title: `Filed ${moved.length} item${moved.length === 1 ? '' : 's'}`, body: describeMoved(moved), timeout: 4000 });
  };

  /** The Project panel's body, showing one of its sections: the bin, Effects, Subtitles, Graphics or Audio — each its own dockable panel. */
  const projectBody = (tab: ProjectTab) => (
    <ProjectPanel tab={tab} project={project} assets={assets} history={history} folder={binFolder} onFolder={setBinFolder} selection={binSelection} onSelect={setBinSelection}
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
  );
  const projectPanel = panel('project', [{ id: 'project', label: `Project: ${project.name}` }], 'project', projectBody('project'), { menu: [{ label: 'New Comp…', onSelect: newCompDialog }, { label: 'New Item', submenu: newItemMenu.slice(2) }, { label: 'Import…', onSelect: () => void pickFiles() }, { separator: true }, { label: 'Organize Bin into Folders', onSelect: organizeBinNow }] });
  const effectsPanel = panel('effects', [{ id: 'effects', label: 'Effects' }], 'effects', projectBody('effects'));
  const subtitlesPanel = panel('subtitles', [{ id: 'subtitles', label: 'Subtitles' }], 'subtitles', projectBody('subtitles'));
  const graphicsPanel = panel('graphics', [{ id: 'graphics', label: 'Graphics' }], 'graphics', projectBody('graphics'));
  const audioPanel = panel('audio', [{ id: 'audio', label: 'Audio' }], 'audio', projectBody('audio'));

  const timelinePanel = panel('timeline', [{ id: 'timeline', label: comp?.name ?? 'Timeline' }], 'timeline', (
    <Timeline project={project} assets={assetMap} comp={comp} history={history} selection={selection} onSelect={(ids) => { setSelection(ids); setSelectedEdit(null); }} aiChanged={aiHighlight?.clipIds} selectedEdit={selectedEdit} onSelectEdit={(clipId, edge) => setSelectedEdit({ clipId, edge })} transition={transitionSelection} onSelectTransition={setTransitionSelection}
      tool={tool} onTool={setTool} zoom={zoom} onZoom={setZoom} snapping={snapping} onSnapping={setSnapping} linkedSelection={linkedSelection} onLinkedSelection={setLinkedSelection}
      nestComps={nestComps} onNestComps={setNestComps} display={display} onDisplay={setDisplay} onActivateComp={(id) => history.view((current) => ({ ...current, activeCompId: id }))}
      onCloseComp={closeComp} onOpenComp={openComp} onOpenInSource={openInSource} onClipMenu={(event, clipId, at) => clipMenu(event, clipId, at)} onTrackMenu={trackMenu} onEmptyMenu={emptyMenu}
      onMarkerEdit={markerDialog} onAddMarker={addMarker} onVoiceOver={(trackId) => void voiceOver(trackId)} recordingTrack={recordingTrack} incoming={incoming} apiRef={timelineApi} />
  ), { menu: [{ label: 'Comp Settings…', onSelect: compSettings }, { label: 'Zoom to Sequence', onSelect: () => timelineApi.current?.fit() }, { label: 'Add Marker', onSelect: addMarker }] });


  const cancelJob = useCallback(async (id: string) => {
    // A plugin's job runs in its page, not the backend: the page is told to stop.
    if (id.startsWith('plugin:')) {
      if (!cancelPluginJob(id)) {
        const live = jobsStore.get(id);
        if (live) jobsStore.put({ ...live, status: 'cancelled', message: 'Cancelled by user', cancellable: false });
      }
      setJobs((current) => (current[id] ? { ...current, [id]: { ...current[id], status: 'cancelled', message: 'Cancelled by user', cancellable: false } } : current));
      return;
    }
    try {
      await api.jobCancel(id);
      const live = jobsStore.get(id);
      if (live) jobsStore.put({ ...live, status: 'cancelled', message: 'Cancelled by user' });
      setJobs((current) => {
        const target = current[id];
        if (!target) return current;
        return { ...current, [id]: { ...target, status: 'cancelled', message: 'Cancelled by user' } };
      });
      toast({ tone: 'info', title: 'Task stopped', body: 'The video generation or background task was cancelled.' });
    } catch (e) {
      toast({ tone: 'error', title: 'Could not stop task', body: errorText(e) });
    }
  }, [toast]);

  const deleteJob = useCallback(async (id: string) => {
    try {
      await api.jobCancel(id).catch(() => undefined);
      await api.jobDelete(id).catch(() => undefined);
      jobsStore.remove(id);
      setJobs((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      toast({ tone: 'info', title: 'Task deleted', body: 'The task was removed.' });
    } catch (e) {
      toast({ tone: 'error', title: 'Could not delete task', body: errorText(e) });
    }
  }, [toast]);

  /** The handle a tab-less panel (tools, meters) is dragged by. */
  const grip = (id: DockPanelId) => <div className="dock-grip" title={`Drag to move ${PANEL_NAMES[id]}`} onPointerDown={(event) => beginPanelDrag(id, event)} />;
  /** One panel of the editing area, by its dock id. */
  const dockPanel = (id: DockPanelId): ReactNode => {
    if (id.startsWith('plugin:')) return plugins.some((entry) => entry.id === id.slice(7)) ? dockedPanel({ id: id.slice(7) }) : <div className="plugin-frame-empty">This plugin is not installed.</div>;
    switch (id) {
      case 'project': return projectPanel;
      case 'source': return sourcePanel;
      case 'program': return programPanel;
      case 'properties': return propertiesPanel;
      case 'effect-controls': return effectControlsPanel;
      case 'effects': return effectsPanel;
      case 'subtitles': return subtitlesPanel;
      case 'graphics': return graphicsPanel;
      case 'audio': return audioPanel;
      case 'timeline': return timelinePanel;
      case 'storyboard': return storyboardPanel;
      case 'transcript': return transcriptPanel;
      case 'plugins': return pluginsPanel;
      case 'tools': return <div className="dock-bare" data-panel="tools">{grip('tools')}<ToolsPanel tool={tool} onTool={setTool} onAutoRoto={() => void autoRoto()} rotoBusy={rotoBusy} rotoProgress={rotoProgress} /></div>;
      case 'meters': return <div className="dock-bare" data-panel="meters">{grip('meters')}<AudioMeters prefs={layout.meters ?? DEFAULT_METERS} onPrefs={(meters) => setLayout((current) => ({ ...current, meters }))} mutes={mutes} onMutes={setMuteState} onClose={() => setPanelVisible('meters', false)} /></div>;
      default: return null;
    }
  };

  const maximizedContent: Record<PanelId, ReactNode> = { chat: chatPanel, storyboard: storyboardPanel, transcript: transcriptPanel, source: sourcePanel, program: programPanel, properties: propertiesPanel, project: projectPanel, timeline: timelinePanel, meters: null, tools: null, plugins: pluginsPanel, effects: effectsPanel, subtitles: subtitlesPanel, graphics: graphicsPanel, audio: audioPanel, 'effect-controls': effectControlsPanel };
  const maximizedPanel = maximized && maximizedContent[maximized] ? maximized : null;

  return (
    <div className="app">
      <MenuBar menus={menus} />
      <PluginClipRenderers pluginIds={clipPlugins} />
      <BackgroundPlugins panelShown={showPlugins && (!maximizedPanel || maximizedPanel === 'plugins')} docked={dockedIds} dockShown={!maximizedPanel} skip={makerOpen ? makerPlugin : null} />
      <PanelDragOverlay drag={panelDrag} />
      <CharactersWindow open={charactersOpen} mode={charactersMode} onMode={setCharactersMode} onAdded={addCharacter}
        onClose={() => setCharactersOpen(false)} />
      {marketOpen && (
        <PluginMarket known={KNOWN_TOOLS} onClose={() => setMarketOpen(false)} onOpenInMaker={(id) => { setMarketOpen(false); openMaker(id); }}
          onOpenCharacters={() => { setMarketOpen(false); openCharacters('2d'); }} />
      )}
      {/* Downloads and the Plugin Maker's build share the bottom-right corner, above the status bar. */}
      <CornerStack>
        <DownloadsBadge onCancel={(id) => void cancelJob(id)} />
        {!makerOpen && (
          <MakerStatusBadge activity={makerActivity} asking={makerAsks.length > 0} seen={makerSeen} onSeen={setMakerSeen}
            onOpen={() => setMakerOpen(true)} onCancel={() => makerChatApi.current?.stop()} />
        )}
      </CornerStack>
      {(makerOpen || makerMounted) && (
        <PluginMaker
          hidden={!makerOpen}
          selected={makerPlugin}
          onSelect={setMakerPlugin}
          onPrompt={(text) => makerChatApi.current?.send(text)}
          onClose={() => setMakerOpen(false)}
          // The Marketplace opens over the Maker; closing it lands back in the Maker, not the editor.
          onMarket={() => setMarketOpen(true)}
          known={KNOWN_TOOLS}
          chat={
            <ChatPanel apiRef={makerChatApi} logScope="plugins" persona={PLUGIN_MAKER_BRIEF} lockedMode="quick" harness="plugin-maker" toolset={PLUGIN_MAKER_TOOLSET} label="Plugin Maker chat"
              instruction="You are in the Plugin Maker: build or change the plugin the user describes by following your loop — spec.md first, the draft files, plugin_validate, plugin_save, plugin_test, plugin_screenshot — until the Judge passes or three rounds have run."
              placeholder="Describe the plugin you want…"
              providers={providers} providerId={providerId} model={model} onChooseModel={(id, chosen) => saveSettings({ providerId: id, model: chosen })}
              effort={effort} onEffort={(value) => saveSettings({ effort: value })}
              permission={permission} onPermission={(value) => saveSettings({ permission: value })}
              onUndo={history.undo}
              onReference={setReferenceId} editStyle={null} onStyle={() => undefined}
              ask={makerAsks[0] ?? null} askCount={makerAsks.length}
              onAnswer={(value) => answerAsk(makerAsks[0], value)}
              onActivity={setMakerActivity}
              connections={connections} agents={agents} onStopAgent={stopAgent} onManageConnections={() => setSettingsTab('providers')}
          genPlan={pendingGen ? { plan: pendingGen.plan, assets: assetMap } : null}
          onGenPlan={(plan) => { pendingGen?.resolve(plan); setPendingGen(null); }}
              onManageProviders={() => setSettingsTab('providers')}
              getContext={() => ({ ...(aiContext(history.current(), assetMap, selection) as object), customTools: customToolsBrief(), plugins: pluginsBrief(), cloudGeneration: settingsRef.current.cloudGeneration?.enabled ? 'on: connected cloud video/image generators may be used; call cloud_generation_capabilities before planning a generated shot, and pass the images the editor attached as referenceAssetIds' : 'off: never call generate_cloud_media', pluginMaker: { openPluginId: selectedPlugin(), note: selectedPlugin() ? `The user has the "${selectedPlugin()}" plugin open: change THAT plugin (save_plugin with its id) unless they ask for a new one.` : 'No plugin is open: save_plugin creates a new one.' } })}
              tools={toolRuns}
              onStartWorkflow={(turnId, mode) => {
                // A plugin is not a video: its turns never stop to ask for a frame size.
                makerTurns.current.add(turnId);
                editWorkflows.current.set(turnId, new EditWorkflow(history.current(), assetMap, mode, settingsRef.current.disableLocalGeneration ?? true, false));
              }}
              workflowStatus={(turnId) => { const flow = editWorkflows.current.get(turnId); return flow ? flow.status(history.current()) : null; }}
              onRevert={revertTurn} canRevert={(turnId) => turnSnapshots.current.has(turnId)} />
          }
        />
      )}
      {learningOpen && <LiveJobs>{(live) => <LearningWorkspace project={project} assets={assetMap} history={history} jobs={live} onClose={() => setLearningOpen(false)} />}</LiveJobs>}
      <HeaderBar
        resourceMonitor={<LiveJobs>{(live) => <ResourceMonitor jobs={live} runs={Object.values(toolRuns).flat()} onCancelJob={cancelJob} onDeleteJob={deleteJob} />}</LiveJobs>}
        mode={mode} onHome={() => setMode('home')} onImport={() => { setMode('edit'); void pickFiles(); }} onEdit={() => setMode('edit')} onExport={() => { setMode('edit'); setExportOpen(true); }} onQueue={() => setQueueOpen(true)}
        exportDisabled={!hasClips} title={`${project.name}${dirty ? ' *' : ''}`} saved={!dirty} chatOpen={!hidden('chat')} onToggleChat={() => setPanelVisible('chat', hidden('chat'))}
        muted={mutes.all} onToggleMute={() => setMuteState({ ...mutes, all: !mutes.all })} programMaximized={maximized === 'program'} onToggleProgramMax={() => toggleMax('program')}
        onSettings={() => setSettingsTab('general')} onUpdates={() => setSettingsTab('about')} onAccount={() => setSettingsTab('about')}
      />

      {mode === 'home' && (
        <LiveJobs>{(live) => (
        <HomeScreen project={project} info={info} jobs={live} providers={providers} assetCount={project.media.length} onEdit={() => setMode('edit')} onNewProject={newProjectNow}
          onImport={() => { setMode('edit'); void pickFiles(); }} onProviders={() => setSettingsTab('providers')} onShortcuts={() => setShortcutsOpen(true)} onOpen={() => void openProject()}
          recents={settings.recentProjects} recentFound={recentFound} onOpenRecent={openRecent} onForgetRecent={forgetRecent} />
        )}</LiveJobs>
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
              {/* Every panel of the editing area, where the user put it (lib/dockTree.ts). */}
              <DockArea tree={tree} areaRef={dockAreaRef} render={dockPanel}
                onResize={(splitId, sizes) => editTree((current) => resizeSplit(current, splitId, sizes))}
                minSize={(panel) => DOCK_PANEL_MIN[panel] ?? (panel.startsWith('plugin:') ? 240 : 160)} />
            </div>
          </>
        )}
      </main>

      <TerminalPanel
        open={terminalOpen}
        onClose={() => setTerminalOpen(false)}
        height={terminalHeight}
        onHeightChange={setTerminalHeight}
      />

      <footer className="statusbar">
        <button type="button" className={`status-item${info && !info.ffmpeg.found ? ' warn' : ''}`} onClick={() => setSettingsTab('media')} title={info?.ffmpeg.path ?? 'FFmpeg'}>
          {!info ? <LoaderCircle size={12} className="spin" /> : info.ffmpeg.found ? <CircleCheck size={12} /> : <TriangleAlert size={12} />}
          {info?.ffmpeg.found ? 'FFmpeg ready' : 'FFmpeg missing'}
        </button>
        <span className="status-item muted">{comp ? `${comp.width}×${comp.height} · ${comp.fps} fps · ${comp.clips.length} clips · ${timecode(compDuration(comp), fps)}` : 'no comp'}</span>
        {recordingTrack && <span className="status-item warn"><Mic size={12} /> Recording…</span>}
        <LiveJobs>{(live) => {
          const runningJobs = live.filter((job) => job.status === 'running');
          const exportJob = runningJobs.find((job) => job.kind === 'export');
          const exports = runningJobs.filter((job) => job.kind === 'export').length;
          const mediaJobs = runningJobs.filter((job) => job.kind === 'media');
          const generationJobs = runningJobs.filter((job) => job.kind === 'generation');
          return (
            <>
              {mediaJobs.length > 0 && <span className="status-item"><LoaderCircle size={12} className="spin" /> Preparing {mediaJobs.length} media…</span>}
              {runningJobs.filter((job) => job.kind === 'collect').map((job) => (
                <span key={job.id} className="status-item export-progress" title={job.label}>
                  <LoaderCircle size={12} className="spin" /> {job.message}
                  <span className="progress"><span style={{ width: `${Math.round(job.progress * 100)}%` }} /></span>
                </span>
              ))}
              {runningJobs.filter((job) => job.kind === 'install').map((job) => <span key={job.id} className="status-item"><LoaderCircle size={12} className="spin" /> {job.label}…</span>)}
              {exportJob && (
                <button type="button" className="status-item export-progress" onClick={() => setQueueOpen(true)} title="Open the render queue">
                  <LoaderCircle size={12} className="spin" />
                  {exportJob.message}
                  {exports > 1 && <span className="muted">+{exports - 1} more</span>}
                  <span className="progress"><span style={{ width: `${Math.round(exportJob.progress * 100)}%` }} /></span>
                </button>
              )}
              {generationJobs.length > 0 && <GenerationJobsMenu jobs={generationJobs} onCancel={cancelJob} />}
            </>
          );
        }}</LiveJobs>
        <button
          type="button"
          className={`status-item terminal-toggle-btn ${terminalOpen ? 'active' : ''} ${terminalErrorCount > 0 ? 'has-errors' : ''}`}
          onClick={() => setTerminalOpen((prev) => !prev)}
          title="Toggle Terminal and live logs"
        >
          <TerminalIcon size={12} />
          <span>Terminal</span>
          {terminalErrorCount > 0 && (
            <span className="terminal-badge error">{terminalErrorCount}</span>
          )}
        </button>
        <div className="toolbar-spacer" />
        <span className="status-item muted">{TOOL_LABEL[tool] ?? 'Selection'}</span>
        <button type="button" className="status-item" onClick={() => setSettingsTab('providers')} title="AI providers">
          <ProviderLogo id={providerId} size={12} /> {providers.find((row) => row.id === providerId)?.label ?? 'Bhippi'}
          {providers.length === 0 && <LoaderCircle size={11} className="spin" />}
        </button>
        <span className="status-item muted">v{info?.version}</span>
      </footer>

      {dragLabel && incoming && <div className="drag-ghost" style={{ left: incoming.x + 12, top: incoming.y + 12 }}><Film size={13} /> {dragLabel}</div>}
      {fileHover && (
        <div className={`file-drop zone-${fileHover.zone}`} aria-live="polite">
          <div className="file-drop-target" style={fileHover.rect ? { left: fileHover.rect.left, top: fileHover.rect.top, width: fileHover.rect.width, height: fileHover.rect.height } : undefined}>
            <div className="file-drop-card">
              {fileHover.zone === 'chat' ? <MessageSquare size={22} /> : fileHover.zone === 'timeline' ? <Film size={22} /> : <Upload size={22} />}
              <strong>{fileHover.title}</strong>
              <span>{fileHover.detail}</span>
              <em>{fileHover.what}</em>
            </div>
          </div>
        </div>
      )}
      {menu && <MenuList items={menu.items} anchor={menu.anchor} onClose={() => setMenu(null)} />}
      {dialog}
      {onboarding && loaded && <Onboarding onPatch={(patch) => saveSettings(patch)} onDone={() => setOnboarding(false)} />}
      {tour && !onboarding && <Tour onStep={tourStep} onDone={endTour} />}
      {settingsTab && <LiveJobs>{(live) => <SettingsModal onTour={startTour} tab={settingsTab} onTab={setSettingsTab} onClose={() => setSettingsTab(null)} info={info} onTools={(ffmpeg) => setInfo((current) => (current ? { ...current, ffmpeg } : current))} settings={settings} onSettings={(next) => saveSettings(next)} providers={providers} onProviders={setProviders} jobs={live} projectBrandKitId={project.activeBrandKitId ?? null} onProjectBrandKit={(id) => history.commit((current) => ({ ...current, activeBrandKitId: id }), "Brand kit")} importMedia={toolHost.importMedia} />}</LiveJobs>}
      <ErrorBoundary scope="Render window"><RenderWindow /></ErrorBoundary>
      {historyOpen && <HistoryDialog steps={history.steps} onJump={(steps) => history.jump(steps)} onClose={() => setHistoryOpen(false)} />}
      {exportOpen && comp && <ExportDialog project={project} comp={comp} prefs={settings.export} onClose={() => setExportOpen(false)} onExport={(options, folder, preset) => void startExport(options, folder, preset)} onPrefs={(patch) => saveSettings({ export: { ...settingsRef.current.export, ...patch } })} />}
      {queueOpen && <LiveJobs>{(live) => <RenderQueueDialog jobs={live} onClose={() => setQueueOpen(false)} onQueue={() => { setQueueOpen(false); setExportOpen(true); }} onCancel={(id) => void api.jobCancel(id)} onReveal={(path) => void api.revealPath(path)} onOpen={(path) => void api.openPath(path)} />}</LiveJobs>}
      {shortcutsOpen && <ShortcutsDialog overrides={settings.shortcuts} onSave={(shortcuts) => void saveSettings({ shortcuts })} onClose={() => setShortcutsOpen(false)} />}
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
      <Avatar
        enabled={loaded && mode === 'edit' && settings.avatar === true}
        character={settings.avatarCharacter}
        onMenu={(point, name) => showMenu({ clientX: point.x, clientY: point.y }, [
          {
            label: `Hide ${name}`,
            onSelect: () => {
              saveSettings({ avatar: false });
              toast({ tone: 'info', title: `${name} is hidden`, body: 'Turn it back on any time in Settings › Avatar.', timeout: 8000, actions: [{ label: 'Open Settings', run: () => setSettingsTab('avatar') }] });
            },
          },
          { label: 'Change character or colours…', onSelect: () => setSettingsTab('avatar') },
        ])}
      />
      {/* The program's sound keeps playing while a panel is maximized or Home is open. */}
      {mode === 'home' && comp && <div hidden><CompAudio project={project} assets={assetMap} offline={offline} playing={false} rate={1} comp={comp} time={playhead.get()} quality={1} /></div>}
    </div>
  );
}

function ProvidersQuick({ providers, activeId, onUse, onManage, onToggle }: { providers: ProviderInfo[]; activeId: string | null; onUse: (id: string) => void; onManage: () => void; onToggle: (row: ProviderInfo, enabled: boolean) => void }) {
  const ready = providers.filter((row) => row.usable);
  const others = providers.filter((row) => !row.usable);
  // Set up but not answering (a rejected key, Ollama stopped): still worth a line here.
  const broken = others.filter(isSetUp);
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
      {broken.map((row) => (
        <div key={row.id} className="pq-row dim">
          <ProviderLogo id={row.id} size={18} />
          <div className="pq-text"><strong>{row.label}</strong><span>{row.kind === 'cloud_api' ? 'key not accepted' : row.kind === 'local_server' ? 'not running' : row.kind === 'cli' ? 'not signed in' : 'not answering'}</span></div>
          <button type="button" className="btn btn-small btn-ghost" onClick={onManage}>Fix</button>
        </div>
      ))}
      {/* Providers this computer does not have wait in Settings › AI providers › Add provider,
          rather than filling this list with "not running" and "needs an API key" rows. */}
      {others.length > broken.length && (
        <button type="button" className="btn btn-small btn-ghost pq-add" onClick={onManage} title={others.filter((row) => !isSetUp(row)).map((row) => row.label).join(', ')}>
          + Add provider
        </button>
      )}
    </div>
  );
}
