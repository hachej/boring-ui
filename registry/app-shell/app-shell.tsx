'use client';

// The app shell. Layout A (`screen`): one screen at a time. Compact: bottom tabs (at most four; more give three plus « Plus »), or with `compactNav="sheet"` no bar and the sidebar as a sheet from the header. Expanded:
// the shadcn sidebar (icon rail plus NavUser). Layout B (`workspace`): the same, with a screen made of a `ListDetail`; the sidebar starts
// as the icon rail because the list pane is the wide navigation. Layout C (`chat`): the one nav item renders the app's `AgentWorkspace`,
// untouched, below the same sidebar, account menu and header; there is no shell agent (the page is the chat). The shell imports nothing from pi-app: a layout C app installs the `pi-app` item itself. One header per screen
// (`useScreenHeader`). The AgentLayer is mounted once, here.
// Host concern: Pi has no layout; the screen on show travels as the agent's context (useAgentContext -> createPromptContext).
import { useEffect, useState } from 'react';
import { afterStacksBack } from './back';
import type { ReactNode } from 'react';
import { SidebarProvider } from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { AccountAvatar, AccountChoices } from './account';
import type { AccountSpec } from './account';
import { AgentDockLayout, AgentLayer, AgentLayerProvider } from './agent-layer';
import type { AgentSpec } from './agent-layer';
import { ImproveLayout } from '../pm-panel/pm-panel';
import type { ImproveProp } from '../pm-panel/pm-panel';
import { ScreenActiveContext, useAgentContext } from './agent-context';
import { useIsCompact } from './compact';
import { HeaderProvider, ScreenHeader } from './header';
import { AppSidebar, TabBar } from './nav';
import type { NavItem } from './nav';
import { AppSheet } from './app-sheet';
import { appShellText } from './text';
import { ScreenHeaderSlotContext } from '../utils/screen-header-slot';
import type { AppShellLocale, AppShellText } from './text';

export interface AppShellProps {
  /** A `screen` (tabs), B `workspace` (list and detail), C `chat` (the app's `AgentWorkspace`; no `agent`). */
  readonly layout: 'screen' | 'workspace' | 'chat';
  readonly title: string;
  readonly nav: readonly NavItem[];
  /** Wide-screen navigation: `hover` reveals labels over the page on hover or keyboard focus. Default: `icon` (the native sidebar toggle). */
  readonly rail?: 'icon' | 'hover';
  /** Phone navigation: `tabs` (default) is the bottom tab bar; `sheet` has no bar, the header's leading button opens the sidebar (the nav items, a screen's `sidebar` content and the account) as a sheet. */
  readonly compactNav?: 'tabs' | 'sheet';
  readonly agent?: AgentSpec;
  /** Consume agent/open/input launch parameters on mount (default). `false` leaves the URL and layer untouched. */
  readonly agentLink?: false;
  /** The product manager: « Améliorer l'app » in the account menu, the PM panel and the point layer. One line: `improve={{ agent: 'pm' }}` (the kit opens the app's PM door); or a host `ImproveSpec`. */
  readonly improve?: ImproveProp;
  readonly account?: AccountSpec;
  /** The language of the shell's own words and the layer's (« Se déconnecter », « Plus », « Ouvrir l’assistant »…). The agent's `chatProps.locale` wins when it sets one; else this; else English. */
  readonly locale?: AppShellLocale;
  /** The app's router owns the URL; the shell only reports the choice. */
  readonly route: { readonly id: string; readonly onChange: (id: string) => void };
  /**
   * `false`: no backdrop blur behind dialogs, sheets and drawers (blurring the page costs frames on slow phones), only their dim.
   * Default `true`. Overlays live in a portal, so the shell marks `<html data-overlay-blur="off">` while it is mounted; the app's
   * own CSS drops the blur there (the rule is in registry/README.md: an item's CSS stays inside `.app-shell`).
   */
  readonly overlayBlur?: boolean;
}

/** `<html data-overlay-blur="off">` while a shell asks for it. */
function useOverlayBlur(blur: boolean) {
  useEffect(() => {
    if (blur || typeof document === 'undefined') return;
    const root = document.documentElement;
    root.dataset.overlayBlur = 'off';
    return () => { delete root.dataset.overlayBlur; };
  }, [blur]);
}

/** Registers what is on show for the agent. A screen's own `useAgentContext` is mounted later and wins. */
function ShellContext({ name }: { readonly name: string }): null {
  useAgentContext({ name, params: {} });
  return null;
}

function ScreenBody({ item }: { readonly item: NavItem }): ReactNode { return item.render(); }

/** Every screen stays mounted; the ones not on show are `hidden` and do not register a header or a context. */
function Screens({ items, activeId, scrolls, slot }: { readonly items: readonly NavItem[]; readonly activeId: string; readonly scrolls: boolean; readonly slot: HTMLElement | null }) {
  return <div className="relative min-h-0 flex-1">
    {items.map(item => <ScreenActiveContext.Provider key={item.id} value={item.id === activeId}><ScreenHeaderSlotContext.Provider value={item.id === activeId ? slot : null}>
      <div hidden={item.id !== activeId} data-testid={`screen-${item.id}`} className={scrolls ? 'h-full overflow-y-auto overscroll-contain' : 'h-full overflow-hidden'}><ScreenBody item={item} /></div>
    </ScreenHeaderSlotContext.Provider></ScreenActiveContext.Provider>)}
  </div>;
}

function Shell({ compactNav, layout, rail, title, nav, agent, improve, account, route, text }: { readonly compactNav: NonNullable<AppShellProps['compactNav']>; readonly rail: NonNullable<AppShellProps['rail']>; readonly layout: AppShellProps['layout']; readonly title: string; readonly nav: readonly NavItem[]; readonly agent: AgentSpec | undefined; readonly improve: boolean; readonly account: AccountSpec | undefined; readonly route: AppShellProps['route']; readonly text: AppShellText }) {
  const compact = useIsCompact();
  const sheet = compact && compactNav === 'sheet';
  const [accountOpen, setAccountOpen] = useState(false);
  // The header's slot for the screen on show (an embedded AgentWorkspace puts its bar's controls there).
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const active = nav.find(item => item.id === route.id) ?? nav[0];
  if (!active) return null;
  // A nav choice waits for an open detail's stack entry to go back, so the app's router can replace the URL without that Back restoring
  // the detail's. Choosing the screen already on show changes nothing and keeps the detail.
  const choose = (id: string) => { if (id === active.id) route.onChange(id); else afterStacksBack(() => route.onChange(id)); };
  const hasAccount = Boolean(account) || improve;
  const avatar = hasAccount ? <>
    <Button variant="ghost" size="icon" data-testid="account-button" aria-label={account?.name ?? text.account} title={account?.name ?? text.account} onClick={() => setAccountOpen(true)}><AccountAvatar account={account} /></Button>
    <AppSheet open={accountOpen} onOpenChange={setAccountOpen} title={text.account}>
      <AccountChoices account={account} improve={improve} text={text} done={() => setAccountOpen(false)} />
    </AppSheet>
  </> : null;
  // The structure is the same compact or expanded, so a resize never remounts a screen.
  return <SidebarProvider data-testid="app-shell" defaultOpen={rail !== 'hover' && layout === 'screen'} className="app-shell h-dvh min-h-0 overflow-hidden">
    {(!compact || sheet) && <AppSidebar rail={sheet ? 'icon' : rail} title={title} items={nav} activeId={active.id} onChange={choose} agent={agent} account={account} improve={improve} text={text} />}
    <AgentDockLayout>
      <div data-slot="sidebar-inset" className="relative flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden bg-background">
      <ImproveLayout screen={active.label}navigation={compact && !sheet ? <TabBar items={nav} activeId={active.id} onChange={choose} text={text} /> : undefined}>
        <ShellContext name={active.label} />
        <ScreenHeader fallbackTitle={active.label} compact={compact} avatar={avatar} menu={sheet} text={text} slotRef={setSlot} />
        <Screens items={nav} activeId={active.id} scrolls={layout === 'screen'} slot={slot} />
      </ImproveLayout>
      </div>
    </AgentDockLayout>
    <AgentLayer />
  </SidebarProvider>;
}

export function AppShell(props: AppShellProps) {
  const { layout, rail = 'icon', compactNav = 'tabs', agent, improve, title, nav, account, route } = props;
  if (layout === 'chat' && agent) throw new Error('AppShell layout "chat" takes no `agent`: the page is the chat (use `improve` for the product manager)');
  const text = appShellText((agent ?? (improve && 'chatProps' in improve ? improve : undefined))?.chatProps?.locale ?? props.locale);
  useOverlayBlur(props.overlayBlur ?? true);
  return <AgentLayerProvider agent={agent} improve={improve} locale={props.locale} agentLink={props.agentLink} appName={props.title}>
    <HeaderProvider><Shell compactNav={compactNav} layout={layout} rail={rail} title={title} nav={nav} agent={agent} account={account} route={route} improve={Boolean(improve)} text={text} /></HeaderProvider>
  </AgentLayerProvider>;
}
