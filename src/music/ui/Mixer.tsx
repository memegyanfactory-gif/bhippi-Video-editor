// The Mixer: Master + insert strips (name, colour, peak meters, dB fader, pan, width, mute / solo /
// phase) in a horizontal scroll, and below it the selected insert's ten effect slots and routing
// (sends with level and sidechain). Meters repaint from `engine.meters()` every animation frame.
import { memo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Power, X } from 'lucide-react';
import { EFFECT_SPECS, MAX_EFFECTS, MAX_INSERTS, type EffectType, type MixerInsert } from '../types';
import { addEffect, ensureInserts, newEffect, updateInsert } from '../model';
import { ColorInput, Fader, Knob, Menu, type MenuItem } from './Controls';
import { useActions, useStudio } from './ctx';
import { fmtDb, meterLevel } from './format';
import { useRaf } from './studioUtil';

const EFFECT_TYPES = Object.keys(EFFECT_SPECS) as EffectType[];

const Strip = memo(function Strip({ insert, index, selected, channels, onSelect }: { insert: MixerInsert; index: number; selected: boolean; channels: number; onSelect: (index: number) => void }) {
  const { drag, settle, edit } = useActions();
  const [renaming, setRenaming] = useState(false);
  const patch = (change: (i: MixerInsert) => MixerInsert) => drag((s) => updateInsert(s, index, change));
  const master = index === 0;
  return (
    <div className={`ms-strip${selected ? ' sel' : ''}${master ? ' master' : ''}`} onPointerDown={() => onSelect(index)} data-strip={index}>
      <div className="ms-strip-bar" style={{ background: insert.color }} />
      {renaming ? (
        <input
          className="ms-input ms-strip-name" autoFocus defaultValue={insert.name} aria-label="Insert name"
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenaming(false); }}
          onBlur={(e) => { const name = e.target.value.trim(); setRenaming(false); if (name && name !== insert.name) edit((s) => updateInsert(s, index, (i) => ({ ...i, name })), 'rename insert'); }}
        />
      ) : (
        <button type="button" className="ms-strip-name" title={`${insert.name} — click to select, double-click to rename${channels ? ` · ${channels} channel${channels === 1 ? '' : 's'}` : ''}`} onDoubleClick={() => setRenaming(true)}>{insert.name}</button>
      )}
      <div className="ms-strip-fx" title={`${insert.effects.length} effect${insert.effects.length === 1 ? '' : 's'}`}>{insert.effects.filter((e) => e.enabled).length}/{insert.effects.length} fx</div>
      <div className="ms-strip-mid">
        <div className="ms-meter" data-ins={index} aria-hidden="true"><div className="ms-meter-fill" data-ch="l" /><div className="ms-meter-fill" data-ch="r" /></div>
        <Fader value={insert.volume} label={`${insert.name} volume`} onChange={(v) => patch((i) => ({ ...i, volume: v }))} onEnd={() => settle('Music: insert volume')} />
      </div>
      <div className="ms-strip-db">{fmtDb(insert.volume)} dB</div>
      <div className="ms-strip-knobs">
        <Knob value={insert.pan} min={-1} max={1} def={0} size={24} bipolar label={`${insert.name} pan`} format={(v) => (Math.abs(v) < 0.01 ? 'C' : `${Math.round(Math.abs(v) * 100)}${v < 0 ? 'L' : 'R'}`)} onChange={(v) => patch((i) => ({ ...i, pan: v }))} onEnd={() => settle('Music: insert pan')} />
        <Knob value={insert.width} min={0} max={2} def={1} size={24} label={`${insert.name} stereo width`} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => patch((i) => ({ ...i, width: v }))} onEnd={() => settle('Music: insert width')} />
      </div>
      <div className="ms-strip-btns">
        <button type="button" className={`ms-mini mute${insert.mute ? ' on' : ''}`} aria-pressed={insert.mute} aria-label={`Mute ${insert.name}`} title="Mute" onClick={() => edit((s) => updateInsert(s, index, (i) => ({ ...i, mute: !i.mute })), 'mute insert')}>M</button>
        {!master && <button type="button" className={`ms-mini solo${insert.solo ? ' on' : ''}`} aria-pressed={insert.solo} aria-label={`Solo ${insert.name}`} title="Solo" onClick={() => edit((s) => updateInsert(s, index, (i) => ({ ...i, solo: !i.solo })), 'solo insert')}>S</button>}
        <button type="button" className={`ms-mini${insert.invert ? ' on' : ''}`} aria-pressed={!!insert.invert} aria-label={`Invert phase of ${insert.name}`} title="Invert phase" onClick={() => edit((s) => updateInsert(s, index, (i) => ({ ...i, invert: !i.invert })), 'invert phase')}>Ø</button>
      </div>
      <ColorInput label={`Colour of ${insert.name}`} value={insert.color} onChange={(color) => patch((i) => ({ ...i, color }))} onEnd={() => settle('Music: insert colour')} className="ms-color sm" />
    </div>
  );
});

function InsertDetail({ index }: { index: number }) {
  const { song } = useStudio();
  const { edit, drag, settle, openPanel } = useActions();
  const insert = song.mixer.inserts[index];
  if (!insert) return null;
  const mix = (id: string, change: (e: MixerInsert['effects'][number]) => MixerInsert['effects'][number]) => drag((s) => updateInsert(s, index, (i) => ({ ...i, effects: i.effects.map((e) => (e.id === id ? change(e) : e)) })));
  const slots = Array.from({ length: MAX_EFFECTS }, (_, i) => insert.effects[i] ?? null);
  const addItems = (): MenuItem[] => EFFECT_TYPES.map((t) => ({
    label: EFFECT_SPECS[t].label, hint: t,
    onClick: () => { const fx = newEffect(t); edit((s) => addEffect(s, index, fx), `add ${EFFECT_SPECS[t].label}`); openPanel({ kind: 'effect', insert: index, effectId: fx.id }); },
  }));
  const swap = (i: number, dir: -1 | 1) => edit((s) => updateInsert(s, index, (ins) => {
    const effects = [...ins.effects];
    [effects[i], effects[i + dir]] = [effects[i + dir], effects[i]];
    return { ...ins, effects };
  }), 'move effect');
  const targets = song.mixer.inserts.map((ins, i) => ({ ins, i })).filter(({ i }) => i !== index);

  return (
    <div className="ms-detail">
      <section className="ms-fxrack" aria-label={`${insert.name} effects`}>
        <h4><i className="ms-swatch" style={{ background: insert.color }} /> {insert.name} · effects <em>{insert.effects.length}/{MAX_EFFECTS}</em></h4>
        {slots.map((fx, i) => fx ? (
          <div key={fx.id} className={`ms-slot${fx.enabled ? '' : ' off'}`}>
            <span className="ms-slot-n">{i + 1}</span>
            <button type="button" className={`ms-icon${fx.enabled ? ' on' : ''}`} aria-pressed={fx.enabled} aria-label={`${fx.enabled ? 'Bypass' : 'Enable'} ${EFFECT_SPECS[fx.type].label}`} title={fx.enabled ? 'On — click to bypass' : 'Bypassed'} onClick={() => edit((s) => updateInsert(s, index, (ins) => ({ ...ins, effects: ins.effects.map((e) => (e.id === fx.id ? { ...e, enabled: !e.enabled } : e)) })), 'effect on/off')}><Power size={12} /></button>
            <button type="button" className="ms-slot-name" title="Open the effect panel" onClick={() => openPanel({ kind: 'effect', insert: index, effectId: fx.id })}>{EFFECT_SPECS[fx.type].label}</button>
            <Knob value={fx.mix} min={0} max={1} def={fx.type === 'reverb' ? 0.3 : fx.type === 'delay' ? 0.25 : 1} size={22} label={`${EFFECT_SPECS[fx.type].label} mix`} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => mix(fx.id, (e) => ({ ...e, mix: v }))} onEnd={() => settle('Music: effect mix')} />
            <button type="button" className="ms-icon" aria-label="Move effect up" title="Move up" disabled={i === 0} onClick={() => swap(i, -1)}><ArrowUp size={12} /></button>
            <button type="button" className="ms-icon" aria-label="Move effect down" title="Move down" disabled={i === insert.effects.length - 1} onClick={() => swap(i, 1)}><ArrowDown size={12} /></button>
            <button type="button" className="ms-icon" aria-label={`Remove ${EFFECT_SPECS[fx.type].label}`} title="Remove effect" onClick={() => edit((s) => updateInsert(s, index, (ins) => ({ ...ins, effects: ins.effects.filter((e) => e.id !== fx.id) })), 'remove effect')}><X size={12} /></button>
          </div>
        ) : (
          <div key={`empty${i}`} className="ms-slot empty">
            <span className="ms-slot-n">{i + 1}</span>
            {i === insert.effects.length ? <Menu className="ms-slot-add" title={`Add an effect to ${insert.name}`} trigger={<><Plus size={12} /> Add effect</>} items={addItems} /> : <span className="ms-dim">empty</span>}
          </div>
        ))}
      </section>
      <section className="ms-routing" aria-label={`${insert.name} routing`}>
        <h4>Routing</h4>
        {index > 0 && (
          <label className="ms-check"><input type="checkbox" checked={insert.toMaster !== false} onChange={(e) => edit((s) => updateInsert(s, index, (i) => ({ ...i, toMaster: e.target.checked })), 'route to master')} /> Output to master</label>
        )}
        {insert.sends.map((send, i) => (
          <div key={i} className="ms-send">
            <span>→</span>
            <select aria-label="Send target" value={send.to} onChange={(e) => edit((s) => updateInsert(s, index, (ins) => ({ ...ins, sends: ins.sends.map((x, j) => (j === i ? { ...x, to: Number(e.target.value) } : x)) })), 'send target')}>
              {targets.map(({ ins, i: t }) => <option key={t} value={t}>{t === 0 ? 'Master' : `${t}. ${ins.name}`}</option>)}
            </select>
            <Knob value={send.level} min={0} max={1.25} def={0.8} size={22} label="Send level" format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => drag((s) => updateInsert(s, index, (ins) => ({ ...ins, sends: ins.sends.map((x, j) => (j === i ? { ...x, level: v } : x)) })))} onEnd={() => settle('Music: send level')} />
            <button type="button" className={`ms-mini${send.sidechain ? ' on' : ''}`} aria-pressed={!!send.sidechain} title="Sidechain: feeds the target's ducker instead of its audio" onClick={() => edit((s) => updateInsert(s, index, (ins) => ({ ...ins, sends: ins.sends.map((x, j) => (j === i ? { ...x, sidechain: !x.sidechain } : x)) })), 'sidechain')}>SC</button>
            <button type="button" className="ms-icon" aria-label="Remove send" title="Remove send" onClick={() => edit((s) => updateInsert(s, index, (ins) => ({ ...ins, sends: ins.sends.filter((_, j) => j !== i) })), 'remove send')}><X size={12} /></button>
          </div>
        ))}
        <button type="button" className="ms-btn" disabled={!targets.length} onClick={() => edit((s) => updateInsert(s, index, (ins) => ({ ...ins, sends: [...ins.sends, { to: targets.find((t) => t.i > 0)?.i ?? 0, level: 0.8 }] })), 'add send')}><Plus size={12} /> Add send</button>
      </section>
    </div>
  );
}

export function Mixer() {
  const { song, channel } = useStudio();
  const { engine, edit } = useActions();
  const [sel, setSel] = useState(() => channel?.insert ?? 0);
  const root = useRef<HTMLDivElement>(null);
  const held = useRef<Float32Array>(new Float32Array(MAX_INSERTS * 2));
  const inserts = song.mixer.inserts;

  useRaf(true, () => {
    const el = root.current;
    if (!el) return;
    const meters = engine.meters();
    for (const m of el.querySelectorAll<HTMLElement>('.ms-meter')) {
      const i = Number(m.dataset.ins);
      const data = meters[i];
      const h = held.current;
      h[i * 2] = Math.max(meterLevel(data?.peakL ?? 0), h[i * 2] * 0.9);
      h[i * 2 + 1] = Math.max(meterLevel(data?.peakR ?? 0), h[i * 2 + 1] * 0.9);
      (m.children[0] as HTMLElement).style.transform = `scaleY(${h[i * 2]})`;
      (m.children[1] as HTMLElement).style.transform = `scaleY(${h[i * 2 + 1]})`;
    }
  });

  const counts = new Map<number, number>();
  for (const c of song.channels) counts.set(c.insert, (counts.get(c.insert) ?? 0) + 1);
  const shown = Math.min(sel, inserts.length - 1);

  return (
    <section className="ms-mixer" aria-label="Mixer" ref={root}>
      <div className="ms-strips">
        <div className="ms-strip-master"><Strip insert={inserts[0]} index={0} selected={shown === 0} channels={counts.get(0) ?? 0} onSelect={setSel} /></div>
        <div className="ms-strip-scroll">
          {inserts.slice(1).map((ins, i) => <Strip key={ins.id} insert={ins} index={i + 1} selected={shown === i + 1} channels={counts.get(i + 1) ?? 0} onSelect={setSel} />)}
          {inserts.length < MAX_INSERTS && (
            <button type="button" className="ms-strip-add" title="Add an insert" aria-label="Add an insert" onClick={() => edit((s) => ensureInserts(s, s.mixer.inserts.length + 1), 'add insert')}><Plus size={16} /></button>
          )}
        </div>
      </div>
      <InsertDetail index={shown} />
    </section>
  );
}
