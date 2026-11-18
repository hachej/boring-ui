'use client';

// The standalone composer's right pane on a wide screen: what the page's own layout gives the shell (the right column), a floating window gives here. The pane's entries (an artifact the host's
// `artifactPanel` draws, a file in the kit's viewer, an app view) open in a window beside the floating bar, on the side the page has room for, or over the whole screen when the viewer asks for it.
// Same pane, same entries and back stack as the shell's column; a phone shows them full screen (`AgentLayer`). Host concern: Pi has no layout.
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import { cn } from '../utils/utils';
import { PaneStack } from './agent-pane';
import { useTitle } from './agent-chats';
import { cornerOf } from './float-composer';
import { PaneFullscreenContext, useInternal } from './layer-context';

/** The bar's own width (`FloatFrame`) and the gap kept around the window, as CSS lengths. */
const BAR = 'min(22rem, calc(100vw - 2rem))';
const GAP = '1rem';

/** The window beside the bar: next to it on the side with room, at the bar's height; the folded icon and a bottom bar leave it at the right edge above them. */
function placeOf(layer: ReturnType<typeof useInternal>): CSSProperties {
  const { place, floatPos } = layer;
  const width = `min(40rem, calc(100vw - ${BAR} - 3 * ${GAP}))`;
  if (place !== 'float') return { right: GAP, bottom: '6rem', width: 'min(40rem, calc(100vw - 2rem))', height: 'min(46rem, calc(100dvh - 8rem))' };
  const corner = cornerOf(floatPos, 352, 56);
  return { ...(corner.endsWith('l') ? { left: `calc(${BAR} + 2 * ${GAP})` } : { right: `calc(${BAR} + 2 * ${GAP})` }), ...(corner.startsWith('t') ? { top: GAP } : { bottom: GAP }), width, height: `min(46rem, calc(100dvh - 2 * ${GAP}))` };
}

export function FloatPane(): ReactElement | null {
  const layer = useInternal();
  const { title } = useTitle();
  const [fullscreen, setFullscreen] = useState(false);
  const open = layer.stack.length > 0;
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the full screen belongs to the open pane: closing it ends the full screen
  useEffect(() => { if (!open) setFullscreen(false); }, [open]);
  if (!open) return null;
  return <PaneFullscreenContext.Provider value={{ fullscreen, set: setFullscreen }}>
    <div data-testid="composer-pane" data-fullscreen={fullscreen || undefined} style={fullscreen ? undefined : placeOf(layer)}
      className={cn('fixed z-(--app-shell-z-layer) flex min-h-0 min-w-0 flex-col overflow-hidden bg-card text-card-foreground ring-1 ring-border', fullscreen ? 'inset-0' : 'rounded-(--radius-3xl) shadow-pm-popover')}>
      <PaneStack placement="column" assistant={title} />
    </div>
  </PaneFullscreenContext.Provider>;
}
