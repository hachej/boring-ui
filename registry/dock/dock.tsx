'use client';

import { readPersisted, writePersisted } from '../utils/persisted';

import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { cn } from '../utils/utils';

/**
 * Composable docks: `DockLayout` is a row holding one `DockMain` (the page's own content, an app for example) and any number of
 * `Dock`s on its left or right (a chat, a list of sessions, a file explorer, an artifact panel). Each dock is resizable from its inner
 * edge and has its own placement: docked, closed, floating (the content renders its own floating surface, for example `AmbientChat`) or,
 * on a narrow layout, a full-screen sheet. `useDock(id)` reaches a dock from anywhere inside the layout, so a button in a chat header can
 * open the files or detach the chat. Layout only: what the docks show is the host's.
 */

/** What a dock is doing now. `floating` keeps the content mounted in a zero-width slot so it can render its own floating surface. */
export type DockPlacement = 'page' | 'docked' | 'floating' | 'sheet' | 'closed';

/** What a dock and the controls around it can do. */
export interface DockApi {
  readonly id: string;
  readonly placement: DockPlacement;
  readonly open: boolean;
  readonly floating: boolean;
  /** Whether the layout is wide enough to dock it (false below `narrowBelow`). */
  readonly canDock: boolean;
  readonly width: number;
  /** Page fills the main area; docked sits beside it; floating uses the host's ambient surface. Opens the dock. */
  readonly setPlacement: (next: 'page' | 'docked' | 'floating') => void;
  readonly setOpen: (next: boolean) => void;
  readonly toggle: () => void;
  /** Float it (only for a `floatable` dock). Opens it if closed. */
  readonly float: () => void;
  /** Put it back beside the main content at its last docked width. Opens it if closed. */
  readonly dock: () => void;
  /** Set the docked width (clamped and remembered like a drag), for example to widen a dock while it shows a document. */
  readonly setWidth: (width: number) => void;
}

export interface DockLayoutProps {
  readonly children: ReactNode;
  /** Prefix of the remembered widths, placements and open states (`<storageKey>.<dock id>.width`, …). */
  readonly storageKey?: string;
  /** `session` (default) remembers the layout for the browser tab; `local` across visits. */
  readonly persist?: 'session' | 'local';
  /** The main content is never narrower than this while docks are beside it. */
  readonly minMain?: number;
  readonly className?: string;
}

export interface DockProps {
  readonly id: string;
  readonly side: 'left' | 'right';
  /** The dock's content, or a function of its api (to render a floating surface while `floating`, or a close button). Stays mounted in every placement. */
  readonly children: ReactNode | ((api: DockApi) => ReactNode);
  readonly defaultWidth?: number;
  readonly minWidth?: number;
  /** Opt in to floating: dragging below `dragBelow`, Alt+Arrow towards the edge and `api.float` float it, and it floats when the layout is narrow. */
  readonly floatable?: boolean;
  /**
   * Dragging the divider until the dock would be narrower than this shows a hint and releasing floats it (`floatable`) or closes it.
   * Absent: the dock stops at `minWidth`.
   */
  readonly dragBelow?: number;
  /** Below this layout width the dock cannot be docked: it floats (`floatable`), becomes a full-screen sheet while open (`narrow: 'sheet'`) or is hidden. */
  readonly narrowBelow?: number;
  readonly narrow?: 'float' | 'sheet' | 'hide';
  /** Controlled open state (with `onOpenChange`); uncontrolled from `defaultOpen` (true) and remembered otherwise. */
  readonly open?: boolean;
  readonly defaultOpen?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  /** Floating at first, before the person docks it. */
  readonly defaultFloating?: boolean;
  /** Initial placement. Takes precedence over defaultFloating; remembered choices take precedence over both. */
  readonly defaultPlacement?: 'page' | 'docked' | 'floating';
  /**
   * While docked, the dock is the containing block of its content's fixed overlays (a full-screen sheet, a drawer, a viewer's full screen):
   * they cover the dock, not the page. Floating and sheet placements are unaffected.
   */
  readonly contained?: boolean;
  readonly onPlacementChange?: (placement: DockPlacement) => void;
  /** The region's and the divider's accessible names, and the hint shown while a drag would float or close the dock. */
  readonly labels?: { readonly region?: string | undefined; readonly resize?: string | undefined; readonly floatHint?: string | undefined; readonly closeHint?: string | undefined } | undefined;
  readonly className?: string;
}

export interface DockMainProps { readonly children: ReactNode; readonly className?: string }

interface DockRecord { readonly width?: number | undefined; readonly placement?: 'page' | 'docked' | 'floating' | undefined; readonly floating?: boolean | undefined; readonly open?: boolean | undefined }
interface LayoutContext {
  readonly size: number;
  readonly minMain: number;
  readonly records: Readonly<Record<string, DockRecord>>;
  readonly apis: Readonly<Record<string, DockApi>>;
  readonly update: (id: string, patch: DockRecord) => void;
  readonly publish: (id: string, api: DockApi | undefined) => void;
  readonly read: (id: string) => DockRecord;
  readonly occupied: (except: string) => number;
}
const Layout = createContext<LayoutContext | null>(null);
const STEP = 24, BIG_STEP = 96;

/** The row of docks and main content. Measures its own width, so it works inside any container. */
export function DockLayout({ children, storageKey = 'boring.dock', persist = 'session', minMain = 360, className }: DockLayoutProps) {
  const root = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(0);
  const [records, setRecords] = useState<Record<string, DockRecord>>({});
  const [apis, setApis] = useState<Record<string, DockApi>>({});
  const widths = useRef<Record<string, number>>({});
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = () => setSize(element.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const read = useCallback((id: string): DockRecord => {
    const get = (name: string) => readPersisted(`${storageKey}.${id}.${name}`, persist);
    const width = Number(get('width')), floating = get('floating'), open = get('open'), placement = get('placement');
    return { width: Number.isFinite(width) && width > 0 ? width : undefined, placement: placement === 'page' || placement === 'docked' || placement === 'floating' ? placement : undefined,
      floating: floating === null ? undefined : floating === '1', open: open === null ? undefined : open === '1' };
  }, [persist, storageKey]);
  const update = useCallback((id: string, patch: DockRecord) => {
    setRecords(current => ({ ...current, [id]: { ...current[id], ...patch } }));
    for (const [name, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      writePersisted(`${storageKey}.${id}.${name}`, typeof value === 'boolean' ? (value ? '1' : '0') : typeof value === 'number' ? String(Math.round(value)) : value, persist);
    }
  }, [persist, storageKey]);
  const publish = useCallback((id: string, api: DockApi | undefined) => {
    widths.current = { ...widths.current, [id]: api?.placement === 'docked' ? api.width : 0 };
    setApis(current => {
      if (api === undefined) { const { [id]: _removed, ...rest } = current; return rest; }
      const previous = current[id];
      return previous && sameApi(previous, api) ? current : { ...current, [id]: api };
    });
  }, []);
  const occupied = useCallback((except: string) => Object.entries(widths.current).reduce((total, [id, width]) => id === except ? total : total + width, 0), []);
  const value = useMemo(() => ({ size, minMain, records, apis, update, publish, read, occupied }), [size, minMain, records, apis, update, publish, read, occupied]);
  return <Layout.Provider value={value}>
    <div ref={root} data-boring="dock-layout" className={cn('relative flex h-full min-h-0 min-w-0 flex-1', className)}>{children}</div>
  </Layout.Provider>;
}

const sameApi = (a: DockApi, b: DockApi) => a.placement === b.placement && a.open === b.open && a.width === b.width && a.canDock === b.canDock;

/** The page's own content between the docks; it takes the remaining width. */
export function DockMain({ children, className }: DockMainProps) {
  const layout = useContext(Layout);
  const replaced = Object.values(layout?.apis ?? {}).some(api => api.placement === 'page');
  return <main data-boring="dock-main" hidden={replaced} inert={replaced} className={cn('relative min-h-0 min-w-0 flex-1 flex-col overflow-hidden', replaced ? 'hidden' : 'flex', className)}>{children}</main>;
}

/** A dock's api from anywhere inside the `DockLayout` (undefined until that dock has rendered). */
export function useDock(id: string): DockApi | undefined {
  const layout = useContext(Layout);
  if (!layout) throw new Error('useDock must be used inside a DockLayout');
  return layout.apis[id];
}

/** One dock beside the main content. Order the children as they should appear: left docks, `DockMain`, right docks. */
export function Dock({ id, side, children, defaultWidth = 400, minWidth = 280, floatable = false, dragBelow, narrowBelow, narrow = floatable ? 'float' : 'hide',
  open: controlledOpen, defaultOpen = true, onOpenChange, defaultFloating = false, defaultPlacement, contained = false, onPlacementChange, labels, className }: DockProps) {
  const layout = useContext(Layout);
  if (!layout) throw new Error('Dock must be used inside a DockLayout');
  const { size, minMain, update, publish, occupied } = layout;
  const [initial] = useState(() => layout.read(id));
  const record = { ...initial, ...layout.records[id] };
  const [dragging, setDragging] = useState(false);
  const [hint, setHint] = useState(false);
  const section = useRef<HTMLElement>(null);
  const controlled = controlledOpen !== undefined;
  const open = controlled ? controlledOpen : record.open ?? defaultOpen;
  const narrowNow = narrowBelow !== undefined && size > 0 && size < narrowBelow;
  const chosen = record.placement ?? (record.floating === undefined ? defaultPlacement ?? (defaultFloating ? 'floating' : 'docked') : record.floating ? 'floating' : 'docked');
  const placement: DockPlacement = !open ? 'closed'
    : chosen === 'page' ? 'page'
    : narrowNow ? (narrow === 'float' && floatable ? 'floating' : narrow === 'sheet' ? 'sheet' : 'closed')
    : chosen === 'floating' && floatable ? 'floating' : 'docked';
  const max = Math.max(minWidth, size - minMain - occupied(id));
  const width = Math.round(Math.min(Math.max(record.width ?? defaultWidth, minWidth), max));

  const setOpen = useCallback((next: boolean) => { if (!controlled) update(id, { open: next }); onOpenChange?.(next); }, [controlled, id, onOpenChange, update]);
  const setPlacement = useCallback((next: 'page' | 'docked' | 'floating') => {
    if (next === 'floating' && !floatable) return;
    update(id, { placement: next, floating: next === 'floating' });
    if (!open) setOpen(true);
  }, [floatable, id, open, setOpen, update]);
  const api: DockApi = {
    id, placement, open, floating: placement === 'floating', canDock: !narrowNow, width,
    setPlacement, setOpen, toggle: () => setOpen(!open),
    float: () => setPlacement('floating'),
    dock: () => setPlacement('docked'),
    setWidth: (next: number) => resize(next),
  };
  // eslint-disable-next-line react-hooks/refs -- latest-value ref: useDock's stable actions may run from a consumer's layout effect, before this component's own effects
  const latest = useRef(api); latest.current = api;
  // What `useDock` hands out: the current state, with actions that always reach this render's dock.
  const actions = useMemo(() => ({ setPlacement: (next: 'page' | 'docked' | 'floating') => latest.current.setPlacement(next), setOpen: (next: boolean) => latest.current.setOpen(next), toggle: () => latest.current.toggle(), float: () => latest.current.float(), dock: () => latest.current.dock(), setWidth: (next: number) => latest.current.setWidth(next) }), []);
  useLayoutEffect(() => { publish(id, { ...latest.current, ...actions }); });
  useLayoutEffect(() => () => publish(id, undefined), [id, publish]);
  const reported = useRef(placement);
  useLayoutEffect(() => { if (reported.current !== placement) { reported.current = placement; onPlacementChange?.(placement); } }, [placement, onPlacementChange]);

  const resize = (next: number) => update(id, { width: Math.min(Math.max(next, minWidth), max) });
  // Past `dragBelow` the dock keeps its last width; releasing there floats or closes it.
  const drag = (event: PointerEvent<HTMLElement>) => {
    if (!dragging) return;
    const box = section.current?.getBoundingClientRect();
    if (!box) return;
    const target = side === 'left' ? event.clientX - box.left : box.right - event.clientX;
    const below = dragBelow !== undefined && target < dragBelow;
    setHint(below);
    if (!below) resize(target);
  };
  const leave = () => { if (floatable) api.float(); else setOpen(false); };
  const release = (event: PointerEvent<HTMLElement>) => { event.currentTarget.releasePointerCapture?.(event.pointerId); setDragging(false); if (hint) leave(); setHint(false); };
  const keys = (event: KeyboardEvent<HTMLElement>) => {
    const outward = side === 'left' ? 'ArrowLeft' : 'ArrowRight', inward = side === 'left' ? 'ArrowRight' : 'ArrowLeft';
    if (event.altKey && event.key === outward && (floatable || dragBelow !== undefined)) { event.preventDefault(); leave(); return; }
    const step = event.shiftKey ? BIG_STEP : STEP;
    const next = event.key === inward ? width + step : event.key === outward ? width - step : event.key === 'Home' ? minWidth : event.key === 'End' ? max : undefined;
    if (next === undefined) return;
    event.preventDefault(); resize(next);
  };

  const docked = placement === 'docked';
  const divider = docked && <div role="separator" tabIndex={0} aria-orientation="vertical" aria-label={labels?.resize ?? 'Resize panel'} aria-valuemin={minWidth} aria-valuemax={max} aria-valuenow={width}
    data-testid={`dock-divider-${id}`} data-dragging={dragging ? 'true' : undefined}
    // No text selection or native drag from the divider: after a double-click reset, the next press must still resize.
    onPointerDown={event => { event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture?.(event.pointerId); setDragging(true); }} onPointerMove={drag}
    onDragStart={event => event.preventDefault()}
    onPointerUp={release} onPointerCancel={() => { setDragging(false); setHint(false); }} onKeyDown={keys} onDoubleClick={() => resize(defaultWidth)}
    className="group relative z-10 -mx-1.5 w-3 shrink-0 cursor-col-resize touch-none select-none outline-none">
    <span aria-hidden="true" className={cn('absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/65 transition-[width,background-color] group-hover:w-0.5 group-hover:bg-ring group-focus-visible:w-0.5 group-focus-visible:bg-ring motion-reduce:transition-none', dragging && 'w-0.5 bg-ring')} />
  </div>;
  const hidden = placement === 'closed';
  const panel = <section ref={section} data-boring="dock" data-dock={id} data-side={side} data-placement={placement} aria-label={labels?.region}
    {...(hidden ? { hidden: true, inert: true } : {})}
    style={docked ? { width } : undefined}
    className={cn('relative flex min-h-0 min-w-0 flex-col', docked && 'shrink-0 overflow-hidden bg-background text-foreground', (docked || placement === 'page') && contained && '[contain:layout]', placement === 'page' && 'flex-1 overflow-hidden bg-background text-foreground',
      placement === 'floating' && 'w-0 flex-none overflow-visible', placement === 'sheet' && 'fixed inset-0 z-50 bg-background text-foreground', hidden && 'hidden',
      dragging && '[&_iframe]:pointer-events-none select-none', className)}>
    {typeof children === 'function' ? children(api) : children}
    {hint && <div role="status" data-testid={`dock-hint-${id}`} className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-background/75 p-4">
      <span className="text-sm font-medium text-foreground">
        {floatable ? labels?.floatHint ?? 'Release to float' : labels?.closeHint ?? 'Release to close'}</span>
    </div>}
  </section>;
  return side === 'left' ? <>{panel}{divider}</> : <>{divider}{panel}</>;
}
