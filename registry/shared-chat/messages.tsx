'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { channelAvatarStates } from '@hachej/boring-ui-kit/shared-chat';
import type { Card as Request, ChannelMessage, SharedChatController, Member, SharedChatState } from '@hachej/boring-ui-kit/shared-chat';
import { BotIcon, CircleIcon, ReplyIcon, Trash2Icon, XIcon } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarGroup, AvatarGroupCount, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { relativeTime } from '../pi-chat/history';
import { useChatText } from './text';

function usePhone() {
  const [phone, setPhone] = useState(() => globalThis.matchMedia?.('(max-width: 640px)').matches === true);
  useEffect(() => { const media = globalThis.matchMedia?.('(max-width: 640px)'); if (!media) return; const change = () => setPhone(media.matches); media.addEventListener('change', change); return () => media.removeEventListener('change', change); }, []);
  return phone;
}
const latestCard = (shared: SharedChatState, id: string) => shared.messages.findLast(message => message.author === id && message.card)?.card;
const memberOf = (shared: SharedChatState, id: string): Member => shared.members.find(member => member.id === id) ?? { id, name: id, kind: 'person' };
export function sharedQuote(shared: SharedChatState, id: string | undefined) {
  const message = shared.messages.find(message => message.id === id);
  return message ? { message, author: memberOf(shared, message.author) } : undefined;
}

export function MemberAvatar({ member, card, interactive = true, size = 'default', compact = false }: { readonly member: Member; readonly card?: Request | undefined; readonly interactive?: boolean; readonly size?: ComponentProps<typeof Avatar>['size']; readonly compact?: boolean }) {
  const { labels } = useChatText();
  const phone = usePhone();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    document.addEventListener('scroll', close, true);
    return () => document.removeEventListener('scroll', close, true);
  }, [open]);
  const state = member.kind === 'agent' && card?.state && Object.hasOwn(channelAvatarStates, card.state) ? channelAvatarStates[card.state] ?? 'neutral' : 'neutral';
  const tone = state === 'blocked' ? 'text-destructive' : state === 'waiting' ? 'text-muted-foreground' : 'text-primary';
  const avatar = <Avatar size={compact ? 'sm' : size} data-testid="member-avatar" role="img" aria-label={member.kind === 'agent' ? `${member.name}, ${labels.sharedAgent}` : member.name} data-state={state}>
    {member.avatarUrl && <AvatarImage src={member.avatarUrl} alt={member.name} />}
    <AvatarFallback>{member.kind === 'agent' ? <BotIcon data-lucide="bot" className={compact ? 'size-3' : 'size-4'} aria-hidden="true" /> : member.name.replace(/[()]/g, '').split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase()}</AvatarFallback>
    {state !== 'neutral' && <span data-testid="avatar-indicator" data-state={state} className={`absolute right-0 bottom-0 ${tone}`}>
      <CircleIcon className="size-2 fill-current" aria-hidden="true" />
    </span>}
  </Avatar>;
  if (member.kind !== 'agent' || !card || !interactive) return avatar;
  const trigger = <span role="button" tabIndex={0} className="inline-flex shrink-0" data-testid={`agent-avatar-${member.id}`} data-state={state} aria-label={`${member.name}: ${card.line}`}>{avatar}</span>;
  return phone
    ? <Popover open={open} onOpenChange={setOpen}><PopoverTrigger nativeButton={false} render={trigger} /><PopoverContent data-testid="agent-state-popover" side="bottom" align="start" className="max-w-[calc(100vw-1rem)]">{card.line}</PopoverContent></Popover>
    : <Tooltip><TooltipTrigger render={trigger} /><TooltipContent>{card.line}</TooltipContent></Tooltip>;
}
function MemberBadge({ member }: { readonly member: Member }) {
  const { labels } = useChatText();
  return member.kind === 'admin' ? <Badge data-testid="author-badge" variant="secondary">{labels.sharedAdmin}</Badge> : null;
}
function Dot({ value }: { readonly value: SharedChatState['status'] | Member['presence'] }) {
  return <CircleIcon aria-hidden="true" className={`size-2 fill-current ${value === 'live' || value === 'here' ? 'text-primary' : value === 'offline' ? 'text-destructive' : 'text-muted-foreground'}`} />;
}

/** Mounted in the existing bar. The source owns membership and visibility, including the admin. */
export function SharedMembers({ controller }: { readonly controller: SharedChatController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const { labels } = useChatText();
  const [open, setOpen] = useState(false);
  const phone = usePhone();
  const shared = state.shared;
  if (!shared) return null;
  const name = shared.status === 'live' ? labels.live : shared.status === 'reconnecting' ? labels.reconnecting : labels.sharedOffline;
  const content = <ul data-testid="member-list" className="m-0 flex min-w-0 list-none flex-col gap-3 p-4">
    {shared.members.map(member => <li key={member.id} data-member-id={member.id} className="flex min-w-0 items-center gap-2">
      <MemberAvatar member={member} card={latestCard(shared, member.id)} /><span className="min-w-0 flex-1 truncate">{member.name}</span>
      <Badge variant="secondary">{member.role ?? member.kind}</Badge>
      <span data-testid="presence" data-presence={member.presence ?? 'away'} role="img" aria-label={member.presence === 'here' ? labels.sharedHere : labels.sharedAway}><Dot value={member.presence} /></span>
    </li>)}
  </ul>;
  const stack = <AvatarGroup>{shared.members.slice(0, phone ? 1 : 3).map(member => <MemberAvatar key={member.id} member={member} card={latestCard(shared, member.id)} interactive={false} />)}<AvatarGroupCount>{shared.members.length}</AvatarGroupCount></AvatarGroup>;
  const trigger = <Button variant="ghost" data-testid="shared-members" aria-label={labels.sharedMemberCount(shared.members.length)} aria-haspopup="dialog" aria-expanded={open}>{stack}</Button>;
  return <div className="flex shrink-0 items-center gap-2">
    <span data-testid="shared-connection-announcement" className="sr-only" aria-live="polite" aria-atomic="true">{name}</span>
    {shared.status !== 'live' && <Tooltip><TooltipTrigger render={<span tabIndex={0} data-testid="shared-status" data-status={shared.status} role="img" aria-label={name}><Dot value={shared.status} /></span>} /><TooltipContent>{name}</TooltipContent></Tooltip>}
    {phone ? <><Button variant="ghost" data-testid="shared-members" aria-label={labels.sharedMemberCount(shared.members.length)} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>{stack}</Button>
      {open && <Drawer open onOpenChange={setOpen} showSwipeHandle><DrawerContent className="pi-chat max-h-[80dvh]"><div className="flex shrink-0 items-center justify-between p-4"><DrawerTitle>{labels.sharedMembers}</DrawerTitle><Button variant="ghost" size="icon" data-testid="shared-members-close" aria-label={labels.close} onClick={() => setOpen(false)}><XIcon aria-hidden="true" /></Button></div><div className="min-h-0 overflow-y-auto">{content}</div></DrawerContent></Drawer>}</>
      : <Popover open={open} onOpenChange={setOpen}><PopoverTrigger render={trigger} /><PopoverContent role="dialog" aria-label={labels.sharedMembers} align="end" className="max-w-[calc(100vw-1rem)]">{content}</PopoverContent></Popover>}
  </div>;
}

export function RequestCard({ card, action }: { readonly card: Request; readonly action: (card: Request) => Promise<void> }) {
  const { labels } = useChatText();
  const [busy, setBusy] = useState(false), [error, setError] = useState<string>();
  return <Card data-testid="request-card">
    <CardHeader><CardTitle>{card.title}</CardTitle></CardHeader>
    <CardContent><p className="m-0">{card.line}</p>{card.since && <time dateTime={card.since} className="text-muted-foreground">{labels.sharedSince(relativeTime(card.since, Date.now(), labels))}</time>}{error && <p role="alert">{error}</p>}</CardContent>
    {card.action && <CardFooter><Button disabled={busy} onClick={() => { setBusy(true); setError(undefined); void action(card).catch(error => setError(error instanceof Error ? error.message : labels.actionFailedShort)).finally(() => setBusy(false)); }}>{card.action.label}</Button></CardFooter>}
  </Card>;
}

/** Both the composer chip and the timeline quote use this one parent reference. No thread or routing policy. */
export function ReplyQuote({ targetId, quote, onRemove, onReveal }: { readonly targetId: string; readonly quote: ReturnType<typeof sharedQuote>; readonly onRemove?: () => void; readonly onReveal?: ((messageId: string) => void) | undefined }) {
  const { labels } = useChatText();
  const text = quote?.message.removed ? labels.sharedRemoved : quote?.message.card?.title ?? quote?.message.text?.split(/\r?\n/)[0] ?? labels.sharedEarlierMessage;
  return <div data-testid={onRemove ? 'composer-reply' : 'message-quote'} className="flex w-full min-w-0 items-center gap-1">
    <Button variant="ghost" className="min-w-0 max-w-full justify-start" onClick={event => {
      const chat = event.currentTarget.closest('[data-boring=pi-chat]');
      const parent = [...(chat?.querySelectorAll<HTMLElement>('[data-shared-message]') ?? [])].find(element => element.dataset.sharedMessage === targetId);
      if (parent) parent.scrollIntoView({ block: 'center', behavior: 'instant' }); else onReveal?.(targetId);
    }}><ReplyIcon aria-hidden="true" /><span className="truncate text-muted-foreground">{quote ? `${quote.author.name}: ${text}` : text}</span></Button>
    {onRemove && <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon" data-testid="composer-reply-remove" aria-label={labels.sharedCancelReply} onClick={onRemove}><XIcon aria-hidden="true" /></Button>} /><TooltipContent>{labels.sharedCancelReply}</TooltipContent></Tooltip>}
  </div>;
}

/** Participant metadata surrounds the existing bubbles, Markdown, cards and tool trace. */
export function SharedMessage({ shared, children, remove, canRemove, openFile, onReply, onReveal }: {
  readonly shared: SharedItem; readonly children: ReactNode;
  readonly remove?: ((message: ChannelMessage) => Promise<void>) | undefined;
  readonly canRemove?: ((message: ChannelMessage) => boolean) | undefined;
  readonly openFile?: ((path: string) => void) | undefined;
  readonly onReply?: ((messageId: string) => void) | undefined;
  readonly onReveal?: ((messageId: string) => void) | undefined;
}) {
  const { labels } = useChatText();
  const [error, setError] = useState<string>();
  const [actionsOpen, setActionsOpen] = useState(false);
  const phone = usePhone();
  const element = useRef<HTMLDivElement>(null);
  const press = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const start = useRef<{ x: number; y: number } | undefined>(undefined);
  const cancelPress = () => { clearTimeout(press.current); start.current = undefined; };
  useEffect(() => cancelPress, []);
  useEffect(() => {
    if (!actionsOpen) return;
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !element.current?.contains(event.target)) setActionsOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [actionsOpen]);
  const { message, author, first, own, lastBubble } = shared;
  const replyable = Boolean(onReply && ((author.kind === 'agent' && !message.via) || message.card));
  const removable = Boolean(remove && canRemove?.(message));
  const actionable = !message.removed && (replyable || removable);
  const heading = first && !own && <div data-testid="message-author-row" className="ml-8 flex min-w-0 items-center gap-2">
    <div className="flex min-w-0 items-center gap-2">
      <span data-testid="message-author" className="min-w-0 truncate text-sm text-muted-foreground">{author.name}</span>
      {message.via && <span data-testid="message-via" className={`min-w-0 truncate text-muted-foreground${own ? '' : ' text-sm'}`}>{labels.sharedVia(message.via)}</span>}
      {!(message.via && author.kind === 'agent') && <MemberBadge member={author} />}
    </div>
  </div>;
  const body = <>
    {message.replyTo && <ReplyQuote targetId={message.replyTo} quote={shared.quote} onReveal={onReveal} />}
    {message.removed ? <p className="text-muted-foreground">{labels.sharedRemoved}</p> : children}
  </>;
  return <div ref={element} data-shared-message={message.id} className="group/shared-message relative flex min-w-0 flex-col gap-1"
    onPointerDown={event => {
      if (!phone || !actionable || event.pointerType !== 'touch' || event.target instanceof Element && event.target.closest('button, a, input, textarea, [role=button], [role=link]')) return;
      cancelPress(); start.current = { x: event.clientX, y: event.clientY };
      press.current = setTimeout(() => setActionsOpen(true), 400);
    }}
    onPointerMove={event => { if (start.current && (Math.abs(event.clientX - start.current.x) > 8 || Math.abs(event.clientY - start.current.y) > 8)) cancelPress(); }}
    onPointerUp={cancelPress} onPointerCancel={cancelPress}
    onContextMenu={event => { if (phone && actionable && event.target instanceof Element && !event.target.closest('button, a, input, textarea, [role=button], [role=link]')) { event.preventDefault(); setActionsOpen(true); } }}>
    {heading}
    <div className="flex min-w-0 items-end gap-2">
    {!own && <div data-testid="message-avatar" className="flex w-6 shrink-0 items-end">{lastBubble && <MemberAvatar member={author} card={message.via ? undefined : shared.latestCard} size="sm" />}</div>}
    <div data-testid="shared-message-content" className="flex min-w-0 flex-1 flex-col gap-1">
    {body}
    {!message.removed && message.attachments?.map(file => <Button key={file.path} variant="outline" disabled={!openFile} onClick={() => openFile?.(file.path)} className="max-w-full justify-start"><span className="truncate">{file.title ?? file.path}</span></Button>)}
    {error && <p role="alert">{error}</p>}
    </div></div>
    {actionable && <div data-testid="shared-message-actions" hidden={phone && !actionsOpen} className={`absolute right-0 top-0 ${phone && !actionsOpen ? 'hidden' : 'flex'} items-center gap-1${phone ? '' : ' opacity-0 group-hover/shared-message:opacity-100 group-focus-within/shared-message:opacity-100'}`}>
      {replyable && onReply && <Tooltip><TooltipTrigger render={<Button variant="ghost" size={phone ? 'icon' : 'icon-xs'} data-testid="shared-reply" aria-label={labels.sharedReply} onClick={() => { setActionsOpen(false); onReply(message.id); }}><ReplyIcon aria-hidden="true" /></Button>} /><TooltipContent>{labels.sharedReply}</TooltipContent></Tooltip>}
      {removable && remove && <Tooltip><TooltipTrigger render={<Button variant="ghost" size={phone ? 'icon' : 'icon-xs'} aria-label={labels.delete} onClick={() => { void remove(message).catch(error => setError(error instanceof Error ? error.message : labels.actionFailedShort)); }}><Trash2Icon aria-hidden="true" /></Button>} /><TooltipContent>{labels.delete}</TooltipContent></Tooltip>}
    </div>}
  </div>;
}

export interface SharedItem {
  readonly key: string; readonly message: ChannelMessage; readonly author: Member; readonly own: boolean; readonly first: boolean; readonly lastBubble: boolean; readonly separator: boolean;
  readonly showSpinner: boolean; readonly latestCard: Request | undefined; readonly quote: ReturnType<typeof sharedQuote>;
}
export function sharedItems(shared: SharedChatState): SharedItem[] {
  const working = new Map(shared.messages.filter(message => message.streaming).map(message => [message.author, message.id]));
  const groups: ChannelMessage[][] = [];
  for (const message of shared.messages) {
    const group = groups.at(-1), previous = group?.at(-1);
    const elapsed = previous ? Date.parse(message.at) - Date.parse(previous.at) : NaN;
    if (group && previous?.author === message.author && previous.via === message.via && elapsed >= 0 && elapsed <= 15 * 60_000) group.push(message);
    else groups.push([message]);
  }
  return groups.flatMap((group, groupIndex) => {
    // Trailing request cards attach beneath the group; the avatar stays beside its last text bubble.
    const lastBubble = group.findLast(message => !message.card) ?? group.at(-1);
    return group.map((message, index): SharedItem => {
      const previous = index > 0 ? group[index - 1] : groups[groupIndex - 1]?.at(-1);
      return { key: `shared:${message.id}`, message, author: memberOf(shared, message.author), own: message.author === shared.me.id,
        first: index === 0, lastBubble: message === lastBubble,
        separator: !previous || Date.parse(message.at) - Date.parse(previous.at) > 15 * 60_000,
        showSpinner: working.get(message.author) === message.id, latestCard: latestCard(shared, message.author), quote: sharedQuote(shared, message.replyTo) };
    });
  });
}
