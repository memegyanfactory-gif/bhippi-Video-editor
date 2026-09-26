// The crash report panel and the small feedback card, mounted once beside the app (outside its
// error boundary, so they still work when the editor itself has crashed). What they send and how is
// in lib/crashReporter.ts and src-tauri/src/support.rs.
import { Angry, Camera, Check, ChevronRight, Frown, Laugh, LoaderCircle, Meh, RefreshCw, Send, Smile, X } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, errorText, type SupportLogs, type SupportOutcome } from '../lib/ipc';
import { crashReporter, reportContext, reportSignature, reportTitle, terminalLogText, useCrashReporter, type CapturedError, type CrashDialog, type FeedbackCard as FeedbackState } from '../lib/crashReporter';
import { Modal } from './ui';
import '../styles/support.css';

export function SupportLayer() {
  const { dialog, feedback } = useCrashReporter();

  // On launch: send what waited offline, then offer a report for a crash in the last session.
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void api.supportFlushOutbox().catch(() => 0);
      void api.supportNewCrashes().then((text) => {
        if (!cancelled && text && crashReporter.autoShow()) crashReporter.openPreviousSession(text);
      }, () => undefined);
    }, 2500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <>
      {dialog && <CrashReportDialog dialog={dialog} />}
      {feedback && <FeedbackCard state={feedback} />}
    </>
  );
}

// ───────────────────────────── crash report ─────────────────────────────

const HEADINGS: Record<CrashDialog['mode'], { title: string; intro: string; ask: string; placeholder: string }> = {
  crash: {
    title: 'Something went wrong',
    intro: 'Bhippi caught an error. Your project is autosaved, so nothing is lost. Sending this report goes straight to the Bhippi team and helps us fix it.',
    ask: 'What were you doing when it happened?',
    placeholder: 'e.g. I dragged a clip onto the second video track and the timeline went blank.',
  },
  previous_session: {
    title: 'Bhippi closed unexpectedly',
    intro: 'Bhippi crashed the last time it was open. Sending a report with what happened helps us stop it happening again.',
    ask: 'What were you doing before it closed?',
    placeholder: 'e.g. Exporting a 4K video with captions — it closed at about 60%.',
  },
  manual: {
    title: 'Report a problem',
    intro: 'Tell us what went wrong. The report includes a screenshot and Bhippi’s logs, so we can see exactly what you saw.',
    ask: 'What went wrong?',
    placeholder: 'What you did, what you expected, and what happened instead.',
  },
};

function CrashReportDialog({ dialog }: { dialog: CrashDialog }) {
  const { capturing, hidden } = useCrashReporter();
  const [description, setDescription] = useState('');
  const [includeShot, setIncludeShot] = useState(!!dialog.screenshot);
  const [includeLogs, setIncludeLogs] = useState(true);
  const [preview, setPreview] = useState(false);
  const [logs, setLogs] = useState<SupportLogs | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<SupportOutcome | null>(null);
  const head = HEADINGS[dialog.mode];
  const needsText = dialog.mode === 'manual' && description.trim().length < 6;
  const shotUrl = useMemo(() => (dialog.screenshot ? `data:${dialog.screenshot.mime};base64,${dialog.screenshot.data}` : null), [dialog.screenshot]);
  const terminal = useMemo(() => (preview ? terminalLogText(120) : ''), [preview]);

  useEffect(() => setIncludeShot(!!dialog.screenshot), [dialog.screenshot]);
  useEffect(() => {
    if (preview && !logs) void api.supportLogs(dialog.mode === 'previous_session').then(setLogs, () => setLogs({ appLog: null, previousLog: null, crashLog: null, hangLog: null }));
  }, [preview, logs, dialog.mode]);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const context = await reportContext();
      const errors: Partial<CapturedError>[] = [...dialog.errors];
      if (dialog.previousCrash) errors.unshift({ source: 'manual', name: 'Previous session', message: 'crash.log entries from the session that closed', stack: dialog.previousCrash, at: new Date().toISOString(), count: 1 });
      const result = await api.supportSendCrash({
        kind: dialog.mode,
        title: reportTitle(dialog, description),
        description: description.trim(),
        signature: reportSignature(dialog),
        errors,
        frontendLog: includeLogs ? terminalLogText() : '',
        context,
        screenshot: includeShot ? dialog.screenshot : null,
        includeLogs,
      });
      setOutcome(result);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };

  if (hidden) return null;
  if (outcome) {
    return (
      <Modal title={outcome.queued ? 'Report saved' : 'Report sent'} onClose={() => crashReporter.close()} width={440} top className="support-modal"
        footer={<><span className="support-spacer" /><button type="button" className="btn btn-primary" onClick={() => crashReporter.close()}>Done</button></>}>
        <div className="support-done">
          <span className={`support-done-icon${outcome.queued ? ' queued' : ''}`}>{outcome.queued ? <RefreshCw size={20} /> : <Check size={20} />}</span>
          <div>
            <strong>{outcome.queued ? 'You seem to be offline.' : 'Thanks — the Bhippi team has it.'}</strong>
            <p>{outcome.queued ? 'The report is saved on this PC and will be sent the next time Bhippi opens with a connection.' : 'We read every report. If you are signed in, we may email you about it.'}</p>
            {outcome.id && <p className="support-id">Report ID <code>{outcome.id.slice(0, 8)}</code></p>}
          </div>
        </div>
      </Modal>
    );
  }

  const first = dialog.errors[0];
  return (
    <Modal title={head.title} onClose={() => !busy && crashReporter.close()} width={620} top className="support-modal"
      footer={
        <>
          {error ? <span className="support-error">{error}</span> : <span className="support-note">Sent to bhippi.com with your account, app and Windows version. Home-folder paths and keys are masked.</span>}
          <span className="support-spacer" />
          <button type="button" className="btn" disabled={busy} onClick={() => crashReporter.close()}>{dialog.mode === 'manual' ? 'Cancel' : 'Don’t send'}</button>
          <button type="button" className="btn btn-primary" disabled={busy || needsText} onClick={() => void send()}>
            {busy ? <LoaderCircle size={14} className="spin" /> : <Send size={14} />} {busy ? 'Sending…' : 'Send report'}
          </button>
        </>
      }>
      <div className="support-body">
        <p className="support-intro">{head.intro}</p>

        {(first || dialog.previousCrash) && (
          <details className="support-error-box">
            <summary>
              <ChevronRight size={13} className="support-caret" />
              <span className="support-error-title">{first ? `${first.name}: ${first.message}` : (dialog.previousCrash?.match(/Payload: (.+)/)?.[1] ?? 'Crash details')}</span>
              {dialog.errors.length > 1 && <span className="support-count">+{dialog.errors.length - 1} more</span>}
            </summary>
            <pre>{dialog.previousCrash ?? dialog.errors.map((entry) => `${entry.name}: ${entry.message}${entry.count > 1 ? ` (${entry.count}×)` : ''}\n${entry.stack ?? ''}${entry.componentStack ? `\nComponents:${entry.componentStack}` : ''}`).join('\n\n')}</pre>
          </details>
        )}

        <label className="support-field">
          <span>{head.ask}{dialog.mode !== 'manual' && <em> optional</em>}</span>
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder={head.placeholder} rows={4} maxLength={8000} autoFocus />
        </label>

        <div className="support-attach">
          <div className="support-shot">
            {shotUrl ? (
              <img src={shotUrl} alt="Screenshot of the Bhippi window" className={includeShot ? '' : 'off'} />
            ) : (
              <span className="support-shot-empty"><Camera size={18} />{dialog.screenshotError ? 'Couldn’t capture' : 'No screenshot'}</span>
            )}
          </div>
          <div className="support-options">
            <Check2 checked={includeShot} disabled={!dialog.screenshot} onChange={setIncludeShot}>
              Include screenshot {dialog.screenshot && <span className="support-dim">{Math.round(dialog.screenshot.bytes / 1024)} KB · {dialog.screenshot.width}×{dialog.screenshot.height}</span>}
            </Check2>
            <button type="button" className="btn btn-small" disabled={capturing || busy} onClick={() => void crashReporter.retakeScreenshot()}>
              {capturing ? <LoaderCircle size={13} className="spin" /> : <Camera size={13} />} {dialog.screenshot ? 'Retake' : 'Take screenshot'}
            </button>
            <Check2 checked={includeLogs} onChange={setIncludeLogs}>
              Include logs and error details <span className="support-dim">recommended</span>
            </Check2>
            <button type="button" className="set-link support-preview-toggle" onClick={() => setPreview((value) => !value)}>{preview ? 'Hide' : 'See'} what gets sent</button>
          </div>
        </div>

        {preview && (
          <div className="support-preview">
            <LogBlock title="Terminal (last 120 lines of up to 400 sent)" text={includeLogs ? terminal : null} />
            <LogBlock title="bhippi.log" text={includeLogs ? (logs ? logs.appLog : '…') : null} />
            {dialog.mode === 'previous_session' && <LogBlock title="bhippi.log — the session that closed" text={includeLogs ? (logs ? logs.previousLog : '…') : null} />}
            <LogBlock title="crash.log" text={includeLogs ? (logs ? logs.crashLog : '…') : null} />
            <p className="support-dim">Also sent: this PC’s Bhippi device ID, name, Windows and Bhippi version, window size, project size (clip and media counts, not names or files), and the graphics card. Never your media or project files.</p>
          </div>
        )}
      </div>
    </Modal>
  );
}

function LogBlock({ title, text }: { title: string; text: string | null }) {
  return (
    <details className="support-log">
      <summary>{title}</summary>
      <pre>{text === null ? 'Not included.' : text || 'Empty.'}</pre>
    </details>
  );
}

function Check2({ checked, disabled, onChange, children }: { checked: boolean; disabled?: boolean; onChange: (value: boolean) => void; children: ReactNode }) {
  return (
    <label className={`support-check${disabled ? ' disabled' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

// ───────────────────────────── feedback card ─────────────────────────────

const FACES = [
  { rating: 1, label: 'Hate it', Icon: Angry },
  { rating: 2, label: 'Not great', Icon: Frown },
  { rating: 3, label: 'Okay', Icon: Meh },
  { rating: 4, label: 'Good', Icon: Smile },
  { rating: 5, label: 'Love it', Icon: Laugh },
];

function FeedbackCard({ state }: { state: FeedbackState }) {
  const [rating, setRating] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<SupportOutcome | null>(null);

  useEffect(() => {
    if (!done) return;
    const timer = window.setTimeout(() => crashReporter.closeFeedback(), 2600);
    return () => window.clearTimeout(timer);
  }, [done]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const context = await reportContext();
      setDone(await api.supportSendFeedback({ source: state.source, rating, message: message.trim(), context: { app: context.app, window: context.window, sessionMinutes: context.sessionMinutes } }));
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };

  const picked = FACES.find((face) => face.rating === rating);
  return (
    <aside className="feedback-card" role="dialog" aria-label="Feedback">
      <button type="button" className="icon-btn feedback-close" onClick={() => crashReporter.closeFeedback()} aria-label="Close"><X size={14} /></button>
      {done ? (
        <div className="feedback-thanks">
          <span className="support-done-icon"><Check size={18} /></span>
          <div>
            <strong>Thank you!</strong>
            <span>{done.queued ? 'Saved — it will be sent when you are back online.' : 'Your feedback went straight to the team.'}</span>
          </div>
        </div>
      ) : (
        <>
          <strong className="feedback-title">{state.source === 'first_render' ? 'Your first render is done! 🎉' : 'Send feedback'}</strong>
          <span className="feedback-ask">How do you like Bhippi so far?</span>
          <div className="feedback-faces" role="radiogroup" aria-label="Rating">
            {FACES.map(({ rating: value, label, Icon }) => (
              <button key={value} type="button" role="radio" aria-checked={rating === value} aria-label={label} title={label}
                className={`feedback-face face-${value}${rating === value ? ' active' : ''}`} onClick={() => setRating(rating === value ? null : value)}>
                <Icon size={22} strokeWidth={1.75} />
              </button>
            ))}
          </div>
          <span className="feedback-label">{picked ? picked.label : ' '}</span>
          <textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={3} maxLength={4000}
            placeholder={rating && rating <= 2 ? 'What should we fix first?' : 'Anything we should add or improve? (optional)'} aria-label="Feedback" />
          {error && <span className="support-error">{error}</span>}
          <div className="feedback-actions">
            <button type="button" className="btn btn-small" onClick={() => crashReporter.closeFeedback()} disabled={busy}>Close</button>
            <button type="button" className="btn btn-small btn-primary" onClick={() => void submit()} disabled={busy || (rating === null && !message.trim())}>
              {busy ? <LoaderCircle size={13} className="spin" /> : <Send size={13} />} Submit
            </button>
          </div>
        </>
      )}
    </aside>
  );
}
