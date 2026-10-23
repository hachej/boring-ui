'use client';

import { useEffect, useMemo, useState } from 'react';
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
}

/** A read-only browser file, without a resource client or locator. A specific Blob type wins; otherwise the name supplies the type. */
export function LocalFileViewer({ name, blob, ...frame }: LocalFileViewerProps) {
  const declared = blob.type.split(';')[0]?.trim().toLowerCase();
  const mediaType = !declared || declared === 'application/octet-stream' ? mediaTypeOf(name) : declared;
  const media = useMemo(() => blob.type === mediaType ? blob : blob.slice(0, blob.size, mediaType), [blob, mediaType]);
  if (Object.hasOwn(IMAGE_TYPES, mediaType)) return <ImagePane key={name} name={name} blob={media} mediaType={mediaType} {...frame} />;
  if (mediaType === 'application/pdf') return <PdfPane key={name} name={name} blob={media} {...frame} />;
  const text = mediaType.startsWith('text/') || mediaType === 'application/json' || mediaType === 'application/xml' || mediaType.endsWith('+json') || mediaType.endsWith('+xml');
  return <LocalText name={name} blob={blob} mediaType={mediaType} text={text} {...frame} />;
}

type Preview = { readonly blob: Blob; readonly text: string | undefined };

/** Text stays literal, including HTML. Unknown types and failed UTF-8 reads keep the original download. */
function LocalText({ name, blob, mediaType, text: canRead, subtitle, testId = 'viewer', ...frame }: LocalFileViewerProps & { readonly mediaType: string; readonly text: boolean }) {
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
      : <div className="min-h-0 flex-1 overflow-auto p-3"><pre data-testid={`${testId}-text`} className="m-0 font-mono text-sm leading-relaxed break-words whitespace-pre-wrap">{text}</pre></div>}
  </ViewerFrame>;
}
