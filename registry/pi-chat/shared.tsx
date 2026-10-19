'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import type { Card as Request, ChannelMessage, ChatController, Member, SharedChatState } from '@hachej/boring-ui-kit/shared-chat';
import { CircleIcon, Trash2Icon } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarGroup, AvatarGroupCount, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Row } from './rows';
import { relativeTime } from './history';
import { useChatText } from './labels';

export function MemberAvatar({ member }: { readonly member: Member }) {
  return <Avatar data-testid="member-avatar" aria-label={member.name}>
    {member.avatarUrl && <AvatarImage src={member.avatarUrl} alt={member.name} />}
    <AvatarFallback>{member.name.split(/\s+/).slice(0, 2).map(word => word[0]).join('')}</AvatarFallback>
  </Avatar>;
}
function MemberBadge({ member }: { readonly member: Member }) {
  const { labels } = useChatText();
  return member.kind === 'person' ? null : <Badge data-testid="author-badge" variant={member.kind === 'admin' ? 'secondary' : 'default'}>{member.kind === 'admin' ? labels.sharedAdmin : labels.sharedAgent}</Badge>;
}
function Dot({ value }: { readonly value: SharedChatState['status'] | Member['presence'] }) {
  return <CircleIcon aria-hidden="true" className={`size-2 fill-current ${value === 'live' || value === 'here' ? 'text-primary' : value === 'offline' ? 'text-destructive' : 'text-muted-foreground'}`} />;
}

/** Mounted in PiChat's header or AgentWorkspace's existing embedded bar, never a new navigation panel. */
export function SharedMembers({ controller }: { readonly controller: ChatController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const { labels } = useChatText();
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState(() => globalThis.matchMedia?.('(max-width: 640px)').matches === true);
  useEffect(() => { const media = globalThis.matchMedia?.('(max-width: 640px)'); if (!media) return; const change = () => setPhone(media.matches); media.addEventListener('change', change); return () => media.removeEventListener('change', change); }, []);
  const shared = state.shared;
  if (!shared) return null;
  const name = shared.status === 'live' ? labels.live : shared.status === 'reconnecting' ? labels.reconnecting : labels.sharedOffline;
  const content = <ul data-testid="member-list" className="m-0 flex min-w-0 list-none flex-col gap-3 p-4">
    {shared.members.map(member => <li key={member.id} data-member-id={member.id} className="flex min-w-0 items-center gap-2">
      <MemberAvatar member={member} /><span className="min-w-0 flex-1 truncate">{member.name}</span>
      <Badge variant="secondary">{member.role ?? member.kind}</Badge>
      <span data-testid="presence" data-presence={member.presence ?? 'away'} role="img" aria-label={member.presence === 'here' ? labels.sharedHere : labels.sharedAway}><Dot value={member.presence} /></span>
    </li>)}
  </ul>;
  const trigger = <Button variant="ghost" data-testid="shared-members" aria-label={labels.sharedMemberCount(shared.members.length)} aria-haspopup="dialog" aria-expanded={open}>
    <AvatarGroup>{shared.members.slice(0, phone ? 1 : 3).map(member => <MemberAvatar key={member.id} member={member} />)}<AvatarGroupCount>{shared.members.length}</AvatarGroupCount></AvatarGroup>
  </Button>;
  return <div className="flex shrink-0 items-center gap-2">
    <Tooltip><TooltipTrigger render={<span tabIndex={0} data-testid="shared-status" data-status={shared.status} role="img" aria-label={name}><Dot value={shared.status} /></span>} /><TooltipContent>{name}</TooltipContent></Tooltip>
    {phone ? <>{<Button variant="ghost" data-testid="shared-members" aria-label={labels.sharedMemberCount(shared.members.length)} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
      <AvatarGroup>{shared.members.slice(0, 1).map(member => <MemberAvatar key={member.id} member={member} />)}<AvatarGroupCount>{shared.members.length}</AvatarGroupCount></AvatarGroup>
    </Button>}
      <Drawer open={open} onOpenChange={setOpen}><DrawerContent><DrawerTitle>{labels.sharedMembers}</DrawerTitle>{content}</DrawerContent></Drawer></>
      : <Popover open={open} onOpenChange={setOpen}><PopoverTrigger render={trigger} /><PopoverContent role="dialog" aria-label={labels.sharedMembers} align="end" className="max-w-[calc(100vw-1rem)]">{content}</PopoverContent></Popover>}
  </div>;
}

function RequestCard({ card, action }: { readonly card: Request; readonly action: (card: Request) => Promise<void> }) {
  const { labels } = useChatText();
  const [busy, setBusy] = useState(false), [error, setError] = useState(false);
  return <Card data-testid="request-card">
    <CardHeader><CardTitle>{card.title}</CardTitle></CardHeader>
    <CardContent><p className="m-0">{card.line}</p>{card.since && <time dateTime={card.since} className="text-muted-foreground">{labels.sharedSince(relativeTime(card.since, Date.now(), labels))}</time>}{error && <p role="alert">{labels.actionFailedShort}</p>}</CardContent>
    {card.action && <CardFooter><Button disabled={busy} onClick={() => { setBusy(true); setError(false); void action(card).catch(() => setError(true)).finally(() => setBusy(false)); }}>{card.action.label}</Button></CardFooter>}
  </Card>;
}

/** Shared metadata wraps the same user bubble or assistant Markdown/streaming row. No author means the native path is untouched. */
export function SharedMessage({ shared, children, remove, canRemove, openFile }: {
  readonly shared: NonNullable<Row['shared']>; readonly children: ReactNode;
  readonly remove?: ((message: ChannelMessage) => Promise<void>) | undefined;
  readonly canRemove?: ((message: ChannelMessage) => boolean) | undefined;
  readonly openFile?: ((path: string) => void) | undefined;
}) {
  const { labels } = useChatText();
  const [error, setError] = useState(false);
  const { message, author, first, own } = shared;
  return <div data-shared-message={message.id} className="flex min-w-0 flex-col gap-2">
    {!own && first && <div className="flex min-w-0 items-center gap-2"><MemberAvatar member={author} /><span data-testid="message-author" className="min-w-0 truncate">{author.name}</span><MemberBadge member={author} /></div>}
    {message.removed ? <p className="text-muted-foreground">{labels.sharedRemoved}</p> : children}
    {!message.removed && message.attachments?.map(file => <Button key={file.path} variant="outline" disabled={!openFile} onClick={() => openFile?.(file.path)} className="max-w-full justify-start"><span className="truncate">{file.title ?? file.path}</span></Button>)}
    {!message.removed && remove && canRemove?.(message) && <Button variant="ghost" size="icon" aria-label={labels.delete} onClick={() => { void remove(message).catch(() => setError(true)); }}><Trash2Icon aria-hidden="true" /></Button>}
    {error && <p role="alert">{labels.actionFailedShort}</p>}
  </div>;
}

export function sharedRows(shared: SharedChatState, action: (card: Request) => Promise<void>): Row[] {
  return shared.messages.map((message, index): Row => {
    const key = `shared:${message.id}`, own = message.author === shared.me.id;
    const author = shared.members.find(member => member.id === message.author) ?? { id: message.author, name: message.author, kind: 'person' };
    const metadata = { message, author, own, first: index === 0 || shared.messages[index - 1]?.author !== message.author };
    if (message.card) return { key, type: 'card', card: { content: <RequestCard card={message.card} action={action} /> }, shared: metadata };
    if (own) return { key, type: 'user', message: { role: 'user', content: message.text ?? '', timestamp: Date.parse(message.at) }, shared: metadata };
    return { key, type: 'assistant', text: message.text ?? '', streaming: Boolean(message.streaming), parts: [{ kind: 'text', key: `${key}:text`, text: message.text ?? '' }], shared: metadata };
  });
}
