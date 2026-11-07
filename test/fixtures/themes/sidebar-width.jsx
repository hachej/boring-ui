import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { SidebarProvider, Sidebar, SidebarContent, SidebarInset, useSidebar } from '@/components/ui/sidebar';

// D-1789: the sidebar width is a theme token. ?theme=<css width> adds an unlayered `:root { --sidebar-width }` (what an app's theme.core.css does);
// ?tm=<css width> sets --sidebar-width-mobile the same way; ?provider=<css width> passes it through the SidebarProvider's style; ?bare=1 swaps in a stylesheet without the app-shell item's css (shadcn sidebar alone);
// ?ch=<css length> sets --control-h on an ancestor (a density scope); ?open=0 starts folded to the icon rail; ?sheet=1 opens the phone sheet.
const query = new URLSearchParams(location.search);
if (query.get('theme') || query.get('tm')) { const style = document.createElement('style'); style.textContent = `:root { ${query.get('theme') ? `--sidebar-width: ${query.get('theme')};` : ''} ${query.get('tm') ? `--sidebar-width-mobile: ${query.get('tm')};` : ''} }`; document.head.append(style); }
if (query.get('bare')) document.querySelector('link[rel=stylesheet]').setAttribute('href', '/bare.css');
const style = query.get('provider') ? { '--sidebar-width': query.get('provider') } : undefined;
const scope = query.get('ch') ? { '--control-h': query.get('ch') } : undefined;
function Opener() { const { setOpenMobile } = useSidebar(); useEffect(() => { if (query.get('sheet')) setOpenMobile(true); }, [setOpenMobile]); return null; }

createRoot(document.getElementById('root')).render(<div className={query.get('bare') ? undefined : 'app-shell'} style={scope}><SidebarProvider style={style} defaultOpen={query.get('open') !== '0'}>
  <Opener />
  <Sidebar collapsible="icon"><SidebarContent>Comptes</SidebarContent></Sidebar>
  <SidebarInset>Écritures</SidebarInset>
</SidebarProvider></div>);
