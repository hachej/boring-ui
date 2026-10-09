'use client';

import { useEffect, useRef, useState } from 'react';
import type { ChatDraft } from '@hachej/boring-ui-kit/native-chat';
import { CornerDownRightIcon, EllipsisIcon, ListEndIcon, LoaderIcon, PencilIcon, RouteIcon, Trash2Icon } from 'lucide-react';
import { isFileBlock, type QueuedMessage } from './rows';
import { defaultChatLabels, useChatText } from './labels';

export type { QueuedMessage } from './rows';

/** Display text of a queued submission: the text parts of its content, plus a count of images. */
export function queuedText(item: QueuedMessage, imagesLabel: (count: number) => string = defaultChatLabels.images): string {
  const content = item.content as unknown;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts = content as readonly { type?: unknown; text?: unknown }[];
  const text = parts.flatMap(part => part?.type === 'text' && typeof part.text === 'string' && !isFileBlock(part.text) ? [part.text] : []).join('\n');
  const images = parts.filter(part => part?.type === 'image').length;
  return images ? `${text}${text ? '\n' : ''}${imagesLabel(images)}` : text;
}

/** What a queued message can be taken back for. Both take the message out of the queue first and throw when it is too late. */
export interface QueueActions {
  /** Take it out of the queue and put its text (and images) back in the composer. */
  readonly edit?: ((item: QueuedMessage) => Promise<void>) | undefined;
  /** Take it out of the queue and send it into the running turn now. */
  readonly steer?: ((item: QueuedMessage) => Promise<void>) | undefined;
}

const rowButton = 'inline-flex shrink-0 cursor-pointer items-center justify-center gap-1 rounded-lg text-muted-foreground outline-none transition-colors hover:bg-background/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-45 motion-reduce:transition-none';

/** The "…" button of one queued message: a small menu of the secondary actions (Edit). */
function MoreMenu({ disabled, onEdit }: { readonly disabled: boolean; readonly onEdit: () => void }) {
  const { labels } = useChatText();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => { if (root.current && !root.current.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('mousedown', outside); document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape, true); };
  }, [open]);
  return <div ref={root} className="relative shrink-0">
    <button ref={trigger} type="button" data-testid="queue-more" aria-label={labels.moreActions} title={labels.more} aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => setOpen(value => !value)}
      className={`${rowButton} size-8 max-sm:size-10`}><EllipsisIcon className="size-4" aria-hidden="true" /></button>
    {open && <div role="menu" data-testid="queue-menu" className="absolute right-0 bottom-full z-30 mb-1 w-40 rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg">
      <button type="button" role="menuitem" data-testid="queue-edit" autoFocus onClick={() => { setOpen(false); onEdit(); }}
        className="flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-foreground outline-none hover:bg-accent focus-visible:bg-accent max-sm:min-h-10"><PencilIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />{labels.edit}</button>
    </div>}
  </div>;
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
  return <section data-testid="queue" aria-label={labels.queuedMessages} className="relative mx-3 -mb-3 rounded-t-2xl border border-b-0 border-border bg-muted pb-3 text-foreground">
    <ul className="m-0 list-none p-0">
      {items.map((item, index) => {
        const working = busy.has(String(item.id));
        const steering = item.mode === 'steer';
        return <li key={String(item.id)} data-testid="queue-item" data-mode={item.mode} className={`flex min-h-10 items-center gap-1.5 pr-1.5 pl-3 ${index > 0 ? 'border-t border-border/70' : ''}`}>
          {steering ? <RouteIcon className="size-4 shrink-0 text-muted-foreground" aria-label={labels.steering} /> : <ListEndIcon className="size-4 shrink-0 text-muted-foreground" aria-label={labels.queued} />}
          <span data-testid="queue-text" className="min-w-0 flex-1 truncate px-1 text-sm">{queuedText(item, labels.images)}</span>
          {!steering && actions?.steer && <button type="button" data-testid="queue-steer" title={labels.steerHint} disabled={working} onClick={() => { void run(item, () => actions.steer!(item)); }}
            className={`${rowButton} h-8 px-2 text-sm max-sm:h-10 max-sm:px-2.5`}><CornerDownRightIcon className="size-3.5" aria-hidden="true" />{labels.steer}</button>}
          {steering && <span className="shrink-0 px-1 text-xs text-muted-foreground">{labels.steering}</span>}
          <button type="button" data-testid="queue-cancel" aria-label={labels.removeQueued} title={labels.removeHint} disabled={!withdraw || working} onClick={() => { void remove(item); }}
            className={`${rowButton} size-8 max-sm:size-10`}><Trash2Icon className="size-3.5" aria-hidden="true" /></button>
          {actions?.edit && <MoreMenu disabled={working} onEdit={() => { void run(item, () => actions.edit!(item)); }} />}
        </li>;
      })}
      {sending.map((draft, index) => <li key={`sending-${index}`} data-testid="queue-sending" className={`flex min-h-10 items-center gap-1.5 pr-1.5 pl-3 ${items.length + index > 0 ? 'border-t border-border/70' : ''}`}>
        <LoaderIcon className="size-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" aria-label={labels.sending} />
        <span data-testid="queue-text" className="min-w-0 flex-1 truncate px-1 text-sm">{draft.text}{draft.attachments.length ? `${draft.text ? '\n' : ''}${labels.images(draft.attachments.length)}` : ''}</span>
        <span className="shrink-0 px-1 text-xs text-muted-foreground">{labels.sending}</span>
      </li>)}
    </ul>
    {failed && <p role="alert" data-testid="queue-error" className="m-0 border-t border-border/70 px-3 py-2 text-xs text-destructive">{failed}</p>}
  </section>;
}
