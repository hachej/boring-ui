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
  className?: string;
};

/** No separator lines: the hover wash marks the row. 44px tall on phones (touch target), 36px from md up. */
export function ListRow({ title, subtitle, leading, trailing, onSelect, className }: ListRowProps) {
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
  if (onSelect) {
    return (
      <Button variant="ghost" className={cn(box, 'h-auto justify-start', className)} onClick={onSelect}>
        {content}
      </Button>
    );
  }
  return <div className={cn(box, 'rounded-(--radius) hover:bg-accent', className)}>{content}</div>;
}
