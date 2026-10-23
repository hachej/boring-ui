'use client';

import type { Collapsible } from '@base-ui/react/collapsible';
import { ChevronRight, Download, File, FileCode, FileImage, FileSpreadsheet, FileText, Folder, FolderInput, FolderOpen, History, LoaderCircle, MoreHorizontal, Pencil, Search, Trash2, Upload, X } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ComponentProps, DragEvent, KeyboardEvent, ReactNode } from 'react';
import type { ResourceSnapshot } from '@hachej/boring-files';
import type { FileEntry, RevisionProvider, SavedRevision } from '@hachej/boring-files/revision';
import { createFileTreeController } from './file-tree.js';
import type { FileListing, FileMutation, FileTreeController } from './file-tree.js';

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
  childCount: (count: number) => `${count} item${count === 1 ? '' : 's'}`,
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
  tooLarge: 'The file is too large to upload.',
  uploadProgress: (name: string) => `Uploading ${name}`,
  cancelUpload: (name: string) => `Cancel uploading ${name}`,
  rename: 'Rename',
  renameOf: (path: string) => `Rename ${path}`,
  move: 'Move to…',
  moveTitle: (name: string) => `Move ${name}`,
  moveDescription: 'Choose the folder it goes in.',
  root: 'Workspace root',
  delete: 'Delete',
  deleteTitle: (name: string) => `Delete ${name}?`,
  deleteDescription: 'It is removed from this workspace for everyone who uses it.',
  cancel: 'Cancel',
  changing: 'Saving…',
  renamed: (to: string) => `Renamed to ${to}`,
  deleted: 'Deleted',
  changedSince: 'It changed since you opened it, so nothing was changed. Try again.',
  dismiss: (path: string) => `Dismiss the message for ${path}`,
  invalidName: 'A name cannot contain /. Use Move to… to change its folder.',
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
  childCount: count => `${count} élément${count === 1 ? '' : 's'}`,
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
  tooLarge: 'Le fichier est trop volumineux pour être importé.',
  uploadProgress: name => `Import de ${name}`,
  cancelUpload: name => `Annuler l’import de ${name}`,
  rename: 'Renommer',
  renameOf: path => `Renommer ${path}`,
  move: 'Déplacer vers…',
  moveTitle: name => `Déplacer ${name}`,
  moveDescription: 'Choisissez le dossier de destination.',
  root: 'Racine de l’espace',
  delete: 'Supprimer',
  deleteTitle: name => `Supprimer ${name} ?`,
  deleteDescription: 'Il est retiré de cet espace pour tous ceux qui l’utilisent.',
  cancel: 'Annuler',
  changing: 'Enregistrement…',
  renamed: to => `Renommé en ${to}`,
  deleted: 'Supprimé',
  changedSince: 'Il a changé depuis son ouverture, rien n’a donc été modifié. Réessayez.',
  dismiss: path => `Fermer le message pour ${path}`,
  invalidName: 'Un nom ne peut pas contenir /. Utilisez Déplacer vers… pour changer de dossier.',
};
/** The languages the tree ships with; anything else is set word by word through `labels`. */
export type FileTreeLocale = 'en' | 'fr';
/** Carries a dragged file row's path; files dragged in from the computer carry `Files` instead. */
const DRAGGED_FILE = 'application/x-boring-file-path';
const parentPath = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')));
const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1);
const LOCALES: Readonly<Record<FileTreeLocale, FileTreeLabels>> = { en: defaultFileTreeLabels, fr: frenchFileTreeLabels };

function fileKind(path: string, labels: FileTreeLabels) {
  const extension = path.includes('.') ? path.slice(path.lastIndexOf('.') + 1).toLowerCase() : '';
  if (['md', 'markdown'].includes(extension)) return { icon: FileText, label: 'Markdown' };
  if (extension === 'pdf') return { icon: FileText, label: 'PDF' };
  if (['csv', 'xls', 'xlsx', 'tsv'].includes(extension)) return { icon: FileSpreadsheet, label: extension.toUpperCase() };
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(extension)) return { icon: FileImage, label: labels.image };
  if (['json', 'js', 'mjs', 'ts', 'tsx', 'html', 'css', 'xml', 'yml', 'yaml'].includes(extension)) return { icon: FileCode, label: extension.toUpperCase() };
  return { icon: extension ? FileText : File, label: extension === 'txt' ? labels.document : extension.toUpperCase() || labels.file };
}

function fileSize(bytes: number, locale: FileTreeLocale): string {
  const unit = bytes < 1024 ? 0 : bytes < 1024 ** 2 ? 1 : bytes < 1024 ** 3 ? 2 : 3;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: unit ? 1 : 0 }).format(bytes / 1024 ** unit)} ${['B', 'KB', 'MB', 'GB'][unit]}`;
}

export interface FileTreeAction {
  readonly id: 'open' | 'history' | 'download' | 'rename' | 'move' | 'delete';
  readonly label: string;
  readonly icon: ReactNode;
  readonly onSelect: () => void;
  /** Shown as a destructive item (Delete). */
  readonly destructive?: boolean;
  /** The action moves focus itself (an inline input or a dialog): the menu must not return focus to its trigger on close. */
  readonly ownsFocus?: boolean;
}
export interface FileTreeActionsProps {
  readonly label: string;
  readonly icon: ReactNode;
  readonly items: readonly FileTreeAction[];
}
export type FileTreeButtonProps = ComponentProps<'button'> & {
  readonly variant?: 'secondary' | 'ghost' | 'outline' | 'destructive';
  readonly size?: 'default' | 'sm' | 'icon';
};
export interface FileTreeVersionsProps {
  readonly versions: readonly SavedRevision[];
  readonly current: string;
  readonly onSelect: (revision: string) => void;
  readonly locale: FileTreeLocale;
  readonly earlierVersion: string;
}
/** A modal dialog: the delete confirmation and the Move to… folder list. */
export interface FileTreeDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly children?: ReactNode;
  /** The dialog's buttons. */
  readonly footer: ReactNode;
}
/** Host presentation. The registry supplies real shadcn Base UI controls and shared version rows; no primitive fallback. */
export interface FileTreeComponents {
  readonly Button: (props: FileTreeButtonProps) => ReactNode;
  readonly Actions: (props: FileTreeActionsProps) => ReactNode;
  readonly Versions: (props: FileTreeVersionsProps) => ReactNode;
  /** The host's shadcn sidebar menu (`SidebarMenu`, `SidebarMenuItem`, `SidebarMenuSub`). */
  readonly Menu: (props: ComponentProps<'ul'>) => ReactNode;
  readonly MenuItem: (props: ComponentProps<'li'>) => ReactNode;
  readonly MenuSub: (props: ComponentProps<'ul'>) => ReactNode;
  /** The host's shadcn `Input`. */
  readonly Input: (props: ComponentProps<'input'>) => ReactNode;
  /** The host's shadcn `Separator`. */
  readonly Separator: () => ReactNode;
  /** The host's shadcn `Collapsible`, `CollapsibleTrigger` and `CollapsibleContent`. */
  readonly Collapsible: (props: Collapsible.Root.Props) => ReactNode;
  readonly CollapsibleTrigger: (props: Collapsible.Trigger.Props) => ReactNode;
  readonly CollapsibleContent: (props: Collapsible.Panel.Props) => ReactNode;
  /** The host's shadcn `Empty`, composed from an icon, a title, an optional description and optional actions. */
  readonly Empty: (props: { readonly icon?: ReactNode; readonly title: ReactNode; readonly description?: ReactNode; readonly className?: string; readonly children?: ReactNode }) => ReactNode;
  /** The host's shadcn `Progress` (`value` 0–100, `null` while the total is unknown), for uploads through `uploadBlob`. */
  readonly Progress?: (props: { readonly value: number | null; readonly 'aria-label': string }) => ReactNode;
  /** The host's shadcn `Dialog`. Without it the tree offers neither Delete nor Move to… (dragging a file onto a folder still moves it). */
  readonly Dialog?: (props: FileTreeDialogProps) => ReactNode;
}

/** The workspace's effective capabilities (`ResourceCapabilities.effective`) as the host read them. */
export interface FileTreeCapabilities { readonly effective: readonly string[] }

/** How far an upload through `uploadBlob` is. */
export interface UploadProgress { readonly loaded: number; readonly total: number }
/**
 * The host's upload of a large file: it stores the bytes and writes the workspace's pointer file itself, then resolves (with the
 * pointer it wrote). The tree never writes anything for it; it reloads its listing. `signal` aborts it (the row's cancel button);
 * a refusal rejects with `{ error: { code, message } }`, whose `message` the tree shows.
 */
export type UploadBlob = (file: globalThis.File, options: { readonly signal: AbortSignal; readonly onProgress: (progress: UploadProgress) => void }) => Promise<unknown>;

export interface FileTreeProps {
  readonly components: FileTreeComponents;
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
  /** The inline cap in bytes: a larger upload goes to `uploadBlob`, or is refused with `tooLarge` without it. No cap when omitted. */
  readonly maxBytes?: number;
  /** The refusal shown for a file above `maxBytes` when there is no `uploadBlob`. */
  readonly tooLarge?: string;
  /** The host's large-file upload (see `UploadBlob`), used above `maxBytes`. */
  readonly uploadBlob?: UploadBlob;
  /**
   * Narrows the file actions to what this person may do. The client's `rename` turns on Rename and Move to…, its `delete` turns on
   * Delete; when given, only the listed `rename`/`delete` stay. Omitted: whatever the client has.
   */
  readonly capabilities?: FileTreeCapabilities;
  /** A rename or move from the tree committed: `from` is now `to` (a host showing `from` follows it). */
  readonly onRenamed?: (from: string, to: string) => void;
  /** A delete from the tree committed (a host showing `path` closes it). */
  readonly onDeleted?: (path: string) => void;
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

type UploadRow = { readonly kind: 'pending'; readonly size: number }
  | { readonly kind: 'failed'; readonly size: number; readonly reason: string; readonly retryLabel: string; readonly retry: () => void };

/** Renders a borrowed controller, for a workspace whose chat and tree share upload state. */
export function FileTreeView({ components, controller, onOpen, selectedPath, className, uploadDirectory = 'uploads', locale = 'en', labels: given, upload = true, history = true, refresh = true, variant = 'list', title, onClose, refreshKey, historyKey, maxBytes, tooLarge, uploadBlob, capabilities, onRenamed, onDeleted }: FileTreeViewProps) {
  const changed = useRef({ onRenamed, onDeleted }); changed.current = { onRenamed, onDeleted };
  /** Tell the host about a committed rename or delete, so a viewer showing the file follows or closes. */
  const report = (mutation: FileMutation) => {
    if (mutation.state.kind !== 'settled' || mutation.state.result.kind !== 'committed') return mutation;
    if (mutation.kind === 'rename' && mutation.to !== undefined) changed.current.onRenamed?.(mutation.path, mutation.to);
    else if (mutation.kind === 'delete') changed.current.onDeleted?.(mutation.path);
    return mutation;
  };
  const { Button, Actions, Menu: SidebarMenu, MenuItem: SidebarMenuItem, MenuSub: SidebarMenuSub, Input, Collapsible: CollapsibleRoot, CollapsibleTrigger, CollapsibleContent, Empty, Progress, Dialog } = components;
  const can = {
    // The client's methods turn the actions on; capabilities, when the host passes them, only narrow.
    rename: controller.actions.rename && (capabilities === undefined || capabilities.effective.includes('rename')),
    delete: controller.actions.delete && (capabilities === undefined || capabilities.effective.includes('delete')) && Dialog !== undefined,
  };
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
  const fileInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dropping, setDropping] = useState(false);
  const [focused, setFocused] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [historyPath, setHistoryPath] = useState<string>();
  const [renaming, setRenaming] = useState<{ readonly path: string; readonly error?: string; readonly known?: boolean }>();
  const [asking, setAsking] = useState<{ readonly kind: 'delete' | 'move'; readonly path: string }>();
  const [dragged, setDragged] = useState<string>();
  const [dropTarget, setDropTarget] = useState<string>();
  const [localFailures, setLocalFailures] = useState<ReadonlyMap<string, { readonly file: globalThis.File; readonly reason: string }>>(new Map());
  // Uploads through the host's `uploadBlob`, by a key of their own: the name, the progress and the abort behind the cancel button.
  const [blobUploads, setBlobUploads] = useState<ReadonlyMap<string, { readonly name: string; readonly progress: UploadProgress | undefined; readonly abort: AbortController }>>(new Map());
  const blobAborts = useRef(new Set<AbortController>());
  useEffect(() => () => { for (const abort of blobAborts.current) abort.abort(); }, []);
  const uploadLarge = async (file: globalThis.File, send: UploadBlob) => {
    const key = `${file.name}:${Math.random()}`, abort = new AbortController();
    const set = (progress: UploadProgress | undefined) => setBlobUploads(previous => new Map(previous).set(key, { name: file.name, progress, abort }));
    blobAborts.current.add(abort); set(undefined);
    try {
      await send(file, { signal: abort.signal, onProgress: progress => { if (!abort.signal.aborted) set(progress); } });
      if (abort.signal.aborted) return;
      // The host wrote the pointer file: the listing is read again, never written.
      const { query, expanded } = controller.getSnapshot();
      if (query) void controller.search(query); else for (const directory of ['', ...expanded]) void controller.refresh(directory);
    } catch (error) {
      if (!abort.signal.aborted) setUploadError(refusalOf(error) ?? labels.uploadFailed(file.name));
    } finally {
      blobAborts.current.delete(abort);
      setBlobUploads(previous => { const next = new Map(previous); next.delete(key); return next; });
    }
  };
  const uploadFiles = async (files: readonly globalThis.File[]) => {
    setUploadError('');
    for (const file of files) {
      const path = uploadDirectory ? `${uploadDirectory}/${file.name}` : file.name;
      if (maxBytes !== undefined && file.size > maxBytes) {
        if (uploadBlob) void uploadLarge(file, uploadBlob);
        else setLocalFailures(previous => new Map(previous).set(path, { file, reason: tooLarge ?? labels.tooLarge }));
        continue;
      }
      setLocalFailures(previous => { const next = new Map(previous); next.delete(path); return next; });
      try { await controller.upload({ path, bytes: new Uint8Array(await file.arrayBuffer()), mediaType: file.type || 'application/octet-stream' }); }
      catch (error) { setLocalFailures(previous => new Map(previous).set(path, { file, reason: error instanceof Error ? error.message : labels.uploadFailed(file.name) })); }
    }
  };
  const uploadRows = new Map<string, UploadRow>();
  for (const item of state.uploads) {
    if (item.state.kind === 'pending') uploadRows.set(item.path, { kind: 'pending', size: item.size });
    else if (item.state.result.kind === 'committed') uploadRows.delete(item.path);
    else uploadRows.set(item.path, { kind: 'failed', size: item.size,
      reason: item.state.result.kind === 'partial' ? labels.unconfirmed : item.state.result.reason,
      retryLabel: item.state.result.kind === 'unknown' ? labels.checkUpload : labels.retry,
      retry: () => { void controller.retry(item.operationId).catch(error => setUploadError(error instanceof Error ? error.message : labels.uploadStatusUnavailable)); } });
  }
  for (const [path, failure] of localFailures) uploadRows.set(path, { kind: 'failed', size: failure.file.size, reason: failure.reason,
    retryLabel: labels.retry, retry: () => { void uploadFiles([failure.file]); } });
  const uploadButton = <Button type="button" variant="secondary" data-file-upload onClick={() => fileInput.current?.click()}><Upload aria-hidden="true" />{labels.upload}</Button>;
  const mutationRows = new Map<string, FileMutation>();
  for (const item of state.mutations) if (item.state.kind === 'pending' || item.state.result.kind !== 'committed') mutationRows.set(item.path, item);
  const mutationReason = (item: FileMutation) => item.state.kind === 'pending' ? labels.changing
    : item.state.result.kind === 'committed' ? item.kind === 'delete' ? labels.deleted : labels.renamed(item.to ?? '')
    : item.state.result.kind === 'conflict' ? labels.changedSince : item.state.result.kind === 'partial' ? labels.unconfirmed : item.state.result.reason;
  // A refusal of the name itself (empty, `..`, the same name) keeps the input open with the reason; anything else is the row's.
  const refused = (path: string) => (error: unknown) => {
    if (error instanceof TypeError) setRenaming(current => ({ ...current, path, error: error.message }));
    else setUploadError(error instanceof Error ? error.message : labels.changedSince);
  };
  const startRename = (path: string) => {
    if (!can.rename) return;
    setRenaming({ path });
    void controller.prepare(path).then(revision => { if (revision !== undefined) setRenaming(current => current?.path === path ? { ...current, known: true } : current); });
  };
  const ask = (kind: 'delete' | 'move', path: string) => {
    if (!Dialog || (kind === 'delete' ? !can.delete : !can.rename)) return;
    void controller.prepare(path); setAsking({ kind, path });
  };
  const commitRename = (path: string, value: string) => {
    const name = value.trim();
    if (!name || name === baseName(path)) { setRenaming(undefined); focus(path); return; }
    const to = parentPath(path) ? `${parentPath(path)}/${name}` : name;
    if (name.includes('/')) { setRenaming(current => ({ ...current, path, error: labels.invalidName })); return; }
    setRenaming(undefined); focus(path);
    void controller.rename(path, to).then(report).then(result => { if (result.state.kind === 'settled' && result.state.result.kind === 'committed') setFocused(to); }, refused(path));
  };
  const moveTo = (path: string, folder: string) => {
    setAsking(undefined);
    if (parentPath(path) === folder) return;
    void controller.move(path, folder).then(report).catch(refused(path));
  };
  const closeAsking = () => { const path = asking?.path; setAsking(undefined); if (path) requestAnimationFrame(() => focus(path)); };
  const draggedPath = (event: DragEvent) => event.dataTransfer.types.includes(DRAGGED_FILE) ? dragged ?? event.dataTransfer.getData(DRAGGED_FILE) : undefined;
  /** A folder (or `''`, the root) accepts a dragged file that is not already in it. */
  const dropHandlers = (folder: string) => can.rename ? {
    onDragEnter: (event: DragEvent) => { const path = draggedPath(event); if (path === undefined || parentPath(path) === folder) return; event.preventDefault(); event.stopPropagation(); setDropTarget(folder); },
    onDragOver: (event: DragEvent) => { const path = draggedPath(event); if (path === undefined || parentPath(path) === folder) return; event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'; if (dropTarget !== folder) setDropTarget(folder); },
    onDragLeave: (event: DragEvent) => { if (draggedPath(event) !== undefined && dropTarget === folder && !event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(undefined); },
    onDrop: (event: DragEvent) => {
      const path = draggedPath(event); if (path === undefined) return;
      event.preventDefault(); event.stopPropagation(); setDropTarget(undefined); setDragged(undefined);
      if (path && parentPath(path) !== folder) void controller.move(path, folder).then(report).catch(refused(path));
    },
  } : {};

  const rows: { readonly entry: FileEntry; readonly level: number }[] = [];
  function flatten(directory: string, level: number): void {
    for (const entry of state.directories.get(directory)?.entries ?? []) {
      rows.push({ entry, level });
      if (entry.kind === 'directory' && state.expanded.has(entry.path)) flatten(entry.path, level + 1);
    }
  }
  if (state.query) for (const entry of state.search.entries) rows.push({ entry, level: 1 }); else flatten('', 1);
  const visiblePaths = new Set(rows.map(row => row.entry.path));
  const temporaryEntries: FileEntry[] = [...uploadRows].filter(([path]) => !visiblePaths.has(path) && path.toLowerCase().includes(state.query.toLowerCase()))
    .map(([path, status]) => ({ path, kind: 'file', size: status.size }));
  const temporaryPaths = new Set(temporaryEntries.map(entry => entry.path));
  for (const entry of temporaryEntries) rows.push({ entry, level: 1 });
  const focusPath = rows.some(row => row.entry.path === focused) ? focused : rows[0]?.entry.path;
  const focus = (path: string | undefined) => {
    if (path === undefined) return;
    setFocused(path);
    const nodes = tree.current?.querySelectorAll<HTMLElement>('[role=treeitem]');
    for (const node of Array.from(nodes ?? [])) if (node.dataset.path === path) node.focus();
  };
  /** Files only: a provider renames and deletes regular files, and a row busy uploading or changing waits. */
  const mutable = (entry: FileEntry) => entry.kind === 'file' && !temporaryPaths.has(entry.path) && uploadRows.get(entry.path)?.kind !== 'pending' && mutationRows.get(entry.path)?.state.kind !== 'pending';
  /** A blob pointer's row shows the file it stands for, not the pointer's own name: it can be moved or deleted, not renamed in place. */
  const renameable = (entry: FileEntry) => !entry.blob;
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
      case 'Enter': case ' ': if (entry.kind === 'directory') void controller.toggle(entry.path); else if (!temporaryPaths.has(entry.path)) onOpen?.(entry.path); break;
      case 'F2': if (!mutable(entry) || !can.rename || renameable(entry) === false) return; startRename(entry.path); break;
      case 'Delete': if (!mutable(entry) || !can.delete) return; ask('delete', entry.path); break;
      default: return;
    }
    event.preventDefault();
  };
  const listingStatus = (listing: FileListing | undefined, directory: string, search = false): ReactNode => {
    if (!listing || listing.kind === 'loading') return <li role="none"><span role="status">{labels.loading}</span></li>;
    if (listing.kind === 'error') return <li role="none"><span role="alert">{listing.reason}</span> <Button type="button" variant="ghost" onClick={() => { void (search ? controller.search(state.query) : controller.refresh(directory)); }}>{labels.retry}</Button></li>;
    return <>
      {listing.entries.length === 0 && (directory || temporaryEntries.length === 0) && <li role="none" className={list && !directory ? undefined : 'file-tree-status'}>
        {list && !directory
          ? <Empty className="file-tree-empty" icon={<FolderOpen aria-hidden="true" />} title={search ? labels.noMatches : labels.empty} description={search ? undefined : labels.emptyHint}>{!search && upload && uploadButton}</Empty>
          : <span>{search ? labels.noMatches : labels.empty}</span>}
      </li>}
      {listing.cursor !== undefined && <li role="none"><Button type="button" variant="ghost" onClick={() => { void (search ? controller.moreSearch() : controller.more(directory)); }}>{labels.loadMore}</Button></li>}
    </>;
  };
  const renderEntries = (directory: string, level: number): ReactNode => <>
    {(state.directories.get(directory)?.entries ?? []).map(entry => renderEntry(entry, level))}
    {listingStatus(state.directories.get(directory), directory)}
  </>;
  const renderEntry = (entry: FileEntry, level: number): ReactNode => {
    const folder = entry.kind === 'directory';
    const temporary = temporaryPaths.has(entry.path);
    const status = uploadRows.get(entry.path);
    // A pointer file shows the file it stands for: its name, kind and size (`withBlobPointers` resolved it where the listing was read).
    const blob = entry.blob && 'url' in entry.blob ? entry.blob : undefined;
    const name = blob?.name ?? entry.path.split('/').at(-1);
    const parent = (state.query || temporary) && entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) : '';
    const children = folder ? state.directories.get(entry.path) : undefined;
    const childCount = children?.kind === 'ready' && children.cursor === undefined ? labels.childCount(children.entries.length) : undefined;
    const kind = folder ? { icon: Folder, label: labels.folder } : fileKind(blob?.name ?? entry.path, labels);
    const Icon = kind.icon;
    const mutation = mutationRows.get(entry.path);
    const changeable = mutable(entry);
    const draggable = changeable && can.rename;
    const button = <Button type="button" variant={selectedPath === entry.path ? 'secondary' : 'ghost'} data-active={selectedPath === entry.path} tabIndex={-1} title={entry.path} disabled={temporary}
      className="file-tree-row-button" draggable={draggable || undefined}
      onClick={() => { focus(entry.path); if (!folder) onOpen?.(entry.path); }}>
      {folder ? <ChevronRight aria-hidden="true" /> : list && <span className="file-tree-chevron-space" aria-hidden="true" />}
      <Icon aria-hidden="true" />
      <span className="file-tree-copy"><span className="file-tree-name">{name}</span>
        {list ? folder ? childCount !== undefined && <span data-file-meta>{childCount}</span> : <span data-file-meta>{kind.label} · {fileSize(blob?.size ?? entry.size, locale)}{parent && ` · ${parent}`}</span> : parent && <span className="file-tree-parent" data-file-meta>{parent}</span>}
      </span>
    </Button>;
    const editing = renaming?.path === entry.path && can.rename;
    const mutationFailed = mutation?.state.kind === 'settled';
    const item = <SidebarMenuItem key={entry.path} role="treeitem" data-path={entry.path} data-blob-type={blob?.type} data-upload-state={status?.kind}
      data-mutation-state={mutation ? mutationFailed ? 'failed' : 'pending' : undefined} data-drop-target={folder && dropTarget === entry.path ? 'true' : undefined}
      data-dragging={dragged === entry.path || undefined}
      aria-busy={status?.kind === 'pending' || mutation?.state.kind === 'pending' || undefined}
      {...(folder ? dropHandlers(entry.path) : {})}
      {...(draggable ? {
        onDragStart: (event: DragEvent) => {
          if (event.target !== event.currentTarget && !(event.target instanceof Element && event.target.closest('.file-tree-row-button'))) return;
          event.stopPropagation(); event.dataTransfer.setData(DRAGGED_FILE, entry.path); event.dataTransfer.effectAllowed = 'move';
          setDragged(entry.path); void controller.prepare(entry.path);
        },
        onDragEnd: () => { setDragged(undefined); setDropTarget(undefined); },
      } : {})}
      aria-level={level} aria-selected={selectedPath === entry.path} aria-expanded={folder ? state.expanded.has(entry.path) : undefined}
      tabIndex={focusPath === entry.path ? 0 : -1}
      onFocus={event => { if (event.target === event.currentTarget) setFocused(entry.path); }}
      onKeyDown={event => { if (event.target === event.currentTarget) keyboard(event, entry); }}
      className="file-tree-item">
      <div className="flex items-center gap-1">
        {editing ? <span className="file-tree-rename">
          <Icon aria-hidden="true" />
          <Input data-file-rename data-revision-known={renaming?.known || undefined} aria-label={labels.renameOf(entry.path)} defaultValue={name} autoFocus enterKeyHint="done" spellCheck={false}
            aria-invalid={renaming?.error ? true : undefined}
            onFocus={event => { const dot = event.currentTarget.value.lastIndexOf('.'); event.currentTarget.setSelectionRange(0, dot > 0 ? dot : event.currentTarget.value.length); }}
            onKeyDown={event => {
              if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); commitRename(entry.path, event.currentTarget.value); }
              else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setRenaming(undefined); focus(entry.path); }
            }}
            // Focus moved somewhere on purpose cancels; a closing menu that drops focus (no related target) does not.
            onBlur={event => { if (event.relatedTarget) setRenaming(current => current?.path === entry.path ? undefined : current); }} />
        </span> : folder ? <CollapsibleTrigger render={button} /> : button}
        {(status?.kind === 'pending' || mutation?.state.kind === 'pending') && <LoaderCircle data-upload-spinner={status ? '' : undefined} data-mutation-spinner={mutation ? '' : undefined} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
        {status?.kind === 'failed' && <Button type="button" variant="ghost" data-upload-retry aria-label={status.retryLabel} onClick={status.retry}>{status.retryLabel}</Button>}
        {mutation && mutationFailed && <Button type="button" variant="ghost" size="icon" data-mutation-dismiss aria-label={labels.dismiss(entry.path)} title={labels.dismiss(entry.path)}
          onClick={() => controller.dismiss(mutation.operationId)}><X aria-hidden="true" /></Button>}
        {!folder && !temporary && !status && !editing && mutation?.state.kind !== 'pending' && <FileActions Actions={Actions} controller={controller} entry={entry} labels={labels}
          onOpen={onOpen ? () => onOpen(entry.path) : undefined} onHistory={history ? () => setHistoryPath(entry.path) : undefined} onError={setUploadError}
          onRename={changeable && can.rename && renameable(entry) ? () => startRename(entry.path) : undefined}
          onMove={changeable && can.rename && Dialog ? () => ask('move', entry.path) : undefined}
          onDelete={changeable && can.delete ? () => ask('delete', entry.path) : undefined} />}
      </div>
      {status?.kind === 'failed' && <span data-upload-error>{status.reason}</span>}
      {editing && renaming?.error && <span data-mutation-error role="alert">{renaming.error}</span>}
      {mutation && mutationFailed && <span data-mutation-error>{mutationReason(mutation)}</span>}
      {folder && !state.query && <CollapsibleContent render={<SidebarMenuSub role="group" />}>{renderEntries(entry.path, level + 1)}</CollapsibleContent>}
    </SidebarMenuItem>;
    return folder ? <CollapsibleRoot key={entry.path} render={item} open={state.expanded.has(entry.path)}
      onOpenChange={() => { void controller.toggle(entry.path); }} /> : item;
  };

  const visibleListing = state.query ? state.search : state.directories.get('');
  const paginated = visibleListing?.kind === 'ready' && visibleListing.cursor !== undefined;
  const rootDrop = dropHandlers('');
  const dialogPath = asking?.path ?? '';
  const folders = asking?.kind === 'move' ? [...new Set(['', ...[...state.directories.values(), state.search].flatMap(listing => listing.entries.filter(entry => entry.kind === 'directory').map(entry => entry.path))])].sort() : [];
  return <section data-boring="file-tree" data-variant={variant} data-dropping={dropping || undefined} data-drop-target={dropTarget === '' ? 'true' : undefined} className={className} aria-label={labels.region}
    onDragEnter={event => { rootDrop.onDragEnter?.(event); if (upload && event.dataTransfer.types.includes('Files')) { event.preventDefault(); dragDepth.current++; setDropping(true); } }}
    onDragOver={event => { rootDrop.onDragOver?.(event); if (upload && event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } }}
    onDragLeave={event => { rootDrop.onDragLeave?.(event); if (upload && event.dataTransfer.types.includes('Files')) { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDropping(false); } }}
    onDrop={event => { rootDrop.onDrop?.(event); if (upload && event.dataTransfer.types.includes('Files')) { event.preventDefault(); dragDepth.current = 0; setDropping(false); void uploadFiles(Array.from(event.dataTransfer.files)); } }}>
    {list && <header className="file-tree-header"><h2>{title ?? labels.library}</h2>
      <span className="file-tree-count" aria-label={labels.shownItems(rows.length)}>{rows.length}{paginated ? '+' : ''}</span>
      {upload && uploadButton}
      {onClose && <Button type="button" variant="ghost" size="icon" data-file-close aria-label={labels.close} onClick={onClose}><X aria-hidden="true" /></Button>}
    </header>}
    <div className="file-tree-toolbar">
      <div className="file-tree-search">{list && <Search aria-hidden="true" />}
        <Input type="search" aria-label={labels.search} placeholder={labels.searchPlaceholder} value={state.query}
          onChange={event => { void controller.search(event.currentTarget.value); }} />
      </div>
      {refresh && <Button type="button" variant="ghost" aria-label={labels.refresh} onClick={() => { void (state.query ? controller.search(state.query) : controller.refresh()); }}>{labels.refresh}</Button>}
      {!list && upload && uploadButton}
    </div>
    {upload && <Input ref={fileInput} aria-label={labels.uploadFiles} type="file" multiple onChange={event => {
      const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ''; void uploadFiles(files);
    }} />}
    {dropping && <div className="file-tree-drop" role="status"><Empty icon={<Upload aria-hidden="true" />} title={labels.dropFiles} /></div>}
    {uploadError && <p role="alert">{uploadError}</p>}
    {blobUploads.size > 0 && <ul aria-label={labels.uploads} className="file-tree-blob-uploads">{[...blobUploads].map(([key, item]) => {
      const percent = item.progress && item.progress.total > 0 ? Math.min(100, Math.round(item.progress.loaded / item.progress.total * 100)) : null;
      return <li key={key} data-blob-upload={item.name} data-progress={percent ?? undefined} className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate">{item.name}</span>
        {Progress ? <span className="w-24 shrink-0"><Progress value={percent} aria-label={labels.uploadProgress(item.name)} /></span> : <span role="status">{percent === null ? labels.uploading : `${percent}%`}</span>}
        <Button type="button" variant="ghost" size="icon" data-blob-upload-cancel aria-label={labels.cancelUpload(item.name)} title={labels.cancelUpload(item.name)} onClick={() => item.abort.abort()}><X aria-hidden="true" /></Button>
      </li>;
    })}</ul>}
    <SidebarMenu ref={tree} role="tree" aria-label={labels.tree} className="file-tree-menu">
      {state.query ? <>{state.search.entries.map(entry => renderEntry(entry, 1))}{listingStatus(state.search, '', true)}</> : renderEntries('', 1)}
      {temporaryEntries.map(entry => renderEntry(entry, 1))}
    </SidebarMenu>
    <ul aria-label={labels.uploads} aria-live="polite" aria-relevant="additions text" className="file-tree-announcements">{state.uploads.map(upload => <li key={upload.operationId} data-operation={upload.operationId}>
      {upload.path}: {upload.state.kind === 'pending' ? labels.uploading : upload.state.result.kind === 'committed' ? labels.saved : upload.state.result.kind === 'partial' ? labels.unconfirmed : upload.state.result.reason}
    </li>)}{[...localFailures].map(([path, failure]) => <li key={path}>{path}: {failure.reason}</li>)}
    {state.mutations.map(item => <li key={item.operationId} data-operation={item.operationId}>{item.path}: {mutationReason(item)}</li>)}</ul>
    {Dialog && <Dialog open={asking !== undefined} onOpenChange={open => { if (!open) closeAsking(); }}
      title={asking?.kind === 'move' ? labels.moveTitle(baseName(dialogPath)) : labels.deleteTitle(baseName(dialogPath))}
      description={asking?.kind === 'move' ? labels.moveDescription : labels.deleteDescription}
      footer={asking?.kind === 'delete' ? <>
        <Button type="button" variant="outline" data-confirm="cancel" onClick={closeAsking}>{labels.cancel}</Button>
        <Button type="button" variant="destructive" data-confirm="delete" onClick={() => {
          const path = dialogPath; setAsking(undefined);
          void controller.remove(path).then(report).catch(refused(path));
        }}><Trash2 aria-hidden="true" />{labels.delete}</Button>
      </> : <Button type="button" variant="outline" data-confirm="cancel" onClick={closeAsking}>{labels.cancel}</Button>}>
      {asking?.kind === 'move' && <ul className="file-tree-destinations" aria-label={labels.moveTitle(baseName(dialogPath))}>{folders.map(folder => <li key={folder}>
        <Button type="button" variant="ghost" data-destination={folder} disabled={folder === parentPath(dialogPath)} onClick={() => moveTo(dialogPath, folder)}>
          {folder ? <Folder aria-hidden="true" /> : <FolderOpen aria-hidden="true" />}<span className="file-tree-name">{folder || labels.root}</span>
        </Button>
      </li>)}</ul>}
    </Dialog>}
    {history && historyPath !== undefined && <FileHistory components={components} locale={locale} key={historyPath} controller={controller} path={historyPath} labels={labels} reload={historyKey} onClose={() => setHistoryPath(undefined)} />}
  </section>;
}

/** The message of a host refusal `{ error: { code, message } }` (or an Error's), if any. */
function refusalOf(error: unknown): string | undefined {
  const message = typeof error === 'object' && error !== null && 'error' in error && typeof error.error === 'object' && error.error !== null && 'message' in error.error ? error.error.message : error instanceof Error ? error.message : undefined;
  return typeof message === 'string' && message ? message : undefined;
}

function FileActions({ Actions, controller, entry, labels, onOpen, onHistory, onError, onRename, onMove, onDelete }: {
  readonly Actions: FileTreeComponents['Actions'];
  readonly controller: FileTreeController;
  readonly entry: FileEntry;
  readonly labels: FileTreeLabels;
  readonly onOpen: (() => void) | undefined;
  readonly onHistory: (() => void) | undefined;
  readonly onError: (reason: string) => void;
  readonly onRename: (() => void) | undefined;
  readonly onMove: (() => void) | undefined;
  readonly onDelete: (() => void) | undefined;
}) {
  const lifetime = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => lifetime.current?.abort(), []);
  const blob = entry.blob && 'url' in entry.blob ? entry.blob : undefined;
  const download = async () => {
    onError('');
    if (blob) {
      // The host serves a blob's bytes at its URL, with its own disposition; nothing is read into the page.
      const link = document.createElement('a'); link.href = blob.url; link.download = blob.name;
      document.body.append(link); link.click(); link.remove();
      return;
    }
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
  const items: FileTreeAction[] = [];
  if (onOpen) items.push({ id: 'open', label: labels.open, icon: <FolderOpen aria-hidden="true" />, onSelect: onOpen });
  if (onHistory) items.push({ id: 'history', label: labels.history, icon: <History aria-hidden="true" />, onSelect: onHistory });
  items.push({ id: 'download', label: labels.download, icon: <Download aria-hidden="true" />, onSelect: () => { void download(); } });
  if (onRename) items.push({ id: 'rename', label: labels.rename, icon: <Pencil aria-hidden="true" />, onSelect: onRename, ownsFocus: true });
  if (onMove) items.push({ id: 'move', label: labels.move, icon: <FolderInput aria-hidden="true" />, onSelect: onMove, ownsFocus: true });
  if (onDelete) items.push({ id: 'delete', label: labels.delete, icon: <Trash2 aria-hidden="true" />, onSelect: onDelete, destructive: true, ownsFocus: true });
  return <Actions label={labels.actionsOf(entry.path)} icon={<MoreHorizontal aria-hidden="true" />} items={items} />;
}

function FileHistory({ components: { Button, Versions, Separator }, locale, controller, path, labels, reload, onClose }: { readonly components: FileTreeComponents; readonly locale: FileTreeLocale; readonly controller: FileTreeController; readonly path: string; readonly labels: FileTreeLabels; readonly reload?: unknown; readonly onClose: () => void }) {
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
  return <><Separator /><section aria-label={labels.historyOf(path)} className="file-tree-history">
    <div className="flex items-center justify-between gap-2"><h3 className="font-medium">{labels.historyOf(path)}</h3><Button type="button" variant="ghost" onClick={onClose}>{labels.closeHistory}</Button></div>
    {failure && <p role="alert">{failure}</p>}
    {!versions && !failure && <p role="status">{labels.loadingHistory}</p>}
    {versions?.length === 0 && <p>{labels.noHistory}</p>}
    {versions && <Versions versions={versions} current={selected ?? versions[0]?.revision ?? ''} onSelect={setSelected} locale={locale} earlierVersion={labels.earlierVersion} />}
    {preview && <div data-testid="file-history-preview" data-revision={preview.ref.revision}><p>{labels.readOnlyRevision(preview.bytes.byteLength)}</p>{text === undefined ? <p>{labels.binaryFile(preview.mediaType)}</p> : <pre className="max-h-80 overflow-auto whitespace-pre-wrap">{text}</pre>}</div>}
  </section></>;
}
