// The Sandbox tab (variants with a remote sandbox): lifecycle, command count and the files in its workspace.
import { useEffect, useState } from 'react';

function Sandbox({ api }) {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const load = () => api('/api/variant/status').then(result => { if (!cancelled) setStatus(result); }).catch(() => {});
    load();
    const timer = setInterval(load, 2500);
    return () => { cancelled = true; clearInterval(timer); };
  }, [api]);
  if (!status) return <p className="studio-empty">Loading…</p>;
  return <>
    <h2>Remote sandbox</h2>
    <dl className="studio-facts">
      <dt>Status</dt><dd data-testid="sandbox-status">{status.status}</dd>
      {status.name && <><dt>Sandbox</dt><dd>{status.name}</dd></>}
      <dt>Commands run</dt><dd data-testid="sandbox-commands">{status.commands}</dd>
      <dt>Directory</dt><dd><code>{status.root}</code></dd>
    </dl>
    {status.error && <p role="alert">{status.error}</p>}
    <h3>Files</h3>
    {status.files.length
      ? <ul data-testid="sandbox-files">{status.files.map(file => <li key={file.name}><code>{file.name}{file.kind === 'directory' ? '/' : ''}</code></li>)}</ul>
      : <p className="studio-empty">{status.status === 'running' ? 'No files yet.' : 'The sandbox starts with the first tool call.'}</p>}
  </>;
}

export { Sandbox };
