'use client';

import { useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import type { ImageContent } from '@earendil-works/pi-ai';
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { thumbnail } from './composer';
import { useChatText } from './labels';
import type { ChatLabels } from './labels';

type Point = { readonly x: number; readonly y: number };
type View = { readonly scale: number; readonly x: number; readonly y: number };
type Gesture = {
  readonly pointers: Map<number, Point>;
  basis: { readonly mode: 'pan' | 'pinch' | 'pinch-pan' | 'swipe'; readonly point: Point; readonly distance: number; readonly view: View } | undefined;
  tap: { readonly at: number; readonly point: Point } | undefined;
  view: View;
  pointerType: string;
};
const FIT: View = { scale: 1, x: 0, y: 0 };
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Presentation only: local raster bytes, one message's gallery, and the host's native Dialog lifecycle. */
export function ImageViewer({ images, index, onIndexChange, onClose, labels: supplied, testId = 'image-viewer' }: {
  readonly images: readonly ImageContent[]; readonly index: number; readonly onIndexChange: (index: number) => void; readonly onClose: () => void;
  readonly labels?: ChatLabels | undefined; readonly testId?: string | undefined;
}) {
  const { labels: defaults } = useChatText();
  const labels = supplied ?? defaults;
  const src = images[index] && thumbnail(images[index]!.mimeType, images[index]!.data);
  const move = (offset: number) => onIndexChange((index + offset + images.length) % images.length);
  if (!src) return null;
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent showCloseButton={false} aria-describedby={undefined} data-testid="image-viewer"
    className="pi-chat flex min-h-0 flex-col overflow-hidden max-sm:inset-0 max-sm:max-h-dvh max-sm:min-h-dvh max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 sm:max-h-[90dvh] sm:min-h-[80dvh] sm:max-w-5xl"
    onKeyDown={event => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); move(event.key === 'ArrowLeft' ? -1 : 1); }
    }}>
    <DialogTitle className="sr-only">{labels.imageAttachment}</DialogTitle>
    <div className="flex shrink-0 items-center justify-between gap-2 pt-[env(safe-area-inset-top)]">
      <span aria-live="polite" data-testid="image-viewer-count">{labels.imagePosition(index + 1, images.length)}</span>
      <div className="flex items-center gap-2">
        {images.length > 1 && <>
          <Button variant="ghost" size="icon" className="min-h-12! min-w-12!" aria-label={labels.previousImage} onClick={() => move(-1)}><ChevronLeftIcon data-icon="inline-start" aria-hidden="true" /></Button>
          <Button variant="ghost" size="icon" className="min-h-12! min-w-12!" aria-label={labels.nextImage} onClick={() => move(1)}><ChevronRightIcon data-icon="inline-start" aria-hidden="true" /></Button>
        </>}
        <Button variant="ghost" size="icon" className="min-h-12! min-w-12!" data-testid={`${testId}-close`} aria-label={labels.close} onClick={onClose}
          onTouchEnd={event => {
            // Pinch can suppress clicks; cancel the compatibility click before exposing the page beneath the close target.
            const point = event.changedTouches[0], box = event.currentTarget.getBoundingClientRect();
            if (point && point.clientX >= box.left && point.clientX <= box.right && point.clientY >= box.top && point.clientY <= box.bottom) { event.preventDefault(); onClose(); }
          }}><XIcon data-icon="inline-start" aria-hidden="true" /></Button>
      </div>
    </div>
    <ImageSurface key={`${index}:${src}`} src={src} alt={labels.imagePosition(index + 1, images.length)} onClose={onClose} testId={testId} />
  </DialogContent></Dialog>;
}

function ImageSurface({ src, alt, onClose, testId }: { readonly src: string; readonly alt: string; readonly onClose: () => void; readonly testId: string }) {
  const [view, setView] = useState(FIT);
  const image = useRef<HTMLImageElement>(null);
  const gesture = useRef<Gesture>({ pointers: new Map(), basis: undefined, tap: undefined, view: FIT, pointerType: '' });
  const update = (next: View) => { gesture.current.view = next; setView(next); };
  const bounded = (scale: number, x: number, y: number, element: HTMLElement): View => {
    const box = element.getBoundingClientRect();
    const maxX = Math.max(0, ((image.current?.clientWidth || box.width) * scale - box.width) / 2), maxY = Math.max(0, ((image.current?.clientHeight || box.height) * scale - box.height) / 2);
    return { scale, x: Math.max(-maxX, Math.min(maxX, x)), y: Math.max(-maxY, Math.min(maxY, y)) };
  };
  const zoom = (point: Point, element: HTMLElement) => {
    const state = gesture.current;
    state.tap = undefined;
    if (state.view.scale > 1) { update(FIT); return; }
    const box = element.getBoundingClientRect();
    update(bounded(2, box.left + box.width / 2 - point.x, box.top + box.height / 2 - point.y, element));
  };
  const rebase = (mode?: 'pan' | 'pinch-pan') => {
    const state = gesture.current, points = [...state.pointers.values()], first = points[0];
    state.basis = first ? { mode: points.length > 1 ? 'pinch' : mode ?? (state.view.scale > 1 ? 'pan' : 'swipe'), point: points[1] ? midpoint(first, points[1]) : first,
      distance: points[1] ? Math.max(1, distance(first, points[1])) : 0, view: state.view } : undefined;
  };
  const pointer = (event: PointerEvent<HTMLDivElement>) => ({ x: event.clientX, y: event.clientY });
  const end = (event: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const state = gesture.current, basis = state.basis;
    if (!state.pointers.has(event.pointerId) || !basis) return;
    const point = pointer(event), dx = point.x - basis.point.x, dy = point.y - basis.point.y;
    state.pointers.delete(event.pointerId);
    if (!cancelled && basis.mode === 'swipe' && state.view.scale === 1 && dy > 96 && dy > Math.abs(dx) * 1.25) { onClose(); return; }
    if (!cancelled && event.pointerType === 'touch' && basis.mode !== 'pinch' && basis.mode !== 'pinch-pan' && Math.hypot(dx, dy) < 12) {
      if (state.tap && event.timeStamp - state.tap.at < 300 && distance(point, state.tap.point) < 24) zoom(point, event.currentTarget);
      else state.tap = { at: event.timeStamp, point };
    } else state.tap = undefined;
    rebase(basis.mode === 'pinch' || basis.mode === 'pinch-pan' ? 'pinch-pan' : 'pan');
  };
  return <div data-testid="image-viewer-surface" data-scale={view.scale} className="relative min-h-0 flex-1 touch-none overflow-hidden max-sm:-mx-4 max-sm:-mb-4"
    onDoubleClick={event => { if (gesture.current.pointerType === 'touch') return; event.preventDefault(); zoom({ x: event.clientX, y: event.clientY }, event.currentTarget); }}
    onPointerDown={event => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault(); event.currentTarget.setPointerCapture?.(event.pointerId);
      gesture.current.pointerType = event.pointerType; gesture.current.pointers.set(event.pointerId, pointer(event)); rebase();
    }}
    onPointerMove={event => {
      const state = gesture.current;
      if (!state.pointers.has(event.pointerId) || !state.basis) return;
      event.preventDefault(); state.pointers.set(event.pointerId, pointer(event));
      const points = [...state.pointers.values()], basis = state.basis, first = points[0]!;
      if (points[1]) {
        const centre = midpoint(first, points[1]), box = event.currentTarget.getBoundingClientRect();
        const scale = Math.max(1, Math.min(5, basis.view.scale * distance(first, points[1]) / basis.distance)), ratio = scale / basis.view.scale;
        update(bounded(scale, centre.x - box.left - box.width / 2 + (basis.view.x - basis.point.x + box.left + box.width / 2) * ratio,
          centre.y - box.top - box.height / 2 + (basis.view.y - basis.point.y + box.top + box.height / 2) * ratio, event.currentTarget));
      } else if (basis.mode === 'pan' || basis.mode === 'pinch-pan') update(bounded(basis.view.scale, basis.view.x + first.x - basis.point.x, basis.view.y + first.y - basis.point.y, event.currentTarget));
    }}
    onPointerUp={event => end(event, false)} onPointerCancel={event => end(event, true)} onLostPointerCapture={event => end(event, true)}>
    <div className="absolute inset-0 flex items-center justify-center">
      <img ref={image} data-testid={`${testId}-image`} src={src} alt={alt} draggable={false} className="max-h-full max-w-full select-none object-contain" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }} />
    </div>
  </div>;
}
