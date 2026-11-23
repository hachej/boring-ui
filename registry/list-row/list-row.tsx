import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '../utils/utils';

export type ListRowProps = {
  title: string;
  subtitle?: string;
  /** An avatar, icon or any leading control. */
  leading?: ReactNode;
  /** Metadata or an action, right-aligned. */
  trailing?: ReactNode;
  /** Makes the row a button. Without it the row is static text. */
  onSelect?: () => void;
  /** The row is the current one (the open item of a list): it carries the selected wash and `aria-current="true"`. */
  active?: boolean;
  /** A control beside the row, usually the kit's `<CiteButton reference={…} />`. It sits next to the row button, never inside it (a button may not hold a button). Shown on hover or focus with a fine pointer, always on touch and while it holds `data-cited`. */
  action?: ReactNode;
  className?: string;
};

/** No separator lines: the hover wash marks the row. 44px tall on phones (touch target), 36px from md up. */
export function ListRow({ title, subtitle, leading, trailing, onSelect, active, action, className }: ListRowProps) {
  const content = (
    <>
      {leading ? <span className="flex shrink-0 items-center">{leading}</span> : null}
      <span className="flex min-w-0 flex-1 flex-col text-left">
        <span className="truncate text-sm font-medium">{title}</span>
        {subtitle ? <span className="truncate text-xs text-muted-foreground">{subtitle}</span> : null}
      </span>
      {trailing ? <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">{trailing}</span> : null}
    </>
  );
  const box = 'flex min-h-11 w-full min-w-0 items-center gap-3 px-2 py-2 md:min-h-9';
  // The Button keeps the app's ghost wash on hover; the static row adds the same wash itself.
  const wash = active ? 'bg-accent' : 'hover:bg-accent';
  const current = active ? ('true' as const) : undefined;
  if (action || (active && onSelect)) {
    // The wash and `className` live on a wrapper (the Button's own classes stay layout-only), so the action sits on the row.
    const pad = action ? 'pr-11' : undefined;
    const row = onSelect ? (
      <Button variant="ghost" className={cn(box, 'h-auto justify-start', pad)} aria-current={current} onClick={onSelect}>{content}</Button>
    ) : (
      <div aria-current={current} className={cn(box, pad)}>{content}</div>
    );
    return (
      <div data-testid="list-row" className={cn('group/list-row relative min-w-0 rounded-(--radius)', wash, className)}>
        {row}
        {action ? <div data-testid="list-row-action" className="absolute top-1/2 right-1 z-10 -translate-y-1/2 opacity-0 transition-opacity duration-(--duration-fast) group-hover/list-row:opacity-100 group-focus-within/list-row:opacity-100 has-[[data-cited]]:opacity-100 pointer-coarse:opacity-100 motion-reduce:transition-none">{action}</div> : null}
      </div>
    );
  }
  if (onSelect) {
    return (
      <Button variant="ghost" className={cn(box, 'h-auto justify-start', className)} onClick={onSelect}>
        {content}
      </Button>
    );
  }
  return <div aria-current={current} className={cn(box, 'rounded-(--radius)', wash, className)}>{content}</div>;
}
