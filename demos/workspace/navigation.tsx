// Sidebar and site header adapted from shadcn-fintech e338240d10c908ab49403adbcd0bb4cc980ebfce (MIT).
import { useEffect } from 'react';
import { BotIcon, Building2Icon, CheckCheckIcon, CreditCardIcon, FileTextIcon, FolderOpenIcon, HistoryIcon, LayoutDashboardIcon, LeafIcon, MoonIcon, SunIcon, TargetIcon, XIcon } from 'lucide-react';
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarTrigger, useSidebar } from '../../examples/app-shell/components/ui/sidebar';
import { Button } from '../../registry/button/button';
import { ConversationList } from '../../registry/pi-chat/history';
import { FileTree } from '@hachej/boring-ui-kit/file-tree-view';
import { SCREEN_NAMES } from './screen-names.mjs';

const entries = [
  ['dashboard', LayoutDashboardIcon], ['approvals', CheckCheckIcon], ['invoices', FileTextIcon], ['suppliers', Building2Icon], ['spend', TargetIcon], ['payments', CreditCardIcon],
];

export function WorkspaceNav({ view, go, api, count, panel, setPanel, conversations, provider, file, openFile, feed }) {
  const { isMobile, setOpenMobile } = useSidebar();
  const close = () => { setPanel(undefined); if (isMobile) setOpenMobile(false); };
  const pick = screen => { close(); go({ screen }); };
  useEffect(() => {
    if (panel !== 'library') return;
    let frame = 0, tries = 0;
    const focus = () => { const input = document.querySelector('[data-testid=library-popover] input[type=search]'); if (input) input.focus(); else if (tries++ < 60) frame = requestAnimationFrame(focus); };
    focus(); return () => cancelAnimationFrame(frame);
  }, [panel, provider]);
  useEffect(() => {
    if (!panel) return;
    const escape = event => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); setPanel(undefined); requestAnimationFrame(() => document.querySelector(`[data-testid=nav-${panel}]`)?.focus()); } };
    document.addEventListener('keydown', escape); return () => document.removeEventListener('keydown', escape);
  }, [panel]);
  return <Sidebar variant="inset" className="border-r border-border">
    <SidebarHeader className="px-4 py-5"><div className="flex items-center gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-emerald-700 text-emerald-50"><LeafIcon className="size-5" aria-hidden="true" /></span><div><p className="text-sm font-semibold tracking-tight">Harbor &amp; Pine</p><p className="text-xs text-muted-foreground">Accounts payable</p></div></div></SidebarHeader>
    <SidebarContent className="gap-0 px-3"><p className="px-2 pb-2 pt-3 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">Workspace</p><SidebarMenu>{entries.map(([screen, Icon]) => <SidebarMenuItem key={screen}><SidebarMenuButton isActive={api?.placement !== 'page' && view.screen === screen} data-testid={`nav-${screen}`} onClick={() => pick(screen)} className="h-10"><Icon aria-hidden="true" /><span>{SCREEN_NAMES[screen]}</span>{screen === 'approvals' && <span className="ml-auto rounded-md bg-muted px-1.5 text-xs tabular-nums">{count}</span>}</SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu>
    <p className="px-2 pb-2 pt-7 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">Assistant</p><SidebarMenu>
      <SidebarMenuItem><SidebarMenuButton data-testid="nav-agent" isActive={api?.placement === 'page'} onClick={() => { close(); api?.setPlacement('page'); }} className="h-10"><BotIcon aria-hidden="true" /><span>Agent</span></SidebarMenuButton></SidebarMenuItem>
      {[['history', 'History', HistoryIcon], ['library', 'Library', FolderOpenIcon]].map(([id, title, Icon]) => <SidebarMenuItem key={id}><SidebarMenuButton data-testid={`nav-${id}`} aria-expanded={panel === id} onClick={() => setPanel(current => current === id ? undefined : id)} className="h-10"><Icon aria-hidden="true" /><span>{title}</span></SidebarMenuButton></SidebarMenuItem>)}
    </SidebarMenu>
    {panel && <section data-testid={panel === 'history' ? 'conversations' : 'library-popover'} aria-label={panel === 'history' ? 'Conversations' : 'Library'} className="pi-chat mt-3 flex min-h-48 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-background">
      <header className="flex shrink-0 items-center justify-between gap-2 px-3 py-2"><h2 className="text-xs font-semibold">{panel === 'history' ? 'Conversations' : 'Library'}</h2><div className="flex items-center gap-1">{panel === 'history' && <Button size="sm" variant="ghost" data-testid="conversation-new" onClick={() => { conversations.onNew?.(); close(); }}>New</Button>}<Button size="icon-sm" variant="ghost" aria-label={`Close ${panel}`} onClick={close}><XIcon className="size-3.5" /></Button></div></header>
      {panel === 'history' ? <ConversationList conversations={conversations} autoFocus onPicked={close} /> : provider ? <div className="min-h-0 flex-1 overflow-auto"><FileTree variant="list" refresh={false} upload={false} history={false} revisionProvider={provider} refreshKey={feed} selectedPath={file} onOpen={path => { if (openFile(path)) close(); }} /></div> : <p role="status" className="p-3 text-xs text-muted-foreground">Loading…</p>}
    </section>}
    </SidebarContent>
    <SidebarFooter className="gap-3 p-4"><div className="rounded-xl border border-border bg-background p-3"><p className="text-xs font-medium">A fictional AP workspace</p><p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">Review, code and approve.<br />Your agent works alongside you.</p></div><div className="flex items-center gap-2"><span className="flex size-8 items-center justify-center rounded-full bg-muted text-xs font-semibold">JR</span><div><p className="text-xs font-medium">Jamie Reed</p><p className="text-[11px] text-muted-foreground">Finance team</p></div></div></SidebarFooter>
  </Sidebar>;
}

export function SiteHeader({ title, theme, setTheme }) {
  return <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border px-4 lg:px-6"><SidebarTrigger /><span className="h-4 w-px bg-border" /><span className="text-sm text-muted-foreground">Workspace</span><span className="text-muted-foreground/50">/</span><span className="truncate text-sm font-medium">{title}</span><span className="ml-auto hidden text-xs text-muted-foreground sm:inline">March 2031</span><Button size="icon-sm" variant="ghost" aria-label={theme === 'dark' ? 'Use light theme' : 'Use dark theme'} data-testid="theme-toggle" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <SunIcon className="size-4" /> : <MoonIcon className="size-4" />}</Button></header>;
}
