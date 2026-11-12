'use client';

import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { mediaTypeOf } from '@hachej/boring-files/file-types';
import { downloadFile } from '../viewer-frame/download';
import { IMAGE_TYPES, ImagePane } from '../viewer-image/image-pane';
import { formatBytes } from '../viewer-frame/media';
import { PdfPane } from './pdf-pane';
import { ViewerFrame } from '../viewer-frame/viewer-frame';
import type { ViewerFrameProps } from '../viewer-frame/viewer-frame';
import { useViewerText } from '../viewer-frame/viewer-window';

export interface LocalFileViewerProps extends Pick<ViewerFrameProps, 'subtitle' | 'headerStart' | 'controls' | 'onClose' | 'testId' | 'titleTestId' | 'className'> {
  readonly name: string;
  /** Browser-only bytes. Nothing is uploaded or retained on reload. A File is also a Blob. */
  readonly blob: Blob;
  /**
   * Views for text the name or type says more about, in order (the first match wins): the viewer-code item's `csvKind` draws a CSV as a table,
   * a host's Markdown reader a note. They match as the panel's kinds do, on `{ type, language }` (`markdown`, `html`, `svg`, else `code` with the
   * file's extension as its language). Without one, text stays literal, HTML included.
   */
  readonly kinds?: readonly LocalTextKind[] | undefined;
}

/** A view of a text file's content: structurally the code kinds of viewer-code (`csvKind`, `svgKind`). */
export interface LocalTextKind {
  readonly match: (target: { readonly resource: { readonly path: string } }, artifact: { readonly type: string; readonly language?: string | undefined }) => boolean;
  readonly load: () => Promise<{ readonly default: ComponentType<{ readonly text: string; readonly artifact: { readonly title: string } }> }>;
}

/** The frame props a caller gave, without the ones it left undefined (the panes take each prop or none). */
const defined = <T extends object>(value: T) => Object.fromEntries(Object.entries(value).filter(entry => entry[1] !== undefined)) as { [K in keyof T]?: Exclude<T[K], undefined> };

const TEXT_TYPE: Readonly<Record<string, string>> = { 'text/markdown': 'markdown', 'text/html': 'html', 'image/svg+xml': 'svg' };
/** The file as the kinds see it: its type, and for code its extension as the language. */
const textArtifact = (name: string, mediaType: string) => ({ type: TEXT_TYPE[mediaType] ?? 'code', language: name.split('.').pop()?.toLowerCase() });
const views = new WeakMap<LocalTextKind['load'], ComponentType<{ readonly text: string; readonly artifact: { readonly title: string } }>>();
/** A kind's view as an element, one lazy component per loader, so a kind seen again never re-suspends. */
function kindElement(load: LocalTextKind['load'], text: string, title: string): ReactNode {
  let View = views.get(load);
  if (!View) { View = lazy(load); views.set(load, View); }
  return <View text={text} artifact={{ title }} />;
}

/** A read-only browser file, without a resource client or locator. A specific Blob type wins; otherwise the name supplies the type. */
export function LocalFileViewer({ name, blob, kinds, ...frame }: LocalFileViewerProps) {
  const declared = blob.type.split(';')[0]?.trim().toLowerCase();
  const mediaType = !declared || declared === 'application/octet-stream' ? mediaTypeOf(name) : declared;
  const media = useMemo(() => blob.type === mediaType ? blob : blob.slice(0, blob.size, mediaType), [blob, mediaType]);
  if (Object.hasOwn(IMAGE_TYPES, mediaType)) return <ImagePane key={name} name={name} blob={media} mediaType={mediaType} {...defined(frame)} />;
  if (mediaType === 'application/pdf') return <PdfPane key={name} name={name} blob={media} {...defined(frame)} />;
  if (mediaType.startsWith('video/')) return <LocalVideo key={name} name={name} blob={media} mediaType={mediaType} {...frame} />;
  const text = mediaType.startsWith('text/') || mediaType === 'application/json' || mediaType === 'application/xml' || mediaType.endsWith('+json') || mediaType.endsWith('+xml');
  const artifact = textArtifact(name, mediaType);
  const kind = text ? kinds?.find(entry => { try { return entry.match({ resource: { path: name } }, artifact); } catch { return false; } }) : undefined;
  return <LocalText name={name} blob={blob} mediaType={mediaType} text={text} kind={kind} {...frame} />;
}

/** A video already in the page (a Blob): played from an object URL with the native controls. */
function LocalVideo({ name, blob, mediaType, subtitle, testId = 'viewer', ...frame }: LocalFileViewerProps & { readonly mediaType: string }) {
  const url = useMemo(() => URL.createObjectURL(blob), [blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const title = name.split('/').pop() || name;
  return <ViewerFrame title={title} testId={testId} {...frame} subtitle={<>{subtitle}{subtitle && <span aria-hidden="true">·</span>}{mediaType} · {formatBytes(blob.size)}</>}
    onDownload={() => downloadFile(title, blob, mediaType)}>
    <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center"><video data-testid={`${testId}-video`} src={url} aria-label={title} controls playsInline preload="metadata" className="h-full max-h-full w-full min-w-0 object-contain" /></div>
  </ViewerFrame>;
}

type Preview = { readonly blob: Blob; readonly text: string | undefined };

/** Text stays literal, including HTML. Unknown types and failed UTF-8 reads keep the original download. */
function LocalText({ name, blob, mediaType, text: canRead, kind, subtitle, testId = 'viewer', ...frame }: LocalFileViewerProps & { readonly mediaType: string; readonly text: boolean; readonly kind: LocalTextKind | undefined }) {
  const { labels } = useViewerText();
  const [preview, setPreview] = useState<Preview>();
  useEffect(() => {
    if (!canRead) return;
    let active = true;
    void (async () => {
      let text: string | undefined;
      try {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        if (!bytes.includes(0)) text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      } catch { /* A failed read leaves the original file available for download. */ }
      if (active) setPreview({ blob, text });
    })();
    return () => { active = false; };
  }, [blob, canRead]);
  const loading = canRead && preview?.blob !== blob;
  const text = canRead && preview?.blob === blob ? preview.text : undefined;
  const title = name.split('/').pop() || name;
  return <ViewerFrame title={title} testId={testId} {...frame}
    subtitle={<>{subtitle}{subtitle && <span aria-hidden="true">·</span>}{mediaType} · {formatBytes(blob.size)}</>}
    onDownload={() => downloadFile(title, blob, blob.type || mediaType)}>
    {text === undefined
      ? <p role="status" className="m-0 p-4 text-sm text-muted-foreground">{loading ? labels.loading : labels.noPreview}</p>
      : kind ? <KindView kind={kind} text={text} title={title} testId={testId} loading={labels.loading} />
      : <div className="min-h-0 flex-1 overflow-auto p-3"><pre data-testid={`${testId}-text`} className="m-0 font-mono text-sm leading-relaxed break-words whitespace-pre-wrap">{text}</pre></div>}
  </ViewerFrame>;
}

/** A text kind's view of the file, loaded the first time one opens. */
function KindView({ kind, text, title, testId, loading }: { readonly kind: LocalTextKind; readonly text: string; readonly title: string; readonly testId: string; readonly loading: string }) {
  return <div data-testid={`${testId}-view`} className="min-h-0 flex-1 overflow-auto p-3">
    <Suspense fallback={<p role="status" className="m-0 text-sm text-muted-foreground">{loading}</p>}>{kindElement(kind.load, text, title)}</Suspense>
  </div>;
}
