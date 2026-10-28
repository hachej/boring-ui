'use client';

// The navigation: a bottom tab bar when compact, the shadcn sidebar (icon rail plus NavUser, the sidebar-07 and sidebar-08 patterns) when
// expanded. Choosing an item only calls `route.onChange`: the app's router owns the URL, and the shell adds no history entry.
import { useEffect, useRef, useState } from 'react';
import type { ComponentType, KeyboardEvent, ReactNode } from 'react';
import { EllipsisIcon, SparklesIcon } from 'lucide-react';
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarRail, SidebarSeparator, useSidebar } from '@/components/ui/sidebar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { afterBack } from './back';
import { NavUser } from './account';
import { useAgentLayer } from './agent-layer';
import { usePmSelecting } from '../pm-panel/pm-panel';
import type { AgentSpec } from './agent-layer';
import type { AccountSpec } from './account';
import { AppSheet, SHEET_ROW } from './app-sheet';
import type { AppShellText } from './text';

export interface NavItem {
  readonly id: string;
  readonly label: string;
  readonly icon: ComponentType<{ className?: string }>;
  readonly badge?: boolean;
  readonly render: () => ReactNode;
  /** The screen's own content inside the shell's sidebar (its list, say) while this item is on show: above the nav items, which move below it. `collapsed` is true on the icon rail, so the content can fold with it. */
  readonly sidebar?: (state: { readonly collapsed: boolean }) => ReactNode;
}

/** The most tabs the bar shows. */
const MAX_TABS = 4;

/** Up to four items are all tabs; more than four give three tabs and the rest behind « Plus ». */
export function splitNav<T>(items: readonly T[]): { readonly tabs: readonly T[]; readonly overflow: readonly T[] } {
  return items.length <= MAX_TABS ? { tabs: items, overflow: [] } : { tabs: items.slice(0, MAX_TABS - 1), overflow: items.slice(MAX_TABS - 1) };
}

/** The host's Badge marks a screen with news. Its classes only place it. */
const Dot = ({ className }: { readonly className?: string }) => <Badge aria-hidden="true" data-testid="nav-badge" className={className} />;

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
  const pickable = usePmSelecting();
  const [plusOpen, setPlusOpen] = useState(false);
  const shown = items.length > 1;
  useTabbarHeight(bar, shown);
  if (!shown) return null;
  const { tabs, overflow } = splitNav(items);
  const inOverflow = overflow.find(item => item.id === activeId);
  const tab = (item: NavItem) => <Button key={item.id} variant={item.id === activeId ? 'secondary' : 'ghost'} role="tab" data-testid={`tab-${item.id}`} aria-selected={item.id === activeId} tabIndex={item.id === activeId ? 0 : -1}
    onClick={() => onChange(item.id)} className={TAB}>
    <item.icon />{item.label}{item.badge && <Dot className="absolute top-1 left-1/2 ml-2" />}
  </Button>;
  const Plus = overflow.length ? (inOverflow?.icon ?? EllipsisIcon) : undefined;
  return <nav ref={bar} role="tablist" aria-label={text.tabs} data-testid="tabbar" data-feedback-ignore={pickable ? undefined : ''} onKeyDown={arrows}
    className="relative z-(--app-shell-z-tabs) box-border flex min-h-[calc(3.5rem+env(safe-area-inset-bottom))] shrink-0 bg-background pb-[env(safe-area-inset-bottom)]">
    <Separator className="absolute inset-x-0 top-0" />
    {tabs.map(tab)}
    {Plus && <>
      <Button variant={inOverflow ? 'secondary' : 'ghost'} role="tab" data-testid="tab-plus" aria-selected={Boolean(inOverflow)} aria-haspopup="dialog" tabIndex={inOverflow ? 0 : -1} onClick={() => setPlusOpen(true)}
        className={TAB}>
        <Plus />{inOverflow?.label ?? text.more}{!inOverflow && overflow.some(item => item.badge) && <Dot className="absolute top-1 left-1/2 ml-2" />}
      </Button>
      <AppSheet open={plusOpen} onOpenChange={setPlusOpen} title={text.more}>
        {overflow.map(item => <Button key={item.id} variant={item.id === activeId ? 'secondary' : 'ghost'} size="lg" data-testid={`plus-${item.id}`} aria-current={item.id === activeId} className={SHEET_ROW}
          onClick={() => { setPlusOpen(false); afterBack(() => onChange(item.id)); }}>
          <item.icon data-icon="inline-start" />{item.label}{item.badge && <Dot className="ml-auto" />}
        </Button>)}
      </AppSheet>
    </>}
  </nav>;
}

/** The expanded sidebar: the app title, the nav items (none with one item) and the account in the footer. */
export function AppSidebar({ rail = 'icon', title, items, activeId, onChange, agent, account, improve, text }: {
  readonly rail?: 'icon' | 'hover'; readonly title: string; readonly items: readonly NavItem[]; readonly activeId: string; readonly onChange: (id: string) => void;
  readonly agent: AgentSpec | undefined; readonly account: AccountSpec | undefined; readonly improve: boolean; readonly text: AppShellText;
}) {
  const { setOpen, setOpenMobile, state, isMobile } = useSidebar();
  // In the phone sheet, choosing a screen closes it.
  const choose = (id: string) => { setOpenMobile(false); onChange(id); };
  const own = items.find(item => item.id === activeId)?.sidebar?.({ collapsed: state === 'collapsed' && !isMobile });
  const layer = useAgentLayer();
  const pressed = layer.state !== 'closed' && layer.showing === 'agent';
  const AgentIcon = agent?.icon ?? SparklesIcon;
  const agentLabel = agent?.label ?? agent?.chatProps?.labels?.title ?? text.assistant;
  const sidebar = <Sidebar collapsible="icon" variant="inset" data-testid="app-sidebar">
    {/* The phone sheet is portaled out of the shell root, so the `.app-shell` reset would not reach its buttons: this wrapper carries it (`contents`: no box of its own). */}
    <div className="app-shell contents">
    <SidebarHeader><p data-testid="sidebar-title" className="m-0 truncate px-2 py-1 text-base font-semibold group-data-[collapsible=icon]:hidden">{title}</p></SidebarHeader>
    <SidebarContent>
      {own != null && <div data-testid="sidebar-screen" className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{own}</div>}
      {items.length > 1 && <SidebarGroup className={own != null ? 'shrink-0' : undefined}><SidebarGroupContent><SidebarMenu>
        {items.map(item => <SidebarMenuItem key={item.id}>
          <SidebarMenuButton isActive={item.id === activeId} tooltip={item.label} data-testid={`nav-${item.id}`} className="pointer-coarse:min-h-11 pointer-coarse:min-w-11" onClick={() => choose(item.id)}>
            <item.icon />
            <span>{item.label}</span>
            {item.badge && <Dot className="ml-auto group-data-[collapsible=icon]:hidden" />}
          </SidebarMenuButton>
        </SidebarMenuItem>)}
      </SidebarMenu></SidebarGroupContent></SidebarGroup>}
      {/* The assistant is a layer, never a destination: no route, it toggles the right panel. */}
      {agent && <>
        {items.length > 1 && <SidebarSeparator />}
        <SidebarGroup><SidebarGroupContent><SidebarMenu><SidebarMenuItem>
          <SidebarMenuButton isActive={pressed} aria-pressed={pressed} tooltip={agentLabel} data-testid="nav-agent" className="pointer-coarse:min-h-11 pointer-coarse:min-w-11"
            onClick={() => { setOpenMobile(false); if (pressed) layer.close(); else layer.open('agent', 'half'); }}>
            <AgentIcon /><span>{agentLabel}</span>
          </SidebarMenuButton>
        </SidebarMenuItem></SidebarMenu></SidebarGroupContent></SidebarGroup>
      </>}
    </SidebarContent>
    <SidebarFooter><NavUser account={account} improve={improve} text={text} /></SidebarFooter>
    <SidebarRail />
    </div>
  </Sidebar>;
  if (rail !== 'hover') return sidebar;
  // Reserve the native inset icon gap even while the fixed sidebar reveals its labels over the page.
  return <div data-rail="hover" className="relative z-20 w-[calc(var(--sidebar-width-icon)+(--spacing(4)))] shrink-0"
    onPointerEnter={event => { if (event.pointerType === 'mouse' || event.pointerType === 'pen') setOpen(true); }}
    onPointerLeave={() => setOpen(false)}
    onFocusCapture={event => { if (event.target.matches(':focus-visible')) setOpen(true); }}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
    onKeyDownCapture={event => { if (event.key === 'Escape' && event.target instanceof Node && event.currentTarget.contains(event.target)) { event.preventDefault(); event.stopPropagation(); setOpen(false); } }}>
    {sidebar}
  </div>;
}
