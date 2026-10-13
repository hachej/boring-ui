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

const topmost = (): Layer | undefined => [...layers].sort((a, b) => RANK[a.order] - RANK[b.order])[0];

function onPopState(): void {
  if (ignored > 0) { ignored -= 1; return; }
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
    history.pushState({ appShell: order }, '');
    layers.add(layer);
    if (!listening) { window.addEventListener('popstate', onPopState); listening = true; }
    return () => {
      layers.delete(layer);
      if (!layer.popped) { ignored += 1; history.back(); }
    };
  }, [open, order]);
}
