'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmSend } from './confirm-send';
import type { SendActions } from './confirm-send';
import type { OutreachLabels } from './outreach-labels';
import { replySubject } from './outreach-model';
import type { InboxThreadRow, OutgoingMessage, ThreadMessage, ThreadView } from './outreach-model';

export interface InboxPanelProps extends SendActions {
  readonly threads: readonly InboxThreadRow[];
  readonly unread: number;
  /** Opens a thread (the host marks it read); the app refreshes the list after. */
  readonly onOpen: (thread: string) => Promise<ThreadView>;
  /** Called after a reply went out or a thread was read, so the app reloads `/api/outreach`. */
  readonly onChanged: () => void;
  readonly labels: OutreachLabels;
}

function Bubble({ message, labels }: { message: ThreadMessage; labels: OutreachLabels }) {
  const incoming = message.direction === 'in';
  return <div className="flex flex-col gap-1 rounded-md border p-3 text-sm">
    <p className="text-xs text-muted-foreground">{incoming ? `${labels.incoming} · ${message.from}` : `${labels.outgoing} · ${message.to}`} · {labels.formatTime(message.at)}</p>
    {incoming ? <p className="whitespace-pre-wrap" data-testid="inbound-text">{message.text}</p> : <p>{message.subject}</p>}
  </div>;
}

/** The last message of the other side: what a reply answers. */
const lastIncoming = (view: ThreadView): Extract<ThreadMessage, { direction: 'in' }> | undefined =>
  [...view.messages].reverse().find((m): m is Extract<ThreadMessage, { direction: 'in' }> => m.direction === 'in');

function ThreadDialog({ view, onClose, onReply, labels }: { view: ThreadView | null; onClose: () => void; onReply: (m: OutgoingMessage) => void; labels: OutreachLabels }) {
  const [text, setText] = useState('');
  const last = view ? lastIncoming(view) : undefined;
  const review = () => {
    if (!view || !last || !text.trim()) return;
    onReply({ to: last.from, draft: view.draft || 'reply', subject: replySubject(last.subject), text: text.trim(), ref: view.ref || 'reply', inReplyTo: last.messageId });
    setText('');
  };
  return <Dialog open={view !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{last?.subject ?? labels.inboxTitle}</DialogTitle>
        <DialogDescription>{labels.notAVerifiedSender}</DialogDescription>
      </DialogHeader>
      <div className="flex max-h-80 flex-col gap-2 overflow-auto">{view?.messages.map((m) => <Bubble key={m.id} message={m} labels={labels} />)}</div>
      <Textarea aria-label={labels.reply} placeholder={labels.replyPlaceholder} value={text} maxLength={20000} onChange={(e) => setText(e.target.value)} />
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>{labels.close}</Button>
        <Button disabled={!text.trim() || !last} onClick={review}>{labels.review}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

function ThreadRow({ thread, onOpen, labels }: { thread: InboxThreadRow; onOpen: (t: InboxThreadRow) => void; labels: OutreachLabels }) {
  return <li className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
    <div className="min-w-0">
      <p className="truncate font-medium">{thread.subject}{thread.unread > 0 && <> <Badge>{labels.unread(thread.unread)}</Badge></>}</p>
      <p className="truncate text-muted-foreground">{thread.from} · {labels.formatTime(thread.lastAt)}{thread.ref && <> · {thread.ref}</>}</p>
    </div>
    <Button size="sm" variant="outline" aria-label={`${labels.open} ${thread.subject}`} onClick={() => onOpen(thread)}>{labels.open}</Button>
  </li>;
}

/** The Inbox: replies that came back to the app's address, by thread, linked to the draft and the recipient. A reply goes out through the same confirm dialog. */
export function InboxPanel({ threads, unread, onOpen, onChanged, onPrepare, onSend, labels }: InboxPanelProps) {
  const [view, setView] = useState<ThreadView | null>(null);
  const [reply, setReply] = useState<OutgoingMessage | null>(null);
  const open = async (t: InboxThreadRow) => { setView(await onOpen(t.thread)); onChanged(); };
  return <Card data-testid="inbox">
    <CardHeader>
      <CardTitle>{labels.inboxTitle}{unread > 0 && <> <Badge>{labels.unread(unread)}</Badge></>}</CardTitle>
      <CardDescription>{labels.inboxEmptyDescription}</CardDescription>
    </CardHeader>
    <CardContent>
      {threads.length
        ? <ul className="flex flex-col gap-2">{threads.map((t) => <ThreadRow key={t.thread} thread={t} onOpen={open} labels={labels} />)}</ul>
        : <Empty><EmptyHeader><EmptyTitle>{labels.inboxEmpty}</EmptyTitle><EmptyDescription>{labels.inboxEmptyDescription}</EmptyDescription></EmptyHeader></Empty>}
    </CardContent>
    <ThreadDialog view={reply ? null : view} onClose={() => setView(null)} onReply={setReply} labels={labels} />
    <ConfirmSend message={reply} labels={labels} onPrepare={onPrepare} onSend={onSend}
      onClose={(sent) => { setReply(null); if (sent) { setView(null); onChanged(); } }} />
  </Card>;
}
