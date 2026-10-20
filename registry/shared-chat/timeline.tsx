'use client';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { RefObject } from 'react';
import type { SharedChatController } from '@hachej/boring-ui-kit/shared-chat';
import type { MentionsConfig } from '../pi-chat/config';
import { MessageText } from '../pi-chat/message';
import { Markdown } from '../pi-chat/markdown';
import { useTranscript } from '../pi-chat/session';
import { TranscriptHistory } from '../pi-chat/history';
import { Message, MessageContent } from '@/components/ui/message';
import { Bubble, BubbleContent } from '@/components/ui/bubble';
import { MessageScroller, MessageScrollerViewport, MessageScrollerContent, MessageScrollerItem, MessageScrollerButton } from '@/components/ui/message-scroller';
import { SharedMessage, RequestCard, sharedItems } from './messages';
import { useChatText } from './text';

export interface TimelineApi { readonly reset: () => void; readonly reveal: (id: string) => void }
export function SharedTimeline({ controller, api, focusComposer, openFile, mentions }: {
  readonly controller: SharedChatController; readonly api: RefObject<TimelineApi | undefined>;
  readonly focusComposer: () => void; readonly openFile?: ((path: string) => void) | undefined; readonly mentions: MentionsConfig;
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const { labels, icons } = useChatText();
  const items = useMemo(() => sharedItems(state.shared), [state.shared]);
  const connected = state.connection.kind === 'connected';
  const transcript = useTranscript(items, 60, 40, { state: state.history, connected: !state.disposed && connected, load: controller.loadEarlier });
  const { stick, hidden } = transcript;
  const root = useRef<HTMLDivElement>(null);
  const [revealing, setRevealing] = useState<string>();
  useEffect(() => {
    const value = { reset: () => { transcript.reset(); void stick.scrollToBottom('instant'); }, reveal: setRevealing };
    api.current = value;
    return () => { if (api.current === value) api.current = undefined; };
  });
  useEffect(() => {
    if (!revealing) return;
    const key = `shared:${revealing}`;
    if (items.some(item => item.key === key)) {
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
  const context = { pieces: { mentions: true, skills: [], renderMention: mentions.renderSent }, openFile };
  const renderMention = (path: string, text: string) => mentions.renderSent?.(path) ?? text;
  return <MessageScroller>
    <MessageScrollerViewport ref={node => { root.current = node; stick.scrollRef(node); }} data-testid="transcript-scroll" aria-label={labels.messages} className="scrollbar-thumb-border scrollbar-track-transparent">
      {items.length > 0 && <TranscriptHistory history={state.history} connected={!state.disposed && connected} onLoad={transcript.reveal} sentinelRef={transcript.sentinelRef} hidden={hidden} loaded={transcript.loaded} />}
      <div className="mx-auto w-full max-w-[720px] px-4 pt-6 pb-8 sm:px-6">
        <MessageScrollerContent aria-label={labels.messages} aria-live="polite" data-testid="transcript" className="gap-0">
          {transcript.visible(items).map((item, index) => {
            const { message, author, own } = item;
            const person = own || author.kind !== 'agent' || message.via !== undefined;
            return <MessageScrollerItem key={item.key} messageId={item.key} className={`[content-visibility:visible]${index > 0 ? item.first ? ' mt-6' : ' mt-2' : ''}`}>
              <SharedMessage shared={item} remove={controller.remove} canRemove={controller.canRemove} openFile={openFile} onReply={id => { controller.setReplyTo(id); focusComposer(); }} onReveal={setRevealing}>
                {message.card ? <article data-row-id={item.key} data-role="event"><RequestCard card={message.card} action={controller.action} /></article>
                  : person ? <article data-row-id={item.key} data-role="user"><Message align={own ? 'end' : 'start'}><MessageContent><MessageText text={message.text ?? ''} context={context} align={own ? 'end' : 'start'} /></MessageContent></Message></article>
                    : <article data-row-id={item.key} data-role="assistant" data-streaming={message.streaming ? 'true' : undefined} className="group/message"><Message><MessageContent><div className="flex flex-col gap-3">
                      {message.text && <Bubble variant="ghost"><BubbleContent><Markdown text={message.text} streaming={Boolean(message.streaming)} renderMention={renderMention} /></BubbleContent></Bubble>}
                    </div></MessageContent></Message></article>}
              </SharedMessage>
            </MessageScrollerItem>;
          })}
        </MessageScrollerContent>
      </div>
    </MessageScrollerViewport>
    {items.length > 0 && !stick.isAtBottom && <MessageScrollerButton data-testid="jump-latest" aria-label={labels.jumpToLatest} title={labels.jumpToLatest} onClick={() => api.current?.reset()}><icons.jumpToLatest aria-hidden="true" /></MessageScrollerButton>}
  </MessageScroller>;
}
