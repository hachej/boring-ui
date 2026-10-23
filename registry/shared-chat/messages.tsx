'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { cardActions, channelAvatarStates } from '@hachej/boring-ui-kit/shared-chat';
import type { Card as Request, ChannelMessage, SharedChatController, Member, SharedChatState } from '@hachej/boring-ui-kit/shared-chat';
import { CircleIcon, PinIcon, ReplyIcon, SparkleIcon, Trash2Icon, XIcon } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarGroup, AvatarGroupCount, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { Separator } from '@/components/ui/separator';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useChatText } from './text';

// Text shares one treatment across headings and muted bubbles; only AA-qualified default palette entries colour it.
const agentTones = [
  { token: 'chart-1', icon: 'text-chart-1', text: 'text-foreground' },
  { token: 'chart-2', icon: 'text-chart-2', text: 'text-foreground dark:text-chart-2' },
  { token: 'chart-3', icon: 'text-chart-3', text: 'text-chart-3' },
  { token: 'chart-4', icon: 'text-chart-4', text: 'text-foreground' },
  { token: 'chart-5', icon: 'text-chart-5', text: 'text-foreground' },
];
export function agentTone(member: Pick<Member, 'id' | 'kind'>) {
  if (member.kind !== 'agent') return undefined;
  let hash = 0;
  for (const character of member.id) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
  return agentTones[hash % agentTones.length];
}

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

/** Only https, `data:image/`, `blob:` and same-origin relative addresses load; anything else falls back to the initials. */
export function safeAvatarUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  return /^(?:https:\/\/|data:image\/|blob:)/i.test(url) || /^\/(?![/\\])/.test(url) ? url : undefined;
}

/** People show initials; agents a clean sparkle glyph in their chart token. `indicator={false}` drops the card-state dot (the timeline). */
export function MemberAvatar({ member, card, interactive = true, size = 'default', compact = false, indicator = true }: { readonly member: Member; readonly card?: Request | undefined; readonly interactive?: boolean; readonly size?: ComponentProps<typeof Avatar>['size']; readonly compact?: boolean; readonly indicator?: boolean }) {
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
  const agent = agentTone(member);
  const avatarSrc = safeAvatarUrl(member.avatarUrl);
  const avatar = <Avatar size={compact ? 'sm' : size} data-agent-color={agent?.token} data-testid="member-avatar" role="img" aria-label={member.kind === 'agent' ? `${member.name}, ${labels.sharedAgent}` : member.name} data-state={state}>
    {avatarSrc && <AvatarImage src={avatarSrc} alt={member.name} />}
    <AvatarFallback>{member.kind === 'agent' ? <SparkleIcon data-lucide="sparkle" className={`${compact ? 'size-3' : 'size-3.5'} fill-current ${agent?.icon ?? ''}`} aria-hidden="true" /> : member.name.replace(/[()]/g, '').split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase()}</AvatarFallback>
    {indicator && state !== 'neutral' && <span data-testid="avatar-indicator" data-state={state} className={`absolute right-0 bottom-0 ${tone}`}>
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

/** WhatsApp's tail on the first bubble of a group. Its square part fills the bubble's top corner under the (positioned) content. */
export function BubbleTail({ side }: { readonly side: 'start' | 'end' }) {
  return <svg data-testid="bubble-tail" data-side={side} aria-hidden="true" viewBox="0 0 22 14" width="22" height="14"
    className={`pointer-events-none absolute top-0 ${side === 'end' ? '-end-2 -scale-x-100 fill-primary' : '-start-2 fill-muted'}`}><path d="M0 0H22V14H8V9C8 5 5 2 0 0Z" /></svg>;
}

/** Text whose last line leaves room for the time at the bottom right of the bubble (the spacer rides at the end of the last paragraph). */
export const clockRoom = "[&_:is(p,li):last-child]:after:inline-block [&_:is(p,li):last-child]:after:w-14 [&_:is(p,li):last-child]:after:content-['']";

/** The time inside a bubble (« 14:02 »). `floating` pins it bottom right over the room the text left; otherwise it sits in the line. */
export function MessageClock({ at, tone, floating = true }: { readonly at: string; readonly tone: 'muted' | 'primary'; readonly floating?: boolean }) {
  const { labels } = useChatText();
  return <time data-testid="message-time" dateTime={at} title={labels.sharedTimestamp(at)}
    className={`${floating ? 'absolute end-3 bottom-1.5' : 'shrink-0 self-end'} text-[0.6875rem] leading-none whitespace-nowrap tabular-nums ${tone === 'primary' ? 'opacity-80' : 'text-muted-foreground'}`}>{labels.sharedClock(at)}</time>;
}
/** Room for a floating clock after plain inline text. */
export const ClockSpacer = () => <span aria-hidden="true" className="inline-block w-14" />;

/** The member's role line: the host's own `roleLabel`, else the labels' derivation from kind and role. */
export function useRoleLine(member: Member): string | undefined {
  const { labels } = useChatText();
  return member.roleLabel?.trim() || labels.sharedRole(member);
}

/** The author's name on the first bubble of a group in a multi-person channel. Its role shows only on tap (or keyboard), never as a line. */
export function AuthorName({ member, via }: { readonly member: Member; readonly via?: string | undefined }) {
  const { labels } = useChatText();
  const role = useRoleLine(member);
  const tone = agentTone(member);
  const name = <span data-testid="message-author" data-agent-color={tone?.token} className={`min-w-0 truncate text-xs font-medium ${tone?.text ?? 'text-muted-foreground'}`}>{member.name}</span>;
  return <div data-testid="message-author-row" className="flex min-w-0 items-center gap-1.5 pb-0.5">
    {role && !(via && member.kind === 'agent')
      ? <Popover><PopoverTrigger nativeButton={false} render={<span role="button" tabIndex={0} data-testid="message-author-toggle" aria-label={`${member.name} · ${role}`} className="-my-3.5 inline-flex min-h-11 min-w-11 cursor-pointer items-center" />}>{name}</PopoverTrigger>
        <PopoverContent data-testid="message-role" side="top" align="start" className="w-auto max-w-[calc(100vw-2rem)]">{member.name} · {role}</PopoverContent></Popover>
      : name}
    {via && <span data-testid="message-via" className="min-w-0 truncate text-xs text-muted-foreground">{labels.sharedVia(via)}</span>}
    {!(via && member.kind === 'agent') && <MemberBadge member={member} />}
  </div>;
}

/**
 * A request inside its bubble: one title line, one muted line with the time, and the choices as text buttons along the bottom
 * (« Try · Later »). The primary choice takes the theme's primary colour; no border box.
 */
export function RequestCard({ card, action, at, own = false }: { readonly card: Request; readonly action: (card: Request, actionId?: string) => Promise<void>; readonly at?: string | undefined; readonly own?: boolean }) {
  const { labels } = useChatText();
  const [busy, setBusy] = useState<string>(), [error, setError] = useState<string>();
  const actions = cardActions(card);
  const run = (id: string) => {
    setBusy(id); setError(undefined);
    void action(card, id).catch(error => setError(error instanceof Error ? error.message : labels.actionFailedShort)).finally(() => setBusy(undefined));
  };
  return <section data-testid="request-card" aria-label={card.title} className="flex min-w-0 flex-col text-start">
    <p data-testid="request-title" className="m-0 truncate font-medium">{card.title}</p>
    <div className="flex min-w-0 items-baseline gap-3">
      <p data-testid="request-line" className={`m-0 min-w-0 flex-1 truncate ${own ? 'opacity-80' : 'text-muted-foreground'}`}>{card.line}</p>
      {at && <MessageClock at={at} tone={own ? 'primary' : 'muted'} floating={false} />}
    </div>
    {error && <p role="alert" className="m-0 text-destructive">{error}</p>}
    {actions.length > 0 && <>
      <Separator className="mt-2" />
      <div role="group" aria-label={card.title} className="-mx-3 -mb-2 flex min-w-0">
        {actions.map((choice, index) => {
          const primary = (choice.variant ?? (index === 0 ? 'primary' : 'secondary')) === 'primary';
          return <span key={choice.id} className={`contents ${primary && !own ? 'text-primary' : ''}`}>
            <Button data-testid="request-action" data-action={choice.id} data-action-variant={primary ? 'primary' : 'secondary'} variant="ghost" className="min-h-11 min-w-0 flex-1"
              disabled={busy !== undefined} aria-busy={busy === choice.id || undefined} onClick={() => run(choice.id)}><span className="truncate">{choice.label}</span></Button>
          </span>;
        })}
      </div>
    </>}
  </section>;
}

/** A comment pinned on a spot: a compact quoted reply, a pin and where it is, then the comment itself. */
export function PinnedComment({ card, own, at }: { readonly card: Request; readonly own: boolean; readonly at?: string | undefined }) {
  const { labels } = useChatText();
  return <section data-testid="pinned-comment" aria-label={`${labels.sharedPinned}: ${card.title}`} className="flex min-w-0 flex-col gap-1">
    <div data-testid="pin-quote" className="flex min-w-0 items-stretch gap-2">
      <span aria-hidden="true" className="w-0.5 shrink-0 bg-current opacity-50" />
      <span className={`flex min-w-0 items-center gap-1 text-xs ${own ? 'opacity-80' : 'text-muted-foreground'}`}><PinIcon aria-hidden="true" className="size-3 shrink-0" /><span className="truncate">{card.line}</span></span>
    </div>
    <p className="m-0 whitespace-pre-wrap">{card.title}{at && <ClockSpacer />}</p>
    {at && <MessageClock at={at} tone={own ? 'primary' : 'muted'} />}
  </section>;
}

/** Both the composer chip and the in-bubble quote use this one parent reference. No thread or routing policy. */
export function ReplyQuote({ targetId, quote, onRemove, onReveal }: { readonly targetId: string; readonly quote: ReturnType<typeof sharedQuote>; readonly onRemove?: () => void; readonly onReveal?: ((messageId: string) => void) | undefined }) {
  const { labels } = useChatText();
  const text = quote?.message.removed ? labels.sharedRemoved : quote?.message.card?.title ?? quote?.message.text?.split(/\r?\n/)[0] ?? labels.sharedEarlierMessage;
  const reveal = (event: { readonly currentTarget: Element }) => {
    const chat = event.currentTarget.closest('[data-boring=pi-chat]');
    const parent = [...(chat?.querySelectorAll<HTMLElement>('[data-shared-message]') ?? [])].find(element => element.dataset.sharedMessage === targetId);
    if (parent) parent.scrollIntoView({ block: 'center', behavior: 'instant' }); else onReveal?.(targetId);
  };
  if (!onRemove) return <div data-testid="message-quote" className="-ms-1 flex min-w-0 items-stretch gap-1 pb-1">
    <span aria-hidden="true" className="ms-1 w-0.5 shrink-0 bg-current opacity-50" />
    <Button variant="ghost" size="sm" className="min-w-0 max-w-full justify-start" onClick={reveal}><span className="truncate opacity-80">{quote ? `${quote.author.name}: ${text}` : text}</span></Button>
  </div>;
  return <div data-testid="composer-reply" className="flex w-full min-w-0 items-center gap-1">
    <Button variant="ghost" className="min-w-0 max-w-full justify-start" onClick={reveal}><ReplyIcon aria-hidden="true" /><span className="truncate text-muted-foreground">{quote ? `${quote.author.name}: ${text}` : text}</span></Button>
    <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon" data-testid="composer-reply-remove" aria-label={labels.sharedCancelReply} onClick={onRemove}><XIcon aria-hidden="true" /></Button>} /><TooltipContent>{labels.sharedCancelReply}</TooltipContent></Tooltip>
  </div>;
}

/** Host notices in a row: the latest line, small and centred; the earlier ones open on demand. */
export function SystemLines({ lines }: { readonly lines: readonly ChannelMessage[] }) {
  const { labels } = useChatText();
  const [open, setOpen] = useState(false);
  const shown = open ? lines : lines.slice(-1);
  return <div data-testid="system-lines" data-count={lines.length} role="group" className="flex min-w-0 flex-col items-center gap-0.5 text-center text-xs text-muted-foreground">
    {shown.map(line => <p key={line.id} data-shared-message={line.id} data-testid="system-line" className="m-0 max-w-[85%] [overflow-wrap:anywhere]">{line.removed ? labels.sharedRemoved : line.text}</p>)}
    {lines.length > 1 && <Button variant="ghost" size="sm" data-testid="system-lines-toggle" aria-expanded={open} className="max-sm:min-h-11 pointer-coarse:min-h-11" onClick={() => setOpen(value => !value)}>
      {open ? labels.sharedFewerUpdates : labels.sharedMoreUpdates(lines.length - 1)}</Button>}
  </div>;
}

/** The row around one bubble: the avatar slot in multi-person channels, Reply and Delete on hover, focus or long-press. */
export function SharedMessage({ shared, children, avatars = true, remove, canRemove, openFile, onReply }: {
  readonly shared: SharedItem; readonly children: ReactNode;
  /** Multi-person channel: an avatar beside the last bubble of each group (and a slot keeping the others aligned). */
  readonly avatars?: boolean;
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
  const { message, author, own, lastItem } = shared;
  const replyable = Boolean(onReply && ((author.kind === 'agent' && !message.via) || message.card));
  const removable = Boolean(remove && canRemove?.(message));
  const actionable = !message.removed && (replyable || removable);
  return <div ref={element} data-shared-message={message.id} data-own={own ? 'true' : undefined} className="group/shared-message relative flex min-w-0 flex-col"
    tabIndex={phone && actionable ? 0 : undefined} aria-keyshortcuts={phone && actionable ? 'Shift+F10' : undefined}
    onKeyDown={event => {
      if (!phone || !actionable) return;
      if (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey) { event.preventDefault(); setActionsOpen(true); }
      if (event.key === 'Escape') { setActionsOpen(false); element.current?.focus(); }
    }}
    onPointerDown={event => {
      if (!phone || !actionable || event.pointerType !== 'touch' || event.target instanceof Element && event.target.closest('button, a, input, textarea, [role=button], [role=link]')) return;
      cancelPress(); start.current = { x: event.clientX, y: event.clientY };
      press.current = setTimeout(() => setActionsOpen(true), 400);
    }}
    onPointerMove={event => { if (start.current && (Math.abs(event.clientX - start.current.x) > 8 || Math.abs(event.clientY - start.current.y) > 8)) cancelPress(); }}
    onPointerUp={cancelPress} onPointerCancel={cancelPress}
    onContextMenu={event => { if (phone && actionable && event.target instanceof Element && !event.target.closest('button, a, input, textarea, [role=button], [role=link]')) { event.preventDefault(); setActionsOpen(true); } }}>
    <div className="flex min-w-0 items-end gap-2.5">
    {!own && avatars && <div data-testid="message-avatar" className="flex w-6 shrink-0 items-end">{lastItem && <MemberAvatar member={author} size="sm" interactive={false} indicator={false} />}</div>}
    <div data-testid="shared-message-content" className={`flex min-w-0 flex-1 flex-col gap-1${own ? ' [&>button]:self-end' : ''}`}>
    {message.removed ? <p className="m-0 text-sm text-muted-foreground italic">{labels.sharedRemoved}</p> : children}
    {!message.removed && message.attachments?.map(file => <Button key={file.path} variant="outline" disabled={!openFile} onClick={() => openFile?.(file.path)} className="max-w-full justify-start"><span className="truncate">{file.title ?? file.path}</span></Button>)}
    {error && <p role="alert">{error}</p>}
    </div></div>
    {actionable && <div data-testid="shared-message-actions" hidden={phone && !actionsOpen} className={`absolute ${own ? 'left-0' : 'right-0'} top-0 ${phone && !actionsOpen ? 'hidden' : 'flex'} items-center gap-1${phone ? '' : ' opacity-0 group-hover/shared-message:opacity-100 group-focus-within/shared-message:opacity-100'}`}>
      {replyable && onReply && <Tooltip><TooltipTrigger render={<Button variant="ghost" size={phone ? 'icon' : 'icon-xs'} data-testid="shared-reply" aria-label={labels.sharedReply} onClick={() => { setActionsOpen(false); onReply(message.id); }}><ReplyIcon aria-hidden="true" /></Button>} /><TooltipContent>{labels.sharedReply}</TooltipContent></Tooltip>}
      {removable && remove && <Tooltip><TooltipTrigger render={<Button variant="ghost" size={phone ? 'icon' : 'icon-xs'} aria-label={labels.delete} onClick={() => { void remove(message).catch(error => setError(error instanceof Error ? error.message : labels.actionFailedShort)); }}><Trash2Icon aria-hidden="true" /></Button>} /><TooltipContent>{labels.delete}</TooltipContent></Tooltip>}
    </div>}
  </div>;
}

export interface SharedItem {
  readonly key: string; readonly message: ChannelMessage; readonly author: Member; readonly own: boolean; readonly first: boolean; readonly lastItem: boolean;
  /** The first message of a calendar day: a day pill goes before it. */
  readonly separator: boolean;
  /** A run of consecutive host notices (`kind: 'system'`), shown as one collapsed item; `message` is its latest line. */
  readonly system?: readonly ChannelMessage[] | undefined;
  readonly showSpinner: boolean; readonly latestCard: Request | undefined; readonly quote: ReturnType<typeof sharedQuote>;
}
const dayOf = (at: string) => { const date = new Date(at); return Number.isFinite(date.getTime()) ? date.toDateString() : at; };
/**
 * WhatsApp's grouping: one author (and `via`) within fifteen minutes on the same day is a group; host notices end a group and
 * collapse together. Each day starts with a day pill.
 */
export function sharedItems(shared: SharedChatState): SharedItem[] {
  const working = new Map(shared.messages.filter(message => message.streaming).map(message => [message.author, message.id]));
  const groups: ChannelMessage[][] = [];
  for (const message of shared.messages) {
    const group = groups.at(-1), previous = group?.at(-1);
    const elapsed = previous ? Date.parse(message.at) - Date.parse(previous.at) : NaN;
    const sameDay = previous !== undefined && dayOf(previous.at) === dayOf(message.at);
    const system = message.kind === 'system';
    if (group && previous && sameDay && (system ? previous.kind === 'system'
      : previous.kind !== 'system' && previous.author === message.author && previous.via === message.via && elapsed >= 0 && elapsed <= 15 * 60_000)) group.push(message);
    else groups.push([message]);
  }
  return groups.flatMap((group, groupIndex): SharedItem[] => {
    const before = groups[groupIndex - 1]?.at(-1);
    const separator = !before || dayOf(before.at) !== dayOf(group[0]!.at);
    if (group[0]!.kind === 'system') {
      const message = group.at(-1)!;
      return [{ key: `shared:${group[0]!.id}`, message, author: memberOf(shared, message.author), own: false, first: true, lastItem: true, separator, system: group,
        showSpinner: false, latestCard: undefined, quote: undefined }];
    }
    const lastItem = group.at(-1);
    return group.map((message, index): SharedItem => ({ key: `shared:${message.id}`, message, author: memberOf(shared, message.author), own: message.author === shared.me.id,
      first: index === 0, lastItem: message === lastItem, separator: index === 0 && separator,
      showSpinner: working.get(message.author) === message.id, latestCard: latestCard(shared, message.author), quote: sharedQuote(shared, message.replyTo) }));
  });
}
