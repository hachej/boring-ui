'use client';

// One header per screen. A screen calls `useScreenHeader` and the shell renders it; the most recently mounted caller wins as a whole
// (a `ListDetail` inside a screen overlays « ← » and a title and keeps the screen's actions) and unmounting restores the previous one. A
// screen the shell has hidden does not count (ScreenActiveContext). Host concern: Pi has no layout.
import { createContext, createElement, useContext, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { ArrowLeftIcon } from 'lucide-react';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { ScreenActiveContext } from './agent-context';
import { HeaderActions, ICON_BUTTON } from './header-actions';
import type { ScreenHeaderAction } from './header-actions';
import { AgentTrigger } from './agent-layer';
import type { AppShellText } from './text';

interface Icon { className?: string }
export interface ScreenHeaderSpec {
  /** Default: the active nav label. */
  readonly title?: string;
  readonly subtitle?: string;
  /** Shows « ← ». */
  readonly back?: () => void;
  /** At most two are shown; the others go in « … ». */
  readonly actions?: readonly ScreenHeaderAction[];
}

export type { ScreenHeaderAction } from './header-actions';

interface Entry { spec: ScreenHeaderSpec; readonly overlay: boolean }
interface Store {
  readonly entries: Entry[];
  version: number;
  readonly listeners: Set<() => void>;
}

const HeaderContext = createContext<Store | null>(null);

/** A number per icon component, so a change of icon is a change of header. */
const icons = new WeakMap<object, number>();
let iconCount = 0;
const iconId = (icon: ComponentType<Icon>): number => { let id = icons.get(icon); if (id === undefined) { iconCount += 1; id = iconCount; icons.set(icon, id); } return id; };

const touch = (store: Store) => { store.version += 1; for (const listener of [...store.listeners]) listener(); };

/** Holds the screens' headers. `AppShell` mounts one. */
export function HeaderProvider({ children }: { readonly children: ReactNode }) {
  const store = useRef<Store>({ entries: [], version: 0, listeners: new Set() });
  return createElement(HeaderContext.Provider, { value: store.current }, children);
}

/**
 * Registers the calling screen's header while it is mounted and on show. The latest spec is always read at click time. An `overlay`
 * (the shell's own `ListDetail`) is merged over the screen's header whatever the effect order: it adds « ← » and a title, and keeps the actions.
 */
export function useScreenHeader(spec: ScreenHeaderSpec, options?: { readonly overlay?: boolean }): void {
  const store = useContext(HeaderContext);
  const active = useContext(ScreenActiveContext);
  const entry = useRef<Entry>({ spec, overlay: options?.overlay === true });
  entry.current.spec = spec;
  const key = JSON.stringify([spec.title, spec.subtitle, Boolean(spec.back), spec.actions?.map(action => [action.id, action.label, action.showLabel, action.href, action.target, action.rel, iconId(action.icon)])]);
  useLayoutEffect(() => {
    if (!store || !active) return;
    const mine = entry.current;
    store.entries.push(mine);
    touch(store);
    return () => { const at = store.entries.indexOf(mine); if (at >= 0) store.entries.splice(at, 1); touch(store); };
  }, [store, active]);
  useLayoutEffect(() => { if (store && active) touch(store); }, [store, active, key]);
}

/** The header of the screen on show (the most recently mounted caller), or undefined. Re-renders when screens come and go or change their header. */
export function useTopHeader(): { readonly spec: ScreenHeaderSpec } | undefined {
  const store = useContext(HeaderContext);
  useSyncExternalStore(
    listener => { store?.listeners.add(listener); return () => { store?.listeners.delete(listener); }; },
    () => store?.version ?? 0,
    () => 0,
  );
  // A getter, so a click reads the live specs (a callback that changed without a visible change is still the current one).
  return store?.entries.length ? { get spec() { return mergedSpec(store.entries); } } : undefined;
}

/** The latest ordinary entry is the whole header; explicit overlays (the shell's `ListDetail`) are merged over it field by field. */
function mergedSpec(entries: readonly Entry[]): ScreenHeaderSpec {
  const base = entries.filter(entry => !entry.overlay).at(-1);
  const spec: Record<string, unknown> = { ...base?.spec };
  for (const entry of entries) if (entry.overlay) for (const [field, value] of Object.entries(entry.spec)) if (value !== undefined) spec[field] = value;
  return spec as ScreenHeaderSpec;
}


/**
 * The header of the screen on show: the avatar button (compact) or the sidebar trigger (expanded) or « ← », then the title and subtitle,
 * then up to two actions, « … » and the agent trigger. `avatar` is the compact account button.
 */
export function ScreenHeader({ fallbackTitle, compact, avatar, text }: { readonly fallbackTitle: string; readonly compact: boolean; readonly avatar: ReactNode; readonly text: AppShellText }) {
  const top = useTopHeader();
  const spec = top?.spec;
  const actions = spec?.actions ?? [];
  const run = (id: string) => top?.spec.actions?.find(action => action.id === id)?.onSelect();
  const back = spec?.back ? <button type="button" data-testid="header-back" aria-label={text.goBack} onClick={() => top?.spec.back?.()} className={ICON_BUTTON}><ArrowLeftIcon className="size-4" aria-hidden="true" /></button> : null;
  return <header data-testid="screen-header" className="sticky top-0 z-10 flex min-h-14 shrink-0 items-center gap-1 border-b border-border bg-background px-2 pt-[env(safe-area-inset-top)]">
    {compact ? (back ?? avatar) : <><SidebarTrigger className="pointer-coarse:min-h-11 pointer-coarse:min-w-11" />{back}</>}
    <div className="min-w-0 flex-1 px-1">
      <h1 data-testid="header-title" className="m-0 truncate text-base leading-tight font-semibold [font-family:var(--font-display,var(--font-sans))]">{spec?.title ?? fallbackTitle}</h1>
      {spec?.subtitle && <p data-testid="header-subtitle" className="m-0 truncate text-xs text-muted-foreground">{spec.subtitle}</p>}
    </div>
    <HeaderActions actions={actions} compact={compact} text={text} prefix="header" run={run} />
    {compact && back && avatar}
    <AgentTrigger />
  </header>;
}
