// The shell's panel place, filled with the least that proves its contract: a panel beside the page that the account menu opens and closes.
// The real one (the PM) lives in boring-factory's platform-ui, and its journeys there.
import { createContext, useContext } from 'react';
import { Button } from '@/components/ui/button';
import type { ShellPanel, ShellPanelLayoutProps, ShellPanelProviderProps } from '../../registry/app-shell/shell-panel';

const Panel = createContext<{ readonly open: boolean; readonly close: () => void } | null>(null);

function Provider({ open, close, children }: ShellPanelProviderProps) {
  return <Panel.Provider value={{ open, close }}>{children}</Panel.Provider>;
}

function Layout({ children, navigation, screen }: ShellPanelLayoutProps) {
  const panel = useContext(Panel);
  return <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:flex-row">
    <div data-screen={screen} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
    <section hidden={!panel?.open} data-testid="pm-panel" data-mode="chat" className={panel?.open ? 'absolute inset-0 z-40 flex flex-col bg-background md:static md:w-[26rem] md:shrink-0' : undefined}>
      <Button variant="ghost" data-testid="pm-close" onClick={panel?.close}>Fermer</Button>
    </section>
    <div hidden={panel?.open} className="shrink-0 md:hidden">{navigation}</div>
  </div>;
}

export const stubPanel: ShellPanel = { config: null, Provider, Layout };
