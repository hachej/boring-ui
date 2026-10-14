'use client';

// The documents screen: the workspace's Library is the list (`ListDetail`: beside the file on a wide screen, one pane at a time on a phone);
// the chosen file opens in the same viewer the Library uses (editable where it edits); its Revisions sit beside it. An older revision opens
// read-only in the artifact panel (the viewer that shows a pinned version), and « Latest » returns to the editable file. Every file and
// every version is read through the one `revisionProvider` the host binds (the files guide). Host concern: Pi has no document screens.
import { useEffect, useMemo, useState } from 'react';
import { createFileTreeController } from '@hachej/boring-ui-kit/file-tree';
import type { FileTreeController } from '@hachej/boring-ui-kit/file-tree';
import { FileTreeView } from '../file-tree/file-tree';
import type { RevisionProvider } from '@hachej/boring-files/revision';
import { mediaTypeOf, viewerKindOf } from '@hachej/boring-files/file-types';
import { ListDetail } from '../app-shell/list-detail';
import { ArtifactPanel } from '../pi-app/artifact-panel';
import type { ArtifactDescriptor } from '../pi-chat/artifact';
import type { CustomViewers, ViewerOptions } from '../pi-app/artifact-panel';
import { FileViewer } from '../pi-app/file-viewer';
import { ViewerFrame } from '../viewers/viewer-frame';
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

/** An older revision of a file, read-only. Text, Markdown and HTML have a read-only view of a pinned version; other kinds do not here. */
function OlderVersion({ provider, path, revision, options, unsupported, onLatest, onClose }: {
  readonly provider: RevisionProvider;
  readonly path: string;
  readonly revision: string;
  readonly options: ViewerOptions;
  readonly unsupported: string;
  readonly onLatest: () => void;
  readonly onClose: () => void;
}) {
  const name = path.split('/').pop() || path;
  const kind = viewerKindOf(path);
  const type = kind === 'markdown' ? 'markdown' : kind === 'html' ? 'html' : kind === 'text' ? 'code' : undefined;
  if (type === undefined) return <ViewerFrame title={name} onClose={onClose}><p role="status" className="m-0 p-4 text-sm text-muted-foreground">{unsupported}</p></ViewerFrame>;
  const artifact: ArtifactDescriptor = { schema: 'boring.artifact', version: 1, title: name, type, mediaType: mediaTypeOf(path), target: provider.locate(path), revision };
  return <ArtifactPanel active={{ descriptor: artifact, follow: false }} versions={[]} options={options} onSelect={onLatest} onClose={onClose} />;
}

function DocumentDetail({ provider, path, version, options, labels, locale, older, onOpenRevision, onClose }: {
  readonly provider: RevisionProvider;
  readonly path: string;
  readonly version: number;
  readonly options: ViewerOptions;
  readonly labels: DocumentsLabels;
  readonly locale: DocumentsLocale;
  /** The older revision on show, `undefined` for the latest. */
  readonly older: string | undefined;
  readonly onOpenRevision: (revision: string | undefined) => void;
  readonly onClose: () => void;
}) {
  return <div data-testid="documents-detail" className="flex h-full min-h-0 flex-col md:flex-row">
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {older === undefined
        ? <FileViewer path={path} locator={provider.locate(path)} options={options} onClose={onClose} />
        : <OlderVersion provider={provider} path={path} revision={older} options={options} unsupported={labels.unsupportedPreview} onLatest={() => onOpenRevision(undefined)} onClose={onClose} />}
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
  // An older revision of the file on show (`undefined`: the latest, editable as the Library opens it).
  const [pinned, setPinned] = useState<{ readonly path: string; readonly revision: string }>();
  const options = useMemo<ViewerOptions>(() => ({ client: provider, identity: provider.identity, ...(viewers ? { viewers } : {}), ...(share ? { share } : {}) }), [provider, viewers, share]);
  const list = tree ? <FileTreeView controller={tree} onOpen={next => { setPath(next); setPinned(undefined); }} selectedPath={path} locale={language} upload={false} history={false} /> : null;
  const older = path !== undefined && pinned?.path === path ? pinned.revision : undefined;
  const detail = path === undefined
    ? <p role="status" className="m-0 p-6 text-sm text-muted-foreground">{labels.selectFile}</p>
    : <DocumentDetail key={path} provider={provider} path={path} version={version} options={options} labels={labels} locale={language} older={older}
      onOpenRevision={revision => setPinned(revision === undefined || path === undefined ? undefined : { path, revision })}
      onClose={() => { setPath(undefined); setPinned(undefined); }} />;
  return <DocumentsWords locale={locale}>
    <ListDetail list={list} detail={detail} onBack={() => { setPath(undefined); setPinned(undefined); }} />
  </DocumentsWords>;
}
