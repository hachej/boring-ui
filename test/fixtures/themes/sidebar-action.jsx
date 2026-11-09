import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Badge } from '@/components/ui/badge';
import { SidebarProvider, Sidebar, SidebarContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarMenuAction, SidebarMenuBadge, SidebarMenuSub, SidebarMenuSubItem, SidebarMenuSubButton, SidebarTrigger, useSidebar } from '@/components/ui/sidebar';

// D-1904: sidebar rows with a « … » SidebarMenuAction and a SidebarMenuBadge (the count). Fictional accounting data. ?theme=light|dark; ?mode=collapsed folds the sidebar to its icon rail (collapsible="icon"). The nested row has a button, an action, a count and an open SidebarMenuSub.
const query = new URLSearchParams(location.search);
document.documentElement.classList.toggle('dark', query.get('theme') === 'dark');
const More = () => <SidebarMenuAction aria-label="Plus"><span aria-hidden="true">…</span></SidebarMenuAction>;
const rows = [
  ['plain', 'Journal', false, null],
  ['action', 'Banque', true, null],
  ['badge', 'Brouillons', false, '8'],
  ['nested', 'Exercices', true, '3'],
  ['dot', 'Importer', false, null],
  ['subbadge', 'Clôtures', true, null, 'badge'],
  ['subaction', 'Archives', false, '5', 'action'],
  ['folder', 'Pièces justificatives de l’exercice en cours avec un très long nom de dossier', true, '128'],
];

const collapsed = query.get('mode') === 'collapsed';
// D-1972: ?mode=sheet is the phone nav: below md the Sidebar renders in its real Sheet, portaled to body outside the SidebarProvider wrapper, and is opened here.
const sheet = ['sheet', 'sheet-row', 'sheet-tap'].includes(query.get('mode'));
// D-2020: ?mode=sheet-tap opens the sheet with a real tap on a SidebarTrigger (the focus ring and scrollbar are about how it opens), and has more rows than the viewport.
const tap = query.get('mode') === 'sheet-tap';
// D-1972: ?mode=sheet-row is a consumer that sets --sidebar-row to 3.5rem on its SidebarProvider and gives its rows h-14.
const tall = query.get('mode') === 'sheet-row';
const OpenSheet = () => { const { setOpenMobile } = useSidebar(); useEffect(() => setOpenMobile(true), [setOpenMobile]); return null; };
const Dot = () => <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="currentColor" /></svg>;
const Sub = () => <SidebarMenuSub>{['2025', '2024'].map(year => <SidebarMenuSubItem key={year}><SidebarMenuSubButton href="#" data-sub={year}><span>{year}</span></SidebarMenuSubButton></SidebarMenuSubItem>)}</SidebarMenuSub>;

// D-1960 round 2: a parent's pairing looks at its own children only: a child row's count or action, in an open sub-list, must not hide the parent's action or count.
const SubWith = ({ kind }) => <SidebarMenuSub><SidebarMenuSubItem><SidebarMenuSubButton href="#"><span>2025</span></SidebarMenuSubButton>{kind === 'badge' ? <SidebarMenuBadge>2</SidebarMenuBadge> : <More />}</SidebarMenuSubItem></SidebarMenuSub>;

createRoot(document.getElementById('root')).render(<>{tap ? <SidebarTrigger /> : null}<SidebarProvider defaultOpen={!collapsed} style={tall ? { '--sidebar-row': '3.5rem' } : undefined}><Sidebar collapsible={collapsed ? 'icon' : sheet ? 'offcanvas' : 'none'} className={collapsed || sheet ? undefined : 'w-full'}>{sheet && !tap ? <OpenSheet /> : null}<SidebarContent><SidebarMenu>
  {rows.map(([id, label, action, count, child]) => <SidebarMenuItem key={id} data-row={id}>
    <SidebarMenuButton className={tall ? 'h-14' : undefined}>{collapsed ? <Dot /> : null}<span>{label}</span>{id === 'dot' ? <Badge aria-hidden="true" className="ml-auto group-data-[collapsible=icon]:hidden" /> : null}</SidebarMenuButton>
    {action ? <More /> : null}
    {count ? <SidebarMenuBadge>{count}</SidebarMenuBadge> : null}
    {id === 'dot' ? <><SidebarMenuBadge>{0}</SidebarMenuBadge><SidebarMenuBadge /></> : null}
    {id === 'nested' ? <Sub /> : null}
    {child ? <SubWith kind={child} /> : null}
  </SidebarMenuItem>)}
  {tap ? Array.from({ length: 8 }, (_, n) => <SidebarMenuItem key={n}><SidebarMenuButton><span>Archive {n + 1}</span></SidebarMenuButton></SidebarMenuItem>) : null}
</SidebarMenu></SidebarContent></Sidebar></SidebarProvider></>);
