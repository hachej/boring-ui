'use client';

// The shell's panel place: a second agent or tool beside the app, opened from the account menu. The shell knows only this shape, so an app
// plugs in what it wants (the product manager is `pmPanel` from the Factory's `platform-ui/pm-panel`) and an app without one installs nothing more.
import type { ComponentType, ReactNode } from 'react';

export interface ShellPanelProviderProps {
  /** `ShellPanel.config`, as the panel wrote it. */
  readonly config: unknown;
  readonly open: boolean;
  readonly close: () => void;
  readonly appName?: string | undefined;
  readonly locale?: string | undefined;
  /** The panel took the whole screen, or gave it back; `collapse` is what Back runs. */
  readonly onFull?: ((full: boolean, collapse: () => void) => void) | undefined;
  readonly children: ReactNode;
}

export interface ShellPanelLayoutProps {
  readonly children: ReactNode;
  /** The phone tab bar. The layout hides it while the panel covers the page. */
  readonly navigation?: ReactNode;
  /** The label of the screen on show. */
  readonly screen?: string;
}

export interface ShellPanelPageProps {
  readonly config: unknown;
  readonly appName: string;
  readonly locale?: string | undefined;
}

/** Keep `Provider`, `Layout` and `page.Page` the same across renders: a new component remounts the app. */
export interface ShellPanel {
  /** Passed back to `Provider` and `page.Page`. */
  readonly config: unknown;
  /** Wraps the whole shell, so the panel's state outlives its closing. */
  readonly Provider: ComponentType<ShellPanelProviderProps>;
  /** Wraps the screen and draws the panel beside it. */
  readonly Layout: ComponentType<ShellPanelLayoutProps>;
  /** The account menu's row and the layer's title. Default: the shell's « Améliorer l'app ». */
  readonly label?: string;
  /** The panel's language, for the shell's own words when the app has no agent to say it. */
  readonly locale?: string | undefined;
  /** Changes when the panel's conversation changes; a launch link's focus waits on it. */
  readonly identity?: unknown;
  /** The address that shows only the panel, without the shell. */
  readonly page?: { readonly matches: () => boolean; readonly Page: ComponentType<ShellPanelPageProps> };
}

/** The screen when the app has no panel. */
export function NoPanelLayout({ children, navigation }: ShellPanelLayoutProps) {
  return <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
    <div className="shrink-0 md:hidden">{navigation}</div>
  </div>;
}
