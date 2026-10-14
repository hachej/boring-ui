'use client';

// A full-screen app view (a document sheet, a pushed view of the app) that takes part in the shell's one-layer-at-a-time rule: opening it
// closes the agent and product manager layers, and opening either of those closes it. Its Back is the shared Back manager's `sheet` layer
// (`useBackLayer`), so the browser's Back closes it first. Host concern: Pi has no layers; this is the shell's own presentation rule.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useBackLayer } from './back';

/** The shell's agent and product manager layers share one close; the agent layer registers it while mounted. */
const agentClosers = new Set<() => void>();
/** The one view on show, by id. Opening a view replaces the view on show. */
let shown: string | undefined;
const listeners = new Set<() => void>();
const emit = (): void => { for (const listener of [...listeners]) listener(); };
const subscribe = (listener: () => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** Registers how the agent layer closes (called by `AgentLayerProvider`). Returns the unregister function. */
export function registerAgentLayerCloser(close: () => void): () => void {
  agentClosers.add(close);
  return () => { agentClosers.delete(close); };
}

/** Closes the agent and product manager layers. The agent layer calls it before it opens; a view calls it before it opens. */
export function closeAgentLayers(): void {
  for (const close of [...agentClosers]) close();
}

/** Closes the view on show, if any (the agent layer calls it before it opens, so one layer is open at a time). */
export function closeShellLayer(): void {
  if (shown === undefined) return;
  shown = undefined;
  emit();
}

export interface ShellLayer {
  readonly open: () => void;
  readonly close: () => void;
  readonly isOpen: boolean;
}

export interface ShellLayerOptions {
  /** Asked when the browser's Back would close the view: `false` keeps it open (the history entry is pushed again). */
  readonly confirmBack?: () => boolean;
}

/** The one owner of each view id: its component registers Back and the history entry. Other callers only observe. */
const owners = new Map<string, symbol>();

/**
 * The handle of one full-screen view, `id` being its name in the shell. `open` closes the agent and product manager layers and any other
 * view; `close` closes this one (a no-op when it is not on show). The first component that calls `useShellLayer(id)` owns the view: only
 * it registers the Back layer and the history entry, and only it closes the view when it unmounts. Any other caller (a host's trigger)
 * observes `isOpen` and can open or close, and its own unmount releases nothing but its subscription.
 */
export function useShellLayer(id: string, options?: ShellLayerOptions): ShellLayer {
  // The owner is the first component of this id to render (parents render before their children). Claimed while rendering, so a parent
  // that mounts with an observer child is the owner; the claim is released by the owner's own cleanup.
  const [me] = useState(() => {
    const token = Symbol(id);
    const claimed = !owners.has(id);
    if (claimed) owners.set(id, token);
    return { token, owner: claimed };
  });
  const owner = me.owner;
  const isOpen = useSyncExternalStore(subscribe, () => shown === id, () => false);
  const open = useCallback(() => {
    closeAgentLayers();
    if (shown === id) return;
    shown = id;
    emit();
  }, [id]);
  const close = useCallback(() => {
    if (shown !== id) return;
    shown = undefined;
    emit();
  }, [id]);
  useEffect(() => {
    if (!owner) return undefined;
    if (!owners.has(id)) owners.set(id, me.token);
    return () => {
      if (owners.get(id) !== me.token) return;
      // The owner's component is gone: its view goes with it (its history entry is released by the Back layer's cleanup).
      owners.delete(id);
      close();
    };
  }, [id, owner, me, close]);
  const confirmBack = useRef(options?.confirmBack);
  confirmBack.current = options?.confirmBack;
  const back = useCallback(() => {
    // A refused Back keeps the view and its entry: the entry the browser just popped is pushed again.
    if (confirmBack.current && !confirmBack.current()) { history.pushState({ appShell: 'sheet' }, ''); return; }
    close();
  }, [close]);
  // The view is one history entry while it is open, owned by one component only (the Back manager's rules).
  useBackLayer(owner && isOpen, back, 'sheet');
  return { open, close, isOpen };
}
