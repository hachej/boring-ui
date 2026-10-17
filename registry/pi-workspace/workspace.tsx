'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { cn } from '../utils/utils';

/** What the open panel can do to its workspace. Pass `onFullscreenChange` on to the viewer's top bar; it is absent in the phone sheet. */
export interface WorkspacePanelApi {
  readonly fullscreen: boolean;
  /** Absent on a phone, where the panel is already a full-screen sheet. */
  readonly onFullscreenChange: ((next: boolean) => void) | undefined;
  readonly close: () => unknown;
  readonly sheet: boolean;
  /** Float the chat over the panel (see `floatBelow`). Absent without `floatBelow`, while the chat already floats and in the phone sheet. pi-app's `AgentWorkspace` turns it into the viewers' "Float chat" action (`ViewerWindow.actions`). */
  readonly floatChat: (() => void) | undefined;
}

/** What `chat` can render as a function: whether the chat floats over the full-width panel, and how to put it back beside it. */
export interface WorkspaceChatLayout {
  readonly floating: boolean;
  readonly dock: () => void;
}

export interface ArtifactWorkspaceProps {
  /**
   * Usually a `PiChat`. It stays mounted while the panel opens, resizes, goes full screen and closes. With `floatBelow`, pass a function that
   * returns the docked chat or, while `floating`, an `AmbientChat` on the same controller (`onDock` there is `dock`): the chat is then a different surface over one session.
   */
  readonly chat: ReactNode | ((layout: WorkspaceChatLayout) => ReactNode);
  /** Whether the panel is open. Closing is the host's decision (`onClose`); the workspace never unmounts `chat`. */
  readonly open: boolean;
  /** The panel content, usually a viewer whose top bar is the shared `ViewerFrame`. Receives what it needs for its close and full screen buttons. */
  readonly panel: ReactNode | ((api: WorkspacePanelApi) => ReactNode);
  /** Return false when a synchronous host guard refuses to close; Back then restores the sheet entry. */
  readonly onClose: () => unknown;
  /** Full screen is controlled when both are given; otherwise the workspace keeps it. Escape leaves it. */
  readonly fullscreen?: boolean;
  readonly onFullscreenChange?: (next: boolean) => void;
  /** Width of the panel is remembered for this browser session under this key. */
  readonly storageKey?: string;
  /** Initial panel width in pixels, before the person drags the divider. */
  readonly defaultWidth?: number;
  readonly minPanel?: number;
  readonly minChat?: number;
  /** Below this container width the panel is a full-screen sheet and the divider is gone. */
  readonly sheetBelow?: number;
  /**
   * Opt in to a floating chat: when the divider is dragged until the chat is narrower than this many pixels, a hint appears and releasing floats the chat
   * (the panel takes the full width). Alt+Left on the divider and `api.floatChat` do the same without a pointer. Remembered for the session; ignored in the phone sheet.
   * Off by default.
   */
  readonly floatBelow?: number;
  /** The panel's accessible name. */
  readonly panelLabel?: string;
  /**
   * `split` (default): the panel is a full-height column with a hard border and a visible divider. `inset`: the panel is a rounded card inside the
   * workspace (a margin around it, a border and a soft shadow on the card only) and the divider remains visible and strengthens on hover, focus or drag, so the panel
   * reads as part of the chat's own surface, as in Claude's artifact panel. Resizing works the same.
   */
  readonly variant?: 'split' | 'inset';
  /** The divider's accessible name and the hint shown while a drag would float the chat. */
  readonly labels?: { readonly resize?: string | undefined; readonly floatHint?: string | undefined } | undefined;
  readonly className?: string;
}

const STEP = 24, BIG_STEP = 96;
const read = (key: string): number | undefined => { try { const value = Number(sessionStorage.getItem(key)); return Number.isFinite(value) && value > 0 ? value : undefined; } catch { return undefined; } };
const write = (key: string, value: number) => { try { sessionStorage.setItem(key, String(Math.round(value))); } catch { /* the width is a convenience */ } };
const readFlag = (key: string): boolean => { try { return sessionStorage.getItem(key) === '1'; } catch { return false; } };
const writeFlag = (key: string, on: boolean) => { try { if (on) sessionStorage.setItem(key, '1'); else sessionStorage.removeItem(key); } catch { /* the layout is a convenience */ } };

/**
 * Chat with an artifact panel beside it, as in Claude's chat apps. The panel opens on the right at full height and the chat
 * narrows; a divider (pointer or arrow keys) resizes it, the width is remembered for the session; the panel can go full screen
 * (Escape leaves) and on a phone it is a full-screen sheet. With `floatBelow` the chat can float over a full-width panel instead of sitting beside it. The workspace owns layout only: what is open, and the viewer in it, are the host's.
 */
export function ArtifactWorkspace({ chat, open, panel, onClose, fullscreen: controlledFullscreen, onFullscreenChange, storageKey = 'boring.artifact-panel.width', defaultWidth,
  minPanel = 360, minChat = 360, sheetBelow = 641, floatBelow, panelLabel = 'Artifact panel', variant = 'split', labels, className }: ArtifactWorkspaceProps) {
  const root = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(0);
  const [stored, setStored] = useState<number | undefined>(() => read(storageKey) ?? defaultWidth);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const fullscreenRef = useRef(false);
  const opener = useRef<HTMLElement | null>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const [local, setLocal] = useState(false);
  const [entered, setEntered] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [floatHint, setFloatHint] = useState(false);
  const [floatState, setFloatState] = useState(() => floatBelow !== undefined && readFlag(`${storageKey}.floating`));
  const controlled = controlledFullscreen !== undefined && onFullscreenChange !== undefined;
  const sheet = size > 0 && size < sheetBelow;
  const floating = open && !sheet && floatBelow !== undefined && floatState;
  const fullscreen = open && !sheet && (controlled ? controlledFullscreen : local);
  fullscreenRef.current = fullscreen;
  const setFullscreen = useCallback((next: boolean) => { if (controlled) onFullscreenChange!(next); else setLocal(next); }, [controlled, onFullscreenChange]);

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
  const setFloating = useCallback((next: boolean) => { setFloatState(next); setFloatHint(false); writeFlag(`${storageKey}.floating`, next); }, [storageKey]);
  useEffect(() => {
    // With the panel closed there is nothing to float over: the chat docks back.
    if (!open) { setEntered(false); setLocal(false); setFloating(false); return; }
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, [open, setFloating]);
  useEffect(() => {
    if (!fullscreen) return;
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) setFullscreen(false); };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [fullscreen, setFullscreen]);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || fullscreenRef.current) return;
      event.preventDefault(); closeRef.current();
    };
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('keydown', escape);
      const previous = opener.current;
      const target = previous?.isConnected && previous !== document.body ? previous : root.current?.querySelector<HTMLElement>('[data-testid=composer-input]');
      target?.focus({ preventScroll: true });
    };
  }, [open]);
  useEffect(() => {
    if (!open || !sheet) return;
    const key = `artifact-${Math.random()}`;
    const history = window.history;
    const enter = () => history.pushState({ ...history.state, boringArtifact: key }, '');
    enter();
    const back = () => {
      if (history.state?.boringArtifact === key) return;
      void Promise.resolve(closeRef.current()).then(closed => { if (closed === false) enter(); });
    };
    window.addEventListener('popstate', back);
    return () => { window.removeEventListener('popstate', back); if (history.state?.boringArtifact === key) history.back(); };
  }, [open, sheet]); // The mounted sheet keeps its own Back entry, independent of renders.

  const max = Math.max(minPanel, size - minChat);
  const width = Math.min(Math.max(stored ?? Math.max(minPanel, size - 420), minPanel), max);
  const resize = (next: number) => { const clamped = Math.min(Math.max(next, minPanel), max); setStored(clamped); write(storageKey, clamped); };
  const drag = (event: PointerEvent<HTMLElement>) => {
    if (!dragging) return;
    const box = root.current?.getBoundingClientRect();
    if (!box) return;
    const target = box.right - event.clientX;
    // Past the threshold the width stays at the last one above it; releasing there floats the chat.
    const below = floatBelow !== undefined && size - target < floatBelow;
    setFloatHint(below);
    if (!below) resize(target);
  };
  const release = (event: PointerEvent<HTMLElement>) => { event.currentTarget.releasePointerCapture(event.pointerId); setDragging(false); if (floatHint) setFloating(true); setFloatHint(false); };
  const keys = (event: KeyboardEvent<HTMLElement>) => {
    if (floatBelow !== undefined && event.altKey && event.key === 'ArrowLeft') { event.preventDefault(); setFloating(true); return; }
    const step = event.shiftKey ? BIG_STEP : STEP;
    const next = event.key === 'ArrowLeft' ? width + step : event.key === 'ArrowRight' ? width - step : event.key === 'Home' ? max : event.key === 'End' ? minPanel : undefined;
    if (next === undefined) return;
    event.preventDefault(); resize(next);
  };

  const api: WorkspacePanelApi = { fullscreen, onFullscreenChange: sheet ? undefined : setFullscreen, close: onClose, sheet, floatChat: floatBelow !== undefined && !sheet && !floating ? () => setFloating(true) : undefined };
  const covering = open && (sheet || fullscreen);
  // The inset panel is drawn by the host's Card behind it (a sibling layer, so a placement change never remounts the panel);
  // every other placement is a plain region of the page.
  const inset = variant === 'inset' && !sheet && !fullscreen && !floating;
  return <div ref={root} data-boring="artifact-workspace" data-open={open ? 'true' : 'false'} data-fullscreen={fullscreen ? 'true' : 'false'} data-sheet={sheet && open ? 'true' : 'false'}
    className={cn('relative flex h-full min-h-0 min-w-0 flex-1', className)}>
    <div data-testid="workspace-chat" data-floating={floating ? 'true' : undefined} {...(covering ? { inert: true, 'aria-hidden': true } : {})}
      className={cn('relative flex min-h-0 min-w-0 flex-col', floating ? 'w-0 flex-none' : 'flex-1', covering && 'invisible')}>
      {typeof chat === 'function' ? chat({ floating, dock: () => setFloating(false) }) : chat}
      {floatHint && <div role="status" data-testid="workspace-float-hint" className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-background/75 p-4">
        <Badge variant="secondary">{labels?.floatHint ?? 'Release to float the chat'}</Badge>
      </div>}
    </div>
    {open && <>
      {!sheet && !fullscreen && !floating && <div role="separator" tabIndex={0} aria-orientation="vertical" aria-label={labels?.resize ?? 'Resize artifact panel'} aria-valuemin={minPanel} aria-valuemax={max} aria-valuenow={Math.round(width)}
        data-testid="workspace-divider" data-dragging={dragging ? 'true' : undefined}
        onPointerDown={event => { event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); setDragging(true); }} onPointerMove={drag}
        onPointerUp={release} onPointerCancel={() => { setDragging(false); setFloatHint(false); }}
        onKeyDown={keys} onDoubleClick={() => resize(defaultWidth ?? size - 420)}
        className="group relative z-10 -mx-1.5 w-3 shrink-0 cursor-col-resize touch-none select-none outline-none">
        <span aria-hidden="true" className={cn('absolute inset-y-0 left-1/2 w-px -translate-x-1/2', 'bg-border/65', 'transition-colors group-hover:w-0.5 group-hover:bg-ring group-focus-visible:w-0.5 group-focus-visible:bg-ring motion-reduce:transition-none', dragging && 'w-0.5 bg-ring')} />
      </div>}
      <aside onTouchStart={event => { const point = event.touches[0]; swipe.current = sheet && point && point.clientX < 32 ? { x: point.clientX, y: point.clientY } : null; }} onTouchEnd={event => { const point = event.changedTouches[0], start = swipe.current; swipe.current = null; if (point && start && point.clientX - start.x > 80 && Math.abs(point.clientY - start.y) < 60) onClose(); }} data-testid="workspace-panel" aria-label={panelLabel} data-state={entered ? 'open' : 'entering'} data-floating={floating ? 'true' : undefined} data-fullscreen={fullscreen ? 'true' : 'false'} data-sheet={sheet ? 'true' : 'false'}
        style={sheet || fullscreen || floating ? undefined : { width, minWidth: minPanel }}
        className={cn('flex min-h-0 min-w-0 flex-col overflow-hidden transition-opacity motion-reduce:transition-none', !inset && 'bg-background text-foreground',
          sheet || fullscreen ? 'fixed inset-0 z-50' : floating ? 'flex-1' : inset ? 'relative isolate my-3 me-3 ms-0 shrink-0' : 'shrink-0',
          entered ? 'opacity-100' : 'opacity-0', dragging && 'pointer-events-none select-none')}>
        {inset && <Card aria-hidden="true" data-boring="chrome" className="pointer-events-none absolute inset-0 -z-10" />}
        {typeof panel === 'function' ? panel(api) : panel}
      </aside>
    </>}
  </div>;
}
