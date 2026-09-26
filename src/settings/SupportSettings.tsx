// Settings › Help & feedback: send a crash report or feedback by hand, choose whether the report
// window opens by itself, and see what is still waiting to be sent.
import { Bug, FolderOpen, LoaderCircle, MessageSquareHeart, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Toggle, useToast } from '../components/ui';
import { crashReporter, useCrashReporter } from '../lib/crashReporter';
import { api, errorText } from '../lib/ipc';
import { Row, Section, SettingsHeader } from './SettingsLayout';

export function SupportSettings({ dataDir, onClose }: { dataDir?: string; onClose: () => void }) {
  useCrashReporter(); // re-render when the auto-show switch changes
  const toast = useToast();
  const [waiting, setWaiting] = useState<number | null>(null);
  const [flushing, setFlushing] = useState(false);
  const caught = crashReporter.errors();

  useEffect(() => {
    void api.supportOutboxCount().then(setWaiting, () => setWaiting(0));
  }, []);

  const flush = async () => {
    setFlushing(true);
    try {
      const sent = await api.supportFlushOutbox();
      const left = await api.supportOutboxCount();
      setWaiting(left);
      toast(left ? { tone: 'error', title: 'Still offline', body: `${sent} sent, ${left} still waiting. They go out on the next launch.` } : { tone: 'success', title: 'Reports sent', body: `${sent} report${sent === 1 ? '' : 's'} reached the Bhippi team.` });
    } catch (error) {
      toast({ tone: 'error', title: 'Could not send', body: errorText(error) });
    } finally {
      setFlushing(false);
    }
  };

  return (
    <div className="support-settings">
      <SettingsHeader title="Help &amp; feedback">
        Something not working? Send a report straight to the Bhippi team, with a screenshot and the logs we need to fix it. Nothing is sent until you press Send.
      </SettingsHeader>

      <Section title="Report a problem">
        <Row title="Send a crash report" hint={`Settings closes, the editor is captured, and the report opens with Bhippi’s logs${caught.length ? ` and the ${caught.length} error${caught.length === 1 ? '' : 's'} caught this session` : ''}. You can untick the screenshot or the logs before sending.`}>
          <button type="button" className="btn btn-primary" onClick={() => void crashReporter.openManual(onClose)}><Bug size={14} /> Report a problem</button>
        </Row>
        <Row title="Open the report window when something goes wrong" hint="When Bhippi catches an error, or crashed last time, the report opens by itself so you can send it in one click.">
          <Toggle checked={crashReporter.autoShow()} onChange={(on) => crashReporter.setAutoShow(on)} label="Open the report window automatically" />
        </Row>
        {!!waiting && (
          <Row title={`${waiting} report${waiting === 1 ? '' : 's'} waiting to send`} hint="Saved while this PC was offline. They are sent automatically on the next launch.">
            <button type="button" className="btn" onClick={() => void flush()} disabled={flushing}>{flushing ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />} Send now</button>
          </Row>
        )}
      </Section>

      <Section title="Feedback">
        <Row title="Tell us what you think" hint="Pick a face and add a few words — what you love, what’s missing, what gets in the way.">
          <button type="button" className="btn" onClick={() => { onClose(); crashReporter.openFeedback(); }}><MessageSquareHeart size={14} /> Send feedback</button>
        </Row>
      </Section>

      {dataDir && (
        <Section title="Logs on this PC">
          <Row title="Logs folder" hint="bhippi.log (this session), bhippi.previous.log (the last one) and hang.log. crash.log is in the data folder above it.">
            <button type="button" className="btn" onClick={() => void api.openPath(`${dataDir}\\logs`)}><FolderOpen size={14} /> Open</button>
          </Row>
        </Section>
      )}
    </div>
  );
}
