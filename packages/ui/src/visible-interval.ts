import { useEffect, useRef } from 'react';

export interface VisibleIntervalOptions {
  /** Stop after this long with no pointer, key, touch or visibility activity (default 10 minutes). Any later activity starts it again. */
  readonly idleMs?: number;
  /** False pauses it altogether (default true). */
  readonly enabled?: boolean;
  /** Call `callback` at once when the page becomes visible again or the person comes back from idle (default true). */
  readonly onResume?: boolean;
}

const ACTIVITY = ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'wheel'] as const;
export const DEFAULT_IDLE_MS = 600_000;

/**
 * A screen's refresh timer that costs nothing while nobody looks: it runs `callback` every `ms` only while the page is visible, pauses when
 * the tab is hidden, resumes (with one call) when it shows again, stops after `idleMs` without pointer, key or touch activity (a forgotten tab
 * on a screen must not poll all night: 24 Nov, 4,100 requests an hour from one tab for 36 hours) and starts again on the next activity.
 * The timer is cleared on unmount. `callback` may change at every render; the interval does not restart for it.
 */
export function useVisibleInterval(callback: () => void, ms: number, options: VisibleIntervalOptions = {}): void {
  const { idleMs = DEFAULT_IDLE_MS, enabled = true, onResume = true } = options;
  const latest = useRef(callback);
  useEffect(() => { latest.current = callback; });
  useEffect(() => {
    const page = globalThis.document;
    if (!enabled || !page) return undefined;
    let timer: ReturnType<typeof setInterval> | undefined, lastActive = Date.now();
    const visible = () => page.visibilityState !== 'hidden';
    const stop = () => { if (timer !== undefined) { clearInterval(timer); timer = undefined; } };
    const tick = () => {
      if (!visible()) { stop(); return; }
      if (Date.now() - lastActive >= idleMs) { stop(); return; }
      latest.current();
    };
    const start = (fire: boolean) => {
      if (timer !== undefined || !visible()) return;
      timer = setInterval(tick, ms);
      if (fire && onResume) latest.current();
    };
    const active = () => {
      lastActive = Date.now();
      start(true);
    };
    const changed = () => {
      if (visible()) active();
      else stop();
    };
    start(false);
    page.addEventListener('visibilitychange', changed);
    for (const name of ACTIVITY) page.addEventListener(name, active, { passive: true });
    return () => {
      stop();
      page.removeEventListener('visibilitychange', changed);
      for (const name of ACTIVITY) page.removeEventListener(name, active);
    };
  }, [ms, idleMs, enabled, onResume]);
}
