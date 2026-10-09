'use client';

import '@hachej/boring-ui-kit/file-tree.css';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import type { ResourceLocator } from '@hachej/boring-files';
import { createResourceClient } from '@hachej/boring-files/remote';
import type { RevisionProvider } from '@hachej/boring-files/revision';
import { createFileTreeController } from '@hachej/boring-ui-kit/file-tree';
import type { FileTreeController } from '@hachej/boring-ui-kit/file-tree';
import { FileTreeView } from '@hachej/boring-ui-kit/file-tree-view';
import { frenchAppLabels } from './app-labels-fr';
import { chatTextFor } from '../pi-chat/locale';
import type { ChatLocale } from '../pi-chat/locale';
import type { FileTreeViewProps } from '@hachej/boring-ui-kit/file-tree-view';
import type { ResourceIdentity } from '@hachej/boring-files/remote';
import type { NativeChatController } from '@hachej/boring-ui-kit/native-chat';
import { PiChat, artifactKey } from '../pi-chat/pi-chat';
import type { ArtifactDescriptor, ArtifactsConfig, ConversationsConfig, PiChatProps } from '../pi-chat/pi-chat';
import { ArtifactWorkspace } from '../pi-workspace/workspace';
import type { WorkspacePanelApi } from '../pi-workspace/workspace';
import { ViewerWindowProvider } from '../viewers/viewer-frame';
import type { ViewerShare } from '../viewers/viewer-frame';
import type { InteractiveHtml } from '../viewers/interactive-html';
import { Button } from '../button/button';
import type { BlockAction } from '../button/actions';
import { ChatTextProvider, useMergedText } from '../pi-chat/labels';
import { cn, withDefaults } from '../utils/utils';
import { AppTextProvider, defaultAppIcons, defaultAppLabels } from './app-labels';
import type { AppIcons, AppLabels } from './app-labels';
import { ArtifactPanel, useArtifactVersions, useTurn } from './artifact-panel';
import type { CustomViewers, SavedRevision, ViewerOptions } from './artifact-panel';
import { FileViewer } from './file-viewer';
import { uploadRevisionAttachments } from './revision-files';
import { SessionsPane, SessionsToggle } from './sessions';
import type { SessionsView, WorkspaceAgents } from './sessions';

export { ArtifactPanel, useArtifactVersions, useTurn } from './artifact-panel';
export type { CustomViewerProps, CustomViewers, SavedRevision, ViewerOptions } from './artifact-panel';
export { FileViewer } from './file-viewer';
export { SessionsPane, SessionsToggle } from './sessions';
export type { SessionsView, WorkspaceAgent, WorkspaceAgents } from './sessions';
export { useConversations } from './use-conversations';
export { useRemoteChat } from './use-remote-chat';
export type { RemoteChatState } from './use-remote-chat';
export { savedLabel, useSaved } from './use-saved';
export { kindOf, mediaTypeOf } from './file-kinds';
export { defaultAppIcons, defaultAppLabels } from './app-labels';
export { frenchAppLabels } from './app-labels-fr';
export type { AppIcons, AppLabels } from './app-labels';
export type { FileKind } from './file-kinds';

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

/** Where the viewers read and write: the host's resource handler (`createResourceHandler` of `@hachej/boring-files/remote`) and its file history. */
export interface WorkspaceResources {
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
   * Where the Library of a `revisionProvider` opens. `center` (default): Chat and Library links in the left pane, the Library replacing
   * the chat in the center (the chat stays mounted). `pane`: the Library is a tab beside the conversations in the left pane, or the
   * whole pane on a single-session page without `conversations`; files open in the right panel as usual.
   */
  readonly libraryPlacement?: 'center' | 'pane' | undefined;
  /** The page's language: `en` (default) or `fr`, for the chat, the panes, the viewers and the Library. `labels` and `chat.labels` override any word. */
  readonly locale?: ChatLocale | undefined;
  /**
   * The Library tree's options: its words (`labels`, over `defaultFileTreeLabels`), whether it offers Upload and History, and a
   * `refreshKey` that reloads it when it changes (for example the number of documents the agent saved).
   */
  readonly fileTree?: Pick<FileTreeViewProps, 'labels' | 'upload' | 'history' | 'refreshKey'> | undefined;
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
  /** Recognise artifacts in tool results that carry no descriptor (`ArtifactsConfig.detect`). */
  readonly detect?: ArtifactsConfig['detect'] | undefined;
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
  /** Prefix of the session-scoped layout keys (panel width, floating chat, collapsed sessions). */
  readonly storageKey?: string;
  /** Below this width of the workspace the artifact panel is a full-screen sheet. */
  readonly sheetBelow?: number;
  /** Below this width of the workspace the sessions pane is a drawer. */
  readonly drawerBelow?: number;
  readonly floatBelow?: number | undefined;
  readonly className?: string;
}

export type AgentWorkspaceProps = AgentWorkspaceBaseProps & (
  | { readonly revisionProvider: RevisionProvider; readonly resources?: never }
  | { readonly resources: WorkspaceResources; readonly revisionProvider?: never }
);

const SESSIONS_WIDTH = 288;
const readFlag = (key: string): boolean => { try { return sessionStorage.getItem(key) === '1'; } catch { return false; } };
const writeFlag = (key: string, on: boolean) => { try { if (on) sessionStorage.setItem(key, '1'); else sessionStorage.removeItem(key); } catch { /* the layout is a convenience */ } };
const defaultLocate = (path: string): ResourceLocator => ({ resource: { providerId: 'workspace', path: path.replace(/^\/+/, '') }, view: { kind: 'published' } });

/**
 * A complete agent page in one component: the sessions pane on the left (search, New, rename, archive, delete; collapsible, a drawer on
 * a narrow screen), the chat in the center (`PiChat`) and the artifact viewers on the right (`ArtifactWorkspace` with the artifact panel and
 * its versions, the file viewer and the host's own views). Agent artifacts open the panel as they appear. Every prop is data or a callback:
 * the host owns the routes, authentication, the controller and what is open (when controlled).
 */
export function AgentWorkspace({ controller, conversationId, chat = {}, labels, icons, panelActions, connecting, conversations, resources, revisionProvider, libraryPlacement = 'center', locale, fileTree: treeOptions, agents, detect, viewers, interactive, share, opened: controlled,
  defaultOpened = null, onOpenedChange, onUnsavedChange, panels, autoOpen = true, fileBack, floatingChat, chatTop, controls, storageKey = 'boring.agent-workspace', sheetBelow = 768, drawerBelow = 768, floatBelow, className }: AgentWorkspaceProps) {
  const [own, setOwn] = useState<OpenedView | null>(defaultOpened);
  const opened = controlled !== undefined ? controlled : own;
  const change = useRef(onOpenedChange); change.current = onOpenedChange;
  const isControlled = controlled !== undefined;
  const unsaved = useRef(false);
  const currentView = useRef(opened); currentView.current = opened;
  const unsavedChange = useRef(onUnsavedChange); unsavedChange.current = onUnsavedChange;
  const noteUnsaved = useCallback((value: boolean) => { if (unsaved.current !== value) { unsaved.current = value; unsavedChange.current?.(value); } }, []);
  /** Opens `next` and reports whether it did: leaving a file with unsaved changes asks first, and the person may stay. */
  const setOpened = useCallback((next: OpenedView | null): boolean => {
    const current = currentView.current;
    if (isFile(current) && isFile(next) && current.path === next.path) return true;
    if (unsaved.current && !globalThis.confirm?.('This file has unsaved or unconfirmed changes. Discard the local draft and leave this file?')) return false;
    noteUnsaved(false);
    if (!isControlled) setOwn(next); change.current?.(next);
    return true;
  }, [isControlled, noteUnsaved]);
  const [fullscreen, setFullscreen] = useState(false);
  const [centerMode, setCenterMode] = useState<'chat' | 'library'>('chat');
  const libraryInPane = Boolean(revisionProvider) && libraryPlacement === 'pane';
  const libraryOpen = Boolean(revisionProvider) && !libraryInPane && centerMode === 'library';
  const openLibrary = useCallback(() => { setCenterMode('library'); setFullscreen(false); }, []);
  const text = useMemo(() => ({ labels: withDefaults(locale === 'fr' ? frenchAppLabels : defaultAppLabels, labels), icons: withDefaults(defaultAppIcons, icons) }), [labels, icons, locale]);
  // The sessions pane shows the chat's conversation list, so it reads the chat's labels too.
  const chatText = useMergedText(chat.labels, chat.icons, chatTextFor(locale));

  const fetcher = useRef(resources?.fetch); fetcher.current = resources?.fetch;
  const endpoint = resources ? String(resources.endpoint) : undefined;
  const historyEndpoint = resources?.history === undefined ? undefined : String(resources.history);
  const identity = revisionProvider?.identity ?? resources!.identity;
  const identityKey = JSON.stringify(identity);
  const client = useMemo(() => revisionProvider ?? createResourceClient({ identity, endpoint: new URL(endpoint!, globalThis.location?.href), publication: true, reconciliation: true,
    fetch: request => fetcher.current!(request) }), [revisionProvider, endpoint, identityKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const history = useMemo(() => revisionProvider ? revisionProvider.history : historyEndpoint === undefined ? undefined : async (path: string): Promise<readonly SavedRevision[]> => {
    const url = new URL(historyEndpoint, globalThis.location?.href);
    url.searchParams.set('path', path);
    const response = await fetcher.current!(new Request(url));
    if (!response.ok) throw new Error(`History: ${response.status}`);
    return (await response.json() as { saves: readonly SavedRevision[] }).saves;
  }, [revisionProvider, historyEndpoint]);
  const options: ViewerOptions = useMemo(() => ({ client, identity, history, viewers, interactive, share }), [client, identityKey, history, viewers, interactive, share]); // eslint-disable-line react-hooks/exhaustive-deps
  const locate = revisionProvider?.locate ?? resources?.locate ?? defaultLocate;
  const [fileBinding, setFileBinding] = useState<{ readonly provider: RevisionProvider; readonly tree: FileTreeController }>();
  useEffect(() => {
    if (!revisionProvider) return;
    const tree = createFileTreeController({ revisionProvider });
    setFileBinding({ provider: revisionProvider, tree });
    void tree.refresh();
    return () => tree.dispose();
  }, [revisionProvider]);
  const fileTree = fileBinding?.provider === revisionProvider ? fileBinding?.tree : undefined;
  // `fileTree.refreshKey` reloads the shared tree controller, shown or not: the Library may be on its other tab when a file arrives,
  // and mounting the tree later must not show the listing from before.
  const { refreshKey, ...viewOptions } = treeOptions ?? {};
  const refreshedKey = useRef(refreshKey);
  useEffect(() => {
    if (!fileTree || Object.is(refreshedKey.current, refreshKey)) return;
    refreshedKey.current = refreshKey;
    const { query, expanded } = fileTree.getSnapshot();
    if (query) void fileTree.search(query);
    else for (const directory of ['', ...expanded]) void fileTree.refresh(directory);
  }, [fileTree, refreshKey]);
  const openFile = useCallback((path: string) => { setOpened({ kind: 'file', path }); }, [setOpened]);
  const mentions = useMemo(() => revisionProvider ? {
    search: async (query: string, signal: AbortSignal) => (await revisionProvider.search({ query, limit: 8 }, signal)).entries,
    open: openFile,
  } : undefined, [revisionProvider, openFile]);
  const [attachmentFailure, setAttachmentFailure] = useState<{ readonly tree: FileTreeController; readonly reasons: readonly string[] }>();
  const attachments = useMemo(() => fileTree ? {
    upload: (files: File[], signal: AbortSignal) => {
      setAttachmentFailure(undefined);
      return uploadRevisionAttachments(fileTree, files, signal, (name, reason) => {
        if (fileTree.getSnapshot().lifecycle === 'active') setAttachmentFailure(current => ({ tree: fileTree,
          reasons: [...(current?.tree === fileTree ? current.reasons : []), `${name}: ${reason}`] }));
      });
    },
  } : undefined, [fileTree]);

  // ---- Artifacts: cards open the panel; the agent's new ones open it too.
  const versions = useArtifactVersions(controller, detect);
  const turn = useTurn(controller);
  const active = isArtifact(opened) && opened.conversation === conversationId ? opened : null;
  const file = isFile(opened) ? opened : null;
  const host = opened && !isArtifact(opened) && !isFile(opened) && panels?.[opened.kind] ? opened : null;
  const panelOpen = Boolean(active || file || host);
  const seen = useRef(new Map<string, Set<string>>());
  const closedInTurn = useRef(new Map<string, number>());
  // Kept editing after the unsaved-changes question: the panel stays as it was, and the next artifact may still open it.
  const close = () => { if (!setOpened(null)) return; if (conversationId !== undefined) closedInTurn.current.set(conversationId, turn); setFullscreen(false); };
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
  /** The versions of one file that the conversation presented or saved, newest first. */
  const newestOf = (key: string) => versions.filter(version => artifactKey(version) === key).reverse();
  const artifacts: ArtifactsConfig = useMemo(() => ({
    open: descriptor => { if (conversationId !== undefined) setOpened({ kind: 'artifact', conversation: conversationId, descriptor, follow: descriptor.revision === newestOf(artifactKey(descriptor))[0]?.revision }); },
    isOpen: descriptor => Boolean(active && artifactKey(active.descriptor) === artifactKey(descriptor) && (active.follow ? descriptor.revision === newestOf(artifactKey(descriptor))[0]?.revision : descriptor.revision === active.descriptor.revision)),
    ...(detect ? { detect } : {}),
  }), [conversationId, active, versions, detect, setOpened]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const [collapsed, setCollapsed] = useState(() => readFlag(`${storageKey}.sessions-hidden`));
  const [drawer, setDrawer] = useState(false);
  const [paneView, setPaneView] = useState<SessionsView>(() => readFlag(`${storageKey}.library`) ? 'library' : 'conversations');
  const changePaneView = useCallback((next: SessionsView) => { writeFlag(`${storageKey}.library`, next === 'library'); setPaneView(next); }, [storageKey]);
  // The upload notice's "Open Library": the center Library, or the pane's Library tab with the pane shown.
  const revealLibrary = () => {
    if (!libraryInPane) { openLibrary(); return; }
    changePaneView('library');
    if (narrow) setDrawer(true); else { writeFlag(`${storageKey}.sessions-hidden`, false); setCollapsed(false); }
  };
  useEffect(() => { if (!narrow) setDrawer(false); }, [narrow]);
  const hasNavigation = Boolean(conversations || revisionProvider);
  const docked = hasNavigation && width > 0 && !narrow && !collapsed;
  const toggle = hasNavigation && <SessionsToggle navigation={Boolean(revisionProvider)} open={narrow ? drawer : !collapsed} drawer={narrow}
    onToggle={() => { if (narrow) setDrawer(value => !value); else setCollapsed(value => { writeFlag(`${storageKey}.sessions-hidden`, !value); return !value; }); }} />;

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
  const toggleSpace = toggle && <Button ref={headerSlot} size="icon-sm" aria-hidden="true" tabIndex={-1} className="invisible -ml-1" />;

  // ---- The chat in the center: docked PiChat, or the host's floating surface over the same controller (with the toggle in its header).
  const header = typeof controls === 'function' ? controls({ panelOpen }) : controls ?? chat.controls;
  const chatProps: PiChatProps | undefined = controller && { ...(mentions ? { mentions } : {}), ...(attachments ? { attachments } : {}), ...(locale ? { locale } : {}), ...chat, controller, artifacts, ...(conversations ? { conversations, historyList: false } : {}),
    headerStart: <>{toggle}{chat.headerStart}</>, ...(header === undefined ? {} : { controls: header }) };
  const docked_chat = <div data-testid="workspace-center" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
    {attachmentFailure?.tree === fileTree && attachmentFailure?.reasons.map((reason, index) => <p key={index} role="alert" className="m-0 px-4 py-2 text-sm">{reason}</p>)}
    {fileTree && <UploadNotice controller={fileTree} onOpen={revealLibrary} />}
    {chatTop}
    <div className="relative flex min-h-0 flex-1 flex-col">
      {chatProps ? <PiChat key={conversationId} {...chatProps} headerStart={<>{toggleSpace}{chat.headerStart}</>} className={cn('min-h-0 flex-1', chat.className)} />
        // Same geometry as the PiChat header, so nothing moves when the chat arrives.
        : <>{toggle && <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 sm:gap-3 sm:px-4 sm:py-2.5">{toggleSpace}</div>}{connecting}</>}
      {toggle && <div ref={toggleRow} className="pointer-events-none absolute top-0 left-0 z-10 flex items-center px-3 sm:px-4 [&>*]:pointer-events-auto">{toggle}</div>}
    </div>
  </div>;

  const kind = active ? 'artifact' : file ? 'file' : host?.kind;
  const shown = active ?? file ?? host;
  const actionsFor = (floatChat: (() => void) | undefined): readonly BlockAction[] => [
    ...(floatChat ? [{ id: 'float-chat', label: text.labels.floatChat, icon: text.icons.floatChat, placement: 'menu' as const, onSelect: floatChat }] : []),
    ...(shown ? typeof panelActions === 'function' ? panelActions(shown) : panelActions ?? [] : []),
  ];
  return <AppTextProvider value={text}><ChatTextProvider value={chatText}><div ref={root} data-boring="agent-workspace" data-sessions={!hasNavigation ? undefined : narrow ? (drawer ? 'drawer' : 'closed') : docked ? 'docked' : 'hidden'}
    className={cn('relative flex h-full min-h-0 min-w-0 flex-1 overflow-hidden', className)}>
    {hasNavigation && (docked || (narrow && drawer)) && <SessionsPane conversations={conversations} drawer={narrow} onClose={() => setDrawer(false)} onChat={() => setCenterMode('chat')}
      agents={agents} view={paneView} onViewChange={changePaneView}
      {...(revisionProvider && !libraryInPane ? { library: { selected: libraryOpen, onSelect: openLibrary } } : {})}
      {...(libraryInPane ? { libraryContent: (onPicked: () => void) => fileTree
        ? <FileTreeView key={JSON.stringify([revisionProvider?.workspace, revisionProvider?.identity])} {...(locale ? { locale } : {})} {...viewOptions} controller={fileTree} onOpen={path => { openFile(path); onPicked(); }} {...(isFile(opened) ? { selectedPath: opened.path } : {})} />
        : <p role="status" className="m-0 p-3 text-sm text-muted-foreground">{text.labels.loading}</p> } : {})} />}
    <ArtifactWorkspace open={panelOpen} onClose={close} panelLabel={text.labels.artifactPanel} labels={{ resize: text.labels.resizePanel, floatHint: text.labels.floatHint }} fullscreen={fullscreen} onFullscreenChange={setFullscreen} storageKey={`${storageKey}.panel-width`}
      sheetBelow={docked ? Math.max(0, sheetBelow - SESSIONS_WIDTH) : sheetBelow} {...(floatBelow === undefined || libraryOpen ? {} : { floatBelow })}
      chat={layout => <WorkspaceCenter libraryOpen={libraryOpen} floating={layout.floating} chat={docked_chat}
        floatingChat={floatingChat && chatProps ? floatingChat(chatProps, layout.dock) : undefined}
        // With the Library in the pane, the center holds only the chat (no second, hidden toggle or tree).
        library={libraryInPane ? null : <section data-testid="workspace-library-view" aria-label={text.labels.library} className="flex min-h-0 flex-1 flex-col">
          <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">{toggle}<h2 className="m-0 flex-1 text-sm font-semibold">{text.labels.library}</h2>
            <Button variant="ghost" size="sm" onClick={() => setCenterMode('chat')}>{text.labels.backToChat}</Button></header>
          <div className="min-h-0 flex-1 overflow-auto">{fileTree ? <FileTreeView key={JSON.stringify([revisionProvider?.workspace, revisionProvider?.identity])} {...(locale ? { locale } : {})} {...viewOptions} controller={fileTree} onOpen={openFile} {...(isFile(opened) ? { selectedPath: opened.path } : {})} /> : <p role="status">{treeOptions?.labels?.loading ?? text.labels.loading}</p>}</div>
        </section>} />}
      panel={win => <ViewerWindowProvider value={{ fullscreen: win.fullscreen, onFullscreenChange: win.onFullscreenChange, actions: actionsFor(win.floatChat), labels: text.labels, icons: text.icons }}>
        <div data-testid="viewer-panel" data-kind={kind} className="flex min-h-0 flex-1 flex-col overflow-hidden [&>*]:min-h-0 [&>*]:flex-1">
          {active
            ? <ArtifactPanel key={artifactKey(active.descriptor)} active={active} versions={newestOf(artifactKey(active.descriptor))} options={options} onClose={win.close}
                onSelect={value => {
                  const known = newestOf(artifactKey(active.descriptor));
                  setOpened({ kind: 'artifact', conversation: active.conversation, follow: value === 'latest', descriptor: value === 'latest' ? (known[0] ?? active.descriptor) : { ...active.descriptor, revision: value } });
                }} />
            : file ? <FileViewer key={JSON.stringify([revisionProvider?.workspace, identity, file.path])} onUnsavedChange={noteUnsaved} path={file.path} locator={locate(file.path)} options={options} onClose={win.close} {...(fileBack ? { onBack: fileBack.onBack, backLabel: fileBack.label } : {})} />
            : host ? panels![host.kind]!(host, win) : null}
        </div></ViewerWindowProvider>} />
  </div></ChatTextProvider></AppTextProvider>;
}

function UploadNotice({ controller, onOpen }: { readonly controller: FileTreeController; readonly onOpen: () => void }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const failures = state.uploads.filter(upload => upload.state.kind === 'settled' && upload.state.result.kind !== 'committed');
  return failures.length ? <p role="alert" className="m-0 px-4 py-2 text-sm">{failures.length} upload{failures.length === 1 ? '' : 's'} need attention. <button type="button" className="underline" onClick={onOpen}>Open Library</button> to review the results and check unconfirmed uploads.</p> : null;
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
