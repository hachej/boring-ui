// The shell's second agent place: a panel beside the page, opened from the account menu (« Améliorer l'app »). The shell knows only this
// shape; a host brings what fills it. Both components must keep their identity between renders (module constants): a new identity remounts the app.
import type { ComponentType, ReactNode } from 'react';
import type { AppShellLocale } from './text';

export interface AgentSlotProviderProps {
  readonly open: boolean;
  readonly close: () => void;
  readonly appName?: string | undefined;
  readonly locale?: AppShellLocale | undefined;
  /** The panel has taken the whole phone screen (true) or given it back; `collapse` steps down, for the Back button. */
  readonly onFull: (full: boolean, collapse: () => void) => void;
  readonly children: ReactNode;
}

export interface AgentSlotLayoutProps {
  readonly children: ReactNode;
  /** The phone's tab bar, below the page. */
  readonly navigation?: ReactNode;
  /** The label of the screen on show. */
  readonly screen?: string;
}

export interface AgentSlot {
  /** Around the whole shell. */
  readonly Provider: ComponentType<AgentSlotProviderProps>;
  /** Around the page: places the panel beside it. */
  readonly Layout: ComponentType<AgentSlotLayoutProps>;
  /** When the slot's agent is known up front: its conversation (an agent link reuses it) and language. */
  readonly spec?: { readonly controller?: unknown; readonly chatProps?: { readonly locale?: AppShellLocale | undefined } | undefined } | undefined;
}
