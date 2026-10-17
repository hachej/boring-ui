import type { ElementType, ReactNode } from 'react';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '../utils/utils';

/** Working text retains its public adapter; motion and appearance belong to the host's Spinner. */
export function Shimmer({ children, active = true, as: Tag = 'span', className }: { readonly children: ReactNode; readonly active?: boolean; readonly as?: ElementType; readonly className?: string }) {
  return <Tag className={cn('inline-flex items-center gap-2', className)}>{active && <Spinner aria-hidden="true" />}{children}</Tag>;
}
