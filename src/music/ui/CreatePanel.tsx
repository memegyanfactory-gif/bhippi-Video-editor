// The Studio's Create panel: Suno-style song making. Describe the song (or pick a genre), choose
// sung or instrumental, paste lyrics or let a model (or Bhippi AI) write them, and get mastered
// takes with their beat grid. "Score for video" reads the composition's voice-over and writes a bed
// that sits under it, placed on the timeline ducked under every phrase. It runs music_create_song
// through the app (events.ts), so the panel and the AI make exactly the same songs.
import { useEffect, useMemo, useRef, useState } from 'react';
import { AudioLines, Bot, Clapperboard, ListPlus, Loader2, Mic, Pause, Play, RotateCcw, Sparkles, Trash2, Wand2 } from 'lucide-react';
import { fileSrc } from '../../lib/ipc';
import type { History } from '../../lib/history';
import type { Project } from '../../lib/types';
import { GENRES, type Vocals } from '../create/brief';
import { askMusicAi, onCreateProgress, requestCreate } from '../create/events';
import type { EngineInfo } from '../create/run';
import { musicEngines, placeTake, takeInStudio, voiceOf } from '../create/tool';
import { describeVoice, type VoiceBrief } from '../create/voice';
import type { SongTake } from '../types';
import { useActions, useStudio } from './ctx';
import { TitleBar } from './Window';

type Mode = 'song' | 'score';
type Draft = { mode: Mode; prompt: string; genre: string | null; vocals: Vocals; lyrics: string; auto: boolean; seconds: number; engine: string; takes: number };
// The draft outlives closing the panel, like a half-written message.
let draft: Draft = { mode: 'song', prompt: '', genre: null, vocals: 'none', lyrics: '', auto: true, seconds: 120, engine: 'auto', takes: 1 };

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const VOCAL_CHOICES: { id: Vocals; label: string }[] = [{ id: 'none', label: 'Instrumental' }, { id: 'female', label: 'Female' }, { id: 'male', label: 'Male' }, { id: 'duet', label: 'Duet' }];

export function CreatePanel({ project, history, onClose }: { project: Project; history: History; onClose: () => void }) {
  const { song, assets } = useStudio();
  const act = useActions();
  const [form, setForm] = useState<Draft>(draft);
  const [engines, setEngines] = useState<EngineInfo[] | null>(null);
  const [voice, setVoice] = useState<VoiceBrief | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [openLyrics, setOpenLyrics] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const set = (patch: Partial<Draft>) => setForm((f) => { const next = { ...f, ...patch }; draft = next; return next; });

  const comp = project.comps.find((c) => c.id === project.activeCompId) ?? null;
  useEffect(() => { void musicEngines().then(setEngines).catch(() => setEngines([])); }, []);
  // What the voice-over asks for, from the levels and any transcript already made (no new transcription here).
  useEffect(() => {
    let live = true;
    if (!comp) { setVoice(null); return; }
    void voiceOf(comp, assets, false).then((v) => { if (live) setVoice(v); }).catch(() => { if (live) setVoice(null); });
    return () => { live = false; };
  }, [comp?.id, comp?.clips.length, assets]);
  useEffect(() => onCreateProgress(setProgress), []);
  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    const id = window.setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [busy]);
  useEffect(() => () => { audio.current?.pause(); }, []);

  const takes = song.takes ?? [];
  const ready = (engines ?? []).filter((e) => e.ready);
  const sung = form.mode === 'song' && form.vocals !== 'none';
  const chosen = form.engine === 'auto' ? null : (engines ?? []).find((e) => e.id === form.engine) ?? null;
  const writer = chosen ? chosen.writesLyrics : ready.some((e) => e.writesLyrics);
  const needsWriter = sung && !form.lyrics.trim() && !writer;
  const autoLength = form.mode === 'score' && voice ? Math.round(voice.end + 2.5) : null;
  const canCreate = !busy && (!!form.prompt.trim() || !!form.genre || !!form.lyrics.trim());

  const describe = (f: Draft) => {
    const genre = f.genre ? GENRES.find((g) => g.id === f.genre)?.name : null;
    return [f.prompt.trim(), genre ? `Genre: ${genre}.` : ''].filter(Boolean).join(' ');
  };

  const create = async () => {
    if (!canCreate) return;
    setError(null);
    if (needsWriter) {
      // ACE-Step sings only the words it is given: Bhippi AI writes them, then makes the song.
      askMusicAi(`Make a song in the Music Studio: ${describe(form) || 'surprise me'}. ${form.vocals === 'duet' ? 'Male and female duet' : `${form.vocals === 'male' ? 'Male' : 'Female'} vocals`}. Write original, singable lyrics first ([Verse] / [Chorus] / [Bridge] tags, 6–10 syllables a line${form.auto ? '' : `, sized for about ${form.seconds} seconds`}), then call music_create_song with them${form.genre ? ` and genre "${form.genre}"` : ''}, purpose "song", vocals "${form.vocals}"${form.engine !== 'auto' ? `, engine "${form.engine}"` : ''}${form.takes > 1 ? `, takes ${form.takes}` : ''}.`);
      act.toast({ tone: 'info', title: 'Bhippi AI is writing the lyrics', body: 'Then it makes the song; the takes appear here.' });
      return;
    }
    setBusy(true);
    setElapsed(0);
    setProgress('Writing the brief');
    const result = await requestCreate({
      prompt: describe(form) || form.genre || 'song', genre: form.genre ?? undefined, purpose: form.mode, vocals: form.mode === 'score' ? 'none' : form.vocals,
      lyrics: sung && form.lyrics.trim() ? form.lyrics : undefined, seconds: form.auto ? undefined : form.seconds, engine: form.engine, takes: form.takes,
      fitVoice: form.mode === 'score', place: form.mode === 'score' && !!comp, useInStudio: true,
    });
    setBusy(false);
    setProgress('');
    if (!result.ok) { setError(result.error ?? 'The song could not be made.'); return; }
    act.toast({ tone: 'success', title: form.mode === 'score' ? 'Score made and placed' : 'Song made', body: result.summary?.slice(0, 160) });
  };

  const askAi = () => {
    const text = `Make ${form.mode === 'score' ? 'background music for this video that supports the voice-over' : 'a song'} in the Music Studio with music_create_song${describe(form) ? `: ${describe(form)}` : ''}. Understand what I want, pick the genre, mood and tempo, write lyrics if it is sung, and tell me what you made.`;
    askMusicAi(text);
    act.toast({ tone: 'info', title: 'Sent to Bhippi AI', body: 'It plans the song and makes it; takes appear here.' });
  };

  const play = (take: SongTake) => {
    const asset = assets.get(take.assetId);
    if (!asset) return;
    if (playing === take.id) { audio.current?.pause(); setPlaying(null); return; }
    act.stop();
    audio.current?.pause();
    const el = new Audio(fileSrc(asset.path));
    el.onended = () => setPlaying(null);
    audio.current = el;
    void el.play().then(() => setPlaying(take.id)).catch(() => setPlaying(null));
  };

  const toTimeline = (take: SongTake) => {
    const compId = history.current().activeCompId;
    if (!compId) { act.toast({ tone: 'info', title: 'No timeline to place it on', body: 'Open or make a composition first.' }); return; }
    history.commit((now) => placeTake(now, compId, take, take.purpose === 'score' ? voice ?? null : null).project, 'Music: place take on timeline');
    act.toast({ tone: 'success', title: 'On the timeline', body: take.purpose === 'score' && voice ? 'On the Music track, ducked under the voice-over.' : 'On the Music track, faded in and out.' });
  };

  const reuse = (take: SongTake) => set({ prompt: take.prompt, mode: take.purpose, vocals: take.instrumental ? 'none' : form.vocals === 'none' ? 'female' : form.vocals, lyrics: take.lyrics ?? form.lyrics });

  const engineOptions = useMemo(() => engines ?? [], [engines]);

  return (
    <aside className="ms-win ms-create" aria-label="Create a song">
      <TitleBar icon={<Sparkles size={13} />} title="Create" onClose={onClose} closeLabel="Close Create" />
      <div className="ms-create-body">
        <div className="ms-seg ms-create-mode" role="group" aria-label="What to make">
          <button type="button" className={form.mode === 'song' ? 'on' : ''} aria-pressed={form.mode === 'song'} onClick={() => set({ mode: 'song' })}><AudioLines size={12} />Song</button>
          <button type="button" className={form.mode === 'score' ? 'on' : ''} aria-pressed={form.mode === 'score'} onClick={() => set({ mode: 'score' })}><Clapperboard size={12} />Score for video</button>
        </div>

        {form.mode === 'score' && (
          <p className={`ms-create-voice${voice ? '' : ' none'}`}>
            <Mic size={12} />
            <span>{voice === undefined ? 'Listening to the voice-over…' : voice ? `${describeVoice(voice)}. The bed fits it and ducks under every phrase.` : comp ? 'No voice-over on this timeline: the score follows your description and the video length.' : 'Open a composition to fit the music to its voice-over.'}</span>
          </p>
        )}

        <label className="ms-create-label" htmlFor="ms-create-prompt">Describe it</label>
        <textarea
          id="ms-create-prompt" className="ms-input ms-create-text" rows={3} value={form.prompt} maxLength={1500}
          placeholder={form.mode === 'score' ? 'Warm, hopeful piano and soft strings for a startup story…' : 'A summer pop anthem about road trips, bright guitars, big chorus…'}
          onChange={(e) => set({ prompt: e.target.value })} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void create(); }} onKeyUp={(e) => e.stopPropagation()}
        />

        <div className="ms-create-genres" role="group" aria-label="Genre">
          {GENRES.map((g) => (
            <button key={g.id} type="button" className={`ms-create-genre${form.genre === g.id ? ' on' : ''}`} aria-pressed={form.genre === g.id} title={g.tags.join(', ')} onClick={() => set({ genre: form.genre === g.id ? null : g.id })}>{g.name}</button>
          ))}
        </div>

        {form.mode === 'song' && (
          <>
            <div className="ms-seg ms-create-vocals" role="group" aria-label="Vocals">
              {VOCAL_CHOICES.map((v) => <button key={v.id} type="button" className={form.vocals === v.id ? 'on' : ''} aria-pressed={form.vocals === v.id} onClick={() => set({ vocals: v.id })}>{v.label}</button>)}
            </div>
            {sung && (
              <>
                <label className="ms-create-label" htmlFor="ms-create-lyrics">Lyrics <em>{writer ? 'optional — the model writes them if empty' : 'Bhippi AI writes them if empty'}</em></label>
                <textarea
                  id="ms-create-lyrics" className="ms-input ms-create-text mono" rows={6} value={form.lyrics} maxLength={3400}
                  placeholder={'[Verse]\nLines to sing, 6–10 syllables each\n\n[Chorus]\nThe hook, repeated'}
                  onChange={(e) => set({ lyrics: e.target.value })} onKeyDown={(e) => e.stopPropagation()} onKeyUp={(e) => e.stopPropagation()}
                />
              </>
            )}
          </>
        )}

        <div className="ms-create-row">
          <label className="ms-create-check"><input type="checkbox" checked={form.auto} onChange={(e) => set({ auto: e.target.checked })} />{form.mode === 'score' ? `Fit the video${autoLength ? ` (${mmss(autoLength)})` : ''}` : 'Auto length'}</label>
          {!form.auto && (
            <label className="ms-create-len">
              <input type="range" min={15} max={300} step={5} value={form.seconds} aria-label="Length in seconds" onChange={(e) => set({ seconds: Number(e.target.value) })} />
              <span className="ms-chip lcd">{mmss(form.seconds)}</span>
            </label>
          )}
        </div>

        <div className="ms-create-row">
          <label className="ms-create-field">Engine
            <select value={form.engine} onChange={(e) => set({ engine: e.target.value })} aria-label="Music engine">
              <option value="auto">Auto · best ready</option>
              {engineOptions.map((e) => <option key={e.id} value={e.id} disabled={!e.ready} title={e.ready ? e.note : e.reason ?? ''}>{e.label}{e.ready ? '' : ' — not set up'}</option>)}
            </select>
          </label>
          <label className="ms-create-field">Takes
            <select value={form.takes} onChange={(e) => set({ takes: Number(e.target.value) })} aria-label="Takes">
              {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>
        {engines && !ready.some((e) => e.id !== 'studio') && (
          <p className="ms-create-hint">Only the Studio synths are ready. For real produced songs, download ACE-Step 1.5 in Settings → Model Library, or add an ElevenLabs or fal key.</p>
        )}

        <div className="ms-create-actions">
          <button type="button" className="ms-btn ms-primary ms-create-go" disabled={!canCreate} onClick={() => void create()} title="Make the song (Ctrl+Enter)">
            {busy ? <Loader2 size={14} className="ms-spin" /> : needsWriter ? <Bot size={14} /> : <Wand2 size={14} />}
            {busy ? `Creating… ${mmss(elapsed)}` : needsWriter ? 'Write lyrics & create' : form.mode === 'score' ? 'Create score' : 'Create song'}
          </button>
          <button type="button" className="ms-btn" disabled={busy} onClick={askAi} title="Let Bhippi AI plan and make it from your description"><Bot size={13} />Ask AI</button>
        </div>
        {busy && <p className="ms-create-progress" role="status">{progress || 'Working…'}</p>}
        {error && <p className="ms-create-error" role="alert">{error}</p>}

        <h4 className="ms-create-h">Takes <em>{takes.length}</em></h4>
        {!takes.length && <p className="ms-bempty"><AudioLines size={13} /><span>Songs you create appear here, mastered and ready for the timeline.</span></p>}
        <ul className="ms-create-takes">
          {takes.map((take) => {
            const missing = !assets.get(take.assetId);
            return (
              <li key={take.id} className={`ms-take${playing === take.id ? ' playing' : ''}`}>
                <button type="button" className="ms-icon ms-icon-lg" disabled={missing} aria-label={playing === take.id ? `Pause ${take.title}` : `Play ${take.title}`} onClick={() => play(take)}>{playing === take.id ? <Pause size={14} /> : <Play size={14} />}</button>
                <div className="ms-take-info">
                  <strong title={take.prompt}>{take.title}</strong>
                  <span>{take.summary.replace(/ · \d+:\d+ · /, ' · ')} · {mmss(take.seconds)}</span>
                  <span className="ms-dim">{take.engineLabel} · {take.lufs} LUFS{missing ? ' · file missing' : ''}</span>
                  {take.lyrics && <button type="button" className="ms-take-lyr" onClick={() => setOpenLyrics(openLyrics === take.id ? null : take.id)}>{openLyrics === take.id ? 'Hide lyrics' : 'Lyrics'}</button>}
                  {openLyrics === take.id && <pre className="ms-take-lyrics">{take.lyrics}</pre>}
                </div>
                <div className="ms-take-acts">
                  <button type="button" className="ms-icon" disabled={missing} title="Place on the video timeline" aria-label="Place on the timeline" onClick={() => toTimeline(take)}><Clapperboard size={13} /></button>
                  <button type="button" className="ms-icon" disabled={missing} title="Add to the Studio playlist (sets the tempo to the take)" aria-label="Add to the playlist" onClick={() => act.edit((s) => takeInStudio(s, take), `add take ${take.title}`)}><ListPlus size={13} /></button>
                  <button type="button" className="ms-icon" title="Reuse this prompt" aria-label="Reuse this prompt" onClick={() => reuse(take)}><RotateCcw size={13} /></button>
                  <button type="button" className="ms-icon" title="Remove from the takes (the file stays in the bin)" aria-label="Remove take" onClick={() => act.edit((s) => ({ ...s, takes: (s.takes ?? []).filter((t) => t.id !== take.id) }), 'remove take')}><Trash2 size={13} /></button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}
