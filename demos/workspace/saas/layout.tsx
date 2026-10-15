// The app chrome of the accounts-payable demo, adapted from satnaing/shadcn-admin (MIT, Copyright (c) 2024 Sat Naing, commit e16c87f2):
// `components/layout` (app-sidebar, nav-group, team-switcher, nav-user, header, main, search, profile-dropdown). TanStack Router's `Link`
// and `useLocation` are replaced by the demo's own screen navigation (`go`, the same path the agent's `show` tool takes). Built on shadcn/ui (MIT).
// @ts-nocheck: demo source, bundled by esbuild.
import { Fragment, useState } from 'react';
import { Anchor, BadgeCheck, Bell, ChevronsUpDown, CreditCard, FileText, LayoutDashboard, LogOut, Plus, Receipt, Search as SearchIcon, Settings, Sparkles, TreePine, Truck, Users, BarChart3, CheckCircle2 } from 'lucide-react';
import { cn } from './ui/utils';
import { Avatar, AvatarFallback } from './ui/avatar';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from './ui/dropdown-menu';
import { Input } from './ui/input';
import { Separator } from './ui/separator';
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarRail, SidebarTrigger, useSidebar } from './ui/sidebar';

export const USER = { name: 'Mara Whitfield', email: 'mara@harborpine.example', initials: 'MW' };
export const TEAMS = [{ name: 'Harbor & Pine Foods', logo: Anchor, plan: 'Accounts payable' }, { name: 'Pine & Co Trading', logo: TreePine, plan: 'Sandbox company' }];

/** Which nav item a screen belongs to. */
const SECTION = { dashboard: 'dashboard', approvals: 'approvals', invoices: 'invoices', invoice: 'invoices', suppliers: 'suppliers', supplier: 'suppliers', payments: 'payments', reports: 'reports', settings: 'settings' };

export function navGroups(approvals) {
  return [
    { title: 'General', items: [{ title: 'Dashboard', screen: 'dashboard', icon: LayoutDashboard }, { title: 'Approvals', screen: 'approvals', icon: CheckCircle2, badge: approvals || undefined },
      { title: 'Invoices', screen: 'invoices', icon: Receipt }, { title: 'Suppliers', screen: 'suppliers', icon: Truck }] },
    { title: 'Finance', items: [{ title: 'Payments', screen: 'payments', icon: CreditCard }, { title: 'Reports', screen: 'reports', icon: BarChart3 }] },
    { title: 'Other', items: [{ title: 'Settings', screen: 'settings', icon: Settings }] },
  ];
}

function TeamSwitcher() {
  const { isMobile } = useSidebar();
  const [active, setActive] = useState(TEAMS[0]);
  return <SidebarMenu><SidebarMenuItem>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton size="lg" data-testid="team-switcher" className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground">
          <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground"><active.logo className="size-4" /></div>
          <div className="grid flex-1 text-start text-sm leading-tight"><span className="truncate font-semibold">{active.name}</span><span className="truncate text-xs">{active.plan}</span></div>
          <ChevronsUpDown className="ms-auto" />
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg" align="start" side={isMobile ? 'bottom' : 'right'} sideOffset={4}>
        <DropdownMenuLabel className="text-xs text-muted-foreground">Companies</DropdownMenuLabel>
        {TEAMS.map((team, index) => <DropdownMenuItem key={team.name} onClick={() => setActive(team)} className="gap-2 p-2">
          <div className="flex size-6 items-center justify-center rounded-sm border"><team.logo className="size-4 shrink-0" /></div>{team.name}<DropdownMenuShortcut>⌘{index + 1}</DropdownMenuShortcut>
        </DropdownMenuItem>)}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="gap-2 p-2"><div className="flex size-6 items-center justify-center rounded-md border bg-background"><Plus className="size-4" /></div><div className="font-medium text-muted-foreground">Add company</div></DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </SidebarMenuItem></SidebarMenu>;
}

function UserMenuContent() {
  return <>
    <DropdownMenuLabel className="p-0 font-normal">
      <div className="flex items-center gap-2 px-1 py-1.5 text-start text-sm">
        <Avatar className="h-8 w-8 rounded-lg"><AvatarFallback className="rounded-lg">{USER.initials}</AvatarFallback></Avatar>
        <div className="grid flex-1 text-start text-sm leading-tight"><span className="truncate font-semibold">{USER.name}</span><span className="truncate text-xs text-muted-foreground">{USER.email}</span></div>
      </div>
    </DropdownMenuLabel>
    <DropdownMenuSeparator />
    <DropdownMenuGroup><DropdownMenuItem><Sparkles />Upgrade to Pro</DropdownMenuItem></DropdownMenuGroup>
    <DropdownMenuSeparator />
    <DropdownMenuGroup>
      <DropdownMenuItem><BadgeCheck />Account</DropdownMenuItem><DropdownMenuItem><CreditCard />Billing</DropdownMenuItem><DropdownMenuItem><Bell />Notifications</DropdownMenuItem>
    </DropdownMenuGroup>
    <DropdownMenuSeparator />
    <DropdownMenuItem variant="destructive"><LogOut />Sign out</DropdownMenuItem>
  </>;
}

function NavUser() {
  const { isMobile } = useSidebar();
  return <SidebarMenu><SidebarMenuItem>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton size="lg" data-testid="nav-user" className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground">
          <Avatar className="h-8 w-8 rounded-lg"><AvatarFallback className="rounded-lg">{USER.initials}</AvatarFallback></Avatar>
          <div className="grid flex-1 text-start text-sm leading-tight"><span className="truncate font-semibold">{USER.name}</span><span className="truncate text-xs">{USER.email}</span></div>
          <ChevronsUpDown className="ms-auto size-4" />
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg" side={isMobile ? 'bottom' : 'right'} align="end" sideOffset={4}><UserMenuContent /></DropdownMenuContent>
    </DropdownMenu>
  </SidebarMenuItem></SidebarMenu>;
}

export function AppSidebar({ view, go, approvals }) {
  const section = SECTION[view.screen];
  return <Sidebar collapsible="icon" variant="sidebar">
    <SidebarHeader><TeamSwitcher /></SidebarHeader>
    <SidebarContent>
      {navGroups(approvals).map(group => <SidebarGroup key={group.title}>
        <SidebarGroupLabel>{group.title}</SidebarGroupLabel>
        <SidebarMenu>
          {group.items.map(item => <SidebarMenuItem key={item.screen}>
            <SidebarMenuButton isActive={section === item.screen} tooltip={item.title} data-testid={`nav-${item.screen}`} onClick={() => go({ screen: item.screen })}>
              <item.icon /><span>{item.title}</span>{item.badge ? <Badge data-testid="nav-approvals-count" className="ms-auto rounded-full px-1.5 py-0 text-xs group-data-[collapsible=icon]:hidden">{item.badge}</Badge> : null}
            </SidebarMenuButton>
          </SidebarMenuItem>)}
        </SidebarMenu>
      </SidebarGroup>)}
    </SidebarContent>
    <SidebarFooter><NavUser /></SidebarFooter>
    <SidebarRail />
  </Sidebar>;
}

const NOTIFICATIONS = [
  { title: 'INV-2043 may be a duplicate', detail: 'Same supplier, PO and amount as INV-2041.' },
  { title: 'Brook & Sons Cleaning is past due', detail: 'INV-2033 was due on 2 Mar.' },
  { title: 'Payment run on Friday', detail: '7 invoices are scheduled for 14 Mar.' },
];

export function Header({ crumbs, go, onSearch }) {
  const [query, setQuery] = useState('');
  return <header className="z-10 h-16 shrink-0">
    <div className="relative flex h-full items-center gap-3 p-4 sm:gap-4">
      <SidebarTrigger variant="outline" className="max-md:scale-125" />
      <Separator orientation="vertical" className="h-6" />
      <nav aria-label="Breadcrumb" data-testid="breadcrumb" className="min-w-0 flex-1">
        <ol className="m-0 flex list-none items-center gap-1.5 p-0 text-sm text-muted-foreground">
          {crumbs.map((crumb, index) => <Fragment key={`${crumb.label}-${index}`}>
            {index > 0 && <li aria-hidden="true" className="select-none opacity-60">/</li>}
            <li className="min-w-0 truncate">{crumb.screen && index < crumbs.length - 1
              ? <button type="button" className="cursor-pointer hover:text-foreground" onClick={() => go(crumb.screen)}>{crumb.label}</button>
              : <span aria-current={index === crumbs.length - 1 ? 'page' : undefined} className={cn(index === crumbs.length - 1 && 'font-medium text-foreground')}>{crumb.label}</span>}</li>
          </Fragment>)}
        </ol>
      </nav>
      <form role="search" className="relative hidden sm:block" onSubmit={event => { event.preventDefault(); onSearch(query); }}>
        <SearchIcon aria-hidden="true" className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input data-testid="app-search" type="search" aria-label="Search invoices" placeholder="Search invoices..." value={query} onChange={event => setQuery(event.target.value)} className="h-9 w-40 ps-8 lg:w-56" />
      </form>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Notifications" data-testid="notifications" className="relative size-9 rounded-full">
            <Bell /><span aria-hidden="true" className="absolute end-2 top-2 size-2 rounded-full bg-destructive ring-2 ring-background" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel>Notifications</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {NOTIFICATIONS.map(item => <DropdownMenuItem key={item.title} className="flex-col items-start gap-0.5"><span className="font-medium">{item.title}</span><span className="text-xs text-muted-foreground">{item.detail}</span></DropdownMenuItem>)}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" aria-label="Account menu" data-testid="profile-menu" className="relative size-8 rounded-full p-0"><Avatar className="size-8"><AvatarFallback>{USER.initials}</AvatarFallback></Avatar></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56" align="end" forceMount><UserMenuContent /></DropdownMenuContent>
      </DropdownMenu>
    </div>
  </header>;
}

/** The page body: a title row with page actions, then the content, at the template's `Main` padding. */
export function Main({ title, description, actions, children, className }) {
  return <main className={cn('flex flex-col gap-4 px-4 py-6 @7xl/content:mx-auto @7xl/content:w-full @7xl/content:max-w-7xl', className)}>
    {title && <div className="flex flex-wrap items-end justify-between gap-2">
      <div><h1 className="text-2xl font-bold tracking-tight">{title}</h1>{description && <p className="text-muted-foreground">{description}</p>}</div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>}
    {children}
  </main>;
}

export { FileText, Users };
