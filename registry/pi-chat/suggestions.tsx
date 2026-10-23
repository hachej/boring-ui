'use client';

import type { ReactNode } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/**
 * The host's shadcn Popover above the composer, anchored to the nearest positioned ancestor's top edge and as wide as it.
 * Focus stays in the message box (the picker keyboard drives the rows); outside presses dismiss it.
 */
export function ComposerSuggestions({ testId, onDismiss, children }: { readonly testId: string; readonly onDismiss: () => void; readonly children: ReactNode }) {
  return <Popover open modal={false} onOpenChange={open => { if (!open) onDismiss(); }}>
    <PopoverTrigger nativeButton={false} render={<span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0" />} />
    <PopoverContent data-testid={testId} side="top" align="start" initialFocus={false} finalFocus={false} className="pi-chat w-(--anchor-width) max-w-[calc(100vw-1rem)]">
      {children}
    </PopoverContent>
  </Popover>;
}
