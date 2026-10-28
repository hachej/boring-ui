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
