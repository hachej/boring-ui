import { useLayoutEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DeviceMobileIcon, SunIcon } from '@phosphor-icons/react';
import { AppShell } from '../../registry/app-shell/app-shell.tsx';
import { ImageIcon, LayoutDashboardIcon, MessageSquareIcon, MoonIcon, PanelLeftIcon, PanelsTopLeftIcon, Rows3Icon } from '../../registry/_shared/icons.ts';
import { createDemoChat } from './chat-controller.js';
import { GalleryContext } from './context.jsx';
import { Bases } from './sections/bases.jsx';
import { Blocs } from './sections/blocs.jsx';
import { Chat, chatProps } from './sections/chat.jsx';
import { Coquille } from './sections/coquille.jsx';
import { Visionneuses } from './sections/visionneuses.jsx';

// D-2012: the kit shown in its default style, in the real AppShell, over fictional data. One file, no network.
// `?theme=dark` starts dark, `#chat` (or any section id) starts on that section. Inside the phone preview `window.__frame` carries the parent's switches.
const IDS = ['bases', 'blocs', 'chat', 'visionneuses', 'coquille'];
const frame = window.__frame;
const query = new URLSearchParams(location.search);
const startRoute = () => { const id = location.hash.slice(1); return IDS.includes(id) ? id : 'bases'; };

const nav = [
  { id: 'bases', label: 'Bases', icon: LayoutDashboardIcon, render: () => <Bases /> },
  { id: 'blocs', label: 'Blocs d\'app', icon: PanelsTopLeftIcon, render: () => <Blocs /> },
  { id: 'chat', label: 'Chat', icon: MessageSquareIcon, render: () => <Chat /> },
  { id: 'visionneuses', label: 'Visionneuses', icon: ImageIcon, render: () => <Visionneuses /> },
  { id: 'coquille', label: 'Coquille', icon: PanelLeftIcon, render: () => <Coquille /> },
];

function Gallery() {
  const [dark, setDark] = useState(frame?.dark ?? query.get('theme') === 'dark');
  const [compact, setCompact] = useState(frame?.compact ?? false);
  const [route, setRoute] = useState(startRoute);
  // The theme and the density are the page's own classes and attribute, as an app sets them.
  useLayoutEffect(() => { document.documentElement.classList.toggle('dark', dark); }, [dark]);
  useLayoutEffect(() => { if (compact) document.documentElement.dataset.density = 'compact'; else delete document.documentElement.dataset.density; }, [compact]);
  const choose = id => { setRoute(id); if (!frame) history.replaceState(null, '', `#${id}`); };
  const actions = useMemo(() => [
    { id: 'theme', label: dark ? 'Thème clair' : 'Thème sombre', icon: dark ? SunIcon : MoonIcon, onSelect: () => setDark(value => !value) },
    { id: 'density', label: compact ? 'Densité normale' : 'Densité compacte', icon: Rows3Icon, onSelect: () => setCompact(value => !value) },
    { id: 'phone', label: 'Téléphone', icon: DeviceMobileIcon, onSelect: () => choose('coquille') },
  ], [dark, compact]);
  const value = useMemo(() => ({ dark, compact, actions }), [dark, compact, actions]);
  const agent = useMemo(() => ({ controller: createDemoChat({ id: 'gallery-agent', scripted: false }), icon: MessageSquareIcon, label: 'Assistant', chatProps }), []);
  return <GalleryContext.Provider value={value}>
    <AppShell layout="screen" rail="hover" composer="content" locale="fr" title="Galerie du kit" nav={nav} agent={agent} agentLink={false} route={{ id: route, onChange: choose }} />
  </GalleryContext.Provider>;
}

createRoot(document.getElementById('root')).render(<Gallery />);
