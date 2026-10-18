// The studio's shortcuts: Space plays, L flips PAT/SONG, F5/F6/F7/F9 open windows, and the QWERTY
// rows play the selected channel. Key presses stay inside the studio so the app's own single-key
// shortcuts do not run under it; Ctrl combos (undo / redo) are left for the app.
import { useCallback, useEffect, useRef, type KeyboardEvent } from 'react';
import type { MusicEngineApi } from '../engine/api';
import type { Actions } from './ctx';
import type { Channel, MusicProject } from '../types';
import { pianoKey } from './piano';
import { typingTarget } from './studioUtil';

type Held = { channelId: string; key: number };

export function useShortcuts(engine: MusicEngineApi, actions: Actions, channel: Channel | null, song: MusicProject, playlistOpen: boolean) {
  const held = useRef<Record<string, Held | undefined>>({});
  const latest = useRef({ channel, song, actions, playlistOpen });
  latest.current = { channel, song, actions, playlistOpen };

  const letGo = useCallback(() => {
    for (const note of Object.values(held.current)) if (note) engine.liveNoteOff(note.channelId, note.key);
    held.current = {};
  }, [engine]);
  useEffect(() => {
    window.addEventListener('blur', letGo);
    return () => { window.removeEventListener('blur', letGo); letGo(); };
  }, [letGo]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (typingTarget(e.target)) { e.stopPropagation(); return; }
    if (e.ctrlKey || e.metaKey) return;
    const { channel: target, song: s, actions: act, playlistOpen: pl } = latest.current;
    const k = e.key;
    const mine = () => { e.preventDefault(); e.stopPropagation(); };
    if (k === ' ') { mine(); if (!e.repeat) act.toggle(); return; }
    if (k === 'F5') { mine(); act.setUi({ playlist: !pl }); return; }
    if (k === 'F6') { mine(); act.setUi({ win: 'rack' }); return; }
    if (k === 'F7') { mine(); act.setUi({ win: 'pianoroll' }); return; }
    if (k === 'F9') { mine(); act.setUi({ win: 'mixer' }); return; }
    if (k.toLowerCase() === 'l' && !e.altKey) {
      mine();
      act.setView({ mode: s.view.mode === 'song' ? 'pattern' : 'song' });
      act.stop();
      return;
    }
    const semi = e.altKey ? null : pianoKey(e.code);
    if (semi !== null) {
      mine();
      if (!target || e.repeat || held.current[e.code]) return;
      const key = target.drum ? target.rootKey : semi;
      held.current[e.code] = { channelId: target.id, key };
      engine.liveNoteOn(target.id, key, 0.8);
      return;
    }
    if (k !== 'Escape') e.stopPropagation();
  };

  const onKeyUp = (e: KeyboardEvent) => {
    const note = held.current[e.code];
    if (note) { engine.liveNoteOff(note.channelId, note.key); held.current[e.code] = undefined; }
    if (e.key === ' ' && !typingTarget(e.target)) { e.preventDefault(); e.stopPropagation(); }
  };

  return { onKeyDown, onKeyUp };
}
