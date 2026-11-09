import { createRoot } from 'react-dom/client';
import { SidebarProvider, Sidebar, SidebarContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarMenuAction, SidebarMenuBadge, SidebarMenuSub, SidebarMenuSubItem, SidebarMenuSubButton } from '@/components/ui/sidebar';

// D-1904: sidebar rows with a « … » SidebarMenuAction and a SidebarMenuBadge (the count). Fictional accounting data. ?theme=light|dark; ?mode=collapsed folds the sidebar to its icon rail (collapsible="icon"). The nested row has a button, an action, a count and an open SidebarMenuSub.
const query = new URLSearchParams(location.search);
document.documentElement.classList.toggle('dark', query.get('theme') === 'dark');
const More = () => <SidebarMenuAction aria-label="Plus"><span aria-hidden="true">…</span></SidebarMenuAction>;
const rows = [
  ['plain', 'Journal', false, null],
  ['action', 'Banque', true, null],
  ['badge', 'Brouillons', false, '8'],
  ['nested', 'Exercices', true, '3'],
  ['folder', 'Pièces justificatives de l’exercice en cours avec un très long nom de dossier', true, '128'],
];

const collapsed = query.get('mode') === 'collapsed';
const Dot = () => <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="currentColor" /></svg>;
const Sub = () => <SidebarMenuSub>{['2025', '2024'].map(year => <SidebarMenuSubItem key={year}><SidebarMenuSubButton href="#" data-sub={year}><span>{year}</span></SidebarMenuSubButton></SidebarMenuSubItem>)}</SidebarMenuSub>;

createRoot(document.getElementById('root')).render(<SidebarProvider defaultOpen={!collapsed}><Sidebar collapsible={collapsed ? 'icon' : 'none'} className={collapsed ? undefined : 'w-full'}><SidebarContent><SidebarMenu>
  {rows.map(([id, label, action, count]) => <SidebarMenuItem key={id} data-row={id}>
    <SidebarMenuButton>{collapsed ? <Dot /> : null}<span>{label}</span></SidebarMenuButton>
    {action ? <More /> : null}
    {count ? <SidebarMenuBadge>{count}</SidebarMenuBadge> : null}
    {id === 'nested' ? <Sub /> : null}
  </SidebarMenuItem>)}
</SidebarMenu></SidebarContent></Sidebar></SidebarProvider>);
