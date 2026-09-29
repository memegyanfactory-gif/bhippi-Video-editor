// Transcription panel: what is said, as text you can read, click to jump to, copy or save. Click a
// word to correct it (saved to the transcript, and fixed in the captions already made); on the
// timeline view, Ctrl+click words (Shift+click for a run) and Delete cuts them, and their pause, out.
//
// Two views. "Timeline" is the edit as it plays — every audio clip's slice of its source, at its
// place on the timeline (the captions' own mapping). A source file shows its whole recording.
// Transcripts come from the cache transcribe.rs keeps; nothing is transcribed until asked.

import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import { Copy, Download, FileText, LoaderCircle, RefreshCw, Scissors } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useToast } from '../components/ui';
import { copyText } from '../lib/clipboard';
import { timecode } from '../lib/editor';
import { api, errorText, type Transcript } from '../lib/ipc';
import { playhead } from '../lib/playhead';
import { assetsToTranscribe } from '../lib/subtitlesEngine';
import type { AssetMap } from '../lib/timeline';
import { cutRangesForWords, formatTranscript, timelineWords, toLines, transcriptFileName, withoutSoloSpeaker } from '../lib/transcriptText';
import type { Comp, Project } from '../lib/types';

type Props = {
  project: Project;
  comp: Comp | undefined;
  assets: AssetMap;
  /** Changes whenever a transcription job finishes anywhere (the AI's included), to reload. */
  refreshKey: string;
  /** Text-based editing: cut these timeline ranges out of the comp (extract, all unlocked tracks), latest first. */
  onCutRanges?: (ranges: { start: number; end: number }[], words: number) => void;
  /** A word corrected on the timeline view: fix it in the captions on screen at `at` (timeline seconds). */
  onWordCorrected?: (at: number, from: string, to: string) => void;
};

const TIMELINE = 'timeline';

export function TranscriptPanel({ project, comp, assets, refreshKey, onCutRanges, onWordCorrected }: Props) {
  const toast = useToast();
  const [transcripts, setTranscripts] = useState<Map<string, Transcript>>(new Map());
  const [view, setView] = useState<string>(TIMELINE);
  const [timestamps, setTimestamps] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  // Every file in the project that has sound: what the panel can show or transcribe.
  const withSound = useMemo(
    () => project.media.map((ref) => assets.get(ref.assetId)).filter((asset): asset is NonNullable<typeof asset> => !!asset && asset.hasAudio && !asset.missing),
    [project.media, assets],
  );
  const ids = useMemo(() => withSound.map((asset) => asset.id).join(','), [withSound]);

  const reload = useCallback(async () => {
    if (!ids) return setTranscripts(new Map());
    try {
      const found = await api.transcriptsCached(ids.split(','));
      setTranscripts(new Map(found.map((transcript) => [transcript.assetId, transcript])));
    } catch (error) {
      toast({ tone: 'error', title: 'Could not read transcripts', body: errorText(error) });
    }
  }, [ids, toast]);
  useEffect(() => { void reload(); }, [reload, refreshKey]);

  const isTimeline = view === TIMELINE;
  const source = isTimeline ? null : withSound.find((asset) => asset.id === view) ?? null;
  // A source that left the project falls back to the timeline view.
  useEffect(() => { if (!isTimeline && !source) setView(TIMELINE); }, [isTimeline, source]);

  const shownWords = useMemo(() => {
    const words = isTimeline ? (comp ? timelineWords(comp, assets, transcripts) : []) : (source ? transcripts.get(source.id)?.words ?? [] : []);
    return withoutSoloSpeaker(words);
  }, [isTimeline, comp, assets, transcripts, source]);
  const lines = useMemo(() => toLines(shownWords), [shownWords]);

  // Text-based editing (timeline view): the chosen words, by their place in `shownWords`.
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [anchor, setAnchor] = useState<number | null>(null);
  useEffect(() => { setPicked(new Set()); setAnchor(null); }, [shownWords]);
  const pickWord = (index: number, extend: boolean) => {
    if (extend && anchor !== null) {
      const [from, to] = anchor < index ? [anchor, index] : [index, anchor];
      setPicked(new Set(Array.from({ length: to - from + 1 }, (_, i) => from + i)));
    } else {
      // Ctrl+click adds or removes one word from the pick.
      setPicked((current) => { const next = new Set(current); if (next.has(index)) next.delete(index); else next.add(index); return next; });
      setAnchor(index);
    }
    playhead.seek(shownWords[index].start);
  };

  // Corrections: a click opens the word for typing; Enter or leaving saves it, Esc drops it,
  // Tab saves and moves on to the next word (Shift+Tab the previous).
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  useEffect(() => { setEditing(null); }, [shownWords]);
  const startEdit = (index: number) => {
    setEditing(index);
    setDraft(shownWords[index].text.trim());
    setPicked(new Set());
    if (isTimeline) playhead.seek(shownWords[index].start);
  };
  const saveEdit = async (index: number, text: string) => {
    const word = shownWords[index];
    const next = text.trim().replace(/\s+/g, ' ');
    if (!word || next === word.text.trim()) return;
    const origin = word.origin ?? (source ? { assetId: source.id, start: word.start, end: word.end } : null);
    if (!origin) {
      toast({ tone: 'error', title: 'Could not correct that word', body: 'It is not linked to a transcribed file.' });
      return;
    }
    try {
      const saved = await api.transcriptEditWords(origin.assetId, [{ start: origin.start, end: origin.end, text: next }]);
      setTranscripts((current) => new Map(current).set(saved.assetId, saved));
      if (isTimeline) onWordCorrected?.((word.start + word.end) / 2, word.text.trim(), next);
    } catch (error) {
      toast({ tone: 'error', title: 'Could not save the correction', body: errorText(error) });
    }
  };
  const finishEdit = (move: -1 | 0 | 1) => {
    if (editing === null) return;
    const index = editing;
    const text = draft;
    setEditing(null);
    void saveEdit(index, text);
    const target = index + move;
    if (move && target >= 0 && target < shownWords.length) startEdit(target);
  };
  const correctable = isTimeline ? shownWords.some((word) => word.origin) : !!source && transcripts.has(source.id);
  const cutPicked = () => {
    if (!picked.size || !onCutRanges) return;
    onCutRanges(cutRangesForWords(shownWords, picked), picked.size);
    setPicked(new Set());
  };
  const editable = isTimeline && !!onCutRanges;

  // Files the edit uses only as music or effects are not speech: never nag to transcribe those.
  const missing = useMemo(() => {
    if (!isTimeline) return source && !transcripts.has(source.id) ? [source] : [];
    if (!comp) return [];
    const speech = (assetId: string) => comp.clips.some((clip) => clip.source.type === 'media' && clip.source.assetId === assetId && clip.audioType !== 'music' && clip.audioType !== 'sfx');
    return assetsToTranscribe(comp, assets).filter((asset) => !transcripts.has(asset.id) && speech(asset.id));
  }, [isTimeline, comp, assets, source, transcripts]);
  const fps = comp?.fps ?? 30;
  const title = isTimeline ? `${comp?.name ?? 'Timeline'} (timeline)` : source?.name ?? 'Transcript';

  const transcribe = async () => {
    for (const asset of missing) {
      setBusy(asset.name);
      try {
        await api.transcribeAsset(asset.id, 'auto');
      } catch (error) {
        toast({ tone: 'error', title: `Could not transcribe ${asset.name}`, body: errorText(error) });
        break;
      }
    }
    setBusy(null);
    await reload();
  };

  const text = () => formatTranscript(lines, { timestamps, fps, title });
  const copy = async () => {
    const ok = await copyText(text());
    toast(ok ? { tone: 'success', title: 'Transcript copied', timeout: 2000 } : { tone: 'error', title: 'Could not copy the transcript' });
  };
  const download = async () => {
    const path = await saveDialog({ title: 'Save transcript', defaultPath: transcriptFileName(isTimeline ? comp?.name ?? 'timeline' : source?.name.replace(/\.[^.]+$/, '') ?? 'transcript'), filters: [{ name: 'Text', extensions: ['txt'] }] });
    if (!path) return;
    try {
      await api.fsWriteFile(path, text(), true);
      toast({ tone: 'success', title: 'Transcript saved', body: path, timeout: 3000 });
    } catch (error) {
      toast({ tone: 'error', title: 'Could not save the transcript', body: errorText(error) });
    }
  };

  const empty = lines.length === 0;
  return (
    <div className="transcript-panel">
      <div className="transcript-bar">
        <select value={view} onChange={(event) => setView(event.target.value)} aria-label="Transcript to show" title="What to show">
          <option value={TIMELINE}>Timeline{comp ? ` · ${comp.name}` : ''}</option>
          {withSound.map((asset) => (
            <option key={asset.id} value={asset.id}>{asset.name}{transcripts.has(asset.id) ? '' : ' (not transcribed)'}</option>
          ))}
        </select>
        <label className="transcript-toggle" title="Include timecodes when copying or saving">
          <input type="checkbox" checked={timestamps} onChange={(event) => setTimestamps(event.target.checked)} /> Timecodes
        </label>
        <div className="toolbar-spacer" />
        {editable && (
          <button type="button" className="btn btn-small" onClick={cutPicked} disabled={!picked.size} title="Cut the selected words (and the pause after them) out of the edit — Delete">
            <Scissors size={12} /> Cut{picked.size ? ` ${picked.size} word${picked.size === 1 ? '' : 's'}` : ''}
          </button>
        )}
        <button type="button" className="icon-btn small" onClick={() => void reload()} title="Reload transcripts"><RefreshCw size={13} /></button>
        <button type="button" className="icon-btn small" onClick={() => void copy()} disabled={empty} title="Copy as text"><Copy size={13} /></button>
        <button type="button" className="icon-btn small" onClick={() => void download()} disabled={empty} title="Download as .txt"><Download size={13} /></button>
      </div>

      {missing.length > 0 && (
        <div className="transcript-missing">
          <span>{busy ? `Transcribing ${busy}…` : `${missing.length === 1 ? missing[0].name : `${missing.length} files`} ${missing.length === 1 ? 'is' : 'are'} not transcribed yet.`}</span>
          <button type="button" className="btn btn-small" onClick={() => void transcribe()} disabled={!!busy}>
            {busy ? <LoaderCircle size={12} className="spin" /> : null} Transcribe
          </button>
        </div>
      )}

      <div className="transcript-body" role="list" tabIndex={editable ? 0 : undefined}
        onKeyDown={(event) => {
          if (!editable || !picked.size) return;
          if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); event.stopPropagation(); cutPicked(); }
          if (event.key === 'Escape') { event.stopPropagation(); setPicked(new Set()); }
        }}>
        {empty ? (
          <div className="transcript-empty">
            <FileText size={22} />
            <span>{isTimeline ? 'No speech on this timeline has been transcribed yet.' : 'This file has not been transcribed yet.'}</span>
          </div>
        ) : (
          lines.map((line, index) => (
            <div key={`${line.start}-${index}`} className="transcript-line" role="listitem">
              {isTimeline ? (
                <button type="button" className="transcript-time" onClick={() => playhead.seek(line.start)} title="Go to this point">{timecode(line.start, fps)}</button>
              ) : (
                <span className="transcript-time static">{timecode(line.start, fps)}</span>
              )}
              <p>
                {line.speaker !== undefined && <strong>Speaker {line.speaker + 1}: </strong>}
                {editable || correctable ? line.words.map((word) => (editing === word.index ? (
                  <span key={word.index}>
                    <input className="transcript-edit" autoFocus value={draft} size={Math.max(3, draft.length + 1)} aria-label="Correct this word" spellCheck
                      onChange={(event) => setDraft(event.target.value)}
                      onBlur={() => finishEdit(0)}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === 'Enter') { event.preventDefault(); finishEdit(0); }
                        else if (event.key === 'Escape') { event.preventDefault(); setEditing(null); }
                        else if (event.key === 'Tab') { event.preventDefault(); finishEdit(event.shiftKey ? -1 : 1); }
                      }} />{' '}
                  </span>
                ) : (
                  <span key={word.index} className={`transcript-word${picked.has(word.index) ? ' picked' : ''}`}
                    title={editable ? 'Click to correct · Ctrl+click to pick for cutting · Shift+click for a run' : 'Click to correct'}
                    onClick={(event) => {
                      if (editable && (event.ctrlKey || event.metaKey)) pickWord(word.index, false);
                      else if (editable && event.shiftKey && anchor !== null) pickWord(word.index, true);
                      else startEdit(word.index);
                    }}>{word.text}{' '}</span>
                ))) : line.text}
              </p>
            </div>
          ))
        )}
      </div>
      {(editable || correctable) && !empty && <div className="transcript-hint">{editable ? 'Click a word to correct it (Enter saves, Tab goes to the next). Ctrl+click words to pick them, Shift+click for a run, then Delete cuts them out of the edit.' : 'Click a word to correct it (Enter saves, Tab goes to the next, an empty word is removed).'}</div>}
      {!empty && <div className="transcript-foot">{lines.length} lines · {transcripts.get(source?.id ?? '')?.provider ?? (isTimeline ? `${transcripts.size} transcribed file${transcripts.size === 1 ? '' : 's'}` : '')}</div>}
    </div>
  );
}
