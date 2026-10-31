'use client';

// PlacedAgentWorkspace: the demo's arrangement over ONE controller. The agent is a page (`AgentWorkspace`, the app's « Agent » tab) or
// collapsed beside the app: on a wide screen a floating `AmbientChat`, on a phone inside an app shell the shell's own bottom drawer (the
// controller is lent to the shell's agent layer, `useAgentLoan`). Pi owns the conversation (the controller holds the draft and the rows);
// this is host layout only, so no second chat state exists. The page stays mounted (hidden) while collapsed, so its open file survives.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2Icon, PictureInPicture2Icon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AgentWorkspace } from '../pi-app/agent-workspace';
import type { AgentWorkspaceProps, OpenedView } from '../pi-app/agent-workspace';
import { AmbientChat, usePhone } from '../pi-ambient/ambient';
import { useAgentLoan } from '../app-shell/agent-layer';
import type { AgentSpec } from '../app-shell/agent-layer';
import { cn } from '../utils/utils';

export type AgentPlacement = 'tab' | 'ambient' | 'tab+ambient';

export type PlacedAgentWorkspaceProps = AgentWorkspaceProps & {
  /** `tab` is a plain `AgentWorkspace`; `ambient` and `tab+ambient` (default) add the collapse and expand actions. */
  readonly placement?: AgentPlacement;
  /** Controlled: the agent is collapsed. Otherwise it is remembered under `${storageKey}.placement` (see `usePlacedAgentState`). */
  readonly collapsed?: boolean;
  /** Called when the person collapses or expands; the app usually moves to another screen or back to the Agent tab here. */
  readonly onCollapsedChange?: (collapsed: boolean) => void;
};

export interface PlacedAgent {
  readonly mode: 'tab' | 'ambient';
  /** Whether collapsing is possible here (not on a phone outside an app shell, nor with `placement="tab"`). */
  readonly collapsible: boolean;
  readonly collapse: () => void;
  readonly expand: () => void;
}
const PlacedContext = createContext<PlacedAgent | null>(null);

/** The collapse and expand actions and the mode, for the page's `controls` and any button rendered inside the workspace. */
export function usePlacedAgent(): PlacedAgent {
  const placed = useContext(PlacedContext);
  if (!placed) throw new Error('usePlacedAgent needs a PlacedAgentWorkspace');
  return placed;
}

const words = {
  en: { collapse: 'Collapse the agent', expand: 'Open the agent as a page' },
  fr: { collapse: 'Réduire l’agent', expand: 'Ouvrir l’agent en page' },
} as const;

const read = (key: string): boolean => { try { return globalThis.localStorage?.getItem(key) === 'ambient'; } catch { return false; } };
/** The remembered « collapsed » flag, for an app that needs to set it from its own navigation (pass both to `PlacedAgentWorkspace`). */
export function usePlacedAgentState(storageKey: string): readonly [boolean, (collapsed: boolean) => void] {
  const key = `${storageKey}.placement`;
  const [collapsed, set] = useState(() => read(key));
  const change = useCallback((next: boolean) => { set(next); try { globalThis.localStorage?.setItem(key, next ? 'ambient' : 'tab'); } catch { /* a convenience */ } }, [key]);
  return [collapsed, change];
}

export function PlacedAgentWorkspace(props: PlacedAgentWorkspaceProps) {
  const { placement = 'tab+ambient', collapsed: controlled, onCollapsedChange, storageKey = 'boring.agent-workspace', controller, chat, locale, controls, opened: openedProp, defaultOpened = null, onOpenedChange, ...rest } = props;
  const [remembered, remember] = usePlacedAgentState(storageKey);
  const asked = placement !== 'tab' && (controlled ?? remembered);
  // Where the collapsed agent can go: the shell's drawer on a phone, a floating chat otherwise; a phone without a shell stays a page.
  const phone = usePhone();
  const loan = useAgentLoan();
  const drawer = phone && Boolean(loan?.compact && loan.available);
  const collapsible = placement !== 'tab' && (!phone || drawer);
  const mode: 'tab' | 'ambient' = collapsible && asked ? 'ambient' : 'tab';

  const [ownOpened, setOwnOpened] = useState<OpenedView | null>(defaultOpened);
  const opened = openedProp !== undefined ? openedProp : ownOpened;
  const setOpened = useCallback((next: OpenedView | null) => { setOwnOpened(next); onOpenedChange?.(next); }, [onOpenedChange]);

  const collapse = useCallback(() => { if (controlled === undefined) remember(true); onCollapsedChange?.(true); }, [controlled, remember, onCollapsedChange]);
  const expand = useCallback(() => { if (controlled === undefined) remember(false); onCollapsedChange?.(false); }, [controlled, remember, onCollapsedChange]);
  const api = useMemo<PlacedAgent>(() => ({ mode, collapsible, collapse, expand }), [mode, collapsible, collapse, expand]);

  const text = words[(locale ?? chat?.locale) === 'fr' ? 'fr' : 'en'];
  // A file the floating chat or the drawer's chat names opens in the page, which comes back.
  const openFile = useCallback((path: string) => { setOpened({ kind: 'file', path }); expand(); }, [setOpened, expand]);
  const chatProps = useMemo(() => ({ ...chat, onOpenFile: openFile }), [chat, openFile]);

  // The phone hand-off: the same controller becomes the shell's agent while collapsed. Lending is one effect (so a new spec never closes the
  // drawer) and taking it back another (so only leaving the collapsed mode does).
  const spec = useMemo<AgentSpec | undefined>(() => controller ? { controller: controller as AgentSpec['controller'], chatProps: { ...chatProps, ...(locale ? { locale } : {}) },
    headerActions: [{ id: 'expand', label: text.expand, icon: Maximize2Icon, onSelect: expand }] } : undefined, [controller, chatProps, locale, text.expand, expand]);
  const lent = mode === 'ambient' && drawer && Boolean(spec);
  const lend = loan?.lend;
  // Collapsing while mounted (the button, or the app's own navigation) opens it at peek; a placement restored on load is only lent.
  const wasLent = useRef(false), mounted = useRef(false);
  useEffect(() => { if (lent && lend) lend(spec, mounted.current && !wasLent.current ? 'peek' : undefined); wasLent.current = lent; }, [lent, lend, spec]);
  useEffect(() => { mounted.current = true; }, []);
  useEffect(() => { if (!lent || !lend) return; return () => lend(undefined); }, [lent, lend]);

  const collapseButton = collapsible && <Button variant="ghost" size="icon-sm" data-testid="placed-collapse" aria-label={text.collapse} title={text.collapse} onClick={collapse}><PictureInPicture2Icon data-icon="inline-start" aria-hidden="true" /></Button>;
  const barControls = (state: { readonly panelOpen: boolean }): ReactNode => <>{typeof controls === 'function' ? controls(state) : controls}{collapseButton}</>;

  const floating = mode === 'ambient' && !drawer && controller;
  return <PlacedContext.Provider value={api}>
    <div data-testid="placed-agent" data-mode={mode} hidden={mode === 'ambient'} inert={mode === 'ambient'} className={cn('h-full min-h-0 min-w-0 flex-1', mode === 'ambient' ? 'hidden' : 'flex')}>
      <AgentWorkspace {...rest} controller={controller} {...(chat ? { chat } : {})} {...(locale ? { locale } : {})} storageKey={storageKey} opened={opened} onOpenedChange={setOpened} controls={barControls} />
    </div>
    {floating && createPortal(<AmbientChat key={rest.conversationId} {...chatProps} controller={controller as AgentSpec['controller']} variant="surface" defaultState="expanded" storageKey={`${storageKey}.ambient`} storage="local" onDock={expand} />, document.body)}
  </PlacedContext.Provider>;
}
