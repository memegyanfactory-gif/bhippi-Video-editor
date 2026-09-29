// A copy button for a chat message that says it worked.
import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { useToast } from '../components/ui';
import { copyText } from '../lib/clipboard';

export function CopyAction({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const toast = useToast();
  return (
    <button
      type="button"
      className={`msg-action${copied ? ' copied' : ''}`}
      title={copied ? 'Copied' : label}
      aria-label={label}
      disabled={!text.trim()}
      onClick={() => {
        void copyText(text).then((done) => {
          if (!done) {
            toast({ tone: 'error', title: 'Copy failed', body: 'Select the text and press Ctrl+C instead.' });
            return;
          }
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1100);
        });
      }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}
