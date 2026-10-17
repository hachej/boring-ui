'use client';

// The one sheet of the shell (account, « Plus », « … », app flows): the host's shadcn `drawer`, a modal bottom sheet. Only one is open at a time
// (opening one closes any other) and Back closes it (the Back manager's `sheet` layer). The agent layer is not an AppSheet.
import type { ReactNode } from 'react';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { useBackLayer } from './back';
import { useExclusiveSheet } from './use-exclusive-sheet';

/** A modal bottom sheet with a title. The scrim, Escape, a swipe down and Back close it. */
export function AppSheet({ open, onOpenChange, title, children }: { readonly open: boolean; readonly onOpenChange: (open: boolean) => void; readonly title: string; readonly children: ReactNode }) {
  const close = () => onOpenChange(false);
  useExclusiveSheet(open, close);
  useBackLayer(open, close, 'sheet');
  return <Drawer open={open} onOpenChange={next => { if (!next) close(); }} showSwipeHandle swipeDirection="down">
    <DrawerContent data-testid="app-sheet" className="app-shell max-h-[85dvh]">
      <DrawerHeader><DrawerTitle>{title}</DrawerTitle></DrawerHeader>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pt-2 pb-[env(safe-area-inset-bottom)]">{children}</div>
    </DrawerContent>
  </Drawer>;
}

/** A full-width row of a sheet: at least 48px tall (44px is the touch minimum). */
export const SHEET_ROW = 'flex min-h-12 w-full items-center gap-3 px-4 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent';
