// What the person is looking at, for the agent. A screen calls `useAgentContext({ name, params })`; the transport sends the latest
// value with each submit (`createRemoteChat({ requestContext: readAgentContext })`) and the host renders it in `createPromptContext`.
// Advisory text for the model, never policy. The most recently mounted caller wins; unmounting restores the previous one.
import { createContext, createElement, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

/** A type alias, so the value is assignable to the transport's `Record<string, unknown>`. */
export type AgentScreenContext = { readonly name: string; readonly params: Readonly<Record<string, unknown>> };

interface Entry { value: AgentScreenContext }
interface Store { readonly entries: Entry[] }

const StoreContext = createContext<Store | null>(null);
/**
 * Whether the calling screen is the one on show. The shell keeps every screen mounted and hides the others, so a hidden screen must not
 * register its context (here) or its header (`useScreenHeader`). True outside a shell.
 */
export const ScreenActiveContext = createContext(true);
/** The mounted provider's store, for `readAgentContext` (the transport option has no React context to read). */
let current: Store | null = null;

/** Holds the screens' contexts. `AgentLayerProvider` mounts one. */
export function AgentContextProvider({ children }: { readonly children: ReactNode }) {
  const [store] = useState<Store>(() => ({ entries: [] }));
  useLayoutEffect(() => {
    const mine = store;
    current = mine;
    return () => { if (current === mine) current = null; };
  }, [store]);
  return createElement(StoreContext.Provider, { value: store }, children);
}

/** Registers the current screen while the calling component is mounted; a new `name` or `params` (compared as JSON) replaces it. */
export function useAgentContext(value: AgentScreenContext): void {
  const store = useContext(StoreContext);
  const active = useContext(ScreenActiveContext);
  const key = JSON.stringify([value.name, value.params]);
  const latest = useRef(value);
  useLayoutEffect(() => { latest.current = value; });
  const entry = useRef<Entry>({ value });
  // Mounting takes the top place; a later change of `name` or `params` updates the entry where it stands.
  useEffect(() => {
    if (!store || !active) return;
    const mine = entry.current;
    store.entries.push(mine);
    return () => { const at = store.entries.indexOf(mine); if (at >= 0) store.entries.splice(at, 1); };
  }, [store, active]);
  useEffect(() => { entry.current.value = latest.current; }, [key]);
}

/** The latest screen context, or undefined when no screen registered one. Pass it as `requestContext`. */
export function readAgentContext(): AgentScreenContext | undefined {
  const entries = current?.entries;
  return entries?.length ? entries[entries.length - 1]!.value : undefined;
}
