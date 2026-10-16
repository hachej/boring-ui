'use client';

import { Collapsible, DropdownMenu } from 'radix-ui';
import { ChevronRight, Download, File, FileCode, FileImage, FileSpreadsheet, FileText, Folder, FolderOpen, History, MoreHorizontal, Search, Upload, X } from 'lucide-react';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarMenuSub } from './file-tree-shadcn.js';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { ResourceSnapshot } from '@hachej/boring-files';
import type { FileEntry, RevisionProvider, SavedRevision } from '@hachej/boring-files/revision';
import { createFileTreeController } from './file-tree.js';
import type { FileListing, FileTreeController } from './file-tree.js';

/** Every word of the tree, so a host can translate it. Functions receive what they name. */
export const defaultFileTreeLabels = {
  region: 'Workspace files',
  tree: 'Files',
  search: 'Search files',
  searchPlaceholder: 'Search files…',
  refresh: 'Refresh',
  upload: 'Upload',
  uploadFiles: 'Upload files',
  uploads: 'Uploads',
  loading: 'Loading files…',
  retry: 'Retry',
  noMatches: 'No matching files.',
  empty: 'No files yet',
  emptyHint: 'Upload or ask the agent to create one',
  library: 'Library',
  close: 'Close Library',
  open: 'Open',
  download: 'Download',
  downloadingFailed: 'The file could not be downloaded.',
  actionsOf: (path: string) => `Actions for ${path}`,
  shownItems: (count: number) => `${count} items shown`,
  folder: 'Folder',
  file: 'File',
  image: 'Image',
  document: 'Document',
  dropFiles: 'Drop files to upload',
  loadMore: 'Load more',
  history: 'Version history',
  historyOf: (path: string) => `History of ${path}`,
  closeHistory: 'Close history',
  loadingHistory: 'Loading history…',
  noHistory: 'No retained versions.',
  earlierVersion: 'Earlier version',
  historyUnavailable: 'History unavailable',
  revisionUnavailable: 'This revision is unavailable',
  readOnlyRevision: (bytes: number) => `Read-only revision · ${bytes} bytes`,
  binaryFile: (mediaType: string) => `Binary file (${mediaType})`,
  uploading: 'Uploading…',
  saved: 'Saved',
  unconfirmed: 'Unconfirmed',
  checkUpload: 'Check upload status',
  uploadStatusUnavailable: 'Upload status unavailable',
  uploadFailed: (name: string) => `${name}: upload failed`,
};
export type FileTreeLabels = typeof defaultFileTreeLabels;

/** The tree's words in French (`locale="fr"`). */
export const frenchFileTreeLabels: FileTreeLabels = {
  region: 'Fichiers de l’espace',
  tree: 'Fichiers',
  search: 'Rechercher un fichier',
  searchPlaceholder: 'Rechercher un fichier…',
  refresh: 'Actualiser',
  upload: 'Importer',
  uploadFiles: 'Importer des fichiers',
  uploads: 'Imports',
  loading: 'Chargement des fichiers…',
  retry: 'Réessayer',
  noMatches: 'Aucun fichier ne correspond.',
  empty: 'Aucun fichier pour le moment',
  emptyHint: 'Importez un fichier ou demandez à l’agent d’en créer un',
  library: 'Bibliothèque',
  close: 'Fermer la bibliothèque',
  open: 'Ouvrir',
  download: 'Télécharger',
  downloadingFailed: 'Impossible de télécharger le fichier.',
  actionsOf: path => `Actions pour ${path}`,
  shownItems: count => `${count} éléments affichés`,
  folder: 'Dossier',
  file: 'Fichier',
  image: 'Image',
  document: 'Document',
  dropFiles: 'Déposez les fichiers à importer',
  loadMore: 'Afficher plus',
  history: 'Historique',
  historyOf: path => `Historique de ${path}`,
  closeHistory: 'Fermer l’historique',
  loadingHistory: 'Chargement de l’historique…',
  noHistory: 'Aucune version conservée.',
  earlierVersion: 'Version antérieure',
  historyUnavailable: 'Historique indisponible',
  revisionUnavailable: 'Cette version n’est pas disponible',
  readOnlyRevision: bytes => `Version en lecture seule · ${bytes} octets`,
  binaryFile: mediaType => `Fichier binaire (${mediaType})`,
  uploading: 'Import en cours…',
  saved: 'Enregistré',
  unconfirmed: 'Non confirmé',
  checkUpload: 'Vérifier l’import',
  uploadStatusUnavailable: 'État de l’import indisponible',
  uploadFailed: name => `${name} : échec de l’import`,
};
/** The languages the tree ships with; anything else is set word by word through `labels`. */
export type FileTreeLocale = 'en' | 'fr';
const LOCALES: Readonly<Record<FileTreeLocale, FileTreeLabels>> = { en: defaultFileTreeLabels, fr: frenchFileTreeLabels };

function fileKind(path: string, labels: FileTreeLabels) {
  const extension = path.includes('.') ? path.slice(path.lastIndexOf('.') + 1).toLowerCase() : '';
  if (['md', 'markdown'].includes(extension)) return { icon: FileText, label: 'Markdown', tone: 'document' };
  if (extension === 'pdf') return { icon: FileText, label: 'PDF', tone: 'pdf' };
  if (['csv', 'xls', 'xlsx', 'tsv'].includes(extension)) return { icon: FileSpreadsheet, label: extension.toUpperCase(), tone: 'table' };
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(extension)) return { icon: FileImage, label: labels.image, tone: 'image' };
  if (['json', 'js', 'mjs', 'ts', 'tsx', 'html', 'css', 'xml', 'yml', 'yaml'].includes(extension)) return { icon: FileCode, label: extension.toUpperCase(), tone: 'code' };
  return { icon: extension ? FileText : File, label: extension === 'txt' ? labels.document : extension.toUpperCase() || labels.file, tone: 'document' };
}

function fileSize(bytes: number, locale: FileTreeLocale): string {
  const unit = bytes < 1024 ? 0 : bytes < 1024 ** 2 ? 1 : bytes < 1024 ** 3 ? 2 : 3;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: unit ? 1 : 0 }).format(bytes / 1024 ** unit)} ${['B', 'KB', 'MB', 'GB'][unit]}`;
}

export interface FileTreeProps {
  readonly revisionProvider: RevisionProvider;
  readonly onOpen?: (path: string) => void;
  readonly selectedPath?: string;
  readonly className?: string;
  readonly uploadDirectory?: string;
  /** The tree's language. Default `en`. */
  readonly locale?: FileTreeLocale;
  /** Words over the locale's, for a language or a wording the tree does not ship with. */
  readonly labels?: Partial<FileTreeLabels>;
  /** Offer the Upload button. Default true. */
  readonly upload?: boolean;
  /** Offer version history in each file's actions menu. Default true. */
  readonly history?: boolean;
  /** Offer the Refresh button. Default true; a host whose tree follows the workspace's change feed (`refreshKey`) can hide it. */
  readonly refresh?: boolean;
  /** `list` (default) includes a Library header, inset search, metadata and file actions. `plain` keeps the compact tree. */
  readonly variant?: 'plain' | 'list';
  /** The list header's title, over the locale's Library label. */
  readonly title?: string;
  /** A host-owned dismissal action, shown at the right of the list header. */
  readonly onClose?: () => void;
  /** Reload the open folders and the current search whenever this value changes (for example after the agent saves a file). */
  readonly refreshKey?: unknown;
  /** Reload the open history panel whenever this value changes (for example the seq of the workspace's latest change event). */
  readonly historyKey?: unknown;
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
  return owned?.provider === props.revisionProvider ? <FileTreeView {...props} controller={owned.controller} /> : <p role="status">{props.labels?.loading ?? LOCALES[props.locale ?? 'en'].loading}</p>;
}

export interface FileTreeViewProps extends Omit<FileTreeProps, 'revisionProvider'> {
  readonly controller: FileTreeController;
}

/** Renders a borrowed controller, for a workspace whose chat and tree share upload state. */
export function FileTreeView({ controller, onOpen, selectedPath, className, uploadDirectory = 'uploads', locale = 'en', labels: given, upload = true, history = true, refresh = true, variant = 'list', title, onClose, refreshKey, historyKey }: FileTreeViewProps) {
  const list = variant === 'list';
  const labels: FileTreeLabels = { ...LOCALES[locale], ...given };
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const shownKey = useRef(refreshKey);
  useEffect(() => {
    if (Object.is(shownKey.current, refreshKey)) return;
    shownKey.current = refreshKey;
    const { query, expanded } = controller.getSnapshot();
    if (query) void controller.search(query);
    else for (const directory of ['', ...expanded]) void controller.refresh(directory);
  }, [controller, refreshKey]);
  const tree = useRef<HTMLUListElement>(null);
  const [panel, setPanel] = useState<HTMLElement | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dropping, setDropping] = useState(false);
  const [focused, setFocused] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [historyPath, setHistoryPath] = useState<string>();
  const uploadFiles = async (files: readonly globalThis.File[]) => {
    setUploadError('');
    const errors: string[] = [];
    for (const file of files) {
      const path = uploadDirectory ? `${uploadDirectory}/${file.name}` : file.name;
      try { await controller.upload({ path, bytes: new Uint8Array(await file.arrayBuffer()), mediaType: file.type || 'application/octet-stream' }); }
      catch (error) { errors.push(error instanceof Error ? error.message : labels.uploadFailed(file.name)); }
    }
    if (errors.length) setUploadError(errors.join(' '));
  };
  const uploadButton = <button type="button" className="file-tree-upload" onClick={() => fileInput.current?.click()}><Upload aria-hidden="true" />{labels.upload}</button>;

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
    if (!listing || listing.kind === 'loading') return <li role="none"><span role="status">{labels.loading}</span></li>;
    if (listing.kind === 'error') return <li role="none"><span role="alert">{listing.reason}</span> <button type="button" onClick={() => { void (search ? controller.search(state.query) : controller.refresh(directory)); }}>{labels.retry}</button></li>;
    return <>
      {listing.entries.length === 0 && <li role="none" className={list && !directory ? 'file-tree-empty' : 'file-tree-status'}>
        {list && !directory && <FolderOpen aria-hidden="true" />}
        <span>{search ? labels.noMatches : labels.empty}</span>
        {list && !directory && !search && <><p>{labels.emptyHint}</p>{upload && uploadButton}</>}
      </li>}
      {listing.cursor !== undefined && <li role="none"><button type="button" onClick={() => { void (search ? controller.moreSearch() : controller.more(directory)); }}>{labels.loadMore}</button></li>}
    </>;
  };
  const renderEntries = (directory: string, level: number): ReactNode => <>
    {(state.directories.get(directory)?.entries ?? []).map(entry => renderEntry(entry, level))}
    {listingStatus(state.directories.get(directory), directory)}
  </>;
  const renderEntry = (entry: FileEntry, level: number): ReactNode => {
    const folder = entry.kind === 'directory';
    // A search result shows its name, with its folder beside it in muted text.
    const name = entry.path.split('/').at(-1);
    const parent = state.query && entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) : '';
    const kind = folder ? { icon: Folder, label: labels.folder, tone: 'folder' } : fileKind(entry.path, labels);
    const Icon = kind.icon;
    const button = <SidebarMenuButton tabIndex={-1} title={entry.path} isActive={selectedPath === entry.path}
      className="min-w-0 flex-1"
      onClick={() => { focus(entry.path); if (!folder) onOpen?.(entry.path); }}>
      {folder ? <ChevronRight aria-hidden="true" /> : list && <span className="file-tree-chevron-space" aria-hidden="true" />}
      {list ? <span className="file-tree-tile" data-kind={kind.tone}><Icon aria-hidden="true" /></span> : <Icon aria-hidden="true" />}
      <span className="file-tree-copy"><span className="file-tree-name">{name}</span>
        {list ? <span data-file-meta>{kind.label}{!folder && ` · ${fileSize(entry.size, locale)}`}{parent && ` · ${parent}`}</span> : parent && <span className="text-xs text-muted-foreground">{parent}</span>}
      </span>
    </SidebarMenuButton>;
    const item = <SidebarMenuItem key={entry.path} role="treeitem" data-path={entry.path}
      aria-level={level} aria-selected={selectedPath === entry.path} aria-expanded={folder ? state.expanded.has(entry.path) : undefined}
      tabIndex={focusPath === entry.path ? 0 : -1}
      onFocus={event => { if (event.target === event.currentTarget) setFocused(entry.path); }}
      onKeyDown={event => { if (event.target === event.currentTarget) keyboard(event, entry); }}
      className="group/collapsible rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <div className="flex items-center gap-1">
        {folder ? <Collapsible.Trigger asChild>{button}</Collapsible.Trigger> : button}
        {!folder && <FileActions controller={controller} entry={entry} labels={labels} container={panel}
          onOpen={onOpen ? () => onOpen(entry.path) : undefined} onHistory={history ? () => setHistoryPath(entry.path) : undefined} onError={setUploadError} />}
      </div>
      {folder && !state.query && <Collapsible.Content asChild><SidebarMenuSub role="group" className={list ? 'border-border!' : undefined}>{renderEntries(entry.path, level + 1)}</SidebarMenuSub></Collapsible.Content>}
    </SidebarMenuItem>;
    return folder ? <Collapsible.Root key={entry.path} asChild open={state.expanded.has(entry.path)}
      onOpenChange={() => { void controller.toggle(entry.path); }}>{item}</Collapsible.Root> : item;
  };

  const visibleListing = state.query ? state.search : state.directories.get('');
  const paginated = visibleListing?.kind === 'ready' && visibleListing.cursor !== undefined;
  return <section ref={setPanel} data-boring="file-tree" data-variant={variant} data-dropping={dropping || undefined} className={className} aria-label={labels.region}
    onDragEnter={event => { if (upload && event.dataTransfer.types.includes('Files')) { event.preventDefault(); dragDepth.current++; setDropping(true); } }}
    onDragOver={event => { if (upload && event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } }}
    onDragLeave={event => { if (upload && event.dataTransfer.types.includes('Files')) { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDropping(false); } }}
    onDrop={event => { if (upload && event.dataTransfer.types.includes('Files')) { event.preventDefault(); dragDepth.current = 0; setDropping(false); void uploadFiles(Array.from(event.dataTransfer.files)); } }}>
    {list && <header className="file-tree-header"><h2>{title ?? labels.library}</h2>
      <span className="file-tree-count" aria-label={labels.shownItems(rows.length)}>{rows.length}{paginated ? '+' : ''}</span>
      {upload && uploadButton}
      {onClose && <button type="button" className="file-tree-close" aria-label={labels.close} onClick={onClose}><X aria-hidden="true" /></button>}
    </header>}
    <div className="file-tree-toolbar">
      <div className="file-tree-search">{list && <Search aria-hidden="true" />}
        <input type="search" aria-label={labels.search} placeholder={labels.searchPlaceholder} value={state.query}
          onChange={event => { void controller.search(event.currentTarget.value); }} />
      </div>
      {refresh && <button type="button" aria-label={labels.refresh} onClick={() => { void (state.query ? controller.search(state.query) : controller.refresh()); }}>{labels.refresh}</button>}
      {!list && upload && uploadButton}
    </div>
    {upload && <input ref={fileInput} aria-label={labels.uploadFiles} type="file" multiple onChange={event => {
      const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ''; void uploadFiles(files);
    }} />}
    {dropping && <div className="file-tree-drop" role="status"><Upload aria-hidden="true" />{labels.dropFiles}</div>}
    {uploadError && <p role="alert">{uploadError}</p>}
    <SidebarMenu ref={tree} role="tree" aria-label={labels.tree} className={list ? 'm-0 list-none p-3' : 'm-0 list-none p-2'}>
      {state.query ? <>{state.search.entries.map(entry => renderEntry(entry, 1))}{listingStatus(state.search, '', true)}</> : renderEntries('', 1)}
    </SidebarMenu>
    {state.uploads.length > 0 && <ul aria-label={labels.uploads} className="file-tree-uploads list-none p-2 text-sm">{state.uploads.map(upload => <li key={upload.operationId} data-operation={upload.operationId}>
      <span>{upload.path}: {upload.state.kind === 'pending' ? labels.uploading : upload.state.result.kind === 'committed' ? labels.saved : upload.state.result.kind === 'partial' ? labels.unconfirmed : upload.state.result.reason}</span>
      {upload.state.kind === 'settled' && upload.state.result.kind === 'unknown' && <button type="button" onClick={() => { void controller.reconcile(upload.operationId).catch(error => setUploadError(error instanceof Error ? error.message : labels.uploadStatusUnavailable)); }}>{labels.checkUpload}</button>}
    </li>)}</ul>}
    {history && historyPath !== undefined && <FileHistory key={historyPath} controller={controller} path={historyPath} labels={labels} reload={historyKey} onClose={() => setHistoryPath(undefined)} />}
  </section>;
}

function FileActions({ controller, entry, labels, container, onOpen, onHistory, onError }: {
  readonly controller: FileTreeController;
  readonly entry: FileEntry;
  readonly labels: FileTreeLabels;
  readonly container: HTMLElement | null;
  readonly onOpen: (() => void) | undefined;
  readonly onHistory: (() => void) | undefined;
  readonly onError: (reason: string) => void;
}) {
  const lifetime = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => lifetime.current?.abort(), []);
  const download = async () => {
    lifetime.current?.abort();
    const abort = new AbortController(); lifetime.current = abort;
    try {
      const result = await controller.revisionProvider.read({ target: controller.revisionProvider.locate(entry.path), revision: { kind: 'latest' } }, abort.signal);
      if (abort.signal.aborted) return;
      if (result.kind !== 'available') { onError(labels.downloadingFailed); return; }
      const url = URL.createObjectURL(new Blob([new Uint8Array(result.snapshot.bytes)], { type: result.snapshot.mediaType }));
      const link = document.createElement('a'); link.href = url; link.download = entry.path.split('/').at(-1) ?? entry.path;
      document.body.append(link); link.click(); link.remove();
      // Give the browser time to consume the URL before releasing its bytes.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { if (!abort.signal.aborted) onError(labels.downloadingFailed); }
  };
  return <DropdownMenu.Root modal={false}>
    <DropdownMenu.Trigger className="file-tree-more" aria-label={labels.actionsOf(entry.path)}><MoreHorizontal aria-hidden="true" /></DropdownMenu.Trigger>
    <DropdownMenu.Portal container={container}>
      <DropdownMenu.Content data-boring="file-actions" align="end" sideOffset={4} collisionPadding={16} onEscapeKeyDown={event => event.stopPropagation()}>
        {onOpen && <DropdownMenu.Item onSelect={onOpen}><FolderOpen aria-hidden="true" />{labels.open}</DropdownMenu.Item>}
        {onHistory && <DropdownMenu.Item data-action="history" onSelect={onHistory}><History aria-hidden="true" />{labels.history}</DropdownMenu.Item>}
        <DropdownMenu.Item onSelect={() => { void download(); }}><Download aria-hidden="true" />{labels.download}</DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>;
}

function FileHistory({ controller, path, labels, reload, onClose }: { readonly controller: FileTreeController; readonly path: string; readonly labels: FileTreeLabels; readonly reload?: unknown; readonly onClose: () => void }) {
  const [versions, setVersions] = useState<readonly SavedRevision[]>();
  const [failure, setFailure] = useState('');
  const [selected, setSelected] = useState<string>();
  const [preview, setPreview] = useState<ResourceSnapshot>();
  useEffect(() => {
    const abort = new AbortController();
    void controller.history(path, abort.signal).then(value => { if (!abort.signal.aborted) setVersions(value); }, error => { if (!abort.signal.aborted) setFailure(error instanceof Error ? error.message : labels.historyUnavailable); });
    return () => abort.abort();
  }, [controller, path, reload]);
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
      else setFailure(result.kind === 'denied' || result.kind === 'unavailable' ? result.reason : labels.revisionUnavailable);
    }, () => { if (!abort.signal.aborted) setFailure(labels.revisionUnavailable); });
    return () => abort.abort();
  }, [controller, path, selected]);
  let text: string | undefined;
  if (preview) { try { text = new TextDecoder('utf-8', { fatal: true }).decode(preview.bytes); } catch { /* Binary history remains a byte-qualified read-only preview. */ } }
  return <section aria-label={labels.historyOf(path)} className="border-t border-border p-2 text-sm">
    <div className="flex items-center justify-between gap-2"><h3 className="font-medium">{labels.historyOf(path)}</h3><button type="button" onClick={onClose}>{labels.closeHistory}</button></div>
    {failure && <p role="alert">{failure}</p>}
    {!versions && !failure && <p role="status">{labels.loadingHistory}</p>}
    {versions?.length === 0 && <p>{labels.noHistory}</p>}
    <ul className="m-0 list-none p-0">{versions?.map(version => <li key={version.revision}><button type="button" aria-pressed={selected === version.revision} onClick={() => setSelected(version.revision)}>
      {version.savedAt ? new Date(version.savedAt).toLocaleString() : labels.earlierVersion} · {version.revision.slice(0, 8)}
    </button></li>)}</ul>
    {preview && <div data-testid="file-history-preview" data-revision={preview.ref.revision}><p>{labels.readOnlyRevision(preview.bytes.byteLength)}</p>{text === undefined ? <p>{labels.binaryFile(preview.mediaType)}</p> : <pre className="max-h-80 overflow-auto whitespace-pre-wrap">{text}</pre>}</div>}
  </section>;
}
