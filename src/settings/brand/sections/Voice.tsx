import { Check, Plus, X } from 'lucide-react';
import { ChipsInput, Field, Group, LinesInput, faceStyle, tokenHex, type SectionProps } from '../shared';

const TONES = ['confident', 'warm', 'witty', 'direct', 'calm', 'bold', 'friendly', 'precise', 'playful', 'expert'];

function SampleCards({ lines, onChange, kind, bg, fg }: { lines: string[]; onChange: (lines: string[]) => void; kind: 'do' | 'dont'; bg: string; fg: string }) {
  const set = (i: number, text: string) => onChange(lines.map((l, k) => (k === i ? text : l)));
  return (
    <div className={`bs-voice-cards ${kind}`}>
      {lines.map((line, i) => (
        <div key={i} className="bs-vcard" style={{ background: bg, color: fg }}>
          <span className="bs-vcard-mark">{kind === 'do' ? <Check size={12} strokeWidth={3} /> : <X size={12} strokeWidth={3} />}{kind === 'do' ? 'Do' : "Don't"}</span>
          <textarea rows={3} value={line} aria-label={`${kind === 'do' ? 'Example' : 'Counter-example'} ${i + 1}`} placeholder={kind === 'do' ? 'A line in the brand voice' : 'A line that breaks the voice'} onChange={(e) => set(i, e.target.value)} onBlur={() => onChange(lines.filter((l) => l.trim()))} />
          <button type="button" className="bs-vcard-x bs-icon-btn" aria-label="Remove line" onClick={() => onChange(lines.filter((_, k) => k !== i))}><X size={11} /></button>
        </div>
      ))}
      <button type="button" className="bs-vcard add" onClick={() => onChange([...lines, ''])}><Plus size={16} /><span>Add {kind === 'do' ? 'an example' : 'a counter-example'}</span></button>
    </div>
  );
}

export function VoiceBoard({ kit, onPatch }: SectionProps) {
  const v = kit.voiceGuide;
  const surface = tokenHex(kit, 'surface', '#222');
  const fg = tokenHex(kit, 'text', '#fff');
  return (
    <div className="bs-voice" style={{ ['--bs-vfont' as string]: kit.typography.heading.family }}>
      <div className="bs-two">
        <Group label="Tone" hint="How it sounds in a word or two.">
          <ChipsInput value={v.tone} onChange={(tone) => onPatch('voice', { tone })} placeholder="Add a tone" suggestions={TONES} />
        </Group>
        <Group label="Personality">
          <ChipsInput value={v.personality} onChange={(personality) => onPatch('voice', { personality })} placeholder="Add a trait" />
        </Group>
      </div>
      <div className="bs-two">
        <Group label="Use" hint="Words and phrases it reaches for."><ChipsInput tone="good" value={v.use} onChange={(use) => onPatch('voice', { use })} placeholder="Add a phrase" /></Group>
        <Group label="Avoid" hint="Words and phrases it never says."><ChipsInput tone="bad" value={v.avoid} onChange={(avoid) => onPatch('voice', { avoid })} placeholder="Add a phrase" /></Group>
      </div>
      <Group label="Sounds like" hint="Sample lines the AI writes toward.">
        <div style={faceStyle(kit.typography.heading)}><SampleCards lines={v.samples} kind="do" bg={surface} fg={fg} onChange={(samples) => onPatch('voice', { samples })} /></div>
      </Group>
      <Group label="Never sounds like" hint="Lines that break the voice, so the AI learns the edge.">
        <div style={faceStyle(kit.typography.heading)}><SampleCards lines={v.dontSamples ?? []} kind="dont" bg={surface} fg={fg} onChange={(dontSamples) => onPatch('voice', { dontSamples })} /></div>
      </Group>
      <div className="bs-two">
        <Field label="Language"><input className="bs-input" value={v.language} placeholder="en" onChange={(e) => onPatch('voice', { language: e.target.value })} /></Field>
        <Group label="Caption rules" hint="One per line."><LinesInput value={v.captionRules} rows={3} onChange={(captionRules) => onPatch('voice', { captionRules })} /></Group>
      </div>
    </div>
  );
}
