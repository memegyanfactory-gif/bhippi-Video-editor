import { ChevronDown, FolderOpen, LoaderCircle, Maximize2, Minimize2, Moon, RefreshCw, Search, Sparkles, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Toggle, useToast } from '../components/ui';
import { api, errorText, events, type BrainGraph, type BrainNodeDetail, type BrainNodeKind } from '../lib/ipc';
import type { BrainStatus } from '../lib/ideagraph';
import type { Settings } from '../lib/types';
import { BrainMap, KIND_COLORS, KIND_LABELS } from './BrainMap';
import { Row, Section, SettingsHeader } from './SettingsLayout';

type Props = { settings: Settings; onSettings: (settings: Settings) => void };

const KINDS: BrainNodeKind[] = ['user', 'memory', 'skill', 'topic', 'tool', 'provider', 'episode'];

const when = (stamp: string) => {
  const date = new Date(stamp);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

/**
 * Settings → Brain: the live mind map of what Bhippi has learned — about the user, their
 * projects, the skills it wrote itself and how every tool performs — with an inspector,
 * filters, a dream (consolidation) button and the optional IdeaGraph mirror.
 */
export function BrainSettings({ settings, onSettings }: Props) {
  const toast = useToast();
  const [graph, setGraph] = useState<BrainGraph | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<BrainNodeDetail | null>(null);
  const [visible, setVisible] = useState<Set<BrainNodeKind>>(() => new Set(KINDS));
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [dreaming, setDreaming] = useState(false);
  const [lastLearned, setLastLearned] = useState<string | null>(null);

  const refresh = async () => {
    try {
      setGraph(await api.brainGraph());
      setLoadError(null);
    } catch (error) {
      setLoadError(errorText(error));
    }
  };

  // Load once, then redraw whenever the brain learns something (a turn, a memory, a skill).
  useEffect(() => {
    void refresh();
    const pending = events.brain(({ reason }) => {
      setLastLearned(reason);
      void refresh();
    });
    return () => void pending.then((unlisten) => unlisten());
  }, []);

  useEffect(() => {
    if (!selected) { setDetail(null); return; }
    let live = true;
    api.brainNode(selected).then((next) => live && setDetail(next)).catch(() => live && setDetail(null));
    return () => { live = false; };
  }, [selected, graph]);

  useEffect(() => {
    if (!expanded) return undefined;
    const key = (event: KeyboardEvent) => event.key === 'Escape' && setExpanded(false);
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [expanded]);

  const dream = async () => {
    setDreaming(true);
    try {
      const report = await api.brainDream();
      toast({ tone: 'success', title: 'The brain consolidated', body: `Merged ${report.merged} duplicate${report.merged === 1 ? '' : 's'}, let ${report.pruned} faded turn${report.pruned === 1 ? '' : 's'} go, dissolved ${report.topicsDissolved} empty topic${report.topicsDissolved === 1 ? '' : 's'}.` });
    } catch (error) {
      toast({ tone: 'error', title: 'Could not consolidate', body: errorText(error) });
    } finally {
      setDreaming(false);
    }
  };

  const forget = async () => {
    if (!detail) return;
    try {
      await api.brainForget(detail.node.id);
      setSelected(null);
      toast({ tone: 'success', title: 'Forgotten', body: detail.node.title });
    } catch (error) {
      toast({ tone: 'error', title: 'Could not forget it', body: errorText(error) });
    }
  };

  const toggleKind = (kind: BrainNodeKind) => setVisible((current) => {
    const next = new Set(current);
    if (next.has(kind)) next.delete(kind); else next.add(kind);
    return next.size ? next : new Set(KINDS);
  });

  const counts = useMemo(() => {
    const out = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<BrainNodeKind, number>;
    for (const node of graph?.nodes ?? []) out[node.kind] = (out[node.kind] ?? 0) + 1;
    return out;
  }, [graph]);

  const learning = settings.ideagraphRecord !== false;
  const empty = !!graph && graph.nodes.length === 0;

  const map = graph && (
    <div className={`brain-map${expanded ? ' expanded' : ''}`}>
      <div className="brain-map-toolbar">
        <div className="brain-legend">
          {KINDS.map((kind) => (
            <button key={kind} type="button" className={`brain-chip${visible.has(kind) ? ' on' : ''}`} onClick={() => toggleKind(kind)} title={`Show or hide ${KIND_LABELS[kind].toLowerCase()}`}>
              <span className="brain-dot" style={{ background: KIND_COLORS[kind] }} />
              {KIND_LABELS[kind]} <span className="brain-chip-count">{counts[kind]}</span>
            </button>
          ))}
        </div>
        <label className="brain-search">
          <Search size={12} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find in the brain" spellCheck={false} aria-label="Find in the brain" />
        </label>
        <button type="button" className="icon-btn" onClick={() => setExpanded((e) => !e)} title={expanded ? 'Exit full screen (Esc)' : 'Full screen'} aria-label={expanded ? 'Exit full screen' : 'Full screen'}>
          {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
      </div>
      <div className="brain-map-stage">
        <BrainMap graph={graph} selected={selected} onSelect={setSelected} visible={visible} search={search} />
        {empty && (
          <div className="brain-empty">
            <Sparkles size={18} />
            <strong>The brain is ready and listening</strong>
            <span>Every AI turn adds a dot. Tell the assistant what you like, and it will remember you, grow topics and write its own skills.</span>
          </div>
        )}
        {lastLearned && !empty && <div className="brain-live" key={`${lastLearned}-${graph.nodes.length}`}><span className="brain-live-dot" /> Learned: {lastLearned.replace('-', ' ')}</div>}
        {detail && (
          <aside className="brain-inspector">
            <div className="brain-inspector-head">
              <span className="brain-dot" style={{ background: KIND_COLORS[detail.node.kind] }} />
              <span className="brain-inspector-kind">{KIND_LABELS[detail.node.kind]}</span>
              <button type="button" className="icon-btn" onClick={() => setSelected(null)} aria-label="Close details"><X size={13} /></button>
            </div>
            <h5>{detail.node.title}</h5>
            {detail.node.body && detail.node.body !== detail.node.title && <p className="brain-inspector-body">{detail.node.body}</p>}
            {detail.procedure && <pre className="brain-procedure">{detail.procedure}</pre>}
            <dl className="brain-facts">
              {detail.node.uses > 0 && <><dt>Used</dt><dd>{detail.node.uses}×</dd></>}
              {(detail.node.kind === 'tool' || detail.node.kind === 'skill') && detail.node.wins + detail.node.fails > 0 && (
                <><dt>Success</dt><dd>{Math.round((detail.node.wins * 100) / (detail.node.wins + detail.node.fails))}% ({detail.node.wins}/{detail.node.wins + detail.node.fails})</dd></>
              )}
              {typeof detail.node.meta?.avgMs === 'number' && <><dt>Avg time</dt><dd>{(detail.node.meta.avgMs / 1000).toFixed(1)}s</dd></>}
              {typeof detail.node.meta?.version === 'string' && <><dt>Version</dt><dd>{detail.node.meta.version}</dd></>}
              {typeof detail.node.meta?.result === 'string' && <><dt>Result</dt><dd>{detail.node.meta.result}</dd></>}
              <dt>Learned</dt><dd>{when(detail.node.created)}</dd>
              {detail.node.updated !== detail.node.created && <><dt>Updated</dt><dd>{when(detail.node.updated)}</dd></>}
            </dl>
            {!!detail.neighbours.length && (
              <div className="brain-links">
                {detail.neighbours.slice(0, 14).map((n) => (
                  <button key={n.id} type="button" className="brain-link" onClick={() => setSelected(n.id)}>
                    <span className="brain-dot" style={{ background: KIND_COLORS[n.kind] }} />{n.title}
                  </button>
                ))}
              </div>
            )}
            <button type="button" className="btn btn-ghost danger brain-forget" onClick={() => void forget()}><Trash2 size={13} /> Forget this</button>
          </aside>
        )}
      </div>
    </div>
  );

  return (
    <div className="brain-settings">
      <SettingsHeader
        title="Brain"
        actions={(
          <div className="brain-actions">
            <button type="button" className="btn" onClick={() => void dream()} disabled={dreaming || !graph?.nodes.length} title="Merge duplicate memories, fade old turns and tidy topics">
              {dreaming ? <LoaderCircle size={14} className="spin" /> : <Moon size={14} />} Dream
            </button>
            {graph && <button type="button" className="btn" onClick={() => void api.revealPath(graph.dir)} title={graph.dir}><FolderOpen size={14} /> Folder</button>}
            <button type="button" className="btn" onClick={() => void refresh()}><RefreshCw size={14} /> Refresh</button>
          </div>
        )}
      >
        Bhippi&apos;s long-term memory. It learns you from every AI turn, remembers your preferences, grows topics from what you work on, and writes and improves its own skills. Nothing leaves this computer.
      </SettingsHeader>

      {graph && (
        <div className="brain-stats">
          <div><strong>{graph.stats.userFacts}</strong><span>about you</span></div>
          <div><strong>{graph.stats.memories}</strong><span>memories</span></div>
          <div><strong>{graph.stats.skills}</strong><span>skills</span></div>
          <div><strong>{graph.stats.topics}</strong><span>topics</span></div>
          <div><strong>{graph.stats.tools}</strong><span>tools tracked</span></div>
          <div><strong>{graph.stats.episodes}</strong><span>turns</span></div>
        </div>
      )}

      {loadError ? <p className="muted">The brain could not be read: {loadError}</p> : !graph ? <p className="muted"><LoaderCircle size={13} className="spin" /> Waking the brain…</p> : null}
      {expanded ? <div className="brain-overlay" role="dialog" aria-label="Brain mind map">{map}</div> : map}

      {!!graph?.nudges.length && (
        <Section title="Next turn it will">
          <ul className="brain-gaps">{graph.nudges.map((nudge) => <li key={nudge}>{nudge}</li>)}</ul>
        </Section>
      )}

      <Section title="Learning">
        <Row title="Learn from every AI turn" hint="Each turn becomes a dot linked to its tools and topics, and the assistant is briefed with your memory and skills before it answers.">
          <Toggle checked={learning} onChange={(on) => onSettings({ ...settings, ideagraphRecord: on })} label="Learn from every AI turn" />
        </Row>
        <Row title="Keep turn traces" hint="A step-by-step log of each AI turn (every tool call, its time and result, the Judge's scores, the tokens) kept in the app's data folder, newest 200 turns per project. Secrets are never written.">
          <Toggle checked={settings.turnTraces !== false} onChange={(on) => onSettings({ ...settings, turnTraces: on })} label="Keep turn traces" />
        </Row>
        {graph?.lastDream && <Row title="Last dream" hint="Runs on its own every 40 turns.">{when(graph.lastDream)}</Row>}
      </Section>

      <IdeaGraphMirror settings={settings} onSettings={onSettings} />
    </div>
  );
}

/** The optional IdeaGraph (`ig` CLI) mirror, folded away: the native brain never needs it. */
function IdeaGraphMirror({ settings, onSettings }: Props) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [bin, setBin] = useState(settings.ideagraphBin ?? '');
  const [brain, setBrain] = useState(settings.ideagraphBrain ?? '');
  const [report, setReport] = useState<BrainStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const check = async () => {
    setBusy(true);
    try {
      setReport(await api.ideagraphStatus());
    } catch (error) {
      setReport(null);
      toast({ tone: 'error', title: 'IdeaGraph is not reachable', body: `${errorText(error)} — install it with: pip install ideagraph-live` });
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    onSettings({ ...settings, ideagraphBin: bin.trim() || null, ideagraphBrain: brain.trim() || null });
    toast({ tone: 'success', title: bin.trim() ? 'Turns will also be mirrored to IdeaGraph' : 'IdeaGraph mirror off' });
  };

  const init = async () => {
    setBusy(true);
    try {
      toast({ tone: 'success', title: 'IdeaGraph ready', body: await api.ideagraphInit() });
      await check();
    } catch (error) {
      toast({ tone: 'error', title: 'Could not init IdeaGraph', body: errorText(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="set-section">
      <button type="button" className="brain-fold" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <ChevronDown size={13} className={open ? '' : 'rot'} /> Advanced: mirror to IdeaGraph (optional)
      </button>
      {open && (
        <>
          <p className="muted">Also send each turn to an IdeaGraph brain repo through its <code>ig</code> command. Leave the command empty to keep everything in Bhippi&apos;s own brain.</p>
          <Row stack title="ig command" hint="For example ig, or the full path to ig.exe. Empty turns the mirror off.">
            <div className="field-inline">
              <input value={bin} onChange={(event) => setBin(event.target.value)} placeholder="ig" spellCheck={false} aria-label="ig command" />
              <button type="button" className="btn btn-primary" onClick={save}>Save</button>
            </div>
          </Row>
          <Row stack title="IdeaGraph repo" hint="Empty uses the engine default, ~/ideagraph-brain.">
            <div className="field-inline">
              <input value={brain} onChange={(event) => setBrain(event.target.value)} placeholder="~/ideagraph-brain" spellCheck={false} aria-label="IdeaGraph repo path" />
              <button type="button" className="btn" onClick={() => void init()} disabled={busy || !settings.ideagraphBin}>{busy ? <LoaderCircle size={14} className="spin" /> : <Sparkles size={14} />} Init</button>
              <button type="button" className="btn" onClick={() => void check()} disabled={busy || !settings.ideagraphBin}>Check</button>
            </div>
          </Row>
          {report && <pre className="brain-report">{report.status || 'IdeaGraph answered with nothing.'}</pre>}
        </>
      )}
    </section>
  );
}
