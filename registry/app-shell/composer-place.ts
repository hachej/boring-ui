'use client';

// Where a launcher that floats on a corner (the floating bar, its folded icon, the explore tab) is drawn when the composer is a config object: `at.offset`, `at.stack`, `avoid`, `layer`, and the
// footprint it publishes (`reserve`). The circle does the same for itself (`composer-circle`); a composer given as a string keeps the styles it always had (`style` is `undefined`).
import type { CSSProperties, RefObject } from 'react';
import { configOf } from './composer-config';
import type { Corner, Length } from './composer-config';
import { css, useAvoidShift, useLauncherSlot } from './composer-stack';
import { useInternal } from './layer-context';

export interface CornerPlace {
  /** The inline and block insets and the z-index, or `undefined` for a composer that is not a config object (the caller's own styles). */
  readonly style: CSSProperties | undefined;
  /** The px the launcher lifts above the others nearer its corner. */
  readonly lift: number;
  /** The first launcher of the page answers Ctrl or Cmd + J. */
  readonly first: boolean;
}

/**
 * Registers the launcher on `corner` while `active` (`null`: it sits in the page's flow or is dragged free, so it takes no corner) and gives its style. `defaults` are the distances of the launcher
 * when the config gives none; `size` is its box in px, for the stack and the reserve. One composer is one registrant at a time: its bar, its icon and its tab are never drawn together.
 */
export function useCornerPlace({ ref, corner, defaults, size, active }: { readonly ref: RefObject<HTMLElement | null>; readonly corner: Corner | null; readonly defaults: { readonly inline: Length; readonly block: Length }; readonly size: { readonly w: number; readonly h: number }; readonly active: boolean }): CornerPlace {
  const layer = useInternal();
  const config = configOf(layer);
  const inline = config?.at?.offset?.inline ?? defaults.inline;
  const block = config?.at?.offset?.block ?? defaults.block;
  const registered = config !== undefined && active;
  const { lift, first } = useLauncherSlot({ id: config?.id, corner, stack: config?.at?.stack ?? 'auto', reserve: config?.reserve !== 'none', inline, block, w: size.w, h: size.h }, registered, layer.launcherOwner);
  const shift = useAvoidShift(ref, corner ?? 'bottom-end', config?.avoid, registered && corner !== null);
  if (!config || corner === null) return { style: undefined, lift: 0, first };
  const bottom = corner.startsWith('bottom'), end = corner.endsWith('end');
  return { lift, first, style: { ...(config.layer === undefined ? {} : { zIndex: config.layer }), [end ? 'insetInlineEnd' : 'insetInlineStart']: `calc(${css(inline)} + ${shift}px)`, [bottom ? 'insetBlockEnd' : 'insetBlockStart']: `calc(${css(block)} + ${lift}px)` } };
}

/** The z-index a config gives a launcher's own box (`layer`), as a style; nothing when it gives none. A panel sits one above its launcher. */
export function layerStyle(layer: { readonly composerConfig: { readonly current: unknown } }, above = 0): CSSProperties | undefined {
  const z = configOf(layer)?.layer;
  return z === undefined ? undefined : { zIndex: z + above };
}
