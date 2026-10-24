'use client';
import { Children, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode, RefObject } from 'react';
import type { SharedChatController } from '@hachej/boring-ui-kit/shared-chat';
import type { MentionsConfig } from '../pi-chat/config';
import { MessageText } from '../pi-chat/message';
import { Markdown } from '../pi-chat-markdown/markdown';
import { useTranscript } from '../pi-chat/session';
import { TranscriptHistory } from '../pi-chat/history';
import { Message, MessageContent } from '@/components/ui/message';
import { Bubble, BubbleContent } from '@/components/ui/bubble';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MessageScroller, MessageScrollerViewport, MessageScrollerContent, MessageScrollerItem } from '@/components/ui/message-scroller';
import { AuthorName, BubbleTail, ClockSpacer, MessageClock, PinnedComment, ReplyQuote, RequestCard, SharedMessage, SystemLines, clockRoom, sharedItems } from './messages';
import type { SharedItem } from './messages';
import { HostTrace } from './host-trace';
import { useChatText, useSharedView } from './text';

export interface TimelineApi { readonly reset: () => void; readonly reveal: (id: string) => void }
/**
 * WhatsApp's room: bubbles hug the bottom, a day pill starts each day, host notices collapse into one small line, and a
 * « ↓ 3 new messages » pill appears below the list (never over it) while the reader is scrolled up.
 */
export function SharedTimeline({ controller, api, focusComposer, openFile, mentions, pendingVoice }: {
  readonly controller: SharedChatController; readonly api: RefObject<TimelineApi | undefined>;
  readonly focusComposer: () => void; readonly openFile?: ((path: string) => void) | undefined; readonly mentions: MentionsConfig; readonly pendingVoice?: ReactNode;
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const { labels, icons } = useChatText();
  const view = useSharedView();
  const items = useMemo(() => sharedItems(state.shared), [state.shared]);
  const connected = state.connection.kind === 'connected';
  const transcript = useTranscript(items, 60, 40, { state: state.history, connected: !state.disposed && connected, load: controller.loadEarlier });
  const { stick, hidden } = transcript;
  const root = useRef<HTMLDivElement>(null);
  const [revealing, setRevealing] = useState<string>();
  // The last message the reader has seen at the bottom; what others posted after it while scrolled up is « new ».
  const latest = state.shared.messages.at(-1)?.id;
  const [seen, setSeen] = useState(latest);
  useEffect(() => { if (stick.isAtBottom && seen !== latest) setSeen(latest); }, [stick.isAtBottom, latest, seen]);
  // The pill's row shows only once the reader scrolls up, so loading a room (which scrolls down) never shifts the list under a tap.
  const lastTop = useRef(0);
  const [scrolledUp, setScrolledUp] = useState(false);
  useEffect(() => { if (stick.isAtBottom) setScrolledUp(false); }, [stick.isAtBottom]);
  const seenAt = state.shared.messages.findIndex(message => message.id === seen);
  const unseen = stick.isAtBottom ? 0 : state.shared.messages.slice(seenAt + 1).filter(message => message.author !== state.shared.me.id).length;
  useEffect(() => {
    const value = { reset: () => { transcript.reset(); void stick.scrollToBottom('instant'); }, reveal: setRevealing };
    api.current = value;
    return () => { if (api.current === value) api.current = undefined; };
  });
  useEffect(() => {
    if (!revealing) return;
    const key = items.find(item => item.message.id === revealing || item.system?.some(line => line.id === revealing))?.key;
    if (key) {
      transcript.revealTo(key);
      const frame = requestAnimationFrame(() => {
        const parent = [...(root.current?.querySelectorAll<HTMLElement>('[data-shared-message]') ?? [])].find(element => element.dataset.sharedMessage === revealing);
        if (parent) { parent.scrollIntoView({ block: 'center', behavior: 'instant' }); setRevealing(undefined); }
      });
      return () => cancelAnimationFrame(frame);
    }
    if (state.history.kind === 'loading') return;
    if (state.history.kind === 'ready' && state.history.hasMore) void controller.loadEarlier().catch(() => setRevealing(undefined));
    else setRevealing(undefined);
  }, [revealing, items, hidden, state.history]);
  const hasContent = items.length > 0 || Children.count(pendingVoice) > 0;
  // Avatars and names only where they tell people apart: more than two members.
  const multi = view.presence !== false && state.shared.members.length > 2;
  const context = { pieces: { mentions: true, skills: [], renderMention: mentions.renderSent }, openFile };
  const renderMention = (path: string, text: string) => mentions.renderSent?.(path) ?? text;
  const reply = (id: string) => { controller.setReplyTo(id); focusComposer(); };
  const bubble = (item: SharedItem) => {
    const { message, author, own, first } = item;
    const person = own || author.kind !== 'agent' || message.via !== undefined;
    const head = first && !own && multi ? <AuthorName member={author} via={message.via} /> : undefined;
    const traced = view.steps !== 'hidden' && !message.via && author.kind === 'agent' && Boolean(message.streaming || message.steps?.length);
    const quote = message.replyTo ? <ReplyQuote targetId={message.replyTo} quote={item.quote} onReveal={setRevealing} /> : undefined;
    if (message.card) return <article data-row-id={item.key} data-role="event" className="flex w-full min-w-0 flex-col">
      <Bubble variant={own ? 'default' : 'muted'} align={own ? 'end' : 'start'} data-testid="card-bubble">
        {first && <BubbleTail side={own ? 'end' : 'start'} />}
        <BubbleContent className="relative min-w-52">{head}{quote}
          {message.card.kind === 'pin' ? <PinnedComment card={message.card} own={own} at={message.at} /> : <RequestCard card={message.card} action={controller.action} at={message.at} own={own} />}
        </BubbleContent>
      </Bubble></article>;
    return <article data-row-id={item.key} data-role={person ? 'user' : 'assistant'} data-streaming={message.streaming ? 'true' : undefined} className="group/message"><Message align={own ? 'end' : 'start'}><MessageContent>
      {own ? <div data-testid="own-message" className="contents [&_[data-testid=message-mention]]:text-inherit">
        <MessageText text={message.text ?? ''} context={context} variant="default" decoration={first ? <BubbleTail side="end" /> : undefined} header={quote} footer={<><ClockSpacer /><MessageClock at={message.at} tone="primary" /></>} /></div>
        : view.answerStyle === 'plain' ? <div data-testid="plain-answer" className="min-w-0">
          {head}{quote}
          {message.text && <Markdown text={message.text} streaming={Boolean(message.streaming)} renderMention={renderMention} />}
          {traced && <HostTrace participant={author.name} steps={message.steps ?? []} streaming={Boolean(message.streaming)} active={item.showSpinner} />}
        </div>
        : <Bubble variant="muted">{first && <BubbleTail side="start" />}<BubbleContent className="relative">
          {head}{quote}
          {message.text && <div className={traced ? undefined : clockRoom}><Markdown text={message.text} streaming={Boolean(message.streaming)} renderMention={renderMention} /></div>}
          {traced ? <>
            <HostTrace participant={author.name} steps={message.steps ?? []} streaming={Boolean(message.streaming)} active={item.showSpinner} />
            <div className="flex justify-end"><MessageClock at={message.at} tone="muted" floating={false} /></div>
          </> : <MessageClock at={message.at} tone="muted" />}
        </BubbleContent></Bubble>}
    </MessageContent></Message></article>;
  };
  return <MessageScroller>
    <MessageScrollerViewport ref={node => { root.current = node; stick.scrollRef(node); }} data-testid="transcript-scroll" aria-label={labels.messages} className="min-h-0 flex-1 scrollbar-thumb-border scrollbar-track-transparent"
      onScroll={event => { const top = event.currentTarget.scrollTop; if (top < lastTop.current - 4) setScrolledUp(true); lastTop.current = top; }}>
      {items.length > 0 && (hidden > 0 || state.history.kind === 'loading' || state.history.kind === 'error' || state.history.kind === 'ready' && state.history.hasMore) && <TranscriptHistory history={state.history} connected={!state.disposed && connected} onLoad={transcript.reveal} sentinelRef={transcript.sentinelRef} hidden={hidden} loaded={transcript.loaded} />}
      <div data-testid="transcript-bottom" className="mx-auto flex min-h-full w-full max-w-[720px] flex-col justify-end px-4 pt-4 pb-3 sm:px-6">
        <MessageScrollerContent aria-label={labels.messages} aria-live="polite" data-testid="transcript" className="h-auto min-h-0 gap-0 [&>[data-local-voice]]:mt-3">
          {transcript.visible(items).map((item, index) => {
            const gap = index === 0 || item.separator ? '' : item.system || item.first ? ' mt-3' : ' mt-0.5';
            return <MessageScrollerItem key={item.key} messageId={item.key} data-group-start={item.first ? 'true' : undefined} className={`[content-visibility:visible]${gap}`}>
              {item.separator && <div data-testid="day-separator" className={`flex justify-center pb-3${index > 0 ? ' pt-4' : ''}`}><Badge variant="secondary"><time dateTime={item.message.at} title={labels.sharedTimestamp(item.message.at)}>{labels.sharedDay(item.message.at)}</time></Badge></div>}
              {item.system ? <SystemLines lines={item.system} />
                : <SharedMessage shared={item} avatars={multi} remove={controller.remove} canRemove={controller.canRemove} openFile={openFile} onReply={reply} onReveal={setRevealing}>{bubble(item)}</SharedMessage>}
            </MessageScrollerItem>;
          })}
          {pendingVoice}
        </MessageScrollerContent>
      </div>
    </MessageScrollerViewport>
    {hasContent && !stick.isAtBottom && scrolledUp && <div data-testid="transcript-navigation" className="flex shrink-0 items-center justify-center py-1.5">
      <Button variant="secondary" size="sm" data-testid="jump-latest" data-unseen={unseen || undefined} aria-label={unseen ? labels.sharedNewMessages(unseen) : labels.jumpToLatest} title={labels.jumpToLatest} className="max-sm:min-h-11 pointer-coarse:min-h-11" onClick={() => api.current?.reset()}>
        <icons.jumpToLatest data-icon="inline-start" aria-hidden="true" />{unseen ? labels.sharedNewMessages(unseen) : labels.jumpToLatest}</Button>
    </div>}
  </MessageScroller>;
}
