'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent, RefObject } from 'react';

export interface DragPosition { readonly left: number; readonly top: number }

/** Pointer-capture drag shared with the agent layer. Controls remain clickable and the whole surface stays reachable. */
export function useDraggable({ box, position, onPositionChange, enabled }: {
  readonly box: RefObject<HTMLElement | null>;
  readonly position: DragPosition | null;
  readonly onPositionChange: (position: DragPosition) => void;
  readonly enabled: boolean;
}) {
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const [viewport, setViewport] = useState(0);
  useEffect(() => { const resize = () => setViewport(count => count + 1); window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize); }, []);
  useLayoutEffect(() => {
    const rect = box.current?.getBoundingClientRect();
    if (!position || !enabled || !rect || !rect.width) return;
    const left = Math.min(Math.max(position.left, 0), Math.max(0, window.innerWidth - rect.width)), top = Math.min(Math.max(position.top, 0), Math.max(0, window.innerHeight - rect.height));
    if (left !== position.left || top !== position.top) onPositionChange({ left, top });
  }, [box, position, enabled, viewport, onPositionChange]);
  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    const rect = box.current?.getBoundingClientRect();
    if (!enabled || !rect || event.button !== 0 || (event.target as HTMLElement).closest('button, a[href]')) return;
    drag.current = { dx: event.clientX - rect.left, dy: event.clientY - rect.top };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const grab = drag.current, rect = box.current?.getBoundingClientRect();
    if (!grab || !rect) return;
    onPositionChange({ left: Math.min(Math.max(event.clientX - grab.dx, 0), Math.max(0, window.innerWidth - rect.width)), top: Math.min(Math.max(event.clientY - grab.dy, 0), Math.max(0, window.innerHeight - rect.height)) });
  };
  const end = () => { drag.current = null; };
  return { onPointerDown, onPointerMove, onPointerUp: end, onPointerCancel: end };
}
