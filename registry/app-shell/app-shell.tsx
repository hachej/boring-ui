'use client';

// The app shell. Layout A (`screen`): one screen at a time. Compact: bottom tabs (at most four; more give three plus « Plus »), or with `compactNav="sheet"` no bar and the sidebar as a sheet from the header. Expanded:
// the shadcn sidebar (icon rail plus NavUser). Layout B (`workspace`): the same, with a screen made of a `ListDetail`; the sidebar starts
// as the icon rail below 1280px, and from 1280px when the screen has no `sidebar` content (D-1909); the person's choice is kept. Layout C (`chat`): the one nav item renders the app's `AgentWorkspace`,
// untouched, below the same sidebar, account menu and header; there is no shell agent (the page is the chat). The shell imports nothing from pi-app: a layout C app installs the `pi-app` item itself. One header per screen
// (`useScreenHeader`). The AgentLayer is mounted once, here.
// Host concern: Pi has no layout; the screen on show travels as the agent's context (useAgentContext -> createPromptContext).
import { useEffect, useState, useSyncExternalStore } from 'react';
import { afterStacksBack } from '../utils/back';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { AccountAvatar, AccountChoices } from './account';
import type { AccountSpec } from './account';
import { AgentDockLayout, AgentLayer, AgentLayerProvider } from './agent-layer';
import type { AgentSpec } from './agent-layer';
import { NoPanelLayout } from './shell-panel';
import type { ShellPanel } from './shell-panel';
import { ScreenActiveContext, useAgentContext } from './agent-context';
import { useIsCompact } from './compact';
import { HeaderProvider, ScreenHeader } from './header';
import { AppSidebar, ScreenSidebarSheet, TabBar } from './nav';
import { ResizableSidebarProvider } from './sidebar-resize';
import { useSidebarOpen } from './sidebar-open';
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
  /** A panel beside the app, opened from the account menu. The product manager is `pmPanel` from the Factory's `platform-ui/pm-panel`. */
  readonly panel?: ShellPanel;
  readonly account?: AccountSpec;
  /** The language of the shell's own words and the layer's (« Se déconnecter », « Plus », « Ouvrir l’assistant »…). When set it wins over the agent's `chatProps.locale` and the panel's; without it `chatProps.locale`, then the panel's, then English. */
  readonly locale?: AppShellLocale;
  /** The app's router owns the URL; the shell only reports the choice. */
  readonly route: { readonly id: string; readonly onChange: (id: string) => void };
  /**
   * `true`: a backdrop blur behind dialogs, alert dialogs, sheets and drawers (default `false`: only their dim; blurring the page costs
   * frames on slow phones). Overlays live in a portal, so the shell marks `<html data-overlay-blur="on">` while it is mounted; the
   * shadcn overlays carry the rule (`in-data-[overlay-blur=on]:backdrop-blur-[var(--overlay-blur,4px)]`: an item's CSS stays inside `.app-shell`).
   */
  readonly overlayBlur?: boolean;
  /**
   * The wide-screen left pane can be resized (default `false`): its rail becomes a drag handle (`role="separator"`, arrow keys, double-click to reset),
   * between `min` and `max` rem (12 and 28). Fine pointer only; the phone sheet keeps `--sidebar-width-mobile`. The width is remembered per app and
   * per person; the theme's `--sidebar-width` stays the default. `true` or `{ min, max }`.
   */
  readonly resizable?: boolean | { readonly min?: number; readonly max?: number };
  /**
   * A stable id of the app (its slug), which names the app in the stored sidebar width instead of `title`: two apps with the same title on one origin,
   * or an app whose title is renamed or translated, keep (or do not share) their widths. Pass it with `resizable`; without it (or with an empty one) the key uses `title`.
   */
  readonly appId?: string;
}

/** The shells that ask for the blur now, and what `<html data-overlay-blur>` held before the first of them (the app's own HTML may set it). */
const blurOwners = new Set<symbol>();
let blurBefore: string | undefined;

/** `<html data-overlay-blur="on">` while any shell asks for it: set by the first owner, restored when the last one leaves. */
function useOverlayBlur(blur: boolean) {
  useEffect(() => {
    if (!blur || typeof document === 'undefined') return;
    const root = document.documentElement;
    const owner = Symbol('overlay-blur');
    if (blurOwners.size === 0) blurBefore = root.dataset.overlayBlur;
    blurOwners.add(owner);
    root.dataset.overlayBlur = 'on';
    return () => {
      blurOwners.delete(owner);
      if (blurOwners.size > 0) return;
      if (blurBefore === undefined) delete root.dataset.overlayBlur;
      else root.dataset.overlayBlur = blurBefore;
    };
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

function Shell({ resizable, appId, compactNav, layout, rail, title, nav, agent, panel, account, route, text }: { readonly resizable: AppShellProps['resizable']; readonly appId: string | undefined; readonly compactNav: NonNullable<AppShellProps['compactNav']>; readonly rail: NonNullable<AppShellProps['rail']>; readonly layout: AppShellProps['layout']; readonly title: string; readonly nav: readonly NavItem[]; readonly agent: AgentSpec | undefined; readonly panel: ShellPanel | undefined; readonly account: AccountSpec | undefined; readonly route: AppShellProps['route']; readonly text: AppShellText }) {
  const improve = panel && panel.menu !== false ? panel.label ?? text.improve : undefined;
  const Layout = panel?.Layout ?? NoPanelLayout;
  const compact = useIsCompact();
  const sheet = compact && compactNav === 'sheet';
  const [accountOpen, setAccountOpen] = useState(false);
  // The header's slot for the screen on show (an embedded AgentWorkspace puts its bar's controls there).
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const active = nav.find(item => item.id === route.id) ?? nav[0];
  // The left pane: the person's kept choice, else the first visit's default (D-1909). `rail="hover"` keeps its own reveal and today's default.
  const today = rail !== 'hover' && layout === 'screen';
  const paneOpen = useSidebarOpen(rail !== 'hover', { app: appId || title, person: account?.email }, layout === 'screen', today, Boolean(active?.sidebar));
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
  return <ResizableSidebarProvider data-testid="app-shell" resizable={resizable} app={appId || title} person={account?.email} defaultOpen={today} {...paneOpen} className="app-shell h-dvh min-h-0 overflow-hidden">
    {(!compact || sheet) && <AppSidebar rail={sheet ? 'icon' : rail} title={title} items={nav} activeId={active.id} onChange={choose} agent={agent} account={account} improve={improve} text={text} />}
    <AgentDockLayout>
      <div data-slot="sidebar-inset" className="relative flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden bg-card">
      <Layout screen={active.label} navigation={compact && !sheet ? <TabBar items={nav} activeId={active.id} onChange={choose} text={text} /> : undefined}>
        <ShellContext name={active.label} />
        <ScreenHeader fallbackTitle={active.label} compact={compact} avatar={avatar} menu={sheet} screenSidebar={compact && !sheet && active.sidebar ? <ScreenSidebarSheet key={active.id} item={active} text={text} /> : undefined} text={text} slotRef={setSlot} />
        <Screens items={nav} activeId={active.id} scrolls={layout === 'screen'} slot={slot} />
      </Layout>
      </div>
    </AgentDockLayout>
    <AgentLayer />
  </ResizableSidebarProvider>;
}

const never = () => () => {};

export function AppShell(props: AppShellProps) {
  const { layout, rail = 'icon', compactNav = 'tabs', agent, panel, title, nav, account, route } = props;
  if (layout === 'chat' && agent) throw new Error('AppShell layout "chat" takes no `agent`: the page is the chat (use `panel` for the product manager)');
  const text = appShellText(props.locale ?? agent?.chatProps?.locale ?? (panel?.locale as AppShellLocale | undefined));
  useOverlayBlur(props.overlayBlur ?? false);
  const alone = useSyncExternalStore(never, () => panel?.page?.matches() ?? false, () => false);
  if (alone && panel?.page) return <panel.page.Page config={panel.config} appName={title} locale={props.locale} />;
  return <AgentLayerProvider agent={agent} panel={panel} locale={props.locale} agentLink={props.agentLink} appName={props.title}>
    <HeaderProvider><Shell resizable={props.resizable} appId={props.appId} compactNav={compactNav} layout={layout} rail={rail} title={title} nav={nav} agent={agent} account={account} route={route} panel={panel} text={text} /></HeaderProvider>
  </AgentLayerProvider>;
}
