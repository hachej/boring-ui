'use client';

import { useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { EntryRecord } from '@earendil-works/pi-durable';
import type { ImageContent, ToolCall, ToolResultMessage } from '@earendil-works/pi-ai';
import type { ChatAttachment, NativeChatController } from '@hachej/boring-ui-kit/native-chat';
import { Loader2Icon } from 'lucide-react';
import { Button } from '../button/button';
import { BlockActions } from '../button/actions';
import type { BlockAction } from '../button/actions';
import { Composer } from './composer';
import type { ComposerFeedback } from './composer';
import type { AttachmentsConfig, ConversationsConfig, EffortConfig, MentionsConfig, ModelConfig, SlashConfig } from './config';
import { EmptyState } from './empty-state';
import type { Suggestion } from './empty-state';
import { ConversationHistory, HistoryPanel } from './history';
import type { CommandMentions } from './markdown';
import { RowView } from './message';
import { MessageQueue } from './queue';
import { ChatNotices, Notice } from './notice';
import type { ArtifactsConfig } from './artifact';
import type { ChatCard, Mode } from './rows';
import { Shimmer } from './shimmer';
import { useChatSession, useTranscript } from './session';
import type { ChatFeatureProps, FilesHandler, PiChatActions } from './session';
import { ChatTextProvider, useChatText, useMergedText } from './labels';
import type { ChatIcons, ChatLabels } from './labels';
import { cn } from '../utils/utils';

export type { PiChatActions } from './session';
export type { ChatCard, Mode } from './rows';
export type { AnswerOutcome } from './question-card';
export { artifactKey, collectArtifacts, detectArtifact, parseArtifact } from './artifact';
export type { ArtifactDescriptor, ArtifactsConfig, ArtifactTarget, ArtifactType } from './artifact';
export type { CommandMention, CommandMentions } from './markdown';
export { FeedbackCard, FeedbackMention, feedbackMentionId, feedbackRenderTool, feedbackResultView } from './feedback-card';
export type { FeedbackCardConfig, FeedbackShowOutcome, FeedbackShowRequest } from './feedback-card';
export type { Suggestion } from './empty-state';
export { ConversationList, relativeTime } from './history';
export { defaultChatIcons, defaultChatLabels } from './labels';
export type { ChatIcons, ChatLabels } from './labels';
export { ActionMenu, BlockActions } from '../button/actions';
export type { BlockAction, BlockIcon } from '../button/actions';
export type { AttachmentsConfig, ConversationItem, ConversationsConfig, EffortConfig, MentionResult, MentionsConfig, ModelConfig, ModelRef, ReplyRef, SlashApi, SlashCommand, SlashConfig, SlashSkill, UploadResult } from './config';

export interface PiChatProps extends ChatFeatureProps {
  readonly controller: NativeChatController;
  /** Every word the chat shows (title, placeholder, buttons, notices, empty states): a partial object over `defaultChatLabels`. */
  readonly labels?: Partial<ChatLabels> | undefined;
  /** The chat's icons (send, stop, history, attach, …): any component taking `className`, over `defaultChatIcons`. */
  readonly icons?: Partial<ChatIcons> | undefined;
  /** The agent's avatar (an image or an icon) before the title in the header, and in the empty state instead of the agent icon. */
  readonly avatar?: ReactNode;
  /** Host actions in the header beside History: `header` ones as buttons, `menu` ones in a "…" menu. Test ids `chat-action-<id>`, the menu `chat-action-more`. */
  readonly headerActions?: readonly BlockAction[] | undefined;
  readonly className?: string;
  readonly decisions?: ReactNode;
  readonly controls?: ReactNode;
  /** Host controls at the end of the composer bar (for example a microphone), like AmbientChat's tools slot. */
  readonly tools?: ReactNode;
  /** Rendered before the title in the header (for example a menu button on narrow screens). */
  readonly headerStart?: ReactNode;
  readonly onFiles?: FilesHandler;
  /** Shown instead of the default empty state before the first message. */
  readonly emptyState?: ReactNode;
  readonly suggestions?: readonly Suggestion[];
  /** Past conversations. The header's History button then opens a searchable list with the open one marked and a New action. Omit it and History pages through the earlier records of this conversation. */
  readonly conversations?: ConversationsConfig;
  /**
   * `false`: the host shows `conversations` itself (for example the `pi-app` sessions pane), so History pages through the earlier records of this
   * conversation while replies keep their Fork button (`conversations.fork`). Default `true`: History opens the list.
   */
  readonly historyList?: boolean;
  /** Show the header History button. Default true; paging remains available through the controller. */
  readonly showHistory?: boolean;
  /** Show the header connection badge. Default true; connection state still controls actions. */
  readonly showConnectionStatus?: boolean;
  /** The optional Feedback button in the composer (the registry `feedback` item's `useComposerFeedback`). Omit it and nothing changes. */
  readonly feedback?: ComposerFeedback;
}

const PAGE = 60, MORE = 40;

/** Borrows a concrete native controller; unmount releases presentation and uploads only. */
export function PiChat(props: PiChatProps) {
  const active = useRef(props.controller); active.current = props.controller;
  const [mount, setMount] = useState({ controller: props.controller, sequence: 0 });
  if (mount.controller !== props.controller) setMount({ controller: props.controller, sequence: mount.sequence + 1 });
  const text = useMergedText(props.labels, props.icons);
  return <ChatTextProvider value={text}><PiChatSession key={mount.sequence} {...props} activeController={active} /></ChatTextProvider>;
}

function ConnectionBadge({ kind }: { readonly kind: string }) {
  const { labels } = useChatText();
  const live = kind === 'connected';
  return <span data-testid="connection" data-state={kind} role="status" className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground">
    <span aria-hidden="true" className={cn('size-1.5 rounded-full', live ? 'bg-emerald-500' : 'animate-pulse bg-amber-500 motion-reduce:animate-none')} />
    {live ? labels.live : kind === 'connecting' || kind === 'idle' ? labels.connecting : labels.reconnecting}
  </span>;
}

function PiChatSession({ controller, mode = 'expert', className, actions, avatar, headerActions, decisions, controls, tools, headerStart, renderEntry, renderTool, groupTool, commandMentions,
  onOpenImage, onCopy, onComposerKeyDown, onFiles, fileAccept = 'image/*', emptyState, suggestions, messageActions, slash, mentions, attachments, model, effort, artifacts, conversations, historyList = true, showHistory = true, showConnectionStatus = true, feedback, activeController: active }: PiChatProps & { readonly activeController: { readonly current: NativeChatController } }) {
  const { labels, icons } = useChatText();
  const { title } = labels;
  const [browsingHistory, setBrowsingHistory] = useState(false);
  const [pickingConversation, setPickingConversation] = useState(false);
  const scrollToBottom = useRef<() => void>(() => {});
  // A reply's Fork button calls the host's latest `fork`; the row context changes only when forking is switched on or off.
  const fork = useRef(conversations?.fork); fork.current = conversations?.fork;
  const canFork = Boolean(conversations?.fork);
  const rowExtras = useMemo(() => canFork ? { onFork: (entryId: string) => { void fork.current?.(entryId).catch(() => {}); } } : undefined, [canFork]);
  const session = useChatSession({ controller, activeController: active, mode, actions, renderEntry, renderTool, groupTool, commandMentions, onOpenImage, onCopy, onComposerKeyDown, onFiles, fileAccept,
    slash, mentions, attachments, model, effort, artifacts, messageActions, afterSend: () => scrollToBottom.current(), feedback, rowExtras });
  const { state, derived, queued, queueActions, working, waitingForAnswer, connected, error, act, textarea, rowContext, composer, empty, loading, developer } = session;
  const { rows, pinned, retry } = derived;
  const transcript = useTranscript(rows, PAGE, MORE);
  const { stick, hidden } = transcript;
  scrollToBottom.current = () => { void stick.scrollToBottom('instant'); };
  const visible = transcript.visible(rows);
  const { barStart, barNote } = session.pickers();
  const connectionKind = state.connection.kind;

  return <section data-boring="pi-chat" aria-label={title} className={cn('pi-chat relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background text-foreground', className)}>
    <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 sm:gap-3 sm:px-4 sm:py-2.5">
      {headerStart}
      {avatar && <span data-testid="chat-avatar" className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full [&>img]:size-full [&>img]:object-cover [&>svg]:size-4">{avatar}</span>}
      <h2 className="m-0 min-w-0 flex-1 truncate text-[0.9375rem] font-semibold tracking-tight">{title}</h2>
      {showHistory && (conversations && historyList
        ? <Button size="sm" data-testid="history-open" className="text-muted-foreground" aria-haspopup="dialog" aria-expanded={pickingConversation} disabled={state.disposed}
          onClick={() => setPickingConversation(open => !open)}><icons.history className="size-3.5" aria-hidden="true" />{labels.history}</Button>
        : state.history.kind !== 'disabled' && !browsingHistory && <Button size="sm" data-testid="history-open" className="text-muted-foreground" disabled={state.disposed || !connected}
          onClick={() => { setBrowsingHistory(true); act(controller.loadEarlier); }}><icons.history className="size-3.5" aria-hidden="true" />{labels.history}</Button>)}
      <BlockActions actions={headerActions} testId="chat-action" menuLabel={labels.moreActions} />
      {showConnectionStatus && <ConnectionBadge kind={connectionKind} />}
      {controls}
    </header>

    {decisions && <div data-boring="required-decisions" className="shrink-0 border-b border-border px-4 py-2">{decisions}</div>}
    {pinned.length > 0 && <aside aria-label={labels.requiredActions} className="shrink-0 space-y-2 border-b border-border px-4 py-2">{pinned.map(card => <div key={card.key}>{card.content}</div>)}</aside>}
    {(connectionKind === 'error' || connectionKind === 'closed') && <div className="shrink-0 px-4 pt-2">
      <Notice tone={connectionKind === 'error' ? 'error' : 'info'} testid="connection-notice">
        <span className="flex-1">{connectionKind === 'error' ? labels.loadFailed : labels.disconnected}</span>
        {!state.disposed && <Button size="sm" variant="outline" onClick={() => act(controller.connect)}><icons.reconnect className="size-3.5" aria-hidden="true" />{labels.reconnect}</Button>}
      </Notice></div>}
    {pickingConversation && conversations && historyList && <ConversationHistory conversations={conversations} onClose={() => setPickingConversation(false)}
      onBrowseEarlier={state.history.kind !== 'disabled' && connected && Boolean(state.view?.entries.length) ? () => { setBrowsingHistory(true); act(controller.loadEarlier); } : undefined} />}
    {browsingHistory && state.history.kind !== 'disabled' && <HistoryPanel history={state.history} developer={developer} connected={!state.disposed && connected}
      onLoad={() => act(controller.loadEarlier)} onClose={() => { setBrowsingHistory(false); if (!state.disposed) controller.clearHistory(); }} />}

    <div className="relative min-h-0 flex-1">
      <div ref={stick.scrollRef} data-testid="transcript-scroll" className="h-full overflow-x-hidden overflow-y-auto overscroll-contain">
        <div ref={stick.contentRef} role="log" aria-label={labels.messages} aria-live="polite" data-testid="transcript" className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 px-3 pt-6 pb-8 sm:px-4">
          {hidden > 0 && <div className="flex justify-center"><Button size="sm" variant="outline" data-testid="show-earlier" className="rounded-full text-muted-foreground" onClick={transcript.reveal}>{labels.showEarlier}</Button></div>}
          {visible.map(row => <RowView key={row.key} row={row} context={rowContext} />)}
        </div>
      </div>
      {(empty || loading) && <div className="pointer-events-none absolute inset-0">
        <div className="pointer-events-auto h-full">
          {loading ? <p role="status" data-testid="loading" className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2Icon className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />{labels.loading}</p>
            : emptyState ?? <EmptyState title={title} description={labels.emptyDescription} {...(avatar ? { avatar } : {})} {...(suggestions ? { suggestions } : {})} onSelect={text => { controller.setText(text); textarea.current?.focus(); }} />}
        </div></div>}
      {!stick.isAtBottom && <Button variant="outline" size="icon" data-testid="jump-latest" aria-label={labels.jumpToLatest} title={labels.jumpToLatest} onClick={() => { transcript.reset(); void stick.scrollToBottom(); }}
        className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-background/95 shadow-md backdrop-blur"><icons.jumpToLatest className="size-4" aria-hidden="true" /></Button>}
    </div>

    <footer className="shrink-0 px-3 pt-1 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-4">
      <div className="mx-auto w-full max-w-3xl space-y-2">
        <div aria-live="polite" className="space-y-2 empty:hidden">
          {working && <p role="status" data-testid="agent-status" className="m-0 flex items-center gap-2 px-1 text-xs text-muted-foreground"><span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-emerald-500 motion-reduce:animate-none" />
            <Shimmer active={!waitingForAnswer}>{waitingForAnswer ? labels.waitingForAnswer : retry ? labels.retryPending : labels.agentWorking}</Shimmer></p>}
          {derived.compacting && <p role="status" className="m-0 px-1 text-xs text-muted-foreground">{labels.compacting}</p>}
          <ChatNotices state={state} error={error} onReconcile={() => act(controller.reconcile)} onRetry={() => act(controller.retrySameRequest)} />
        </div>
        <div>
          <MessageQueue items={queued} sending={state.outbox} withdraw={actions?.withdraw} actions={queueActions} />
          <Composer {...composer} barStart={barStart} barNote={barNote} barEnd={tools} />
        </div>
      </div>
    </footer>
  </section>;
}
