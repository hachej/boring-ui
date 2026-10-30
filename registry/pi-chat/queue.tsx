'use client';

import { useState } from 'react';
import type { ChatDraft } from '@hachej/boring-ui-kit/native-chat';
import { CornerDownRightIcon, EllipsisIcon, ListEndIcon, PencilIcon, RouteIcon, Trash2Icon } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { TraceIcon, TraceLine, TraceTitle } from '@/components/ui/trace';
import { Button } from '@/components/ui/button';
import { isFileBlock, targetContent, type QueuedMessage } from './rows';

/** A pending message shows what the person said, never its leading `<target>` block's raw fields. */
const spoken = (text: string): string => targetContent(text)?.speech ?? text;
import { defaultChatLabels, useChatText } from './labels';

export type { QueuedMessage } from './rows';

/** Display text of a queued submission: the text parts of its content, plus a count of images. */
export function queuedText(item: QueuedMessage, imagesLabel: (count: number) => string = defaultChatLabels.images): string {
  const content = item.content as unknown;
  if (typeof content === 'string') return spoken(content);
  if (!Array.isArray(content)) return '';
  const parts = content as readonly { type?: unknown; text?: unknown }[];
  const text = parts.flatMap(part => part?.type === 'text' && typeof part.text === 'string' && !isFileBlock(part.text) ? [spoken(part.text)] : []).join('\n');
  const images = parts.filter(part => part?.type === 'image').length;
  return images ? `${text}${text ? '\n' : ''}${imagesLabel(images)}` : text;
}

/** What a queued message can be taken back for. Both take the message out of the queue first and throw when it is too late. */
export type { QueueActions } from '@hachej/boring-ui-kit/chat-react';
import type { QueueActions } from '@hachej/boring-ui-kit/chat-react';

/** The "…" button of one queued message: a small menu of the secondary actions (Edit). */
function QueueEditAction({ disabled, onEdit }: { readonly disabled: boolean; readonly onEdit: () => void }) {
  const { labels } = useChatText();
  return <DropdownMenu>
    <DropdownMenuTrigger render={<Button variant="ghost" size="icon" />} data-testid="queue-more" aria-label={labels.moreActions} title={labels.more} disabled={disabled}>
      <EllipsisIcon data-icon="inline-start" aria-hidden="true" />
    </DropdownMenuTrigger>
    <DropdownMenuContent side="top" align="end" data-testid="queue-menu">
      <DropdownMenuGroup><DropdownMenuItem data-testid="queue-edit" onClick={onEdit}><PencilIcon aria-hidden="true" />{labels.edit}</DropdownMenuItem></DropdownMenuGroup>
    </DropdownMenuContent>
  </DropdownMenu>;
}

/**
 * Messages sent while the agent was working, waiting for Pi to place them, drawn as a slim tab tucked behind the top edge of the composer
 * (render it directly above `Composer`; the composer overlaps its bottom). One row per message: icon, text, Steer, remove and a "…" menu
 * (Edit). The choice is made here, per message, never in the composer. Rows leave on their own once Pi starts them. `sending` are messages
 * sent from the composer that wait for the previous send to be confirmed (the controller's `outbox`): shown last, without actions.
 */
export function MessageQueue({ items, sending = [], withdraw, actions }: {
  readonly items: readonly QueuedMessage[];
  readonly sending?: readonly ChatDraft[] | undefined;
  readonly withdraw?: ((id: QueuedMessage['id']) => Promise<unknown>) | undefined;
  readonly actions?: QueueActions | undefined;
}) {
  const { labels } = useChatText();
  const [failed, setFailed] = useState<string | undefined>();
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  if (!items.length && !sending.length) return null;
  async function run(item: QueuedMessage, work: () => Promise<unknown>) {
    const id = String(item.id);
    setFailed(undefined); setBusy(current => new Set(current).add(id));
    try { await work(); }
    catch (cause) { setFailed(cause instanceof Error ? cause.message : labels.queueFailed); }
    finally { setBusy(current => { const next = new Set(current); next.delete(id); return next; }); }
  }
  const remove = (item: QueuedMessage) => run(item, async () => {
    const outcome = await withdraw!(item.id);
    if (outcome === 'already_placed' || outcome === 'settled') throw new Error(labels.tooLateToRemove);
  });
  return <section data-testid="queue" aria-label={labels.queuedMessages} className="relative mx-3 -mb-3 pb-3">
    <Card size="sm"><CardContent><ul className="m-0 flex list-none flex-col p-0">
      {items.map(item => {
        const working = busy.has(String(item.id));
        const steering = item.mode === 'steer';
        return <li key={String(item.id)} data-testid="queue-item" data-mode={item.mode} className="flex min-h-10 items-center gap-1.5">
          <TraceLine status="pending" className="min-w-0 flex-1">
            <TraceIcon>{steering ? <RouteIcon /> : <ListEndIcon />}</TraceIcon>
            <TraceTitle><span className="sr-only">{steering ? labels.steering : labels.queued}: </span><span data-testid="queue-text">{queuedText(item, labels.images)}</span></TraceTitle>
          </TraceLine>
          {!steering && actions?.steer && <Button variant="ghost" size="icon" data-testid="queue-steer" aria-label={labels.steer} title={labels.steerHint} disabled={working} onClick={() => { void run(item, () => actions.steer!(item)); }}>
            <CornerDownRightIcon data-icon="inline-start" aria-hidden="true" /></Button>}
          <Button variant="ghost" size="icon" data-testid="queue-cancel" aria-label={labels.removeQueued} title={labels.removeHint} disabled={!withdraw || working} onClick={() => { void remove(item); }}>
            <Trash2Icon data-icon="inline-start" aria-hidden="true" /></Button>
          {actions?.edit && <QueueEditAction disabled={working} onEdit={() => { void run(item, () => actions.edit!(item)); }} />}
        </li>;
      })}
      {sending.map((draft, index) => <li key={`sending-${index}`} data-testid="queue-sending" className="flex min-h-10 items-center gap-1.5">
        <TraceLine status="running" className="min-w-0 flex-1">
          <TraceIcon><Spinner aria-hidden="true" /></TraceIcon>
          <TraceTitle data-testid="queue-text">{spoken(draft.text)}{draft.attachments.length ? `${draft.text ? '\n' : ''}${labels.images(draft.attachments.length)}` : ''}</TraceTitle>
        </TraceLine>
        <span className="shrink-0 px-1 text-xs text-muted-foreground">{labels.sending}</span>
      </li>)}
    </ul></CardContent></Card>
    {failed && <Alert variant="destructive" data-testid="queue-error"><AlertDescription>{failed}</AlertDescription></Alert>}
  </section>;
}
