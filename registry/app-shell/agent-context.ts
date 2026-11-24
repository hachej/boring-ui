// What the person is looking at, for the agent. A screen calls `useAgentContext({ name, params })`; the transport sends the latest
// value with each submit (`createRemoteChat({ requestContext: readAgentContext })`) and the host renders it in `createPromptContext`.
// Advisory text for the model, never policy. The most recently mounted caller wins; unmounting restores the previous one.
import { createContext, createElement, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

/** A type alias, so the value is assignable to the transport's `Record<string, unknown>`. */
export type AgentScreenContext = { readonly name: string; readonly params: Readonly<Record<string, unknown>> };

/** `composer="explore"`: what the person is looking at, as the app wrote it. */
export type AgentLooking = { readonly title: string; readonly detail?: string | undefined };
interface Entry { value: AgentScreenContext }
interface Store { readonly entries: Entry[]; readonly looking: AgentLooking[] }

const StoreContext = createContext<Store | null>(null);
/**
 * Whether the calling screen is the one on show. The shell keeps every screen mounted and hides the others, so a hidden screen must not
 * register its context (here) or its header (`useScreenHeader`). True outside a shell.
 */
export const ScreenActiveContext = createContext(true);
/** Whether the calling screen is the one on show: `false` on a screen the shell has hidden, `true` on the one on show and outside a shell. */
export function useScreenActive(): boolean { return useContext(ScreenActiveContext); }
/** The mounted provider's store, for `readAgentContext` (the transport option has no React context to read). */
let current: Store | null = null;

/**
 * Holds the screens' contexts. `AgentLayerProvider` mounts one. Inside another provider it shares that one's store, so an app that keeps its own provider around its screens and mounts
 * the standalone `FloatingComposer` beside them still has its screens read by `readAgentContext`.
 */
export function AgentContextProvider({ children }: { readonly children: ReactNode }) {
  const outer = useContext(StoreContext);
  const [own] = useState<Store>(() => ({ entries: [], looking: [] }));
  const store = outer ?? own;
  useLayoutEffect(() => {
    if (outer) return; // the outer provider owns the registry `readAgentContext` reads
    const mine = store;
    current = mine;
    return () => { if (current === mine) current = null; };
  }, [store, outer]);
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

/** What the explore panel shows as « You are looking at », while the calling component is mounted: it joins the screen context as `params.lookingAt`, whichever screen registered last. */
export function useLookingAt(value: AgentLooking | undefined): void {
  const store = useContext(StoreContext);
  const title = value?.title, detail = value?.detail;
  useEffect(() => {
    if (!store || title === undefined) return;
    const mine: AgentLooking = detail === undefined ? { title } : { title, detail };
    store.looking.push(mine);
    return () => { const at = store.looking.indexOf(mine); if (at >= 0) store.looking.splice(at, 1); };
  }, [store, title, detail]);
}

/** The latest screen context, or undefined when no screen registered one. Pass it as `requestContext`. */
export function readAgentContext(): AgentScreenContext | undefined {
  const entries = current?.entries;
  const screen = entries?.length ? entries[entries.length - 1]!.value : undefined;
  const looking = current?.looking.at(-1);
  if (!looking) return screen;
  return { name: screen?.name ?? looking.title, params: { ...screen?.params, lookingAt: looking } };
}
