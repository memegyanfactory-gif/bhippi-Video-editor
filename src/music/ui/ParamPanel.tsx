// Floating, draggable parameter windows for an instrument or an effect. The knobs come straight
// from the ParamSpec lists in types.ts (options → select, step 1 → stepped knob, wide positive
// ranges like cutoff → logarithmic knob), grouped by name prefix (osc, filter, envelopes, LFO…).
import { useEffect, useMemo, useRef, useState } from 'react';
import { Power, X } from 'lucide-react';
import { EFFECT_SPECS, INSTRUMENT_SPECS, paramValue, type Channel, type DrumPiece, type Effect, type ParamSpec } from '../types';
import { updateChannel, updateInsert } from '../model';
import { noteName } from '../theory';
import { DragNumber, Knob } from './Controls';
import { useActions, useStudio, type PanelRef } from './ctx';
import { clamp } from './format';
import { trackPointer } from './studioUtil';

const DRUMS: DrumPiece[] = ['kick', 'snare', 'clap', 'hat', 'openhat', 'tom', 'rim', 'cowbell', 'crash', 'ride', 'shaker', 'perc'];

function groupOf(name: string, hasEnv: boolean, instrument: boolean): string {
  let m = /^osc(\d)/.exec(name);
  if (m) return `Oscillator ${m[1]}`;
  m = /^op(\d)/.exec(name);
  if (m) return `Operator ${m[1]}`;
  m = /^b(\d)(Type|Freq|Gain|Q)$/.exec(name);
  if (m) return `Band ${m[1]}`;
  if (/^bar\d/.test(name)) return 'Drawbars';
  if (/^unison/.test(name)) return 'Unison';
  if (/^lfo/.test(name)) return 'LFO';
  if (/^f(Attack|Decay|Sustain|Release)$/.test(name)) return 'Filter envelope';
  if (hasEnv && /^(attack|decay|sustain|release)$/.test(name)) return 'Amp envelope';
  if (instrument && /^(filterType|cutoff|resonance|filterEnv|keyTrack|velToCutoff)$/.test(name)) return 'Filter';
  return 'Main';
}

const isLog = (s: ParamSpec) => s.min > 0 && s.max / s.min >= 50;

/** The generic knob grid for a list of specs. */
export function ParamGrid({ specs, values, onChange, onEnd, instrument }: { specs: ParamSpec[]; values: Record<string, number>; onChange: (name: string, v: number) => void; onEnd: (spec: ParamSpec) => void; instrument: boolean }) {
  const groups = useMemo(() => {
    const hasEnv = specs.some((s) => s.name === 'sustain') && specs.some((s) => s.name === 'attack');
    const map = new Map<string, ParamSpec[]>();
    for (const s of specs) {
      const g = groupOf(s.name, hasEnv, instrument);
      map.set(g, [...(map.get(g) ?? []), s]);
    }
    return [...map.entries()];
  }, [specs, instrument]);
  return (
    <div className="ms-params">
      {groups.map(([group, list]) => (
        <section key={group} className="ms-param-group">
          <h4>{group}</h4>
          <div className="ms-param-grid">
            {list.map((s) => {
              const v = paramValue(values, s);
              return s.options ? (
                <label key={s.name} className="ms-param-select" title={s.about ?? s.label}>
                  <span>{s.label}</span>
                  <select aria-label={s.label} value={Math.round(v)} onChange={(e) => { onChange(s.name, Number(e.target.value)); onEnd(s); }}>
                    {s.options.map((o, i) => <option key={o} value={i}>{o}</option>)}
                  </select>
                </label>
              ) : (
                <div key={s.name} className="ms-param" title={s.about ?? s.label}>
                  <Knob value={v} min={s.min} max={s.max} def={s.default} step={s.step} unit={s.unit} log={isLog(s)} bipolar={s.min < 0} label={s.label} onChange={(x) => onChange(s.name, x)} onEnd={() => onEnd(s)} />
                  <span className="ms-param-name">{s.label}</span>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function Frame({ id, title, color, onClose, children, head, index }: { id: string; title: string; color?: string; onClose: () => void; children: React.ReactNode; head?: React.ReactNode; index: number }) {
  const [pos, setPos] = useState({ x: 120 + index * 28, y: 70 + index * 28 });
  const ref = useRef<HTMLDivElement>(null);
  const down = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, input, select')) return;
    e.preventDefault();
    const sx = e.clientX;
    const sy = e.clientY;
    const { x, y } = pos;
    const parent = ref.current?.offsetParent as HTMLElement | null;
    const pw = parent?.clientWidth ?? 1200;
    const ph = parent?.clientHeight ?? 800;
    trackPointer((ev) => setPos({ x: clamp(x + ev.clientX - sx, -200, pw - 80), y: clamp(y + ev.clientY - sy, 0, ph - 40) }), () => undefined);
  };
  return (
    <div ref={ref} id={id} className="ms-panel" style={{ left: pos.x, top: pos.y }} role="dialog" aria-label={title}>
      <header className="ms-panel-head" onPointerDown={down}>
        <i className="ms-swatch" style={{ background: color ?? 'var(--blue)' }} />
        <strong>{title}</strong>
        <span className="ms-grow" />
        {head}
        <button type="button" className="ms-icon" aria-label="Close panel" title="Close" onClick={onClose}><X size={13} /></button>
      </header>
      <div className="ms-panel-body">{children}</div>
    </div>
  );
}

function InstrumentPanel({ panel, index }: { panel: PanelRef & { kind: 'instrument' }; index: number }) {
  const { song, assets } = useStudio();
  const { drag, settle, edit, closePanel } = useActions();
  const channel = song.channels.find((c) => c.id === panel.channelId);
  useEffect(() => { if (!channel) closePanel(panel.id); }, [channel, closePanel, panel.id]);
  if (!channel) return null;
  const spec = INSTRUMENT_SPECS[channel.instrument];
  const set = (change: (c: Channel) => Channel) => drag((s) => updateChannel(s, channel.id, change));
  const audio = [...assets.values()].filter((a) => a.kind === 'audio');
  return (
    <Frame id={panel.id} index={index} title={`${channel.name} · ${spec.label}`} color={channel.color} onClose={() => closePanel(panel.id)}>
      <p className="ms-panel-about">{spec.about}</p>
      <div className="ms-panel-chan">
        {channel.instrument === 'drum' && (
          <label>Piece
            <select aria-label="Drum piece" value={channel.drum ?? 'kick'} onChange={(e) => edit((s) => updateChannel(s, channel.id, (c) => ({ ...c, drum: e.target.value as DrumPiece })), 'drum piece')}>
              {DRUMS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
        )}
        {channel.instrument === 'sampler' && (
          <label>Sample
            <select aria-label="Sample" value={channel.sampleAssetId ?? ''} onChange={(e) => edit((s) => updateChannel(s, channel.id, (c) => ({ ...c, sampleAssetId: e.target.value || null })), 'sample')}>
              <option value="">(none)</option>
              {audio.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
        )}
        <label>Root key <DragNumber value={channel.rootKey} min={0} max={127} label="Root key" width={40} onChange={(v) => set((c) => ({ ...c, rootKey: Math.round(v) }))} onEnd={() => settle('Music: root key')} /><em>{noteName(channel.rootKey)}</em></label>
        <label>Voices <DragNumber value={channel.polyphony} min={1} max={32} label="Polyphony" width={36} onChange={(v) => set((c) => ({ ...c, polyphony: Math.round(v) }))} onEnd={() => settle('Music: voices')} /></label>
        <label>Glide <DragNumber value={channel.glide} min={0} max={2} step={0.01} decimals={2} label="Glide seconds" width={44} suffix="s" onChange={(v) => set((c) => ({ ...c, glide: v }))} onEnd={() => settle('Music: glide')} /></label>
      </div>
      <ParamGrid
        specs={spec.params} values={channel.params} instrument
        onChange={(name, v) => set((c) => ({ ...c, params: { ...c.params, [name]: v } }))}
        onEnd={(s) => settle(`Music: ${channel.name} ${s.label}`)}
      />
    </Frame>
  );
}

function EffectPanel({ panel, index }: { panel: PanelRef & { kind: 'effect' }; index: number }) {
  const { song } = useStudio();
  const { drag, settle, edit, closePanel } = useActions();
  const insert = song.mixer.inserts[panel.insert];
  const effect: Effect | undefined = insert?.effects.find((e) => e.id === panel.effectId);
  useEffect(() => { if (!effect) closePanel(panel.id); }, [effect, closePanel, panel.id]);
  if (!insert || !effect) return null;
  const spec = EFFECT_SPECS[effect.type];
  const set = (change: (e: Effect) => Effect) => drag((s) => updateInsert(s, panel.insert, (ins) => ({ ...ins, effects: ins.effects.map((e) => (e.id === effect.id ? change(e) : e)) })));
  return (
    <Frame
      id={panel.id} index={index} title={`${insert.name} · ${spec.label}`} color={insert.color} onClose={() => closePanel(panel.id)}
      head={(
        <>
          <button type="button" className={`ms-icon${effect.enabled ? ' on' : ''}`} aria-pressed={effect.enabled} aria-label={effect.enabled ? 'Bypass effect' : 'Enable effect'} title={effect.enabled ? 'Enabled — click to bypass' : 'Bypassed — click to enable'}
            onClick={() => edit((s) => updateInsert(s, panel.insert, (ins) => ({ ...ins, effects: ins.effects.map((e) => (e.id === effect.id ? { ...e, enabled: !e.enabled } : e)) })), `${spec.label} ${effect.enabled ? 'off' : 'on'}`)}><Power size={13} /></button>
          <span className="ms-panel-mix">Mix <Knob value={effect.mix} min={0} max={1} def={1} size={24} label="Dry/wet mix" format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set((e) => ({ ...e, mix: v }))} onEnd={() => settle(`Music: ${spec.label} mix`)} /></span>
        </>
      )}
    >
      <p className="ms-panel-about">{spec.about}</p>
      <ParamGrid
        specs={spec.params} values={effect.params} instrument={false}
        onChange={(name, v) => set((e) => ({ ...e, params: { ...e.params, [name]: v } }))}
        onEnd={(s) => settle(`Music: ${spec.label} ${s.label}`)}
      />
    </Frame>
  );
}

/** Every open parameter window. */
export function ParamPanels() {
  const { panels } = useStudio();
  return (
    <>
      {panels.map((p, i) => (p.kind === 'instrument' ? <InstrumentPanel key={p.id} panel={p} index={i} /> : <EffectPanel key={p.id} panel={p} index={i} />))}
    </>
  );
}
