// The Channel Rack: one row per channel (mute / solo LEDs, name, colour, volume, pan, mixer insert,
// step grid, shortcuts to the piano roll and the instrument panel) plus a velocity lane for the
// selected channel. Steps and piano-roll notes are the same data — a step is a one-step note.
import { memo, useRef, useState } from 'react';
import { MoreHorizontal, Piano, Plus, SlidersHorizontal } from 'lucide-react';
import { INSTRUMENT_SPECS, stepsPerBar, type Channel, type DrumPiece, type InstrumentType, type Note } from '../types';
import { DEFAULT_DRUM_KEYS, ensureInserts, musicId, newChannel, notesOf, patternSteps, removeChannel, setNotes, updateChannel, updatePattern } from '../model';
import { SONG_TEMPLATE_LIST, songFromTemplate } from '../templates';
import { ColorInput, DragNumber, Knob, Menu, type MenuItem } from './Controls';
import { useActions, useStudio } from './ctx';
import { beatSteps, clamp } from './format';
import { cloneChannel, moveChannel, stepOp, withChannel } from './ops';
import { trackPointer } from './studioUtil';

const CELL = 26;
const EMPTY: Note[] = [];
const DRUM_PIECES = Object.keys(DEFAULT_DRUM_KEYS) as DrumPiece[];
const INSTRUMENTS = Object.keys(INSTRUMENT_SPECS).filter((t) => t !== 'drum') as InstrumentType[];

/** Menu items that add a channel (instruments and drum pieces). */
export function addChannelItems(add: (instrument: InstrumentType, drum?: DrumPiece) => void): MenuItem[] {
  return [
    { header: true, label: 'Instruments' },
    ...INSTRUMENTS.map((t) => ({ label: INSTRUMENT_SPECS[t].label, onClick: () => add(t) })),
    { header: true, label: 'Drums' },
    ...DRUM_PIECES.map((d) => ({ label: d.charAt(0).toUpperCase() + d.slice(1), onClick: () => add('drum', d) })),
  ];
}

/** Friendly start for an empty song: add a channel or begin from a template. */
export function EmptyChannels() {
  const act = useActions();
  const add = (instrument: InstrumentType, drum?: DrumPiece) => act.edit((s) => withChannel(s, newChannel(s, instrument, drum ? { drum } : {})), 'add channel');
  return (
    <div className="ms-empty">
      <h3>No channels yet</h3>
      <p>A channel is an instrument or a drum sound. Add one, then click the step grid or open the piano roll to write notes.</p>
      <div className="ms-empty-actions">
        <Menu className="ms-primary" title="Add a channel" trigger={<><Plus size={14} /> Add a channel</>} items={() => addChannelItems(add)} />
        <Menu title="Start from a template" trigger="Start from a template" items={() => SONG_TEMPLATE_LIST.map((t) => ({ label: t.name, hint: t.about, onClick: () => act.edit((s) => songFromTemplate(t.id, { name: s.name }), `template ${t.name}`) }))} />
      </div>
    </div>
  );
}

type RowProps = {
  channel: Channel; notes: Note[]; patternId: string | null; from: number; count: number; selected: boolean; barSteps: number; beat: number; index: number; total: number;
};

const ChannelRow = memo(function ChannelRow({ channel, notes, patternId, from, count, selected, barSteps, beat, index, total }: RowProps) {
  const act = useActions();
  const { edit, drag, settle, setView, setUi, openPanel } = act;
  const [renaming, setRenaming] = useState(false);
  const grid = useRef<HTMLDivElement>(null);
  const patch = (change: (c: Channel) => Channel) => drag((s) => updateChannel(s, channel.id, change));
  const select = () => setView({ selectedChannelId: channel.id });

  const paint = (e: React.PointerEvent) => {
    if (!patternId || !grid.current) return;
    e.preventDefault();
    select();
    const rect = grid.current.getBoundingClientRect();
    const stepAt = (x: number) => from + clamp(Math.floor((x - rect.left) / CELL), 0, count - 1);
    const accent = e.button === 2 || e.shiftKey;
    const first = stepAt(e.clientX);
    const at = (step: number) => (n: Note) => Math.floor(n.start + 1e-6) === step;
    const mode: 'add' | 'remove' | 'accent' = accent ? 'accent' : notes.some(at(first)) ? 'remove' : 'add';
    const touched = new Set<number>([first]);
    const apply = () => drag((s) => {
      let out = notesOf(s.patterns.find((p) => p.id === patternId), channel.id);
      for (const step of touched) {
        const hit = out.filter(at(step));
        if (mode === 'remove') out = out.filter((n) => !hit.includes(n));
        else if (!hit.length) out = [...out, { id: musicId(), key: channel.rootKey, start: step, length: 1, velocity: mode === 'accent' ? 1 : 0.78 }];
        else if (mode === 'accent') out = out.map((n) => (hit.includes(n) ? { ...n, velocity: hit.every((h) => h.velocity >= 0.95) ? 0.78 : 1 } : n));
      }
      return setNotes(s, patternId, channel.id, out);
    });
    apply();
    if (mode !== 'remove') act.engine.previewNote(channel.id, channel.rootKey, mode === 'accent' ? 1 : 0.78, 0.2);
    trackPointer(
      (ev) => {
        const step = stepAt(ev.clientX);
        if (!touched.has(step)) { touched.add(step); apply(); }
      },
      () => settle('Music: steps'),
    );
  };

  const items = (): MenuItem[] => {
    const run = (op: Parameters<typeof stepOp>[4], label: string) => () => patternId && edit((s) => {
      const pattern = s.patterns.find((p) => p.id === patternId);
      return pattern ? stepOp(s, patternId, channel, patternSteps(s, pattern), op) : s;
    }, label);
    return [
      { label: 'Clone channel', onClick: () => edit((s) => cloneChannel(s, channel.id), 'clone channel') },
      { label: 'Move up', disabled: index === 0, onClick: () => edit((s) => moveChannel(s, channel.id, -1), 'move channel') },
      { label: 'Move down', disabled: index === total - 1, onClick: () => edit((s) => moveChannel(s, channel.id, 1), 'move channel') },
      { separator: true },
      { header: true, label: 'Steps (this pattern)' },
      { label: 'Fill every 2', onClick: run('fill2', 'fill steps') }, { label: 'Fill every 4', onClick: run('fill4', 'fill steps') }, { label: 'Fill every 8', onClick: run('fill8', 'fill steps') },
      { label: 'Shift left', onClick: run('left', 'shift steps') }, { label: 'Shift right', onClick: run('right', 'shift steps') },
      { label: 'Randomise', onClick: run('random', 'randomise steps') }, { label: 'Clear steps', onClick: run('clear', 'clear steps') },
      { separator: true },
      { label: 'Remove channel', onClick: () => edit((s) => removeChannel(s, channel.id), 'remove channel') },
    ];
  };

  const byStep = new Map<number, Note[]>();
  for (const n of notes) {
    const i = Math.floor(n.start + 1e-6);
    if (i >= from && i < from + count) byStep.set(i, [...(byStep.get(i) ?? []), n]);
  }
  return (
    <div className={`ms-row${selected ? ' sel' : ''}${channel.mute ? ' muted' : ''}`} onPointerDown={(e) => { if (e.button === 0 && !(e.target as HTMLElement).closest('button, input, select, .ms-steps, .ms-knob')) select(); }}>
      <div className="ms-row-head" style={{ ['--ch' as string]: channel.color }}>
        <button type="button" className={`ms-led${channel.mute ? '' : ' on'}`} aria-pressed={!channel.mute} aria-label={channel.mute ? `Unmute ${channel.name}` : `Mute ${channel.name}`} title={channel.mute ? 'Muted — click to unmute' : 'Click to mute'} onClick={() => edit((s) => updateChannel(s, channel.id, (c) => ({ ...c, mute: !c.mute })), 'mute channel')} />
        <button type="button" className={`ms-led solo${channel.solo ? ' on' : ''}`} aria-pressed={channel.solo} aria-label={`Solo ${channel.name}`} title="Solo" onClick={() => edit((s) => updateChannel(s, channel.id, (c) => ({ ...c, solo: !c.solo })), 'solo channel')} />
        <ColorInput label={`Colour of ${channel.name}`} value={channel.color} onChange={(color) => patch((c) => ({ ...c, color }))} onEnd={() => settle('Music: channel colour')} className="ms-color sm" />
        {renaming ? (
          <input
            className="ms-input ms-name" autoFocus defaultValue={channel.name} aria-label="Channel name"
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenaming(false); }}
            onBlur={(e) => { const name = e.target.value.trim(); setRenaming(false); if (name && name !== channel.name) edit((s) => updateChannel(s, channel.id, (c) => ({ ...c, name })), 'rename channel'); }}
          />
        ) : (
          <span className="ms-name" title={`${channel.name} · ${INSTRUMENT_SPECS[channel.instrument].label} (double-click to rename)`} onDoubleClick={() => setRenaming(true)}>{channel.name}</span>
        )}
        <Knob value={channel.volume} min={0} max={1.25} def={0.8} size={24} label={`${channel.name} volume`} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => patch((c) => ({ ...c, volume: v }))} onEnd={() => settle('Music: channel volume')} />
        <Knob value={channel.pan} min={-1} max={1} def={0} size={24} bipolar label={`${channel.name} pan`} format={(v) => (Math.abs(v) < 0.01 ? 'C' : `${Math.round(Math.abs(v) * 100)}${v < 0 ? 'L' : 'R'}`)} onChange={(v) => patch((c) => ({ ...c, pan: v }))} onEnd={() => settle('Music: channel pan')} />
        <DragNumber value={channel.insert} min={0} max={125} width={30} label={`${channel.name} mixer insert`} onChange={(v) => drag((s) => updateChannel(ensureInserts(s, Math.round(v) + 1), channel.id, (c) => ({ ...c, insert: Math.round(v) })))} onEnd={() => settle('Music: channel insert')} />
        <button type="button" className="ms-icon" aria-label={`Open ${channel.name} in the piano roll`} title="Piano roll" onClick={() => { setView({ selectedChannelId: channel.id }); setUi({ win: 'pianoroll' }); }}><Piano size={13} /></button>
        <button type="button" className="ms-icon" aria-label={`${channel.name} instrument panel`} title="Instrument panel" onClick={() => openPanel({ kind: 'instrument', channelId: channel.id })}><SlidersHorizontal size={13} /></button>
        <Menu className="ms-icon" title={`${channel.name} options`} trigger={<MoreHorizontal size={13} />} items={items} align="right" />
      </div>
      <div ref={grid} className="ms-steps" style={{ width: count * CELL, ['--ch' as string]: channel.color }} role="group" aria-label={`${channel.name} steps`} onPointerDown={paint} onContextMenu={(e) => e.preventDefault()}>
        {Array.from({ length: count }, (_, i) => {
          const step = from + i;
          const hit = byStep.get(step);
          const vel = hit ? Math.max(...hit.map((n) => n.velocity)) : 0;
          const long = hit?.some((n) => n.length > 1.01);
          return (
            <i key={step} className={`ms-cell${Math.floor(step / beat) % 2 ? ' alt' : ''}${step % barSteps === 0 ? ' bar' : ''}${hit ? ' on' : ''}${long ? ' long' : ''}`} style={hit ? { opacity: 0.35 + 0.65 * vel } : undefined} />
          );
        })}
      </div>
    </div>
  );
});

/** Velocity bars of the selected channel's steps; drag across them to paint velocities. */
function VelocityLane({ channel, notes, patternId, from, count }: { channel: Channel; notes: Note[]; patternId: string; from: number; count: number }) {
  const { drag, settle } = useActions();
  const ref = useRef<HTMLDivElement>(null);
  const down = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el) return;
    e.preventDefault();
    const set = new Map<number, number>();
    const record = (ev: { clientX: number; clientY: number }) => {
      const rect = el.getBoundingClientRect();
      const step = from + clamp(Math.floor((ev.clientX - rect.left) / CELL), 0, count - 1);
      set.set(step, clamp(1 - (ev.clientY - rect.top) / rect.height, 0.03, 1));
      drag((s) => setNotes(s, patternId, channel.id, notesOf(s.patterns.find((p) => p.id === patternId), channel.id).map((n) => {
        const v = set.get(Math.floor(n.start + 1e-6));
        return v === undefined ? n : { ...n, velocity: v };
      })));
    };
    record(e);
    trackPointer(record, () => settle('Music: velocity'));
  };
  return (
    <div className="ms-graph">
      <div className="ms-graph-label"><i className="ms-swatch" style={{ background: channel.color }} /> {channel.name} velocity</div>
      <div ref={ref} className="ms-graph-lane" style={{ width: count * CELL, ['--ch' as string]: channel.color }} role="group" aria-label="Velocity lane (drag to draw)" onPointerDown={down}>
        {Array.from({ length: count }, (_, i) => {
          const hit = notes.filter((n) => Math.floor(n.start + 1e-6) === from + i);
          const v = hit.length ? Math.max(...hit.map((n) => n.velocity)) : 0;
          return <i key={i} className="ms-graph-bar" style={{ height: `${v * 100}%`, left: i * CELL }} />;
        })}
      </div>
    </div>
  );
}

export function ChannelRack() {
  const { song, pattern, channel } = useStudio();
  const act = useActions();
  const [page, setPage] = useState<number | 'all'>('all');
  const bar = stepsPerBar(song);
  const beat = beatSteps(song);
  const steps = pattern ? patternSteps(song, pattern) : bar;
  const totalBars = Math.max(1, Math.ceil(steps / bar));
  const shown = page === 'all' || page >= totalBars ? 'all' : page;
  const from = shown === 'all' ? 0 : shown * bar;
  const count = shown === 'all' ? steps : bar;
  const add = (instrument: InstrumentType, drum?: DrumPiece) => act.edit((s) => withChannel(s, newChannel(s, instrument, drum ? { drum } : {})), 'add channel');

  return (
    <section className="ms-rack" aria-label="Channel Rack">
      <header className="ms-pane-head">
        <h3>Channel Rack</h3>
        <Menu className="ms-primary" title="Add a channel" trigger={<><Plus size={13} /> Channel</>} items={() => addChannelItems(add)} />
        <span className="ms-sep" />
        <span className="ms-dim">Pattern length</span>
        <button type="button" className="ms-icon" aria-label="Shorter pattern" title="One bar shorter" disabled={!pattern || pattern.bars <= 1} onClick={() => pattern && act.edit((s) => updatePattern(s, pattern.id, (p) => ({ ...p, bars: Math.max(1, p.bars - 1) })), 'pattern length')}>−</button>
        <span className="ms-chip">{pattern?.bars ?? 1} bar{(pattern?.bars ?? 1) === 1 ? '' : 's'}</span>
        <button type="button" className="ms-icon" aria-label="Longer pattern" title="One bar longer" disabled={!pattern || pattern.bars >= 64} onClick={() => pattern && act.edit((s) => updatePattern(s, pattern.id, (p) => ({ ...p, bars: Math.min(64, p.bars + 1) })), 'pattern length')}>+</button>
        {totalBars > 1 && (
          <div className="ms-seg" role="group" aria-label="Bar page">
            <button type="button" className={shown === 'all' ? 'on' : ''} onClick={() => setPage('all')}>All</button>
            {Array.from({ length: Math.min(totalBars, 16) }, (_, i) => <button key={i} type="button" className={shown === i ? 'on' : ''} onClick={() => setPage(i)} title={`Bar ${i + 1}`}>{i + 1}</button>)}
          </div>
        )}
      </header>
      {song.channels.length === 0 ? <EmptyChannels /> : (
        <div className="ms-rack-scroll">
          <div className="ms-rack-inner">
            {song.channels.map((c, i) => (
              <ChannelRow
                key={c.id} channel={c} notes={pattern?.notes[c.id] ?? EMPTY} patternId={pattern?.id ?? null} from={from} count={count}
                selected={channel?.id === c.id} barSteps={bar} beat={beat} index={i} total={song.channels.length}
              />
            ))}
            {channel && pattern && <VelocityLane channel={channel} notes={pattern.notes[channel.id] ?? EMPTY} patternId={pattern.id} from={from} count={count} />}
          </div>
        </div>
      )}
    </section>
  );
}
