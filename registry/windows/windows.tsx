'use client';

import { PHONE_BELOW, usePhone } from '../utils/use-media';
import { readPersistedJson, writePersistedJson } from '../utils/persisted';

// Host concern: Pi has no window layout. These surfaces borrow their content and remember presentation only.
import { createPortal } from 'react-dom';
import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState, useId } from 'react';
import type { KeyboardEvent, PointerEvent, ReactNode, RefObject } from 'react';
import { GripIcon, MinusIcon, PanelsTopLeftIcon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useDraggable } from '../utils/use-draggable';
export { useDraggable } from '../utils/use-draggable';
export type { DragPosition } from '../utils/use-draggable';

export interface WindowRect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export type WindowStatus = 'closed' | 'open' | 'minimized';
export interface WindowApi {
  readonly id: string;
  readonly status: WindowStatus;
  readonly rect: WindowRect;
  readonly open: () => void;
  readonly close: () => void;
  readonly minimize: () => void;
}
interface WindowRecord { readonly rect: WindowRect; readonly status: WindowStatus }
interface WindowState { readonly records: Readonly<Record<string, WindowRecord>>; readonly order: readonly string[]; readonly focus: string | null; readonly request: number }
interface WindowsContext {
  readonly state: WindowState;
  readonly phone: boolean;
  readonly host: HTMLDivElement | null;
  readonly launcher: RefObject<HTMLButtonElement | null>;
  readonly register: (id: string, rect: WindowRect, open: boolean) => () => void;
  readonly change: (id: string, status: WindowStatus) => void;
  readonly raise: (id: string) => void;
  readonly resize: (id: string, rect: WindowRect) => void;
}
const Windows = createContext<WindowsContext | null>(null);
const DEFAULT_RECT: WindowRect = { x: 48, y: 64, width: 400, height: 320 };
const MIN_WIDTH = 240, MIN_HEIGHT = 160;
const windowRecord = (records: WindowState['records'], id: string): WindowRecord | undefined => Object.hasOwn(records, id) ? records[id] : undefined;
const useWindows = () => { const value = useContext(Windows); if (!value) throw new Error('Windows need a WindowLayer'); return value; };
const clamp = (rect: WindowRect): WindowRect => {
  const width = Math.min(Math.max(rect.width, MIN_WIDTH), window.innerWidth), height = Math.min(Math.max(rect.height, MIN_HEIGHT), window.innerHeight);
  return { width, height, x: Math.min(Math.max(rect.x, 0), Math.max(0, window.innerWidth - width)), y: Math.min(Math.max(rect.y, 0), Math.max(0, window.innerHeight - height)) };
};
type Edges = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
/** The rectangle after dragging `edges` of `start` by (dx, dy): the opposite edges stay put, the minimum and the viewport bound the rest. */
const edgeRect = (start: WindowRect, edges: Edges, dx: number, dy: number): WindowRect => {
  let { x, y, width, height } = start;
  if (edges.includes('e')) width = Math.min(Math.max(start.width + dx, MIN_WIDTH), Math.max(MIN_WIDTH, window.innerWidth - start.x));
  if (edges.includes('s')) height = Math.min(Math.max(start.height + dy, MIN_HEIGHT), Math.max(MIN_HEIGHT, window.innerHeight - start.y));
  if (edges.includes('w')) { const right = start.x + start.width; x = Math.min(Math.max(start.x + dx, 0), right - MIN_WIDTH); width = right - x; }
  if (edges.includes('n')) { const bottom = start.y + start.height; y = Math.min(Math.max(start.y + dy, 0), bottom - MIN_HEIGHT); height = bottom - y; }
  return { x, y, width, height };
};
const HANDLES: readonly { readonly edges: Edges; readonly className: string }[] = [
  { edges: 'n', className: 'inset-x-2 top-0 h-1.5 cursor-n-resize' }, { edges: 's', className: 'inset-x-2 bottom-0 h-1.5 cursor-s-resize' },
  { edges: 'w', className: 'inset-y-2 left-0 w-1.5 cursor-w-resize' }, { edges: 'e', className: 'inset-y-2 right-0 w-1.5 cursor-e-resize' },
  { edges: 'nw', className: 'left-0 top-0 size-2 cursor-nw-resize' }, { edges: 'ne', className: 'right-0 top-0 size-2 cursor-ne-resize' },
  { edges: 'sw', className: 'bottom-0 left-0 size-2 cursor-sw-resize' },
];
const validRect = (rect: unknown): rect is WindowRect => !!rect && typeof rect === 'object' && ['x', 'y', 'width', 'height'].every(key => typeof (rect as Record<string, unknown>)[key] === 'number' && Number.isFinite((rect as Record<string, number>)[key])) && (rect as WindowRect).width > 0 && (rect as WindowRect).height > 0;

/** One viewport window stack. Like DockLayout, persistence is tab-local unless `persist="local"` is selected. */
export function WindowLayer({ children, storageKey = 'boring.windows', persist = 'session' }: { readonly children: ReactNode; readonly storageKey?: string; readonly persist?: 'session' | 'local' }) {
  const [state, setState] = useState<WindowState>({ records: {}, order: [], focus: null, request: 0 });
  const current = useRef(state), mounted = useRef(new Set<string>()), launcher = useRef<HTMLButtonElement>(null);
  const phone = usePhone();
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const commit = useCallback((next: WindowState) => { current.current = next; setState(next); }, []);
  const save = useCallback((id: string, record: WindowRecord) => writePersistedJson(`${storageKey}.${id}`, record, persist), [persist, storageKey]);
  const register = useCallback((id: string, rect: WindowRect, open: boolean) => {
    if (mounted.current.has(id)) throw new Error(`Duplicate floating window id: ${id}`);
    mounted.current.add(id);
    let record = windowRecord(current.current.records, id) ?? { rect, status: open ? 'open' : 'closed' } as WindowRecord;
    try {
      const saved = readPersistedJson(`${storageKey}.${id}`, persist);
      if (saved && typeof saved === 'object' && 'rect' in saved && validRect(saved.rect) && 'status' in saved && (saved.status === 'closed' || saved.status === 'open' || saved.status === 'minimized')) record = { rect: saved.rect, status: saved.status };
    } catch { /* malformed or unavailable storage leaves the default */ }
    record = { ...record, rect: window.innerWidth < PHONE_BELOW ? record.rect : clamp(record.rect) };
    const previous = current.current, order = previous.order.filter(key => key !== id);
    if (record.status === 'open') order.push(id);
    commit({ ...previous, records: { ...previous.records, [id]: record }, order, focus: record.status === 'open' ? id : previous.focus, request: previous.request + (record.status === 'open' ? 1 : 0) });
    return () => {
      mounted.current.delete(id);
      const previous = current.current, { [id]: _removed, ...records } = previous.records;
      commit({ ...previous, records, order: previous.order.filter(key => key !== id) });
    };
  }, [commit, persist, storageKey]);
  const change = useCallback((id: string, status: WindowStatus) => {
    const previous = current.current, record = windowRecord(previous.records, id); if (!record || !mounted.current.has(id)) return;
    const order = previous.order.filter(key => key !== id); if (status === 'open') order.push(id);
    const next = { ...record, status }; save(id, next);
    commit({ records: { ...previous.records, [id]: next }, order, focus: status === 'open' ? id : order.at(-1) ?? null, request: previous.request + 1 });
  }, [commit, save]);
  const raise = useCallback((id: string) => {
    const previous = current.current;
    if (windowRecord(previous.records, id)?.status !== 'open' || previous.order.at(-1) === id) return;
    commit({ ...previous, order: [...previous.order.filter(key => key !== id), id] });
  }, [commit]);
  const resize = useCallback((id: string, rect: WindowRect) => {
    const previous = current.current, record = windowRecord(previous.records, id); if (!record || !validRect(rect)) return;
    const next = { ...record, rect: clamp(rect) }; save(id, next); commit({ ...previous, records: { ...previous.records, [id]: next } });
  }, [commit, save]);
  useLayoutEffect(() => {
    const measure = () => {
      const narrow = window.innerWidth < PHONE_BELOW;
      if (!narrow) for (const [id, record] of Object.entries(current.current.records)) resize(id, record.rect);
    };
    measure(); window.addEventListener('resize', measure); return () => window.removeEventListener('resize', measure);
  }, [resize]);
  useLayoutEffect(() => { if (state.request && state.focus === null) launcher.current?.focus({ preventScroll: true }); }, [state.focus, state.request]);
  const value = useMemo(() => ({ state, phone, host, launcher, register, change, raise, resize }), [state, phone, host, register, change, raise, resize]);
  return <Windows.Provider value={value}>{children}<div ref={setHost} data-boring="window-layer" className="pointer-events-none fixed inset-0 z-40 isolate" /></Windows.Provider>;
}

/** Reach a window from controls anywhere inside its layer (undefined until the FloatingWindow registers). */
export function useWindow(id: string): WindowApi | undefined {
  const { state, change } = useWindows(), record = windowRecord(state.records, id);
  return useMemo(() => record ? { id, ...record, open: () => change(id, 'open'), close: () => change(id, 'closed'), minimize: () => change(id, 'minimized') } : undefined, [id, record, change]);
}

/** Non-modal on desktop; the front window uses the host's full-screen Drawer below 768px. */
export function FloatingWindow({ id, title, children, defaultRect = DEFAULT_RECT, defaultOpen = false }: {
  readonly id: string; readonly title: string; readonly children: ReactNode; readonly defaultRect?: WindowRect; readonly defaultOpen?: boolean;
}) {
  const { state, phone, host, launcher, register, change, raise, resize } = useWindows();
  const initial = useRef({ defaultRect, defaultOpen });
  useLayoutEffect(() => register(id, initial.current.defaultRect, initial.current.defaultOpen), [id, register]);
  const record = windowRecord(state.records, id), rect = record?.rect ?? defaultRect, visible = record?.status === 'open';
  const box = useRef<HTMLDivElement>(null), titleId = useId();
  const front = state.order.at(-1) === id;
  const position = useMemo(() => ({ left: rect.x, top: rect.y }), [rect.x, rect.y]);
  const move = useCallback((next: { left: number; top: number }) => resize(id, { ...rect, x: next.left, y: next.top }), [id, rect, resize]);
  const drag = useDraggable({ box, position, onPositionChange: move, enabled: !phone && visible });
  const focus = () => box.current?.querySelector<HTMLElement>('button, input, textarea, select, a[href], [tabindex="0"]') ?? box.current;
  useLayoutEffect(() => { if (visible && state.focus === id) focus()?.focus({ preventScroll: true }); }, [visible, state.focus, state.request, id, phone]);
  const sizing = useRef<{ x: number; y: number; rect: WindowRect; edges: Edges } | null>(null);
  const startResize = (edges: Edges, event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture?.(event.pointerId);
    sizing.current = { x: event.clientX, y: event.clientY, rect, edges };
  };
  const moveResize = (event: PointerEvent<HTMLElement>) => { const start = sizing.current; if (start) resize(id, edgeRect(start.rect, start.edges, event.clientX - start.x, event.clientY - start.y)); };
  const endResize = () => { sizing.current = null; };
  const resizeKey = (event: KeyboardEvent<HTMLElement>) => {
    const step = event.shiftKey ? 96 : 24;
    const width = rect.width + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0), height = rect.height + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0);
    if (width === rect.width && height === rect.height) return;
    event.preventDefault(); resize(id, { ...rect, width, height });
  };
  const controls = <>
    <Button variant="ghost" size="icon" aria-label={`Minimize ${title}`} onClick={() => change(id, 'minimized')}><MinusIcon data-icon="inline-start" aria-hidden="true" /></Button>
    <Button variant="ghost" size="icon" aria-label={`Close ${title}`} onClick={() => change(id, 'closed')}><XIcon data-icon="inline-start" aria-hidden="true" /></Button>
  </>;
  if (phone) return <Drawer open={visible && front} onOpenChange={open => { if (!open && visible && front) change(id, 'closed'); }}>
    <DrawerContent ref={box} data-window={id} data-placement="fullscreen" aria-describedby={undefined} initialFocus={focus} finalFocus={() => state.focus === null ? launcher.current : false}
      style={{ inset: 0, width: '100%', height: '100dvh', maxHeight: '100dvh', transform: 'none' }}>
      <DrawerHeader><div className="flex items-center gap-2"><DrawerTitle className="flex-1">{title}</DrawerTitle>{controls}</div></DrawerHeader>
      <div data-base-ui-swipe-ignore="" className="flex min-h-0 flex-1 flex-col overflow-auto p-4">{children}</div>
    </DrawerContent>
  </Drawer>;
  return host ? createPortal(<Card className="pointer-events-auto" ref={box} role="dialog" aria-modal={false} aria-labelledby={titleId} tabIndex={-1} hidden={!visible} inert={!visible} data-window={id} data-placement="floating"
    style={{ position: 'fixed', left: rect.x, top: rect.y, width: rect.width, height: rect.height, zIndex: 1 + state.order.indexOf(id), display: visible ? undefined : 'none' }}
    onPointerDownCapture={() => raise(id)} onFocusCapture={() => raise(id)} onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented) { event.stopPropagation(); change(id, 'closed'); } }}>
    <CardHeader data-window-drag="" {...drag} className="cursor-move touch-none select-none">
      <CardTitle id={titleId}>{title}</CardTitle><CardAction className="flex items-center gap-1">{controls}</CardAction>
    </CardHeader>
    <CardContent className="min-h-0 flex-1 overflow-auto">{children}</CardContent>
    <Button variant="ghost" size="icon-sm" data-window-resize="se" aria-label={`Resize ${title}`} className="absolute bottom-0 right-0 cursor-se-resize touch-none"
      onPointerDown={event => startResize('se', event)} onPointerMove={moveResize} onPointerUp={endResize} onPointerCancel={endResize} onKeyDown={resizeKey}>
      <GripIcon data-icon="inline-start" aria-hidden="true" />
    </Button>
    {HANDLES.map(handle => <div key={handle.edges} data-window-resize={handle.edges} aria-hidden="true" className={`absolute touch-none ${handle.className}`}
      onPointerDown={event => startResize(handle.edges, event)} onPointerMove={moveResize} onPointerUp={endResize} onPointerCancel={endResize} />)}
  </Card>, host) : null;
}

/** The host supplies the available windows; the native menu owns arrow keys, typeahead and Escape. */
export function WindowLauncher({ windows, label = 'Windows' }: { readonly windows: readonly { readonly id: string; readonly title: string }[]; readonly label?: string }) {
  const { state, change, launcher } = useWindows(), selected = useRef(false);
  return <DropdownMenu onOpenChange={open => { if (open) selected.current = false; }}>
    <DropdownMenuTrigger render={<Button ref={launcher} variant="outline" data-window-launcher="" />}><PanelsTopLeftIcon data-icon="inline-start" aria-hidden="true" />{label}</DropdownMenuTrigger>
    <DropdownMenuContent finalFocus={() => selected.current ? false : true}>
      <DropdownMenuGroup>{windows.map(item => {
        const record = windowRecord(state.records, item.id);
        return <DropdownMenuItem key={item.id} disabled={!record} data-window-open={record && record.status !== 'closed' ? 'true' : undefined}
          onClick={() => { selected.current = true; change(item.id, 'open'); }}>
          <span className="flex-1">{item.title}</span>{record && record.status !== 'closed' && <Badge variant="secondary">{record.status === 'minimized' ? 'Minimized' : 'Open'}</Badge>}
        </DropdownMenuItem>;
      })}</DropdownMenuGroup>
    </DropdownMenuContent>
  </DropdownMenu>;
}
