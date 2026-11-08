// A cell: an iframe of this same file that shows one thing needing a document of its own. AlertDialog is always modal in Base UI (scroll lock,
// inert siblings), so its static frame cannot share a document with the rest of the page. The state (mode, theme) reaches it through the frame.
import { useRef } from 'react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogMedia, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { InfoIcon } from '../../registry/_shared/icons';
import { Label } from './demo.jsx';
import { cellId, cellUrl } from './state.js';

export function Cell({ id, caption }) {
  const url = useRef(null);
  url.current ??= cellUrl(id);
  return (
    <div className="flex min-w-0 flex-col gap-1" data-ds-framed={id}>
      <Label>{caption}</Label>
      <iframe data-ds-cell={id} title={`Cell ${id}`} src={url.current} className="h-80 w-full rounded-lg border border-border bg-background" />
    </div>
  );
}

/** What a cell shows: the open alert dialog of its size, in a document that is all its own. */
export function CellRoot() {
  const size = cellId().endsWith('-sm') ? 'sm' : 'default';
  return (
    <main className="h-dvh bg-background p-2 text-foreground" data-ds-cell-root data-ds-cell-names="AlertDialog AlertDialogPortal AlertDialogOverlay AlertDialogTrigger AlertDialogContent AlertDialogHeader AlertDialogMedia AlertDialogTitle AlertDialogDescription AlertDialogFooter AlertDialogAction AlertDialogCancel">
      <AlertDialog open onOpenChange={() => {}}>
        <AlertDialogTrigger render={<Button size="sm" variant="outline" />}>Open</AlertDialogTrigger>
        <AlertDialogContent size={size} initialFocus={false} finalFocus={false}>
          <AlertDialogHeader>
            <AlertDialogMedia><InfoIcon /></AlertDialogMedia>
            <AlertDialogTitle>Discard the draft?</AlertDialogTitle>
            <AlertDialogDescription>The changes in this draft are not saved yet.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Keep</AlertDialogCancel><AlertDialogAction>Discard</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
