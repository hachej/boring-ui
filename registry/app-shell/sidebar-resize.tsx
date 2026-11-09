'use client';

// The resizable left pane (D-1898), owned by the kit and independent of the host's shadcn sidebar: the host's SidebarProvider takes no kit-only
// prop. The width is the `--sidebar-width` custom property on the provider's wrapper (the theme token the sidebar already reads), so the host's
// own sidebar needs no change; the rail becomes the drag handle (role separator, arrow keys, double-click reset). Fine pointers only: on touch
// the rail stays the host's toggle and the phone sheet keeps `--sidebar-width-mobile`.
// The width the person chose is kept in rem in localStorage under the kit's own key, which names the app and, when it is known, the person: another
// person on the same browser, or another app on the same origin, starts from the theme's width. Every storage access is guarded: a blocked or
// throwing store only means the width is not remembered.
// An app that renders SidebarProvider itself uses ResizableSidebarProvider and ResizableRail in its place: the same behaviour, no AppShell.
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type CSSProperties } from 'react';
import { SidebarProvider, SidebarRail, useSidebar } from '@/components/ui/sidebar';
import { cn } from '../utils/utils';

export const SIDEBAR_WIDTH_KEY = 'boring-ui:sidebar-width';
/** The storage key of one sidebar setting for an app and a person: `boring-ui:sidebar-<setting>:<app>:<person>`; with no person, `:<app>`; with neither, the bare prefix. The person is never dropped: with no app the app part is empty. The width (D-1898) and the open state (D-1909) share this one scheme; the open state of the `screen` layout is its own setting, `open-screen` (D-1919). */
export function sidebarKey(setting: 'width' | 'open' | 'open-screen', app?: string, person?: string): string {
  const part = (value: string | undefined) => `:${encodeURIComponent(value ?? '')}`;
  return `boring-ui:sidebar-${setting}${app || person ? part(app) : ''}${person ? part(person) : ''}`;
}
/** The stored width's key: `boring-ui:sidebar-width:<app>:<person>`. */
export function sidebarWidthKey(app?: string, person?: string): string {
  return sidebarKey('width', app, person);
}
const MIN_REM = 12;
const MAX_REM = 28;
const STEP_REM = 1;

export type SidebarResizable = boolean | { readonly min?: number; readonly max?: number };

export interface SidebarResize {
  /** The storage key of this app and person: a drag started under another key is cancelled. */
  readonly storageKey: string;
  readonly minRem: number;
  readonly maxRem: number;
  /** The wrapper's style: the chosen `--sidebar-width`, or none (the theme's width). */
  readonly style: CSSProperties | undefined;
  readonly widthRem: number | null;
  readonly set: (rem: number, commit: boolean) => void;
  readonly reset: () => void;
}

function readStored(key: string, min: number, max: number): number | null {
  try {
    const stored = window.localStorage.getItem(key) ?? '';
    // The whole value must be a number: `20garbage` is not 20rem.
    return /^\d+(\.\d+)?$/.test(stored) ? Math.min(max, Math.max(min, Number(stored))) : null;
  } catch {
    return null;
  }
}

function writeStored(key: string, rem: number | null) {
  try {
    if (rem === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, String(rem));
  } catch {
    // storage unavailable: the width lasts for this visit only
  }
}

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
const rootRem = () => Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
const roundRem = (rem: number) => Math.round(rem * 10) / 10;

/** The resize state of the shell. `undefined` while `resizable` is off or the pointer is not fine. Call it where the SidebarProvider is rendered. */
export function useSidebarResize(resizable: SidebarResizable | undefined, identity: { readonly app?: string | undefined; readonly person?: string | undefined } = {}): SidebarResize | undefined {
  const storageKey = sidebarWidthKey(identity.app, identity.person);
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
  useIsoLayoutEffect(() => { if (active) setWidthRem(readStored(storageKey, minRem, maxRem)); }, [active, storageKey, minRem, maxRem]);
  const set = useCallback((rem: number, commit: boolean) => {
    const next = Math.min(maxRem, Math.max(minRem, rem));
    setWidthRem(next);
    if (commit) writeStored(storageKey, next);
  }, [storageKey, minRem, maxRem]);
  const reset = useCallback(() => { setWidthRem(null); writeStored(storageKey, null); }, [storageKey]);
  const style = useMemo<CSSProperties | undefined>(() => (active && widthRem !== null ? ({ '--sidebar-width': `${widthRem}rem` } as CSSProperties) : undefined), [active, widthRem]);
  return useMemo(() => (active ? { storageKey, minRem, maxRem, style, widthRem, set, reset } : undefined), [active, storageKey, minRem, maxRem, style, widthRem, set, reset]);
}

// The rail's look is the host sidebar's own (same classes), so the handle sits exactly where the toggle did.
const RAIL = cn(
  'absolute inset-y-0 z-20 hidden w-4 transition-all ease-linear group-data-[side=left]:-right-4 group-data-[side=right]:left-0 after:absolute after:inset-y-0 after:start-1/2 after:w-[2px] hover:after:bg-sidebar-border sm:flex ltr:-translate-x-1/2 rtl:-translate-x-1/2',
  'group-data-[collapsible=offcanvas]:translate-x-0 group-data-[collapsible=offcanvas]:after:left-full hover:group-data-[collapsible=offcanvas]:bg-sidebar',
  '[[data-side=left][data-collapsible=offcanvas]_&]:-right-2 [[data-side=right][data-collapsible=offcanvas]_&]:-left-2',
  'cursor-col-resize touch-none',
);

const ResizeContext = createContext<SidebarResize | undefined>(undefined);

export type ResizableSidebarProviderProps = ComponentProps<typeof SidebarProvider> & {
  /** `true` or `{ min, max }` in rem (12 and 28). Off: this is the host's SidebarProvider. */
  readonly resizable?: SidebarResizable | undefined;
  /** The app's name and the signed-in person's id or email: the stored width is theirs. With no person it is the app's. */
  readonly app?: string | undefined;
  readonly person?: string | undefined;
};

/** The host's SidebarProvider with a resizable left pane, for an app that renders the provider itself. Put `ResizableRail` in the Sidebar where `SidebarRail` was. */
export function ResizableSidebarProvider({ resizable, app, person, style, ...props }: ResizableSidebarProviderProps) {
  const resize = useSidebarResize(resizable, { app, person });
  return <ResizeContext value={resize}><SidebarProvider style={resize?.style ? { ...style, ...resize.style } : style} {...props} /></ResizeContext>;
}

/** The rail of the sidebar: the host's toggle, or, under a resizable provider (fine pointer, expanded, wide), the drag handle. */
export function ResizableRail() {
  const resize = useContext(ResizeContext);
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
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => setMeasured(element.getBoundingClientRect().width / rootRem()));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const direction = () => (ref.current?.closest('[data-side]')?.getAttribute('data-side') === 'right' ? -1 : 1);
  const to = (start: { x: number; rem: number; sign: number }, clientX: number) => start.rem + ((clientX - start.x) * start.sign) / rootRem();
  // The sidebar animates its width; following the pointer must not lag behind it. The inline transitions are put back as they were when the drag
  // ends however it ends: release, cancel, a lost pointer capture, or the handle leaving (Ctrl+B mid-drag collapses the sidebar and unmounts it).
  const held = useRef<Array<readonly [HTMLElement, string]>>([]);
  const settle = useCallback(() => {
    for (const [element, transition] of held.current) element.style.transition = transition;
    held.current = [];
  }, []);
  const follow = (on: boolean) => {
    if (!on) { settle(); return; }
    settle();
    const wrapper = ref.current?.closest('[data-slot=sidebar-wrapper]');
    for (const element of wrapper?.querySelectorAll<HTMLElement>('[data-slot=sidebar-gap], [data-slot=sidebar-container]') ?? []) {
      held.current.push([element, element.style.transition]);
      element.style.transition = 'none';
    }
  };
  // The drag belongs to the key it started under: if the person (or app) changes mid-drag, it is cancelled, so the width is never written under the
  // other key. The hook has already read that key's own width. The same cleanup puts the transitions back when the handle leaves.
  useEffect(() => () => { drag.current = null; settle(); }, [resize.storageKey, settle]);
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
    onLostPointerCapture={() => { drag.current = null; follow(false); }}
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
