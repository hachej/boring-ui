'use client';

// One header per screen. A screen calls `useScreenHeader` and the shell renders it; the most recently mounted caller wins as a whole
// (a `ListDetail` inside a screen overlays « ← » and a title and keeps the screen's actions) and unmounting restores the previous one. A
// screen the shell has hidden does not count (ScreenActiveContext). Host concern: Pi has no layout.
import { createContext, createElement, useContext, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { ArrowLeftIcon } from 'lucide-react';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ScreenActiveContext } from './agent-context';
import { HeaderActions } from './header-actions';
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
  /** Controls rendered right after the sidebar trigger (or « ← »), before the title: a screen that owns its row, left-aligned. */
  readonly leading?: ReactNode;
  /** The title's face: `display` (default, the theme's display font) or `sans`. */
  readonly titleFace?: 'display' | 'sans';
  /** A dense 48 px row instead of 56 px. */
  readonly dense?: boolean;
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
  const key = JSON.stringify([spec.title, spec.subtitle, Boolean(spec.back), spec.titleFace, spec.dense, spec.actions?.map(action => [action.id, action.label, action.showLabel, action.href, action.target, action.rel, iconId(action.icon)])]);
  useLayoutEffect(() => {
    if (!store || !active) return;
    const mine = entry.current;
    store.entries.push(mine);
    touch(store);
    return () => { const at = store.entries.indexOf(mine); if (at >= 0) store.entries.splice(at, 1); touch(store); };
  }, [store, active]);
  // `leading` is a node with no stable key, so it is a new value on each render of the screen and touches the store each time; that only re-renders the header, which is cheap and intended.
  useLayoutEffect(() => { if (store && active) touch(store); }, [store, active, key, spec.leading]);
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
 * then the slot of the screen's own controls (`slotRef`), up to two actions, « … » and the agent trigger. `avatar` is the compact account button.
 */
export function ScreenHeader({ fallbackTitle, compact, avatar, text, slotRef }: { readonly fallbackTitle: string; readonly compact: boolean; readonly avatar: ReactNode; readonly text: AppShellText; readonly slotRef?: (element: HTMLElement | null) => void }) {
  const top = useTopHeader();
  const spec = top?.spec;
  const actions = spec?.actions ?? [];
  const run = (id: string) => top?.spec.actions?.find(action => action.id === id)?.onSelect();
  const back = spec?.back ? <Button variant="ghost" size="icon" data-testid="header-back" aria-label={text.goBack} title={text.goBack} onClick={() => top?.spec.back?.()}><ArrowLeftIcon data-icon="inline-start" aria-hidden="true" /></Button> : null;
  return <header data-testid="screen-header" className={`sticky top-0 z-10 flex ${spec?.dense ? 'min-h-12' : 'min-h-14'} shrink-0 items-center gap-1 bg-background px-2 pt-[env(safe-area-inset-top)]`}>
    <Separator className="absolute inset-x-0 bottom-0" />
    {compact ? (back ?? avatar) : <><SidebarTrigger />{back}</>}
    {spec?.leading != null && <div data-testid="header-leading" className="flex shrink-0 items-center gap-1">{spec.leading}</div>}
    <div className="min-w-0 flex-1 px-1">
      <h1 data-testid="header-title" className={`m-0 truncate text-base leading-tight font-semibold ${spec?.titleFace === 'sans' ? 'font-sans' : '[font-family:var(--font-display,var(--font-sans))]'}`}>{spec?.title ?? fallbackTitle}</h1>
      {spec?.subtitle && <p data-testid="header-subtitle" className="m-0 truncate text-xs text-muted-foreground">{spec.subtitle}</p>}
    </div>
    {/* An embedded page's own controls (`ScreenHeaderSlotContext`, for example AgentWorkspace layout="embedded"), so it needs no second row. */}
    <div ref={slotRef} data-testid="header-slot" className="flex shrink-0 items-center gap-1 empty:hidden" />
    <HeaderActions actions={actions} compact={compact} text={text} prefix="header" run={run} />
    {compact && back && avatar}
    <AgentTrigger />
  </header>;
}
