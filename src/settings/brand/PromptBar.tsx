// "Talk to your brand": a floating prompt bar. The request goes to Bhippi's AI through the
// `bhippi:brand-prompt` window event (src/lib/brandKit/promptEvent.ts); when the kit changes the
// boards it touched flash (see BrandKitSettings) and the bar says what changed.

import { ArrowUp, Check, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { BrandKit } from '../../lib/brandKit';
import { requestBrandChange } from '../../lib/brandKit/promptEvent';
import { BOARDS } from './helpers';

const IDEAS = ['make it feel more premium', 'warmer reds', 'a rounder, friendlier logo', 'calmer, slower motion', 'bolder headlines', 'switch to a dark, cinematic look'];

export function PromptBar({ kit, aiChanged }: { kit: BrandKit; aiChanged: { boards: string[]; at: number } | null }) {
  const [text, setText] = useState('');
  const [state, setState] = useState<{ phase: 'idle' | 'sent' | 'done'; text: string; at: number; boards: string[] }>({ phase: 'idle', text: '', at: 0, boards: [] });
  const [focus, setFocus] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const send = (value = text) => {
    if (!requestBrandChange({ kitId: kit.id, kitName: kit.name, text: value })) return;
    setState({ phase: 'sent', text: value.trim(), at: Date.now(), boards: [] });
    setText('');
  };
  // The AI answered: its edits arrive as a kit change the shell reports here.
  useEffect(() => {
    if (state.phase === 'sent' && aiChanged && aiChanged.at > state.at) setState((s) => ({ ...s, phase: 'done', boards: aiChanged.boards }));
  }, [aiChanged, state.phase, state.at]);
  useEffect(() => {
    if (state.phase === 'idle') return;
    const id = window.setTimeout(() => setState((s) => ({ ...s, phase: 'idle' })), state.phase === 'done' ? 6000 : 150000);
    return () => window.clearTimeout(id);
  }, [state.phase, state.at, state.boards]);
  const names = state.boards.map((b) => BOARDS.find((x) => x.id === b)?.label ?? b);
  return (
    <div className={`bs-prompt${focus ? ' focus' : ''} ${state.phase}`}>
      {(focus || state.phase !== 'idle') && (
        <div className="bs-prompt-top">
          {state.phase === 'sent' && <span className="bs-prompt-status"><i className="bs-dots"><b /><b /><b /></i> Bhippi AI is working on “{state.text}”. Changes appear here as they land.</span>}
          {state.phase === 'done' && <span className="bs-prompt-status ok"><Check size={13} strokeWidth={3} /> Updated {names.slice(0, 4).join(', ')}{names.length > 4 ? ` and ${names.length - 4} more` : ''}.</span>}
          {state.phase === 'idle' && <span className="bs-ideas">{IDEAS.slice(0, 4).map((idea) => <button key={idea} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => send(idea)}>{idea}</button>)}</span>}
        </div>
      )}
      <form className="bs-prompt-bar" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <Sparkles size={17} className="bs-prompt-spark" aria-hidden="true" />
        <input ref={input} value={text} onChange={(e) => setText(e.target.value)} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} placeholder="Describe a change… e.g. make it feel more premium, warmer reds, a rounder logo" aria-label={`Ask Bhippi AI to change ${kit.name}`} />
        <button type="submit" className="bs-prompt-send" disabled={!text.trim()} aria-label="Send to Bhippi AI"><ArrowUp size={16} strokeWidth={2.6} /></button>
      </form>
    </div>
  );
}
