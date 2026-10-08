import type { ElementType, ReactNode } from 'react';
import { cn } from '../utils/utils';

/** Text with a moving highlight while `active` (styles: `.pi-chat-shimmer` in this item's css). Plain text otherwise. */
export function Shimmer({ children, active = true, as: Tag = 'span', className }: { readonly children: ReactNode; readonly active?: boolean; readonly as?: ElementType; readonly className?: string }) {
  return <Tag className={cn(active && 'pi-chat-shimmer motion-reduce:animate-none', className)}>{children}</Tag>;
}
