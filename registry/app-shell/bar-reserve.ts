// The space the assistant's bottom bar takes from the screen (`--agent-bar-reserve`), as one pure function of state the layer already has.
// Host concern: Pi has no layout.
import type { Snap } from './layer-context';

export interface BarReserveInput {
  /** `AppShell composer="bar"` with an assistant, on a phone: the bar is the peek drawer. A wide screen draws the bar in the content column's flow, so it never covers the page. */
  readonly phoneBar: boolean;
  readonly snap: Snap;
  /** The peek's height in px from the bottom of the window: the bar's rem, the card above the field, and the tab bar it sits above (`peekPoint`). */
  readonly peekPx: number;
  /** The tab bar's height in px, safe area included (0 without a tab bar). */
  readonly tabbarPx: number;
}

/**
 * The length the screens keep free at the bottom. The peek covers the lowest `peekPx - tabbarPx` of the screen area (the tab bar is laid out
 * under the screen, and the peek's clip leaves it visible); at half or full the sheet covers the page on purpose, and with no bar there is
 * nothing to clear. With no tab bar the screen reaches the window's edge, so the safe area is added there.
 */
export function barReserve({ phoneBar, snap, peekPx, tabbarPx }: BarReserveInput): string {
  const px = phoneBar && snap === 'peek' ? Math.max(0, Math.round(peekPx - tabbarPx)) : 0;
  if (px === 0) return '0px';
  return tabbarPx > 0 ? `${px}px` : `calc(${px}px + env(safe-area-inset-bottom, 0px))`;
}
