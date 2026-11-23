'use client';

// The grip of the floating composer: six dots on the left of the bar and in the window's header. It is the drag handle (pointer events, a grab cursor, a 44 px target on touch)
// and the keyboard's way to move the bar (arrow keys, 16 px a step, 64 with Shift). The frame (`FloatFrame`) owns the position and hands the handlers down through this context.
import { createContext, useContext } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { GripVerticalIcon } from '../_shared/icons';
import { cn } from '../utils/utils';
import { shellWords, useInternal } from './layer-context';

export interface GripHandlers {
  readonly onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  readonly onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  readonly onPointerUp: (event: PointerEvent<HTMLElement>) => void;
  readonly onPointerCancel: (event: PointerEvent<HTMLElement>) => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}
export const GripContext = createContext<GripHandlers | null>(null);

/** `rail`: the full-height strip on the bar's left edge. Otherwise a small grip for a header. Nothing outside a `FloatFrame`. */
export function Grip({ rail = false }: { readonly rail?: boolean }) {
  const handlers = useContext(GripContext);
  const layer = useInternal();
  if (!handlers) return null;
  const label = shellWords(layer.locale ?? layer.agent?.chatProps?.locale, layer.agent).dragHandle;
  return <span role="button" tabIndex={0} data-testid={rail ? 'composer-grip' : 'composer-grip-tray'} aria-label={label} title={label} {...handlers}
    className={cn('flex touch-none cursor-grab items-center justify-center rounded-(--radius-3xl) text-muted-foreground outline-ring select-none hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground focus-visible:outline-2 active:cursor-grabbing [&_svg]:size-4',
      rail ? 'absolute inset-y-0 left-0 z-raised w-7 pointer-coarse:w-11' : 'size-8 shrink-0 pointer-coarse:size-11')}><GripVerticalIcon aria-hidden="true" /></span>;
}
