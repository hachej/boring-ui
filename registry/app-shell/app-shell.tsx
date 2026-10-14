'use client';

// The app shell. Layout A (`screen`): one screen at a time. Compact: bottom tabs (at most four; more give three plus « Plus »). Expanded:
// the shadcn sidebar (icon rail plus NavUser). Layout B (`workspace`): the same, with a screen made of a `ListDetail`; the sidebar starts
// as the icon rail because the list pane is the wide navigation. Layout C (`chat`): the one nav item renders the app's `AgentWorkspace`,
// untouched, below the same sidebar, account menu and header; there is no shell agent (the page is the chat). The shell imports nothing from pi-app: a layout C app installs the `pi-app` item itself. One header per screen
// (`useScreenHeader`). The AgentLayer is mounted once, here.
// Host concern: Pi has no layout; the screen on show travels as the agent's context (useAgentContext -> createPromptContext).
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { SidebarProvider } from '@/components/ui/sidebar';
import { AccountAvatar, AccountMenu } from './account';
import type { AccountSpec } from './account';
import { AgentDockLayout, AgentLayer, AgentLayerProvider } from './agent-layer';
import type { AgentSpec } from './agent-layer';
import { ScreenActiveContext, useAgentContext } from './agent-context';
import { useIsCompact } from './compact';
import { HeaderProvider, ScreenHeader } from './header';
import { AppSidebar, TabBar } from './nav';
import type { NavItem } from './nav';
import { AppSheet } from './sheet';
import { appShellText } from './text';
import type { AppShellLocale, AppShellText } from './text';
import { PreviewNote, PreviewProvider, PreviewView, usePreview } from '../live-preview/preview';
import type { PreviewSettings } from '../live-preview/preview';
import { useBackLayer } from './back';
import { useAgentLayer } from './agent-layer';

export interface AppShellProps {
  /** A `screen` (tabs), B `workspace` (list and detail), C `chat` (the app's `AgentWorkspace`; no `agent`). */
  readonly layout: 'screen' | 'workspace' | 'chat';
  readonly title: string;
  readonly nav: readonly NavItem[];
  readonly agent?: AgentSpec;
  /** The product manager: adds « Améliorer l’app » to the account menu. */
  readonly improve?: AgentSpec;
  readonly account?: AccountSpec;
  /** The language of the shell's own words and the layer's (« Se déconnecter », « Plus », « Ouvrir l’assistant »…). The agent's `chatProps.locale` wins when it sets one; else this; else English. */
  readonly locale?: AppShellLocale;
  /** The app's router owns the URL; the shell only reports the choice. */
  readonly route: { readonly id: string; readonly onChange: (id: string) => void };
  /** The live preview (registry/live-preview): off unless `enabled`. `enabled: false` is the kill switch: cards render disabled and no view opens. */
  readonly preview?: PreviewSpec;
}

/** The host's live-preview settings. `frameUrl` is where preview-frame.html is served (same origin; default `/preview-frame.html`). */
export interface PreviewSpec {
  readonly enabled: boolean;
  readonly frameUrl?: string;
  readonly onSharePreview?: PreviewSettings['onSharePreview'];
  readonly onPreviewError?: PreviewSettings['onPreviewError'];
}

/** Registers what is on show for the agent. A screen's own `useAgentContext` is mounted later and wins. */
function ShellContext({ name }: { readonly name: string }): null {
  useAgentContext({ name, params: {} });
  return null;
}

function ScreenBody({ item }: { readonly item: NavItem }): ReactNode { return item.render(); }

/** Every screen stays mounted; the ones not on show are `hidden` and do not register a header or a context. */
function Screens({ items, activeId, scrolls }: { readonly items: readonly NavItem[]; readonly activeId: string; readonly scrolls: boolean }) {
  return <div className="relative min-h-0 flex-1">
    {items.map(item => <ScreenActiveContext.Provider key={item.id} value={item.id === activeId}>
      <div hidden={item.id !== activeId} data-testid={`screen-${item.id}`} className={scrolls ? 'h-full overflow-y-auto overscroll-contain' : 'h-full overflow-hidden'}><ScreenBody item={item} /></div>
    </ScreenActiveContext.Provider>)}
  </div>;
}

function Shell({ layout, title, nav, agent, improve, account, route, text }: { readonly layout: AppShellProps['layout']; readonly title: string; readonly nav: readonly NavItem[]; readonly agent: AgentSpec | undefined; readonly improve: boolean; readonly account: AccountSpec | undefined; readonly route: AppShellProps['route']; readonly text: AppShellText }) {
  const compact = useIsCompact();
  const [accountOpen, setAccountOpen] = useState(false);
  const preview = usePreview();
  const layer = useAgentLayer();
  // The preview view is a Back layer; on a phone it covers the app, so the agent sheet steps aside while it is open.
  useBackLayer(Boolean(preview.view), preview.close, 'sheet');
  useEffect(() => { if (preview.view && compact) layer.close(); }, [preview.view, compact, layer.close]);
  const active = nav.find(item => item.id === route.id) ?? nav[0];
  if (!active) return null;
  const hasAccount = Boolean(account) || improve;
  const avatar = hasAccount ? <>
    <button type="button" data-testid="account-button" aria-label={account?.name ?? text.account} onClick={() => setAccountOpen(true)}
      className="inline-flex size-9 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/60 pointer-coarse:min-h-11 pointer-coarse:min-w-11"><AccountAvatar account={account} /></button>
    <AppSheet open={accountOpen} onOpenChange={setAccountOpen} title={text.account}>
      <AccountMenu account={account} improve={improve} text={text} done={() => setAccountOpen(false)} />
    </AppSheet>
  </> : null;
  // The structure is the same compact or expanded, so a resize never remounts a screen.
  return <SidebarProvider data-testid="app-shell" defaultOpen={layout === 'screen'} className="app-shell h-dvh min-h-0 overflow-hidden">
    {!compact && <AppSidebar title={title} items={nav} activeId={active.id} onChange={route.onChange} agent={agent} account={account} improve={improve} text={text} />}
    <AgentDockLayout>
      <div data-slot="sidebar-inset" className="relative flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden bg-background">
      <ShellContext name={active.label} />
      <ScreenHeader fallbackTitle={active.label} compact={compact} avatar={avatar} text={text} />
      <PreviewNote />
      <Screens items={nav} activeId={active.id} scrolls={layout === 'screen'} />
      {compact && <TabBar items={nav} activeId={active.id} onChange={route.onChange} text={text} />}
      <PreviewView compact={compact} />
      </div>
    </AgentDockLayout>
    <AgentLayer />
  </SidebarProvider>;
}

export function AppShell(props: AppShellProps) {
  const { layout, agent, improve, title, nav, account, route } = props;
  if (layout === 'chat' && agent) throw new Error('AppShell layout "chat" takes no `agent`: the page is the chat (use `improve` for the product manager)');
  const locale = (agent ?? improve)?.chatProps?.locale ?? props.locale;
  const text = appShellText(locale);
  const preview = props.preview;
  const settings: PreviewSettings = { enabled: Boolean(preview?.enabled), locale: locale ?? 'en', frameUrl: preview?.frameUrl ?? '/preview-frame.html', onSharePreview: preview?.onSharePreview, onPreviewError: preview?.onPreviewError };
  return <PreviewProvider settings={settings}>
    <AgentLayerProvider agent={agent} improve={improve} locale={props.locale}>
      <HeaderProvider><Shell layout={layout} title={title} nav={nav} agent={agent} account={account} route={route} improve={Boolean(improve)} text={text} /></HeaderProvider>
    </AgentLayerProvider>
  </PreviewProvider>;
}
