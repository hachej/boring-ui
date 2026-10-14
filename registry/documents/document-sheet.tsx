'use client';

// One document over the app, for « Voir la fiche »: the host sets `path` from its own handler (for example its `onOpenSpec`) and clears it in
// `onClose`. The sheet is a full-screen view of the shell (`useShellLayer`): it closes the agent layers when it opens, and Back closes it
// first. The file is the same viewer the Library opens (editable where the viewer edits). `onShowAll` adds « Toutes les fiches ».
import { useEffect, useRef } from 'react';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { useShellLayer } from '../app-shell/shell-layer';
import { useExclusiveSheet } from '../app-shell/sheet';
import { FileViewer } from '../pi-app/file-viewer';
import type { CustomViewers, ViewerOptions } from '../pi-app/artifact-panel';
import type { RevisionProvider } from '@hachej/boring-files/revision';
import { cn } from '../utils/utils';
import { documentsLabels, DocumentsWords } from './words';
import type { DocumentsLocale } from './words';
import type { DocumentsLabels } from './documents-labels';

export interface DocumentSheetProps {
  readonly provider: RevisionProvider;
  /** The workspace path of the document on show; `undefined` closes the sheet. */
  readonly path: string | undefined;
  /** Called when the person closes the sheet (its close button, a swipe, Back): the host clears `path`. */
  readonly onClose: () => void;
  /** Adds « Toutes les fiches » to the sheet. The sheet closes first, then this runs. */
  readonly onShowAll?: (() => void) | undefined;
  readonly locale?: DocumentsLocale | undefined;
  readonly labels?: Partial<DocumentsLabels> | undefined;
  /** Host viewers by kind, as for the Library (for example a canvas). */
  readonly viewers?: CustomViewers | undefined;
  readonly share?: ViewerOptions['share'];
  readonly className?: string | undefined;
}

/** The sheet's name in the shell's layers: one sheet of this kind at a time. */
const LAYER = 'document';

export function DocumentSheet({ provider, path, onClose, onShowAll, locale, labels: given, viewers, share, className }: DocumentSheetProps) {
  const shown = path !== undefined;
  const { open, close, isOpen } = useShellLayer(LAYER);
  const labels = documentsLabels(locale, given);
  // The host's `path` decides whether the sheet is on show; a close from the sheet itself (Back, swipe, its buttons) reports to the host.
  useEffect(() => { if (shown) open(); else close(); }, [shown, open, close]);
  useExclusiveSheet(isOpen, close);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (shown && wasOpen.current && !isOpen) onClose();
    wasOpen.current = isOpen;
  }, [isOpen, shown, onClose]);
  const title = path === undefined ? labels.sheetTitle : path.split('/').pop() || path;
  return <DocumentsWords locale={locale}>
    <Drawer open={isOpen} onOpenChange={next => { if (!next) close(); }} showSwipeHandle swipeDirection="down">
      <DrawerContent data-testid="document-sheet" className={cn('app-shell h-[92dvh] max-h-[92dvh] pb-[env(safe-area-inset-bottom)]', className)}>
        <div className="flex shrink-0 items-center gap-2 px-3 pt-1 pb-2">
          <DrawerTitle className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</DrawerTitle>
          {onShowAll && <button type="button" data-testid="document-sheet-all" onClick={() => { close(); onShowAll(); }}
            className="inline-flex min-h-11 shrink-0 items-center rounded-lg border border-border bg-background px-3 text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60 md:min-h-8 md:text-xs">{labels.allDocuments}</button>}
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {path !== undefined && <FileViewer key={path} path={path} locator={provider.locate(path)}
            options={{ client: provider, identity: provider.identity, ...(viewers ? { viewers } : {}), ...(share ? { share } : {}) }} onClose={close} />}
        </div>
      </DrawerContent>
    </Drawer>
  </DocumentsWords>;
}
