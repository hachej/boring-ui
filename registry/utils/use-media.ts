'use client';

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { RefObject } from 'react';

/** Phone layout is strictly below 768 CSS pixels, independently of pointer type. */
export const PHONE_BELOW = 768;
export const PHONE_QUERY = `(width < ${PHONE_BELOW}px)`;
const serverMatches = () => false;

export function useMedia(query: string): boolean {
  const media = useMemo(() => globalThis.matchMedia?.(query) ?? globalThis.window?.matchMedia?.(query), [query]);
  const subscribe = useCallback((notify: () => void) => {
    media?.addEventListener('change', notify);
    return () => media?.removeEventListener('change', notify);
  }, [media]);
  const snapshot = useCallback(() => media?.matches === true, [media]);
  return useSyncExternalStore(subscribe, snapshot, serverMatches);
}

export const usePhone = (): boolean => useMedia(PHONE_QUERY);

export interface VisualViewportBox { readonly top: number; readonly height: number }

function useVisualViewportBox(enabled: boolean): VisualViewportBox | null {
  const [box, setBox] = useState<VisualViewportBox | null>(null);
  useEffect(() => {
    const viewport = globalThis.window?.visualViewport ?? globalThis.visualViewport;
    if (!enabled || !viewport) return;
    const read = () => {
      if (viewport.scale > 1.01) return;
      const next = { top: viewport.offsetTop, height: viewport.height };
      setBox(previous => previous && previous.top === next.top && previous.height === next.height ? previous : next);
    };
    read();
    viewport.addEventListener('resize', read);
    viewport.addEventListener('scroll', read);
    return () => { viewport.removeEventListener('resize', read); viewport.removeEventListener('scroll', read); };
  }, [enabled]);
  return enabled ? box : null;
}

/** Null without a visual viewport; pinch zoom keeps the last unzoomed box. */
export const useVisualViewport = (): VisualViewportBox | null => useVisualViewportBox(true);

/** The chat's inset is relative to its own bottom, not necessarily the layout viewport's bottom. */
export function useKeyboardInset(ref: RefObject<HTMLElement | null>, enabled: boolean): void {
  const viewport = useVisualViewportBox(enabled);
  useEffect(() => {
    const element = ref.current;
    if (!enabled || !viewport || !element) return;
    const measure = () => element.style.setProperty('--composer-keyboard-inset', `${Math.max(0, element.getBoundingClientRect().bottom - viewport.height - viewport.top)}px`);
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(element);
    measure();
    return () => { observer?.disconnect(); element.style.removeProperty('--composer-keyboard-inset'); };
  }, [ref, enabled, viewport]);
}

/** The token the kit Toaster reads for its bottom offset (`var(--toast-offset-bottom, <sonner default>)`). */
export const TOAST_OFFSET = '--toast-offset-bottom';

// One page can show several chats (BORING-PI-6). Each docked composer registers its own clearance, the token is the largest, and it is
// removed only when the last one leaves: closing one viewer never clears the room another still needs.
const clearances = new Map<symbol, number>();

function publishToastOffset(): void {
  const root = globalThis.document?.documentElement;
  if (!root) return;
  if (clearances.size === 0) { root.style.removeProperty(TOAST_OFFSET); return; }
  root.style.setProperty(TOAST_OFFSET, `calc(${Math.max(...clearances.values())}px + var(--toast-offset-gap, 0.5rem))`);
}

/**
 * While `enabled` (a phone, composer docked at the bottom), keeps `--toast-offset-bottom` on the document root equal to the room the
 * dock takes from the bottom of the window (its height, its safe-area padding and anything below it). Cleanup is synchronous.
 */
export function useToastOffset(dock: RefObject<HTMLElement | null>, enabled: boolean): void {
  useEffect(() => {
    const element = dock.current, view = globalThis.window;
    if (!enabled || !element || !view) return;
    const id = Symbol('toast-offset');
    const measure = () => { clearances.set(id, Math.max(0, Math.round(view.innerHeight - element.getBoundingClientRect().top))); publishToastOffset(); };
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(element);
    view.addEventListener('resize', measure);
    measure();
    return () => { observer?.disconnect(); view.removeEventListener('resize', measure); clearances.delete(id); publishToastOffset(); };
  }, [dock, enabled]);
}
