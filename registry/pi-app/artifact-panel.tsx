'use client';

// The artifact panel: the standard viewer bar (title, type, version switcher, Refresh, Share, copy, download, close) over the viewer for
// the artifact's type. It follows the latest saved revision while nothing is unsaved ("Latest") or pins one older version, read-only. It
// lists the versions the host's workspace provider retains for the file (`history`) and reads through the host's resource client. It never
// executes artifact content (HTML runs only in the viewers' sandboxed preview when the host passes `interactive`).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { CodeXmlIcon, EyeIcon } from 'lucide-react';
import { randomUUID } from '@hachej/boring-files/platform';
import type { ResourceClient, ResourceSnapshot } from '@hachej/boring-files';
import type { ResourceIdentity } from '@hachej/boring-files/remote';
import type { SavedRevision as FileRevision } from '@hachej/boring-files/revision';
import { createMarkdownController } from '@hachej/boring-ui-kit/markdown';
import type { MarkdownController } from '@hachej/boring-ui-kit/markdown';
import { createHtmlController } from '@hachej/boring-ui-kit/html';
import type { HtmlController } from '@hachej/boring-ui-kit/html';
import type { NativeChatController } from '@hachej/boring-ui-kit/native-chat';
import { artifactKey, collectArtifacts } from '../pi-chat/pi-chat';
import type { ArtifactDescriptor, ArtifactKind, ArtifactTarget, ArtifactsConfig } from '../pi-chat/pi-chat';
import { CodeBlock } from '../pi-chat/code-block';
import { artifactKind, typeLabel } from '../pi-chat/artifact';
import { HtmlPane } from '../viewers/html-pane';
import { MarkdownPane } from '../viewers/markdown-pane';
import { ViewerFrame, ViewerToggle } from '../viewers/viewer-frame';
import type { ViewerFrameProps, ViewerShare } from '../viewers/viewer-frame';
import { ViewerVersions } from '../viewers/menu';
import type { ViewerVersion } from '../viewers/menu';
import type { InteractiveHtml } from '../viewers/interactive-html';
import { downloadFile } from '../viewers/download';
import { maquetteKind } from '../maquette-viewer/maquette-viewer';
import { diagramKind } from '../diagram-viewer/diagram-viewer';
import { copyText } from '../utils/utils';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { readText, savedLabel, useSaved } from './use-saved';
import { useAppText } from './app-labels';

const NOOP = () => () => {};
/** The page's URL fragment without `#`, followed through `hashchange`: artifact kinds read a place inside the artifact from it. */
const subscribeHash = (change: () => void) => { globalThis.addEventListener?.('hashchange', change); return () => globalThis.removeEventListener?.('hashchange', change); };
const readHash = () => (globalThis.location?.hash ?? '').replace(/^#/, '');
const POLL_MS = 1500;
const EXTENSION = /\.([A-Za-z0-9]{1,8})$/;

/**
 * The one place an artifact or a file is matched to its kind: the app's kinds first, then the built-in maquette and diagram kinds, so an
 * app's kind for those files wins. The chat card (through the kinds `AgentWorkspace` hands it), the panel and a file opened from the Library,
 * the file tree or a link all resolve here.
 */
export const withBuiltInKinds = (kinds: readonly ArtifactKind[] | undefined): readonly ArtifactKind[] => [...(kinds ?? []), maquetteKind, diagramKind];
export const resolveKind = (artifact: ArtifactDescriptor, kinds: readonly ArtifactKind[] | undefined): ArtifactKind | undefined => artifactKind(artifact, withBuiltInKinds(kinds));

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
  /** The app's artifact kinds: their label names the artifact in the bar and their `renderer` draws it (before `viewers` and the built-in viewers).
   * The built-in maquette and diagram kinds (`*.maquette.json`, `maquette-viewer`; `*.diagram.json`, `diagram-viewer`) come after them, so an
   * app's kind for those files wins. */
  readonly kinds?: readonly ArtifactKind[] | undefined;
  /** The host's opt-in to running HTML pages in the sandboxed preview. */
  readonly interactive?: InteractiveHtml | undefined;
  readonly share?: ViewerShare | undefined;
  readonly onUnsavedChange?: ((unsaved: boolean) => void) | undefined;
  readonly onBeforeLeaveChange?: ((flush: (() => Promise<boolean>) | null) => void) | undefined;
  /** Told each revision a built-in viewer has mounted and shows (after it loads, never before): the page's acknowledgement of `present`. */
  readonly onShown?: ((shown: { readonly path: string; readonly revision: string; readonly hidden?: true }) => void) | undefined;
}

/** Reports `revision` of `path` once the viewer showing it has mounted (an effect, so never before the panel really shows it), and `hidden` when it stops. */
export function useReportShown(onShown: ViewerOptions['onShown'], path: string, revision: string | undefined): void {
  useEffect(() => {
    if (revision === undefined || !onShown) return undefined;
    onShown({ path, revision });
    return () => onShown({ path, revision, hidden: true });
  }, [onShown, path, revision]);
}

/** Every artifact version the conversation's tool results produced (the version switcher's source), oldest first. */
export function useArtifactVersions(controller: NativeChatController | undefined, detect?: ArtifactsConfig['detect']): ArtifactDescriptor[] {
  const view = useSyncExternalStore(controller ? controller.subscribe : NOOP, () => controller?.getSnapshot().view, () => undefined);
  return useMemo(() => collectArtifacts(view, detect), [view, detect]);
}

/** How many messages the person has sent in the conversation: it changes when a new turn starts. */
export function useTurn(controller: NativeChatController | undefined): number {
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

function SvgView({ text, title, frame }: { readonly text: string; readonly title: string; readonly frame: ViewerFrameProps }) {
  const { labels } = useAppText();
  const [mode, setMode] = useState<'preview' | 'source'>('preview');
  // An SVG is shown only as an image from a blob URL: it never becomes markup in this page, so its scripts cannot run.
  const url = useMemo(() => URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' })), [text]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return <ViewerFrame {...frame} controls={<>
    <ViewerToggle label={labels.view} value={mode} onChange={setMode} options={[
      { id: 'preview', label: labels.preview, text: labels.preview, icon: <EyeIcon className="size-4" aria-hidden="true" />, testId: 'artifact-mode' },
      { id: 'source', label: labels.source, text: labels.source, icon: <CodeXmlIcon className="size-4" aria-hidden="true" />, testId: 'artifact-mode' }]} />
    {frame.controls}</>}>
    {mode === 'preview'
      ? <div className="boring-viewer-checker flex min-h-0 flex-1 items-center justify-center overflow-auto p-6"><img data-testid="artifact-svg" src={url} alt={title} className="max-h-full max-w-full" /></div>
      : <div className="min-h-0 flex-1 overflow-auto p-3"><CodeBlock code={text} language="svg" /></div>}
  </ViewerFrame>;
}

/** Rows of a CSV text (comma or semicolon separated, double-quoted cells with `""` escapes), at most 2000. */
export function csvRows(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < text.length && rows.length < 2000; i++) {
    const c = text[i];
    if (quoted) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c; }
    else if (c === '"') quoted = true;
    else if (c === ',' || c === ';') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if ((cell || row.length) && rows.length < 2000) { row.push(cell); rows.push(row); }
  return rows;
}

/** A CSV artifact as a table: the first row is the header. */
function CsvTable({ text }: { readonly text: string }) {
  const [head = [], ...rows] = csvRows(text);
  return <Table data-testid="artifact-csv">
    <TableHeader><TableRow>{head.map((cell, i) => <TableHead key={i}>{cell}</TableHead>)}</TableRow></TableHeader>
    <TableBody>{rows.map((row, i) => <TableRow key={i}>{row.map((cell, j) => <TableCell key={j} className="align-top">{cell}</TableCell>)}</TableRow>)}</TableBody>
  </Table>;
}

type DocumentController = MarkdownController | HtmlController;

/** One artifact version's frame and body. Mounted per resource and revision, so switching version starts clean. */
function Version({ artifact, pinned, menu, options, onSelect, onClose, headerStart }: {
  readonly artifact: ArtifactDescriptor; readonly pinned: boolean; readonly menu: VersionMenu; readonly options: ViewerOptions;
  readonly onSelect: (value: string) => void; readonly onClose: () => void; readonly headerStart?: ReactNode;
}) {
  const { type } = artifact;
  const { client, identity } = options;
  const { labels } = useAppText();
  const path = artifact.target.resource.path;
  const kinds = useMemo(() => withBuiltInKinds(options.kinds), [options.kinds]);
  // A kind's file may link to another file of the same workspace (a maquette's diagram): read its latest revision as text.
  const read = useCallback(async (other: string) => {
    const result = await client.read({ target: { ...artifact.target, resource: { ...artifact.target.resource, path: other } }, revision: { kind: 'latest' } }).catch(() => undefined);
    return result?.kind === 'available' ? readText(result.snapshot.bytes) : undefined;
  }, [client, artifact.target]);
  const kind = artifactKind(artifact, kinds);
  const fragment = useSyncExternalStore(subscribeHash, readHash, () => '');
  const custom = kind?.renderer ? undefined : options.viewers?.[type];
  const create = useMemo(() => {
    const base = (snapshot: ResourceSnapshot) => ({ identity, client, instanceId: randomUUID(), epoch: 'workspace', source: { kind: 'saved' as const, snapshot } });
    if (custom || kind?.renderer) return undefined;
    if (type === 'markdown') return (snapshot: ResourceSnapshot): DocumentController => createMarkdownController({ ...base(snapshot), readOnly: pinned });
    if (type === 'html') return (snapshot: ResourceSnapshot): DocumentController => createHtmlController({ ...base(snapshot), readOnly: true });
    return undefined;
  }, [type, pinned, client, identity, custom, kind?.renderer]);
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
  useReportShown(options.onShown, path, !custom && type !== 'canvas' && saved.kind === 'open' ? saved.snapshot.ref.revision : undefined);
  // Choosing newest follows live saves; Current marks the displayed revision.
  const versions = menu.items.length > 1 ? <ViewerVersions testId="artifact-versions" current={menu.current} onSelect={onSelect} versions={menu.items} /> : undefined;
  const target = { artifact: artifactKey(artifact), version: pinned ? artifact.revision : 'latest' };
  const frame = {
    title: artifact.title, testId: 'artifact', titleTestId: 'artifact-panel-title', controls: versions, onClose, target, ...(headerStart ? { headerStart } : {}), ...(revision === undefined ? {} : { revision }), ...(options.share ? { onShare: options.share } : {}),
    subtitle: <>
      <span title={path}>{path}</span><span aria-hidden="true">·</span>
      <span data-testid="artifact-panel-type">{typeLabel(artifact, kinds)}</span>
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
  if (type === 'markdown' && controller) return body(document(<MarkdownPane controller={controller as MarkdownController} initialMode="rich" onAutosaveChange={registerAutosave} onBeforeLeaveChange={options.onBeforeLeaveChange} {...frame} />));
  if (type === 'html' && controller) return body(document(<HtmlPane controller={controller as HtmlController} {...(options.interactive ? { interactive: options.interactive } : {})} {...frame} />));
  const actions = { onCopy: () => copyText(text ?? ''), onDownload: () => downloadFile(filename, text ?? '', `${artifact.mediaType};charset=utf-8`) };
  if (kind?.renderer) return body(<ViewerFrame {...frame} {...actions}><div data-testid="artifact-kind-view" className="min-h-0 flex-1 overflow-auto">{kind.renderer({ artifact, text: saved.text, revision: saved.snapshot.ref.revision, pinned, fragment, read })}</div></ViewerFrame>);
  if (type === 'code' && artifact.language === 'csv') return body(<ViewerFrame {...frame} {...actions}><div className="min-h-0 flex-1 overflow-auto"><CsvTable text={saved.text} /></div></ViewerFrame>);
  if (type === 'svg') return body(<SvgView text={saved.text} title={artifact.title} frame={{ ...frame, ...actions }} />);
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
