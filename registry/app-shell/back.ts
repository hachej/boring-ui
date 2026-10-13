// The one Back manager of the app shell. A layer that is open (the agent sheet, another sheet, point mode, a pushed screen) asks for one
// history entry with the same URL; the browser's Back closes the topmost layer instead of leaving the page, and closing a layer any
// other way removes its entry, so the history stays as it was. Hosts: the AgentLayer (order `agent`) and, later, sheets and stacks.
import { useEffect, useRef } from 'react';

/** The fixed priority of Back: `point` is handled first, then an open `sheet`, then the `agent` layer, then the `stack`, then the browser. */
export type BackOrder = 'point' | 'sheet' | 'agent' | 'stack';
const RANK: Readonly<Record<BackOrder, number>> = { point: 0, sheet: 1, agent: 2, stack: 3 };

interface Layer { readonly order: BackOrder; readonly close: () => void; popped: boolean }

const layers = new Set<Layer>();
/** `popstate` events caused by our own `history.back()`, which must not close anything. */
let ignored = 0;
let listening = false;
/** The layer kind the page was loaded on top of (history state survives a reload), until a layer adopts it. */
let persisted: unknown = typeof history === 'undefined' ? undefined : (history.state as { appShell?: unknown } | null)?.appShell;
/** Layers that opened while our own `history.back()` was still pending: they push their entry once it has landed (a push in between cancels it). */
const waiting: (() => void)[] = [];

/**
 * Runs `action` once the history entry of a sheet that is closing has really gone. A choice that navigates (the app's router replaces the
 * URL) must not run before: the sheet's own `history.back()` would undo it. Call it in the same handler that closes the sheet.
 */
export function afterBack(action: () => void): void {
  // The sheet's effect cleanup (which starts its `history.back()`) runs after this handler returns.
  setTimeout(() => { if (ignored > 0) waiting.push(action); else action(); }, 0);
}

const topmost = (): Layer | undefined => [...layers].sort((a, b) => RANK[a.order] - RANK[b.order])[0];

function onPopState(): void {
  if (ignored > 0) {
    ignored -= 1;
    if (ignored === 0) for (const start of waiting.splice(0)) start();
    return;
  }
  const top = topmost();
  if (!top) return;
  // The entry is already gone: the layer closes without calling `history.back()` again.
  top.popped = true;
  top.close();
}

/**
 * While `open`, the layer owns one history entry (`history.pushState({ appShell: order }, '')`, same URL). `popstate` closes only the
 * topmost open layer. Any other close (the effect ends because `open` became false or the component unmounted) calls `history.back()`
 * once, and that `popstate` is ignored. `close` may change between renders.
 */
export function useBackLayer(open: boolean, close: () => void, order: BackOrder): void {
  const latest = useRef(close);
  latest.current = close;
  useEffect(() => {
    if (!open) return;
    const layer: Layer = { order, close: () => latest.current(), popped: false };
    let started = false;
    const start = () => {
      started = true;
      // After a reload the page still sits on the entry its layer pushed before: that one layer adopts it instead of stacking a second.
      const adopt = persisted === order;
      persisted = undefined;
      if (!adopt) history.pushState({ appShell: order }, '');
      layers.add(layer);
    };
    if (!listening) { window.addEventListener('popstate', onPopState); listening = true; }
    // A sheet that closes as this layer opens (the account menu choosing « Améliorer l'app ») is still going back: wait for it.
    if (ignored > 0) waiting.push(start); else start();
    return () => {
      const at = waiting.indexOf(start);
      if (at >= 0) waiting.splice(at, 1);
      if (!started) return;
      layers.delete(layer);
      if (!layer.popped) { ignored += 1; history.back(); }
    };
  }, [open, order]);
}
