import type { ReactNode } from 'react';
import { cn } from '../utils/utils';
import { Inbox } from '../_shared/icons';

export type EmptyStateProps = {
  title: string;
  hint?: string;
  /** Defaults to the inbox icon from the kit's icon module. */
  icon?: ReactNode;
  /** One action, usually a Button from the app's ui set. */
  action?: ReactNode;
  className?: string;
};

/** Plain column, no dashed border: the shadcn Empty adds one, which the flat surface rule forbids and blocks may not restyle. */
export function EmptyState({ title, hint, icon, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex w-full min-w-0 flex-col items-center justify-center gap-2 p-6 text-center', className)}>
      <span className="flex size-6 items-center justify-center text-muted-foreground">{icon ?? <Inbox aria-hidden className="size-6" />}</span>
      <span className="text-sm font-medium">{title}</span>
      {hint ? <span className="max-w-prose text-xs text-muted-foreground">{hint}</span> : null}
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}
