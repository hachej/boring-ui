// The Tasks tab: the children of the open conversation with their status, task, steps and answer, plus the live part of the
// native task graph. Polls the host's /api/tasks route; children are not served by the chat transport.
import { useEffect, useState } from 'react';

const POLL_MS = 1000;
const COLORS = { running: '#2563eb', done: '#16a34a', stopped: '#b45309', failed: '#dc2626', unknown: 'var(--muted-foreground)' };
const small = { fontSize: '0.8125rem', margin: 0 };
const muted = { ...small, color: 'var(--muted-foreground)' };
const card = { border: '1px solid var(--border)', borderRadius: '0.5rem', padding: '0.625rem', display: 'grid', gap: '0.375rem' };
const badge = status => ({ fontSize: '0.6875rem', fontWeight: 600, padding: '0.0625rem 0.5rem', borderRadius: '999px', color: '#fff', background: COLORS[status] ?? COLORS.unknown });

function Tasks({ api, conversation }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let cancelled = false, busy = false;
    const load = async () => {
      if (busy) return;
      busy = true;
      try {
        if (conversation === undefined) return;
        const result = await api(`/api/tasks?conversation=${conversation}`);
        if (!cancelled) setData(result);
      } catch { /* the next poll retries */ } finally { busy = false; }
    };
    load();
    const timer = setInterval(load, POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [api, conversation]);
  if (!data) return <p className="studio-empty">Loading…</p>;
  const running = data.subagents.filter(child => child.status === 'running').length;
  return <div data-testid="subagents" data-conversation={data.conversation} data-running={running}>
    <h2>Subagents</h2>
    <p style={muted}>{data.subagents.length === 0 ? 'Background subagents appear here while they run.' : `${data.subagents.length} in this conversation, ${running} running.`}</p>
    <ul style={{ marginTop: '0.5rem' }}>{data.subagents.map(child => <li key={child.id} data-testid="subagent" data-status={child.status} data-mode={child.mode} style={card}>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <strong style={small}>#{child.taskId}</strong><span style={badge(child.status)}>{child.status}</span><span style={muted}>{child.mode}, conversation {child.id}</span>
      </div>
      <p style={small} data-testid="subagent-task">{child.task}</p>
      {child.steps.length > 0 && <p style={{ ...muted, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.75rem' }}>{child.steps.join(' → ')}</p>}
      {child.status === 'running'
        ? <pre data-testid="subagent-streaming" style={{ opacity: 0.75 }}>{child.streaming || 'Working…'}</pre>
        : <pre data-testid="subagent-answer">{child.answer || '(no answer)'}</pre>}
    </li>)}</ul>
    <h3>Live task graph</h3>
    {data.live.length === 0
      ? <p style={muted} data-testid="task-graph-idle">No live task.</p>
      : <ul data-testid="task-graph">{data.live.map(node => <li key={node.id} style={{ ...muted, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.75rem' }}>
          #{node.id} {node.kind} · {node.status}{node.background ? ' · background' : ''} · {node.owner === null ? `conversation ${node.conversationId}` : `owner #${node.owner}`}</li>)}</ul>}
  </div>;
}

export { Tasks };
