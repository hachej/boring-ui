// The Workspace tool view in the right-hand panel. Files is the first and often only view: the files of the workspace (a document is a file at
// its path, like any other). Git appears for variants whose workspace is a
// repository, Tasks once the conversation has had background subagents, Sandbox for variants with a remote sandbox. With one view there is no tab bar.
// Every tab is generic; nothing here knows about a scenario.
import { useEffect, useState } from 'react';
import { Git } from './panels/git.jsx';
import { Tasks } from './panels/tasks.jsx';
import { Sandbox } from './panels/sandbox.jsx';

const POLL_MS = 1500;

/** The files of the workspace in one list; a file opens in the panel beside the chat. */
export function Files({ api, openPath, onOpenFile, workspace }) {
  const [files, setFiles] = useState([]);
  useEffect(() => {
    if (!workspace) return;
    let cancelled = false;
    const load = () => api('/api/files').then(result => { if (!cancelled) setFiles(result.files); }).catch(() => {});
    load();
    const timer = setInterval(load, POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [api, workspace]);
  const empty = files.length === 0;
  return <>
    {!empty && <ul>
      {files.map(path => <li key={path}><button type="button" aria-pressed={openPath === path} onClick={() => onOpenFile(path)}>{path.replace('/workspace/', '')}</button></li>)}
    </ul>}
    {empty && <p className="studio-empty">No files yet. Ask the agent to write one, or attach a file.</p>}
  </>;
}

/** The tabs a variant offers, in order. `info`: { changes, tasks, running } counts from the variant and conversation. */
export function tabsFor(variant, info = {}) {
  const has = capability => variant.capabilities.includes(capability);
  return [
    { id: 'files', label: 'Files' },
    ...(has('git') ? [{ id: 'git', label: 'Git', count: info.changes }] : []),
    ...(info.tasks ? [{ id: 'tasks', label: 'Tasks', count: info.running }] : []),
    ...(has('sandbox') ? [{ id: 'sandbox', label: 'Sandbox' }] : []),
  ];
}

/** What the tab labels count: uncommitted changes (Git) and running subagents (Tasks); Tasks exists once the conversation had any. */
export function useTabInfo({ variant, api, conversation }) {
  const [info, setInfo] = useState({});
  const git = variant.capabilities.includes('git');
  useEffect(() => {
    let cancelled = false, busy = false;
    const load = async () => {
      if (busy) return;
      busy = true;
      try {
        const next = {};
        if (git) next.changes = (await api('/api/variant/git/status')).changes.length;
        if (conversation !== undefined) {
          const result = await api(`/api/tasks?conversation=${conversation}`);
          next.tasks = result.subagents.length > 0 || result.live.length > 0;
          next.running = result.subagents.filter(child => child.status === 'running').length;
        }
        if (!cancelled) setInfo(now => now.changes === next.changes && now.tasks === next.tasks && now.running === next.running ? now : next);
      } catch { /* the next poll retries */ } finally { busy = false; }
    };
    load();
    const timer = setInterval(load, POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [api, git, conversation]);
  return info;
}

export function WorkspaceTabs({ variant, tab, onTab, api, conversation, openPath, onOpenFile }) {
  const tabs = tabsFor(variant, useTabInfo({ variant, api, conversation }));
  const current = tabs.some(item => item.id === tab) ? tab : tabs[0].id;
  return <>
    {tabs.length > 1 && <div role="tablist" aria-label="Workspace" className="studio-tabs">
      {tabs.map(item => <button key={item.id} type="button" role="tab" id={`workspace-tab-${item.id}`} aria-selected={item.id === current} aria-controls="workspace-tabpanel" data-testid={`workspace-tab-${item.id}`} onClick={() => onTab(item.id)}>
        {item.label}{item.count ? <span className="studio-count" data-testid={`workspace-tab-${item.id}-count`}>{item.count}</span> : null}</button>)}
    </div>}
    <div role="tabpanel" id="workspace-tabpanel" data-testid="workspace-tabpanel" {...(tabs.length > 1 ? { 'aria-labelledby': `workspace-tab-${current}` } : { 'aria-label': 'Files' })} data-tab={current} className="studio-tabpanel">
      {current === 'files' && <Files api={api} workspace={variant.capabilities.includes('workspace')} openPath={openPath} onOpenFile={onOpenFile} />}
      {current === 'git' && <Git api={api} />}
      {current === 'tasks' && <Tasks api={api} conversation={conversation} />}
      {current === 'sandbox' && <Sandbox api={api} />}
    </div>
  </>;
}
