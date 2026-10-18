// The toolbar's pattern picker: select, rename, colour, new, clone and remove a pattern.
import { useEffect, useState } from 'react';
import { Copy, Layers, Pencil, Plus, Trash2 } from 'lucide-react';
import { addPattern, clonePattern, removePattern, updatePattern } from '../model';
import { ColorInput } from './Controls';
import { useActions, useStudio } from './ctx';

export function PatternPicker() {
  const { song, pattern } = useStudio();
  const act = useActions();
  const { edit, drag, settle, setView, toast } = act;
  const [renaming, setRenaming] = useState(false);
  useEffect(() => { if (!pattern) setRenaming(false); }, [pattern]);

  const add = () => edit((s) => {
    const r = addPattern(s, 1);
    return { ...r.song, view: { ...r.song.view, activePatternId: r.pattern.id } };
  }, 'new pattern');
  const clone = () => pattern && edit((s) => {
    const r = clonePattern(s, pattern.id);
    return r ? { ...r.song, view: { ...r.song.view, activePatternId: r.pattern.id } } : s;
  }, 'clone pattern');
  const remove = async () => {
    if (!pattern) return;
    if (song.patterns.length <= 1) {
      toast({ tone: 'info', title: 'A song needs one pattern', body: 'Add another pattern before removing this one.' });
      return;
    }
    const used = song.playlist.clips.filter((c) => c.patternId === pattern.id).length;
    if (used && !(await act.confirm({ title: `Remove ${pattern.name}?`, body: `It is used by ${used} playlist clip${used === 1 ? '' : 's'}, which will go with it.`, ok: 'Remove' }))) return;
    edit((s) => removePattern(s, pattern.id), 'remove pattern');
  };

  return (
    <div className="ms-patpick" title="Active pattern">
      <Layers size={13} className="ms-patpick-icon" />
      {renaming && pattern ? (
        <input
          className="ms-input" autoFocus defaultValue={pattern.name} aria-label="Pattern name"
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenaming(false); }}
          onBlur={(e) => {
            const name = e.target.value.trim();
            setRenaming(false);
            if (name && name !== pattern.name) edit((s) => updatePattern(s, pattern.id, (p) => ({ ...p, name })), 'rename pattern');
          }}
        />
      ) : (
        <select aria-label="Pattern" value={pattern?.id ?? ''} onChange={(e) => setView({ activePatternId: e.target.value })}>
          {song.patterns.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      )}
      <ColorInput
        label="Pattern colour" value={pattern?.color ?? '#5b8def'}
        onChange={(color) => pattern && drag((s) => updatePattern(s, pattern.id, (p) => ({ ...p, color })))} onEnd={() => settle('Music: pattern colour')}
      />
      <button type="button" className="ms-tbtn sm" onClick={add} title="New pattern" aria-label="New pattern"><Plus size={13} /></button>
      <button type="button" className="ms-tbtn sm" onClick={clone} title="Clone pattern" aria-label="Clone pattern" disabled={!pattern}><Copy size={13} /></button>
      <button type="button" className="ms-tbtn sm" onClick={() => setRenaming(true)} title="Rename pattern" aria-label="Rename pattern" disabled={!pattern}><Pencil size={13} /></button>
      <button type="button" className="ms-tbtn sm" onClick={() => void remove()} title="Remove pattern" aria-label="Remove pattern" disabled={!pattern}><Trash2 size={13} /></button>
    </div>
  );
}
