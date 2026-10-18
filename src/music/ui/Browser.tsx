// The Music Studio's left Browser: instruments, channel presets by category, drum grooves, song
// templates and the project's audio. Click adds (or writes); hovering auditions through the engine;
// bin audio can be dragged onto the Playlist as an audio clip.
import { createElement, useMemo, useRef, useState, type ReactNode } from 'react';
import { AudioLines, ChevronRight, Drum, FileAudio, Layers, LayoutTemplate, Library, Music2, PanelLeftClose, Search, Sparkles, X } from 'lucide-react';
import { INSTRUMENT_SPECS, type Channel, type DrumPiece, type InstrumentType } from '../types';
import { DEFAULT_DRUM_KEYS, newChannel } from '../model';
import { CHANNEL_PRESETS, GROOVES, SONG_TEMPLATE_LIST, presetChannel, songFromTemplate } from '../templates';
import { useActions, useStudio } from './ctx';
import { instrumentIcon } from './icons';
import { TitleBar } from './Window';
import { applyGroove, withChannel } from './ops';

export const ASSET_DRAG = 'application/x-ms-asset';
const DRUM_PIECES = Object.keys(DEFAULT_DRUM_KEYS) as DrumPiece[];
const INSTRUMENTS = (Object.keys(INSTRUMENT_SPECS) as InstrumentType[]).filter((t) => t !== 'drum');
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Section({ title, icon, count, open, children }: { title: string; icon: ReactNode; count?: number; open?: boolean; children: ReactNode }) {
  return (
    <details className="ms-bsec" open={open}>
      <summary><ChevronRight size={11} className="ms-bsec-chev" />{icon}<span>{title}</span>{count !== undefined && <em>{count}</em>}</summary>
      <div className="ms-bsec-body">{children}</div>
    </details>
  );
}

function Empty({ icon, text }: { icon: ReactNode; text: string }) {
  return <p className="ms-bempty">{icon}<span>{text}</span></p>;
}

export function Browser() {
  const { song, assets } = useStudio();
  const act = useActions();
  const [query, setQuery] = useState('');
  const hover = useRef(0);
  const q = query.trim().toLowerCase();
  const match = (...parts: (string | undefined)[]) => !q || parts.some((p) => p?.toLowerCase().includes(q));

  const audition = (channel: Channel | null, key?: number) => {
    window.clearTimeout(hover.current);
    if (channel) hover.current = window.setTimeout(() => act.previewChannel(channel, key), 160);
  };
  const stopAudition = () => window.clearTimeout(hover.current);

  const presets = useMemo(() => {
    const map = new Map<string, typeof CHANNEL_PRESETS>();
    for (const p of CHANNEL_PRESETS) map.set(p.category, [...(map.get(p.category) ?? []), p]);
    return [...map.entries()];
  }, []);
  const audio = [...assets.values()].filter((a) => a.kind === 'audio' && !a.missing);

  const addInstrument = (instrument: InstrumentType, drum?: DrumPiece) => act.edit((s) => withChannel(s, newChannel(s, instrument, drum ? { drum } : {})), `add ${drum ?? INSTRUMENT_SPECS[instrument].label}`);
  const addPreset = (id: string, name: string) => act.edit((s) => { const c = presetChannel(s, id); return c ? withChannel(s, c) : s; }, `add ${name}`);
  const useTemplate = async (id: string, name: string) => {
    const filled = song.channels.length > 0 || song.playlist.clips.length > 0;
    if (filled && !(await act.confirm({ title: `Start from "${name}"?`, body: 'This replaces the current song (channels, patterns, playlist and mixer). You can undo it.', ok: 'Replace song' }))) return;
    act.edit((s) => songFromTemplate(id, { name: s.name }), `template ${name}`);
  };

  return (
    <aside className="ms-browser ms-win" aria-label="Browser">
      <TitleBar icon={<Library size={13} />} title="Browser">
        <button type="button" className="ms-win-btn" aria-label="Hide the browser" title="Hide the browser" onClick={() => act.setUi({ browser: false })}><PanelLeftClose size={13} /></button>
      </TitleBar>
      <label className="ms-bsearch"><Search size={13} /><input type="search" placeholder="Search sounds…" aria-label="Search the browser" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />{query && <button type="button" className="ms-win-btn" aria-label="Clear search" onClick={() => setQuery('')}><X size={11} /></button>}</label>
      <div className="ms-bscroll">
        <Section title="Instruments" icon={<Music2 size={13} />} count={INSTRUMENTS.length + DRUM_PIECES.length} open>
          {INSTRUMENTS.filter((t) => match(INSTRUMENT_SPECS[t].label, t)).map((t) => (
            <button key={t} type="button" className="ms-bitem" title={INSTRUMENT_SPECS[t].about} onClick={() => addInstrument(t)}
              onPointerEnter={() => audition(newChannel({ ...song, channels: [] }, t, { insert: 0 }))} onPointerLeave={stopAudition}>
              {createElement(instrumentIcon(t), { size: 12 })}<span>{INSTRUMENT_SPECS[t].label}</span>
            </button>
          ))}
          {DRUM_PIECES.filter((d) => match(d, 'drum')).map((d) => (
            <button key={d} type="button" className="ms-bitem" title={`Drum Synth — ${d}`} onClick={() => addInstrument('drum', d)}
              onPointerEnter={() => audition(newChannel({ ...song, channels: [] }, 'drum', { drum: d, insert: 0 }), DEFAULT_DRUM_KEYS[d])} onPointerLeave={stopAudition}>
              <Drum size={12} /><span>{cap(d)}</span>
            </button>
          ))}
        </Section>

        <Section title="Presets" icon={<Sparkles size={13} />} count={CHANNEL_PRESETS.length}>
          {q && !CHANNEL_PRESETS.some((p) => match(p.name, p.category, p.about)) && <Empty icon={<Search size={14} />} text="No preset matches that search." />}
          {presets.map(([category, list]) => {
            const shown = list.filter((p) => match(p.name, p.category, p.about));
            return shown.length ? (
              <div key={category} className="ms-bgroup">
                <h5>{category}</h5>
                {shown.map((p) => (
                  <button key={p.id} type="button" className="ms-bitem" title={p.about ?? p.name} onClick={() => addPreset(p.id, p.name)}
                    onPointerEnter={() => audition(presetChannel({ ...song, channels: [] }, p.id), p.drum ? DEFAULT_DRUM_KEYS[p.drum] : undefined)} onPointerLeave={stopAudition}>
                    <Sparkles size={11} /><span>{p.name}</span>
                  </button>
                ))}
              </div>
            ) : null;
          })}
        </Section>

        <Section title="Grooves" icon={<AudioLines size={13} />} count={GROOVES.length}>
          {GROOVES.filter((g) => match(g.name, g.about)).map((g) => (
            <button key={g.id} type="button" className="ms-bitem" title={`${g.about} — writes drums into the selected pattern`} onClick={() => act.edit((s) => applyGroove(s, g.parts), `groove ${g.name}`)}>
              <AudioLines size={12} /><span>{g.name}</span>
            </button>
          ))}
        </Section>

        <Section title="Song templates" icon={<LayoutTemplate size={13} />} count={SONG_TEMPLATE_LIST.length}>
          {SONG_TEMPLATE_LIST.filter((t) => match(t.name, t.about)).map((t) => (
            <button key={t.id} type="button" className="ms-bitem" title={t.about} onClick={() => void useTemplate(t.id, t.name)}>
              <Layers size={12} /><span>{t.name}</span>
            </button>
          ))}
        </Section>

        <Section title="Project audio" icon={<FileAudio size={13} />} count={audio.length}>
          {audio.length === 0 && <Empty icon={<FileAudio size={16} />} text="No audio in the bin yet. Import a sample in the video editor, then click it here to make a sampler channel or drag it onto the Playlist." />}
          {audio.filter((a) => match(a.name)).map((a) => (
            <button
              key={a.id} type="button" className="ms-bitem" draggable title={`${a.name} — click: sampler channel · drag: playlist audio clip`}
              onDragStart={(e) => { e.dataTransfer.setData(ASSET_DRAG, a.id); e.dataTransfer.effectAllowed = 'copy'; }}
              onClick={() => act.edit((s) => withChannel(s, newChannel(s, 'sampler', { name: a.name.replace(/\.[^.]+$/, ''), sampleAssetId: a.id })), `sampler ${a.name}`)}
            >
              <FileAudio size={12} /><span>{a.name}</span>
            </button>
          ))}
        </Section>
      </div>
    </aside>
  );
}
