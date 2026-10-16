// Adapted from tremorlabs/template-planner, pinned in README.md. MIT, Tremor Labs, Inc.
import { BotIcon, Building2Icon, CheckCheckIcon, ChevronRightIcon, CreditCardIcon, FileTextIcon, LayoutDashboardIcon, MoonIcon, SunIcon, ChartNoAxesCombinedIcon } from 'lucide-react';
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarTrigger, useSidebar } from '../../examples/app-shell/components/ui/sidebar';
import { Button } from '../../registry/button/button';
import { SCREEN_NAMES } from './screen-names.mjs';

const entries = [
  ['dashboard', LayoutDashboardIcon], ['approvals', CheckCheckIcon], ['invoices', FileTextIcon], ['suppliers', Building2Icon], ['spend', ChartNoAxesCombinedIcon], ['payments', CreditCardIcon],
] as const;

export function WorkspaceNav({ view, go, api, count }) {
  const { isMobile, setOpenMobile } = useSidebar();
  const close = () => { if (isMobile) setOpenMobile(false); };
  return <Sidebar variant="sidebar" className="border-r border-border">
    <SidebarHeader className="px-4 py-5"><div className="flex items-center gap-2.5"><span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-background text-xs font-semibold text-primary shadow-xs">HP</span><div className="min-w-0"><p className="truncate text-sm font-semibold">Harbor &amp; Pine</p><p className="text-xs text-muted-foreground">Finance workspace</p></div></div></SidebarHeader>
    <SidebarContent className="gap-0 px-3 pt-3">
      <p className="px-2 pb-2 text-xs font-medium text-muted-foreground">Accounts payable</p>
      <SidebarMenu className="gap-1">{entries.map(([screen, Icon]) => <SidebarMenuItem key={screen}><SidebarMenuButton isActive={api?.placement !== 'page' && (view.screen === screen || screen === 'invoices' && view.screen === 'invoice' || screen === 'suppliers' && view.screen === 'supplier')} data-testid={`nav-${screen}`} onClick={() => { close(); go({ screen }); }} className="h-9 rounded-md px-2.5 text-sm data-[active=true]:bg-primary/8 data-[active=true]:text-primary"><Icon aria-hidden="true" className="size-4" /><span>{SCREEN_NAMES[screen]}</span>{screen === 'approvals' && <span className="ml-auto rounded border border-border bg-background px-1.5 text-xs tabular-nums text-muted-foreground">{count}</span>}</SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu>
      <div className="my-5 border-t border-border" />
      <SidebarMenu><SidebarMenuItem><SidebarMenuButton data-testid="nav-agent" isActive={api?.placement === 'page'} onClick={() => { close(); api?.setPlacement('page'); }} className="h-9 rounded-md px-2.5 text-sm data-[active=true]:bg-primary/8 data-[active=true]:text-primary"><BotIcon aria-hidden="true" className="size-4" /><span>Agent</span></SidebarMenuButton></SidebarMenuItem></SidebarMenu>
    </SidebarContent>
    <SidebarFooter className="gap-4 p-4"><p className="text-xs leading-5 text-muted-foreground">Demo workspace<br />Fictional data. No payments sent.</p><div className="flex items-center gap-2.5 border-t border-border pt-4"><span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-background text-xs font-medium">JR</span><div><p className="text-sm font-medium">Jamie Reed</p><p className="text-xs text-muted-foreground">Finance team</p></div></div></SidebarFooter>
  </Sidebar>;
}

export function SiteHeader({ title, theme, setTheme }) {
  return <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background px-4 sm:px-6"><SidebarTrigger /><span className="h-4 w-px bg-border" /><span className="hidden text-sm text-muted-foreground sm:inline">Finance</span><ChevronRightIcon aria-hidden="true" className="hidden size-3.5 text-muted-foreground sm:block" /><span className="min-w-0 truncate text-sm font-medium">{title}</span><span className="ml-auto hidden text-xs text-muted-foreground sm:inline">March 2031</span><Button size="icon" variant="ghost" aria-label={theme === 'dark' ? 'Use light theme' : 'Use dark theme'} data-testid="theme-toggle" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="ml-auto size-9 sm:ml-0">{theme === 'dark' ? <SunIcon className="size-4" /> : <MoonIcon className="size-4" />}</Button></header>;
}
