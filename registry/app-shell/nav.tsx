'use client';

// The navigation: a bottom tab bar when compact, the shadcn sidebar (icon rail plus NavUser, the sidebar-07 and sidebar-08 patterns) when
// expanded. Choosing an item only calls `route.onChange`: the app's router owns the URL, and the shell adds no history entry.
import { useEffect, useRef, useState } from 'react';
import type { ComponentType, KeyboardEvent, ReactNode } from 'react';
import { EllipsisIcon, PinIcon, SparklesIcon } from '../_shared/icons';
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarSeparator, SidebarTrigger, useSidebar } from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { afterBack, BACK_SETTLE_MS, useBackLayer } from '../utils/back';
import { NavUser } from './account';
import { useAgentLayer } from './agent-layer';
import type { AgentSpec } from './agent-layer';
import type { AccountSpec } from './account';
import { AppSheet, SHEET_ROW } from './app-sheet';
import { InsideNavSheet, useExclusiveSheet } from './use-exclusive-sheet';
import type { AppShellText } from './text';
import { ResizableRail } from './sidebar-resize';
import { useSidebarPin } from './sidebar-open';

export interface NavBadge {
  readonly tone: 'info' | 'success' | 'warning' | 'destructive';
  readonly label: string;
}

export interface NavItem {
  readonly id: string;
  readonly label: string;
  readonly icon: ComponentType<{ className?: string }>;
  /** A state dot on the item. Both are required, so the dot always means something: `tone` picks the colour (info, success, warning, destructive tokens), `label` is its accessible name (« Nuit à noter »). No dot, no state: leave it out. */
  readonly badge?: NavBadge;
  readonly render: () => ReactNode;
  /** The screen's own content inside the shell's sidebar (its list, say) while this item is on show: above the nav items, which move below it. `collapsed` is true on the icon rail, so the content can fold with it. */
  readonly sidebar?: (state: { readonly collapsed: boolean }) => ReactNode;
  /** The sidebar content's own name, for the phone button that opens it in tabs mode (« Library »): its label reads « <item label>: <sidebarLabel> ». Default: the shell's word for « panel ». */
  readonly sidebarLabel?: string;
  /** Where this item sits against a screen's own sidebar content: `'before-sidebar'` puts it above that content, `'after-sidebar'` (the default) below. Items marked before come first everywhere (the tab bar and the phone sheet too); each side keeps the registered order. */
  readonly placement?: 'before-sidebar' | 'after-sidebar';
}

/** The items marked `before-sidebar`, then the others, each in registered order. */
export function placeNav<T extends Pick<NavItem, 'placement'>>(items: readonly T[]): { readonly before: readonly T[]; readonly after: readonly T[] } {
  return { before: items.filter(item => item.placement === 'before-sidebar'), after: items.filter(item => item.placement !== 'before-sidebar') };
}

/** The most tabs the bar shows. */
const MAX_TABS = 4;

/** Up to four items are all tabs; more than four give three tabs and the rest behind « Plus ». */
export function splitNav<T>(items: readonly T[]): { readonly tabs: readonly T[]; readonly overflow: readonly T[] } {
  return items.length <= MAX_TABS ? { tabs: items, overflow: [] } : { tabs: items.slice(0, MAX_TABS - 1), overflow: items.slice(MAX_TABS - 1) };
}

const DOT_TONE = { info: 'bg-info', success: 'bg-success', warning: 'bg-warning', destructive: 'bg-destructive' } as const;

/** A state dot: a plain 8px span in the tone's token, named by its label. Its classes only place it. */
const Dot = ({ badge, className }: { readonly badge: NavBadge; readonly className?: string }) => <span role="img" aria-label={badge.label} data-testid="nav-badge" className={`inline-block size-2 shrink-0 rounded-full ${DOT_TONE[badge.tone]} ${className ?? ''}`} />;

/** Publishes the bar's measured height as `--app-shell-tabbar` on the document root (the drawer is portaled, so the shell root is too high up to reach it). */
function useTabbarHeight(bar: { readonly current: HTMLElement | null }, shown: boolean): void {
  useEffect(() => {
    const root = document.documentElement;
    const node = bar.current;
    if (!shown || !node) { root.style.setProperty('--app-shell-tabbar', '0px'); return; }
    const measure = () => root.style.setProperty('--app-shell-tabbar', `${node.getBoundingClientRect().height}px`);
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : undefined;
    observer?.observe(node);
    return () => { observer?.disconnect(); root.style.removeProperty('--app-shell-tabbar'); };
  }, [bar, shown]);
}

/** Layout for a tab on the host's Button: icon over label, filling its share of the bar. */
const TAB = 'relative h-auto min-w-0 flex-1 flex-col gap-0.5';

/** The tab bar's arrow keys: Left and Right move the focus between the tabs (wrapping). */
const arrows = (event: KeyboardEvent<HTMLElement>) => {
  const buttons = [...event.currentTarget.querySelectorAll<HTMLElement>('[role=tab]')];
  const at = buttons.indexOf(document.activeElement as HTMLElement);
  const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
  if (at < 0 || !step) return;
  event.preventDefault();
  buttons[(at + step + buttons.length) % buttons.length]!.focus();
};

/** The compact tab bar. With one item there is none. Exported for tests. */
export function TabBar({ items, activeId, onChange, text }: { readonly items: readonly NavItem[]; readonly activeId: string; readonly onChange: (id: string) => void; readonly text: AppShellText }) {
  const bar = useRef<HTMLElement>(null);
  const [plusOpen, setPlusOpen] = useState(false);
  const shown = items.length > 1;
  useTabbarHeight(bar, shown);
  if (!shown) return null;
  const { before, after } = placeNav(items);
  const { tabs, overflow } = splitNav([...before, ...after]);
  const inOverflow = overflow.find(item => item.id === activeId);
  /** « Plus » stands for the hidden items: it shows the first one's dot. */
  const hidden = overflow.find(item => item.badge)?.badge;
  const tab = (item: NavItem) => <Button key={item.id} variant={item.id === activeId ? 'secondary' : 'ghost'} role="tab" data-testid={`tab-${item.id}`} aria-selected={item.id === activeId} tabIndex={item.id === activeId ? 0 : -1}
    onClick={() => onChange(item.id)} className={TAB}>
    <item.icon />{item.label}{item.badge && <Dot badge={item.badge} className="absolute top-1 left-1/2 ml-2" />}
  </Button>;
  const Plus = overflow.length ? (inOverflow?.icon ?? EllipsisIcon) : undefined;
  return <nav ref={bar} role="tablist" aria-label={text.tabs} data-testid="tabbar" data-feedback-ignore="" onKeyDown={arrows}
    className="relative z-(--app-shell-z-tabs) box-border flex min-h-(--app-shell-tabbar-min) shrink-0 bg-sidebar px-2 pb-(--app-shell-safe-bottom)">
    {tabs.map(tab)}
    {Plus && <>
      <Button variant={inOverflow ? 'secondary' : 'ghost'} role="tab" data-testid="tab-plus" aria-selected={Boolean(inOverflow)} aria-haspopup="dialog" tabIndex={inOverflow ? 0 : -1} onClick={() => setPlusOpen(true)}
        className={TAB}>
        <Plus />{inOverflow?.label ?? text.more}{!inOverflow && hidden && <Dot badge={hidden} className="absolute top-1 left-1/2 ml-2" />}
      </Button>
      <AppSheet open={plusOpen} onOpenChange={setPlusOpen} title={text.more}>
        {overflow.map(item => <Button key={item.id} variant={item.id === activeId ? 'secondary' : 'ghost'} size="lg" data-testid={`plus-${item.id}`} aria-current={item.id === activeId} className={SHEET_ROW}
          onClick={() => { setPlusOpen(false); afterBack(() => onChange(item.id)); }}>
          <item.icon data-icon="inline-start" />{item.label}{item.badge && <Dot badge={item.badge} className="ml-auto" />}
        </Button>)}
      </AppSheet>
    </>}
  </nav>;
}

/** What keeps the sheet open, checked from the tapped element up: a field to type in, or anything under `data-keep-sheet`. */
const KEEPS = 'input, textarea, select, [contenteditable=""], [contenteditable=true], [data-keep-sheet]';
/** What a tap on a row of the sidebar content counts as « choosing a row »: it closes the sheet. A field to type in does not, and an element may opt out with `data-keep-sheet`. */
const CHOOSES = 'a, button, [role=button], [role=option], [role=menuitem], [role=treeitem], [role=row], [role=link]';

/**
 * Tabs mode on a phone: the current item's `sidebar` has no sidebar to live in, so the header carries a leading button that opens that same content in a left sheet
 * (the width of `compactNav="sheet"`). Choosing a row closes the sheet. An item without a `sidebar` renders nothing. Exported for the header.
 */
export function ScreenSidebarSheet({ item, text }: { readonly item: NavItem; readonly text: AppShellText }) {
  // `open` owns the Back entry; `shown` keeps the sheet mounted while a chosen row's click is replayed once that entry has gone.
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false);
  const replaying = useRef(false);
  const choosing = useRef(false);
  // The choice held behind the sheet's Back; unmounting or settling drops it.
  const pending = useRef<object | null>(null);
  useEffect(() => () => { pending.current = null; }, []);
  const close = () => { pending.current = null; choosing.current = false; setOpen(false); setShown(false); };
  useExclusiveSheet(open, close);
  useBackLayer(open, close, 'sheet');
  if (!item.sidebar) return null;
  const name = `${item.label}: ${item.sidebarLabel ?? text.panel}`;
  return <>
    <Button variant="ghost" size="icon" data-testid="screen-sidebar-button" aria-label={name} title={name} aria-haspopup="dialog" aria-expanded={open} onClick={() => { setOpen(true); setShown(true); }}><item.icon data-icon="inline-start" aria-hidden="true" /></Button>
    <Sheet open={shown} onOpenChange={next => { if (!next) close(); }}>
      <SheetContent side="left" showCloseButton={false} data-testid="screen-sidebar-sheet" className="app-shell data-[side=left]:w-[var(--sidebar-width-mobile,75%)]">
        <SheetHeader className="sr-only"><SheetTitle>{name}</SheetTitle><SheetDescription>{name}</SheetDescription></SheetHeader>
        <div data-testid="screen-sidebar-content" className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain bg-sidebar pb-(--app-shell-safe-bottom) text-sidebar-foreground"
          onClickCapture={event => {
            // The choice is held back: the sheet lets go of its Back entry first, and only then does the row's own click (a router push, a link) run, so that entry's `history.back()` cannot undo it.
            const target = event.target;
            // A modified or non-primary click (new tab, new window, middle button) is not a choice: it goes through untouched and the sheet stays open.
            const { button, metaKey, ctrlKey, shiftKey, altKey } = event;
            if (replaying.current || !(target instanceof Element) || target.closest(KEEPS) || !target.closest(CHOOSES) || button !== 0 || metaKey || ctrlKey || shiftKey || altKey) return;
            event.preventDefault();
            event.stopPropagation();
            // One choice at a time: a second tap while the sheet is closing is swallowed, so a navigating row navigates once.
            if (choosing.current) return;
            choosing.current = true;
            const mine = {};
            pending.current = mine;
            setOpen(false);
            // A Back that never lands settles after a bounded wait: the choice is dropped (never run ahead of the traversal) and the sheet closes.
            setTimeout(() => { if (pending.current !== mine) return; pending.current = null; choosing.current = false; setShown(false); }, BACK_SETTLE_MS);
            afterBack(() => {
              if (pending.current !== mine) return;
              pending.current = null;
              if (target.isConnected) {
                replaying.current = true;
                try { target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); } finally { replaying.current = false; }
              }
              choosing.current = false;
              setShown(false);
            });
          }}>
          {item.sidebar({ collapsed: false })}
        </div>
      </SheetContent>
    </Sheet>
  </>;
}

/** Hover intent of the hover rail, in ms: the pointer must stay this long to reveal the pane, and be gone this long (focus too) to fold it. */
const HOVER_REVEAL_MS = 150;
const HOVER_FOLD_MS = 300;

/** The expanded sidebar: the app title, the nav items (none with one item) and the account in the footer. */
export function AppSidebar({ rail = 'icon', identity, title, items, activeId, onChange, agent, account, improve, text }: {
  readonly rail?: 'icon' | 'hover'; readonly identity?: { readonly app?: string | undefined; readonly person?: string | undefined }; readonly title: string; readonly items: readonly NavItem[]; readonly activeId: string; readonly onChange: (id: string) => void;
  readonly agent: AgentSpec | undefined; readonly account: AccountSpec | undefined; readonly improve: string | undefined; readonly text: AppShellText;
}) {
  const { setOpen, openMobile, setOpenMobile, state, isMobile } = useSidebar();
  // The hover rail's pin (D-2010): on a wide screen only. Pinned, the pane is open whatever the pointer and focus do and the page sits beside it.
  const hover = rail === 'hover' && !isMobile;
  const { pinned, set: setPinned } = useSidebarPin(hover, identity ?? {});
  const wrapper = useRef<HTMLDivElement>(null);
  // A dialog, menu or popover opened from the pane lives in a portal outside it: the pointer and focus leave the pane while it is open. Its trigger says so; the pane waits.
  const layerOpen = () => Boolean(wrapper.current?.querySelector('[aria-haspopup][aria-expanded="true"], [aria-haspopup][data-popup-open], [aria-haspopup][data-state="open"]'));
  const togglePin = () => {
    const next = !pinned;
    setPinned(next);
    // Unpinning folds unless the pointer or focus is still in the pane (then leaving does).
    const el = wrapper.current;
    setOpen(next || layerOpen() || Boolean(el && (el.matches(':hover') || el.contains(document.activeElement))));
  };
  const toggle = useRef(togglePin);
  useEffect(() => { toggle.current = togglePin; });
  useEffect(() => { if (pinned && state === 'collapsed') setOpen(true); }, [pinned, state, setOpen]);
  const settled = () => {
    const el = wrapper.current;
    try { return Boolean(el) && !el!.matches(':hover') && !(el!.contains(document.activeElement) && document.activeElement!.matches(':focus-visible')); } catch { return false; }
  };
  // Keyboard focus inside the pane (a mouse click leaves none to keep it open) and the pointer over it each keep it open: it folds when both have gone.
  const focusIn = () => { const el = wrapper.current; try { return Boolean(el && el.contains(document.activeElement) && document.activeElement!.matches(':focus-visible')); } catch { return false; } };
  const pointerIn = () => { try { return Boolean(wrapper.current?.matches(':hover')); } catch { return false; } };
  const fold = () => { if (!pinned && !layerOpen() && !pointerIn() && !focusIn()) setOpen(false); };
  // Hover intent: the pane opens once the pointer has stayed HOVER_REVEAL_MS on the rail and folds HOVER_FOLD_MS after pointer and focus left, so a pointer passing by flashes nothing. Keyboard focus opens it at once.
  const intent = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latestFold = useRef(fold);
  useEffect(() => { latestFold.current = fold; });
  useEffect(() => () => clearTimeout(intent.current), []);
  const foldLater = () => { clearTimeout(intent.current); intent.current = setTimeout(() => latestFold.current(), HOVER_FOLD_MS); };
  // When that layer closes, the pane folds if the pointer and focus are outside (the trigger gets focus back after a pause).
  useEffect(() => {
    const el = wrapper.current;
    if (!hover || !el || pinned) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(() => { if (!layerOpen() && settled()) setOpen(false); }, 60); });
    observer.observe(el, { subtree: true, attributes: true, attributeFilter: ['aria-expanded', 'data-popup-open'] });
    return () => { observer.disconnect(); clearTimeout(timer); };
  }, [hover, pinned, setOpen]);
  // Ctrl+B toggles the pin here, ahead of the provider's own listener (which would fold the pane under the pointer).
  useEffect(() => {
    if (!hover) return undefined;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'b' || !(event.metaKey || event.ctrlKey)) return;
      // A text field or editor keeps its own Ctrl+B (bold, say).
      if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
      event.preventDefault();
      event.stopPropagation();
      toggle.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [hover]);
  // In the phone sheet, choosing a screen closes it.
  const choose = (id: string) => { setOpenMobile(false); onChange(id); };
  const own = items.find(item => item.id === activeId)?.sidebar?.({ collapsed: state === 'collapsed' && !isMobile && !pinned });
  const { before, after } = placeNav(items);
  const navGroup = (group: readonly NavItem[], className?: string, testId?: string) => group.length > 0 && <SidebarGroup className={className} data-testid={testId}><SidebarGroupContent><SidebarMenu>
    {group.map(item => <SidebarMenuItem key={item.id}>
      <SidebarMenuButton isActive={item.id === activeId} tooltip={item.label} data-testid={`nav-${item.id}`} className="pointer-coarse:min-h-[var(--control-min,2.75rem)] pointer-coarse:min-w-[var(--control-min,2.75rem)]" onClick={() => choose(item.id)}>
        <item.icon />
        <span>{item.label}</span>
        {item.badge && <Dot badge={item.badge} className="ml-auto group-data-[collapsible=icon]:hidden" />}
      </SidebarMenuButton>
    </SidebarMenuItem>)}
  </SidebarMenu></SidebarGroupContent></SidebarGroup>;
  const layer = useAgentLayer();
  // One layer at a time on a phone (D-1903): the sheet closes when the assistant or the PM opens, or when another sheet (the account's) opens.
  const covering = layer.state !== 'closed' ? layer.showing : null;
  useEffect(() => { if (covering) setOpenMobile(false); }, [covering, setOpenMobile]);
  useExclusiveSheet(isMobile && openMobile, () => setOpenMobile(false), true);
  const pressed = layer.state !== 'closed' && layer.showing === 'agent';
  const AgentIcon = agent?.icon ?? SparklesIcon;
  const agentLabel = agent?.label ?? agent?.chatProps?.labels?.title ?? text.assistant;
  // Hover-revealed and unpinned, the pane floats over the page: a shadow on its sidebar surface lifts it (pinned, it sits beside the page).
  const sidebar = <Sidebar collapsible="icon" variant="inset" data-testid="app-sidebar" data-float={hover && !pinned && state === 'expanded' ? 'true' : undefined}>
    {/* The phone sheet is portaled out of the shell root, so the `.app-shell` reset would not reach its buttons: this wrapper carries it (`contents`: no box of its own). */}
    <InsideNavSheet.Provider value={true}>
    <div className="app-shell contents">
    {/* The one toggle: title and button expanded, the button alone on the icon rail, and « close » inside the phone sheet. The hover rail has no toggle on a wide screen (it opens on hover and focus by itself) but a pin (D-2010) that keeps it open, and keeps « close » in the sheet. */}
    <SidebarHeader className="flex-row items-center justify-between gap-1 group-data-[collapsible=icon]:justify-center"><p data-testid="sidebar-title" className="m-0 min-w-0 truncate px-2 py-1 text-sm font-semibold group-data-[collapsible=icon]:hidden">{title}</p>{(rail !== 'hover' || isMobile) && <SidebarTrigger />}
      {hover && <Button type="button" variant="ghost" size="icon-sm" data-testid="sidebar-pin" aria-pressed={pinned} aria-label={text.pin} title={`${pinned ? text.unpin : text.pin} · Ctrl+B`} onClick={togglePin}
        className="group-data-[collapsible=icon]:pointer-events-none group-data-[collapsible=icon]:opacity-0 group-data-[collapsible=icon]:pointer-coarse:pointer-events-auto group-data-[collapsible=icon]:pointer-coarse:opacity-100"><PinIcon aria-hidden="true" data-pinned={pinned ? 'true' : 'false'} weight={pinned ? 'fill' : 'regular'} /></Button>}</SidebarHeader>
    <SidebarContent>
      {/* Without the screen's own content, one group in placed order; with it, the before items above it and the rest below. */}
      {items.length > 1 && own != null && navGroup(before, 'shrink-0', 'nav-before')}
      {own != null && <div data-testid="sidebar-screen" className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{own}</div>}
      {items.length > 1 && (own != null ? navGroup(after, 'shrink-0') : navGroup([...before, ...after]))}
      {/* The assistant is a layer, never a destination: no route, it toggles the right panel. */}
      {agent && <>
        {items.length > 1 && <SidebarSeparator />}
        <SidebarGroup><SidebarGroupContent><SidebarMenu><SidebarMenuItem>
          <SidebarMenuButton isActive={pressed} aria-pressed={pressed} tooltip={agentLabel} data-testid="nav-agent" className="pointer-coarse:min-h-[var(--control-min,2.75rem)] pointer-coarse:min-w-[var(--control-min,2.75rem)]"
            onClick={() => { setOpenMobile(false); if (pressed) layer.close(); else layer.open('agent', 'half'); }}>
            <AgentIcon /><span>{agentLabel}</span>
          </SidebarMenuButton>
        </SidebarMenuItem></SidebarMenu></SidebarGroupContent></SidebarGroup>
      </>}
    </SidebarContent>
    <SidebarFooter><NavUser account={account} improve={improve} text={text} /></SidebarFooter>
    <ResizableRail />
    </div>
    </InsideNavSheet.Provider>
  </Sidebar>;
  if (rail !== 'hover') return sidebar;
  // Reserve the native inset icon gap even while the fixed sidebar reveals its labels over the page.
  return <div ref={wrapper} data-rail="hover" data-pinned={pinned} className={pinned ? 'relative z-20 shrink-0' : 'relative z-20 w-[calc(var(--sidebar-w-icon)+(--spacing(4)))] shrink-0'}
    onPointerEnter={event => { if (event.pointerType === 'mouse' || event.pointerType === 'pen') { clearTimeout(intent.current); intent.current = setTimeout(() => setOpen(true), HOVER_REVEAL_MS); } }}
    onPointerLeave={foldLater}
    onFocusCapture={event => { if (event.target.matches(':focus-visible')) { clearTimeout(intent.current); setOpen(true); } }}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) foldLater(); }}
    onKeyDownCapture={event => { if (!pinned && event.key === 'Escape' && event.target instanceof Node && event.currentTarget.contains(event.target)) { event.preventDefault(); event.stopPropagation(); clearTimeout(intent.current); setOpen(false); } }}>
    {sidebar}
  </div>;
}
