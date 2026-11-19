'use client';

// The one composer floating over a page (`floatingComposer`) and folded to its icon. `FloatFrame` is the bar detached: fixed over the page, which stays usable under it, moved by its
// grip (pointer drag, arrow keys); dropped near a corner it snaps there. The place is the person's, remembered per app and person (`composer-pos`). `ComposerFab` is the round
// button the bar folds into: the unread mark and the needs-you ring of the conversation, and a tap puts everything back where it was. Host concern: Pi has no layout.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { SparklesIcon } from '../_shared/icons';
import { UnreadMark } from '../_shared/controller-strip';
import { Button } from '@/components/ui/button';
import { useDraggable } from '../utils/use-draggable';
import type { DragPosition } from '../utils/use-draggable';
import { cn } from '../utils/utils';
import { GripContext } from './composer-grip';
import type { GripHandlers } from './composer-grip';
import { shellWords, useInternal } from './layer-context';
import type { FloatCorner, FloatPos } from './layer-context';

/** The gap kept between the floating bar and the window's edge, in px. */
const MARGIN = 16;
/** A drop this close (px, on both axes) to a corner's place snaps to that corner. */
const SNAP = 120;
const STEP = 16;
const BIG_STEP = 64;
const ARROWS: Readonly<Record<string, readonly [number, number]>> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), Math.max(low, high));
export const cornerOf = (pos: FloatPos, width = 0, height = 0): FloatCorner => 'corner' in pos ? pos.corner
  : `${pos.top + height / 2 < window.innerHeight / 2 ? 't' : 'b'}${pos.left + width / 2 < window.innerWidth / 2 ? 'l' : 'r'}`;

/** The corner a dropped rect is close enough to, if any. */
function snapCorner(rect: { readonly left: number; readonly top: number; readonly width: number; readonly height: number }): FloatCorner | undefined {
  for (const corner of ['tl', 'tr', 'bl', 'br'] as const) {
    const left = corner.endsWith('l') ? MARGIN : window.innerWidth - rect.width - MARGIN;
    const top = corner.startsWith('t') ? MARGIN : window.innerHeight - rect.height - MARGIN;
    if (Math.abs(rect.left - left) <= SNAP && Math.abs(rect.top - top) <= SNAP) return corner;
  }
  return undefined;
}

/** The CSS of a place. A top-anchored bar with the window open keeps room above it for the window. */
function placement(pos: FloatPos, trayOpen: boolean): CSSProperties {
  const room = `calc(var(--app-shell-bar-tray-size) + ${MARGIN}px)`;
  const top = (px: number) => trayOpen ? `max(${px}px, ${room})` : px;
  if ('corner' in pos) return { ...(pos.corner.endsWith('l') ? { left: MARGIN } : { right: MARGIN }), ...(pos.corner.startsWith('t') ? { top: top(MARGIN) } : { bottom: `max(${MARGIN}px, env(safe-area-inset-bottom))` }) };
  return { left: pos.left, top: top(pos.top) };
}

/**
 * The standalone entry's notices (`FloatingComposer notices`), drawn by whichever place the composer is in: above the floating bar (below it when the bar sits in a top corner),
 * above the folded icon, above the bottom bar. Null for a composer with no notices, so the shell's own places carry nothing.
 */
export const NoticeSlotContext = createContext<ReactNode>(null);

/** Where the notices sit around a box: above it, or below it for a bar in a top corner (above would leave the window). */
export function NoticeSlot({ below = false, className }: { readonly below?: boolean; readonly className?: string }) {
  const notices = useContext(NoticeSlotContext);
  if (!notices) return null;
  return <div data-testid="composer-notices" className={cn('absolute inset-x-0', below ? 'top-full' : 'bottom-full', className)}>{notices}</div>;
}

/** The bar detached from the page: `children` is the one composer's box. */
export function FloatFrame({ children }: { readonly children: ReactNode }) {
  const layer = useInternal();
  const { floatPos, setFloatPos, trayOpen } = layer;
  const box = useRef<HTMLDivElement>(null);
  // The place while the grip is held, and after a clamp; committed (and remembered) when the grip is released.
  const [live, setLive] = useState<DragPosition | null>(null);
  const moved = useRef(false);
  // The last place the drag asked for: a release reads it, not the DOM, which the last move has not been drawn into yet.
  const latest = useRef<DragPosition | null>(null);
  const pos: FloatPos = live ?? floatPos;
  const free = 'left' in pos ? pos : null;
  const place = useCallback((next: DragPosition) => { moved.current = true; latest.current = next; setLive(next); }, []);
  const drag = useDraggable({ box, position: free, onPositionChange: place, enabled: true });
  const commit = useCallback(() => {
    const size = box.current?.getBoundingClientRect();
    const at = latest.current;
    if (!size || !at) return;
    const corner = snapCorner({ ...at, width: size.width, height: size.height });
    setFloatPos(corner ? { corner } : { left: Math.round(at.left), top: Math.round(at.top) });
    setLive(null);
  }, [setFloatPos]);
  const handlers = useMemo<GripHandlers>(() => ({
    onPointerDown: event => { moved.current = false; latest.current = null; drag.onPointerDown(event); },
    onPointerMove: drag.onPointerMove,
    onPointerUp: () => { drag.onPointerUp(); if (moved.current) commit(); moved.current = false; },
    onPointerCancel: () => { drag.onPointerCancel(); if (moved.current) commit(); moved.current = false; },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      const way = ARROWS[event.key];
      const rect = box.current?.getBoundingClientRect();
      if (!way || !rect) return;
      event.preventDefault();
      const step = event.shiftKey ? BIG_STEP : STEP;
      setFloatPos({ left: Math.round(clamp(rect.left + way[0] * step, 0, window.innerWidth - rect.width)), top: Math.round(clamp(rect.top + way[1] * step, 0, window.innerHeight - rect.height)) });
      setLive(null);
    },
  }), [drag, commit, setFloatPos]);
  const text = shellWords(layer.locale ?? layer.agent?.chatProps?.locale, layer.agent);
  const tall = layer.size === 'open' && layer.trayHeight !== undefined ? `${layer.trayHeight}px` : 'min(26rem, 55dvh)';
  const style = { ...placement(pos, trayOpen), ...(trayOpen ? { '--app-shell-bar-tray-size': tall, '--app-shell-bar-tray-expanded': tall } : {}) } as CSSProperties;
  return <GripContext.Provider value={handlers}>
    <div ref={box} data-testid="composer-floating" data-corner={'corner' in pos ? pos.corner : undefined} role="group" aria-label={text.assistant} style={style}
      className="fixed z-(--app-shell-z-layer) w-[min(22rem,calc(100vw-2rem))]">{children}<NoticeSlot below={cornerOf(pos, 0, 0).startsWith('t')} /></div>
  </GripContext.Provider>;
}

/** The round button the composer folds into. A tap restores the bar where it was (floating, or the window if it was open). */
export function ComposerFab() {
  const layer = useInternal();
  const { signals, floatPos, expanded, tabbar, restore, placeFocus: focusRef } = layer;
  const text = shellWords(layer.locale ?? layer.agent?.chatProps?.locale, layer.agent);
  const button = useRef<HTMLButtonElement>(null);
  // A person who pressed Minimise keeps their place: focus lands on the icon.
  useEffect(() => { if (focusRef.current) { focusRef.current = false; button.current?.focus({ preventScroll: true }); } }, [focusRef]);
  const corner = expanded ? cornerOf(floatPos, 352, 56) : 'br';
  const Icon = layer.agent?.icon ?? SparklesIcon;
  const style: CSSProperties = expanded
    ? { ...(corner.endsWith('l') ? { left: MARGIN } : { right: MARGIN }), ...(corner.startsWith('t') ? { top: MARGIN } : { bottom: `max(${MARGIN}px, env(safe-area-inset-bottom))` }) }
    : { right: MARGIN, bottom: `calc(${tabbar}px + max(${MARGIN}px, env(safe-area-inset-bottom)))` };
  const label = signals.unread ? `${text.restore} (${signals.unread.label}${signals.unread.count && signals.unread.count > 1 ? `, ${signals.unread.count}` : ''})` : text.restore;
  return <span style={style} className={cn('fixed z-(--app-shell-z-layer) size-13 rounded-pm-round shadow-pm-popover', signals.needsYou && 'ring-2 ring-warning outline-3 outline-warning/25')}>
    <Button ref={button} type="button" size="icon" data-testid="composer-icon" data-needs-you={signals.needsYou || undefined} aria-label={label} title={text.restore} onClick={restore}>
      <Icon aria-hidden="true" />
      {signals.unread && <UnreadMark unread={signals.unread} dot="top-0 right-0" pill="-top-1 -right-2" />}
    </Button>
    <NoticeSlot below={corner.startsWith('t')} className={cn('w-[min(22rem,calc(100vw-2rem))]', corner.endsWith('l') ? 'left-0 right-auto' : 'right-0 left-auto')} />
  </span>;
}
