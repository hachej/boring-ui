'use client';

// The resizable left pane (D-1898), owned by the kit and independent of the host's shadcn sidebar: the host's SidebarProvider takes no kit-only
// prop. The width is the `--sidebar-width` custom property on the provider's wrapper (the theme token the sidebar already reads), so the host's
// own sidebar needs no change; the rail becomes the drag handle (role separator, arrow keys, double-click reset). Fine pointers only: on touch
// the rail stays the host's toggle and the phone sheet keeps `--sidebar-width-mobile`.
// The width the person chose is kept in rem in localStorage under the kit's own key (the origin is the app, the browser profile the person).
// Every storage access is guarded: a blocked or throwing store only means the width is not remembered.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { SidebarRail, useSidebar } from '@/components/ui/sidebar';
import { cn } from '../utils/utils';

export const SIDEBAR_WIDTH_KEY = 'boring-ui:sidebar-width';
const MIN_REM = 12;
const MAX_REM = 28;
const STEP_REM = 1;

export type SidebarResizable = boolean | { readonly min?: number; readonly max?: number };

export interface SidebarResize {
  readonly minRem: number;
  readonly maxRem: number;
  /** The wrapper's style: the chosen `--sidebar-width`, or none (the theme's width). */
  readonly style: CSSProperties | undefined;
  readonly widthRem: number | null;
  readonly set: (rem: number, commit: boolean) => void;
  readonly reset: () => void;
}

function readStored(min: number, max: number): number | null {
  try {
    const value = Number.parseFloat(window.localStorage.getItem(SIDEBAR_WIDTH_KEY) ?? '');
    return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : null;
  } catch {
    return null;
  }
}

function writeStored(rem: number | null) {
  try {
    if (rem === null) window.localStorage.removeItem(SIDEBAR_WIDTH_KEY);
    else window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(rem));
  } catch {
    // storage unavailable: the width lasts for this visit only
  }
}

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
const rootRem = () => Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
const roundRem = (rem: number) => Math.round(rem * 10) / 10;

/** The resize state of the shell. `undefined` while `resizable` is off or the pointer is not fine. Call it where the SidebarProvider is rendered. */
export function useSidebarResize(resizable: SidebarResizable | undefined): SidebarResize | undefined {
  const bounds = typeof resizable === 'object' ? resizable : {};
  const minRem = bounds.min ?? MIN_REM;
  const maxRem = Math.max(minRem, bounds.max ?? MAX_REM);
  const [fine, setFine] = useState(false);
  const [widthRem, setWidthRem] = useState<number | null>(null);
  const on = Boolean(resizable);
  useIsoLayoutEffect(() => {
    if (!on) return;
    const query = window.matchMedia('(pointer: fine)');
    const sync = () => setFine(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, [on]);
  const active = on && fine;
  useIsoLayoutEffect(() => { if (active) setWidthRem(readStored(minRem, maxRem)); }, [active, minRem, maxRem]);
  const set = useCallback((rem: number, commit: boolean) => {
    const next = Math.min(maxRem, Math.max(minRem, rem));
    setWidthRem(next);
    if (commit) writeStored(next);
  }, [minRem, maxRem]);
  const reset = useCallback(() => { setWidthRem(null); writeStored(null); }, []);
  const style = useMemo<CSSProperties | undefined>(() => (active && widthRem !== null ? ({ '--sidebar-width': `${widthRem}rem` } as CSSProperties) : undefined), [active, widthRem]);
  return useMemo(() => (active ? { minRem, maxRem, style, widthRem, set, reset } : undefined), [active, minRem, maxRem, style, widthRem, set, reset]);
}

// The rail's look is the host sidebar's own (same classes), so the handle sits exactly where the toggle did.
const RAIL = cn(
  'absolute inset-y-0 z-20 hidden w-4 transition-all ease-linear group-data-[side=left]:-right-4 group-data-[side=right]:left-0 after:absolute after:inset-y-0 after:start-1/2 after:w-[2px] hover:after:bg-sidebar-border sm:flex ltr:-translate-x-1/2 rtl:-translate-x-1/2',
  'group-data-[collapsible=offcanvas]:translate-x-0 group-data-[collapsible=offcanvas]:after:left-full hover:group-data-[collapsible=offcanvas]:bg-sidebar',
  '[[data-side=left][data-collapsible=offcanvas]_&]:-right-2 [[data-side=right][data-collapsible=offcanvas]_&]:-left-2',
  'cursor-col-resize touch-none',
);

/** The rail of the sidebar: the host's toggle, or, when the shell is resizable (fine pointer, expanded, wide), the drag handle. */
export function ResizableRail({ resize }: { readonly resize: SidebarResize | undefined }) {
  const { isMobile, state } = useSidebar();
  if (!resize || isMobile || state !== 'expanded') return <SidebarRail />;
  return <ResizeHandle resize={resize} />;
}

function ResizeHandle({ resize }: { readonly resize: SidebarResize }) {
  const drag = useRef<{ x: number; rem: number; sign: number; moved: boolean } | null>(null);
  const [measured, setMeasured] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const gap = () => ref.current?.closest('[data-slot=sidebar-wrapper]')?.querySelector<HTMLElement>('[data-slot=sidebar-gap]') ?? null;
  // The width in rem: the chosen one, else what the theme gives (the gap's own width).
  const current = () => resize.widthRem ?? (gap()?.getBoundingClientRect().width ?? 0) / rootRem();
  // The theme's width, until one is chosen: read from the gap in an observer callback (a subscription), not in an effect body.
  useEffect(() => {
    const element = ref.current?.closest('[data-slot=sidebar-wrapper]')?.querySelector<HTMLElement>('[data-slot=sidebar-gap]');
    if (!element) return undefined;
    const observer = new ResizeObserver(() => setMeasured(element.getBoundingClientRect().width / rootRem()));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const direction = () => (ref.current?.closest('[data-side]')?.getAttribute('data-side') === 'right' ? -1 : 1);
  const to = (start: { x: number; rem: number; sign: number }, clientX: number) => start.rem + ((clientX - start.x) * start.sign) / rootRem();
  // The sidebar animates its width; following the pointer must not lag behind it.
  const follow = (on: boolean) => {
    const wrapper = ref.current?.closest('[data-slot=sidebar-wrapper]');
    for (const element of wrapper?.querySelectorAll<HTMLElement>('[data-slot=sidebar-gap], [data-slot=sidebar-container]') ?? []) element.style.transition = on ? 'none' : '';
  };
  return <div
    ref={ref}
    data-sidebar="rail"
    data-slot="sidebar-rail"
    role="separator"
    aria-orientation="vertical"
    aria-label="Resize sidebar"
    aria-valuemin={resize.minRem}
    aria-valuemax={resize.maxRem}
    aria-valuenow={roundRem(resize.widthRem ?? measured ?? 0) || undefined}
    tabIndex={0}
    title="Resize sidebar (double-click to reset)"
    className={RAIL}
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { x: event.clientX, rem: current(), sign: direction(), moved: false };
      follow(true);
    }}
    onPointerMove={event => {
      const start = drag.current;
      if (!start) return;
      start.moved = true;
      resize.set(to(start, event.clientX), false);
    }}
    onPointerUp={event => {
      const start = drag.current;
      drag.current = null;
      follow(false);
      if (start?.moved) resize.set(to(start, event.clientX), true);
    }}
    onPointerCancel={() => { drag.current = null; follow(false); }}
    onDoubleClick={resize.reset}
    onKeyDown={event => {
      const grow = direction() === 1 ? 'ArrowRight' : 'ArrowLeft';
      const shrink = grow === 'ArrowRight' ? 'ArrowLeft' : 'ArrowRight';
      let rem: number | null = null;
      if (event.key === grow) rem = current() + STEP_REM;
      else if (event.key === shrink) rem = current() - STEP_REM;
      else if (event.key === 'Home') rem = resize.minRem;
      else if (event.key === 'End') rem = resize.maxRem;
      if (rem === null) return;
      event.preventDefault();
      resize.set(rem, true);
    }}
  />;
}
