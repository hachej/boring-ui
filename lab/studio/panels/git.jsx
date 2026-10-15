// The Git tab (variants whose workspace is a repository): branch, uncommitted changes, commit log and working tree files,
// polled from the variant's endpoints under /api/variant/git/.
import { useEffect, useState } from 'react';

const POLL_MS = 1500;
const mono = { font: '0.8125rem ui-monospace, SFMono-Regular, Menlo, monospace' };
const badge = { ...mono, padding: '0.0625rem 0.5rem', border: '1px solid var(--border)', borderRadius: '999px', background: 'var(--muted)' };
const quiet = { color: 'var(--muted-foreground)', fontSize: '0.75rem' };
const row = { display: 'flex', gap: '0.5rem', alignItems: 'baseline', padding: '0.125rem 0.5rem', fontSize: '0.8125rem' };

function Git({ api }) {
  const [state, setState] = useState(null);
  const [open, setOpen] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const load = () => Promise.all([api('/api/variant/git/log'), api('/api/variant/git/status'), api('/api/variant/git/files')]).then(([log, status, files]) => {
      if (cancelled) return;
      setState({ branch: status.branch, branches: log.branches, commits: log.commits, changes: status.changes, files: files.files });
      setOpen(current => current && files.files.includes(current.path) ? current : null);
    }).catch(() => {});
    load();
    const timer = setInterval(load, POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [api]);
  useEffect(() => {
    if (!open?.path) return;
    let cancelled = false;
    const load = () => api(`/api/variant/git/file?path=${encodeURIComponent(open.path)}`).then(result => { if (!cancelled) setOpen(current => current?.path === result.path ? result : current); }).catch(() => {});
    load();
    const timer = setInterval(load, POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [api, open?.path]);
  if (!state) return <p className="studio-empty">Loading…</p>;
  return <>
    <h2>Repository <span data-testid="git-branch" style={badge}>{state.branch}</span></h2>
    <p style={{ ...quiet, margin: 0 }}>Branches: {state.branches.join(', ')}. In memory, saved to the studio data directory; no remote.</p>

    <h3>Uncommitted changes</h3>
    <ul data-testid="git-status">
      {state.changes.length === 0 && <li style={{ ...row, ...quiet }}>No changes yet. Changes the agent made to the workspace appear here.</li>}
      {state.changes.map(change => <li key={change.path} style={row} data-state={change.state}>
        <span style={mono}>{change.path}</span><span style={quiet}>{change.state}{change.staged ? ', staged' : ''}</span>
      </li>)}
    </ul>

    <h3>Commits</h3>
    <ol data-testid="git-log" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '0.25rem' }}>
      {state.commits.map(commit => <li key={commit.oid} style={row}>
        <code style={{ ...mono, color: 'var(--muted-foreground)' }}>{commit.oid.slice(0, 7)}</code>
        <span style={{ flex: 1, minWidth: 0 }}>{commit.message}</span>
        <time style={quiet} dateTime={new Date(commit.timestamp * 1000).toISOString()}>{new Date(commit.timestamp * 1000).toLocaleTimeString()}</time>
      </li>)}
    </ol>

    <h3>Working tree</h3>
    <ul data-testid="git-files">{state.files.map(path => <li key={path}><button type="button" aria-pressed={open?.path === path} onClick={() => setOpen({ path })}>{path}</button></li>)}</ul>
    {open && <section aria-label="File preview"><h3>{open.path}</h3><pre data-testid="file-preview">{open.text ?? 'Loading…'}</pre></section>}
  </>;
}

export { Git };
