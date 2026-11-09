// The screen's one left margin. A screen wraps its content in `ScreenBody`: it pads the inline sides with `--screen-gutter` (the theme token; 1rem, 0.75rem under
// `data-density="compact"`, fallback 1rem), the same value the shell's header title starts on, so title and body share one left edge. Block padding is the gutter too.
// A list, table or `ListDetail` that draws its own rows passes `bleed`: no inline padding (rows and dividers run edge to edge), and the first cell of each
// `li`, `tr` or `[role=row]` gets `padding-inline-start: var(--screen-gutter, 1rem)` from the app-shell item's css (zero specificity: a row's own padding wins), so its text still sits on the gutter.
// Host concern: Pi has no layout.
import type { ComponentProps } from 'react';

export interface ScreenBodyProps extends ComponentProps<'div'> {
  /** No inline padding, for a list, table or `ListDetail` that runs edge to edge; its rows' first cells keep the text on the gutter. */
  readonly bleed?: boolean;
}

export function ScreenBody({ bleed = false, className, ...props }: ScreenBodyProps) {
  return <div data-slot="screen-body" {...(bleed ? { 'data-bleed': '' } : {})} className={`${bleed ? 'py-[var(--screen-gutter,1rem)]' : 'p-[var(--screen-gutter,1rem)]'}${className ? ` ${className}` : ''}`} {...props} />;
}
