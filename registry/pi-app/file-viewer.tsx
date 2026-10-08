'use client';

// Opens one workspace file in the viewer that suits its type, always in the standard viewer frame (viewers item): Markdown and HTML in
// their editors (revisioned through the host's resource client, so saves go back to the file and an edit made behind the editor's back is
// a conflict), images and PDFs read-only from the file's bytes, anything else as text. A host viewer (`viewers[kind]`) takes precedence.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { randomUUID } from '@hachej/boring-files/platform';
import type { ResourceLocator, ResourceSnapshot } from '@hachej/boring-files';
import { createMarkdownController } from '@hachej/boring-ui-kit/markdown';
import type { MarkdownController } from '@hachej/boring-ui-kit/markdown';
import { createHtmlController } from '@hachej/boring-ui-kit/html';
import type { HtmlController } from '@hachej/boring-ui-kit/html';
import { HtmlPane } from '../viewers/html-pane';
import { ImagePane } from '../viewers/image-pane';
import { MarkdownPane } from '../viewers/markdown-pane';
import { PdfPane } from '../viewers/pdf-pane';
import { ViewerFrame } from '../viewers/viewer-frame';
import { downloadFile } from '../viewers/download';
import { formatBytes } from '../viewers/media';
import { copyText } from '../utils/utils';
import { KIND_LABEL, decodeText, kindOf, mediaTypeOf } from './file-kinds';
import type { FileKind } from './file-kinds';
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
}

const subtitleOf = (locator: ResourceLocator) => <span data-testid="file-path" className="truncate">{locator.resource.path}</span>;

/** Markdown or HTML: a revisioned controller over the file. A new revision remounts the pane; it starts in the mode the person chose. */
function FileDocument({ path, kind, locator, options, onClose, back }: Common) {
  const { client, identity } = options;
  const create = useMemo(() => (snapshot: ResourceSnapshot): MarkdownController | HtmlController => (kind === 'markdown' ? createMarkdownController : createHtmlController)({
    identity, client, instanceId: randomUUID(), epoch: 'workspace', source: { kind: 'saved', snapshot } }), [kind, client, identity]);
  const saved = useSaved({ client, target: locator, create });
  const { labels } = useAppText();
  const [mode, setMode] = useState<string>(kind === 'markdown' ? 'rich' : 'preview');
  const common = { title: nameOf(path), subtitle: subtitleOf(locator), target: { file: path }, onClose, titleTestId: 'file-title', controls: back, ...(options.share ? { onShare: options.share } : {}) };
  // Until the document is open the bar offers no Share, Copy or menu actions of its own: they would act on a document that is not shown.
  if (saved.kind !== 'open' || !saved.controller) {
    return <ViewerFrame title={common.title} subtitle={common.subtitle} onClose={onClose} controls={back}>
      <p role="status" className="m-0 p-4 text-sm text-muted-foreground">{saved.kind === 'loading' ? labels.loading : saved.kind === 'missing' ? labels.fileMissing : labels.fileNotText}</p>
    </ViewerFrame>;
  }
  const revision = saved.snapshot.ref.revision;
  // The preview selector the journeys use keeps working: the wrapper holds the document's text.
  return <div data-testid="file-preview" className="h-full min-h-0" data-revision={revision}>
    {kind === 'markdown'
      ? <MarkdownPane key={revision} controller={saved.controller as MarkdownController} revision={revision} initialMode={mode as 'rich'} onModeChange={setMode} {...common} />
      : <HtmlPane key={revision} controller={saved.controller as HtmlController} revision={revision} initialMode={mode as 'preview'} onModeChange={setMode} {...(options.interactive ? { interactive: options.interactive } : {})} {...common} />}
  </div>;
}

type Loaded = { readonly kind: 'loading' | 'missing' } | { readonly kind: 'ready'; readonly bytes: Uint8Array; readonly revision: string; readonly text: string | undefined };

/** Image, PDF and text files: read through the resource client, refreshed on demand (and followed while open, for text). */
function FileBytes({ path, kind, locator, options, onClose, back }: Common) {
  const { labels } = useAppText();
  const [file, setFile] = useState<Loaded>({ kind: 'loading' });
  const held = useRef(file);
  held.current = file;
  const load = useCallback(async () => {
    const read = await options.client.read({ target: locator, revision: { kind: 'latest' } });
    if (read.kind !== 'available') { if (held.current.kind === 'loading') setFile({ kind: 'missing' }); return; }
    const { bytes, ref } = read.snapshot;
    setFile(current => current.kind === 'ready' && current.revision === ref.revision ? current : { kind: 'ready', bytes, revision: ref.revision, text: decodeText(path, bytes) });
  }, [options.client, locator, path]);
  useEffect(() => {
    let cancelled = false;
    const run = () => load().catch(() => { if (!cancelled && held.current.kind === 'loading') setFile({ kind: 'missing' }); });
    void run();
    // Text follows the workspace while open; media is read again when the person presses Refresh.
    const timer = kind === 'text' ? setInterval(run, POLL_MS) : undefined;
    return () => { cancelled = true; clearInterval(timer); };
  }, [load, kind]);
  const common = { subtitle: subtitleOf(locator), target: { file: path }, onClose, titleTestId: 'file-title', controls: back, ...(options.share ? { onShare: options.share } : {}) };
  // Until the file is read the bar offers no Share: the image and PDF panes bring their own frame, so this one is replaced (remounted)
  // when the bytes arrive, and a Share pressed just then would copy the link with its "Link copied" notice lost with the old frame.
  if (file.kind !== 'ready') {
    return <ViewerFrame title={nameOf(path)} subtitle={common.subtitle} onClose={onClose} titleTestId="file-title" controls={back}>
      <p role="status" className="m-0 p-4 text-sm text-muted-foreground">{file.kind === 'loading' ? labels.loading : labels.fileMissing}</p>
    </ViewerFrame>;
  }
  if (kind === 'image') return <ImagePane name={nameOf(path)} mediaType={mediaTypeOf(path)} bytes={file.bytes} onRefresh={load} {...common} />;
  if (kind === 'pdf') return <PdfPane name={nameOf(path)} bytes={file.bytes} onRefresh={load} {...common} />;
  const { text } = file, size = file.bytes.byteLength;
  return <ViewerFrame title={nameOf(path)} {...common} subtitle={<>{subtitleOf(locator)}<span aria-hidden="true">·</span><span>{formatBytes(size)}</span></>}
    onRefresh={load} {...(text === undefined ? {} : { onCopy: () => copyText(text), onDownload: () => downloadFile(nameOf(path), text, 'text/plain;charset=utf-8') })}>
    {text === undefined
      ? <p role="status" className="m-0 p-4 text-sm text-muted-foreground">{labels.binaryFile(formatBytes(size))}</p>
      : <div className="min-h-0 flex-1 overflow-auto p-3"><pre data-testid="file-preview" className="m-0 rounded-lg bg-muted p-3 font-mono text-[13px] leading-relaxed break-words whitespace-pre-wrap">{text}</pre></div>}
  </ViewerFrame>;
}

/**
 * One file in the panel. `path` is the host's name for it (shown in the share target and `data-path`); `locator` is the resource the
 * client reads. Remount per file with a `key`. `onBack` adds a back button to the bar (for example to the host's file list).
 */
export function FileViewer({ path, locator, options, onClose, onBack, backLabel }: {
  readonly path: string;
  readonly locator: ResourceLocator;
  readonly options: ViewerOptions;
  readonly onClose: () => void;
  readonly onBack?: (() => void) | undefined;
  readonly backLabel?: string | undefined;
}) {
  const kind = kindOf(path);
  const { labels, icons } = useAppText();
  const back = onBack ? <button type="button" data-testid="file-back" onClick={onBack} className="inline-flex h-10 cursor-pointer items-center gap-1 rounded-lg border border-border bg-background px-2 text-sm md:h-8 md:text-xs"><icons.back className="size-3.5" aria-hidden="true" />{backLabel ?? labels.back}</button> : undefined;
  const custom = options.viewers?.[kind];
  const common: Common = { path, kind, locator, options, onClose, back };
  return <div data-testid="file-viewer" data-kind={kind} data-path={path} aria-label={labels.fileViewer(KIND_LABEL[kind])} className="flex h-full min-h-0 flex-col overflow-hidden [&>*]:min-h-0 [&>*]:flex-1">
    {custom ? custom({ target: locator, title: nameOf(path), frame: { titleTestId: 'file-title', onClose, target: { file: path }, controls: back } })
      : kind === 'markdown' || kind === 'html' ? <FileDocument {...common} />
      : kind === 'canvas' ? <ViewerFrame title={nameOf(path)} subtitle={subtitleOf(locator)} onClose={onClose} controls={back}><p role="status" className="m-0 p-4 text-sm text-muted-foreground">{labels.noCanvasViewer}</p></ViewerFrame>
      : <FileBytes {...common} />}
  </div>;
}
