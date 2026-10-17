'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { DownloadIcon, FileTextIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { downloadFile } from './download';
import { ZoomControls } from './image-pane';
import { formatBytes, useMediaUrl } from './media';
import { PdfPages } from './pdf-pages';
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
  /** Leading header content, before the title. */
  readonly headerStart?: ReactNode;
  readonly controls?: ReactNode;
  readonly onRefresh?: () => unknown;
  readonly onShare?: ViewerShare;
  readonly onOpenInNewTab?: () => unknown;
  readonly onClose?: () => unknown;
  /** `false` draws the pages with pdf.js (for a host that knows its browser cannot render PDFs), `true` uses the browser's own viewer. Defaults to the browser's own report. */
  readonly inline?: boolean;
  /** How the browser's viewer opens the page: `width` (default) fits the page to the pane's width, `page` fits the whole page, `none` leaves the browser's own zoom. */
  readonly fit?: 'width' | 'page' | 'none';
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

const STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

/**
 * A read-only PDF viewer in the standard frame, as in boring-ui v2: the browser's own PDF viewer in a frame over an object URL
 * (so its page navigation, zoom, search and print come with it). Where the browser cannot render PDFs inline (phones), pdf.js, loaded
 * only then, draws the pages with zoom and a page indicator; if that fails too (a damaged or password-protected file, no worker), a clear
 * message with Download and Open in new tab replaces it.
 */
export function PdfPane({ name, bytes, blob, url: hostUrl, subtitle, status, target, revision, headerStart, controls, onRefresh, onShare, onOpenInNewTab, onClose, inline, fit = 'width', testId = 'viewer', titleTestId, className }: PdfPaneProps) {
  const source = useMemo<MediaSource>(() => ({ ...(bytes ? { bytes } : {}), ...(blob ? { blob } : {}), ...(hostUrl ? { url: hostUrl } : {}) }), [bytes, blob, hostUrl]);
  const { url, size, blob: made } = useMediaUrl(source, 'application/pdf');
  const canShow = inline ?? browserShowsPdf();
  const { labels } = useViewerText();
  const downloadName = name.split('/').pop() || 'document.pdf';
  const download = () => { if (made) downloadFile(downloadName, made, 'application/pdf'); else if (url) { const link = Object.assign(document.createElement('a'), { href: url, download: downloadName }); document.body.append(link); link.click(); link.remove(); } };
  const open = onOpenInNewTab ?? (url ? () => { window.open(url, '_blank', 'noopener,noreferrer'); } : undefined);
  const [zoom, setZoom] = useState(1);
  const [pages, setPages] = useState<{ readonly count: number; readonly current: number }>();
  const [failed, setFailed] = useState(false);
  useEffect(() => { setPages(undefined); setFailed(false); }, [url]);
  const step = (direction: 1 | -1) => setZoom(now => (direction > 0 ? STEPS.find(value => value > now) : [...STEPS].reverse().find(value => value < now)) ?? now);
  const drawn = Boolean(url) && !canShow && !failed;
  return <ViewerFrame title={downloadName} subtitle={<>{subtitle}{subtitle && size !== undefined && <span aria-hidden="true">·</span>}{['PDF', size !== undefined && formatBytes(size)].filter(Boolean).join(' · ')}</>} status={status} target={target} revision={revision} headerStart={headerStart} testId={testId} {...(titleTestId ? { titleTestId } : {})} className={className}
    onRefresh={onRefresh} onShare={onShare} onDownload={url ? download : undefined} onOpenInNewTab={open} onClose={onClose}
    controls={drawn && pages ? <><ZoomControls testId={testId} percent={`${Math.round(zoom * 100)}%`} ready onStep={step} onFit={() => setZoom(1)} />{controls}</> : controls}>
    <div data-testid={`${testId}-stage`} data-pdf={url ? (canShow ? 'inline' : drawn ? 'pages' : 'fallback') : 'loading'} className="boring-viewer-stage relative flex min-h-0 flex-1">
      {!url ? <p role="status" className="m-auto p-6 text-sm text-muted-foreground">{labels.loading}</p>
        : canShow ? <iframe src={fit === 'none' ? url : `${url}#view=${fit === 'page' ? 'Fit' : 'FitH'}`} title={`${downloadName} (PDF)`} data-testid={`${testId}-frame-pdf`} className="size-full min-h-0 flex-1 bg-background" />
          : drawn ? <><PdfPages key={url} url={url} name={labels.pdfDocument(downloadName)} zoom={zoom} testId={testId} onLoad={count => setPages({ count, current: 1 })}
            onPage={current => setPages(now => now && now.current !== current ? { ...now, current } : now)} onError={() => setFailed(true)}
            onKey={key => { if (key === '+' || key === '=') step(1); else if (key === '-') step(-1); else if (key === '0') setZoom(1); }} />
            {pages && <Badge variant="secondary" data-testid={`${testId}-pdf-page-indicator`} aria-live="polite" className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2">{labels.pdfPage(pages.current, pages.count)}</Badge>}</>
          : <div role="alert" data-testid={`${testId}-pdf-fallback`} className="m-auto flex max-w-sm flex-col items-center gap-3 p-6 text-center">
            <span className="grid size-12 place-items-center  bg-muted text-muted-foreground"><FileTextIcon className="size-6" aria-hidden="true" /></span>
            <p className="m-0 text-sm font-medium">{labels.pdfUnsupported}</p>
            <p className="m-0 text-xs text-muted-foreground">{labels.pdfHint(downloadName, Boolean(open))}</p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="default" size="sm" data-testid={`${testId}-pdf-download`} onClick={download}><DownloadIcon data-icon="inline-start" aria-hidden="true" />{labels.download}</Button>
              {open && <Button variant="outline" size="sm" onClick={() => open()}>{labels.openInNewTab}</Button>}
            </div>
          </div>}
    </div>
  </ViewerFrame>;
}
