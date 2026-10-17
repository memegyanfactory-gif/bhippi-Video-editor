// Signing in to Hugging Face, in one place. Gated models (FLUX, Llama and others) ask you to sign in
// and accept their terms; this walks through it and tells its parent when the model can be
// downloaded. The token is checked and kept by the Rust side (hf_auth.rs); it is never kept here.
import { ExternalLink, LoaderCircle, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorText } from '../../lib/ipc';
import { hfDisplayName, hfStep } from '../../lib/hfSteps';
import { libraryApi, type HfAccess, type HfStatus } from '../../lib/modelLibrary';
import { MakerLogo } from '../llm/parts';

// One shared answer, so the Engines page and an open model panel never disagree.
let current: HfStatus | null = null;
const listeners = new Set<(status: HfStatus | null) => void>();
const publish = (status: HfStatus | null) => { current = status; listeners.forEach((listener) => listener(status)); };

/** Who is signed in to Hugging Face (null until it is known), and a way to ask again. */
export function useHfStatus() {
  const [status, setStatus] = useState<HfStatus | null>(current);
  useEffect(() => {
    listeners.add(setStatus);
    setStatus(current);
    let live = true;
    if (!current) libraryApi.hfStatus().then((next) => { if (live) publish(next); }).catch(() => { if (live && !current) publish({ signedIn: false, name: '', fullname: '', avatarPath: null, canReadGated: false, tokenRole: '' }); });
    return () => { live = false; listeners.delete(setStatus); };
  }, []);
  return status;
}

const openTokenPage = async () => { await api.openUrl(await libraryApi.hfTokenPage()); };

/** The paste-a-token panel: two steps, one field. */
function SignInPanel({ onDone, onCancel }: { onDone: (status: HfStatus) => void; onCancel?: () => void }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    if (!token.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const next = await libraryApi.hfSignIn(token);
      setToken('');
      publish(next);
      onDone(next);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="hf-panel" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <ol className="hf-steps">
        <li>
          <span>Open Hugging Face and create a read token. It opens in your browser, ready to make.</span>
          <button type="button" className="btn btn-small" onClick={() => void openTokenPage().catch((failure) => setError(errorText(failure)))}><ExternalLink size={12} /> Open Hugging Face</button>
        </li>
        <li>
          <span>Copy the token and paste it here.</span>
          <input className="ml-input" type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="hf_…" autoComplete="off" spellCheck={false} aria-label="Hugging Face read token" autoFocus />
        </li>
      </ol>
      {error && <p className="hf-error" role="alert">{error}</p>}
      <div className="hf-actions">
        {onCancel && <button type="button" className="btn btn-small btn-ghost" onClick={onCancel}>Not now</button>}
        <button type="submit" className="btn btn-small btn-primary" disabled={busy || !token.trim()}>{busy && <LoaderCircle size={12} className="spin" />} Sign in</button>
      </div>
      <p className="hf-fine">Bhippi keeps the token in the Windows credential store and sends it only to huggingface.co.</p>
    </form>
  );
}

/**
 * The sign-in steps for a gated download. `repo` is the Hugging Face repository to check access to
 * (leave it out to only ask for a sign-in). `onAccess` hears whether the download may go ahead; the
 * box itself disappears once it may.
 */
export function HfSignIn({ repo, modelName, onAccess }: { repo: string | null; modelName?: string; onAccess?: (granted: boolean) => void }) {
  const status = useHfStatus();
  const [access, setAccess] = useState<HfAccess | null>(null);
  const [checking, setChecking] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const report = useRef(onAccess);
  report.current = onAccess;

  const check = useCallback(async () => {
    if (!repo) return;
    setChecking(true);
    setError('');
    try {
      setAccess(await libraryApi.hfRepoAccess(repo));
    } catch (failure) {
      setAccess(null);
      setError(errorText(failure));
    } finally {
      setChecking(false);
    }
  }, [repo]);

  // Ask Hugging Face again whenever the repository or the signed-in account changes.
  const account = status ? `${status.signedIn}:${status.name}` : null;
  useEffect(() => {
    setAccess(null);
    if (account && status?.signedIn && repo) void check();
  }, [account, repo, check]);

  const step = hfStep(status, access, repo);
  useEffect(() => { report.current?.(step === 'ready'); }, [step]);

  // Terms are accepted in the browser: look again as soon as the person comes back to Bhippi.
  useEffect(() => {
    if (step !== 'accept-terms' && step !== 'unknown') return undefined;
    const back = () => { if (!document.hidden) void check(); };
    window.addEventListener('focus', back);
    document.addEventListener('visibilitychange', back);
    return () => {
      window.removeEventListener('focus', back);
      document.removeEventListener('visibilitychange', back);
    };
  }, [step, check]);

  if (step === 'ready') return null;
  if (step === 'checking') {
    return <div className="hf-box"><span className="hf-line"><LoaderCircle size={13} className="spin" /> Checking your Hugging Face access…</span></div>;
  }
  const subject = modelName ?? repo ?? 'This model';
  return (
    <div className="hf-box">
      <div className="hf-line">
        <TriangleAlert size={14} />
        {step === 'sign-in' && <span>{subject} asks you to sign in to Hugging Face and accept its terms. Sign in here and you can download it in Bhippi.</span>}
        {step === 'accept-terms' && <span>You are signed in{status ? ` as ${hfDisplayName(status)}` : ''}. {subject} still needs you to accept its terms on Hugging Face.</span>}
        {step === 'unknown' && <span>Bhippi could not tell whether this account may download {subject}. Check your connection, then check again.</span>}
      </div>
      {step === 'sign-in' && !open && <div className="hf-actions"><button type="button" className="btn btn-small btn-primary" onClick={() => setOpen(true)}>Sign in to Hugging Face</button></div>}
      {step === 'sign-in' && open && <SignInPanel onDone={() => setOpen(false)} onCancel={() => setOpen(false)} />}
      {(step === 'accept-terms' || step === 'unknown') && (
        <div className="hf-actions">
          {step === 'accept-terms' && <button type="button" className="btn btn-small btn-primary" onClick={() => void api.openUrl(access?.termsUrl ?? `https://huggingface.co/${repo}`)}><ExternalLink size={12} /> Accept the terms on Hugging Face</button>}
          <button type="button" className="btn btn-small" disabled={checking} onClick={() => void check()}>{checking && <LoaderCircle size={12} className="spin" />} Check again</button>
        </div>
      )}
      {error && <p className="hf-error" role="alert">{error}</p>}
    </div>
  );
}

/** The Engines page row: who is signed in to Hugging Face, with Sign in or Sign out. */
export function HfAccountRow() {
  const status = useHfStatus();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const signOut = async () => {
    setBusy(true);
    setError('');
    try {
      await libraryApi.hfSignOut();
      publish({ signedIn: false, name: '', fullname: '', avatarPath: null, canReadGated: false, tokenRole: '' });
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={`ml-engine${status?.signedIn ? ' running' : ''}`}>
      <div className="ml-engine-row">
        {status?.signedIn && status.name ? <MakerLogo path={status.avatarPath} name={status.name} size={26} /> : <span className="ml-engine-dot" aria-hidden="true" />}
        <div className="ml-engine-text">
          <strong>Hugging Face</strong>
          <span>{!status ? 'Checking…' : status.signedIn ? (status.name ? `Signed in as ${hfDisplayName(status)}` : 'Signed in') : 'Not signed in. Needed for models that ask you to accept terms.'}</span>
        </div>
        <div className="ml-engine-actions">
          {status?.signedIn
            ? <button type="button" className="btn btn-small" disabled={busy} onClick={() => void signOut()}>Sign out</button>
            : status && !open && <button type="button" className="btn btn-small btn-primary" onClick={() => setOpen(true)}>Sign in</button>}
        </div>
      </div>
      {open && !status?.signedIn && <SignInPanel onDone={() => setOpen(false)} onCancel={() => setOpen(false)} />}
      {error && <p className="hf-error" role="alert">{error}</p>}
    </div>
  );
}
