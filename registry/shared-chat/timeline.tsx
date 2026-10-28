'use client';
import { Children, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode, RefObject } from 'react';
import type { SharedChatController } from '@hachej/boring-ui-kit/shared-chat';
import type { MentionsConfig } from '../pi-chat/config';
import { MessageText } from '../pi-chat/message';
import { Markdown } from '../pi-chat-markdown/markdown';
import { PAGE_FIRST, PAGE_MORE, useRowChunks, useTranscript } from '../pi-chat/session';
import type { ChatPaging } from '../pi-chat/session';
import { TranscriptHistory } from '../pi-chat/history';
import { Message, MessageContent } from '@/components/ui/message';
import { Bubble, BubbleContent } from '@/components/ui/bubble';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MessageScroller, MessageScrollerViewport, MessageScrollerContent, MessageScrollerItem } from '@/components/ui/message-scroller';
import { showsAuthors, runHead } from './names';
import { AuthorName, BubbleTail, ClockSpacer, MessageClock, PinnedComment, QuestionCard, ReplyQuote, RequestCard, SharedMessage, SystemLines, ViaLine, clockRoom, sharedItems } from './messages';
import type { SharedItem } from './messages';
import { HostTrace } from './host-trace';
import { useChatText, useSharedView } from './text';

export interface TimelineApi { readonly reset: () => void; readonly reveal: (id: string) => void }
/**
 * WhatsApp's room: bubbles hug the bottom, a day pill starts each day, host notices collapse into one small line, and a
 * « ↓ 3 new messages » pill appears below the list (never over it) while the reader is scrolled up.
 */
export function SharedTimeline({ controller, api, focusComposer, openFile, mentions, pendingVoice, paging }: {
  readonly controller: SharedChatController; readonly api: RefObject<TimelineApi | undefined>;
  readonly focusComposer: () => void; readonly openFile?: ((path: string) => void) | undefined; readonly mentions: MentionsConfig; readonly pendingVoice?: ReactNode; readonly paging?: ChatPaging | undefined;
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const { labels, icons } = useChatText();
  const view = useSharedView();
  const items = useStableItems(useMemo(() => sharedItems(state.shared, labels.sharedName), [state.shared, labels.sharedName]));
  const connected = state.connection.kind === 'connected';
  const transcript = useTranscript(items, paging?.first ?? PAGE_FIRST, paging?.more ?? PAGE_MORE, { state: state.history, connected: !state.disposed && connected, load: controller.loadEarlier });
  const { stick, hidden } = transcript;
  const chunks = useRowChunks(useMemo(() => hidden ? items.slice(hidden) : items, [items, hidden]));
  const root = useRef<HTMLDivElement>(null);
  const [revealing, setRevealing] = useState<string>();
  // The last message the reader has seen at the bottom; what others posted after it while scrolled up is « new ».
  const latest = state.shared.messages.at(-1)?.id;
  const [seen, setSeen] = useState(latest);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- marks the latest message seen once the reader is at the bottom, after commit; settles when equal
  useEffect(() => { if (stick.isAtBottom && seen !== latest) setSeen(latest); }, [stick.isAtBottom, latest, seen]);
  // The pill's row shows only once the reader scrolls up, so loading a room (which scrolls down) never shifts the list under a tap.
  const lastTop = useRef(0);
  const [scrolledUp, setScrolledUp] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- reaching the bottom hides the pill's row once, after commit
  useEffect(() => { if (stick.isAtBottom) setScrolledUp(false); }, [stick.isAtBottom]);
  const seenAt = state.shared.messages.findIndex(message => message.id === seen);
  const unseen = stick.isAtBottom ? 0 : state.shared.messages.slice(seenAt + 1).filter(message => message.author !== state.shared.me.id).length;
  // The reader's own new message lands in view, wherever they were: on Send it is drawn at once (pending), and Send's own scroll
  // runs before that render. Its confirmation (same clientId) is the same message and does not scroll again.
  const mine = state.shared.messages.findLast(message => message.author === state.shared.me.id);
  const mineKey = mine ? mine.clientId ?? mine.id : undefined;
  const lastMine = useRef(mineKey);
  useLayoutEffect(() => {
    if (mineKey === lastMine.current) return;
    const fresh = lastMine.current !== undefined || mine?.pending;
    lastMine.current = mineKey;
    if (fresh && mine === state.shared.messages.at(-1)) { transcript.reset(); void stick.scrollToBottom('instant'); }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scrolls only when the reader's own latest message changes, not on every message or transcript object
  }, [mineKey]);
  useEffect(() => bindApi(api, { reset: () => { transcript.reset(); void stick.scrollToBottom('instant'); }, reveal: setRevealing }), [api, transcript, stick]);
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
    // A message that is neither loaded nor further back in history cannot be revealed.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- an unreachable target is dropped once, after commit
    else setRevealing(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs per target, rows and history page; the transcript object and controller are rebuilt or stable and must not re-trigger a reveal
  }, [revealing, items, hidden, state.history]);
  const hasContent = items.length > 0 || Children.count(pendingVoice) > 0;
  // Names and avatars only where they tell people apart: two or more members besides the reader.
  const multi = showsAuthors(state.shared.members, state.shared.me.id, view.presence);
  const focus = useRef(focusComposer);
  useLayoutEffect(() => { focus.current = focusComposer; });
  const reply = useCallback((id: string) => { controller.setReplyTo(id); focus.current(); }, [controller]);
  const open = useRef(openFile);
  useLayoutEffect(() => { open.current = openFile; });
  const hasOpen = Boolean(openFile);
  const stableOpen = useMemo(() => hasOpen ? (path: string) => open.current?.(path) : undefined, [hasOpen]);
  return <MessageScroller>
    <MessageScrollerViewport ref={node => { root.current = node; stick.scrollRef(node); }} data-testid="transcript-scroll" aria-label={labels.messages} className="min-h-0 flex-1 scrollbar-thumb-border scrollbar-track-transparent"
      onScroll={event => { const top = event.currentTarget.scrollTop; if (top < lastTop.current - 4) setScrolledUp(true); lastTop.current = top; }}>
      {items.length > 0 && (hidden > 0 || state.history.kind === 'loading' || state.history.kind === 'error' || state.history.kind === 'ready' && state.history.hasMore) && <TranscriptHistory history={state.history} connected={!state.disposed && connected} onLoad={transcript.reveal} sentinelRef={transcript.sentinelRef} hidden={hidden} loaded={transcript.loaded} />}
      <div data-testid="transcript-bottom" className="mx-auto flex min-h-full w-full max-w-[720px] flex-col justify-end px-4 pt-4 pb-3 md:px-6">
        <MessageScrollerContent aria-label={labels.messages} aria-live="polite" data-testid="transcript" className="h-auto min-h-0 gap-0 [&>[data-local-voice]]:mt-3">
          {chunks.map((run, index) => <TimelineChunk key={run[0]!.key} items={run} top={index === 0} multi={multi} controller={controller} mentions={mentions} openFile={stableOpen} onReply={reply} onReveal={setRevealing} />)}
          {pendingVoice}
        </MessageScrollerContent>
      </div>
    </MessageScrollerViewport>
    {hasContent && !stick.isAtBottom && scrolledUp && <div data-testid="transcript-navigation" className="flex shrink-0 items-center justify-center py-1.5">
      <Button variant="secondary" size="sm" data-testid="jump-latest" data-unseen={unseen || undefined} aria-label={unseen ? labels.sharedNewMessages(unseen) : labels.jumpToLatest} title={labels.jumpToLatest} className="max-md:min-h-11 pointer-coarse:min-h-11" onClick={() => api.current?.reset()}>
        <icons.jumpToLatest data-icon="inline-start" aria-hidden="true" />{unseen ? labels.sharedNewMessages(unseen) : labels.jumpToLatest}</Button>
    </div>}
  </MessageScroller>;
}

/** Same item, field by field (the quote is rebuilt each pass, so it compares by what it points at). */
const sameItem = (a: SharedItem, b: SharedItem) => a.key === b.key && a.message === b.message && a.author === b.author && a.own === b.own && a.first === b.first
  && a.lastItem === b.lastItem && a.separator === b.separator && a.showSpinner === b.showSpinner && a.latestCard === b.latestCard
  && a.quote?.message === b.quote?.message && a.quote?.author === b.quote?.author
  && (a.system === b.system || (a.system?.length === b.system?.length && a.system!.every((line, index) => line === b.system![index])));
/**
 * Keeps the previous object of every item that did not change, so a page loaded above, a delta or a new message renders only the
 * rows it touches (rows and their runs are memoized by identity).
 */
function useStableItems(next: readonly SharedItem[]): readonly SharedItem[] {
  // A derived identity cache, read and replaced inside the memo only: the same items always give the same objects.
  const previous = useRef(new Map<string, SharedItem>());
  return useMemo(() => {
    // eslint-disable-next-line react-hooks/refs -- reuses the cached object of an unchanged item; no setState, no render loop
    const items = next.map(item => { const before = previous.current.get(item.key); return before && sameItem(before, item) ? before : item; });
    // eslint-disable-next-line react-hooks/refs -- stores the items for the next pass; a cache write, not state, so it triggers no render
    previous.current = new Map(items.map(item => [item.key, item]));
    return items;
  }, [next]);
}

/** Hands the timeline's controls to the host's ref until this timeline unmounts or rebinds. */
function bindApi(api: RefObject<TimelineApi | undefined>, value: TimelineApi) {
  api.current = value;
  return () => { if (api.current === value) api.current = undefined; };
}

type RowProps = {
  readonly multi: boolean; readonly controller: SharedChatController; readonly mentions: MentionsConfig;
  readonly openFile: ((path: string) => void) | undefined; readonly onReply: (id: string) => void; readonly onReveal: (id: string) => void;
};
/** A run of timeline rows as one scroller item (`useRowChunks`). Memoized, like each row: it renders again only when its own items change. */
const TimelineChunk = memo(function TimelineChunk({ items, top, ...props }: RowProps & { readonly items: readonly SharedItem[]; readonly top: boolean }) {
  return <MessageScrollerItem messageId={items[0]!.key} data-transcript-chunk="" className="flex flex-col [content-visibility:visible] [gap:inherit]">
    {items.map((item, index) => <TimelineRow key={item.key} item={item} top={top && index === 0} {...props} />)}
  </MessageScrollerItem>;
});
const TimelineRow = memo(function TimelineRow({ item, top, multi, controller, mentions, openFile, onReply, onReveal }: RowProps & { readonly item: SharedItem; readonly top: boolean }) {
  const { labels } = useChatText();
  const view = useSharedView();
  const context = useMemo(() => ({ pieces: { mentions: true, skills: [], renderMention: mentions.renderSent }, openFile }), [mentions.renderSent, openFile]);
  const renderMention = (path: string, text: string) => mentions.renderSent?.(path) ?? text;
  const bubble = () => {
    const { message, author, own, first } = item;
    const person = own || author.kind !== 'agent' || message.via !== undefined;
    const headKind = runHead({ first, own, authors: multi, via: message.via });
    const head = headKind === 'author' ? <AuthorName member={author} via={message.via} /> : undefined;
    const traced = view.steps !== 'hidden' && !message.via && author.kind === 'agent' && Boolean(message.streaming || message.steps?.length);
    // Who spoke (and via what) sits above the group's first bubble, outside it: the bubble keeps its width. My own messages carry no name;
    // one posted through an outside agent says so on my side.
    const via = headKind === 'via' && message.via ? <ViaLine via={message.via} className="ms-auto block w-fit max-w-full pb-0.5 pe-1" /> : undefined;
    const live = traced && Boolean(message.streaming);
    const trace = traced ? <HostTrace participant={author.name} steps={message.steps ?? []} streaming={Boolean(message.streaming)} active={item.showSpinner} /> : undefined;
    const quote = message.replyTo ? <ReplyQuote targetId={message.replyTo} quote={item.quote} onReveal={onReveal} /> : undefined;
    if (message.question) return <article data-row-id={item.key} data-role="event" className="flex w-full min-w-0 flex-col">
      {head}{via}
      <Bubble variant="muted" align="start" data-testid="question-bubble">
        {first && <BubbleTail side="start" />}
        <BubbleContent className="relative min-w-52">{quote}
          <QuestionCard message={message} answer={controller.answer} onReply={onReply} />
        </BubbleContent>
      </Bubble></article>;
    if (message.card) return <article data-row-id={item.key} data-role="event" className="flex w-full min-w-0 flex-col">
      {head}{via}
      <Bubble variant={own ? 'default' : 'muted'} align={own ? 'end' : 'start'} data-testid="card-bubble">
        {first && <BubbleTail side={own ? 'end' : 'start'} />}
        <BubbleContent className="relative min-w-52">{quote}
          {message.card.kind === 'pin' ? <PinnedComment card={message.card} own={own} at={message.at} /> : <RequestCard card={message.card} action={controller.action} at={message.at} own={own} />}
        </BubbleContent>
      </Bubble></article>;
    return <article data-row-id={item.key} data-role={person ? 'user' : 'assistant'} data-streaming={message.streaming ? 'true' : undefined} data-pending={message.pending ? 'true' : undefined} className="group/message">{head}{via}<Message align={own ? 'end' : 'start'}><MessageContent>
      {own ? <div data-testid="own-message" className="contents [&_[data-testid=message-mention]]:text-inherit">
        <MessageText text={message.text ?? ''} context={context} variant="default" decoration={first ? <BubbleTail side="end" /> : undefined} header={quote} footer={<><ClockSpacer /><MessageClock at={message.at} tone="primary" pending={message.pending} /></>} /></div>
        : view.answerStyle === 'plain' && !person ? <div data-testid="plain-answer" className="min-w-0">
          {quote}
          {message.text && <Markdown text={message.text} streaming={Boolean(message.streaming)} renderMention={renderMention} />}
          {traced && <HostTrace participant={author.name} steps={message.steps ?? []} streaming={Boolean(message.streaming)} active={item.showSpinner} />}
        </div>
        : <Bubble variant="muted">{first && <BubbleTail side="start" />}<BubbleContent className="relative">
          {quote}
          {/* While the agent writes, the working line sits above the growing text and the time waits for the answer: nothing under the text moves as it grows (B5). */}
          {live && trace}
          {message.text && <div className={traced ? undefined : clockRoom}><Markdown text={message.text} streaming={Boolean(message.streaming)} renderMention={renderMention} /></div>}
          {traced ? <>
            {!live && trace}
            {!live && <div className="flex justify-end"><MessageClock at={message.at} tone="muted" floating={false} /></div>}
          </> : <MessageClock at={message.at} tone="muted" />}
        </BubbleContent></Bubble>}
    </MessageContent></Message></article>;
  };
  const gap = top || item.separator ? '' : item.system || item.first ? ' mt-3' : ' mt-0.5';
  return <div data-row-key={item.key} data-group-start={item.first ? 'true' : undefined} className={`min-w-0 shrink-0${gap}`}>
    {item.separator && <div data-testid="day-separator" className={`flex justify-center pb-3${top ? '' : ' pt-4'}`}><Badge variant="secondary"><time dateTime={item.message.at} title={labels.sharedTimestamp(item.message.at)}>{labels.sharedDay(item.message.at)}</time></Badge></div>}
    {item.system ? <SystemLines lines={item.system} />
      : <SharedMessage shared={item} remove={controller.remove} canRemove={controller.canRemove} openFile={openFile} onReply={onReply} onReveal={onReveal}>{bubble()}</SharedMessage>}
  </div>;
});
