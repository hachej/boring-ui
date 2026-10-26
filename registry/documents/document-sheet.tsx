'use client';

// One document over the app, for « Voir la fiche »: the host sets `path` from its own handler (for example its `onOpenSpec`) and clears it in
// `onClose`. The sheet is a full-screen view of the shell (`useShellLayer`): it closes the agent layers when it opens, and Back closes it
// first. The file is the same viewer the Library opens (editable where the viewer edits). Closing a file with unsaved edits asks first.
// `onShowAll` adds « Toutes les fiches »: the sheet closes, then the host's navigation runs after the sheet's Back entry is gone.
import { useCallback, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { afterBack } from '../app-shell/back';
import { useShellLayer } from '../app-shell/shell-layer';
import { useExclusiveSheet } from '../app-shell/use-exclusive-sheet';
import { FileViewer } from '../pi-app/file-viewer';
import type { CustomViewers, ViewerOptions } from '../pi-app/artifact-panel';
import { defaultKinds } from '../pi-app-kinds/pi-app-kinds';
import type { RevisionProvider } from '@hachej/boring-files/revision';
import { cn } from '../utils/utils';
import { documentsLabels, DocumentsWords } from './words';
import type { DocumentsLocale } from './words';
import type { DocumentsLabels } from './documents-labels';

export interface DocumentSheetProps {
  readonly provider: RevisionProvider;
  /** The workspace path of the document on show; `undefined` closes the sheet. */
  readonly path: string | undefined;
  /** Called when the sheet closes (its close button, a swipe, Back, « Toutes les fiches »): the host clears `path`. */
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
/** The viewer's kinds: the pi-app default list, in English. */
const kinds = defaultKinds();

export function DocumentSheet({ provider, path, onClose, onShowAll, locale, labels: given, viewers, share, className }: DocumentSheetProps) {
  const shown = path !== undefined;
  const labels = documentsLabels(locale, given);
  // The viewer reports its unsaved edits; a close that would drop them asks first (the Back path too, through the shell layer).
  const dirty = useRef(false);
  const report = useCallback((unsaved: boolean) => { dirty.current = unsaved; }, []);
  const mayLeave = () => !dirty.current || window.confirm(labels.discardChanges);
  const { open, close, isOpen } = useShellLayer(LAYER, { confirmBack: mayLeave });
  // The host's `path` decides whether the sheet is on show; a close from the sheet itself reports to the host.
  useEffect(() => { if (shown) open(); else close(); }, [shown, open, close]);
  useExclusiveSheet(isOpen, close);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (shown && wasOpen.current && !isOpen) onClose();
    wasOpen.current = isOpen;
  }, [isOpen, shown, onClose]);
  const requestClose = () => { if (mayLeave()) close(); };
  const title = path === undefined ? labels.sheetTitle : path.split('/').pop() || path;
  return <DocumentsWords locale={locale}>
    <Drawer open={isOpen} onOpenChange={next => { if (!next) requestClose(); }} showSwipeHandle swipeDirection="down">
      <DrawerContent data-testid="document-sheet" className={cn('app-shell max-h-[92dvh] min-h-[92dvh]', className)}>
        {/* The title is for assistive technology: the viewer's own bar shows the file name. */}
        <DrawerTitle className="sr-only">{title}</DrawerTitle>
        {onShowAll && <div className="flex shrink-0 justify-end px-3 pt-1 pb-2">
          <Button variant="ghost" data-testid="document-sheet-all" onClick={() => { if (!mayLeave()) return; close(); afterBack(onShowAll); }}>{labels.allDocuments}</Button>
        </div>}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden pb-[env(safe-area-inset-bottom)]">
          {path !== undefined && <FileViewer key={path} path={path} locator={provider.locate(path)} onUnsavedChange={report}
            options={{ client: provider, identity: provider.identity, kinds, ...(viewers ? { viewers } : {}), ...(share ? { share } : {}) }} onClose={requestClose} />}
        </div>
      </DrawerContent>
    </Drawer>
  </DocumentsWords>;
}
