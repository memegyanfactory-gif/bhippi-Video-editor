// Which step of the Hugging Face sign-in a gated download is on. Pure, so it can be tested: the
// screen (settings/library/HfSignIn.tsx) only draws what this says.
import type { HfAccess, HfStatus } from './modelLibrary';

export type HfStep = 'checking' | 'sign-in' | 'accept-terms' | 'ready' | 'unknown';

/**
 * `status` is who is signed in (null while unknown), `access` what Hugging Face said about `repo`
 * (null while it is being asked). Without a repository only the sign-in matters.
 */
export function hfStep(status: HfStatus | null, access: HfAccess | null, repo: string | null): HfStep {
  if (!status) return 'checking';
  if (!status.signedIn) return 'sign-in';
  if (!repo) return 'ready';
  if (!access) return 'checking';
  switch (access.access) {
    case 'granted': return 'ready';
    case 'needs-terms': return 'accept-terms';
    case 'needs-sign-in': return 'sign-in';
    default: return 'unknown';
  }
}

/** The `owner/name` of a Hugging Face model page or file address, or null for anything else. */
export function hfRepoOf(url: string | null | undefined): string | null {
  const match = /^https:\/\/(?:www\.)?huggingface\.co\/([\w.-]+\/[\w.-]+?)(?:\/(?:resolve|blob|tree)\/.*|\/?)$/.exec(url ?? '');
  return match ? match[1] : null;
}

/** The name to show for a signed-in account. */
export const hfDisplayName = (status: HfStatus): string => status.fullname || status.name || 'your Hugging Face account';
