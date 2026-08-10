/**
 * Single source of truth for workspace layout breakpoints.
 *
 * Three viewport tiers, aligned with Tailwind's default `sm` (640px) and
 * `lg` (1024px) screens so JS-driven layout flips and responsive utility
 * classes (`sm:`, `lg:`) agree:
 *
 *   compact  viewport <  640   (mobile shell / sheet chrome)
 *   medium   640 <= w < 1024   (rail / collapsible sidebar)
 *   wide     viewport >= 1024  (full inline layout)
 *
 * Decision (epic #1110): the shell previously flipped mobile at <640 while
 * ResponsiveDockviewShell used <768, so 640-767px rendered a mobile dockview
 * inside a desktop shell. 640 wins because the mobile shell (the outermost
 * flip) and all Tailwind `sm:` styling already use it.
 *
 * Always compare with `width < COMPACT_MAX_WIDTH` / `width < WIDE_MIN_WIDTH`
 * (exclusive upper bound), matching `min-width`-based CSS at the same value.
 */
export const COMPACT_MAX_WIDTH = 640

export const WIDE_MIN_WIDTH = 1024

export const WORKSPACE_BREAKPOINTS = {
  compactMax: COMPACT_MAX_WIDTH,
  wideMin: WIDE_MIN_WIDTH,
} as const

/** True when the viewport is in the compact (mobile-shell) tier. */
export function isCompactViewport(width: number): boolean {
  return width < COMPACT_MAX_WIDTH
}

/** True when the viewport is below the wide tier (compact or medium). */
export function isBelowWideViewport(width: number): boolean {
  return width < WIDE_MIN_WIDTH
}
