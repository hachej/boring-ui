'use client';

import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { DownloadIcon, FileTextIcon } from 'lucide-react';
import { Button } from '../button/button';
import { downloadFile } from './download';
import { formatBytes, useMediaUrl } from './media';
import type { MediaSource } from './media';
import { ViewerFrame } from './viewer-frame';
import type { ViewerShare, ViewerStatus } from './viewer-frame';
import { useViewerText } from './viewer-window';

export interface PdfPaneProps extends MediaSource {
  readonly name: string;
  readonly subtitle?: ReactNode;
  readonly status?: ViewerStatus;
  readonly target?: unknown;
  readonly revision?: string;
  readonly controls?: ReactNode;
  readonly onRefresh?: () => unknown;
  readonly onShare?: ViewerShare;
  readonly onOpenInNewTab?: () => unknown;
  readonly onClose?: () => unknown;
  /** Force the fallback (for a host that knows its browser cannot render PDFs). Defaults to the browser's own report. */
  readonly inline?: boolean;
  readonly testId?: string;
  /** Overrides the title's `data-testid` (default `<testId>-title`). */
  readonly titleTestId?: string;
  readonly className?: string;
}

/** The browser reports whether it has a built-in PDF viewer. Unknown (older browsers) is treated as yes: the frame is tried. */
export function browserShowsPdf(): boolean {
  const nav = globalThis.navigator as (Navigator & { pdfViewerEnabled?: boolean }) | undefined;
  return nav?.pdfViewerEnabled !== false;
}

/**
 * A read-only PDF viewer in the standard frame, as in boring-ui v2: the browser's own PDF viewer in a frame over an object URL
 * (so its page navigation, zoom, search and print come with it). Where the browser cannot render PDFs inline, a clear message with
 * Download and Open in new tab replaces the frame.
 */
export function PdfPane({ name, bytes, blob, url: hostUrl, subtitle, status, target, revision, controls, onRefresh, onShare, onOpenInNewTab, onClose, inline, testId = 'viewer', titleTestId, className }: PdfPaneProps) {
  const source = useMemo<MediaSource>(() => ({ ...(bytes ? { bytes } : {}), ...(blob ? { blob } : {}), ...(hostUrl ? { url: hostUrl } : {}) }), [bytes, blob, hostUrl]);
  const { url, size, blob: made } = useMediaUrl(source, 'application/pdf');
  const canShow = inline ?? browserShowsPdf();
  const { labels } = useViewerText();
  const downloadName = name.split('/').pop() || 'document.pdf';
  const download = () => { if (made) downloadFile(downloadName, made, 'application/pdf'); else if (url) { const link = Object.assign(document.createElement('a'), { href: url, download: downloadName }); document.body.append(link); link.click(); link.remove(); } };
  const open = onOpenInNewTab ?? (url ? () => { window.open(url, '_blank', 'noopener,noreferrer'); } : undefined);
  return <ViewerFrame title={downloadName} subtitle={<>{subtitle}{subtitle && size !== undefined && <span aria-hidden="true">·</span>}{['PDF', size !== undefined && formatBytes(size)].filter(Boolean).join(' · ')}</>} status={status} target={target} revision={revision} testId={testId} {...(titleTestId ? { titleTestId } : {})} className={className}
    onRefresh={onRefresh} onShare={onShare} onDownload={url ? download : undefined} onOpenInNewTab={open} onClose={onClose} controls={controls}>
    <div data-testid={`${testId}-stage`} data-pdf={url ? (canShow ? 'inline' : 'fallback') : 'loading'} className="boring-viewer-stage relative flex min-h-0 flex-1">
      {!url ? <p role="status" className="m-auto p-6 text-sm text-muted-foreground">{labels.loading}</p>
        : canShow ? <iframe src={url} title={`${downloadName} (PDF)`} data-testid={`${testId}-frame-pdf`} className="size-full min-h-0 flex-1 border-0 bg-background" />
          : <div role="alert" data-testid={`${testId}-pdf-fallback`} className="m-auto flex max-w-sm flex-col items-center gap-3 p-6 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground"><FileTextIcon className="size-6" aria-hidden="true" /></span>
            <p className="m-0 text-sm font-medium">{labels.pdfUnsupported}</p>
            <p className="m-0 text-xs text-muted-foreground">{labels.pdfHint(downloadName, Boolean(open))}</p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="default" size="bar" data-testid={`${testId}-pdf-download`} onClick={download}><DownloadIcon className="size-3.5" aria-hidden="true" />{labels.download}</Button>
              {open && <Button variant="outline" size="bar" onClick={() => open()}>{labels.openInNewTab}</Button>}
            </div>
          </div>}
    </div>
  </ViewerFrame>;
}
