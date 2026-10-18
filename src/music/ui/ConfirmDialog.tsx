// A small in-studio confirm dialog (the webview's window.confirm is not dependable), used before a
// template replaces the song or a pattern in use is removed.
import type { ConfirmRequest } from './ctx';

export type PendingConfirm = ConfirmRequest & { resolve: (ok: boolean) => void };

export function ConfirmDialog({ pending, onDone }: { pending: PendingConfirm; onDone: () => void }) {
  const answer = (ok: boolean) => { pending.resolve(ok); onDone(); };
  return (
    <div className="ms-modal" role="presentation">
      <div className="ms-dialog" role="alertdialog" aria-label={pending.title}>
        <h3>{pending.title}</h3>
        <p>{pending.body}</p>
        <div className="ms-dialog-row">
          <button type="button" className="ms-btn" autoFocus onClick={() => answer(false)}>Cancel</button>
          <button type="button" className="ms-btn ms-primary" onClick={() => answer(true)}>{pending.ok}</button>
        </div>
      </div>
    </div>
  );
}
