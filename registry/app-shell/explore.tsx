'use client';

// `composer="explore"`: the same composer in a mode for screens people read (tables, charts). Closed on every visit: the page keeps its whole width and nothing sits at the bottom;
// a small « Ask » toggle at the bottom right opens the panel. Open, the panel pushes the page from 1100 px, overlays it below that, and is the bottom sheet on a phone (`CompactSheet`,
// the same drawer as every other mode). It reuses the layer's chat, title row, History and notices: no second chat component. The closed toggle carries what the icon carries
// (the unread mark, the needs-you ring), so a result that arrives while closed is never silent. Host concern: Pi has no layout.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react';
import { UnreadMark } from '../_shared/controller-strip';
import { Separator } from '@/components/ui/separator';
import { useMedia } from '../utils/use-media';
import { cn } from '../utils/utils';
import { useLookingAt } from './agent-context';
import { ChatSlot, Header, useTitle } from './agent-chats';
import { VoiceProblem } from './agent-bar-parts';
import { shellWords, useInternal } from './layer-context';
import { LauncherNote, OpenFullButton, escapeInFeedback, useNote } from './composer-actions';
import { layerStyle, useCornerPlace } from './composer-place';

/** The panel pushes the page from this viewport width (px); below it the panel overlays the page. A phone (below 768) has the bottom sheet. */
export const EXPLORE_PUSH_FROM = 1100;
export const EXPLORE_PUSH_QUERY = `(width >= ${EXPLORE_PUSH_FROM}px)`;
const EXPLORE_DEFAULT = 384;
const EXPLORE_MIN = 320;
const EXPLORE_MAX = 720;
/** The page keeps at least this much beside a pushing panel (px), and an overlay leaves this much of the page's edge visible. */
const MIN_PAGE = 360;
const EDGE = 48;
const STEP = 24;
const BIG_STEP = 96;
const FIELD = '[data-spec=agent] [data-testid=composer-input]';

/** Where explore stands: whether the mode is on (with an agent), whether the panel is open, and how it shows at this width. */
export function useExplorePlace(): { readonly active: boolean; readonly open: boolean; readonly mode: 'push' | 'overlay' | 'sheet' } {
  const layer = useInternal();
  const wide = useMedia(EXPLORE_PUSH_QUERY);
  const active = layer.explore && layer.agent !== undefined;
  return { active, open: active && layer.showing === 'agent', mode: !layer.expanded ? 'sheet' : wide ? 'push' : 'overlay' };
}

/** « You are looking at »: the app's `context`, at the top of the panel (and of the sheet). Absent when the app gives none. */
export function ExploreContextLine() {
  const layer = useInternal();
  const looking = layer.lookingAt;
  if (!layer.explore || !looking) return null;
  const text = shellWords(layer.locale ?? layer.agent?.chatProps?.locale, layer.agent);
  return <div data-testid="explore-context" className="mx-3 mb-2 flex shrink-0 flex-col gap-0.5 rounded-(--radius-3xl) bg-muted px-3 py-2 text-xs text-muted-foreground">
    <span data-testid="explore-context-label" className="font-medium text-primary">{text.lookingAt}</span>
    <span data-testid="explore-context-title" className="text-sm font-medium text-foreground wrap-anywhere">{looking.title}</span>
    {looking.detail && <span data-testid="explore-context-detail" className="wrap-anywhere">{looking.detail}</span>}
  </div>;
}

/** The toggle: a small tab at the bottom right, above the phone's tab bar and inside the safe areas. It shows the unread dot and the needs-you ring of the closed conversation. */
export function ExploreToggle() {
  const layer = useInternal();
  const { open } = useExplorePlace();
  const { signals, expanded, tabbar } = layer;
  const text = shellWords(layer.locale ?? layer.agent?.chatProps?.locale, layer.agent);
  const unread = signals.unread;
  const label = unread ? `${text.ask} (${unread.label}${unread.count && unread.count > 1 ? `, ${unread.count}` : ''})` : text.ask;
  const box = useRef<HTMLSpanElement>(null);
  const note = useNote();
  // A config object places the tab by its `at.offset` (flush with the edge by default), `at.stack`, `avoid` and `layer`; a string keeps the place it always had.
  const placed = useCornerPlace({ ref: box, corner: 'bottom-end', defaults: { inline: 0, block: expanded ? 'max(1rem, env(safe-area-inset-bottom))' : `calc(${tabbar}px + max(1rem, env(safe-area-inset-bottom)))` }, size: { w: 30, h: 76 }, active: !open && !layer.suspended });
  const style: CSSProperties = placed.style ?? { right: 'env(safe-area-inset-right, 0px)', bottom: expanded ? 'max(1rem, env(safe-area-inset-bottom))' : `calc(${tabbar}px + max(1rem, env(safe-area-inset-bottom)))` };
  if (layer.suspended) return null;
  // The approved tab: slim (30 px by 76 px), flush with the right edge, with its inner corners curved, the label set vertically; the unread mark sits on its top corner.
  return <span ref={box} hidden={open} style={style} data-composer={layer.composerFlags.id} data-testid="explore-place" className={cn('fixed z-(--app-shell-z-layer) h-19 w-7.5 rounded-l-(--radius-lg) shadow-pm-popover', signals.needsYou && 'ring-2 ring-warning outline-3 outline-warning/25')}>
    <button type="button" data-testid="explore-toggle" data-needs-you={signals.needsYou || undefined} aria-label={label} aria-expanded={open} aria-keyshortcuts="Control+J Meta+J" title={`${text.ask} (Ctrl+J)`} onClick={() => layer.open('agent')}
      style={{ writingMode: 'vertical-rl' }}
      className="relative flex size-full items-center justify-center rounded-l-(--radius-lg) bg-primary text-xs font-medium tracking-wider text-primary-foreground outline-ring select-none before:absolute before:-inset-2 before:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2">{text.ask}</button>
    {unread && <UnreadMark unread={unread} dot="-top-1 -left-1" pill="-top-2 -left-3" className="ring-2 ring-background" />}
    {note && <LauncherNote note={note} />}
  </span>;
}

/** Ctrl or Cmd + J toggles; Esc closes the panel (the sheet's own Esc is the drawer's); focus goes into the field on open and back to the toggle on close; the context travels with the turn. */
export function ExploreController() {
  const layer = useInternal();
  const { open, mode } = useExplorePlace();
  useLookingAt(layer.lookingAt);
  const now = useRef({ open, mode, layer });
  useLayoutEffect(() => { now.current = { open, mode, layer }; });
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      const { open: isOpen, mode: place, layer: api } = now.current;
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'j') {
        event.preventDefault();
        if (isOpen) api.close(); else api.open('agent');
        return;
      }
      if (event.key !== 'Escape' || event.defaultPrevented || !isOpen || place === 'sheet' || escapeInFeedback(event)) return;
      // A list, menu or file opened over the panel takes its own Escape first.
      if (document.querySelector('[data-testid=conversations], [data-testid=agent-preview]') || (event.target instanceof Element && event.target.closest('[role=menu], [role=listbox], [aria-haspopup][aria-expanded=true]'))) return;
      event.preventDefault();
      api.close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  const was = useRef(open);
  const { host } = layer;
  useEffect(() => {
    if (was.current === open) return;
    was.current = open;
    let frame = 0, tries = 0;
    const land = () => {
      const held = document.activeElement;
      if (open) {
        // A phone's sheet keeps the keyboard down until the person taps the field (which also grows the sheet): focus stays on the sheet.
        if (now.current.mode === 'sheet') return;
        const field = host?.querySelector<HTMLElement>(FIELD);
        field?.focus({ preventScroll: true });
        if (field && document.activeElement === field) return;
      } else {
        // Only when focus is nowhere (the closed panel took it with it): a view that opened meanwhile keeps its own.
        if (held && held !== document.body && !held.closest('[data-testid=explore-toggle]')) return;
        const toggle = document.querySelector<HTMLElement>('[data-testid=explore-toggle]');
        toggle?.focus({ preventScroll: true });
        if (toggle && document.activeElement === toggle) return;
      }
      if (++tries < 12) frame = requestAnimationFrame(land);
    };
    land();
    return () => cancelAnimationFrame(frame);
  }, [open, host]);
  return null;
}

/** The panel's side edge: a vertical separator (drag, arrow keys, Home and End, double-click to reset). The release commits the width, which the layer remembers per app and person. */
function ResizeEdge({ mode, width, live, commit }: { readonly mode: 'push' | 'overlay'; readonly width: number; readonly live: (width: number | undefined) => void; readonly commit: (width: number | undefined) => void }) {
  const layer = useInternal();
  const text = shellWords(layer.locale ?? layer.agent?.chatProps?.locale, layer.agent);
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ readonly x: number; readonly width: number; last: number; moved: boolean } | null>(null);
  const bounds = useCallback(() => {
    const row = mode === 'push' ? ref.current?.parentElement?.parentElement?.clientWidth : undefined;
    const room = (row || window.innerWidth) - (mode === 'push' ? MIN_PAGE : EDGE);
    return { min: EXPLORE_MIN, max: Math.max(EXPLORE_MIN, Math.min(EXPLORE_MAX, room)) };
  }, [mode]);
  const clamp = (value: number) => { const { min, max } = bounds(); return Math.round(Math.min(Math.max(value, min), max)); };
  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { x: event.clientX, width, last: width, moved: false };
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const held = drag.current;
    if (!held) return;
    const next = clamp(held.width + held.x - event.clientX);
    if (next === held.last && held.moved) return;
    held.moved = true; held.last = next;
    live(next);
  };
  const up = () => { const held = drag.current; drag.current = null; if (held?.moved) commit(held.last); };
  const cancel = () => { const held = drag.current; drag.current = null; if (held?.moved) live(undefined); };
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    const by = event.shiftKey ? BIG_STEP : STEP;
    const { min, max } = bounds();
    const target = event.key === 'ArrowLeft' ? width + by : event.key === 'ArrowRight' ? width - by : event.key === 'Home' ? min : event.key === 'End' ? max : null;
    if (target === null && event.key !== 'Enter') return;
    event.preventDefault();
    commit(target === null ? undefined : clamp(target));
  };
  return <div ref={ref} role="separator" tabIndex={0} aria-orientation="vertical" data-testid="explore-resize" aria-label={text.resizeExplore} title={text.resizeExplore} aria-valuenow={width} aria-valuemin={EXPLORE_MIN} aria-valuemax={EXPLORE_MAX}
    onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel} onLostPointerCapture={cancel} onKeyDown={keys} onDoubleClick={() => commit(undefined)}
    className="group/resize absolute inset-y-0 -left-1.5 z-20 w-3 cursor-col-resize touch-none select-none outline-none">
    <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-[width,background-color] duration-(--duration-fast) group-hover/resize:w-0.5 group-hover/resize:bg-ring group-focus-visible/resize:w-0.5 group-focus-visible/resize:bg-ring group-active/resize:w-0.5 group-active/resize:bg-ring motion-reduce:transition-none" />
  </div>;
}

/** The open panel on a wide screen: beside the page (`push`, in the dock layout's row) or over it (`overlay`). The same title row, History, chat and field as the dock, with the context line on top. */
export function ExplorePanel({ mode }: { readonly mode: 'push' | 'overlay' }) {
  const layer = useInternal();
  const { text, title } = useTitle();
  const [dragged, setDragged] = useState<number | undefined>(undefined);
  const width = dragged ?? layer.exploreWidth ?? EXPLORE_DEFAULT;
  const commit = useCallback((next: number | undefined) => { setDragged(undefined); layer.setExploreWidth(next); }, [layer]);
  const push = mode === 'push';
  return <aside data-testid="explore-panel" data-mode={mode} data-composer={layer.composerFlags.id} role={push ? 'complementary' : 'dialog'} aria-label={title}
    style={{ ...layerStyle(layer, 1), width, maxWidth: push ? `calc(100% - ${MIN_PAGE / 16 + 0.5}rem)` : `calc(100vw - ${EDGE / 16}rem)` }}
    className={cn('app-shell flex min-h-0 flex-col bg-card text-card-foreground', push ? 'relative h-full shrink-0' : 'fixed inset-y-0 right-0 z-(--app-shell-z-layer) shadow-pm-popover')}>
    <Separator orientation="vertical" className="absolute inset-y-0 left-0" />
    <ResizeEdge mode={mode} width={width} live={setDragged} commit={commit} />
    <Header text={text} title={title} controls={<OpenFullButton />} />
    <ExploreContextLine />
    <VoiceProblem />
    <ChatSlot />
  </aside>;
}
