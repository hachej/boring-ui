import { createRoot } from 'react-dom/client';
import { SidebarProvider, Sidebar, SidebarContent, SidebarInset } from '@/components/ui/sidebar';

// D-1789: the sidebar width is a theme token. ?theme=<css width> adds an unlayered `:root { --sidebar-width }` (what an app's theme.core.css does);
// ?provider=<css width> passes it through the SidebarProvider's style.
const query = new URLSearchParams(location.search);
if (query.get('theme')) { const style = document.createElement('style'); style.textContent = `:root { --sidebar-width: ${query.get('theme')}; }`; document.head.append(style); }
const style = query.get('provider') ? { '--sidebar-width': query.get('provider') } : undefined;

createRoot(document.getElementById('root')).render(<div className="app-shell"><SidebarProvider style={style}>
  <Sidebar collapsible="icon"><SidebarContent>Comptes</SidebarContent></Sidebar>
  <SidebarInset>Écritures</SidebarInset>
</SidebarProvider></div>);
