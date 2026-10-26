'use client';

// Opens one workspace file in the viewer its kind names (`ViewerOptions.kinds`), always in the standard viewer frame (viewer-frame item):
// Markdown and HTML in their editors (revisioned through the host's resource client, so saves go back to the file and an edit made behind
// the editor's back is a conflict), images and PDFs read-only from the file's bytes, a drawing kind in the artifact panel, anything else as
// text. Each viewer loads the first time its kind opens. A host viewer (`viewers[kind]`) wins over a document kind.
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { DownloadIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { randomUUID } from '@hachej/boring-files/platform';
import type { ResourceLocator, ResourceSnapshot } from '@hachej/boring-files';
import { createMarkdownController } from '@hachej/boring-ui-kit/markdown';
import type { MarkdownController } from '@hachej/boring-ui-kit/markdown';
import { createHtmlController } from '@hachej/boring-ui-kit/html';
import type { HtmlController } from '@hachej/boring-ui-kit/html';
import { ViewerFrame } from '../viewer-frame/viewer-frame';
import { downloadFile } from '../viewer-frame/download';
import { formatBytes } from '../viewer-frame/media';
import { copyText } from '../utils/utils';
import { mediaTypeOf, viewerKindOf } from '@hachej/boring-files/file-types';
import { isBlobPointerPath, resolveBlobPointer } from '@hachej/boring-files/blob';
import type { BlobItem } from '@hachej/boring-files/blob';
import type { ViewerKind as FileKind } from '@hachej/boring-files/file-types';
import { KIND_LABEL, decodeText } from './file-kinds';
import { ArtifactPanel, useReportShown } from './artifact-panel';
import { artifactKind } from '../pi-artifacts/artifact';
import type { ArtifactDescriptor, ArtifactType } from '../pi-artifacts/artifact';
import { Mounted, ViewLoading, drawsText, isEditorKind, isMediaKind, lazyView, noKinds } from './viewer-kinds';
import type { EditorKind, MediaKind, PanelKind } from './viewer-kinds';
import type { ViewerOptions } from './artifact-panel';
import { useSaved } from './use-saved';
import { useAppText } from './app-labels';

const POLL_MS = 1500;
const nameOf = (path: string) => path.split('/').pop() || path;

interface Common {
  readonly path: string;
  readonly kind: FileKind;
  readonly locator: ResourceLocator;
  readonly options: ViewerOptions;
  readonly onClose: () => void;
  readonly back: ReactNode;
  readonly onUnsavedChange?: ((unsaved: boolean) => void) | undefined;
  readonly onBeforeLeaveChange?: ((flush: (() => Promise<boolean>) | null) => void) | undefined;
}

const FILE_TYPE: Partial<Record<FileKind, ArtifactType>> = { markdown: 'markdown', html: 'html' };
/** A file as the artifact its kind sees: the same descriptor a `present` of it would carry, so one kind match serves every way of opening a file. */
const fileArtifact = (path: string, locator: ResourceLocator): ArtifactDescriptor => ({ schema: 'boring.artifact', version: 1, title: nameOf(path), type: FILE_TYPE[viewerKindOf(path)] ?? 'code', mediaType: mediaTypeOf(path), target: locator, revision: 'latest' });
/** The image or PDF kind of a media type (a file's, or a large file's behind a pointer). */
const mediaKindOf = (kinds: readonly PanelKind[], artifact: ArtifactDescriptor): MediaKind | undefined => artifactKind(artifact, kinds.filter(isMediaKind));

const subtitleOf = (locator: ResourceLocator) => <span data-testid="file-path" className="truncate">{locator.resource.path}</span>;

/** Markdown or HTML: a revisioned controller over the file. A new revision remounts the pane; it starts in the mode the person chose. */
function FileDocument({ path, editor, locator, options, onClose, back, onUnsavedChange, onBeforeLeaveChange }: Common & { readonly editor: EditorKind }) {
  const { client, identity } = options;
  const markdown = editor.editor === 'markdown';
  const create = useMemo(() => (snapshot: ResourceSnapshot): MarkdownController | HtmlController => (markdown ? createMarkdownController : createHtmlController)({
    identity, client, instanceId: randomUUID(), epoch: 'workspace', source: { kind: 'saved', snapshot } }), [markdown, client, identity]);
  const autosave = useRef<{ controller: MarkdownController | HtmlController; flush: () => Promise<boolean> } | null>(null);
  const saved = useSaved({ client, target: locator, create, beforeDispose: controller => autosave.current?.controller === controller ? autosave.current.flush() : undefined });
  const registerAutosave = useCallback((flush: (() => Promise<boolean>) | null) => {
    autosave.current = flush && saved.controller ? { controller: saved.controller, flush } : null;
  }, [saved.controller]);
  useLayoutEffect(() => {
    const controller = saved.controller;
    if (!controller) return;
    const notify = () => {
      const snapshot = controller.getSnapshot();
      onUnsavedChange?.(snapshot.dirty || snapshot.save.kind === 'pending'
        || (snapshot.save.kind === 'settled' && snapshot.save.result.kind === 'unknown'));
    };
    notify();
    const unsubscribe = controller.subscribe(notify);
    return () => { unsubscribe(); onUnsavedChange?.(false); };
  }, [saved.controller, onUnsavedChange]);
  const { labels } = useAppText();
  const [mode, setMode] = useState<string>(markdown ? 'rich' : 'preview');
  const [formattingToolbar, setFormattingToolbar] = useState<'selection' | 'pinned'>('selection');
  // The editor loads the first time a document opens: the file counts as shown once it has mounted.
  const [mounted, setMounted] = useState<string>();
  const opened = saved.kind === 'open' && saved.controller ? saved.snapshot.ref.revision : undefined;
  useReportShown(options.onShown, path, opened !== undefined && mounted === opened ? opened : undefined);
  const common = { title: nameOf(path), subtitle: subtitleOf(locator), target: { file: path }, onClose, titleTestId: 'file-title', headerStart: back, ...(options.share ? { onShare: options.share } : {}) };
  // Until the document is open the bar offers no Share, Copy or menu actions of its own: they would act on a document that is not shown.
  if (saved.kind !== 'open' || !saved.controller) {
    return <ViewerFrame title={common.title} subtitle={common.subtitle} onClose={onClose} headerStart={back}>
      <p role="status" className="m-0 p-4 text-sm text-muted-foreground">{saved.kind === 'loading' ? labels.loading : saved.kind === 'missing' ? labels.fileMissing : labels.fileNotText}</p>
    </ViewerFrame>;
  }
  const revision = saved.snapshot.ref.revision;
  // The preview selector the journeys use keeps working: the wrapper holds the document's text.
  let pane: ReactNode;
  if (editor.editor === 'markdown') {
    const MarkdownPane = lazyView(editor.load);
    pane = <MarkdownPane key={revision} controller={saved.controller as MarkdownController} revision={revision} initialMode={mode as 'rich'} onModeChange={setMode} formattingToolbar={formattingToolbar} onFormattingToolbarChange={setFormattingToolbar} onAutosaveChange={registerAutosave} onBeforeLeaveChange={onBeforeLeaveChange} {...common} />;
  } else {
    const HtmlPane = lazyView(editor.load);
    pane = <HtmlPane key={revision} controller={saved.controller as HtmlController} revision={revision} initialMode={mode as 'preview'} onModeChange={setMode} {...(options.interactive ? { interactive: options.interactive } : {})} {...common} />;
  }
  return <div data-testid="file-preview" className="h-full min-h-0" data-revision={revision}>
    <Suspense fallback={<ViewerFrame testId="viewer-pending" title={common.title} subtitle={common.subtitle} onClose={onClose} headerStart={back}><ViewLoading label={labels.loading} /></ViewerFrame>}>
      {pane}<Mounted value={revision} onMount={setMounted} />
    </Suspense>
  </div>;
}

/** Native controls only. A failed codec leaves a download instead of a broken video box. */
function VideoPreview({ item }: { readonly item: BlobItem }) {
  const [failed, setFailed] = useState(false);
  const { labels } = useAppText();
  return <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center">
    {failed ? <div className="flex flex-col items-center gap-3 p-4">
      <p role="status" data-testid="video-unplayable" className="text-muted-foreground">{labels.videoUnreadable}</p>
      <Button nativeButton={false} render={<a href={item.url} download={item.name} />} data-testid="video-download">{labels.download}</Button>
    </div> : <video src={item.url} aria-label={item.name} controls playsInline preload="metadata" onError={() => setFailed(true)} className="h-full max-h-full w-full min-w-0 object-contain" />}
  </div>;
}

/**
 * A large file behind a pointer, from the host's URL: images, PDFs and videos inline, anything else as a download.
 * The viewers get a URL; none reads the media bytes into the page.
 */
function BlobFile({ item, subtitle, media, ...common }: { readonly item: BlobItem; readonly subtitle: ReactNode; readonly media: MediaKind | undefined; readonly onClose: () => void; readonly onRefresh: () => unknown; readonly target: unknown; readonly titleTestId: string; readonly headerStart: ReactNode; readonly onShare?: NonNullable<ViewerOptions['share']> }) {
  const { labels } = useAppText();
  const details = <>{subtitle}<span aria-hidden="true">·</span><span>{formatBytes(item.size)}</span></>;
  if (media?.media === 'image') { const ImagePane = lazyView(media.load); return <ImagePane name={item.name} mediaType={item.type} url={item.url} subtitle={details} {...common} />; }
  if (media?.media === 'pdf') { const PdfPane = lazyView(media.load); return <PdfPane name={item.name} url={item.url} subtitle={subtitle} {...common} />; }
  if (item.type.startsWith('video/')) return <ViewerFrame title={item.name} subtitle={details} {...common} onDownload={() => {
    const link = Object.assign(document.createElement('a'), { href: item.url, download: item.name });
    document.body.append(link); link.click(); link.remove();
  }}><VideoPreview key={item.url} item={item} /></ViewerFrame>;
  return <ViewerFrame title={item.name} subtitle={details} {...common}>
    <div data-testid="blob-file" data-blob-type={item.type} className="m-auto flex flex-col items-center gap-3 p-6 text-center">
      <p className="m-0 text-sm text-muted-foreground">{item.type}</p>
      <Button nativeButton={false} render={<a href={item.url} download={item.name} />} data-testid="blob-download"><DownloadIcon data-icon="inline-start" aria-hidden="true" />{labels.download}</Button>
    </div>
  </ViewerFrame>;
}

type Loaded = { readonly kind: 'loading' | 'missing' } | { readonly kind: 'ready'; readonly bytes: Uint8Array; readonly revision: string; readonly text: string | undefined };

/** Image, PDF and text files: read through the resource client, refreshed on demand (and followed while open, for text). */
function FileBytes({ path, kind, locator, options, onClose, back, media }: Common & { readonly media: MediaKind | undefined }) {
  const { labels } = useAppText();
  // An image or PDF pane loads the first time one opens: the file counts as shown once it has mounted.
  const [mounted, setMounted] = useState<string>();
  const targetKey = JSON.stringify(locator);
  const binding = useMemo(() => ({ client: options.client, locator, path }), [options.client, targetKey, path]); // eslint-disable-line react-hooks/exhaustive-deps
  const [stored, setStored] = useState<{ readonly binding: typeof binding; readonly value: Loaded }>();
  const file: Loaded = stored?.binding === binding ? stored.value : { kind: 'loading' };
  const running = useRef<AbortController | undefined>(undefined);
  const load = useCallback(async () => {
    running.current?.abort();
    const abort = new AbortController(); running.current = abort;
    try {
      const read = await binding.client.read({ target: binding.locator, revision: { kind: 'latest' } }, abort.signal);
      if (abort.signal.aborted || running.current !== abort) return;
      if (read.kind !== 'available') {
        setStored(current => current?.binding === binding && current.value.kind === 'ready' ? current : { binding, value: { kind: 'missing' } });
        return;
      }
      const { bytes, ref } = read.snapshot;
      setStored({ binding, value: { kind: 'ready', bytes, revision: ref.revision, text: decodeText(binding.path, bytes) } });
    } catch {
      if (!abort.signal.aborted && running.current === abort) setStored(current => current?.binding === binding && current.value.kind === 'ready' ? current : { binding, value: { kind: 'missing' } });
    }
  }, [binding]);
  useEffect(() => {
    void load();
    const timer = kind === 'text' ? setInterval(() => { void load(); }, POLL_MS) : undefined;
    return () => { running.current?.abort(); clearInterval(timer); };
  }, [load, kind]);
  // A pointer file is resolved here, where it is read, once per read: the viewers below receive the item, never the pointer.
  const blob = useMemo(() => file.kind === 'ready' && isBlobPointerPath(path) ? resolveBlobPointer(file.bytes, options.blobBase) : undefined, [file, path, options.blobBase]);
  // A lazily loaded pane (an image, a PDF, a large file's viewer) counts as shown once it has mounted; the text view at once.
  const lazyPane = blob?.kind === 'blob' || !blob && !!media;
  useReportShown(options.onShown, path, file.kind === 'ready' && (!lazyPane || mounted === file.revision) ? file.revision : undefined);
  const common = { subtitle: subtitleOf(locator), target: { file: path }, onClose, titleTestId: 'file-title', headerStart: back, ...(options.share ? { onShare: options.share } : {}) };
  // Until the file is read the bar offers no Share: the image and PDF panes bring their own frame, so this one is replaced (remounted)
  // when the bytes arrive, and a Share pressed just then would copy the link with its "Link copied" notice lost with the old frame.
  if (file.kind !== 'ready') {
    return <ViewerFrame title={nameOf(path)} subtitle={common.subtitle} onClose={onClose} titleTestId="file-title" headerStart={back}>
      <p role="status" className="m-0 p-4 text-sm text-muted-foreground">{file.kind === 'loading' ? labels.loading : labels.fileMissing}</p>
    </ViewerFrame>;
  }
  // The bar while a view loads: `viewer-pending-*` test ids, so `viewer-more` is the view's own menu.
  const loading = <ViewerFrame testId="viewer-pending" title={nameOf(path)} subtitle={common.subtitle} onClose={onClose} titleTestId="file-title" headerStart={back}><ViewLoading label={labels.loading} /></ViewerFrame>;
  const shown = <Mounted value={file.revision} onMount={setMounted} />;
  if (blob?.kind === 'blob') {
    const blobMedia = mediaKindOf(options.kinds ?? noKinds, { ...fileArtifact(path, locator), mediaType: blob.item.type });
    return <Suspense fallback={loading}><BlobFile item={blob.item} media={blobMedia} onRefresh={load} {...common} />{shown}</Suspense>;
  }
  if (media?.media === 'image') { const ImagePane = lazyView(media.load); return <Suspense fallback={loading}><ImagePane name={nameOf(path)} mediaType={mediaTypeOf(path)} bytes={file.bytes} onRefresh={load} {...common} />{shown}</Suspense>; }
  if (media?.media === 'pdf') { const PdfPane = lazyView(media.load); return <Suspense fallback={loading}><PdfPane name={nameOf(path)} bytes={file.bytes} onRefresh={load} {...common} />{shown}</Suspense>; }
  const { text } = file, size = file.bytes.byteLength;
  return <ViewerFrame title={nameOf(path)} {...common} subtitle={<>{subtitleOf(locator)}<span aria-hidden="true">·</span><span>{formatBytes(size)}</span></>}
    onRefresh={load} {...(text === undefined ? {} : { onCopy: () => copyText(text), onDownload: () => downloadFile(nameOf(path), text, 'text/plain;charset=utf-8') })}>
    {blob?.kind === 'unsupported-version' && <p role="note" data-testid="blob-newer-format" className="m-0 px-3 pt-3 text-sm text-muted-foreground">{labels.newerBlobFormat}</p>}
    {text === undefined
      ? <p role="status" className="m-0 p-4 text-sm text-muted-foreground">{labels.binaryFile(formatBytes(size))}</p>
      : <div className="min-h-0 flex-1 overflow-auto p-3"><pre data-testid="file-preview" className="m-0 font-mono text-sm leading-relaxed break-words whitespace-pre-wrap">{text}</pre></div>}
  </ViewerFrame>;
}

/**
 * One file in the panel. `path` is the host's name for it (shown in the share target and `data-path`); `locator` is the resource the
 * client reads. Remount per file with a `key`. `onBack` adds a back button to the bar (for example to the host's file list).
 */
export function FileViewer({ path, locator, options, onClose, onBack, backLabel, onUnsavedChange, onBeforeLeaveChange }: {
  readonly path: string;
  readonly locator: ResourceLocator;
  readonly options: ViewerOptions;
  readonly onClose: () => void;
  readonly onBack?: (() => void) | undefined;
  readonly backLabel?: string | undefined;
  /** Built-in editable viewers report unsaved and unconfirmed changes for navigation guards. */
  readonly onUnsavedChange?: ((unsaved: boolean) => void) | undefined;
  /** The Markdown autosave barrier, for flush-before-navigation guards. Null for explicit-save viewers. */
  readonly onBeforeLeaveChange?: ((flush: (() => Promise<boolean>) | null) => void) | undefined;
}) {
  const kind = viewerKindOf(path);
  const { labels, icons } = useAppText();
  const back = onBack ? <Button variant="ghost" size="sm" data-testid="file-back" aria-label={backLabel ?? labels.back} title={backLabel ?? labels.back} onClick={onBack} className="shrink-0"><icons.back data-icon="inline-start" aria-hidden="true" /><span className="max-sm:sr-only">{backLabel ?? labels.back}</span></Button> : undefined;
  const common: Common = { path, kind, locator, options, onClose, back, onUnsavedChange, onBeforeLeaveChange };
  const locatorKey = JSON.stringify(locator);
  const artifact = useMemo(() => fileArtifact(path, locator), [path, locatorKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // One resolution through the kinds, whoever opened the file: a host viewer for the file kind wins over a document kind (a `fallback`
  // one), not over any other kind. A drawing kind (a maquette, a diagram, an app's) shows the file in the artifact panel.
  const kinds = options.kinds ?? noKinds;
  const found = artifactKind(artifact, kinds.filter(entry => drawsText(entry) || isMediaKind(entry)));
  const custom = found && !found.fallback ? undefined : options.viewers?.[kind];
  const resolved = custom ? undefined : found;
  const drawn = resolved && !isEditorKind(resolved) && !isMediaKind(resolved) ? artifact : undefined;
  if (drawn) return <div data-testid="file-viewer" data-kind="artifact" data-path={path} aria-label={labels.fileViewer(drawn.title)} className="flex h-full min-h-0 flex-col overflow-hidden [&>*]:min-h-0 [&>*]:flex-1">
    <ArtifactPanel active={{ descriptor: drawn, follow: true }} versions={[]} options={options} onSelect={() => {}} onClose={onClose} headerStart={back} />
  </div>;
  return <div data-testid="file-viewer" data-kind={kind} data-path={path} aria-label={labels.fileViewer(KIND_LABEL[kind])} className="flex h-full min-h-0 flex-col overflow-hidden [&>*]:min-h-0 [&>*]:flex-1">
    {custom ? custom({ target: locator, title: nameOf(path), frame: { titleTestId: 'file-title', onClose, target: { file: path }, headerStart: back } })
      : isEditorKind(resolved) ? <FileDocument {...common} editor={resolved} />
      // The resource client supplies bytes, not a streaming URL. Unlike images, videos must not be buffered to make an object URL.
      : kind === 'video' ? <ViewerFrame title={nameOf(path)} subtitle={subtitleOf(locator)} onClose={onClose} headerStart={back}><p role="status" className="m-0 p-4 text-sm text-muted-foreground">{labels.fileNotText}</p></ViewerFrame>
      : kind === 'canvas' ? <ViewerFrame title={nameOf(path)} subtitle={subtitleOf(locator)} onClose={onClose} headerStart={back}><p role="status" className="m-0 p-4 text-sm text-muted-foreground">{labels.noCanvasViewer}</p></ViewerFrame>
      : <FileBytes {...common} media={isMediaKind(resolved) ? resolved : undefined} />}
  </div>;
}
