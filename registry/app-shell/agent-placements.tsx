'use client';

// The wide placements: the dock (docked or floating), the content column with its tray and anchor, the preview column, and the layer root.
import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ComponentType, ReactElement, ReactNode } from 'react';
import { ChevronDownIcon, ChevronUpIcon, PanelBottomIcon, PanelLeftIcon, PanelRightIcon, PictureInPicture2Icon, XIcon } from '../_shared/icons';
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
import { ChatSlot, Header, HistoryButton, LibraryButton, useTitle } from './agent-chats';
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
      if (document.querySelector('[data-testid=conversations], [data-testid=agent-preview], [role=menu], [role=listbox]')) return;
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
  // `composer: 'bar'`: one way out besides Fermer, back to the bottom (Ouvert); the field goes back under the page with the thread.
  const undock = () => {
    layer.setMode('tray');
    requestAnimationFrame(() => layer.composerSlot?.querySelector<HTMLElement>('[data-testid=composer-input]')?.focus({ preventScroll: true }));
  };
  const controls = layer.bar ? <Button variant="ghost" size="icon" data-testid="agent-layer-undock" data-dock-control="" aria-label={text.undock} title={text.undock} onClick={undock}><PanelBottomIcon data-icon="inline-start" aria-hidden="true" /></Button> : <>
    {!floating && control('float', text.float, PictureInPicture2Icon, () => api.float())}
    {(floating || side === 'right') && control('dock-left', text.dockLeft, PanelLeftIcon, () => { layer.setSide('left'); api.dock(); })}
    {(floating || side === 'left') && control('dock-right', text.dockRight, PanelRightIcon, () => { layer.setSide('right'); api.dock(); })}
  </>;
  // Floating, the host's Card is drawn behind the layer (a sibling layer, so docking or floating never remounts the chat).
  return <div ref={box} data-testid="agent-layer" data-state={open ? 'open' : 'closed'} data-placement={api.placement} data-side={side} role={floating ? 'dialog' : 'complementary'} aria-label={title}
    style={floating ? pos ?? { right: 16, bottom: 16 } : undefined}
    className={cn('app-shell relative flex min-h-0 flex-col',
      floating ? 'fixed isolate z-(--app-shell-z-layer) h-[min(36rem,calc(100dvh-2rem))] w-[min(24rem,calc(100vw-2rem))]'
        : 'h-full min-w-0 flex-1 bg-background text-foreground')}>
    {floating && <Card aria-hidden="true" data-boring="chrome" className="pointer-events-none absolute inset-0 -z-10" />}
    {!floating && <Separator orientation="vertical" className={cn('absolute inset-y-0', side === 'right' ? 'left-0' : 'right-0')} />}
    {/* The pane over the docked conversation brings its own bar (« ← Assistant », the title, Fermer): the layer's title row steps aside. */}
    {/* The pane over the docked conversation lies on top of it, down to the field: nothing under it moves, so back finds the thread as it was.
        Its own bar (« ← Assistant », the title, Fermer) is the column's title row then; the layer's keeps its place, unseen. */}
    <Header text={text} title={title} controls={controls} className={cn('pt-2', floating && 'cursor-move touch-none select-none', layer.paneStacked && 'invisible')} {...(layer.paneStacked ? { inert: true } : {})} {...drag} />
    {layer.paneStacked && <div className="absolute inset-x-0 top-0 z-10 flex flex-col bg-background" style={{ bottom: fieldHeight }}><PaneStack placement="stacked" assistant={title} /></div>}
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
  const { setComposerSlot, setDropZone, trayOpen, grown, anchored, setCardSlot, bar: barMode, contentComposer, folded } = useInternal();
  // The box only on a wide screen: on a phone the field lives in the drawer.
  const bar = barMode && contentComposer;
  // The page keeps one wrapper whether the tray is open or not, so opening it never remounts the screen; Agrandir only hides it.
  return <div ref={setDropZone} data-testid="agent-content" className="relative flex min-h-0 min-w-0 flex-1 flex-col">
    <div data-testid="agent-page" className={cn('flex min-h-0 min-w-0 flex-1 flex-col', trayOpen && grown && !anchored && !bar && 'hidden')}>{children}</div>
    {bar ? <OneBox>
      {trayOpen && !anchored && <ContentTray />}
      <div ref={setCardSlot} data-testid="agent-card-slot" className="shrink-0 empty:hidden" />
      <div ref={setComposerSlot} data-testid="agent-content-composer" className={cn('shrink-0', folded && FOLDED_FIELD)} />
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
 * and the page above it shrinks instead of being covered. No second composer: the field below stays the only input.
 */
function ContentTray() {
  const layer = useInternal();
  const { text, title } = useTitle();
  const { grown, setGrown, side, moveToDock } = layer;
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
      // Only a key pressed in the tray or in the one field is the tray's; a host dock beside the content, a menu or a dialog keep their own Esc.
      if (!(event.target instanceof Element) || !event.target.closest('[data-testid=agent-tray], [data-testid=agent-content-composer], [data-testid=agent-composer-anchor]')) return;
      if (document.querySelector('[role=menu],[role=listbox],[role=dialog],[role=alertdialog],[data-boring-overlay]')) return;
      if (event.target instanceof Element && event.target.closest('[aria-expanded=true]')) return;
      reduceRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  const DockIcon = side === 'left' ? PanelLeftIcon : PanelRightIcon;
  const dockLabel = side === 'left' ? text.dockLeft : text.dockRight;
  // In an anchor the tray sits in the app's column, whose height is not the content column's: a share of the viewport, and Agrandir takes more of it instead of hiding the page.
  const boxed = layer.bar && layer.contentComposer;
  const height = boxed ? (grown ? '70dvh' : '30dvh') : layer.anchored ? (grown ? 'min(70dvh, 720px)' : `min(35dvh, ${TRAY_MAX}px)`) : grown ? undefined : `min(35%, ${TRAY_MAX}px)`;
  return <section data-testid="agent-tray" aria-label={title} style={height ? { height } : undefined}
    className={cn('relative flex min-h-0 min-w-0 flex-col', boxed ? 'shrink-0 bg-card px-3 text-card-foreground' : 'bg-card px-4 text-card-foreground', !boxed && (grown && !layer.anchored ? 'flex-1' : 'shrink-0'))}>
    {boxed ? null : <Separator className="absolute inset-x-0 top-0" />}
    <div data-testid="agent-tray-body" className="mx-auto flex min-h-0 w-full max-w-[720px] flex-1 flex-col">
      <div data-testid="agent-tray-header" className="flex shrink-0 items-center gap-1 pt-1">
        <h2 data-testid="agent-tray-title" className="m-0 min-w-0 flex-1 truncate text-sm font-semibold">{title}</h2>
        <HistoryButton />
        {layer.bar && <LibraryButton open={layer.openLibrary} text={text} testId="agent-layer-library" />}
        <Button variant="ghost" size="icon" data-testid="agent-tray-dock" aria-label={dockLabel} title={dockLabel}
          onClick={moveToDock}><DockIcon data-icon="inline-start" aria-hidden="true" /></Button>
        <Button variant="ghost" size="icon" data-testid="agent-tray-grow" aria-label={text.expand} title={text.expand} aria-pressed={grown}
          onClick={() => setGrown(!grown)}>{grown ? <ChevronDownIcon data-icon="inline-start" aria-hidden="true" /> : <ChevronUpIcon data-icon="inline-start" aria-hidden="true" />}</Button>
        <Button variant="ghost" size="icon" data-testid="agent-tray-reduce" aria-label={text.collapse} title={text.collapse} onClick={reduce}><XIcon data-icon="inline-start" aria-hidden="true" /></Button>
      </div>
      <VoiceProblem />
      <ChatSlot />
    </div>
    {boxed && <Separator />}
  </section>;
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
  return <DockLayout storageKey={DOCK_KEY} persist="local" minMain={MIN_MAIN + (layer.besidePanel ? PM_COLUMN : 0)}>
    {layer.side === 'left' && dock}
    <DockMain>{layer.contentColumn ? <ContentColumn>{children}</ContentColumn> : children}</DockMain>
    {layer.bar && layer.expanded && layer.stack.length > 0 && !layer.paneStacked && <PaneDock assistant={title} />}
    {layer.side === 'right' && dock}
  </DockLayout>;
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
    {!layer.expanded && <CompactSheet pointing={session !== undefined} />}
    {layer.bar && !layer.expanded && layer.stack.length > 0 && <PaneStack placement="screen" assistant={title} />}
    {commenting && <CommentBanner session={commenting} bottomOffset={`${layer.tabbar}px`} className="z-[60]" {...(locale === 'fr' ? { labels: feedbackLabelsFr } : {})} />}
    {session && <NoteBubble session={session} {...(transcribe ? { transcribe } : {})} {...(locale === 'fr' ? { labels: feedbackLabelsFr } : {})} />}
  </>;
}
