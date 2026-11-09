'use client';

// Whether the wide-screen left pane is open (D-1909), owned by the kit around the host's SidebarProvider (controlled `open` / `onOpenChange`; the stock
// sidebar is untouched). The person's last choice (Ctrl+B, the trigger, the rail) is kept in localStorage under the same key family and identity as the
// width (`sidebarKey('open', app, person)`, and `'open-screen'` for the `screen` layout, so a fold in one layout is not read by the other (D-1919): "1" or "0", anything else ignored). With no stored choice the first visit decides once, at mount (and when the
// person changes): at 1280px and wider the pane opens when the screen on show has a `sidebar` content, else it is the icon rail; narrower, today's default.
// Navigating between screens never re-decides. Every storage access is guarded; a blocked store only means the choice is not remembered. Written on change
// only, under the key of the person who made it.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { sidebarKey } from './sidebar-resize';

/** The width from which a first visit opens the pane for a screen that has a sidebar. */
export const SIDEBAR_FIRST_VISIT_MIN = 1280;

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

function readOpen(key: string): boolean | null {
  try {
    const stored = window.localStorage.getItem(key);
    return stored === '1' ? true : stored === '0' ? false : null;
  } catch {
    return null;
  }
}

function writeOpen(key: string, open: boolean) {
  try {
    window.localStorage.setItem(key, open ? '1' : '0');
  } catch {
    // storage unavailable: the choice lasts for this visit only
  }
}

function wide(): boolean {
  try {
    return window.matchMedia(`(min-width: ${SIDEBAR_FIRST_VISIT_MIN}px)`).matches;
  } catch {
    return false;
  }
}

/**
 * The controlled `open` and `onOpenChange` of the SidebarProvider. `fallback` is today's default (the pane is open on the `screen` layout); `hasSidebar` is whether
 * the screen on show has a `sidebar` content. Off (`enabled` false): `undefined`, and the provider keeps its own `defaultOpen`.
 */
export function useSidebarOpen(enabled: boolean, identity: { readonly app?: string | undefined; readonly person?: string | undefined }, screenLayout: boolean, fallback: boolean, hasSidebar: boolean) {
  const key = sidebarKey(screenLayout ? 'open-screen' : 'open', identity.app, identity.person);
  const [open, setOpen] = useState(fallback);
  const latest = useRef({ fallback, hasSidebar });
  // The screen on show and today's default as of the last commit: read when the person (key) changes, not a dependency of it.
  useIsoLayoutEffect(() => { latest.current = { fallback, hasSidebar }; }, [fallback, hasSidebar]);
  // Mount, or another person: that person's stored choice, else the first-visit default. Not on a change of screen.
  useIsoLayoutEffect(() => {
    if (!enabled) return;
    const choice = readOpen(key);
    const now = latest.current;
    setOpen(choice ?? (wide() ? now.fallback || now.hasSidebar : now.fallback));
  }, [enabled, key]);
  const onOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    writeOpen(key, next);
  }, [key]);
  return enabled ? { open, onOpenChange } : undefined;
}
