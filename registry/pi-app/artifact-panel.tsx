'use client';

// The artifact panel: the standard viewer bar (title, type, version switcher, Refresh, Share, copy, download, close) over the viewer for
// the artifact's type. It follows the latest saved revision while nothing is unsaved ("Latest") or pins one older version, read-only. It
// lists the versions the host's workspace provider retains for the file (`history`) and reads through the host's resource client. It never
// executes artifact content (HTML runs only in the viewers' sandboxed preview when the host passes `interactive`).
import { Component, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { randomUUID } from '@hachej/boring-files/platform';
import type { ResourceClient, ResourceSnapshot } from '@hachej/boring-files';
import type { ResourceIdentity } from '@hachej/boring-files/remote';
import type { SavedRevision as FileRevision } from '@hachej/boring-files/revision';
import { createMarkdownController } from '@hachej/boring-ui-kit/markdown';
import type { MarkdownController } from '@hachej/boring-ui-kit/markdown';
import { createHtmlController } from '@hachej/boring-ui-kit/html';
import type { HtmlController } from '@hachej/boring-ui-kit/html';
import type { ChatController } from '@hachej/boring-ui-kit/native-chat';
import { artifactKey, artifactKind, collectArtifacts, typeLabel } from '../pi-artifacts/artifact';
import type { ArtifactDescriptor, ArtifactKindViewProps, ArtifactTarget, ArtifactsConfig } from '../pi-artifacts/artifact';
import { CodeBlock } from '../pi-chat/code-block';
import { ViewerFrame } from '../viewer-frame/viewer-frame';
import type { ViewerFrameProps, ViewerShare } from '../viewer-frame/viewer-frame';
import type { ViewerMenuItem } from '../viewer-frame/menu';
import { ViewerVersions } from '../viewer-frame/menu';
import type { ViewerVersion } from '../viewer-frame/menu';
import type { InteractiveHtml } from '../viewer-frame/interactive-html';
import { downloadFile } from '../viewer-frame/download';
import { copyText } from '../utils/utils';
import { Separator } from '@/components/ui/separator';
import { Mounted, ViewLoading, drawsText, isEditorKind, isMediaKind, lazyRenderer, lazyView, viewerKinds } from './viewer-kinds';
import type { PanelKind } from './viewer-kinds';
import { readText, savedLabel, useSaved } from './use-saved';
import { useAppText } from './app-labels';
import { useChatText } from '../pi-chat/labels';

const NOOP = () => () => {};
/** The page's URL fragment without `#`, followed through `hashchange`: artifact kinds read a place inside the artifact from it. */
const subscribeHash = (change: () => void) => { globalThis.addEventListener?.('hashchange', change); return () => globalThis.removeEventListener?.('hashchange', change); };
const readHash = () => (globalThis.location?.hash ?? '').replace(/^#/, '');
const POLL_MS = 1500;
const EXTENSION = /\.([A-Za-z0-9]{1,8})$/;

/** One retained revision of a file with its save time (`files.saves(path)` of `@hachej/boring-files/workspace`). */
export type SavedRevision = FileRevision;

/** What a host viewer for an artifact type or file kind the block does not render itself (for example a tldraw canvas) receives. */
export interface CustomViewerProps {
  readonly target: ArtifactTarget;
  readonly title: string;
  /** A pinned revision, read-only; absent: follow the latest. */
  readonly revision?: string | undefined;
  /** Pass these on to the `ViewerFrame` around it: test ids, the version switcher or back button, Close, the share target. */
  readonly frame: Pick<ViewerFrameProps, 'testId' | 'titleTestId' | 'headerStart' | 'controls' | 'onClose' | 'target'>;
}
/** Host viewers by artifact type or file kind (`canvas`, or any other). They take precedence over the built-in ones. */
export type CustomViewers = Readonly<Record<string, (props: CustomViewerProps) => ReactNode>>;

/** Everything a viewer in the panel reads through: one resource client, the version history, host viewers and policy. */
export interface ViewerOptions {
  readonly client: ResourceClient;
  readonly identity: ResourceIdentity;
  readonly history?: ((path: string) => Promise<readonly SavedRevision[]>) | undefined;
  readonly viewers?: CustomViewers | undefined;
  /**
   * Every kind the panel and the file viewer resolve through, in order (the first match wins): its label names the artifact in the bar and
   * its `renderer` or lazily loaded `load` draws it. Default `viewerKinds` (the maquette, diagram, mock-up and records kinds, then the
   * Markdown, HTML, SVG, CSV, image and PDF kinds). A host passing its own list puts its kinds first and spreads `viewerKinds` after them.
   * A `viewers` entry wins over a built-in document kind (`fallback`), not over a host's kind.
   */
  readonly kinds?: readonly PanelKind[] | undefined;
  /** The host's opt-in to running HTML pages in the sandboxed preview. */
  readonly interactive?: InteractiveHtml | undefined;
  readonly share?: ViewerShare | undefined;
  readonly onUnsavedChange?: ((unsaved: boolean) => void) | undefined;
  readonly onBeforeLeaveChange?: ((flush: (() => Promise<boolean>) | null) => void) | undefined;
  /** Told each revision a built-in viewer has mounted and shows (after it loads, never before): the page's acknowledgement of `present`. */
  readonly onShown?: ((shown: { readonly path: string; readonly revision: string; readonly hidden?: true }) => void) | undefined;
  /** Told when an artifact kind could not show a revision (its `onFailed`, or its renderer threw): the page refuses a `present` of that file. */
  readonly onFailed?: ((failed: { readonly path: string; readonly revision: string; readonly reason: string }) => void) | undefined;
  /** Where the host serves blob bytes (a checked same-origin path, default `/_files/`): a pointer file opens from `<blobBase><id>`. */
  readonly blobBase?: string | undefined;
}

/** Reports `revision` of `path` once the viewer showing it has mounted (an effect, so never before the panel really shows it), and `hidden` when it stops. */
export function useReportShown(onShown: ViewerOptions['onShown'], path: string, revision: string | undefined): void {
  useEffect(() => {
    if (revision === undefined || !onShown) return undefined;
    onShown({ path, revision });
    return () => onShown({ path, revision, hidden: true });
  }, [onShown, path, revision]);
}

/** Draws a kind's renderer as its own component, so a throw is caught by `KindBoundary` and reported as a failure. */
function KindView({ render, props }: { readonly render: (props: ArtifactKindViewProps) => ReactNode; readonly props: ArtifactKindViewProps }) {
  return <>{render(props)}</>;
}

/**
 * Catches a kind renderer that throws: shows a short note instead of the view and reports the failure once. A new `revision` clears the
 * note without remounting the renderer: a stateful kind (the board's local frame, its save and conflict state) survives its own saves.
 */
class KindBoundary extends Component<{ readonly revision: string; readonly onError: () => void; readonly message: string; readonly children: ReactNode }, { readonly failed: boolean; readonly revision: string }> {
  override state = { failed: false, revision: this.props.revision };
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true }; }
  static getDerivedStateFromProps(props: { readonly revision: string }, state: { readonly failed: boolean; readonly revision: string }): { failed: boolean; revision: string } | null {
    return props.revision === state.revision ? null : { failed: false, revision: props.revision };
  }
  override componentDidCatch(): void { this.props.onError(); }
  override render(): ReactNode {
    return this.state.failed ? <p className="m-0 p-4 text-sm text-muted-foreground" role="status">{this.props.message}</p> : this.props.children;
  }
}

/** Every artifact version the conversation's tool results produced (the version switcher's source), oldest first. */
export function useArtifactVersions(controller: ChatController | undefined, detect?: ArtifactsConfig['detect']): ArtifactDescriptor[] {
  const view = useSyncExternalStore(controller ? controller.subscribe : NOOP, () => controller?.getSnapshot().view, () => undefined);
  return useMemo(() => collectArtifacts(view, detect), [view, detect]);
}

/** How many messages the person has sent in the conversation: it changes when a new turn starts. */
export function useTurn(controller: ChatController | undefined): number {
  const view = useSyncExternalStore(controller ? controller.subscribe : NOOP, () => controller?.getSnapshot().view, () => undefined);
  return useMemo(() => (view?.entries ?? []).reduce((count, entry) => count + (entry.model ?? []).filter(message => message.role === 'user').length, 0), [view]);
}

/** The revisions the workspace provider retains for a file with their save times, newest first; followed while the panel is open. */
function useHistory(history: ViewerOptions['history'], path: string): readonly SavedRevision[] {
  const [revisions, setRevisions] = useState<readonly SavedRevision[]>([]);
  useEffect(() => {
    if (!history) return;
    let cancelled = false;
    const key = (saves: readonly SavedRevision[]) => saves.map(save => `${save.revision}@${save.savedAt}`).join();
    const load = () => history(path).then(saves => { if (!cancelled) setRevisions(current => key(current) === key(saves) ? current : saves); }).catch(() => {});
    void load();
    const timer = setInterval(load, POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [history, path]);
  return revisions;
}

interface VersionMenu {
  readonly items: readonly ViewerVersion[];
  readonly current: string;
  /** Position counted from the oldest retained revision: only a test hook. */
  readonly number: number | undefined;
  readonly savedAt: number | undefined;
}

/** The version menu, newest first: each retained revision is named by when it was saved, and the newest is "Latest". The pin is the revision. */
function versionChoices(artifact: ArtifactDescriptor, follow: boolean, revisions: readonly SavedRevision[], earlier: string): VersionMenu {
  const at = follow ? 0 : revisions.findIndex(save => save.revision === artifact.revision);
  const shown = at < 0 ? undefined : revisions[at];
  return { items: revisions.map((save, index) => ({ id: index === 0 ? 'latest' : save.revision, label: savedLabel(save.savedAt, Date.now(), earlier), savedAt: save.savedAt, ...(save.source ? { source: save.source } : {}), latest: index === 0 })),
    current: follow ? 'latest' : artifact.revision, number: shown ? revisions.length - at : undefined, savedAt: shown?.savedAt };
}

type DocumentController = MarkdownController | HtmlController;

/** One artifact version's frame and body. Mounted per resource and revision, so switching version starts clean. */
function Version({ artifact, pinned, menu, options, onSelect, onClose, headerStart }: {
  readonly artifact: ArtifactDescriptor; readonly pinned: boolean; readonly menu: VersionMenu; readonly options: ViewerOptions;
  readonly onSelect: (value: string) => void; readonly onClose: () => void; readonly headerStart?: ReactNode;
}) {
  const { type } = artifact;
  const chatText = useChatText();
  const { client, identity } = options;
  const { labels } = useAppText();
  const path = artifact.target.resource.path;
  const [ready, setReady] = useState<{ revision: string | undefined; text: string }>();
  const [kindMenu, setKindMenu] = useState<readonly ViewerMenuItem[]>([]);
  const [kindControls, setKindControls] = useState<ReactNode>();
  // The revision a lazily loaded view has mounted: the panel acknowledges a `present` only once the view is on screen, not while it loads.
  const [mounted, setMounted] = useState<string>();
  const kinds = options.kinds ?? viewerKinds;
  // The kinds that draw (an editor, a renderer or a lazily loaded view); a label-only kind names the artifact but leaves the drawing to the
  // next match. Image and PDF kinds read bytes: the file viewer draws them, never the artifact panel.
  const drawingKinds = useMemo(() => kinds.filter(kind => drawsText(kind)), [kinds]);
  // A kind's file may link to another file of the same workspace (a maquette's diagram): read its latest revision as text.
  const read = useCallback(async (other: string) => {
    const result = await client.read({ target: { ...artifact.target, resource: { ...artifact.target.resource, path: other } }, revision: { kind: 'latest' } }).catch(() => undefined);
    return result?.kind === 'available' ? readText(result.snapshot.bytes) : undefined;
  }, [client, artifact.target]);
  const fragment = useSyncExternalStore(subscribeHash, readHash, () => '');
  // A host viewer for the type (`viewers`) wins over a built-in document kind, not over a host's kind.
  const draws = artifactKind(artifact, drawingKinds);
  const custom = draws && !draws.fallback ? undefined : options.viewers?.[type];
  const drawing = custom ? undefined : draws;
  const editor = isEditorKind(drawing) ? drawing.editor : undefined;
  const create = useMemo(() => {
    const base = (snapshot: ResourceSnapshot) => ({ identity, client, instanceId: randomUUID(), epoch: 'workspace', source: { kind: 'saved' as const, snapshot } });
    if (editor === 'markdown') return (snapshot: ResourceSnapshot): DocumentController => createMarkdownController({ ...base(snapshot), readOnly: pinned });
    if (editor === 'html') return (snapshot: ResourceSnapshot): DocumentController => createHtmlController({ ...base(snapshot), readOnly: true });
    return undefined;
  }, [editor, pinned, client, identity]);
  const autosave = useRef<{ controller: DocumentController; flush: () => Promise<boolean> } | null>(null);
  const saved = useSaved<DocumentController>({ client, target: artifact.target, revision: pinned ? artifact.revision : undefined, create,
    beforeDispose: controller => autosave.current?.controller === controller ? autosave.current.flush() : undefined });
  const controller = saved.controller;
  const registerAutosave = useCallback((flush: (() => Promise<boolean>) | null) => {
    autosave.current = flush && controller ? { controller, flush } : null;
  }, [controller]);
  useLayoutEffect(() => {
    if (!controller) return;
    const notify = () => {
      const state = controller.getSnapshot();
      options.onUnsavedChange?.(state.dirty || state.save.kind === 'pending' || state.save.kind === 'settled' && state.save.result.kind === 'unknown');
    };
    notify(); const stop = controller.subscribe(notify);
    return () => { stop(); options.onUnsavedChange?.(false); };
  }, [controller, options.onUnsavedChange]);
  // The text to copy and download is the buffer when a viewer holds one, so the person's unsaved edits are included.
  const text = useSyncExternalStore(controller ? controller.subscribe : NOOP, () => controller ? controller.getSnapshot().text : saved.text, () => saved.text);
  const extension = EXTENSION.exec(path)?.[1] ?? 'txt';
  const revision = saved.kind === 'open' ? saved.snapshot.ref.revision : pinned ? artifact.revision : undefined;
  // A host viewer and the canvas (which shows only a "no viewer" note) never report a mount: a presented file in them stays unconfirmed.
  // A kind that waits for ready (a dashboard loading its data, the sandboxed mock-up) reports only once its renderer called `onReady` for this text.
  // A lazily loaded view (every built-in viewer) reports only once it has loaded and mounted for this revision.
  const waits = !!(drawing && 'waitsForReady' in drawing && drawing.waitsForReady);
  const suspends = !!drawing && (!editor || !!controller);
  const opened = saved.kind === 'open' ? saved.snapshot.ref.revision : undefined;
  useReportShown(options.onShown, path, !custom && type !== 'canvas' && opened !== undefined && (!suspends || mounted === opened) && (!waits || ready !== undefined && ready.revision === revision && ready.text === saved.text) ? opened : undefined);
  const onFailedOption = options.onFailed;
  const reportFailed = useCallback((reason: string) => {
    setReady(undefined);
    if (revision !== undefined) onFailedOption?.({ path, revision, reason });
  }, [onFailedOption, path, revision]);
  // Choosing newest follows live saves; Current marks the displayed revision.
  const versions = menu.items.length > 1 ? <ViewerVersions testId="artifact-versions" current={menu.current} onSelect={onSelect} versions={menu.items} /> : undefined;
  const loading = <ViewLoading label={labels.loading} />;
  const target = { artifact: artifactKey(artifact), version: pinned ? artifact.revision : 'latest' };
  const frame = {
    title: artifact.title, testId: 'artifact', titleTestId: 'artifact-panel-title', controls: versions, onClose, target, ...(headerStart ? { headerStart } : {}), ...(revision === undefined ? {} : { revision }), ...(options.share ? { onShare: options.share } : {}),
    subtitle: <>
      <span title={path}>{path}</span><span aria-hidden="true">·</span>
      <span data-testid="artifact-panel-type">{typeLabel(artifact, kinds, chatText.labels.artifactTypes)}</span>
      <span aria-hidden="true">·</span>
      <span data-testid="artifact-panel-version">{pinned ? (menu.savedAt !== undefined ? labels.savedAt(savedLabel(menu.savedAt, Date.now(), labels.earlierVersion)) : labels.olderVersion) : menu.savedAt ? labels.latestSavedAt(savedLabel(menu.savedAt, Date.now(), labels.earlierVersion)) : labels.latest}</span>
    </>,
    ...(pinned ? { status: { label: labels.readOnly, kind: 'read-only' as const } } : {}),
  };
  const filename = `${artifact.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'artifact'}.${extension}`;
  const body = (children: ReactNode) => <div data-testid="artifact-body" data-state={saved.kind} className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">{children}</div>;
  if (custom) return body(custom({ target: artifact.target, title: artifact.title, ...(pinned ? { revision: artifact.revision } : {}), frame: { testId: 'artifact', titleTestId: 'artifact-panel-title', controls: versions, onClose, target, ...(headerStart ? { headerStart } : {}) } }));
  // Until the version is open the bar offers no Share: the pane that shows it brings its own frame, so this one is replaced (remounted)
  // when it opens, and a Share pressed just then would copy the link with its "Link copied" notice lost with the old frame.
  if (saved.kind !== 'open') {
    const { onShare: _, ...waiting } = frame;
    return body(<ViewerFrame {...waiting}><p className="m-0 p-4 text-sm text-muted-foreground" role="status">{saved.kind === 'loading' ? labels.loading : saved.kind === 'invalid' ? labels.artifactNotText : labels.versionUnavailable}</p></ViewerFrame>);
  }
  const document = (children: ReactNode) => <div data-testid="document" data-revision={saved.snapshot.ref.revision} className="flex h-full min-h-0 flex-col">
    {pinned && <><p role="note" data-testid="version-view-only" className="m-0 shrink-0 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">{labels.versionViewOnly}</p><Separator /></>}
    <div className="min-h-0 flex-1">{children}</div>
  </div>;
  if (isEditorKind(drawing) && controller) {
    // The pane brings its own bar; while it loads, the same bar without Share shows a spinner.
    const { onShare: _, ...waiting } = frame;
    let pane: ReactNode;
    if (drawing.editor === 'markdown') {
      const MarkdownPane = lazyView(drawing.load);
      pane = <MarkdownPane controller={controller as MarkdownController} initialMode="rich" onAutosaveChange={registerAutosave} onBeforeLeaveChange={options.onBeforeLeaveChange} {...frame} />;
    } else {
      const HtmlPane = lazyView(drawing.load);
      pane = <HtmlPane controller={controller as HtmlController} {...(options.interactive ? { interactive: options.interactive } : {})} {...frame} />;
    }
    return body(document(<Suspense fallback={<ViewerFrame {...waiting}>{loading}</ViewerFrame>}>{pane}<Mounted value={saved.snapshot.ref.revision} onMount={setMounted} /></Suspense>));
  }
  const actions = { onCopy: () => copyText(text ?? ''), onDownload: () => downloadFile(filename, text ?? '', `${artifact.mediaType};charset=utf-8`) };
  if (drawing && !isEditorKind(drawing) && !isMediaKind(drawing)) {
    const render = ('renderer' in drawing ? drawing.renderer : undefined) ?? lazyRenderer(drawing.load!);
    return body(<ViewerFrame {...frame} {...actions} controls={<>{kindControls}{versions}</>} menu={kindMenu}><div data-testid="artifact-kind-view" className="min-h-0 flex-1 overflow-auto">
      <KindBoundary revision={saved.snapshot.ref.revision} message={labels.versionUnavailable} onError={() => reportFailed('the view failed to render')}>
        <Suspense fallback={loading}>
          <KindView render={render} props={{ artifact, text: saved.text, revision: saved.snapshot.ref.revision, pinned, fragment, read, onReady: () => setReady({ revision, text: saved.text }), onFailed: reportFailed, setMenu: setKindMenu, setControls: setKindControls }} />
          <Mounted value={saved.snapshot.ref.revision} onMount={setMounted} />
        </Suspense>
      </KindBoundary>
    </div></ViewerFrame>);
  }
  if (type === 'canvas') return body(<ViewerFrame {...frame}><p className="m-0 p-4 text-sm text-muted-foreground" role="status">{labels.noCanvasViewer}</p></ViewerFrame>);
  return body(<ViewerFrame {...frame} {...actions}><div className="min-h-0 flex-1 overflow-auto p-3"><CodeBlock code={saved.text} language={artifact.language ?? 'text'} /></div></ViewerFrame>);
}

/**
 * One artifact in the panel. `active.follow` shows the latest saved revision under the newest known title (`versions`: every version of
 * this file the conversation presented or saved, newest first); otherwise the one revision in `active.descriptor` is pinned and read-only.
 * `onSelect` receives `latest` or a revision from the version menu.
 */
export function ArtifactPanel({ active, versions, options, onSelect, onClose, headerStart }: {
  readonly active: { readonly descriptor: ArtifactDescriptor; readonly follow: boolean };
  readonly versions: readonly ArtifactDescriptor[];
  readonly options: ViewerOptions;
  readonly onSelect: (value: string) => void;
  readonly onClose: () => void;
  /** A leading control in the bar, such as a back button (a file opened from a list). */
  readonly headerStart?: ReactNode;
}) {
  const { follow } = active;
  const artifact = follow ? versions[0] ?? active.descriptor : active.descriptor;
  const path = artifact.target.resource.path;
  const revisions = useHistory(options.history, path);
  const { labels } = useAppText();
  const menu = versionChoices(artifact, follow, revisions, labels.earlierVersion);
  return <div data-testid="artifact-panel" data-artifact-id={artifactKey(artifact)} data-artifact-type={artifact.type} data-follow={follow ? 'true' : 'false'} data-artifact-position={menu.number} data-artifact-revision={follow ? undefined : artifact.revision}
    className="pi-chat flex h-full min-h-0 flex-col">
    <Version key={`${path}@${follow ? 'latest' : artifact.revision}`} artifact={artifact} pinned={!follow} menu={menu} options={options} onSelect={onSelect} onClose={onClose} {...(headerStart ? { headerStart } : {})} />
  </div>;
}
