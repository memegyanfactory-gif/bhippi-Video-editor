// The row under the composer: what this chat can reach, and what it is doing right now.
//
// Everything on it is real. The tool count comes from calls that actually ran, a connection chip
// exists only for a server that answered, and the agent lights are the agents' own states.
import { Boxes, Plug, Wrench, X } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { Portal, usePlacement } from '../components/Portal';
import type { ToolRun } from './ChatPanel';

/** One MCP server or HTTP API this chat can reach. */
export type Connection = {
  id: string;
  label: string;
  kind: 'mcp' | 'api' | 'builtin';
  /** `ready` once it has answered, `failed` with a reason, `connecting` while it is starting. */
  state: 'ready' | 'connecting' | 'failed';
  detail: string;
  /** How many tools it contributes. */
  tools: number;
};

/** An agent the chat started. `done` and `failed` stay on the map until the conversation clears. */
export type AgentRun = {
  id: string;
  label: string;
  state: 'running' | 'done' | 'failed';
  model: string | null;
  /** Milliseconds since it started, or its whole duration once it has finished. */
  elapsedMs: number;
  tokens: number | null;
  summary: string | null;
};

const seconds = (ms: number) => {
  const total = Math.round(ms / 1000);
  return total >= 60 ? `${Math.floor(total / 60)}m ${total % 60}s` : `${total}s`;
};

const tokens = (count: number | null) => (count === null ? '' : count >= 1000 ? `${(count / 1000).toFixed(1)}k tokens` : `${count} tokens`);

export function ChatStatusBar({ usage, runs, connections, agents, onStopAgent, onManageConnections }: {
  /** The plan meter for whichever provider the chat is set to. */
  usage?: ReactNode;
  /** Every tool call this conversation has made, newest last. */
  runs: ToolRun[];
  connections: Connection[];
  agents: AgentRun[];
  onStopAgent: (id: string) => void;
  onManageConnections: () => void;
}) {
  const [open, setOpen] = useState<'tools' | 'connections' | 'agents' | null>(null);
  // Each popover is measured against its own chip and drawn into the document, because the panel
  // frame around this bar is `overflow: clip` and would otherwise slice it at the column edge.
  const toolsChip = useRef<HTMLButtonElement>(null);
  const connectionsChip = useRef<HTMLButtonElement>(null);
  const agentsChip = useRef<HTMLButtonElement>(null);
  const toolsAt = usePlacement(toolsChip, open === 'tools', 260);
  const connectionsAt = usePlacement(connectionsChip, open === 'connections', 268);
  const agentsAt = usePlacement(agentsChip, open === 'agents', 320);
  const working = agents.filter((agent) => agent.state === 'running').length;
  const failed = runs.filter((run) => run.status === 'failed' || run.status === 'denied').length;

  // What each tool was called, most used first — more use than a raw list in call order.
  const byName = new Map<string, number>();
  for (const run of runs) byName.set(run.name, (byName.get(run.name) ?? 0) + 1);
  const ranked = [...byName.entries()].sort((a, b) => b[1] - a[1]);

  const close = () => setOpen(null);

  return (
    <div className="chat-bar">
      {usage}
      <button
        type="button"
        ref={toolsChip}
        className={`bar-chip${open === 'tools' ? ' active' : ''}`}
        onClick={() => setOpen(open === 'tools' ? null : 'tools')}
        title={runs.length ? `${runs.length} tool calls in this conversation` : 'No tools called yet'}
      >
        <Wrench size={12} />
        <span>{runs.length} {runs.length === 1 ? 'tool' : 'tools'}</span>
        {failed > 0 && <span className="chip-bad">{failed} failed</span>}
      </button>

      <button
        type="button"
        ref={connectionsChip}
        className={`bar-chip${open === 'connections' ? ' active' : ''}`}
        onClick={() => setOpen(open === 'connections' ? null : 'connections')}
        title="What this chat can reach"
      >
        <Plug size={12} />
        <span>{connections.filter((item) => item.state === 'ready').length} connected</span>
        {connections.some((item) => item.state === 'failed') && <span className="chip-bad">!</span>}
      </button>

      {agents.length > 0 && (
        <button
          type="button"
          ref={agentsChip}
          className={`bar-chip${open === 'agents' ? ' active' : ''}${working ? ' busy' : ''}`}
          onClick={() => setOpen(open === 'agents' ? null : 'agents')}
          title="Agents this chat has started"
        >
          <Boxes size={12} />
          <span>{working ? `${working} agent${working === 1 ? '' : 's'} working` : `${agents.length} agent${agents.length === 1 ? '' : 's'}`}</span>
        </button>
      )}

      {open === 'tools' && (
        <Portal><div className="bar-popover" style={toolsAt} role="dialog" aria-label="Tools used">
          <div className="popover-head">Tools used</div>
          {ranked.length === 0 ? (
            <p className="bar-empty">Nothing yet. Ask for an edit and the calls show up here.</p>
          ) : (
            <div className="bar-list">
              {ranked.map(([name, count]) => (
                <div key={name} className="bar-row">
                  <span className="bar-row-name">{name.replace(/_/g, ' ')}</span>
                  <span className="bar-row-meta">×{count}</span>
                </div>
              ))}
            </div>
          )}
        </div></Portal>
      )}

      {open === 'connections' && (
        <Portal><div className="bar-popover" style={connectionsAt} role="dialog" aria-label="Connections">
          <div className="popover-head">Connections</div>
          <div className="bar-list">
            {connections.map((item) => (
              <div key={item.id} className={`bar-row state-${item.state}`}>
                <span className={`conn-mark kind-${item.kind}`} aria-hidden="true">{item.label.slice(0, 1).toUpperCase()}</span>
                <span className="bar-row-copy">
                  <span className="bar-row-name">{item.label}</span>
                  <span className="bar-row-detail">{item.state === 'failed' ? item.detail : `${item.tools} tool${item.tools === 1 ? '' : 's'}${item.detail ? ` · ${item.detail}` : ''}`}</span>
                </span>
                <span className={`light ${item.state === 'ready' ? 'green' : item.state === 'failed' ? 'red' : 'grey'}`} />
              </div>
            ))}
          </div>
          <button type="button" className="bar-action" onClick={() => { close(); onManageConnections(); }}>
            Add an MCP server or API…
          </button>
        </div></Portal>
      )}

      {open === 'agents' && (
        <Portal><div className="bar-popover wide" style={agentsAt} role="dialog" aria-label="Agent map">
          <div className="popover-head">Agent map</div>
          <p className="bar-empty small">{agents.length} agent{agents.length === 1 ? '' : 's'} · a light each for running, finished and failed</p>
          <div className="agent-map">
            {agents.map((agent) => (
              <div key={agent.id} className={`agent-box state-${agent.state}`}>
                <span className={`light ${agent.state === 'running' ? 'green' : agent.state === 'failed' ? 'red' : 'grey'}`} />
                <span className="agent-copy">
                  <span className="agent-name">{agent.label}</span>
                  <span className="agent-meta">
                    {[agent.model, seconds(agent.elapsedMs), tokens(agent.tokens)].filter(Boolean).join(' · ')}
                  </span>
                  {agent.summary && <span className="agent-summary">{agent.summary}</span>}
                </span>
                {agent.state === 'running' && (
                  <button type="button" className="agent-stop" title="Stop this agent" onClick={() => onStopAgent(agent.id)}>
                    <X size={11} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div></Portal>
      )}

      {open && <Portal><div className="bar-scrim" onPointerDown={close} aria-hidden="true" /></Portal>}
    </div>
  );
}
