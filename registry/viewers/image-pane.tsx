'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent, ReactNode } from 'react';
import { MaximizeIcon, ScanIcon, ZoomInIcon, ZoomOutIcon } from 'lucide-react';
import { Button } from '../button/button';
import { downloadFile } from './download';
import { formatBytes, useMediaUrl } from './media';
import type { MediaSource } from './media';
import { cn } from '../utils/utils';
import { useViewerBar, ViewerFrame, ViewerIconButton } from './viewer-frame';
import type { ViewerShare, ViewerStatus } from './viewer-frame';
import { useViewerText } from './viewer-window';

export const IMAGE_TYPES: Readonly<Record<string, string>> = { 'image/png': 'PNG', 'image/jpeg': 'JPEG', 'image/gif': 'GIF', 'image/webp': 'WebP', 'image/svg+xml': 'SVG' };
const STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8];

export interface ImagePaneProps extends MediaSource {
  readonly name: string;
  readonly mediaType: string;
  readonly subtitle?: ReactNode;
  readonly status?: ViewerStatus;
  readonly target?: unknown;
  readonly revision?: string;
  readonly controls?: ReactNode;
  /** Re-reads the file; the host passes the new bytes, blob or URL back in. */
  readonly onRefresh?: () => unknown;
  readonly onShare?: ViewerShare;
  readonly onOpenInNewTab?: () => unknown;
  readonly onClose?: () => unknown;
  readonly testId?: string;
  /** Overrides the title's `data-testid` (default `<testId>-title`). */
  readonly titleTestId?: string;
  readonly className?: string;
}

/** Zoom steps and the level; on a narrow bar only the steps stay (the stage also zooms with + - 0). Fit and Actual size are in the "…" menu. */
function ZoomControls({ testId, percent, ready, onStep, onFit }: { readonly testId: string; readonly percent: string; readonly ready: boolean; readonly onStep: (direction: 1 | -1) => void; readonly onFit: () => void }) {
  const { tight } = useViewerBar();
  const { labels } = useViewerText();
  return <div role="group" aria-label={labels.zoom} className="flex items-center gap-0.5">
    <ViewerIconButton label={labels.zoomOut} data-testid={`${testId}-zoom-out`} disabled={!ready} onClick={() => onStep(-1)}><ZoomOutIcon className="size-4" aria-hidden="true" /></ViewerIconButton>
    {!tight && <Button variant="quiet" size="bar" data-testid={`${testId}-zoom-level`} aria-label={labels.zoomLevel(percent)} title={labels.fitToView} disabled={!ready} className="min-w-10 px-1 tabular-nums" onClick={onFit}>{percent}</Button>}
    <ViewerIconButton label={labels.zoomIn} data-testid={`${testId}-zoom-in`} disabled={!ready} onClick={() => onStep(1)}><ZoomInIcon className="size-4" aria-hidden="true" /></ViewerIconButton>
  </div>;
}

type Zoom = { readonly kind: 'fit' } | { readonly kind: 'scale'; readonly value: number };

/**
 * A read-only image viewer in the standard frame: fit to view by default, zoom, actual size, drag to pan when zoomed, a checkerboard
 * behind transparency. Every type, SVG included, is shown through an `<img>` from an object URL, never as markup.
 */
export function ImagePane({ name, mediaType, bytes, blob, url: hostUrl, subtitle, status, target, revision, controls, onRefresh, onShare, onOpenInNewTab, onClose, testId = 'viewer', titleTestId, className }: ImagePaneProps) {
  const source = useMemo<MediaSource>(() => ({ ...(bytes ? { bytes } : {}), ...(blob ? { blob } : {}), ...(hostUrl ? { url: hostUrl } : {}) }), [bytes, blob, hostUrl]);
  const { url, size, blob: made } = useMediaUrl(source, mediaType);
  const supported = mediaType in IMAGE_TYPES;
  const { labels } = useViewerText();
  const [zoom, setZoom] = useState<Zoom>({ kind: 'fit' });
  const [natural, setNatural] = useState<{ width: number; height: number } | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [fitScale, setFitScale] = useState(1);
  const stage = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | undefined>(undefined);
  useEffect(() => { setNatural(undefined); setFailed(false); }, [url]);
  const measure = () => {
    const box = stage.current, img = image.current;
    if (box && img && img.naturalWidth) setFitScale(Math.min(1, (box.clientWidth - 32) / img.naturalWidth, (box.clientHeight - 32) / img.naturalHeight));
  };
  useEffect(() => {
    const box = stage.current;
    if (!box || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [url]);
  const current = zoom.kind === 'fit' ? fitScale : zoom.value;
  const step = (direction: 1 | -1) => {
    const now = Number(current.toFixed(3));
    const next = direction > 0 ? STEPS.find(value => value > now + 0.001) : [...STEPS].reverse().find(value => value < now - 0.001);
    if (next) setZoom({ kind: 'scale', value: next });
  };
  const label = IMAGE_TYPES[mediaType] ?? mediaType;
  const facts = [label, natural && `${natural.width} × ${natural.height}`, size !== undefined && formatBytes(size)].filter(Boolean) as string[];
  const panning = zoom.kind === 'scale' && natural !== undefined && (natural.width * zoom.value > (stage.current?.clientWidth ?? 0) || natural.height * zoom.value > (stage.current?.clientHeight ?? 0));
  const begin = (event: PointerEvent<HTMLDivElement>) => {
    const box = stage.current;
    if (!panning || !box || event.button !== 0) return;
    drag.current = { x: event.clientX, y: event.clientY, left: box.scrollLeft, top: box.scrollTop };
    box.setPointerCapture?.(event.pointerId);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const box = stage.current, start = drag.current;
    if (!box || !start) return;
    box.scrollLeft = start.left - (event.clientX - start.x);
    box.scrollTop = start.top - (event.clientY - start.y);
  };
  const end = () => { drag.current = undefined; };
  const downloadName = name.split('/').pop() || 'image';
  const download = () => { const data = made; if (data) downloadFile(downloadName, data, mediaType); else if (url) { const link = Object.assign(document.createElement('a'), { href: url, download: downloadName }); document.body.append(link); link.click(); link.remove(); } };
  const percent = `${Math.round(current * 100)}%`;
  return <ViewerFrame title={name.split('/').pop() || name} subtitle={<>{subtitle}{subtitle && facts.length > 0 && <span aria-hidden="true">·</span>}{facts.join(' · ')}</>} status={status} target={target} revision={revision} testId={testId} {...(titleTestId ? { titleTestId } : {})} className={className}
    onRefresh={onRefresh} onShare={onShare} onDownload={url ? download : undefined} onOpenInNewTab={onOpenInNewTab ?? (url ? () => { window.open(url, '_blank', 'noopener,noreferrer'); } : undefined)} onClose={onClose}
    menu={[
      { id: 'zoom-fit', label: labels.fitToView, icon: <ScanIcon className="size-4" />, disabled: !natural, onSelect: () => setZoom({ kind: 'fit' }) },
      { id: 'zoom-actual', label: labels.actualSize, icon: <MaximizeIcon className="size-4" />, disabled: !natural, onSelect: () => setZoom({ kind: 'scale', value: 1 }) }]}
    controls={<>
      <ZoomControls testId={testId} percent={percent} ready={Boolean(natural)} onStep={step} onFit={() => setZoom({ kind: 'fit' })} />
      {controls}
    </>}>
    <div ref={stage} data-testid={`${testId}-stage`} data-zoom={zoom.kind === 'fit' ? 'fit' : String(zoom.value)} data-panning={panning || undefined}
      onPointerDown={begin} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
      className={cn('boring-viewer-stage relative min-h-0 flex-1 overflow-auto', panning && 'cursor-grab active:cursor-grabbing')} tabIndex={0} aria-label={labels.imageStage(name)}
      onKeyDown={event => { if (event.key === '+' || event.key === '=') step(1); else if (event.key === '-') step(-1); else if (event.key === '0') setZoom({ kind: 'fit' }); }}>
      {!supported ? <p role="alert" className="m-auto p-6 text-center text-sm text-muted-foreground">{labels.imageUnsupported(mediaType)}</p>
        : failed ? <p role="alert" className="m-auto p-6 text-center text-sm text-muted-foreground">{labels.imageUnreadable}</p>
        : url ? <div className="flex min-h-full min-w-full items-center justify-center p-4">
          <img ref={image} src={url} alt={name} data-testid={`${testId}-image`} draggable={false} decoding="async" referrerPolicy="no-referrer"
            onLoad={event => { setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }); measure(); }} onError={() => setFailed(true)}
            style={natural ? { width: natural.width * current, height: natural.height * current, maxWidth: 'none' } : undefined}
            className="boring-viewer-checker block shrink-0 select-none rounded-sm shadow-sm outline outline-1 outline-border" />
        </div> : <p role="status" className="m-auto p-6 text-sm text-muted-foreground">{labels.loading}</p>}
    </div>
  </ViewerFrame>;
}
