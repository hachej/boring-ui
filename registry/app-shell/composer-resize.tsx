'use client';

// The open conversation's top edge as a handle (`shell-composer-resize`): drag it to make the window taller or shorter, or use the keys. It is a horizontal separator on the edge the
// controller strip sits on (the strip stays on top and keeps its buttons). While dragging the height goes straight into the two CSS variables the tray and its frame already read, so
// nothing re-renders per move; the release commits it to the layer, which remembers it per app and person. Host concern: Pi has no layout.
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { cn } from '../utils/utils';
import { shellWords, useInternal } from './layer-context';

/** The window's least height (px): its header and about three messages; the bar is not part of it. */
export const TRAY_MIN = 240;
const STEP = 24;
const BIG_STEP = 96;
/** The gap kept between the window's top edge and the header (or the viewport's top), in px. */
const MARGIN = 16;
const SIZE_VAR = '--app-shell-bar-tray-size';
const EXPANDED_VAR = '--app-shell-bar-tray-expanded';

/** The element that carries the two variables while the handle changes them: the floating frame, or the composer's box. */
const hostOf = (handle: HTMLElement): HTMLElement | null => handle.closest<HTMLElement>('[data-testid=composer-floating]') ?? handle.closest<HTMLElement>('[data-one-composer]');

/** The least and greatest height the window can take now, and the height it has. The greatest keeps the window under the header (in the page) or inside the viewport (floating). */
function measure(handle: HTMLElement): { readonly min: number; readonly max: number; readonly now: number } | null {
  const box = handle.closest<HTMLElement>('[data-one-composer]');
  const tray = box?.querySelector<HTMLElement>('[data-testid=agent-tray]');
  if (!box || !tray) return null;
  const bar = box.getBoundingClientRect();
  const floating = handle.closest('[data-testid=composer-floating]') !== null;
  const room = floating ? window.innerHeight - bar.height - 2 * MARGIN : bar.top - (handle.closest('[data-testid=agent-content]')?.getBoundingClientRect().top ?? 0) - MARGIN;
  return { min: TRAY_MIN, max: Math.max(TRAY_MIN, Math.floor(room)), now: Math.round(tray.getBoundingClientRect().height) };
}

export function ResizeHandle() {
  const layer = useInternal();
  const { trayHeight, setTrayHeight, size, setSize } = layer;
  const text = shellWords(layer.locale ?? layer.agent?.chatProps?.locale, layer.agent);
  const ref = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState({ min: TRAY_MIN, max: TRAY_MIN, now: TRAY_MIN });
  const drag = useRef<{ readonly y: number; readonly height: number; moved: boolean; last: number } | null>(null);
  const clamp = (value: number, from: { readonly min: number; readonly max: number }) => Math.min(Math.max(value, from.min), from.max);

  // The range follows the window: what the person set, a resize of the viewport, another level. A remembered height that no longer fits is brought back inside it.
  useLayoutEffect(() => {
    const read = () => {
      const handle = ref.current;
      const next = handle && measure(handle);
      if (!next) return;
      setRange(before => before.min === next.min && before.max === next.max && before.now === next.now ? before : next);
      if (size === 'open' && trayHeight !== undefined && !drag.current && (trayHeight > next.max || trayHeight < next.min)) setTrayHeight(clamp(trayHeight, next));
    };
    read();
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, [trayHeight, size, setTrayHeight]);

  const apply = useCallback((height: number | null) => {
    const host = ref.current && hostOf(ref.current);
    if (!host) return;
    for (const name of [SIZE_VAR, EXPANDED_VAR]) { if (height === null) host.style.removeProperty(name); else host.style.setProperty(name, `${height}px`); }
  }, []);
  const commit = useCallback((height: number | undefined) => { setTrayHeight(height); setSize('open'); }, [setTrayHeight, setSize]);
  const current = () => (ref.current && measure(ref.current)) ?? range;

  const stop = () => { document.body.style.removeProperty('user-select'); drag.current = null; };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.style.setProperty('user-select', 'none');
    drag.current = { y: event.clientY, height: current().now, moved: false, last: current().now };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const held = drag.current;
    if (!held) return;
    const bounds = current();
    const next = Math.round(clamp(held.height + held.y - event.clientY, bounds));
    if (next === held.last && held.moved) return;
    held.moved = true;
    held.last = next;
    apply(next);
    event.currentTarget.setAttribute('aria-valuenow', String(next));
  };
  const onPointerUp = () => {
    const held = drag.current;
    stop();
    if (held?.moved) commit(held.last);
  };
  const onPointerCancel = () => {
    const held = drag.current;
    stop();
    if (held?.moved) { apply(trayHeight ?? null); setRange(before => ({ ...before })); }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const bounds = current();
    const by = event.shiftKey ? BIG_STEP : STEP;
    const target = event.key === 'ArrowUp' ? bounds.now + by : event.key === 'ArrowDown' ? bounds.now - by : event.key === 'Home' ? bounds.min : event.key === 'End' ? bounds.max : null;
    if (target === null && event.key !== 'Enter') return;
    event.preventDefault();
    commit(target === null ? undefined : clamp(target, bounds));
  };

  return <div ref={ref} role="separator" aria-orientation="horizontal" tabIndex={0} data-testid="composer-resize" aria-label={text.resizeHandle} title={text.resizeHandle}
    aria-valuenow={range.now} aria-valuemin={range.min} aria-valuemax={range.max}
    onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel} onLostPointerCapture={onPointerCancel} onKeyDown={onKeyDown} onDoubleClick={() => commit(undefined)}
    style={{ top: `calc(0px - var(${SIZE_VAR}))` }}
    className={cn('group/resize pointer-events-auto absolute inset-x-0 z-lifted h-1.5 -translate-y-1/2 cursor-ns-resize touch-none select-none outline-none',
      'pointer-coarse:h-11 pointer-coarse:-translate-y-[calc(100%-0.25rem)]')}>
    {/* On hover and keyboard focus the border thickens to a 2 px line with a short grip bar; the strip sits over the middle, so the grip is drawn a quarter in. */}
    <span aria-hidden="true" className="pointer-events-none absolute inset-x-4 top-1/2 h-0.5 -translate-y-1/2 bg-ring opacity-0 transition-opacity duration-(--duration-fast) group-[:hover]/resize:opacity-100 group-[:focus-visible]/resize:opacity-100 group-[:active]/resize:opacity-100 motion-reduce:transition-none pointer-coarse:top-[calc(100%-0.125rem)]" />
    <span aria-hidden="true" className="pointer-events-none absolute top-1/2 left-1/4 h-1.5 w-10 -translate-x-1/2 -translate-y-1/2 rounded-(--radius-3xl) bg-ring opacity-0 transition-opacity duration-(--duration-fast) group-[:hover]/resize:opacity-100 group-[:focus-visible]/resize:opacity-100 group-[:active]/resize:opacity-100 motion-reduce:transition-none pointer-coarse:top-[calc(100%-0.125rem)]" />
  </div>;
}
