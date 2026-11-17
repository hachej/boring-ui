'use client';

// The wide placements: the dock (docked or floating), the content column with its tray and anchor, the preview column, and the layer root.
import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ComponentType, ReactElement, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDownIcon, ChevronUpIcon, MaximizeIcon, PanelBottomIcon, PanelLeftIcon, PanelRightIcon, PictureInPicture2Icon, XIcon } from '../_shared/icons';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Dock, DockLayout, DockMain } from '../dock/dock';
import { useDraggable } from '../utils/use-draggable';
import type { DockApi } from '../dock/dock';
import { NoteBubble } from '../feedback/feedback-session';
import { feedbackLabelsFr } from '../feedback/feedback-labels';
import { CommentBanner, useCommenting, usePointing } from '../feedback/point-mode';
import { cn } from '../utils/utils';
import { useBackLayer } from '../utils/back';
import { DOCK_KEY, FOLDED_FIELD, LayerContext, MIN_MAIN, PM_COLUMN, TRAY_MAX, useInternal } from './layer-context';
import type { DockSide } from './layer-context';
import { OneBox, VoiceProblem } from './agent-bar-parts';
import { ChatSlot, Header, HeaderHint, HistoryButton, LibraryButton, useTitle } from './agent-chats';
import { CompactSheet } from './agent-compact';
import { PaneDock, PaneStack } from './agent-pane';

/** The panel inside the dock: the same element docked or floating, so a placement change keeps focus and the chats where they are. */
function DockPanel({ api, side }: { readonly api: DockApi; readonly side: DockSide }) {
  const layer = useInternal();
  const { text, title } = useTitle();
  const open = layer.dockOpen;
  const floating = api.floating;
  const { registerDock } = layer;
  useLayoutEffect(() => { registerDock(api); return () => registerDock(null); }, [api, registerDock]);
  // The chats report this as their placement: the phone drawer and the floating panel are `floating`, the dock is `docked`.
  const { setDockFloating } = layer;
  useLayoutEffect(() => { setDockFloating(floating); return () => setDockFloating(false); }, [floating, setDockFloating]);
  const box = useRef<HTMLDivElement>(null);
  // How tall the field is at the bottom of the column: the stacked pane stops above it.
  const [fieldHeight, setFieldHeight] = useState(0);
  const stacked = layer.paneStacked;
  useLayoutEffect(() => {
    const field = stacked ? box.current?.querySelector<HTMLElement>('[data-testid=composer-dock]') : null;
    if (!field) return;
    const measure = () => setFieldHeight(field.offsetHeight);
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(field);
    return () => observer?.disconnect();
  }, [stacked]);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      // A list, menu or file opened over the column takes its own Escape first.
      if (document.querySelector('[data-testid=conversations], [data-testid=agent-preview]') || (event.target instanceof Element && event.target.closest('[role=menu], [role=listbox]'))) return;
      layer.close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, layer]);
  // A dock control (or the divider's Alt+Arrow) moves or removes the element that had focus: it goes to the panel's first dock control instead of the page.
  const { restoreFocus: restoreFocusRef } = layer;
  const openRef = useRef(open);
  useLayoutEffect(() => { openRef.current = open; });
  // Only a change of placement or side can strand focus: the first run (the dock opened at load) leaves focus alone, so no header button shows a ring on page load (D-1968).
  const placed = useRef({ placement: api.placement, side });
  useLayoutEffect(() => {
    // Opening from `closed` (the URL or a remembered state opening the dock after its first render) is not a move: only docked, float or a side change while already open is.
    const changed = placed.current.placement !== 'closed' && (placed.current.placement !== api.placement || placed.current.side !== side);
    placed.current = { placement: api.placement, side };
    const lost = !document.activeElement || document.activeElement === document.body;
    const wanted = restoreFocusRef.current || (changed && openRef.current && lost && api.placement !== 'closed');
    restoreFocusRef.current = false;
    if (wanted) box.current?.querySelector<HTMLElement>('[data-dock-control]')?.focus({ preventScroll: true });
  }, [api.placement, side, restoreFocusRef]);
  const drag = useDraggable({ box, position: open ? pos : null, onPositionChange: setPos, enabled: floating });
  const act = (run: () => void) => () => { restoreFocusRef.current = true; run(); };
  const control = (id: string, label: string, Icon: ComponentType<{ className?: string }>, run: () => void) =>
    <Button variant="ghost" size="icon" key={id} data-testid={`agent-layer-${id}`} data-dock-control="" aria-label={label} title={label} onClick={act(run)}><Icon data-icon="inline-start" aria-hidden="true" /></Button>;
  const controls = layer.bar ? <>
    <Button variant="ghost" size="icon" data-testid="agent-layer-full" aria-label={text.fullScreen} title={text.fullScreen} onClick={() => layer.enterFull('dock')}><MaximizeIcon data-icon="inline-start" aria-hidden="true" /></Button>
    <Button variant="ghost" size="icon" data-testid="agent-layer-undock" aria-label={text.undock} title={text.undock} aria-pressed onClick={() => { layer.setMode('tray'); requestAnimationFrame(() => layer.composerSlot?.querySelector<HTMLElement>('[data-testid=composer-input]')?.focus({ preventScroll: true })); }}><PanelBottomIcon data-icon="inline-start" aria-hidden="true" /></Button>
    <Button variant="ghost" size="icon" data-testid="agent-layer-close" aria-label={text.collapse} title={text.collapse} onClick={layer.close}><ChevronDownIcon data-icon="inline-start" aria-hidden="true" /></Button>
  </> : <>
    {!floating && control('float', text.float, PictureInPicture2Icon, () => api.float())}
    {(floating || side === 'right') && control('dock-left', text.dockLeft, PanelLeftIcon, () => { layer.setSide('left'); api.dock(); })}
    {(floating || side === 'left') && control('dock-right', text.dockRight, PanelRightIcon, () => { layer.setSide('right'); api.dock(); })}
  </>;
  // Floating, the host's Card is drawn behind the layer (a sibling layer, so docking or floating never remounts the chat).
  return <div ref={box} data-testid="agent-layer" data-state={open ? 'open' : 'closed'} data-placement={api.placement} data-side={side} role={floating ? 'dialog' : 'complementary'} aria-label={title}
    style={floating ? pos ?? { right: 16, bottom: 16 } : undefined}
    className={cn('app-shell relative flex min-h-0 flex-col',
      floating ? 'fixed isolate z-(--app-shell-z-layer) h-[min(36rem,calc(100dvh-2rem))] w-[min(24rem,calc(100vw-2rem))]'
        : 'h-full min-w-0 flex-1 bg-card text-foreground')}>
    {floating && <Card aria-hidden="true" data-boring="chrome" className="pointer-events-none absolute inset-0 -z-10" />}
    {!floating && <Separator orientation="vertical" className={cn('absolute inset-y-0', side === 'right' ? 'left-0' : 'right-0')} />}
    {/* The pane over the docked conversation brings its own bar (« ← Assistant », the title, Fermer): the layer's title row steps aside. */}
    {/* The pane over the docked conversation lies on top of it, down to the field: nothing under it moves, so back finds the thread as it was.
        Its own bar (« ← Assistant », the title, Fermer) is the column's title row then; the layer's keeps its place, unseen. */}
    <Header text={text} title={title} controls={controls} className={cn(floating && 'cursor-move touch-none select-none', layer.paneStacked && 'invisible')} {...(layer.paneStacked ? { inert: true } : {})} {...drag} />
    {layer.paneStacked && <div className="absolute inset-x-0 top-0 z-10 flex flex-col bg-card" style={{ bottom: fieldHeight }}><PaneStack placement="stacked" assistant={title} /></div>}
    {/* `bar`: the docked field is the bottom one, frame and all (`.app-shell [data-one-dock]`): one composer wherever it sits (Julien). */}
    <div {...(layer.bar ? { 'data-one-dock': '' } : {})} className={cn('flex min-h-0 flex-col overflow-hidden', 'flex-1', layer.paneStacked && cn('[&_[data-testid=conversation-content]]:invisible', FOLDED_FIELD))}><VoiceProblem /><ChatSlot live={open} /></div>
  </div>;
}

function AgentDock({ side }: { readonly side: DockSide }) {
  const layer = useInternal();
  const { title } = useTitle();
  return <Dock id="agent" side={side} floatable defaultWidth={384} minWidth={320} dragBelow={260} open={layer.dockOpen} onOpenChange={next => { if (!next) layer.close(); }} labels={{ region: title }}>
    {api => <DockPanel api={api} side={side} />}
  </Dock>;
}
/** `composer: 'content'`: the page content, then the field's slot at the bottom; a file dropped anywhere on the column goes to that field. */
export function ContentColumn({ children }: { readonly children: ReactNode }) {
  const { setComposerSlot, setDropZone, trayOpen, size, anchored, setCardSlot, bar: barMode, contentComposer, folded } = useInternal();
  // The box only on a wide screen: on a phone the field lives in the drawer.
  const bar = barMode && contentComposer;
  const grown = size !== 'open';
  // The page keeps one wrapper whether the tray is open or not, so opening it never remounts the screen; Agrandir only hides it.
  return <div ref={setDropZone} data-testid="agent-content" data-bar-tray={bar && trayOpen && !anchored ? (grown ? 'expanded' : 'open') : undefined} className={cn('relative flex min-h-0 min-w-0 flex-1 flex-col', bar && '@container')}>
    <div data-testid="agent-page" className={cn('flex min-h-0 min-w-0 flex-1 flex-col', trayOpen && grown && !anchored && !bar && 'hidden')}>{children}</div>
    {bar ? <OneBox>
      {trayOpen && !anchored && <ContentTray />}
      <div ref={setCardSlot} data-testid="agent-card-slot" className={cn('shrink-0 empty:hidden', !anchored && 'relative z-10 bg-card')} />
      <div ref={setComposerSlot} data-testid="agent-content-composer" className={cn('shrink-0', !anchored && 'relative z-10 rounded-b-(--radius-3xl) bg-card', folded && FOLDED_FIELD)} />
    </OneBox> : <>
      {trayOpen && !anchored && <ContentTray />}
      <div ref={setComposerSlot} data-testid="agent-content-composer" className="shrink-0" />
    </>}
  </div>;
}

/**
 * Where the app wants the assistant's field: place it in the column the field belongs under (for a page with an aside, the main column).
 * While mounted, `composer: 'content'` draws the field and the reply tray here instead of across the whole content column; a file drop stays on the whole column.
 * Absent, nothing changes. Still one controller and one composer; the page is not remounted. Renders nothing visible without a content composer.
 */
export function AgentComposerAnchor({ className }: { readonly className?: string }) {
  const layer = useContext(LayerContext);
  const [tray, setTray] = useState<HTMLElement | null>(null);
  const [field, setField] = useState<HTMLElement | null>(null);
  const [card, setCard] = useState<HTMLElement | null>(null);
  const setAnchor = layer?.setAnchor;
  useLayoutEffect(() => {
    if (!setAnchor || !tray || !field || !card) return;
    setAnchor({ tray, field, card });
    return () => setAnchor(null);
  }, [setAnchor, tray, field, card]);
  if (!layer) return null;
  const slots = <>
    <div ref={setTray} data-testid="agent-anchor-tray" className="flex min-w-0 flex-col">{layer.trayOpen && layer.anchored && <ContentTray />}</div>
    <div ref={setCard} data-testid="agent-anchor-card" className="shrink-0 empty:hidden" />
    <div ref={setField} data-testid="agent-anchor-composer" className={cn('shrink-0', layer.folded && FOLDED_FIELD)} />
  </>;
  return <div data-testid="agent-composer-anchor" className={cn('flex min-w-0 shrink-0 flex-col', className)}>{layer.bar && layer.contentComposer ? <OneBox>{slots}</OneBox> : slots}</div>;
}

/**
 * The reply as a tray just above the field (`composer: 'content'`, wide, the person's default): the desktop twin of the phone's peek to half.
 * The same thread and controller as the dock and the drawer, moved here; its width is the field's, its height min(35%, 360px) of the column,
 * and the page above it shrinks instead of being covered. The unanchored bar reserves that page space with padding and slides a fixed-height surface.
 * No second composer: the field below stays the only input.
 */
function ContentTray() {
  const layer = useInternal();
  const { text, title } = useTitle();
  const { size, setSize, side, moveToDock } = layer;
  const grown = size !== 'open';
  const DockIcon = side === 'left' ? PanelLeftIcon : PanelRightIcon;
  const dockLabel = side === 'left' ? text.dockLeft : text.dockRight;
  const reduce = useCallback(() => {
    layer.close();
    layer.composerSlot?.querySelector<HTMLElement>('[data-testid=composer-input]')?.focus({ preventScroll: true });
  }, [layer]);
  const reduceRef = useRef(reduce);
  useLayoutEffect(() => { reduceRef.current = reduce; });
  // Esc goes back to the bare field, unless something else owns it: an open menu, dialog or popup, an IME composition, a handled key.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      // Only a key pressed in the tray, in the one field or on the controller strip is the tray's; a host dock beside the content, a menu or a dialog keep their own Esc.
      if (!(event.target instanceof Element) || !event.target.closest('[data-testid=agent-tray], [data-testid=agent-content-composer], [data-testid=agent-composer-anchor], [data-testid=composer-controller]')) return;
      if (document.querySelector('[role=menu],[role=listbox],[role=dialog],[role=alertdialog],[data-boring-overlay]')) return;
      if (event.target instanceof Element && event.target.closest('[aria-haspopup][aria-expanded=true]')) return;
      event.preventDefault();
      reduceRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  // In an anchor the tray sits in the app's column, whose height is not the content column's: a share of the viewport, and Agrandir takes more of it instead of hiding the page.
  const boxed = layer.bar && layer.contentComposer;
  const overlay = boxed && !layer.anchored;
  const height = boxed ? (grown ? '70dvh' : '30dvh') : layer.anchored ? (grown ? 'min(70dvh, 720px)' : `min(35dvh, ${TRAY_MAX}px)`) : grown ? undefined : `min(35%, ${TRAY_MAX}px)`;
  const tray = <section data-testid="agent-tray" data-overlay={overlay || undefined} data-expanded={boxed && grown || undefined} aria-label={title} style={height ? { height: overlay ? 'var(--app-shell-bar-tray-size)' : height } : undefined}
    className={cn('flex min-h-0 min-w-0 flex-col', overlay ? 'pointer-events-auto absolute inset-x-0 top-0 transition-transform duration-(--duration-fast) ease-(--ease-standard) motion-reduce:transition-none' : 'relative bg-card', boxed ? 'shrink-0 px-3 text-card-foreground' : 'px-4 text-card-foreground', !boxed && (grown && !layer.anchored ? 'flex-1' : 'shrink-0'))}>
    {overlay && <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-(--app-shell-bar-tray-expanded) rounded-t-(--radius-3xl) bg-card" />}
    {boxed ? null : <Separator className="absolute inset-x-0 top-0" />}
    <div data-testid="agent-tray-body" className={cn('mx-auto flex min-h-0 w-full max-w-[720px] flex-col', overlay ? 'relative h-(--app-shell-bar-tray-expanded) shrink-0' : 'flex-1')}>
      <div data-testid="agent-tray-header" className="flex h-13 shrink-0 items-center gap-1.5">
        <h2 data-testid="agent-tray-title" className="m-0 min-w-0 flex-1 truncate text-sm leading-5 font-semibold tracking-tight">{title}</h2>
        <HistoryButton />
        {layer.bar && <LibraryButton open={layer.openLibrary} text={text} testId="agent-layer-library" />}
        {boxed ? null : <>
          <HeaderHint label={dockLabel}><Button variant="ghost" size="icon" data-testid="agent-tray-dock" aria-label={dockLabel} title={dockLabel}
            onClick={moveToDock}><DockIcon data-icon="inline-start" aria-hidden="true" /></Button></HeaderHint>
          <Button variant="ghost" size="icon" data-testid="agent-tray-grow" aria-label={text.expand} title={text.expand} aria-pressed={grown}
            onClick={() => setSize(grown ? 'open' : 'grown')}>{grown ? <ChevronDownIcon className="size-4" aria-hidden="true" /> : <ChevronUpIcon className="size-4" aria-hidden="true" />}</Button>
          <Button variant="ghost" size="icon" data-testid="agent-tray-reduce" aria-label={text.collapse} title={text.collapse} onClick={reduce}><XIcon className="size-4" aria-hidden="true" /></Button>
        </>}
      </div>
      <VoiceProblem />
      <ChatSlot live={size !== 'full'} />
    </div>
    {boxed && !overlay && <Separator />}
  </section>;
  return overlay ? <div className="pointer-events-none absolute inset-x-0 bottom-full h-(--app-shell-bar-tray-expanded) overflow-hidden">{tray}</div> : tray;
}

/**
 * Wraps the app's content (placed once by the shell): on a wide screen the agent dock sits on its left or right and the content reflows,
 * or it floats over the content; on a phone this is only the content (the layer is the bottom drawer). Host concern: Pi has no layout.
 */
export function AgentDockLayout({ children }: { readonly children: ReactNode }): ReactElement {
  const layer = useInternal();
  const { title } = useTitle();
  const dock = layer.expanded && (layer.agent || layer.improve) ? <AgentDock side={layer.side} /> : null;
  // The PM column sits inside the main content: while it is open beside the dock, the dock leaves the screen its least width beside it.
  return <DockLayout storageKey={DOCK_KEY} persist="local" minMain={MIN_MAIN + (layer.besidePanel ? PM_COLUMN : 0)} {...(layer.bar ? { className: '@container/agent-layout' } : {})}>
    {layer.side === 'left' && dock}
    <DockMain>{layer.contentColumn ? <ContentColumn>{children}</ContentColumn> : children}</DockMain>
    {layer.bar && layer.expanded && layer.stack.length > 0 && !layer.paneStacked && <PaneDock assistant={title} />}
    {layer.side === 'right' && dock}
  </DockLayout>;
}

/**
 * The conversation over the whole viewport, wide screen (`composer: 'bar'`): the chat's persistent host moves here, to a fixed `inset-0` surface on the body,
 * so it covers the nav and the right pane. One header (back arrow, title, Close). The page behind is inert and does not scroll; Esc and the back arrow
 * go to `grown`, focus goes back to the control that opened it. The phone is not here: its drawer's full snap is this same `size`.
 */
function FullScreen() {
  const layer = useInternal();
  const { text, title } = useTitle();
  const root = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null);
  const { setFullField, close } = layer;
  const closing = useRef(false);
  const closeAll = useCallback(() => { closing.current = true; close(); }, [close]);
  // The conversation fills the main area, the rect the bar is centred on: the left navigation and the right pane stay beside it, visible and live.
  const [frame, setFrame] = useState<{ readonly left: number; readonly right: number; readonly top: number; readonly bottom: number }>({ left: 0, right: 0, top: 0, bottom: 0 });
  useLayoutEffect(() => {
    const main = document.querySelector<HTMLElement>('[data-boring=dock-main]');
    const measure = () => { if (!main) return; const r = main.getBoundingClientRect(); setFrame({ left: r.left, right: window.innerWidth - r.right, top: r.top, bottom: window.innerHeight - r.bottom }); };
    measure();
    const observer = main && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : undefined;
    if (main) observer?.observe(main);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, []);
  const { leaveFull: back } = layer;
  const backRef = useRef(back);
  useLayoutEffect(() => { backRef.current = back; });
  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    const touched: Array<{ el: Element; inert: boolean; hidden: string | null }> = [];
    // Only what the conversation covers goes inert: the main area's page. The left navigation and the right pane stay beside it and live.
    for (const el of document.querySelectorAll('[data-boring=dock-main]')) {
      touched.push({ el, inert: (el as HTMLElement).inert, hidden: el.getAttribute('aria-hidden') });
      (el as HTMLElement).inert = true;
      el.setAttribute('aria-hidden', 'true');
    }
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    node.querySelector<HTMLElement>('[data-testid=composer-input]')?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      if (document.querySelector('[role=menu],[role=listbox],[role=dialog]:not([data-testid=agent-full]),[role=alertdialog],[data-boring-overlay]')) return;
      if (event.target instanceof Element && event.target.closest('[aria-haspopup][aria-expanded=true]')) return;
      event.preventDefault();
      backRef.current();
    };
    document.addEventListener('keydown', onKey);
    const returnTo = opener.current;
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      for (const { el, inert, hidden } of touched) {
        (el as HTMLElement).inert = inert;
        if (hidden === null) el.removeAttribute('aria-hidden'); else el.setAttribute('aria-hidden', hidden);
      }
      // Back and Esc land on the opener (the strip's or the docked header's Full control when that is gone, which may mount a frame or two later).
      let frames = 0;
      const land = () => {
        const target = closing.current ? document.querySelector<HTMLElement>('[data-testid=composer-input]') : returnTo && returnTo !== document.body && returnTo.isConnected && returnTo.getClientRects().length > 0 ? returnTo : document.querySelector<HTMLElement>('[data-testid=agent-tray-full], [data-testid=agent-layer-full]');
        target?.focus({ preventScroll: true });
        if (document.activeElement !== target && ++frames < 12) requestAnimationFrame(land);
      };
      requestAnimationFrame(land);
    };
  }, []);
  return createPortal(
    <div ref={root} data-testid="agent-full" role="dialog" aria-modal="true" aria-label={title} style={frame} className="app-shell fixed z-[45] flex flex-col bg-card text-card-foreground">
      <div className="mx-auto flex min-h-0 w-full max-w-[720px] flex-1 flex-col">
        <Header text={text} title={title} controls={<HeaderHint label={text.close}><Button variant="ghost" size="icon" data-testid="agent-full-close" aria-label={text.close} onClick={closeAll}><XIcon data-icon="inline-start" aria-hidden="true" /></Button></HeaderHint>} />
        <VoiceProblem />
        <ChatSlot />
        <div data-one-dock="" className="shrink-0"><div ref={setFullField} data-testid="agent-full-composer" /></div>
      </div>
    </div>, document.body);
}

/** The layer itself: the drawer on a phone (the wide dock is `AgentDockLayout`). Placed once by the shell, for point mode on both. */
export function AgentLayer(): ReactElement | null {
  const layer = useInternal();
  const { title } = useTitle();
  const pointingAgent = usePointing(layer.agent?.feedback);
  const session = pointingAgent ? layer.agent?.feedback : undefined;
  const commentingAgent = useCommenting(layer.agent?.feedback);
  const commenting = commentingAgent ? layer.agent?.feedback : undefined;
  // Back ends pointing first (the `point` priority), like Done: the notes wait for the next message. The layer keeps its own history entry underneath.
  useBackLayer(session !== undefined, () => { void session?.done(); }, 'point');
  if (!layer.agent && !layer.improve) return null;
  const pointed = layer.agent;
  const transcribe = (pointed?.voice ?? layer.agent?.voice)?.transcribe;
  const locale = layer.locale ?? pointed?.chatProps?.locale;
  // Comment mode shows its banner either way: on a phone (point mode) above the tab bar, outside the layer, while the compact sheet steps
  // aside; on a wide screen at the top, the dock beside the app. The note bubble is here only while pointing (else inside the layer).
  return <>
    {layer.expanded && layer.trayOpen && layer.size === 'full' && <FullScreen />}
    {!layer.expanded && <CompactSheet pointing={session !== undefined} />}
    {layer.bar && !layer.expanded && layer.stack.length > 0 && <PaneStack placement="screen" assistant={title} />}
    {commenting && <CommentBanner session={commenting} bottomOffset={`${layer.tabbar}px`} className="z-[60]" {...(locale === 'fr' ? { labels: feedbackLabelsFr } : {})} />}
    {session && <NoteBubble session={session} {...(transcribe ? { transcribe } : {})} {...(locale === 'fr' ? { labels: feedbackLabelsFr } : {})} />}
  </>;
}
