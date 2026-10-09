'use client';

import * as Collapsible from '@radix-ui/react-collapsible';
import { ChevronRight, File, Folder } from 'lucide-react';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarMenuSub } from './file-tree-shadcn.js';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { ResourceSnapshot } from '@hachej/boring-files';
import type { FileEntry, RevisionProvider, SavedRevision } from '@hachej/boring-files/revision';
import { createFileTreeController } from './file-tree.js';
import type { FileListing, FileTreeController } from './file-tree.js';

export interface FileTreeProps {
  readonly revisionProvider: RevisionProvider;
  readonly onOpen?: (path: string) => void;
  readonly selectedPath?: string;
  readonly className?: string;
  readonly uploadDirectory?: string;
}

/** One borrowed binding powers browsing, search, upload and history. Historical previews never replace an editor's draft. */
export function FileTree(props: FileTreeProps) {
  return <BoundFileTree key={JSON.stringify([props.revisionProvider.workspace, props.revisionProvider.identity])} {...props} />;
}

function BoundFileTree(props: FileTreeProps) {
  const [owned, setOwned] = useState<{ readonly provider: RevisionProvider; readonly controller: FileTreeController }>();
  useEffect(() => {
    const controller = createFileTreeController({ revisionProvider: props.revisionProvider });
    setOwned({ provider: props.revisionProvider, controller });
    void controller.refresh();
    return () => controller.dispose();
  }, [props.revisionProvider]);
  return owned?.provider === props.revisionProvider ? <FileTreeView {...props} controller={owned.controller} /> : <p role="status">Loading files…</p>;
}

export interface FileTreeViewProps extends Omit<FileTreeProps, 'revisionProvider'> {
  readonly controller: FileTreeController;
}

/** Renders a borrowed controller, for a workspace whose chat and tree share upload state. */
export function FileTreeView({ controller, onOpen, selectedPath, className, uploadDirectory = 'uploads' }: FileTreeViewProps) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const tree = useRef<HTMLUListElement>(null);
  const [focused, setFocused] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [historyPath, setHistoryPath] = useState<string>();

  const rows: { readonly entry: FileEntry; readonly level: number }[] = [];
  function flatten(directory: string, level: number): void {
    for (const entry of state.directories.get(directory)?.entries ?? []) {
      rows.push({ entry, level });
      if (entry.kind === 'directory' && state.expanded.has(entry.path)) flatten(entry.path, level + 1);
    }
  }
  if (state.query) for (const entry of state.search.entries) rows.push({ entry, level: 1 }); else flatten('', 1);
  const focusPath = rows.some(row => row.entry.path === focused) ? focused : rows[0]?.entry.path;
  const focus = (path: string | undefined) => {
    if (path === undefined) return;
    setFocused(path);
    const nodes = tree.current?.querySelectorAll<HTMLElement>('[role=treeitem]');
    for (const node of Array.from(nodes ?? [])) if (node.dataset.path === path) node.focus();
  };
  const keyboard = (event: KeyboardEvent, entry: FileEntry) => {
    const index = rows.findIndex(row => row.entry.path === entry.path);
    const expanded = state.expanded.has(entry.path);
    switch (event.key) {
      case 'ArrowDown': focus(rows[Math.min(rows.length - 1, index + 1)]?.entry.path); break;
      case 'ArrowUp': focus(rows[Math.max(0, index - 1)]?.entry.path); break;
      case 'Home': focus(rows[0]?.entry.path); break;
      case 'End': focus(rows.at(-1)?.entry.path); break;
      case 'ArrowRight':
        if (entry.kind === 'directory' && !state.query) { if (!expanded) void controller.toggle(entry.path); else { const next = rows[index + 1]; if (next && next.level > (rows[index]?.level ?? 0)) focus(next.entry.path); } }
        break;
      case 'ArrowLeft':
        if (entry.kind === 'directory' && expanded && !state.query) void controller.toggle(entry.path);
        else focus(entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) : undefined);
        break;
      case 'Enter': case ' ': if (entry.kind === 'directory') void controller.toggle(entry.path); else onOpen?.(entry.path); break;
      default: return;
    }
    event.preventDefault();
  };
  const listingStatus = (listing: FileListing | undefined, directory: string, search = false): ReactNode => {
    if (!listing || listing.kind === 'loading') return <li role="none"><span role="status">Loading files…</span></li>;
    if (listing.kind === 'error') return <li role="none"><span role="alert">{listing.reason}</span> <button type="button" onClick={() => { void (search ? controller.search(state.query) : controller.refresh(directory)); }}>Retry</button></li>;
    return <>
      {listing.entries.length === 0 && <li role="none"><span>{search ? 'No matching files.' : 'No files here.'}</span></li>}
      {listing.cursor !== undefined && <li role="none"><button type="button" onClick={() => { void (search ? controller.moreSearch() : controller.more(directory)); }}>Load more</button></li>}
    </>;
  };
  const renderEntries = (directory: string, level: number): ReactNode => <>
    {(state.directories.get(directory)?.entries ?? []).map(entry => renderEntry(entry, level))}
    {listingStatus(state.directories.get(directory), directory)}
  </>;
  const renderEntry = (entry: FileEntry, level: number): ReactNode => {
    const folder = entry.kind === 'directory';
    const label = state.query ? entry.path : entry.path.split('/').at(-1);
    const button = <SidebarMenuButton tabIndex={-1} title={entry.path} isActive={selectedPath === entry.path}
      className="min-w-0 flex-1 data-[active=true]:bg-transparent"
      onClick={() => { focus(entry.path); if (!folder) onOpen?.(entry.path); }}>
      {folder ? <><ChevronRight className="transition-transform" aria-hidden="true" /><Folder aria-hidden="true" /></> : <File aria-hidden="true" />}
      <span>{label}</span>
    </SidebarMenuButton>;
    const item = <SidebarMenuItem key={entry.path} role="treeitem" data-path={entry.path}
      aria-level={level} aria-selected={selectedPath === entry.path} aria-expanded={folder ? state.expanded.has(entry.path) : undefined}
      tabIndex={focusPath === entry.path ? 0 : -1}
      onFocus={event => { if (event.target === event.currentTarget) setFocused(entry.path); }}
      onKeyDown={event => { if (event.target === event.currentTarget) keyboard(event, entry); }}
      className="group/collapsible rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring [&[data-state=open]>div>button>svg:first-child]:rotate-90">
      <div className="flex items-center gap-1">
        {folder ? <Collapsible.Trigger asChild>{button}</Collapsible.Trigger> : button}
        {!folder && <button type="button" aria-label={`History of ${entry.path}`} className="px-2 py-1 text-xs" onClick={() => setHistoryPath(entry.path)}>History</button>}
      </div>
      {folder && !state.query && <Collapsible.Content asChild><SidebarMenuSub role="group">{renderEntries(entry.path, level + 1)}</SidebarMenuSub></Collapsible.Content>}
    </SidebarMenuItem>;
    return folder ? <Collapsible.Root key={entry.path} asChild open={state.expanded.has(entry.path)}
      onOpenChange={() => { void controller.toggle(entry.path); }}>{item}</Collapsible.Root> : item;
  };

  return <section data-boring="file-tree" className={className} aria-label="Workspace files">
    <div className="flex flex-wrap items-center gap-2 p-2">
      <input type="search" aria-label="Search files" placeholder="Search files…" className="min-w-0 flex-1 rounded border border-input bg-background px-2 py-1 text-sm" value={state.query}
        onChange={event => { void controller.search(event.currentTarget.value); }} />
      <button type="button" onClick={() => { void (state.query ? controller.search(state.query) : controller.refresh()); }}>Refresh</button>
      <label className="cursor-pointer text-sm">Upload<input aria-label="Upload files" type="file" multiple className="sr-only" onChange={event => {
        const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ''; setUploadError('');
        void (async () => {
          // One refused or unreadable file does not stop the others; every refusal is reported.
          const errors: string[] = [];
          for (const file of files) {
            const path = uploadDirectory ? `${uploadDirectory}/${file.name}` : file.name;
            try { await controller.upload({ path, bytes: new Uint8Array(await file.arrayBuffer()), mediaType: file.type || 'application/octet-stream' }); }
            catch (error) { errors.push(error instanceof Error ? error.message : `${file.name}: upload failed`); }
          }
          if (errors.length) setUploadError(errors.join(' '));
        })();
      }} /></label>
    </div>
    {uploadError && <p role="alert">{uploadError}</p>}
    <SidebarMenu ref={tree} role="tree" aria-label="Files" className="m-0 list-none p-2">
      {state.query ? <>{state.search.entries.map(entry => renderEntry(entry, 1))}{listingStatus(state.search, '', true)}</> : renderEntries('', 1)}
    </SidebarMenu>
    {state.uploads.length > 0 && <ul aria-label="Uploads" className="list-none p-2 text-sm">{state.uploads.map(upload => <li key={upload.operationId} data-operation={upload.operationId}>
      <span>{upload.path}: {upload.state.kind === 'pending' ? 'Uploading…' : upload.state.result.kind === 'committed' ? 'Saved' : upload.state.result.kind === 'partial' ? 'Unconfirmed' : upload.state.result.reason}</span>
      {upload.state.kind === 'settled' && upload.state.result.kind === 'unknown' && <button type="button" onClick={() => { void controller.reconcile(upload.operationId).catch(error => setUploadError(error instanceof Error ? error.message : 'Upload status unavailable')); }}>Check upload status</button>}
    </li>)}</ul>}
    {historyPath !== undefined && <FileHistory key={historyPath} controller={controller} path={historyPath} onClose={() => setHistoryPath(undefined)} />}
  </section>;
}

function FileHistory({ controller, path, onClose }: { readonly controller: FileTreeController; readonly path: string; readonly onClose: () => void }) {
  const [versions, setVersions] = useState<readonly SavedRevision[]>();
  const [failure, setFailure] = useState('');
  const [selected, setSelected] = useState<string>();
  const [preview, setPreview] = useState<ResourceSnapshot>();
  useEffect(() => {
    const abort = new AbortController();
    void controller.history(path, abort.signal).then(value => { if (!abort.signal.aborted) setVersions(value); }, error => { if (!abort.signal.aborted) setFailure(error instanceof Error ? error.message : 'History unavailable'); });
    return () => abort.abort();
  }, [controller, path]);
  useEffect(() => {
    if (selected === undefined) return;
    const abort = new AbortController(); setPreview(undefined); setFailure('');
    void controller.revisionProvider.read({ target: controller.revisionProvider.locate(path), revision: { kind: 'exact', value: selected } }, abort.signal).then(result => {
      if (abort.signal.aborted) return;
      const target = controller.revisionProvider.locate(path);
      if (result.kind === 'available' && result.snapshot.ref.revision === selected
        && result.snapshot.ref.resource.providerId === target.resource.providerId && result.snapshot.ref.resource.path === target.resource.path
        && result.snapshot.ref.view.kind === target.view.kind && (target.view.kind !== 'working'
          || (result.snapshot.ref.view.kind === 'working' && result.snapshot.ref.view.viewId === target.view.viewId))) setPreview(result.snapshot);
      else setFailure(result.kind === 'denied' || result.kind === 'unavailable' ? result.reason : 'This revision is unavailable');
    }, () => { if (!abort.signal.aborted) setFailure('This revision is unavailable'); });
    return () => abort.abort();
  }, [controller, path, selected]);
  let text: string | undefined;
  if (preview) { try { text = new TextDecoder('utf-8', { fatal: true }).decode(preview.bytes); } catch { /* Binary history remains a byte-qualified read-only preview. */ } }
  return <section aria-label={`History of ${path}`} className="border-t border-border p-2 text-sm">
    <div className="flex items-center justify-between gap-2"><h3 className="font-medium">{path} history</h3><button type="button" onClick={onClose}>Close history</button></div>
    {failure && <p role="alert">{failure}</p>}
    {!versions && !failure && <p role="status">Loading history…</p>}
    {versions?.length === 0 && <p>No retained versions.</p>}
    <ul className="m-0 list-none p-0">{versions?.map(version => <li key={version.revision}><button type="button" aria-pressed={selected === version.revision} onClick={() => setSelected(version.revision)}>
      {version.savedAt ? new Date(version.savedAt).toLocaleString() : 'Earlier version'} · {version.revision.slice(0, 8)}
    </button></li>)}</ul>
    {preview && <div data-testid="file-history-preview" data-revision={preview.ref.revision}><p>Read-only revision · {preview.bytes.byteLength} bytes</p>{text === undefined ? <p>Binary file ({preview.mediaType})</p> : <pre className="max-h-80 overflow-auto whitespace-pre-wrap">{text}</pre>}</div>}
  </section>;
}
