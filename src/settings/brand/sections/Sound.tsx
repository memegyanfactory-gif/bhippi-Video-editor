import type { CSSProperties } from 'react';
import { ChipsInput, Field, Group, LinesInput, Slider, tokenHex, type SectionProps } from '../shared';

const SFX_IDEAS = ['whoosh', 'click', 'pop', 'riser', 'impact', 'swipe', 'chime', 'glitch'];

export function SoundBoard({ kit, onPatch }: SectionProps) {
  const a = kit.audio;
  const [lo, hi] = a.tempo;
  const mid = Math.max(40, (lo + hi) / 2);
  const accent = tokenHex(kit, 'accent', '#2d8ceb');
  return (
    <div className="bs-sound">
      <div className="bs-pulse" style={{ ['--beat' as string]: `${(60 / mid) * 2}s`, ['--bs-accent' as string]: accent } as CSSProperties} aria-hidden="true">
        {Array.from({ length: 40 }, (_, i) => <i key={i} style={{ animationDelay: `${-((i * 0.37) % 1.6)}s`, height: `${28 + ((i * 53) % 60)}%` }} />)}
        <span><b>{lo}–{hi}</b> BPM</span>
      </div>
      <Field label="Music" hint="how it should sound"><input className="bs-input" value={a.music} onChange={(e) => onPatch('audio', { music: e.target.value })} /></Field>
      <div className="bs-two">
        <Slider label="Slowest" value={lo} min={50} max={200} step={1} format={(v) => `${v} BPM`} onChange={(v) => onPatch('audio', { tempo: [Math.min(v, hi), hi] })} />
        <Slider label="Fastest" value={hi} min={50} max={200} step={1} format={(v) => `${v} BPM`} onChange={(v) => onPatch('audio', { tempo: [lo, Math.max(v, lo)] })} />
      </div>
      <Group label="Sound effects" hint="The palette the edit draws from.">
        <ChipsInput value={a.sfx} onChange={(sfx) => onPatch('audio', { sfx })} placeholder="Add an effect" suggestions={SFX_IDEAS} />
      </Group>
      <div className="bs-two">
        <Field label="Voice-over voice" hint="TTS id"><input className="bs-input" value={a.voice ?? ''} placeholder="kokoro:af_heart" onChange={(e) => onPatch('audio', { voice: e.target.value || null })} /></Field>
        <Field label="Sound rules" hint="one per line"><LinesInput value={a.rules} rows={3} onChange={(rules) => onPatch('audio', { rules })} /></Field>
      </div>
    </div>
  );
}
