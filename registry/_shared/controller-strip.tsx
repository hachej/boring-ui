'use client';

import type { CSSProperties, ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '../utils/utils';

/** One action of a controller strip: its name (aria-label and tooltip), icon and what it does; `primary` is the chevron, always shown. */
export interface ControllerAction { readonly id: string; readonly testId: string; readonly label: string; readonly icon: ReactNode; readonly onSelect: () => void; readonly primary?: boolean; readonly expanded?: boolean; readonly on?: boolean }

/** One cell of the controller notch: a plain 16 px high button (no chip, no circle: a hover fill only) whose 44 px hit area is its invisible ::before. `extra` cells start closed (0 wide). */
function ControllerCell({ action, extra, round, dot, ...rest }: { readonly action: ControllerAction; readonly extra: boolean; readonly round: boolean; readonly dot: { readonly label: string } | undefined } & Record<string, unknown>) {
  return <button type="button" {...rest} data-testid={action.testId} data-action={action.id} aria-label={action.label} onClick={action.onSelect}
    {...(action.expanded !== undefined ? { 'aria-expanded': action.expanded } : {})} {...(action.on ? { 'aria-pressed': true } : {})}
    className={cn('relative inline-flex h-4 shrink-0 items-center justify-center text-muted-foreground transition-colors duration-(--duration-fast) pointer-fine:hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground aria-pressed:text-foreground motion-reduce:transition-none max-md:h-11 pointer-coarse:h-11',
      'md:before:absolute md:before:-inset-y-3.5 md:before:inset-x-0 md:before:content-[""] [&_svg]:size-[11px]',
      extra ? 'w-0 overflow-hidden opacity-0 group-hover/ctl:w-7 group-hover/ctl:opacity-100 group-has-[:focus-visible]/ctl:w-7 group-has-[:focus-visible]/ctl:opacity-100 max-md:w-11 max-md:opacity-100 pointer-coarse:w-11 pointer-coarse:opacity-100' : 'w-8 rounded-l-full max-md:w-11 pointer-coarse:w-11', round && 'rounded-r-full')}>
    {action.icon}
    {dot && <span role="img" aria-label={dot.label} data-testid="agent-bar-unread" className="pointer-events-none absolute top-0 right-1 size-1.5 rounded-(--radius-3xl) bg-primary" />}
  </button>;
}

/**
 * The controller notch shared by the composer bar and the agent card: a strip centred on a container's border (`edge` says which: half outside, half inside).
 * At rest only the first action (the chevron) shows; the others open to its right on hover and on focus within, and stay shown on a touch screen. A dot beside the
 * chevron while something is unread. Each action is a button named by aria-label and tooltip. The parent must be `relative`.
 */
export function ControllerStrip({ actions, unread, edge = 'top', style }: { readonly actions: readonly ControllerAction[]; readonly unread?: { readonly label: string } | undefined; readonly edge?: 'top' | 'bottom'; readonly style?: CSSProperties | undefined }) {
  const [first, ...rest] = actions;
  if (!first) return null;
  // The chevron is the anchor (the strip's left edge is half a cell from the middle): the other cells open to its right, inside the same container, which widens.
  const cell = (action: ControllerAction, extra: boolean, last: boolean) => <Tooltip key={action.id}>
    <TooltipTrigger render={<ControllerCell action={action} extra={extra} round={extra ? last : rest.length === 0} dot={undefined} />} />
    <TooltipContent side={edge === 'top' ? 'top' : 'bottom'}>{action.label}</TooltipContent></Tooltip>;
  return <span data-testid="composer-controller" style={style}
    className={cn('group/ctl absolute left-1/2 z-30 -translate-x-4 max-md:-translate-x-5.5 pointer-coarse:-translate-x-5.5', edge === 'top' ? 'top-0 -translate-y-1/2' : 'bottom-0 translate-y-1/2')}>
    {/* The notch is drawn 16 px high behind the cells; on touch the cells themselves are 44 px boxes (no overlap), so the hit areas are real. */}
    <span className="relative flex items-center">
      <span aria-hidden="true" className="absolute inset-x-0 top-1/2 h-4 -translate-y-1/2 rounded-full bg-card ring-4 ring-card outline-1 outline-offset-4 outline-border/70" />
      {cell(first, false, false)}
      {unread && <span role="img" aria-label={unread.label} data-testid="agent-bar-unread" className="pointer-events-none absolute top-1/2 -right-3 size-1.5 -translate-y-1/2 rounded-(--radius-3xl) bg-primary group-hover/ctl:opacity-0 group-has-[:focus-visible]/ctl:opacity-0" />}
      {rest.map((action, i) => cell(action, true, i === rest.length - 1))}
    </span>
  </span>;
}
