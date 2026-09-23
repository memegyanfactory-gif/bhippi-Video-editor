// A guideline, plan, storyboard or research note from the project folder, rendered as Markdown.
// It follows the file: when the AI edits it (or it changes on disk) the view reloads.
import { ExternalLink, FolderOpen, RotateCw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Markdown } from '../components/Markdown';
import { Modal } from '../components/ui';
import { api, errorText, events, type ProjectDoc } from '../lib/ipc';
import { checklistGlyphs, docTitle } from '../lib/projectDocs';
import '../styles/docs.css';

type Props = { doc: ProjectDoc; onClose: () => void; onDelete?: (doc: ProjectDoc) => void };

export function DocViewer({ doc, onClose, onDelete }: Props) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.projectDocRead(doc.path)
      .then((content) => { setText(content); setError(null); })
      .catch((reason) => setError(errorText(reason)));
  }, [doc.path]);

  useEffect(() => {
    load();
    const pending = events.docs(load);
    window.addEventListener('focus', load);
    return () => {
      window.removeEventListener('focus', load);
      void pending.then((unlisten) => unlisten());
    };
  }, [load]);

  const modified = doc.modified ? new Date(doc.modified * 1000).toLocaleString() : '';
  return (
    <Modal
      title={docTitle(doc, text)}
      onClose={onClose}
      width={780}
      footer={(
        <>
          <span className="doc-viewer-path" title={doc.path}>{doc.legacy ? doc.path : `${doc.relative}`}{modified && ` · ${modified}`}</span>
          <span className="toolbar-spacer" />
          <button type="button" className="icon-btn" title="Reload" onClick={load}><RotateCw size={14} /></button>
          <button type="button" className="btn" onClick={() => void api.revealPath(doc.path)}><FolderOpen size={13} /> Show in folder</button>
          <button type="button" className="btn" onClick={() => void api.openPath(doc.path)}><ExternalLink size={13} /> Open</button>
          {onDelete && <button type="button" className="btn doc-viewer-delete" onClick={() => onDelete(doc)}><Trash2 size={13} /> Delete</button>}
        </>
      )}
    >
      <div className="doc-viewer">
        {error ? (
          <p className="doc-viewer-empty">{error}</p>
        ) : text === null ? (
          <p className="doc-viewer-empty">Reading…</p>
        ) : text.trim() ? (
          <Markdown text={checklistGlyphs(text)} />
        ) : (
          <p className="doc-viewer-empty">This document is empty.</p>
        )}
      </div>
    </Modal>
  );
}
