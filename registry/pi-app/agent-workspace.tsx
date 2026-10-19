'use client';

import '@hachej/boring-ui-kit/file-tree.css';

import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import type { ResourceLocator } from '@hachej/boring-files';
import { createResourceClient } from '@hachej/boring-files/remote';
import { connectRevisionProvider } from '@hachej/boring-files/revision';
import { mediaTypeOf, workspacePath } from '@hachej/boring-files/file-types';
import { checkBlobBase, parseBlobPointer, withBlobPointers } from '@hachej/boring-files/blob';
import type { BlobPointer } from '@hachej/boring-files/blob';
import type { FileEntry, RevisionProvider } from '@hachej/boring-files/revision';
import { createFileTreeController } from '@hachej/boring-ui-kit/file-tree';
import { randomUUID } from '@hachej/boring-files/platform';
import type { FileTreeController } from '@hachej/boring-ui-kit/file-tree';
import { FileTreeView } from '../file-tree/file-tree';
import { frenchAppLabels } from './app-labels-fr';
import { chatTextFor } from '../pi-chat/locale';
import type { ChatLocale } from '../pi-chat/locale';
import type { FileTreeViewProps } from '../file-tree/file-tree';
import type { ResourceIdentity } from '@hachej/boring-files/remote';
import type { NativeChatController } from '@hachej/boring-ui-kit/native-chat';
import { PiChat, artifactKey } from '../pi-chat/pi-chat';
import { createPresentAcks, pendingPresents } from '../pi-chat/artifact';
import type { PresentAcks } from '../pi-chat/artifact';
import type { ArtifactDescriptor, ArtifactsConfig, ConversationsConfig, PiChatProps } from '../pi-chat/pi-chat';
import { Dock, DockLayout, DockMain } from '../pi-workspace/dock';
import { ArtifactWorkspace } from '../pi-workspace/workspace';
import type { WorkspacePanelApi } from '../pi-workspace/workspace';
import { ViewerWindowProvider } from '../viewers/viewer-frame';
import type { ViewerShare } from '../viewers/viewer-frame';
import type { InteractiveHtml } from '../viewers/interactive-html';
import { createMaquetteKind } from '../maquette-viewer/maquette-viewer';
import { createMockupKind } from '../mockup-viewer/mockup-viewer';
import type { MockupComments } from '../mockup-viewer/mockup-viewer';
import type { MaquetteComments } from '../maquette-viewer/maquette-viewer';
import { createDiagramKind } from '../diagram-viewer/diagram-viewer';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { BlockActions } from '../button/actions';
import type { BlockAction } from '../button/actions';
import { ChatTextProvider, useMergedText } from '../pi-chat/labels';
import { cn, withDefaults } from '../utils/utils';
import { AppTextProvider, defaultAppIcons, defaultAppLabels } from './app-labels';
import type { AppIcons, AppLabels } from './app-labels';
import { ArtifactPanel, useArtifactVersions, useTurn } from './artifact-panel';
import type { CustomViewers, SavedRevision, ViewerOptions } from './artifact-panel';
import { FileViewer } from './file-viewer';
import { useRevisionAttachments } from './use-revision-attachments';
import { imageData } from './revision-files';
import { SessionsPane, SessionsToggle } from './sessions';
import { focusHistoryRow, historyColumnFits, useHistoryOpen } from './history-column';
import type { HistoryPlacement } from './history-column';
import type { SessionsView, WorkspaceAgents } from './sessions';
import { WorkspaceBar } from './workspace-bar';

export { ArtifactPanel, useArtifactVersions, useTurn } from './artifact-panel';
export type { CustomViewerProps, CustomViewers, SavedRevision, ViewerOptions } from './artifact-panel';
export { FileViewer } from './file-viewer';
export { SessionsPane, SessionsToggle } from './sessions';
export { HistoryColumn, HistoryColumnToggle, historyColumnFits, useHistoryColumn } from './history-column';
export type { HistoryPlacement } from './history-column';
export { WorkspaceBar } from './workspace-bar';
export type { WorkspaceBarProps } from './workspace-bar';
export { ConversationList, ConversationHistory } from '../pi-chat/history';
export { FileTree } from '../file-tree/file-tree';
export type { SessionsView, WorkspaceAgent, WorkspaceAgents } from './sessions';
export { useConversations } from '../pi-chat/use-conversations';
export { useRemoteChat } from '../pi-chat/use-remote-chat';
export type { RemoteChatState } from '../pi-chat/use-remote-chat';
export { savedLabel, useSaved } from './use-saved';
export { viewerKindOf as kindOf, mediaTypeOf } from '@hachej/boring-files/file-types';
export { defaultAppIcons, defaultAppLabels } from './app-labels';
export { frenchAppLabels } from './app-labels-fr';
export type { AppIcons, AppLabels } from './app-labels';
export type { ViewerKind as FileKind } from '@hachej/boring-files/file-types';

/** An artifact version in the panel: `follow` shows the latest saved revision, otherwise `descriptor.revision` is pinned and read-only. */
export interface ArtifactView { readonly kind: 'artifact'; readonly conversation: string; readonly descriptor: ArtifactDescriptor; readonly follow: boolean }
/** A file in the panel, by the host's path (see `resources.locate`). */
export interface FileView { readonly kind: 'file'; readonly path: string }
/** Anything else the host renders in the panel through `panels[kind]` (for example a file list or a tool view). */
export interface HostView { readonly kind: string; readonly [field: string]: unknown }
/** What the right-hand panel shows, or `null` when it is closed. */
export type OpenedView = ArtifactView | FileView | HostView;

const isArtifact = (view: OpenedView | null): view is ArtifactView => view?.kind === 'artifact';
const isFile = (view: OpenedView | null): view is FileView => view?.kind === 'file';
/** Whether the panel shows the file at `path` (a file view, or the artifact view of it). */
const showsPath = (view: OpenedView | null, path: string): boolean => isFile(view) ? view.path === path : isArtifact(view) ? view.descriptor.target.resource.path === path : false;
const subscribeNothing = () => () => {};

/**
 * Large files (blob pointers): the workspace holds a small pointer file (`<name>.blob.json`, `@hachej/boring-files/blob`) for each
 * large file, and the host serves its bytes at `GET <blobBase><encodeURIComponent(id)>`. The Library lists a pointer under the file's
 * name, size and type, and the viewers show it from that URL (an image inline, a PDF in the PDF viewer, anything else as a download).
 */
export interface WorkspaceBlobs {
  /** Where the host serves blob bytes: a same-origin path starting with `/` (default `/_files/`). Anything else is refused (a `TypeError`). */
  readonly blobBase?: string | undefined;
  /**
   * The host's large-file upload, used by Library uploads above `uploads.maxBytes`: it stores the bytes and writes the pointer file
   * itself, then resolves with the pointer it wrote (checked with `parseBlobPointer`); the Library reloads its listing and writes
   * nothing. `onProgress` drives the row's progress bar, `signal` its cancel button; a refusal rejects with `{ error: { code, message } }`.
   * Without it a file above the cap is refused as today.
   */
  readonly uploadBlob?: ((file: File, options: { readonly signal: AbortSignal; readonly onProgress: (progress: { readonly loaded: number; readonly total: number }) => void }) => Promise<BlobPointer>) | undefined;
}

/**
 * Where the viewers read and write: the host's resource handler (`createResourceHandler` of `@hachej/boring-files/remote`) and its file history.
 * When the endpoint also answers the revision protocol's discovery (`createRevisionHandler` serves both), the page shows a read-only
 * Library of its files (open, and version history with `history`); a plain resource handler has no listing, so there is no Library.
 */
export interface WorkspaceResources extends WorkspaceBlobs {
  /** The resource handler endpoint. */
  readonly endpoint: string | URL;
  /** The host's authenticated fetch, also used for `history`. */
  readonly fetch: (request: Request) => Promise<Response>;
  /** The person's identity as the resource handler authenticates it (comparison metadata, never a grant). */
  readonly identity: ResourceIdentity;
  /** Optional `GET <history>?path=<resource path>` returning `{ saves: [{ revision, savedAt }] }` newest first (`files.saves(path)`): the version menu. */
  readonly history?: string | URL | undefined;
  /** The resource of a file path in a `FileView`. Default: the published `workspace` provider at the path without a leading slash. */
  readonly locate?: ((path: string) => ResourceLocator) | undefined;
}

interface AgentWorkspaceBaseProps {
  /**
   * `default`: the sessions pane on the left, the chat in the center and the artifact panel on the right. `embedded`: for a page set
   * inside a host's screen (an app-shell screen, a hub page): no left column at any width, and one compact top bar with the
   * conversation title and History, Library and New as icon buttons (a popover on a wide workspace, a sheet on a phone) followed by
   * `controls`. Inside an app-shell screen the bar's buttons go into the shell's header, so the page has one row.
   */
  readonly layout?: 'default' | 'embedded' | undefined;
  /**
   * Where the Library of a `revisionProvider` opens. `panel` (default): the artifact column, or a bottom drawer on phones.
   * `side`: a column to the right of the viewer (a `Dock`, resizable), opened
   * from the Library button in the viewer's top bar or in the left pane, alone at the right edge when no file is open; on a phone a
   * full-screen sheet that choosing a file closes. `center`: Chat and Library links in the left pane, the Library replacing
   * the chat in the center (the chat stays mounted). `pane`: the Library is a tab beside the conversations in the left pane, or the
   * whole pane on a single-session page without `conversations`; files open in the right panel as usual.
   */
  readonly libraryPlacement?: 'panel' | 'side' | 'center' | 'pane' | undefined;
  /** The page's language: `en` (default) or `fr`, for the chat, the panes, the viewers and the Library. `labels` and `chat.labels` override any word. */
  readonly locale?: ChatLocale | undefined;
  /**
   * The Library tree's options: its words (`labels`, over `defaultFileTreeLabels`), whether it offers Upload and History, and a
   * `refreshKey` that reloads it when it changes. Deprecated: with a `revisionProvider` that has a change feed (`connectRevisionProvider`)
   * the tree, the Library, the history panel and the @ search reload from the workspace's own change events; `refreshKey` remains
   * for a provider without one.
   */
  readonly fileTree?: Pick<FileTreeViewProps, 'labels' | 'upload' | 'history' | 'refreshKey'> | undefined;
  /**
   * How the chat's attachments are saved under `uploads/` (they exist only with a Library, `revisionProvider` or `resources`). Every file
   * is reference-only by default: the message carries its `@path` and the agent reads it with its file tools. See `WorkspaceUploads`.
   */
  readonly uploads?: WorkspaceUploads | undefined;
  /**
   * The page's agents. With two or more, a switcher at the top of the left pane chooses one; the host scopes `conversations` and the
   * controller to `activeId`. One agent (or none given) shows no switcher.
   */
  readonly agents?: WorkspaceAgents | undefined;
  /** The open conversation's controller (`useRemoteChat`); `undefined` while connecting, when `connecting` is shown instead. */
  readonly controller: NativeChatController | undefined;
  /** The open conversation: auto-opened artifacts and the artifact view belong to it. */
  readonly conversationId: string | undefined;
  /** Everything else `PiChat` takes (labels, icons, headerActions, messageActions, mode, actions, slash, mentions, attachments, model, effort, emptyState, ...). */
  readonly chat?: Omit<PiChatProps, 'controller' | 'artifacts' | 'conversations' | 'historyList'>;
  /**
   * The block's words (sessions pane, artifact panel, file viewer and the viewers' bars), over `defaultAppLabels`; for example
   * `{ sessionsTitle: 'Projects', newChat: 'Start' }`. The chat's own go in `chat.labels`.
   */
  readonly labels?: Partial<AppLabels> | undefined;
  /** The block's icons (sessions toggle, New, Float chat, the viewer bar's), over `defaultAppIcons`. The chat's go in `chat.icons`. */
  readonly icons?: Partial<AppIcons> | undefined;
  /**
   * Host actions on the artifact panel's bar (every viewer it shows), after the built-in Float chat: `header` ones as buttons beside Share,
   * `menu` ones in its "…" menu. A function receives what is open. Test ids `<viewer testId>-<id>` (`artifact-<id>` for an artifact).
   */
  readonly panelActions?: readonly BlockAction[] | ((view: OpenedView) => readonly BlockAction[]) | undefined;
  readonly connecting?: ReactNode;
  /** The sessions pane (`useConversations`). Omit it for a page without one. Replies keep their Fork button through `conversations.fork`. */
  readonly conversations?: ConversationsConfig | undefined;
  /** Place the sessions pieces in host navigation. Default: SessionsPane. False leaves navigation entirely to the host; conversations still powers chat Fork. */
  readonly sessions?: false | ((props: ComponentProps<typeof SessionsPane>) => ReactNode) | undefined;
  /**
   * `column` (default): the conversations are the pane's side column, open or closed as this viewer left it; while an open panel leaves
   * the chat too narrow beside it, the column steps aside and the chat's History opens the popover. `popover`: History is always the popover.
   */
  readonly history?: HistoryPlacement | undefined;
  /** Recognise artifacts in tool results that carry no descriptor (`ArtifactsConfig.detect`). */
  readonly detect?: ArtifactsConfig['detect'] | undefined;
  /** The app's own artifact kinds (`ArtifactKind`: match, label, icon, renderer): the chat's cards and the artifact panel consult them before the built-in types and before the built-in maquette and diagram kinds (`*.maquette.json`, `maquette-viewer`; `*.diagram.json`, `diagram-viewer`), so an app kind for those files wins. */
  readonly artifactKinds?: ArtifactsConfig['kinds'] | undefined;
  /** Comment pins on mock-ups: the registry `feedback` item's `usePointComments(session)`. The maquette viewer then shows a comment icon that enters point mode on its screen. Omit it (no feedback session) and no icon shows. */
  readonly comments?: (MaquetteComments & Pick<MockupComments, 'pick' | 'picking' | 'reposition'>) | undefined;
  /** Host viewers by artifact type or file kind, for example `{ canvas: props => <MyCanvas {...props} /> }`. */
  readonly viewers?: CustomViewers | undefined;
  /** Run HTML pages in the viewers' sandboxed preview, loading scripts only from these origins. Off without it. */
  readonly interactive?: InteractiveHtml | undefined;
  /** The viewer bar's Share action; it receives `target` `{ artifact, version }` or `{ file }`. */
  readonly share?: ViewerShare | undefined;
  /** Controlled panel content (with `onOpenedChange`); uncontrolled from `defaultOpened` otherwise. */
  readonly opened?: OpenedView | null | undefined;
  readonly defaultOpened?: OpenedView | null | undefined;
  readonly onOpenedChange?: ((next: OpenedView | null) => void) | undefined;
  /**
   * Whether the open file has unsaved or unconfirmed changes. The workspace asks before leaving such a file itself; a host that
   * switches the workspace or identity (a new `revisionProvider`) or changes a controlled `opened` should ask first too, since the
   * viewer of the previous file is replaced and its local draft discarded.
   */
  readonly onUnsavedChange?: ((unsaved: boolean) => void) | undefined;
  /** Renderers for host views, by `kind`. */
  readonly panels?: Readonly<Record<string, (view: HostView, panel: WorkspacePanelApi) => ReactNode>> | undefined;
  /** Open the panel on each artifact (or new version) the agent makes, unless the person closed it during this turn. Not on a phone. Default true. */
  readonly autoOpen?: boolean;
  /** A back button in a file's viewer bar (for example to the host's file list). */
  readonly fileBack?: { readonly label: string; readonly onBack: () => void } | undefined;
  /** With `floatBelow`: the floating chat over the same session (for example `AmbientChat` of `pi-ambient` with `onDock={dock}`). */
  readonly floatingChat?: ((props: PiChatProps, dock: () => void) => ReactNode) | undefined;
  /** Shown above the chat (notices). */
  readonly chatTop?: ReactNode;
  /** The chat header's controls; a function receives whether the panel is open. */
  readonly controls?: ReactNode | ((state: { readonly panelOpen: boolean }) => ReactNode);
  /** Prefix of the layout keys (panel width and floating chat for the session; whether the sessions column is open, per viewer). */
  readonly storageKey?: string;
  /** Below this width of the workspace the artifact panel is a full-screen sheet. */
  readonly sheetBelow?: number;
  /** Below this width of the workspace the sessions pane is a drawer. */
  readonly drawerBelow?: number;
  readonly floatBelow?: number | undefined;
  readonly className?: string;
}

/** The chat's attachment rules. `inlineImages` (default false) also sends a png, jpeg, gif or webp as a native image in the message: every later turn then carries its base64, so it is off by default. `maxBytes` refuses a larger file before it is uploaded (no limit by default), and the chat shows why. `accept` is the file picker's `accept` (any file by default). */
export interface WorkspaceUploads {
  readonly inlineImages?: boolean | undefined;
  readonly maxBytes?: number | undefined;
  readonly accept?: string | undefined;
}

/** A byte count for a refusal message: `2.5 MB`, `300 KB`, or `12 bytes`. */
const sizeLabel = (bytes: number) => bytes >= 1_000_000 ? `${Number((bytes / 1_000_000).toFixed(1))} MB` : bytes >= 1_000 ? `${Math.round(bytes / 1_000)} KB` : `${bytes} bytes`;

export type AgentWorkspaceProps = AgentWorkspaceBaseProps & (
  | { readonly revisionProvider: RevisionProvider; readonly resources?: WorkspaceBlobs | undefined }
  | { readonly resources: WorkspaceResources; readonly revisionProvider?: never }
);

// The Library column is docked only while the chat and the viewer (their `ArtifactWorkspace` minimums) keep their room beside it; otherwise it is Dock's sheet.
const SESSIONS_WIDTH = 260, LIBRARY_WIDTH = 320, CHAT_MIN = 360, VIEWER_MIN = 360;
const readFlag = (key: string): boolean => { try { return sessionStorage.getItem(key) === '1'; } catch { return false; } };
const writeFlag = (key: string, on: boolean) => { try { if (on) sessionStorage.setItem(key, '1'); else sessionStorage.removeItem(key); } catch { /* the layout is a convenience */ } };
const defaultLocate = (path: string): ResourceLocator => ({ resource: { providerId: 'workspace', path: workspacePath(path) }, view: { kind: 'published' } });

/**
 * A complete agent page in one component: the sessions pane on the left (search, New, rename, archive, delete; collapsible, a drawer on
 * a narrow screen), the chat in the center (`PiChat`) and the artifact viewers on the right (`ArtifactWorkspace` with the artifact panel and
 * its versions, the file viewer and the host's own views). Agent artifacts open the panel as they appear. Every prop is data or a callback:
 * the host owns the routes, authentication, the controller and what is open (when controlled).
 */
export function AgentWorkspace({ layout = 'default', controller, conversationId, chat = {}, labels, icons, panelActions, connecting, conversations, sessions, history: historyPlacement = 'column', resources, revisionProvider, libraryPlacement = 'panel', locale, fileTree: treeOptions, uploads, agents, detect, artifactKinds, comments, viewers, interactive, share, opened: controlled,
  defaultOpened = null, onOpenedChange, onUnsavedChange, panels, autoOpen = true, fileBack, floatingChat, chatTop, controls, storageKey = 'boring.agent-workspace', sheetBelow = 641, drawerBelow = 641, floatBelow, className }: AgentWorkspaceProps) {
  const [own, setOwn] = useState<OpenedView | null>(defaultOpened);
  const [panelLibrary, setPanelLibrary] = useState(false);
  const opened = controlled !== undefined ? controlled : own;
  const change = useRef(onOpenedChange); change.current = onOpenedChange;
  const isControlled = controlled !== undefined;
  const unsaved = useRef(false);
  const currentView = useRef(opened); currentView.current = opened;
  const unsavedChange = useRef(onUnsavedChange); unsavedChange.current = onUnsavedChange;
  const noteUnsaved = useCallback((value: boolean) => { if (unsaved.current !== value) { unsaved.current = value; unsavedChange.current?.(value); } }, []);
  const beforeLeave = useRef<(() => Promise<boolean>) | null>(null);
  const registerBeforeLeave = useCallback((flush: (() => Promise<boolean>) | null) => { beforeLeave.current = flush; }, []);
  const leaving = useRef(false);
  const guard = useCallback(async () => {
    if (leaving.current) return false;
    if (!unsaved.current) return true;
    const current = currentView.current;
    leaving.current = true;
    try {
      const saved = await beforeLeave.current?.();
      if (currentView.current !== current) return false;
      return saved === true || !unsaved.current || Boolean(globalThis.confirm?.('This file has unsaved or unconfirmed changes. Discard the local draft and leave this file?'));
    } finally { leaving.current = false; }
  }, []);
  const setOpened = useCallback(async (next: OpenedView | null): Promise<boolean> => {
    const current = currentView.current;
    if (isFile(current) && isFile(next) && current.path === next.path) { setPanelLibrary(false); return true; }
    if (!await guard()) return false;
    noteUnsaved(false);
    setPanelLibrary(false);
    if (!isControlled) setOwn(next); change.current?.(next);
    return true;
  }, [guard, isControlled, noteUnsaved]);
  const [fullscreen, setFullscreen] = useState(false);
  const [centerMode, setCenterMode] = useState<'chat' | 'library'>('chat');
  const [sideOpen, setSideOpenState] = useState(false);
  // The Library's real docked width, reported by its Dock: the room it needs beside the chat and the viewer.
  const [libraryWidth, setLibraryWidth] = useState(LIBRARY_WIDTH);
  // Opening the column leaves a full-screen viewer, whose overlay would otherwise cover it.
  const setSideOpen = useCallback((next: boolean) => { setSideOpenState(next); if (next) setFullscreen(false); }, []);
  const openLibrary = useCallback(async () => {
    if (libraryPlacement === 'panel') {
      if (!await guard()) return;
      noteUnsaved(false); setPanelLibrary(value => !value);
    } else setCenterMode('library');
    setFullscreen(false);
  }, [guard, libraryPlacement, noteUnsaved]);
  const text = useMemo(() => ({ labels: withDefaults(locale === 'fr' ? frenchAppLabels : defaultAppLabels, labels), icons: withDefaults(defaultAppIcons, icons) }), [labels, icons, locale]);
  // The sessions pane shows the chat's conversation list, so it reads the chat's labels too.
  const chatText = useMergedText(chat.labels, chat.icons, chatTextFor(locale));

  // With a revision provider, `resources` carries only the blob options; without one it is the resource handler too.
  const remote = revisionProvider ? undefined : resources as WorkspaceResources;
  const fetcher = useRef(remote?.fetch); fetcher.current = remote?.fetch;
  const endpoint = remote ? String(remote.endpoint) : undefined;
  const historyEndpoint = remote?.history === undefined ? undefined : String(remote.history);
  const identity = revisionProvider?.identity ?? remote!.identity;
  const blobBase = checkBlobBase(resources?.blobBase);
  const hostUploadBlob = resources?.uploadBlob;
  const appLabels = text.labels;
  // The host's pointer is checked with the same validator the host uses; an invalid one is a refusal the Library shows.
  const uploadBlob = useMemo(() => hostUploadBlob && (async (file: File, options: Parameters<NonNullable<WorkspaceBlobs['uploadBlob']>>[1]) => {
    const pointer = parseBlobPointer(JSON.stringify(await hostUploadBlob(file, options) ?? null));
    if (pointer === undefined || 'kind' in pointer) throw { error: { code: 'invalid_pointer', message: appLabels.invalidBlobPointer(file.name) } };
    return pointer;
  }), [hostUploadBlob, appLabels]);
  const identityKey = JSON.stringify(identity);
  const history = useMemo(() => revisionProvider ? revisionProvider.history : historyEndpoint === undefined ? undefined : async (path: string): Promise<readonly SavedRevision[]> => {
    const url = new URL(historyEndpoint, globalThis.location?.href);
    url.searchParams.set('path', path);
    const response = await fetcher.current!(new Request(url));
    if (!response.ok) throw new Error(`History: ${response.status}`);
    return (await response.json() as { saves: readonly SavedRevision[] }).saves;
  }, [revisionProvider, historyEndpoint]);
  // Resources only: a read-only Library over the endpoint's own listing, when it answers the revision protocol's discovery for the same
  // person (`createRevisionHandler` serves the resource calls and the listing on one route). A plain resource handler refuses: no Library.
  const [listing, setListing] = useState<{ readonly key: string; readonly provider: RevisionProvider }>();
  const listingKey = revisionProvider || endpoint === undefined ? undefined : JSON.stringify([endpoint, identity]);
  useEffect(() => {
    if (listingKey === undefined) return;
    const abort = new AbortController();
    connectRevisionProvider({ endpoint: new URL(endpoint!, globalThis.location?.href), fetch: request => fetcher.current!(request), signal: abort.signal }).then(provider => {
      const { principalId, scopeId, initiatorId } = provider.identity;
      if (!abort.signal.aborted && principalId === identity.principalId && scopeId === identity.scopeId && initiatorId === identity.initiatorId) setListing({ key: listingKey, provider });
    }, () => { /* no listing on this endpoint */ });
    return () => abort.abort();
  }, [listingKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // The Library's binding: the host's revision provider, or the listing above with the versions of `resources.history`.
  const libraryProvider = useMemo(() => revisionProvider ?? (listing && listing.key === listingKey ? { ...listing.provider, history: history ?? listing.provider.history } : undefined),
    [revisionProvider, listing, listingKey, history]);
  // The viewers' client: the Library's binding when there is one (its calls carry the binding the revision protocol checks), else the plain resource client.
  const client = useMemo(() => libraryProvider ?? createResourceClient({ identity, endpoint: new URL(endpoint!, globalThis.location?.href), publication: true, reconciliation: true,
    fetch: request => fetcher.current!(request) }), [libraryProvider, endpoint, identityKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // ---- Presented files: the page confirms a `present` call only once its panel has mounted the revision (`onShown`, from the viewers).
  // The bookkeeping is `createPresentAcks` (pi-chat/artifact.ts); the answer goes through the chat's own `answer` (the transport's
  // `?op=answer`) and the server checks the path and revision.
  const answerPresent = useRef(chat.actions?.answer); answerPresent.current = chat.actions?.answer;
  const openForPresent = useRef<(path: string) => boolean>(() => false);
  const presentAcks = useRef<PresentAcks | undefined>(undefined);
  if (!presentAcks.current) presentAcks.current = createPresentAcks({ answer: (id, body) => answerPresent.current?.(id, body),
    open: path => openForPresent.current(path), instanceId: randomUUID() });
  const onShown = useCallback((view: { readonly path: string; readonly revision: string; readonly hidden?: true }) => {
    if (view.hidden) presentAcks.current?.hidden(view); else presentAcks.current?.shown(view);
  }, []);
  // The app's kinds first, then the built-in maquette and diagram kinds in the workspace's language (a `.maquette.json` card and panel say « Maquette » in French).
  const kinds = useMemo(() => [...(artifactKinds ?? []), createMaquetteKind({ locale, comments }), createDiagramKind({ locale }), createMockupKind({ locale, comments })], [artifactKinds, locale, comments]);
  const options: ViewerOptions = useMemo(() => ({ client, identity, history, viewers, kinds, interactive, share, onShown, onUnsavedChange: noteUnsaved, onBeforeLeaveChange: registerBeforeLeave, blobBase }), [client, identityKey, history, viewers, kinds, interactive, share, onShown, noteUnsaved, registerBeforeLeave, blobBase]); // eslint-disable-line react-hooks/exhaustive-deps
  const locate = revisionProvider?.locate ?? remote?.locate ?? defaultLocate;
  const readOnlyLibrary = !revisionProvider;
  const [fileBinding, setFileBinding] = useState<{ readonly provider: RevisionProvider; readonly tree: FileTreeController }>();
  useEffect(() => {
    if (!libraryProvider) return;
    // The Library reads its listings through `withBlobPointers`: each pointer file is resolved there, once, to the file it stands for.
    const tree = createFileTreeController({ revisionProvider: withBlobPointers(libraryProvider, blobBase) });
    setFileBinding({ provider: libraryProvider, tree });
    void tree.refresh();
    return () => tree.dispose();
  }, [libraryProvider, blobBase]);
  const libraryController = fileBinding?.provider === libraryProvider ? fileBinding?.tree : undefined;
  // Uploads and the upload notice belong to a revision provider only; the resources Library is read-only.
  const fileTree = revisionProvider ? libraryController : undefined;
  const embedded = layout === 'embedded';
  // Where the Library opens (`libraryPlacement`); embedded, it is the bar's Library button instead.
  const placed = Boolean(libraryProvider) && !embedded;
  const libraryInPane = placed && libraryPlacement === 'pane';
  const librarySide = placed && libraryPlacement === 'side';
  const libraryOpen = placed && libraryPlacement === 'center' && centerMode === 'library';
  // The workspace's change feed: every file view below reloads when its seq moves (agent writes, saves, shell changes).
  const feed = useChangeFeed(libraryProvider);
  // The shared tree controller reloads, shown or not: the Library may be on its other tab when a file arrives, and mounting the tree
  // later must not show the listing from before. `fileTree.refreshKey` (deprecated) does the same for a provider without a feed.
  const { refreshKey, ...viewOptions } = treeOptions ?? {};
  const refreshedKey = useRef(refreshKey);
  const refreshedSeq = useRef(feed.seq);
  useEffect(() => {
    if (!libraryController || (Object.is(refreshedKey.current, refreshKey) && refreshedSeq.current === feed.seq)) return;
    refreshedKey.current = refreshKey;
    refreshedSeq.current = feed.seq;
    const { query, expanded } = libraryController.getSnapshot();
    if (query) void libraryController.search(query);
    else for (const directory of ['', ...expanded]) void libraryController.refresh(directory);
  }, [libraryController, refreshKey, feed.seq]);
  const openFile = useCallback((path: string) => { setOpened({ kind: 'file', path }); }, [setOpened]);
  // @ search: results are reused while the feed reports nothing new (typing back and forth), and dropped at the next change event.
  // One cache per provider instance (one workspace binding), so another binding never sees these results.
  const mentionResults = useMemo(() => ({ seq: undefined as number | undefined, results: new Map<string, readonly FileEntry[]>() }), [revisionProvider]);
  const feedState = useRef(feed); feedState.current = feed;
  const mentions = useMemo(() => revisionProvider ? {
    search: async (query: string, signal: AbortSignal) => {
      const { live, seq } = feedState.current;
      const cache = mentionResults;
      if (cache.seq !== seq || !live) { cache.seq = seq; cache.results = new Map(); }
      const known = live ? cache.results.get(query) : undefined;
      if (known) return known;
      const results = cache.results;
      const entries = (await revisionProvider.search({ query, limit: 8 }, signal)).entries;
      // Kept only when no change arrived meanwhile.
      if (live && cache.results === results && cache.seq === feedState.current.seq) results.set(query, entries);
      return entries;
    },
    open: openFile,
    // A card's thumbnail: the chat's image upload read through this provider, the same read the file viewer makes.
    preview: async (path: string, signal: AbortSignal) => {
      const read = await revisionProvider.read({ target: revisionProvider.locate(path), revision: { kind: 'latest' } }, signal);
      return read.kind === 'available' ? { mimeType: mediaTypeOf(path), data: imageData(read.snapshot.bytes) } : undefined;
    },
  } : undefined, [revisionProvider, openFile, mentionResults]);
  // The search function changes only with the binding; the feed's seq rides along as the picker's generation.
  const mentionsForChat = useMemo(() => mentions && { ...mentions, generation: feed.seq }, [mentions, feed.seq]);
  const [attachmentFailure, setAttachmentFailure] = useState<{ readonly tree: FileTreeController; readonly reasons: readonly string[] }>();
  // Primitives only in the memo: a host's inline `labels` object would otherwise rebuild the chat's attachments on every render.
  const uploadAccept = uploads?.accept, inlineImages = uploads?.inlineImages === true, maxBytes = uploads?.maxBytes;
  const tooLarge = maxBytes !== undefined ? text.labels.attachmentTooLarge(sizeLabel(maxBytes)) : undefined;
  const revisionAttachments = useRevisionAttachments({ fileTree, accept: uploadAccept, inlineImages, maxBytes, tooLarge, onPreparationFailure: (name, reason) => {
    if (fileTree && fileTree.getSnapshot().lifecycle === 'active') setAttachmentFailure(current => ({ tree: fileTree,
      reasons: [...(current?.tree === fileTree ? current.reasons : []), `${name}: ${reason}`] }));
  } });
  const attachments = useMemo(() => revisionAttachments && { ...revisionAttachments, upload: (files: File[], signal: AbortSignal) => {
    setAttachmentFailure(undefined);
    return revisionAttachments.upload(files, signal);
  } }, [revisionAttachments]);

  // ---- Artifacts: cards open the panel; the agent's new ones open it too.
  const versions = useArtifactVersions(controller, detect);
  const turn = useTurn(controller);
  const active = isArtifact(opened) && opened.conversation === conversationId ? opened : null;
  const file = isFile(opened) ? opened : null;
  const host = opened && !isArtifact(opened) && !isFile(opened) && panels?.[opened.kind] ? opened : null;
  const panelOpen = Boolean(active || file || host || panelLibrary);
  const seen = useRef(new Map<string, Set<string>>());
  const closedInTurn = useRef(new Map<string, number>());
  // Kept editing after the unsaved-changes question: the panel stays as it was, and the next artifact may still open it.
  const close = async () => { if (panelLibrary) { setPanelLibrary(false); return true; } if (!await setOpened(null)) return false; if (conversationId !== undefined) closedInTurn.current.set(conversationId, turn); setFullscreen(false); return true; };
  useEffect(() => {
    if (!controller || conversationId === undefined) return;
    const keys = versions.map(version => `${artifactKey(version)}:${version.revision}`);
    const known = seen.current.get(conversationId);
    // What the conversation already held when it loaded does not count.
    if (!known) { seen.current.set(conversationId, new Set(keys)); return; }
    const fresh = versions.filter(version => !known.has(`${artifactKey(version)}:${version.revision}`));
    for (const key of keys) known.add(key);
    if (unsaved.current || !autoOpen || !fresh.length || closedInTurn.current.get(conversationId) === turn || globalThis.matchMedia?.(`(max-width: ${sheetBelow - 1}px)`).matches) return;
    setOpened({ kind: 'artifact', conversation: conversationId, descriptor: fresh.at(-1)!, follow: true });
  }, [versions, controller, conversationId, turn]); // eslint-disable-line react-hooks/exhaustive-deps
  // A `present` call waiting for the page: decided by `createPresentAcks` (refused when the person closed the panel this turn, has unsaved
  // edits or is on a phone; otherwise its file is opened unless `autoOpen` is off, and the acknowledgement follows the mount).
  openForPresent.current = path => { if (unsaved.current) return false; void setOpened({ kind: 'file', path }); return true; };
  const liveView = useSyncExternalStore(controller ? controller.subscribe : subscribeNothing, () => controller?.getSnapshot().view, () => undefined);
  const presentCalls = useMemo(() => pendingPresents(liveView), [liveView]);
  useEffect(() => {
    if (!answerPresent.current || conversationId === undefined) return;
    presentAcks.current?.consider(presentCalls, { closedThisTurn: closedInTurn.current.get(conversationId) === turn, unsaved: unsaved.current,
      narrow: globalThis.matchMedia?.(`(max-width: ${sheetBelow - 1}px)`).matches === true, autoOpen, showing: path => showsPath(currentView.current, path) });
  }, [presentCalls, conversationId, turn, autoOpen, sheetBelow]);
  /** The versions of one file that the conversation presented or saved, newest first. */
  const newestOf = (key: string) => versions.filter(version => artifactKey(version) === key).reverse();
  const artifacts: ArtifactsConfig = useMemo(() => ({
    open: descriptor => { if (conversationId !== undefined) setOpened({ kind: 'artifact', conversation: conversationId, descriptor, follow: descriptor.revision === newestOf(artifactKey(descriptor))[0]?.revision }); },
    isOpen: descriptor => Boolean(active && artifactKey(active.descriptor) === artifactKey(descriptor) && (active.follow ? descriptor.revision === newestOf(artifactKey(descriptor))[0]?.revision : descriptor.revision === active.descriptor.revision)),
    ...(detect ? { detect } : {}),
    kinds,
  }), [conversationId, active, versions, detect, kinds, setOpened]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Sessions: docked on a wide workspace (collapsible, remembered for the session), a drawer on a narrow one.
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = () => setWidth(element.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const narrow = width > 0 && width < drawerBelow;
  const [paneOpen, setPaneOpen] = useHistoryOpen(`${storageKey}.history-column`, true);
  const paneId = `${storageKey}-sessions`;
  const [drawer, setDrawer] = useState(false);
  const [paneView, setPaneView] = useState<SessionsView>(() => readFlag(`${storageKey}.library`) ? 'library' : 'conversations');
  const changePaneView = useCallback((next: SessionsView) => { writeFlag(`${storageKey}.library`, next === 'library'); setPaneView(next); }, [storageKey]);
  // The upload notice's "Open Library": the center Library, or the pane's Library tab with the pane shown.
  const revealLibrary = () => {
    if (librarySide) { setSideOpen(true); return; }
    if (!libraryInPane) { openLibrary(); return; }
    changePaneView('library');
    if (narrow) setDrawer(true); else setPaneOpen(true);
  };
  useEffect(() => { if (!narrow) setDrawer(false); }, [narrow]);
  const toggleSide = useCallback(() => setSideOpen(!sideOpen), [setSideOpen, sideOpen]);
  // The Library tree, one view for the side column, the center and the pane; `onOpen` is what choosing a file does there.
  const libraryTree = (onOpen: (path: string) => void, onClose?: () => void) => libraryController
    ? <FileTreeView variant="list" refresh={libraryPlacement !== 'panel'} title={text.labels.library} {...(onClose ? { onClose } : {})} key={JSON.stringify([libraryProvider?.workspace, libraryProvider?.identity])} {...(locale ? { locale } : {})} {...viewOptions}
      {...(readOnlyLibrary ? { upload: false, history: history !== undefined } : {})} {...(maxBytes !== undefined ? { maxBytes, ...(tooLarge ? { tooLarge } : {}) } : {})} {...(uploadBlob ? { uploadBlob } : {})} controller={libraryController} historyKey={feed.seq} onOpen={onOpen} {...(isFile(opened) ? { selectedPath: opened.path } : {})} />
    : <p role="status" className="m-0 p-3 text-sm text-muted-foreground">{treeOptions?.labels?.loading ?? text.labels.loading}</p>;
  // `history="popover"` keeps the conversations out of the pane. With an open panel the column steps aside unless column, panel and chat fit.
  const paneConversations = historyPlacement === 'column' ? conversations : undefined;
  const hasNavigation = !embedded && sessions !== false && Boolean(paneConversations || placed);
  const stepAside = Boolean(paneConversations) && hasNavigation && !narrow && panelOpen && !historyColumnFits(width, VIEWER_MIN);
  const docked = hasNavigation && width > 0 && !narrow && paneOpen && !stepAside;
  const popoverHistory = historyPlacement === 'popover' || stepAside;
  const toggle = hasNavigation && !docked && !drawer && !stepAside && <SessionsToggle navigation={placed} open={narrow ? drawer : paneOpen} drawer={narrow} controls={narrow ? undefined : paneId}
    onToggle={() => { if (narrow) setDrawer(value => !value); else { setPaneOpen(!paneOpen); if (!paneOpen) focusHistoryRow(paneId); } }} />;

  // ---- The docked chat's header is replaced on every switch and connect (the `connecting` row, then a new `PiChat`). The toggle is not
  // part of it: it stays mounted in the shell, over an invisible space of its size in whichever header is showing, and follows that
  // header's height. A press that starts before the swap ends on the same button and still clicks (a button that leaves the document
  // between press and release loses the click, even when moved rather than recreated).
  const toggleRow = useRef<HTMLDivElement>(null);
  const followHeader = useRef<ResizeObserver | undefined>(undefined);
  const headerSlot = useCallback((space: HTMLElement | null) => {
    followHeader.current?.disconnect(); followHeader.current = undefined;
    const header = space?.parentElement;
    if (!header || typeof ResizeObserver === 'undefined') return;
    followHeader.current = new ResizeObserver(() => { if (toggleRow.current) toggleRow.current.style.height = `${header.clientHeight}px`; });
    followHeader.current.observe(header);
  }, []);
  const toggleSpace = toggle && <Button ref={headerSlot} variant="ghost" size="icon-sm" aria-hidden="true" tabIndex={-1} className="invisible min-[641px]:-ml-1" />;

  // ---- The chat in the center: docked PiChat, or the host's floating surface over the same controller (with the toggle in its header).
  const hostControls = typeof controls === 'function' ? controls({ panelOpen }) : controls ?? chat.controls;
  const header = <>{conversations?.onNew && <Button variant="ghost" size="icon-sm" data-testid="workspace-new-chat" aria-label={text.labels.newChat} title={text.labels.newChat} className="min-[641px]:hidden" onClick={conversations.onNew}><text.icons.newChat data-icon="inline-start" aria-hidden="true" /></Button>}{hostControls}</>;
  const conversationTitle = conversations?.items.find(item => item.id === conversationId)?.title;
  const chatProps: PiChatProps | undefined = controller && { ...(mentionsForChat ? { mentions: mentionsForChat } : {}), ...(attachments ? { attachments } : {}), ...(locale ? { locale } : {}), ...chat, controller, artifacts, ...(conversations ? { conversations, historyList: popoverHistory, showHistory: chat.showHistory ?? popoverHistory, conversationTitle, onRenameTitle: conversations.rename && conversationId ? (title: string) => conversations.rename!(conversationId, title) : undefined } : {}),
    headerStart: <>{toggle}{chat.headerStart}</>, ...(header === undefined ? {} : { controls: header }),
    // Embedded: the bar above replaces the chat's header (History, New and the host's controls are in it); conversations stay for Fork.
    ...(embedded ? { header: false, historyList: false, showHistory: false } : {}) };
  const bar = embedded && <WorkspaceBar title={conversationTitle ?? chatText.labels.title} conversations={conversations} narrow={narrow}
    library={libraryController ? onPicked => libraryTree(path => { openFile(path); onPicked(); }, onPicked) : undefined}
    controls={<><BlockActions actions={chat.headerActions} testId="chat-action" menuLabel={chatText.labels.moreActions} />{hostControls}</>} />;
  const docked_chat = <div data-testid="workspace-center" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
    {bar}
    {attachmentFailure?.tree === fileTree && attachmentFailure?.reasons.map((reason, index) => <p key={index} role="alert" className="m-0 px-4 py-2 text-sm">{reason}</p>)}
    {fileTree && <UploadNotice controller={fileTree} onOpen={revealLibrary} />}
    {chatTop}
    <div className="relative flex min-h-0 flex-1 flex-col">
      {chatProps ? <PiChat key={conversationId} {...chatProps} headerStart={<>{toggleSpace}{chat.headerStart}</>} className={cn('min-h-0 flex-1', chat.className)} />
        // Same geometry as the PiChat header, so nothing moves when the chat arrives.
        : <>{toggle && <><div className="flex shrink-0 items-center gap-2 px-3 py-2 sm:gap-3 sm:px-4 sm:py-2.5">{toggleSpace}</div><Separator /></>}{connecting}</>}
      {toggle && <div ref={toggleRow} className="pointer-events-none absolute top-0 left-0 z-10 flex items-center px-3 sm:px-4 [&>*]:pointer-events-auto">{toggle}</div>}
    </div>
  </div>;

  const kind = active ? 'artifact' : file ? 'file' : host?.kind;
  const shown = active ?? file ?? host;
  const actionsFor = (floatChat: (() => void) | undefined): readonly BlockAction[] => [
    ...(placed && libraryPlacement === 'panel' ? [{ id: 'library', label: text.labels.library, icon: text.icons.library, placement: 'menu' as const, onSelect: openLibrary }] : []),
    ...(librarySide ? [{ id: 'library', label: text.labels.library, icon: text.icons.library, pressed: sideOpen, onSelect: toggleSide }] : []),
    ...(floatChat ? [{ id: 'float-chat', label: text.labels.floatChat, icon: text.icons.floatChat, placement: 'menu' as const, onSelect: floatChat }] : []),
    ...(shown ? typeof panelActions === 'function' ? panelActions(shown) : panelActions ?? [] : []),
  ];
  const sessionProps: ComponentProps<typeof SessionsPane> = { id: paneId, conversations: paneConversations, drawer: narrow, onClose: () => setDrawer(false), onChat: () => setCenterMode('chat'), onCollapse: () => setPaneOpen(false), title: labels?.sessionsTitle,
    agents, view: paneView, onViewChange: changePaneView,
    ...(librarySide ? { library: { selected: sideOpen, onSelect: toggleSide, side: true } } : placed && !libraryInPane ? { library: { selected: libraryOpen || panelLibrary, onSelect: openLibrary } } : {}),
    ...(libraryInPane ? { libraryContent: (onPicked: () => void) => libraryTree(path => { openFile(path); onPicked(); }) } : {}),
  };
  return <AppTextProvider value={text}><ChatTextProvider value={chatText}><div ref={root} data-boring="agent-workspace" data-layout={layout} data-sessions={!hasNavigation ? undefined : narrow ? (drawer ? 'drawer' : 'closed') : docked ? 'docked' : 'hidden'}
    className={cn('pi-chat relative flex h-full min-h-0 min-w-0 flex-1 overflow-hidden', className)}>
    <DockLayout storageKey={`${storageKey}.dock`} minMain={SESSIONS_WIDTH + 480}>
    {hasNavigation && (docked || (narrow && drawer)) && (sessions ? sessions(sessionProps) : <SessionsPane {...sessionProps} />)}
    <DockMain><ArtifactWorkspace open={panelOpen && !(panelLibrary && narrow)} onClose={close} panelLabel={text.labels.artifactPanel} labels={{ resize: text.labels.resizePanel, floatHint: text.labels.floatHint }} fullscreen={fullscreen} onFullscreenChange={setFullscreen} storageKey={`${storageKey}.panel-width`}
      sheetBelow={Math.max(CHAT_MIN + VIEWER_MIN, docked ? sheetBelow - SESSIONS_WIDTH : sheetBelow)} {...(floatBelow === undefined || libraryOpen ? {} : { floatBelow })}
      chat={layout => <WorkspaceCenter libraryOpen={libraryOpen} floating={layout.floating} chat={docked_chat}
        floatingChat={floatingChat && chatProps ? floatingChat(chatProps, layout.dock) : undefined}
        // With the Library in the pane, the center holds only the chat (no second, hidden toggle or tree).
        library={libraryInPane || librarySide || libraryPlacement === 'panel' ? null : <section data-testid="workspace-library-view" aria-label={text.labels.library} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-auto">{libraryTree(openFile, () => setCenterMode('chat'))}</div>
        </section>} />}
      panel={win => <ViewerWindowProvider value={{ fullscreen: win.fullscreen, onFullscreenChange: win.onFullscreenChange, actions: actionsFor(win.floatChat), labels: text.labels, icons: text.icons }}>
        <div data-testid="viewer-panel" data-kind={kind} className="flex min-h-0 flex-1 flex-col overflow-hidden [&>*]:min-h-0 [&>*]:flex-1">
          {panelLibrary ? <section data-testid="workspace-library-side" aria-label={text.labels.library} className="flex min-h-0 flex-1 flex-col"><div className="min-h-0 flex-1 overflow-auto">{libraryTree(openFile, () => setPanelLibrary(false))}</div></section> : active
            ? <ArtifactPanel key={artifactKey(active.descriptor)} active={active} versions={newestOf(artifactKey(active.descriptor))} options={options} onClose={win.close}
                onSelect={value => {
                  const known = newestOf(artifactKey(active.descriptor));
                  setOpened({ kind: 'artifact', conversation: active.conversation, follow: value === 'latest', descriptor: value === 'latest' ? (known[0] ?? active.descriptor) : { ...active.descriptor, revision: value } });
                }} />
            : file ? <FileViewer key={JSON.stringify([revisionProvider?.workspace, identity, file.path])} onBeforeLeaveChange={registerBeforeLeave} onUnsavedChange={noteUnsaved} path={file.path} locator={locate(file.path)} options={options} onClose={win.close} {...(fileBack ? { onBack: fileBack.onBack, backLabel: fileBack.label } : {})} />
            : host ? panels![host.kind]!(host, win) : null}
        </div></ViewerWindowProvider>} /></DockMain>
    {librarySide && <Dock id="library" side="right" open={sideOpen} onOpenChange={setSideOpen} defaultWidth={LIBRARY_WIDTH} minWidth={240} narrowBelow={Math.max(drawerBelow, (docked ? SESSIONS_WIDTH : 0) + (panelOpen ? VIEWER_MIN + CHAT_MIN : CHAT_MIN) + libraryWidth)} narrow="sheet"
      labels={{ region: text.labels.library, resize: text.labels.resizePanel }} >
      {api => <section data-testid="workspace-library-side" aria-label={text.labels.library} className="flex min-h-0 flex-1 flex-col">
        <WidthProbe width={api.width} onWidth={setLibraryWidth} />
        <div className="min-h-0 flex-1 overflow-auto">{libraryTree(path => { void setOpened({ kind: 'file', path }).then(opened => { if (opened && narrow) setSideOpen(false); }); }, () => setSideOpen(false))}</div>
      </section>}
    </Dock>}
    </DockLayout>
    {panelLibrary && narrow && <Drawer open showSwipeHandle onOpenChange={next => { if (!next) setPanelLibrary(false); }}><DrawerContent aria-label={text.labels.library} className="pi-chat min-h-[80dvh] max-h-[80dvh]"><DrawerTitle className="sr-only">{text.labels.library}</DrawerTitle><div data-testid="workspace-library-side" className="min-h-0 flex-1 overflow-auto pb-[env(safe-area-inset-bottom)]">{libraryTree(openFile, () => setPanelLibrary(false))}</div></DrawerContent></Drawer>}
  </div></ChatTextProvider></AppTextProvider>;
}

function WidthProbe({ width, onWidth }: { readonly width: number; readonly onWidth: (width: number) => void }) {
  useLayoutEffect(() => { onWidth(width); }, [width, onWidth]);
  return null;
}

function UploadNotice({ controller, onOpen }: { readonly controller: FileTreeController; readonly onOpen: () => void }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const failures = state.uploads.filter(upload => upload.state.kind === 'settled' && upload.state.result.kind !== 'committed');
  return failures.length ? <p role="alert" className="m-0 px-4 py-2 text-sm">{failures.length} upload{failures.length === 1 ? '' : 's'} need attention. <Button variant="link" onClick={onOpen}>Open Library</Button> to review the results and check unconfirmed uploads.</p> : null;
}

/** Keep the selected chat surface mounted while Library temporarily uses its layout space. */
function WorkspaceCenter({ libraryOpen, floating, chat, floatingChat, library }: {
  readonly libraryOpen: boolean;
  readonly floating: boolean;
  readonly chat: ReactNode;
  readonly floatingChat: ReactNode;
  readonly library: ReactNode;
}) {
  const lastFloating = useRef(floating);
  useLayoutEffect(() => { if (!libraryOpen) lastFloating.current = floating; }, [libraryOpen, floating]);
  const showFloating = libraryOpen ? lastFloating.current : floating;
  return <div className="flex min-h-0 flex-1 flex-col">
    <div data-testid="workspace-chat-surface" hidden={libraryOpen} inert={libraryOpen} aria-hidden={libraryOpen || undefined} className={cn('min-h-0 flex-1 flex-col', libraryOpen ? 'hidden' : 'flex')}>
      {showFloating && floatingChat ? floatingChat : chat}
    </div>
    <div hidden={!libraryOpen} inert={!libraryOpen} aria-hidden={!libraryOpen || undefined} className={cn('min-h-0 flex-1 flex-col', libraryOpen ? 'flex' : 'hidden')}>{library}</div>
  </div>;
}

/**
 * The seq of the provider's latest change event (`RevisionProvider.changes`), coalesced over `settleMs` so a burst (a shell writing
 * many files) reloads once. `live` is false without a feed or after the feed was refused; views then keep their own refresh.
 */
function useChangeFeed(provider: RevisionProvider | undefined, settleMs = 150): { readonly seq: number | undefined; readonly live: boolean } {
  const [state, setState] = useState<{ readonly provider: RevisionProvider | undefined; readonly seq: number | undefined; readonly live: boolean }>({ provider, seq: undefined, live: false });
  useEffect(() => {
    if (!provider?.changes) { setState({ provider, seq: undefined, live: false }); return; }
    const stop = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined, latest: number | undefined;
    setState({ provider, seq: undefined, live: true });
    void (async () => {
      try {
        for await (const event of provider.changes!({ signal: stop.signal })) {
          latest = event.seq;
          timer ??= setTimeout(() => { timer = undefined; if (!stop.signal.aborted) setState({ provider, seq: latest, live: true }); }, settleMs);
        }
      } catch { /* refused: the views fall back to their own refresh */ }
      clearTimeout(timer);
      timer = undefined;
      if (!stop.signal.aborted) setState({ provider, seq: latest, live: false });
    })();
    return () => { stop.abort(); clearTimeout(timer); };
  }, [provider, settleMs]);
  return state.provider === provider ? state : { seq: undefined, live: false };
}
