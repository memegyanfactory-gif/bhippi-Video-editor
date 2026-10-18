// The studio shell: toolbar, Browser, Playlist, and the Channel Rack / Piano Roll / Mixer below it,
// plus floating instrument and effect panels. It keeps the engine fed with the song and turns every
// edit into a project history step (`Music: …`), so undo / redo are the app's own.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PanelLeftOpen } from 'lucide-react';
import { fileSrc } from '../../lib/ipc';
import type { Project } from '../../lib/types';
import { assetSampleLoader } from '../engine';
import type { MusicEngineApi } from '../engine/api';
import { ensureInserts, songOf, withSong } from '../model';
import { onStudioRequest, setStudioOpen } from '../studioBus';
import type { Channel, MusicProject, MusicView } from '../types';
import { Browser } from './Browser';
import { ChannelRack } from './ChannelRack';
import { ConfirmDialog, type PendingConfirm } from './ConfirmDialog';
import { ActionsContext, StudioContext, type Actions, type BottomWindow, type NewPanel, type PanelRef, type Studio, type StudioProps, type Ui } from './ctx';
import { snapSteps } from './format';
import { Mixer } from './Mixer';
import { ParamPanels } from './ParamPanel';
import { PianoRoll } from './PianoRoll';
import { Playlist } from './Playlist';
import { useShortcuts } from './shortcuts';
import { trackPointer } from './studioUtil';
import { Toolbar } from './Toolbar';

export function StudioShell({ engine, props }: { engine: MusicEngineApi; props: StudioProps }) {
  const { history, assets } = props;
  const { commit, preview, settle: settleHistory, view: viewHistory } = history;
  const fallback = useRef<MusicProject | null>(null);
  const songIn = useCallback((p: Project): MusicProject => (p.music ? songOf(p) : (fallback.current ??= songOf(p))), []);
  const song = useMemo(() => songIn(props.project), [props.project.music, props.project.name]);
  const songRef = useRef(song);
  songRef.current = song;
  const propsRef = useRef(props);
  propsRef.current = props;
  const assetsRef = useRef(assets);
  assetsRef.current = assets;

  const [ui, setUiState] = useState<Ui>(() => ({
    win: (['rack', 'pianoroll', 'mixer'] as const).find((w) => w === song.view.window) ?? 'rack',
    playlist: true, browser: true, snapId: '1/16', metronome: false, playing: false, playFrom: 0,
  }));
  const uiRef = useRef(ui);
  uiRef.current = ui;
  const [panels, setPanels] = useState<PanelRef[]>([]);
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const [frac, setFrac] = useState(0.45);
  const store = useRef<Record<string, number>>({});
  const root = useRef<HTMLDivElement>(null);
  const center = useRef<HTMLDivElement>(null);
  const previewToken = useRef(0);

  const loadSample = useMemo(() => assetSampleLoader((id) => assetsRef.current.get(id)?.path ?? null, fileSrc), []);

  // The engine always plays the song on screen; params change in place.
  useEffect(() => { engine.setSong(song); }, [engine, song]);
  useEffect(() => { engine.setMetronome(ui.metronome); }, [engine, ui.metronome]);
  // The engine stops itself at the end of a song that does not loop; follow it.
  useEffect(() => {
    const id = window.setInterval(() => { if (uiRef.current.playing && !engine.playing) setUiState((u) => ({ ...u, playing: false })); }, 250);
    return () => window.clearInterval(id);
  }, [engine]);

  const setView = useCallback((patch: Partial<MusicView>) => {
    viewHistory((p) => { const s = songIn(p); return withSong(p, { ...s, view: { ...s.view, ...patch } }); });
  }, [viewHistory, songIn]);
  const setUi = useCallback((patch: Partial<Ui>) => {
    setUiState((u) => ({ ...u, ...patch }));
    if (patch.win) setView({ window: patch.win });
    else if (patch.playlist) setView({ window: 'playlist' });
  }, [setView]);

  const actions = useMemo<Actions>(() => {
    const edit: Actions['edit'] = (change, label) => commit((p) => withSong(p, change(songIn(p))), `Music: ${label}`);
    const drag: Actions['drag'] = (change) => preview((present, start) => withSong(present, change(songIn(start))));
    const stop = () => { engine.stop(); setUiState((u) => ({ ...u, playing: false })); };
    const play = (from?: number) => {
      const s = songRef.current;
      engine.play({ mode: s.view.mode, from: s.view.mode === 'song' ? (from ?? uiRef.current.playFrom) : undefined, patternId: s.view.activePatternId ?? undefined })
        .catch((e) => {
          setUiState((u) => ({ ...u, playing: false }));
          propsRef.current.toast({ tone: 'error', title: 'Could not start playback', body: e instanceof Error ? e.message : String(e) });
        });
      setUiState((u) => ({ ...u, playing: true }));
    };
    return {
      engine, edit, drag, setView, setUi, loadSample, store, stop, play,
      settle: (label) => settleHistory(label),
      toggle: () => (uiRef.current.playing ? stop() : play()),
      openPanel: (panel: NewPanel) => setPanels((list) => {
        const id = panel.kind === 'instrument' ? `i:${panel.channelId}` : `e:${panel.insert}:${panel.effectId}`;
        return [...list.filter((p) => p.id !== id), { ...panel, id }];
      }),
      closePanel: (id) => setPanels((list) => list.filter((p) => p.id !== id)),
      // Auditions a channel that is not in the song yet: it is lent to the engine for a moment.
      previewChannel: (channel: Channel, key?: number) => {
        const s = ensureInserts(songRef.current, channel.insert + 1);
        const token = ++previewToken.current;
        engine.setSong({ ...s, channels: [...s.channels.filter((c) => c.id !== channel.id), channel] });
        window.setTimeout(() => engine.previewNote(channel.id, key ?? (channel.drum ? channel.rootKey : 60), 0.85, 0.7), 30);
        window.setTimeout(() => { if (previewToken.current === token) engine.setSong(songRef.current); }, 1400);
      },
      confirm: (request) => new Promise<boolean>((resolve) => setConfirm({ ...request, resolve })),
      toast: (t) => propsRef.current.toast(t),
      importAudio: (path) => propsRef.current.importAudio(path),
      placeOnTimeline: (id, seconds, beats, downbeats) => propsRef.current.placeOnTimeline(id, seconds, beats, downbeats),
      getSong: () => songRef.current,
    };
  }, [engine, commit, preview, settleHistory, songIn, setView, setUi, loadSample]);

  const channel = song.channels.find((c) => c.id === song.view.selectedChannelId) ?? song.channels[0] ?? null;
  const pattern = song.patterns.find((p) => p.id === song.view.activePatternId) ?? song.patterns[0] ?? null;
  const snap = snapSteps(song, ui.snapId);
  const studio = useMemo<Studio>(() => ({ song, ui, assets, channel, pattern, snap, panels }), [song, ui, assets, channel, pattern, snap, panels]);

  // The AI's music_open_studio: focus a window, a pattern or a channel (or close the studio).
  useEffect(() => {
    setStudioOpen(true);
    const off = onStudioRequest((r) => {
      if (!r.open) { propsRef.current.onClose(); return; }
      if (r.window === 'playlist') setUi({ playlist: true });
      else if (r.window) setUi({ win: r.window as BottomWindow });
      if (r.patternId) setView({ activePatternId: r.patternId });
      if (r.channelId) setView({ selectedChannelId: r.channelId });
      if (r.mode && r.mode !== songRef.current.view.mode) {
        if (uiRef.current.playing) actions.stop();
        setView({ mode: r.mode });
      }
      if (r.metronome !== undefined) setUi({ metronome: r.metronome });
      if (r.snap) setUi({ snapId: r.snap });
      if (r.browser !== undefined) setUi({ browser: r.browser });
      // Showing the playlist for the AI does not take the bottom window away from the person.
      if (r.playlist !== undefined) setUiState((u) => ({ ...u, playlist: r.playlist as boolean }));
      if (r.playFrom !== undefined) setUi({ playFrom: Math.max(0, r.playFrom) });
      if (r.closePanels) setPanels([]);
      if (r.panel) actions.openPanel(r.panel);
      if (r.transport === 'stop') actions.stop();
      else if (r.transport === 'rewind') { actions.stop(); setUi({ playFrom: 0 }); }
      else if (r.transport === 'play') {
        // The request's own mode and pattern: the song in songRef may not have caught up with them yet.
        const mode = r.mode ?? songRef.current.view.mode;
        engine.play({ mode, from: mode === 'song' ? (r.playFrom ?? uiRef.current.playFrom) : undefined, patternId: r.patternId ?? songRef.current.view.activePatternId ?? undefined })
          .catch((e) => {
            setUiState((u) => ({ ...u, playing: false }));
            propsRef.current.toast({ tone: 'error', title: 'Could not start playback', body: e instanceof Error ? e.message : String(e) });
          });
        setUiState((u) => ({ ...u, playing: true }));
      }
    });
    return () => { off(); setStudioOpen(false); };
  }, [setUi, setView, actions, engine]);

  // Focus lives inside the studio so its shortcuts (and the QWERTY piano) win over the app's.
  useEffect(() => { root.current?.focus(); }, []);
  const { onKeyDown, onKeyUp } = useShortcuts(engine, actions, channel, song, ui.playlist);

  const splitDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const rect = center.current?.getBoundingClientRect();
    if (!rect) return;
    trackPointer((ev) => setFrac(Math.min(0.8, Math.max(0.15, (ev.clientY - rect.top) / rect.height))), () => undefined);
  };

  const bottom = ui.win === 'rack' ? <ChannelRack /> : ui.win === 'pianoroll' ? <PianoRoll /> : <Mixer />;
  return (
    <StudioContext.Provider value={studio}>
      <ActionsContext.Provider value={actions}>
        <div ref={root} className="ms-root" tabIndex={-1} onKeyDown={onKeyDown} onKeyUp={onKeyUp} role="application" aria-label="Music Studio">
          <Toolbar history={history} onClose={props.onClose} />
          <div className="ms-main">
            {ui.browser ? <Browser /> : (
              <button type="button" className="ms-browser-tab" aria-label="Show the browser" title="Show the browser" onClick={() => setUi({ browser: true })}>
                <PanelLeftOpen size={14} /><span>Browser</span>
              </button>
            )}
            <div ref={center} className="ms-center">
              {ui.playlist && <div className="ms-top" style={{ flex: `0 0 ${frac * 100}%` }}><Playlist /></div>}
              {ui.playlist && <div className="ms-split" role="separator" aria-orientation="horizontal" aria-label="Resize the playlist" title="Drag to resize" onPointerDown={splitDown} />}
              <div className="ms-bottom">{bottom}</div>
            </div>
          </div>
          <ParamPanels />
          {confirm && <ConfirmDialog pending={confirm} onDone={() => setConfirm(null)} />}
        </div>
      </ActionsContext.Provider>
    </StudioContext.Provider>
  );
}
