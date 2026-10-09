'use client';

// The artifact panel: the standard viewer bar (title, type, version switcher, Refresh, Share, copy, download, close) over the viewer for
// the artifact's type. It follows the latest saved revision while nothing is unsaved ("Latest") or pins one older version, read-only. It
// lists the versions the host's workspace provider retains for the file (`history`) and reads through the host's resource client. It never
// executes artifact content (HTML runs only in the viewers' sandboxed preview when the host passes `interactive`).
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { CodeXmlIcon, EyeIcon } from 'lucide-react';
import { randomUUID } from '@hachej/boring-files/platform';
import type { ResourceClient, ResourceSnapshot } from '@hachej/boring-files';
import type { ResourceIdentity } from '@hachej/boring-files/remote';
import { createMarkdownController } from '@hachej/boring-ui-kit/markdown';
import type { MarkdownController } from '@hachej/boring-ui-kit/markdown';
import { createHtmlController } from '@hachej/boring-ui-kit/html';
import type { HtmlController } from '@hachej/boring-ui-kit/html';
import type { NativeChatController } from '@hachej/boring-ui-kit/native-chat';
import { artifactKey, collectArtifacts } from '../pi-chat/pi-chat';
import type { ArtifactDescriptor, ArtifactTarget, ArtifactsConfig } from '../pi-chat/pi-chat';
import { CodeBlock } from '../pi-chat/code-block';
import { typeLabel } from '../pi-chat/artifact';
import { HtmlPane } from '../viewers/html-pane';
import { MarkdownPane } from '../viewers/markdown-pane';
import { ViewerFrame, ViewerToggle } from '../viewers/viewer-frame';
import type { ViewerFrameProps, ViewerShare } from '../viewers/viewer-frame';
import { ViewerVersions } from '../viewers/menu';
import type { InteractiveHtml } from '../viewers/interactive-html';
import { downloadFile } from '../viewers/download';
import { copyText } from '../utils/utils';
import { savedLabel, useSaved } from './use-saved';
import { useAppText } from './app-labels';

const NOOP = () => () => {};
const POLL_MS = 1500;
const EXTENSION = /\.([A-Za-z0-9]{1,8})$/;

/** One retained revision of a file with its save time (`files.saves(path)` of `@hachej/boring-files/workspace`). */
export interface SavedRevision { readonly revision: string; readonly savedAt: number }

/** What a host viewer for an artifact type or file kind the block does not render itself (for example a tldraw canvas) receives. */
export interface CustomViewerProps {
  readonly target: ArtifactTarget;
  readonly title: string;
  /** A pinned revision, read-only; absent: follow the latest. */
  readonly revision?: string | undefined;
  /** Pass these on to the `ViewerFrame` around it: test ids, the version switcher or back button, Close, the share target. */
  readonly frame: Pick<ViewerFrameProps, 'testId' | 'titleTestId' | 'controls' | 'onClose' | 'target'>;
}
/** Host viewers by artifact type or file kind (`canvas`, or any other). They take precedence over the built-in ones. */
export type CustomViewers = Readonly<Record<string, (props: CustomViewerProps) => ReactNode>>;

/** Everything a viewer in the panel reads through: one resource client, the version history, host viewers and policy. */
export interface ViewerOptions {
  readonly client: ResourceClient;
  readonly identity: ResourceIdentity;
  readonly history?: ((path: string) => Promise<readonly SavedRevision[]>) | undefined;
  readonly viewers?: CustomViewers | undefined;
  /** The host's opt-in to running HTML pages in the sandboxed preview. */
  readonly interactive?: InteractiveHtml | undefined;
  readonly share?: ViewerShare | undefined;
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
  readonly items: readonly { readonly id: string; readonly label: string; readonly latest: boolean }[];
  readonly current: string;
  /** Position counted from the oldest retained revision: only a test hook. */
  readonly number: number | undefined;
  readonly savedAt: number | undefined;
}

/** The version menu, newest first: each retained revision is named by when it was saved, and the newest is "Latest". The pin is the revision. */
function versionMenu(artifact: ArtifactDescriptor, follow: boolean, revisions: readonly SavedRevision[], earlier: string): VersionMenu {
  const at = follow ? 0 : revisions.findIndex(save => save.revision === artifact.revision);
  const shown = at < 0 ? undefined : revisions[at];
  return { items: revisions.map((save, index) => ({ id: index === 0 ? 'latest' : save.revision, label: savedLabel(save.savedAt, Date.now(), earlier), latest: index === 0 })),
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
      ? <div className="boring-viewer-checker flex min-h-0 flex-1 items-center justify-center overflow-auto bg-white p-6"><img data-testid="artifact-svg" src={url} alt={title} className="max-h-full max-w-full" /></div>
      : <div className="min-h-0 flex-1 overflow-auto p-3"><CodeBlock code={text} language="svg" /></div>}
  </ViewerFrame>;
}

type DocumentController = MarkdownController | HtmlController;

/** One artifact version's frame and body. Mounted per resource and revision, so switching version starts clean. */
function Version({ artifact, pinned, menu, options, onSelect, onClose }: {
  readonly artifact: ArtifactDescriptor; readonly pinned: boolean; readonly menu: VersionMenu; readonly options: ViewerOptions;
  readonly onSelect: (value: string) => void; readonly onClose: () => void;
}) {
  const { type } = artifact;
  const { client, identity } = options;
  const { labels } = useAppText();
  const path = artifact.target.resource.path;
  const custom = options.viewers?.[type];
  const create = useMemo(() => {
    const base = (snapshot: ResourceSnapshot) => ({ identity, client, instanceId: randomUUID(), epoch: 'workspace', source: { kind: 'saved' as const, snapshot } });
    if (custom) return undefined;
    if (type === 'markdown') return (snapshot: ResourceSnapshot): DocumentController => createMarkdownController({ ...base(snapshot), readOnly: pinned });
    if (type === 'html') return (snapshot: ResourceSnapshot): DocumentController => createHtmlController({ ...base(snapshot), readOnly: true });
    return undefined;
  }, [type, pinned, client, identity, custom]);
  const saved = useSaved<DocumentController>({ client, target: artifact.target, revision: pinned ? artifact.revision : undefined, create });
  const controller = saved.controller;
  // The text to copy and download is the buffer when a viewer holds one, so the person's unsaved edits are included.
  const text = useSyncExternalStore(controller ? controller.subscribe : NOOP, () => controller ? controller.getSnapshot().text : saved.text, () => saved.text);
  const extension = EXTENSION.exec(path)?.[1] ?? 'txt';
  const revision = saved.kind === 'open' ? saved.snapshot.ref.revision : pinned ? artifact.revision : undefined;
  // The history menu: newest first, the newest marked "Latest" (choosing it follows the latest), the one on display checked.
  const versions = menu.items.length > 1 ? <ViewerVersions testId="artifact-versions" current={menu.current} onSelect={onSelect} versions={menu.items} /> : undefined;
  const target = { artifact: artifactKey(artifact), version: pinned ? artifact.revision : 'latest' };
  const frame = {
    title: artifact.title, testId: 'artifact', titleTestId: 'artifact-panel-title', controls: versions, onClose, target, ...(revision === undefined ? {} : { revision }), ...(options.share ? { onShare: options.share } : {}),
    subtitle: <>
      <span data-testid="artifact-panel-type">{typeLabel(artifact)}</span>
      <span aria-hidden="true">·</span>
      <span data-testid="artifact-panel-version">{pinned ? (menu.savedAt !== undefined ? labels.savedAt(savedLabel(menu.savedAt, Date.now(), labels.earlierVersion)) : labels.olderVersion) : menu.savedAt ? labels.latestSavedAt(savedLabel(menu.savedAt, Date.now(), labels.earlierVersion)) : labels.latest}</span>
    </>,
    ...(pinned ? { status: { label: labels.readOnly, kind: 'read-only' as const } } : {}),
  };
  const filename = `${artifact.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'artifact'}.${extension}`;
  const body = (children: ReactNode) => <div data-testid="artifact-body" data-state={saved.kind} className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">{children}</div>;
  if (custom) return body(custom({ target: artifact.target, title: artifact.title, ...(pinned ? { revision: artifact.revision } : {}), frame: { testId: 'artifact', titleTestId: 'artifact-panel-title', controls: versions, onClose, target } }));
  // Until the version is open the bar offers no Share: the pane that shows it brings its own frame, so this one is replaced (remounted)
  // when it opens, and a Share pressed just then would copy the link with its "Link copied" notice lost with the old frame.
  if (saved.kind !== 'open') {
    const { onShare: _, ...waiting } = frame;
    return body(<ViewerFrame {...waiting}><p className="m-0 p-4 text-sm text-muted-foreground" role="status">{saved.kind === 'loading' ? labels.loading : saved.kind === 'invalid' ? labels.artifactNotText : labels.versionUnavailable}</p></ViewerFrame>);
  }
  const document = (children: ReactNode) => <div data-testid="document" data-revision={saved.snapshot.ref.revision} className="h-full min-h-0">{children}</div>;
  if (type === 'markdown' && controller) return body(document(<MarkdownPane controller={controller as MarkdownController} initialMode="rich" {...frame} />));
  if (type === 'html' && controller) return body(document(<HtmlPane controller={controller as HtmlController} {...(options.interactive ? { interactive: options.interactive } : {})} {...frame} />));
  const actions = { onCopy: () => copyText(text ?? ''), onDownload: () => downloadFile(filename, text ?? '', `${artifact.mediaType};charset=utf-8`) };
  if (type === 'svg') return body(<SvgView text={saved.text} title={artifact.title} frame={{ ...frame, ...actions }} />);
  if (type === 'canvas') return body(<ViewerFrame {...frame}><p className="m-0 p-4 text-sm text-muted-foreground" role="status">{labels.noCanvasViewer}</p></ViewerFrame>);
  return body(<ViewerFrame {...frame} {...actions}><div className="min-h-0 flex-1 overflow-auto p-3"><CodeBlock code={saved.text} language={artifact.language ?? 'text'} /></div></ViewerFrame>);
}

/**
 * One artifact in the panel. `active.follow` shows the latest saved revision under the newest known title (`versions`: every version of
 * this file the conversation presented or saved, newest first); otherwise the one revision in `active.descriptor` is pinned and read-only.
 * `onSelect` receives `latest` or a revision from the version menu.
 */
export function ArtifactPanel({ active, versions, options, onSelect, onClose }: {
  readonly active: { readonly descriptor: ArtifactDescriptor; readonly follow: boolean };
  readonly versions: readonly ArtifactDescriptor[];
  readonly options: ViewerOptions;
  readonly onSelect: (value: string) => void;
  readonly onClose: () => void;
}) {
  const { follow } = active;
  const artifact = follow ? versions[0] ?? active.descriptor : active.descriptor;
  const path = artifact.target.resource.path;
  const revisions = useHistory(options.history, path);
  const { labels } = useAppText();
  const menu = versionMenu(artifact, follow, revisions, labels.earlierVersion);
  return <div data-testid="artifact-panel" data-artifact-id={artifactKey(artifact)} data-artifact-type={artifact.type} data-follow={follow ? 'true' : 'false'} data-artifact-position={menu.number} data-artifact-revision={follow ? undefined : artifact.revision}
    className="pi-chat flex h-full min-h-0 flex-col">
    <Version key={`${path}@${follow ? 'latest' : artifact.revision}`} artifact={artifact} pinned={!follow} menu={menu} options={options} onSelect={onSelect} onClose={onClose} />
  </div>;
}
