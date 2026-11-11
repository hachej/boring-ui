'use client';

import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { ChatDraft } from '@hachej/boring-ui-kit/native-chat';
import { CornerDownRightIcon, EllipsisIcon, ListEndIcon, PencilIcon, RouteIcon, Trash2Icon } from '../_shared/icons';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { TraceIcon, TraceLine, TraceTitle } from '@/components/ui/trace';
import { Button } from '@/components/ui/button';
import { isFileBlock, withoutTarget, type QueuedMessage } from './rows';

/** A pending message shows what the person said, never its leading `<target>` block's raw fields. */
const spoken = withoutTarget;
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
    <DropdownMenuContent side="top" align="end" data-testid="queue-menu" className="pi-chat">
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

/** On touch (D3): a long press on the person's own message. `resume` puts its text back in the field; `rewind` forks the conversation before it. */
export interface OwnMessageActions { readonly resume: (rowKey: string) => void; readonly rewind: (rowKey: string) => void }

/** One of the person's own messages, newest first, with the reply entry a fork before it starts at (none for the first message). */
interface OwnMessage { readonly key: string; readonly text: string; readonly forkAt: string | undefined }
type EditLastRow = { readonly key: string; readonly type: string; readonly message?: unknown; readonly entryId?: string; readonly local?: string };

/** The person's sent messages in a transcript's rows, newest first. */
export function ownMessages(rows: readonly EditLastRow[]): readonly OwnMessage[] {
  const out: OwnMessage[] = [];
  let forkAt: string | undefined;
  for (const row of rows) {
    if (row.type === 'assistant' && row.entryId) forkAt = row.entryId;
    if (row.type !== 'user' || row.local) continue;
    const text = queuedText({ content: (row.message as { content?: unknown } | undefined)?.content } as QueuedMessage).trim();
    if (text) out.push({ key: row.key, text, forkAt });
  }
  return out.reverse();
}

const TWICE_MS = 700;

/**
 * Edit last, the Claude Code way (D-2198, D3; `PiChat composerEditLast`). In the field: ↑ while it is empty recalls the person's earlier
 * messages as a draft (↑ again goes further back, ↓ comes forward; a recalled message is sent as a new one); ↑ or Échap while messages wait
 * in the queue takes the last one back into the field; Échap while the agent works stops it; Échap twice in an empty field lists the person's
 * messages, and a pick forks the conversation before that message (`conversations.fork`, the old conversation is kept) with it in the field.
 * An open `/` or `@` list keeps its own keys.
 */
export function useEditLast({ on, rows, queued, queueActions, working, stop, setText, fork, startNew, focus }: {
  readonly on: boolean;
  readonly rows: readonly EditLastRow[];
  readonly queued: readonly QueuedMessage[];
  readonly queueActions: QueueActions | undefined;
  readonly working: boolean;
  readonly stop: () => void;
  readonly setText: (text: string) => void;
  readonly fork: ((atEntryId: string) => Promise<void>) | undefined;
  readonly startNew: (() => void) | undefined;
  readonly focus: () => void;
}): { readonly onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void; readonly rewind: ReactNode; readonly own: OwnMessageActions } {
  const recall = useRef({ index: -1, text: '' });
  const escapedAt = useRef(0);
  const [listing, setListing] = useState(false);
  const messages = ownMessages(rows);
  const show = (index: number) => {
    const text = index < 0 ? '' : messages[index]!.text;
    recall.current = { index, text };
    setText(text);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!on || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.nativeEvent.isComposing) return;
    const field = event.currentTarget;
    if (field.getAttribute('aria-expanded') === 'true') return;
    const value = field.value;
    const recalled = recall.current.index >= 0 && value === recall.current.text;
    if (!recalled) recall.current = { index: -1, text: '' };
    const last = queued.at(-1);
    const edit = queueActions?.edit;
    if (event.key === 'ArrowUp') {
      if (last && edit && value === '') { event.preventDefault(); void edit(last).catch(() => {}); return; }
      if ((value === '' || recalled) && recall.current.index + 1 < messages.length) { event.preventDefault(); show(recall.current.index + 1); }
      return;
    }
    if (event.key === 'ArrowDown') {
      if (recalled) { event.preventDefault(); show(recall.current.index - 1); }
      return;
    }
    if (event.key !== 'Escape') return;
    if (last && edit) { event.preventDefault(); void edit(last).catch(() => {}); return; }
    if (working) { event.preventDefault(); stop(); return; }
    if (value !== '' || messages.length === 0) { escapedAt.current = 0; return; }
    const now = Date.now();
    if (now - escapedAt.current < TWICE_MS) { event.preventDefault(); escapedAt.current = 0; setListing(true); return; }
    escapedAt.current = now;
  };
  const close = () => { setListing(false); focus(); };
  const pick = (message: OwnMessage) => {
    setListing(false);
    setText(message.text);
    if (message.forkAt && fork) void fork(message.forkAt).catch(() => {});
    else if (!message.forkAt && startNew) startNew();
    focus();
  };
  const rewind = on && listing && messages.length > 0 ? <RewindList messages={messages} onPick={pick} onClose={close} /> : null;
  const byKey = (key: string) => messages.find(message => message.key === key);
  const own: OwnMessageActions = {
    resume: key => { const message = byKey(key); if (message) { setText(message.text); focus(); } },
    rewind: key => { const message = byKey(key); if (message) pick(message); },
  };
  return { onKeyDown, rewind, own };
}

/** Échap twice: the person's messages, newest first, above the field. ↑ ↓ move, Enter picks, Échap closes. */
function RewindList({ messages, onPick, onClose }: { readonly messages: readonly OwnMessage[]; readonly onPick: (message: OwnMessage) => void; readonly onClose: () => void }) {
  const { labels } = useChatText();
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { list.current?.querySelector<HTMLElement>('[data-testid=rewind-item]')?.focus(); }, []);
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return; }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const items = [...(list.current?.querySelectorAll<HTMLElement>('[data-testid=rewind-item]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    items[Math.max(0, Math.min(items.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus();
  };
  return <div className="pb-2"><Card data-testid="rewind-list" size="sm" onKeyDown={move}>
    <CardContent className="flex flex-col gap-1">
      <p className="m-0 text-xs font-medium">{labels.rewindTitle}</p>
      <p className="m-0 text-xs text-muted-foreground">{labels.rewindHint}</p>
      <div ref={list} role="group" aria-label={labels.rewindTitle} className="flex max-h-60 flex-col overflow-y-auto">
        {messages.map(message => <Button key={message.key} type="button" variant="ghost" size="sm" data-testid="rewind-item" onClick={() => onPick(message)} className="justify-start">
          <span className="min-w-0 truncate">{message.text}</span></Button>)}
      </div>
    </CardContent>
  </Card></div>;
}

