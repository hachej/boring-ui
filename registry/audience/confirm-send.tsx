'use client';

import { useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import type { OutreachLabels } from './outreach-labels';
import type { OutgoingMessage, Prepared } from './outreach-model';

export interface SendActions {
  /** The owner's click: the host checks everything and answers what would go out, with the single-use confirm token. Rejects with an error whose `code` is the host's (`footer_missing`, `suppressed`...). */
  readonly onPrepare: (message: OutgoingMessage) => Promise<Prepared>;
  /** The owner's confirm: one send with that token. */
  readonly onSend: (message: OutgoingMessage, confirm: string) => Promise<void>;
}

interface Props extends SendActions {
  /** The message to confirm; null: closed. */
  readonly message: OutgoingMessage | null;
  readonly labels: OutreachLabels;
  readonly onClose: (sent: boolean) => void;
}

const codeOf = (error: unknown): string => (error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : '');

/** The confirm-to-send dialog: shows exactly what the host would send (footer included) and sends only on the click. Used for first sends and replies alike. */
export function ConfirmSend({ message, labels, onClose, onPrepare, onSend }: Props) {
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setPrepared(null); setFailure(''); setBusy(false);
    if (!message) return;
    let live = true;
    onPrepare(message).then((p) => { if (live) setPrepared(p); }).catch((e: unknown) => { if (live) setFailure(labels.errors[codeOf(e)] ?? labels.failed); });
    return () => { live = false; };
  }, [message]); // eslint-disable-line react-hooks/exhaustive-deps
  const confirm = async () => {
    if (!message || !prepared) return;
    setBusy(true);
    try { await onSend(message, prepared.confirm); onClose(true); } catch (e) { setFailure(labels.errors[codeOf(e)] ?? labels.failed); setPrepared(null); setBusy(false); }
  };
  return <Dialog open={message !== null} onOpenChange={(open) => { if (!open && !busy) onClose(false); }}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{labels.confirmTitle}</DialogTitle>
        <DialogDescription>{labels.confirmDescription}</DialogDescription>
      </DialogHeader>
      {failure && <Alert variant="destructive"><AlertDescription>{failure}</AlertDescription></Alert>}
      {!prepared && !failure && <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Spinner />{labels.preparing}</p>}
      {prepared && <div className="flex flex-col gap-2 text-sm" data-testid="confirm-preview">
        <p><span className="text-muted-foreground">{labels.from}</span> {prepared.from}</p>
        <p><span className="text-muted-foreground">{labels.to}</span> {prepared.to}</p>
        <p><span className="text-muted-foreground">{labels.subject}</span> {prepared.subject}</p>
        <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">{prepared.text}</pre>
        <p className="text-muted-foreground">{labels.quota(prepared.remaining, 20)}</p>
      </div>}
      <DialogFooter>
        <Button variant="outline" disabled={busy} onClick={() => onClose(false)}>{labels.cancel}</Button>
        <Button disabled={!prepared || busy} onClick={confirm}>{busy ? labels.sending : labels.confirm}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
