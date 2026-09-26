// Settings › Privacy & legal: exactly what Bhippi sends and to whom, the person's choices over it,
// and the legal documents themselves, readable offline. The documents live in ./legal.ts.
import { ArrowLeft, ChevronRight, Download, ExternalLink, FileText, LogOut, Mail, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/ipc';
import { ACCOUNT_URL, licenseStore, useLicense } from '../license/licenseStore';
import { LEGAL, LEGAL_DOCS } from './legal';
import { Row, Section, SettingsHeader } from './SettingsLayout';

const COLLECTED: [title: string, hint: string][] = [
  ['Google account', 'Email, name and profile picture — to sign you in and link your key. Nothing else from Google.'],
  ['IP address', 'Seen by bhippi.com on sign-in, license and update checks — for security and abuse prevention.'],
  ['This PC', 'A one-way device ID, the computer name, Windows and Bhippi versions — so one key covers two PCs.'],
  ['License and purchase', 'Your key, its status and what you bought. Card details stay with the payment partner.'],
];

const NEVER: [title: string, hint: string][] = [
  ['Your footage and projects', 'Media, timelines, captions, transcripts and exports stay on this computer.'],
  ['Your AI chats and memory', 'Kept in the data folder here. We never receive them.'],
  ['Your provider keys', 'Stored in this computer’s credential store, never in a project or on our server.'],
  ['Tracking', 'No analytics and no advertising IDs. Crash reports and feedback are sent only when you press Send.'],
];

const DIRECT: [title: string, hint: string][] = [
  ['AI providers you connect', 'Your message and the context it needs — timeline summary, relevant text, sometimes still frames — go straight to that provider under your account.'],
  ['Online media search', 'Meme, sound and footage searches go to those sites, which see your IP address.'],
  ['Brand kit from a website', 'Bhippi fetches the page you give it.'],
  ['Crash reports and feedback', 'Only when you press Send: what you wrote, the errors caught, Bhippi’s logs (home-folder paths and keys masked) and, if left ticked, a small screenshot of the Bhippi window — to bhippi.com.'],
];

function mail(subject: string) {
  void api.openUrl(`mailto:${LEGAL.email}?subject=${encodeURIComponent(subject)}`);
}

export function PrivacySettings() {
  const [open, setOpen] = useState<string | null>(null);
  const { status } = useLicense();
  const signedIn = status != null && status.state !== 'signed_out';
  const doc = LEGAL_DOCS.find((item) => item.id === open);

  if (doc) {
    return (
      <div className="legal-doc">
        <button type="button" className="set-link" onClick={() => setOpen(null)}><ArrowLeft size={12} /> Privacy &amp; legal</button>
        <h3>{doc.title}</h3>
        <p className="legal-meta">{LEGAL.product} · {LEGAL.owner} · Effective {LEGAL.effective}</p>
        {doc.blocks.map((block, index) => (
          <div key={index}>
            {block.h && <h4>{block.h}</h4>}
            {block.p && <p>{block.p}</p>}
            {block.list && <ul>{block.list.map((item) => <li key={item}>{item}</li>)}</ul>}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="privacy-settings">
      <SettingsHeader title="Privacy &amp; legal">
        Bhippi runs on your computer. It collects only what it needs to sell you a license and keep it working — and nothing about what you make.
      </SettingsHeader>

      <Section title="What we collect">
        {COLLECTED.map(([title, hint]) => <Row key={title} title={title} hint={hint} />)}
      </Section>

      <Section title="What we never collect">
        {NEVER.map(([title, hint]) => <Row key={title} title={title} hint={hint} />)}
      </Section>

      <Section title="Sent from this PC only when you use it">
        {DIRECT.map(([title, hint]) => <Row key={title} title={title} hint={hint} />)}
      </Section>

      <Section title="Your data, your choice">
        <Row title="See and manage your account" hint="Your key, your PCs and your purchases.">
          <button type="button" className="btn" onClick={() => void api.openUrl(ACCOUNT_URL)}><ExternalLink size={14} /> Open</button>
        </Row>
        <Row title="Get a copy of your data" hint="We send everything we hold about you within 30 days.">
          <button type="button" className="btn" onClick={() => mail('Data access request')}><Download size={14} /> Request</button>
        </Row>
        <Row title="Delete your account" hint="Removes your account, PCs and key within 30 days. Purchase records stay as tax law requires. Your license ends.">
          <button type="button" className="btn" onClick={() => mail('Account deletion request')}><Trash2 size={14} /> Request</button>
        </Row>
        {signedIn && (
          <Row title="Sign out on this PC" hint="Removes the sign-in and license from this computer’s credential store.">
            <button
              type="button"
              className="btn"
              onClick={() => {
                if (window.confirm('Sign out of Bhippi on this PC? You’ll need to sign in again to keep using it.')) void licenseStore.signOut();
              }}
            >
              <LogOut size={14} /> Sign out
            </button>
          </Row>
        )}
        <Row title="Grievance officer" hint={`${LEGAL.owner} · ${LEGAL.email} · answered within 24 hours, resolved within 15 days.`}>
          <button type="button" className="btn" onClick={() => mail('Privacy question')}><Mail size={14} /> Write</button>
        </Row>
      </Section>

      <Section title="Documents">
        {LEGAL_DOCS.map((item) => (
          <Row key={item.id} title={<span className="legal-title"><FileText size={13} /> {item.title}</span>} hint={item.summary}>
            <button type="button" className="set-link" onClick={() => setOpen(item.id)}>Read <ChevronRight size={12} /></button>
          </Row>
        ))}
      </Section>
    </div>
  );
}
