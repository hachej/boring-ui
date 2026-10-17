'use client';

// The documents screen: the workspace's Library is the list (`ListDetail`: beside the file on a wide screen, one pane at a time on a phone);
// the chosen file opens in the same viewer the Library uses (editable where it edits); its Revisions sit beside it. Every revision row opens
// that exact revision read-only, and « Back to editing » returns to the file. The editor stays mounted while a revision is inspected, so its
// unsaved edits survive; leaving the file with unsaved edits asks first. Every read goes through the one `revisionProvider` the host binds.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { createFileTreeController } from '@hachej/boring-ui-kit/file-tree';
import type { FileTreeController } from '@hachej/boring-ui-kit/file-tree';
import { FileTreeView } from '../file-tree/file-tree';
import type { RevisionProvider } from '@hachej/boring-files/revision';
import { mediaTypeOf, viewerKindOf } from '@hachej/boring-files/file-types';
import type { ViewerKind } from '@hachej/boring-files/file-types';
import { ListDetail } from '../app-shell/list-detail';
import { ArtifactPanel } from '../pi-app/artifact-panel';
import type { ArtifactDescriptor } from '../pi-chat/artifact';
import type { CustomViewers, ViewerOptions } from '../pi-app/artifact-panel';
import { FileViewer } from '../pi-app/file-viewer';
import { ImagePane } from '../viewers/image-pane';
import { PdfPane } from '../viewers/pdf-pane';
import { ViewerFrame } from '../viewers/viewer-frame';
import { useViewerText } from '../viewers/viewer-window';
import { cn } from '../utils/utils';
import { Revisions } from './revisions';
import type { DocumentsLabels } from './documents-labels';
import { documentsLabels, DocumentsWords } from './words';
import type { DocumentsLocale } from './words';

export interface DocumentsProps {
  /** The workspace's revision provider (the files guide's `connectRevisionProvider`, or a host's own binding). Borrowed: the host disposes it. */
  readonly provider: RevisionProvider;
  readonly locale?: DocumentsLocale | undefined;
  /** The block's own words, over `documentsLabels` (the viewers' words follow `locale`). */
  readonly labels?: Partial<DocumentsLabels> | undefined;
  /** Host viewers by kind, as for the Library (for example a canvas). */
  readonly viewers?: CustomViewers | undefined;
  readonly share?: ViewerOptions['share'];
}

const nameOf = (path: string) => path.split('/').pop() || path;

/** The workspace's change feed as a counter: it moves on every change, so the listings and the revisions are read again. */
function useWorkspaceVersion(provider: RevisionProvider): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!provider.changes) return undefined;
    const abort = new AbortController();
    void (async () => {
      try { for await (const change of provider.changes!({ signal: abort.signal })) { void change; setVersion(current => current + 1); } } catch { /* the binding ended the feed: the listings stay as they are */ }
    })();
    return () => abort.abort();
  }, [provider]);
  return version;
}

/** The Library's tree over the provider: created and disposed with the binding, read again when the workspace changes. */
function useFileTree(provider: RevisionProvider, version: number): FileTreeController | undefined {
  const [tree, setTree] = useState<FileTreeController>();
  useEffect(() => {
    const next = createFileTreeController({ revisionProvider: provider });
    setTree(next);
    void next.refresh();
    return () => next.dispose();
  }, [provider]);
  useEffect(() => {
    if (!tree || version === 0) return;
    const { query, expanded } = tree.getSnapshot();
    if (query) void tree.search(query);
    else for (const directory of ['', ...expanded]) void tree.refresh(directory);
  }, [tree, version]);
  return tree;
}

/**
 * The provider as it reads one revision: every read of the returned client is the exact `revision`, over the same provider (a reload in a
 * pinned view re-reads that revision, never the latest). It is for read-only views only.
 */
function pinnedProviderOf(provider: RevisionProvider, revision: string): RevisionProvider {
  return { ...provider, read: (request, signal) => provider.read({ target: request.target, revision: { kind: 'exact', value: revision } }, signal) };
}

/** An image or PDF revision, read exactly and shown in the viewer's read-only pane. */
function BinaryRevision({ provider, path, revision, kind, labels, onClose }: {
  readonly provider: RevisionProvider;
  readonly path: string;
  readonly revision: string;
  readonly kind: 'image' | 'pdf';
  readonly labels: DocumentsLabels;
  readonly onClose: () => void;
}) {
  const [state, setState] = useState<{ readonly kind: 'loading' } | { readonly kind: 'failed' } | { readonly kind: 'ready'; readonly bytes: Uint8Array; readonly mediaType: string }>({ kind: 'loading' });
  const { labels: viewer } = useViewerText();
  useEffect(() => {
    const abort = new AbortController();
    setState({ kind: 'loading' });
    provider.read({ target: provider.locate(path), revision: { kind: 'exact', value: revision } }, abort.signal).then(result => {
      if (!abort.signal.aborted) setState(result.kind === 'available' ? { kind: 'ready', bytes: result.snapshot.bytes, mediaType: result.snapshot.mediaType } : { kind: 'failed' });
    }, () => { if (!abort.signal.aborted) setState({ kind: 'failed' }); });
    return () => abort.abort();
  }, [provider, path, revision]);
  const status = { label: viewer.readOnly, kind: 'read-only' as const };
  if (state.kind !== 'ready') return <ViewerFrame title={nameOf(path)} status={status} onClose={onClose}>
    <p role="status" className="m-0 p-4 text-sm text-muted-foreground">{state.kind === 'loading' ? labels.revisionsLoading : labels.revisionLoadFailed}</p>
  </ViewerFrame>;
  return kind === 'image'
    ? <ImagePane name={nameOf(path)} mediaType={state.mediaType} bytes={state.bytes} status={status} onClose={onClose} />
    : <PdfPane name={nameOf(path)} bytes={state.bytes} status={status} onClose={onClose} />;
}

/** One revision of the file, read-only, with « Back to editing ». Text, Markdown and HTML use the artifact panel's pinned view. */
function OlderVersion({ provider, path, revision, options, labels, onBack, onClose }: {
  readonly provider: RevisionProvider;
  readonly path: string;
  readonly revision: string;
  readonly options: ViewerOptions;
  readonly labels: DocumentsLabels;
  readonly onBack: () => void;
  readonly onClose: () => void;
}) {
  const kind: ViewerKind = viewerKindOf(path);
  const pinned = useMemo(() => pinnedProviderOf(provider, revision), [provider, revision]);
  const type = kind === 'markdown' ? 'markdown' : kind === 'html' ? 'html' : kind === 'text' ? 'code' : undefined;
  const artifact: ArtifactDescriptor | undefined = type === undefined ? undefined
    : { schema: 'boring.artifact', version: 1, title: nameOf(path), type, mediaType: mediaTypeOf(path), target: provider.locate(path), revision };
  const bar = <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
    <span role="status" className="min-w-0 flex-1 truncate text-sm font-medium">{labels.readOnlyRevision}</span>
    <Button variant="ghost" data-testid="back-to-editing" onClick={onBack}>{labels.backToEditing}</Button>
  </div>;
  let body;
  if (artifact) body = <ArtifactPanel active={{ descriptor: artifact, follow: false }} versions={[]} options={{ ...options, client: pinned }} onSelect={onBack} onClose={onClose} />;
  else if (kind === 'image' || kind === 'pdf') body = <BinaryRevision provider={provider} path={path} revision={revision} kind={kind} labels={labels} onClose={onClose} />;
  else body = <ViewerFrame title={nameOf(path)} onClose={onClose}><p role="status" className="m-0 p-4 text-sm text-muted-foreground">{labels.unsupportedPreview}</p></ViewerFrame>;
  return <div data-testid="revision-view" data-kind={kind} data-revision={revision} className="flex h-full min-h-0 flex-1 flex-col">
    {bar}
    <div className="flex min-h-0 flex-1 flex-col">{body}</div>
  </div>;
}

function DocumentDetail({ provider, path, version, options, labels, locale, older, onDirty, onOpenRevision, onBack, onClose }: {
  readonly provider: RevisionProvider;
  readonly path: string;
  readonly version: number;
  readonly options: ViewerOptions;
  readonly labels: DocumentsLabels;
  readonly locale: DocumentsLocale;
  /** The older revision on show, `undefined` for the editable file. */
  readonly older: string | undefined;
  readonly onDirty: (unsaved: boolean) => void;
  readonly onOpenRevision: (revision: string) => void;
  readonly onBack: () => void;
  readonly onClose: () => void;
}) {
  return <div data-testid="documents-detail" className="flex h-full min-h-0 flex-col md:flex-row">
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* The editor stays mounted (hidden) while a revision is on show, so its unsaved edits are kept. */}
      <div className={cn('min-h-0 flex-1 flex-col', older === undefined ? 'flex' : 'hidden')}>
        <FileViewer path={path} locator={provider.locate(path)} options={options} onClose={onClose} onUnsavedChange={onDirty} />
      </div>
      {older !== undefined && <OlderVersion provider={provider} path={path} revision={older} options={options} labels={labels} onBack={onBack} onClose={onClose} />}
    </div>
    <aside className="flex max-h-[40%] min-h-0 shrink-0 flex-col overflow-y-auto border-t border-border md:max-h-none md:w-72 md:border-t-0 md:border-l">
      <Revisions provider={provider} path={path} version={version} selected={older} locale={locale} labels={labels} onOpen={onOpenRevision} />
    </aside>
  </div>;
}

export function Documents({ provider, locale, labels: given, viewers, share }: DocumentsProps) {
  const labels = documentsLabels(locale, given);
  const language: DocumentsLocale = locale === 'fr' ? 'fr' : 'en';
  const version = useWorkspaceVersion(provider);
  const tree = useFileTree(provider, version);
  const [path, setPath] = useState<string>();
  // An older revision of the file on show (`undefined`: the editable file).
  const [pinned, setPinned] = useState<{ readonly path: string; readonly revision: string }>();
  // The file's unsaved edits, as its viewer reports them. A change of file or a close that would drop them asks first.
  const dirty = useRef(false);
  const onDirty = useCallback((unsaved: boolean) => { dirty.current = unsaved; }, []);
  const mayLeave = () => !dirty.current || window.confirm(labels.discardChanges);
  const options = useMemo<ViewerOptions>(() => ({ client: provider, identity: provider.identity, ...(viewers ? { viewers } : {}), ...(share ? { share } : {}) }), [provider, viewers, share]);
  const choose = (next: string) => {
    if (next === path || !mayLeave()) return;
    setPath(next);
    setPinned(undefined);
  };
  const closeFile = () => { if (!mayLeave()) return; setPath(undefined); setPinned(undefined); };
  const list = tree ? <div className="min-h-0">
    <FileTreeView controller={tree} onOpen={choose} selectedPath={path} locale={language} upload={false} history={false} />
  </div> : null;
  const older = path !== undefined && pinned?.path === path ? pinned.revision : undefined;
  // `null` (nothing chosen) is what lets a phone show the list alone: ListDetail stacks the detail only when there is one.
  const detail = path === undefined ? null
    : <DocumentDetail key={path} provider={provider} path={path} version={version} options={options} labels={labels} locale={language} older={older}
      onDirty={onDirty} onOpenRevision={revision => setPinned({ path, revision })} onBack={() => setPinned(undefined)} onClose={closeFile} />;
  return <DocumentsWords locale={locale}>
    <ListDetail list={list} detail={detail} onBack={closeFile} />
  </DocumentsWords>;
}
