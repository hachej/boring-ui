import { createContext, useContext } from 'react';
import { createRoot } from 'react-dom/client';
import { AppShell } from '../../../registry/app-shell/app-shell.tsx';

// D-1903: a youtubevisual-like phone AppShell (compactNav="sheet", fictional data) with a PM-like panel: a full-screen section with a close button, as the stub in examples/app-shell/stub-slot.tsx.
const Panel = createContext(null);
const Provider = ({ open, close, children }) => <Panel.Provider value={{ open, close }}>{children}</Panel.Provider>;
const Layout = ({ children }) => {
  const panel = useContext(Panel);
  return <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
    <section hidden={!panel?.open} data-testid="pm-panel" className={panel?.open ? 'absolute inset-0 z-40 flex flex-col bg-background' : undefined}>
      <button type="button" data-testid="pm-close" className="m-4 h-11 rounded-md border" onClick={panel?.close}>Close</button>
    </section>
  </div>;
};
const Icon = ({ className }) => <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="currentColor" /></svg>;
const nav = ['Videos', 'Channels'].map(label => ({ id: label, label, icon: Icon, render: () => <p>Fictional channel overview</p> }));

createRoot(document.getElementById('root')).render(
  <AppShell layout="screen" compactNav="sheet" title="Visual" nav={nav} route={{ id: 'Videos', onChange() {} }} panel={{ config: null, Provider, Layout }} account={{ name: 'Camille Martin', menu: [], signOut() {} }} />);
