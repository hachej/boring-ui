'use client';

// The app shell, layout A (`screen`): one screen at a time. Compact: bottom tabs (at most four; more give three plus « Plus »). Expanded:
// the shadcn sidebar (icon rail plus NavUser). One header per screen (`useScreenHeader`). The AgentLayer is mounted once, here.
// Host concern: Pi has no layout; the screen on show travels as the agent's context (useAgentContext -> createPromptContext).
import { useState } from 'react';
import type { ReactNode } from 'react';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { AccountAvatar, AccountMenu } from './account';
import type { AccountSpec } from './account';
import { AgentLayer, AgentLayerProvider } from './agent-layer';
import type { AgentSpec } from './agent-layer';
import { ScreenActiveContext, useAgentContext } from './agent-context';
import { useIsCompact } from './compact';
import { HeaderProvider, ScreenHeader } from './header';
import { AppSidebar, TabBar } from './nav';
import type { NavItem } from './nav';
import { AppSheet } from './sheet';
import { appShellText } from './text';
import type { AppShellText } from './text';

export interface AppShellProps {
  /** Layout A is `screen`; `workspace` and `chat` come later. */
  readonly layout: 'screen' | 'workspace' | 'chat';
  readonly title: string;
  readonly nav: readonly NavItem[];
  readonly agent?: AgentSpec;
  /** The product manager: adds « Améliorer l'app » to the account menu. */
  readonly improve?: AgentSpec;
  readonly account?: AccountSpec;
  /** The app's router owns the URL; the shell only reports the choice. */
  readonly route: { readonly id: string; readonly onChange: (id: string) => void };
}

/** Registers what is on show for the agent. A screen's own `useAgentContext` is mounted later and wins. */
function ShellContext({ name }: { readonly name: string }): null {
  useAgentContext({ name, params: {} });
  return null;
}

function ScreenBody({ item }: { readonly item: NavItem }): ReactNode { return item.render(); }

/** Every screen stays mounted; the ones not on show are `hidden` and do not register a header or a context. */
function Screens({ items, activeId }: { readonly items: readonly NavItem[]; readonly activeId: string }) {
  return <div className="relative min-h-0 flex-1">
    {items.map(item => <ScreenActiveContext.Provider key={item.id} value={item.id === activeId}>
      <div hidden={item.id !== activeId} data-testid={`screen-${item.id}`} className="h-full overflow-y-auto overscroll-contain"><ScreenBody item={item} /></div>
    </ScreenActiveContext.Provider>)}
  </div>;
}

function Shell({ title, nav, agent, improve, account, route, text }: { readonly title: string; readonly nav: readonly NavItem[]; readonly agent: AgentSpec | undefined; readonly improve: boolean; readonly account: AccountSpec | undefined; readonly route: AppShellProps['route']; readonly text: AppShellText }) {
  const compact = useIsCompact();
  const [accountOpen, setAccountOpen] = useState(false);
  const active = nav.find(item => item.id === route.id) ?? nav[0];
  if (!active) return null;
  const hasAccount = Boolean(account) || improve;
  const avatar = hasAccount ? <>
    <button type="button" data-testid="account-button" aria-label={account?.name ?? text.account} onClick={() => setAccountOpen(true)}
      className="inline-flex size-9 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/60 pointer-coarse:min-h-11 pointer-coarse:min-w-11"><AccountAvatar account={account} /></button>
    <AppSheet open={accountOpen} onOpenChange={setAccountOpen} title={account?.name ?? text.account}>
      <AccountMenu account={account} improve={improve} text={text} done={() => setAccountOpen(false)} />
    </AppSheet>
  </> : null;
  // The structure is the same compact or expanded, so a resize never remounts a screen.
  return <SidebarProvider data-testid="app-shell" className="h-dvh min-h-0 overflow-hidden">
    {!compact && <AppSidebar title={title} items={nav} activeId={active.id} onChange={route.onChange} agent={agent} account={account} improve={improve} text={text} />}
    <SidebarInset className="min-h-0 min-w-0 overflow-hidden">
      <ShellContext name={active.label} />
      <ScreenHeader fallbackTitle={active.label} compact={compact} avatar={avatar} text={text} />
      <Screens items={nav} activeId={active.id} />
      {compact && <TabBar items={nav} activeId={active.id} onChange={route.onChange} text={text} />}
    </SidebarInset>
    <AgentLayer />
  </SidebarProvider>;
}

export function AppShell(props: AppShellProps) {
  if (props.layout !== 'screen') throw new Error(`AppShell layout "${props.layout}" is not implemented`);
  const { agent, improve, title, nav, account, route } = props;
  const text = appShellText((agent ?? improve)?.chatProps?.locale);
  return <AgentLayerProvider agent={agent} improve={improve}>
    <HeaderProvider><Shell title={title} nav={nav} agent={agent} account={account} route={route} improve={Boolean(improve)} text={text} /></HeaderProvider>
  </AgentLayerProvider>;
}
