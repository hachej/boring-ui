import { createRoot } from 'react-dom/client';
import { SidebarProvider, Sidebar, SidebarContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarMenuAction, SidebarMenuBadge } from '@/components/ui/sidebar';

// D-1904: sidebar rows with a « … » SidebarMenuAction and a SidebarMenuBadge (the count). Fictional accounting data. ?theme=light|dark.
const query = new URLSearchParams(location.search);
document.documentElement.classList.toggle('dark', query.get('theme') === 'dark');
const More = () => <SidebarMenuAction aria-label="Plus"><span aria-hidden="true">…</span></SidebarMenuAction>;
const rows = [
  ['plain', 'Journal', false, null],
  ['action', 'Banque', true, null],
  ['badge', 'Brouillons', false, '8'],
  ['folder', 'Pièces justificatives de l’exercice en cours avec un très long nom de dossier', true, '128'],
];

createRoot(document.getElementById('root')).render(<SidebarProvider><Sidebar collapsible="none" className="w-full"><SidebarContent><SidebarMenu>
  {rows.map(([id, label, action, count]) => <SidebarMenuItem key={id} data-row={id}>
    <SidebarMenuButton><span>{label}</span></SidebarMenuButton>
    {action ? <More /> : null}
    {count ? <SidebarMenuBadge>{count}</SidebarMenuBadge> : null}
  </SidebarMenuItem>)}
</SidebarMenu></SidebarContent></Sidebar></SidebarProvider>);
