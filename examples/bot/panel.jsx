// Bot panel: what the model saw last (the OptChat memory view, coarser with age), how far the nap has summarized,
// and the bot's deployed self with its history. Rolling back writes that version's files and deploys them again.
import { useCallback, useEffect, useState } from 'react';

const small = { fontSize: '0.8125rem', margin: '0 0 0.5rem' };
const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.75rem' };
const SPAN = level => level === 0 ? '1 message' : `${2 ** level} messages`;
// One hue per level, more transparent with age; the tokens keep it readable in light and dark.
const tint = level => ({ background: `color-mix(in oklab, var(--primary) ${Math.max(6, 28 - level * 4)}%, transparent)`, borderRadius: 4, padding: '0 0.3rem', whiteSpace: 'nowrap' });

function Memory({ memory }) {
  if (!memory) return <p className="bot-empty">No conversation yet. Say hello.</p>;
  const { leaves, summaries, view, lastRequest, compactor, enabled } = memory;
  return <section data-testid="bot-memory">
    <h3>Memory</h3>
    <p style={small} data-testid="bot-memory-stats">
      {enabled ? '' : 'OptChat is off for this conversation · '}{leaves} messages in the log · {summaries} summaries · view {view.bytes}/{view.budget} B
      {compactor.busy ? ' · summarizing…' : ''}{compactor.error ? ` · summarizer failed: ${compactor.error}` : ''}
      {lastRequest ? ` · last request sent ${lastRequest.requestMessages} of ${lastRequest.logMessages} messages` : ''}
    </p>
    {view.parts.length === 0
      ? <p style={small}>Nothing in the view yet.</p>
      : <ol data-testid="bot-view" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.25rem' }}>
        {view.parts.map(part => <li key={`${part.level}:${part.id}`} data-level={part.level} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.5rem', alignItems: 'baseline' }}>
          <span style={{ ...mono, ...tint(part.level) }} title={SPAN(part.level)}>{part.id}+{part.n}</span>
          <span style={{ fontSize: '0.75rem', lineHeight: 1.35, overflowWrap: 'anywhere' }}>{part.open ? '(not summarized yet)' : part.text}</span>
        </li>)}
      </ol>}
  </section>;
}

function Self({ self, onRollback, busy }) {
  const { current, versions, drift } = self;
  return <section data-testid="bot-self">
    <h3>Self <span style={{ ...mono, fontWeight: 400 }} data-testid="bot-version">v{current.version}</span></h3>
    <p style={small}>{drift === 'no change' ? 'Files match the deployed version.' : <>Undeployed edits: <strong>{drift}</strong></>}</p>
    <details>
      <summary style={small}>Persona</summary>
      <pre style={{ ...mono, whiteSpace: 'pre-wrap', margin: '0 0 0.5rem' }}>{current.persona}</pre>
    </details>
    <p style={{ ...small, marginBottom: '0.25rem' }}>Abilities (sandboxed):</p>
    <ul style={{ ...small, paddingLeft: '1.1rem' }} data-testid="bot-abilities">
      {current.abilities.length ? current.abilities.map(ability => <li key={ability.name}><code style={mono}>{ability.name}({ability.args})</code> {ability.description}</li>) : <li>none yet</li>}
    </ul>
    <p style={{ ...small, marginBottom: '0.25rem' }}>Deploys:</p>
    <ul style={{ ...small, listStyle: 'none', padding: 0 }} data-testid="bot-deploys">
      {versions.map(version => <li key={version.version} data-version={version.version}>
        <strong>v{version.version}</strong> {version.change}{version.note ? ` — ${version.note}` : ''}{' '}
        <span style={{ color: 'var(--muted-foreground)' }}>{new Date(version.at).toLocaleString()}</span>
        {version.version !== current.version && <> <button type="button" disabled={busy} onClick={() => onRollback(version.version)} style={{ fontSize: '0.75rem' }}>roll back</button></>}
      </li>)}
    </ul>
  </section>;
}

export function BotPanel({ api }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api('/api/bot/state').then(setData).catch(() => {}), [api]);
  useEffect(() => { load(); const timer = setInterval(load, 2000); return () => clearInterval(timer); }, [load]);
  const rollback = async version => {
    setBusy(true);
    try { await api(`/api/bot/rollback?version=${version}`, { method: 'POST' }); await load(); } finally { setBusy(false); }
  };
  if (!data) return <p className="bot-empty">Loading…</p>;
  return <div data-testid="bot-panel">
    <p style={small}>Each request shows the model one line per stretch of everything said before the current message, coarser with age (OptChat); zoom reopens a line down to the exact message.</p>
    <Memory memory={data.memory} />
    <Self self={data.self} onRollback={rollback} busy={busy} />
  </div>;
}
