'use client';

// Where the conversation is, as one `Level` for every launcher (`folded`, `open`, `grown`, `full`, `docked`), and the way to take it to another. The layer keeps its own state (the snap, the tray's size,
// the dock mode); this reads it as a level and maps a level back onto it (the equivalence table: open = tray = half = panel; a level the launcher lacks goes to the nearest it has). `level`,
// `defaultLevel`, `on.level` and `feedback.while` of the config work on every launcher through it; the circle's own controlled state (its snap) stays in `AgentLayerProvider`.
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useCommenting } from '../feedback/point-mode';
import type { ComposerConfig, Level } from './composer-config';
import { levelsOf } from './composer-config';
import type { AgentMode, AgentSpec, ComposerPlace, ConversationSize, ResolvedComposer, Snap, Which } from './layer-context';

export interface LevelState {
  readonly flags: ResolvedComposer;
  readonly standalone: boolean;
  readonly preset: ComposerConfig;
  readonly hasAgent: boolean;
  readonly expanded: boolean;
  readonly snap: Snap;
  readonly shown: Which;
  readonly trayOpen: boolean;
  readonly dockOpen: boolean;
  readonly dockFloating: boolean;
  readonly size: ConversationSize;
  readonly place: ComposerPlace;
}
export interface LevelActions {
  readonly open: (which?: Which, at?: 'peek' | 'half' | 'full' | 'dock') => void;
  readonly close: () => void;
  readonly setSize: (size: ConversationSize) => void;
  readonly setMode: (mode: AgentMode) => void;
  readonly enterFull: (from?: 'folded' | 'dock') => void;
}

/** The level the layer is at. */
export function levelOf(s: LevelState): Level {
  if (!s.hasAgent) return 'folded';
  const opened = s.snap !== 'closed' && s.snap !== 'peek' && s.shown === 'agent';
  if (s.flags.bar) {
    if (s.place === 'icon') return 'folded';
    if (!s.expanded) return s.snap === 'full' && s.shown === 'agent' ? 'full' : opened ? 'open' : 'folded';
    return s.trayOpen ? s.size : s.dockOpen ? 'docked' : 'folded';
  }
  if (!opened) return 'folded';
  if (s.flags.launcher === 'header' && s.expanded) return s.dockFloating ? 'open' : 'docked';
  return 'open';
}

const ORDER: readonly Level[] = ['folded', 'open', 'grown', 'full', 'docked'];
/** A level the launcher lacks goes to the nearest it has: grown to open, full to grown (or open), docked to open. */
export function clampLevel(level: Level, allowed: readonly Level[]): Level {
  if (allowed.includes(level)) return level;
  const fallbacks: Readonly<Record<Level, readonly Level[]>> = { folded: ['folded'], open: ['open', 'folded'], grown: ['open'], full: ['grown', 'open'], docked: ['full', 'open'] };
  return fallbacks[level].find(one => allowed.includes(one)) ?? ORDER.find(one => allowed.includes(one)) ?? 'folded';
}

/** What a level does to the layer. */
function apply(level: Level, s: LevelState, a: LevelActions): void {
  if (!s.hasAgent) return;
  if (level === 'folded') { a.close(); return; }
  if (!s.flags.bar) { a.open('agent', level === 'docked' && s.flags.launcher === 'header' ? 'dock' : 'half'); return; }
  if (!s.expanded) { a.open('agent', level === 'full' ? 'full' : 'half'); return; }
  if (level === 'docked') { a.open('agent', 'dock'); return; }
  if (s.dockOpen) a.setMode('tray');
  if (level === 'full' && !s.trayOpen) { a.enterFull('folded'); return; }
  a.open('agent');
  a.setSize(level);
}

/** The level, the way to set it, and the config's `level`, `defaultLevel` and `on.level` on every launcher but the circle (whose snap is the layer's own controlled state). */
export function useConfigLevel(state: LevelState, actions: LevelActions, config: ComposerConfig | undefined, standalone: boolean): { readonly level: Level; readonly setLevel: (level: Level) => void } {
  const level = levelOf(state);
  const now = useRef({ state, actions, standalone });
  useLayoutEffect(() => { now.current = { state, actions, standalone }; });
  const allowed = levelsOf(state.preset, standalone);
  const setLevel = useCallback((next: Level) => {
    const { state: s, actions: a, standalone: alone } = now.current;
    apply(clampLevel(next, levelsOf(s.preset, alone)), s, a);
  }, []);
  const circle = state.flags.circle;
  const known = useRef<{ level: Level; given: Level | undefined; started: boolean; timer: ReturnType<typeof setTimeout> | undefined }>({ level, given: config?.level, started: false, timer: undefined });
  const given = config?.level, start = config?.defaultLevel, report = config?.on?.level;
  const latest = useRef({ given, level, allowed });
  useLayoutEffect(() => { latest.current = { given, level, allowed }; });
  useEffect(() => () => clearTimeout(known.current.timer), []);
  useEffect(() => {
    if (!config || circle || !state.hasAgent) return;
    const was = known.current;
    // The first look: the app's level, or its default, is where the conversation starts.
    if (!was.started) {
      was.started = true; was.given = given; was.level = level;
      const first = given ?? start;
      if (first !== undefined && clampLevel(first, allowed) !== level) { was.level = clampLevel(first, allowed); setLevel(first); }
      return;
    }
    // The app set a new level: the layer goes there.
    if (given !== undefined && given !== was.given) { was.given = given; was.level = clampLevel(given, allowed); if (was.level !== level) setLevel(given); return; }
    // The person moved it: the app is told; a controlled level the app does not take comes back (checked once the app has drawn again).
    if (level !== was.level) {
      was.level = level;
      report?.(level);
      if (given !== undefined) {
        clearTimeout(was.timer);
        was.timer = setTimeout(() => {
          const now = latest.current;
          if (now.given !== undefined && clampLevel(now.given, now.allowed) !== now.level) { known.current.level = clampLevel(now.given, now.allowed); setLevel(now.given); }
        }, 0);
      }
    }
  });
  return { level, setLevel };
}

/** `feedback.while`: the level taken while annotating, and back to the one before when it ends. Only when the config names one (a circle's panel steps aside by default: `useCircleCollapsed`). */
export function useFeedbackWhile(config: ComposerConfig | undefined, feedback: AgentSpec['feedback'], level: Level, setLevel: (level: Level) => void): void {
  const annotating = useCommenting(feedback);
  const taken = config?.feedback?.while;
  const before = useRef<Level | undefined>(undefined);
  const latest = useRef({ level, setLevel });
  useLayoutEffect(() => { latest.current = { level, setLevel }; });
  useEffect(() => {
    if (taken === undefined || config?.launcher === 'circle') return;
    if (annotating && before.current === undefined) { before.current = latest.current.level; latest.current.setLevel(taken); }
    else if (!annotating && before.current !== undefined) { const back = before.current; before.current = undefined; latest.current.setLevel(back); }
  }, [annotating, taken, config?.launcher]);
}
