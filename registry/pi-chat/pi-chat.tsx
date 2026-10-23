'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ChatController } from '@hachej/boring-ui-kit/native-chat';
import { Loader2Icon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { MessageScroller, MessageScrollerProvider, MessageScrollerViewport, MessageScrollerContent, MessageScrollerItem, MessageScrollerButton } from '@/components/ui/message-scroller';
import { BlockActions } from '../button/actions';
import type { BlockAction } from '../button/actions';
import { Composer } from './composer';
import type { ComposerFeedback, ComposerProps } from './composer';
import { ConversationFiles } from './conversation-files';
import type { ConversationsConfig, PendingVoice, VoiceMessageConfig, VoiceMessageHandle, VoiceRecorderHook } from './config';
import { displayName } from './config';
import { EmptyState } from './empty-state';
import type { Suggestion } from './empty-state';
import { ConversationHistory, TranscriptHistory } from './history';
import { RowView } from './message';
import type { Row } from './rows';
import { MessageQueue } from './queue';
import { ChatNotices, Notice, PreparingStatus, preparing } from './notice';
import { Shimmer } from './shimmer';
import { useChatSession, useTranscript } from './session';
import { useChatDraft } from './use-chat-draft';
import { useChatPlacement } from './use-remote-chat';
import type { ChatPlacement } from './use-remote-chat';
import type { ChatFeatureProps, FilesHandler } from './session';
import { ChatTextProvider, useChatText, useMergedText } from './labels';
import { chatTextFor } from './locale';
import type { ChatLocale } from './locale';
import type { ChatIcons, ChatLabels } from './labels';
import { cn } from '../utils/utils';

export type { PiChatActions } from './session';
export type { ChatCard, Mode } from './rows';
export type { AnswerOutcome, QuestionCardProps } from './question-card';
export { ApprovalCard } from './approval-card';
export type { ApprovalCardProps } from './approval-card';
export type { ChatCards, ChatTextPart } from './message';
export type { MentionPickerProps, ModelEffortPickerProps, SlashPickerProps } from './config';
export type { PendingVoice, PendingVoiceBubbleProps, VoiceMessageButtonProps, VoiceMessageHandle } from './config';
export type { CameraSheetProps, VoiceRecorderHook, VoiceRecorderOptions } from './config';
export { voiceClock } from './config';
export { artifactKey, artifactKind, collectArtifacts, detectArtifact, parseArtifact, typeLabel } from './artifact';
export type { ArtifactDescriptor, ArtifactKind, ArtifactKindViewProps, ArtifactsConfig, ArtifactTarget, ArtifactType } from './artifact';
export { QuestionCard, formAnswer, parseQuestion, ASK_USER_TOOL } from './question-card';
export type { FormQuestion } from './question-card';
export { ChatTextProvider } from './labels';
export type { CommandMention, CommandMentions } from './config';
export type { Suggestion } from './empty-state';
export { ConversationList, relativeTime } from './history';
export { defaultChatIcons, defaultChatLabels } from './labels';
export type { ChatIcons, ChatLabels } from './labels';
export { frenchChatLabels } from './labels-fr';
export { chatTextFor } from './locale';
export type { ChatLocale } from './locale';
export { BlockActions } from '../button/actions';
export { useChatDraft } from './use-chat-draft';
export { useConversations } from './use-conversations';
export type { ChatController, ChatSnapshot } from '@hachej/boring-ui-kit/native-chat';
export { MessageText, VoiceBubble } from './message';
export { useTranscript } from './session';
export { RunCard, parseRun } from './run-card';
export { SubagentCard, parseDelegateDetails, DELEGATE_DETAILS_KIND } from './subagent-card';
export type { SubagentDetails, SubagentStatus } from './subagent-card';
export type { RunRecord, RunStatus } from './run-card';
export type { BlockAction, BlockIcon } from '../button/actions';
export type { AudioUrlRead, VoiceMessageConfig, AttachmentsConfig, ConversationItem, ConversationsConfig, EffortConfig, FileKind, MentionResult, MentionsConfig, ModelConfig, ModelRef, PasteToFile, PreviewRead, ReplyRef, SlashApi, SlashCommand, SlashConfig, SlashSkill, UploadResult } from './config';

export interface ChatTimeline {
  readonly count: number;
  readonly render: (context: { readonly focusComposer: () => void; readonly openFile?: ((path: string) => void) | undefined; readonly pendingVoice?: ReactNode }) => ReactNode;
  readonly afterSend?: () => void;
}

export interface PiChatProps extends ChatFeatureProps {
  /** Optional host transcript. Absent: native rows, history and scroll behavior are unchanged. */
  readonly timeline?: ChatTimeline | undefined;
  /** Authorized host errors may provide their own message. */
  readonly renderConnectionError?: ((error: unknown) => ReactNode) | undefined;
  readonly controller: ChatController;
  /** Where this chat is shown, reported with each submit (advisory, never authority). `docked` by default; a host that floats or tucks the same chat in a drawer says `floating`. */
  readonly placement?: ChatPlacement | undefined;
  /** Every word the chat shows (title, placeholder, buttons, notices, empty states): a partial object over `defaultChatLabels`. */
  /** The chat's language: `en` (default) or `fr`. `labels` override any of its words. */
  readonly locale?: ChatLocale | undefined;
  readonly labels?: Partial<ChatLabels> | undefined;
  /** The chat's icons (send, stop, history, attach, …): any component taking `className`, over `defaultChatIcons`. */
  readonly icons?: Partial<ChatIcons> | undefined;
  /** The agent's avatar (an image or an icon) before the title in the header, and in the empty state instead of the agent icon. */
  readonly avatar?: ReactNode;
  /** Host actions in the header beside History: `header` ones as buttons, `menu` ones in a "…" menu. Test ids `chat-action-<id>`, the menu `chat-action-more`. */
  readonly headerActions?: readonly BlockAction[] | undefined;
  /** `false` lets the host supply one shared header around chat and viewers. Default true. */
  readonly header?: boolean;
  readonly className?: string;
  /** Pad the chat's bottom by how far it reaches below the visual viewport (the phone's soft keyboard). Default true; `false` for a host that already follows the keyboard itself, such as a bottom drawer whose lower part sits off screen by design. */
  readonly keyboardInset?: boolean;
  readonly decisions?: ReactNode;
  readonly controls?: ReactNode;
  /** Host controls at the end of the composer bar (for example a microphone), like AmbientChat's tools slot. */
  readonly tools?: ReactNode;
  /** Hold-to-send one retained audio upload plus transcript. Omit to keep the existing composer unchanged. */
  readonly voiceMessage?: VoiceMessageConfig | undefined;
  /** Local voice rows owned by the shell's shared microphone; rendered with the native transcript, never the composer. */
  readonly pendingVoice?: readonly PendingVoice[] | undefined;
  /** Host content under the composer (for example a collapsed list of the person's requests). Absent: nothing is shown. */
  readonly belowComposer?: ReactNode;
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
  /** Empty desktop composition. `centered` puts the composer beneath the greeting; `docked` keeps the former layout. Phones always dock it. */
  readonly emptyLayout?: 'centered' | 'docked';
  /** Two-row reference composer by default. Explicitly select `pill`, `stacked` or `inline` for the earlier layouts. */
  readonly composerLayout?: ComposerProps['layout'];
  /** A conversation title, separate from the agent name, with optional click-to-rename. */
  readonly conversationTitle?: string | undefined;
  readonly onRenameTitle?: ((title: string) => void | Promise<void>) | undefined;
  /** Show the header connection badge. Default false; connection state still controls actions and failures stay visible. */
  readonly showConnectionStatus?: boolean;
  /** The optional annotate toggle and notes chip in the composer (the registry `feedback` item's `useComposerFeedback`). Omit it and nothing changes. */
  readonly feedback?: ComposerFeedback;
  /** Keeps the composer's half-typed message in localStorage under this key (a conversation id), across reloads and tabs; see `useChatDraft`. Omit it and nothing is stored. */
  readonly draftKey?: string | undefined;
}

const PAGE = 60, MORE = 40;
type TranscriptRow = { readonly key: string; readonly kind: 'native'; readonly row: Row }
  | { readonly key: string; readonly kind: 'voice'; readonly voice: PendingVoice };

/** Borrows a concrete native controller; unmount releases presentation and uploads only. */
export function PiChat(props: PiChatProps) {
  const active = useRef(props.controller); active.current = props.controller;
  // A new controller or a new voice recorder hook starts a fresh session, so the recorder's hooks keep their order.
  const recorder = props.voiceMessage?.useRecorder ?? noVoice;
  const [mount, setMount] = useState({ controller: props.controller, recorder, sequence: 0 });
  if (mount.controller !== props.controller || mount.recorder !== recorder) setMount({ controller: props.controller, recorder, sequence: mount.sequence + 1 });
  const text = useMergedText(props.labels, props.icons, chatTextFor(props.locale));
  return <ChatTextProvider value={text}><MessageScrollerProvider key={mount.sequence} autoScroll><PiChatSession {...props} activeController={active} /></MessageScrollerProvider></ChatTextProvider>;
}

function ConnectionBadge({ kind }: { readonly kind: string }) {
  const { labels } = useChatText();
  const live = kind === 'connected';
  return <Badge variant={live ? 'outline' : 'secondary'} data-testid="connection" data-state={kind} role="status">
    {live ? labels.live : kind === 'connecting' || kind === 'idle' ? labels.connecting : labels.reconnecting}
  </Badge>;
}

/** No voice message: without `voiceMessage.useRecorder` (from `pi-chat-voice`) the chat records nothing. */
const silent: VoiceMessageHandle = { canStart: false, phase: 'idle', seconds: 0, captureSequence: 0, problem: undefined, pending: [], start: () => {}, finish: () => {}, cancel: () => {} };
const noVoice: VoiceRecorderHook = () => silent;
/** A shell's pending voice row when no `voiceMessage.Bubble` is plugged in: nothing to draw. */
function NoVoiceBubble(_: { readonly pending: PendingVoice | undefined }) { return null; }

function PiChatSession({ controller, placement = 'docked', mode = 'expert', presentation, className, keyboardInset = true, actions, avatar, headerActions, header = true, decisions, controls, tools, voiceMessage, pendingVoice, belowComposer, composerChips, composerHeader, composerHasContent, onPickFiles, timeline, renderConnectionError, headerStart, renderEntry, hideLine, displayLimit, historicalMessageActions, unread, replyError, renderTool, toolRenderers, renderText, cards, groupTool, commandMentions,
  onOpenImage, onCopy, onComposerKeyDown, onFiles, fileAccept = 'image/*', emptyState, suggestions, messageActions, replyFooter, slash, mentions, attachments, model, effort, artifacts, conversations, historyList = true, showHistory = true, showConnectionStatus = false, emptyLayout = 'centered', composerLayout = 'card', conversationTitle, onRenameTitle, feedback, draftKey, onOpenFile, fileChanges, pasteToFile, activeController: active }: PiChatProps & { readonly activeController: { readonly current: ChatController } }) {
  const { labels, icons } = useChatText();
  useChatDraft(controller, draftKey);
  useChatPlacement(controller, placement);
  const { title } = labels;
  const [pickingConversation, setPickingConversation] = useState(false);
  const scrollToBottom = useRef<() => void>(() => {});
  const voice = (voiceMessage?.useRecorder ?? noVoice)({ controller, config: voiceMessage, attachments, labels, activeController: active, admitted: () => timeline ? timeline.afterSend?.() : scrollToBottom.current() });
  // A reply's Fork button calls the host's latest `fork`; the row context changes only when forking is switched on or off.
  const fork = useRef(conversations?.fork); fork.current = conversations?.fork;
  const canFork = Boolean(conversations?.fork);
  const rowExtras = useMemo(() => canFork ? { onFork: (entryId: string) => { void fork.current?.(entryId).catch(() => {}); } } : undefined, [canFork]);
  const session = useChatSession({ controller, activeController: active, mode, presentation, actions, renderEntry, hideLine, historicalMessageActions, unread, replyError, renderTool, toolRenderers, renderText, cards, groupTool, commandMentions, onOpenImage, onCopy, onComposerKeyDown, onFiles, fileAccept,
    slash, mentions, attachments, model, effort, artifacts, messageActions, replyFooter, afterSend: () => timeline ? timeline.afterSend?.() : scrollToBottom.current(), feedback, rowExtras, onOpenFile, fileChanges, pasteToFile, composerChips, composerHeader, composerHasContent, onPickFiles });
  const { state, derived, rows, queued, queueActions, working, waitingForAnswer, connected, error, act, textarea, rowContext, composer, files, loading } = session;
  const voiceRows = pendingVoice ?? voice.pending;
  const VoiceButton = voiceMessage?.Button, VoiceBubbleView = voiceMessage?.Bubble ?? NoVoiceBubble;
  const transcriptRows: readonly TranscriptRow[] = [
    ...rows.map(row => ({ key: row.key, kind: 'native' as const, row })),
    ...voiceRows.map(voice => ({ key: `voice:${voice.id}`, kind: 'voice' as const, voice })),
  ];
  const pendingRows = voiceRows.map(item => <MessageScrollerItem key={`voice:${item.id}`} messageId={`voice:${item.id}`} data-local-voice="" className="[content-visibility:visible]"><VoiceBubbleView pending={item} /></MessageScrollerItem>);
  const empty = (timeline ? timeline.count === 0 : session.empty) && voiceRows.length === 0;
  const conversationFiles = new Map(files.map(file => [file.id, file]));
  for (const item of voiceRows) if (item.path && !conversationFiles.has(`file:${item.path}`)) {
    const path = item.path, open = onOpenFile ?? mentions?.open;
    conversationFiles.set(`file:${path}`, { id: `file:${path}`, name: displayName(path), open: open ? () => open(path) : undefined });
  }
  const { pinned, retry } = derived;
  const showPreparing = preparing({ natural: session.natural, waitingForAnswer, run: derived.run, retry, compacting: derived.compacting, stop: state.stop });
  const transcript = useTranscript(transcriptRows, displayLimit ?? PAGE, MORE, { state: state.history, connected: !state.disposed && connected, load: controller.loadEarlier }, displayLimit === undefined);
  const { stick, hidden } = transcript;
  scrollToBottom.current = () => { transcript.reset(); void stick.scrollToBottom('instant'); };
  const visible = transcript.visible(transcriptRows);
  const { barStart, barNote } = session.pickers();
  const connectionKind = state.connection.kind;
  const [renamingTitle, setRenamingTitle] = useState(false);
  const [titleError, setTitleError] = useState(false);
  const page = useRef<HTMLElement>(null);
  useEffect(() => {
    const viewport = globalThis.visualViewport;
    if (!keyboardInset || !viewport) return;
    const element = page.current;
    if (!element) return;
    const measure = () => element.style.setProperty('--composer-keyboard-inset', `${Math.max(0, element.getBoundingClientRect().bottom - viewport.height - viewport.offsetTop)}px`);
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(element);
    measure(); viewport.addEventListener('resize', measure); viewport.addEventListener('scroll', measure);
    return () => { observer?.disconnect(); viewport.removeEventListener('resize', measure); viewport.removeEventListener('scroll', measure); };
  }, []);

  return <section ref={page} data-boring="pi-chat" data-connection={connectionKind} data-empty={empty && !loading ? emptyLayout : undefined} aria-label={title} className={cn('pi-chat relative box-border flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background text-foreground ', keyboardInset && 'max-[641px]:pb-(--composer-keyboard-inset)', empty && emptyLayout === 'centered' && 'min-[641px]:justify-center', className)}>
    {header && <header className={cn(empty && emptyLayout === 'centered' && 'min-[641px]:absolute min-[641px]:inset-x-0 min-[641px]:top-0', 'flex h-13 shrink-0 items-center gap-2 px-3 sm:gap-3 sm:px-4')}>
      {headerStart}
      {avatar && <Avatar data-testid="chat-avatar" className="overflow-hidden"><AvatarFallback className="*:max-h-full *:max-w-full">{avatar}</AvatarFallback></Avatar>}
      {renamingTitle && onRenameTitle ? <form className="min-w-0 flex-1" onSubmit={event => { event.preventDefault(); const value = new FormData(event.currentTarget).get('title')?.toString().trim(); if (value) { setTitleError(false); void Promise.resolve().then(() => onRenameTitle(value)).catch(() => setTitleError(true)); } setRenamingTitle(false); }}>
        <Input name="title" aria-label={labels.conversationName} maxLength={200} autoFocus defaultValue={conversationTitle ?? title} onBlur={() => setRenamingTitle(false)} onKeyDown={event => { if (event.key === 'Escape') setRenamingTitle(false); }} className="w-full min-w-0" />
      </form> : <h2 className="m-0 min-w-0 flex-1 truncate font-(family-name:--chat-display) text-sm font-medium tracking-tight max-[641px]:text-center">{onRenameTitle ? <Button variant="ghost" className="max-w-full" onClick={() => setRenamingTitle(true)}><span className="truncate">{conversationTitle ?? title}</span></Button> : conversationTitle ?? title}</h2>}
      {showHistory && conversations && historyList && <Button variant="ghost" size="sm" data-testid="history-open" aria-haspopup="dialog" aria-expanded={pickingConversation} disabled={state.disposed}
        onClick={() => setPickingConversation(open => !open)}><icons.history data-icon="inline-start" aria-hidden="true" />{labels.history}</Button>}
      <BlockActions actions={headerActions} testId="chat-action" menuLabel={labels.moreActions} />
      {showConnectionStatus && <ConnectionBadge kind={connectionKind} />}
      {controls}
    </header>}

    {titleError && <p role="alert" className="m-0 shrink-0 px-4 py-2 text-sm text-destructive">{labels.actionFailed}</p>}
    {decisions && <><div data-boring="required-decisions" className="shrink-0 px-4 py-2">{decisions}</div><Separator /></>}
    {pinned.length > 0 && <><aside aria-label={labels.requiredActions} className="shrink-0 space-y-2 px-4 py-2">{pinned.map(card => <div key={card.key}>{card.content}</div>)}</aside><Separator /></>}
    {(connectionKind === 'error' || connectionKind === 'closed') && <div className="shrink-0 px-4 pt-2">
      <Notice tone={connectionKind === 'error' ? 'error' : 'info'} testid="connection-notice">
        <span className="flex-1">{connectionKind === 'error' ? state.connection.kind === 'error' && renderConnectionError ? renderConnectionError(state.connection.error) : labels.loadFailed : labels.disconnected}</span>
        {!state.disposed && <Button size="sm" variant="outline" onClick={() => act(controller.connect)}><icons.reconnect data-icon="inline-start" aria-hidden="true" />{labels.reconnect}</Button>}
      </Notice></div>}
    {pickingConversation && conversations && historyList && <ConversationHistory conversations={conversations} onClose={() => setPickingConversation(false)} />}

    <div data-testid="conversation-content" className={cn('relative min-h-0 flex-1', empty && emptyLayout === 'centered' && 'min-[641px]:min-h-60 min-[641px]:flex-none')}>
      {timeline ? timeline.render({ focusComposer: () => textarea.current?.focus(), openFile: onOpenFile ?? mentions?.open, pendingVoice: pendingRows }) : <MessageScroller>
        <MessageScrollerViewport ref={stick.scrollRef} data-testid="transcript-scroll" aria-label={labels.messages} className="min-h-0 flex-1 scrollbar-thumb-border scrollbar-track-transparent">
          {!empty && <TranscriptHistory history={state.history} connected={!state.disposed && connected} onLoad={transcript.reveal} sentinelRef={transcript.sentinelRef} hidden={hidden} loaded={transcript.loaded} />}
          <div className="mx-auto w-full max-w-[720px] px-4 pt-6 pb-8 sm:px-6">
          <MessageScrollerContent aria-label={labels.messages} aria-live="polite" data-testid="transcript">
            {visible.map(item => <MessageScrollerItem key={item.key} messageId={item.key} data-local-voice={item.kind === 'voice' ? '' : undefined} className="[content-visibility:visible]">{item.kind === 'native' ? <RowView row={item.row} context={rowContext} /> : <VoiceBubbleView pending={item.voice} />}</MessageScrollerItem>)}
          </MessageScrollerContent>
          </div>
        </MessageScrollerViewport>
        {!empty && <div data-testid="transcript-navigation" className="flex h-12 shrink-0 items-center justify-center">{!stick.isAtBottom && <MessageScrollerButton className="static inset-auto translate-x-0" data-testid="jump-latest" aria-label={labels.jumpToLatest} title={labels.jumpToLatest} onClick={transcript.reset}><icons.jumpToLatest aria-hidden="true" /></MessageScrollerButton>}</div>}
      </MessageScroller>}
      {(empty || loading) && <div className="pointer-events-none absolute inset-0">
        <div className="pointer-events-auto h-full">
          {loading ? <p role="status" data-testid="loading" className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2Icon className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />{labels.loading}</p>
            : emptyState ?? <EmptyState title={title} description={labels.emptyDescription} {...(avatar ? { avatar } : {})} {...(suggestions ? { suggestions } : {})} onSelect={text => { controller.setText(text); textarea.current?.focus(); }} />}
        </div></div>}
    </div>

    <footer data-testid="composer-dock" className="shrink-0 px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
      <div className="mx-auto w-full max-w-[720px] space-y-2">
        <div {...(session.natural ? {} : { 'aria-live': 'polite' as const })} className="space-y-2 empty:hidden">
          {session.natural ? showPreparing && <PreparingStatus>{derived.stageStatus}</PreparingStatus> : working && <p role="status" data-testid="agent-status" className="m-0 flex items-center gap-2 px-1 text-xs text-muted-foreground">
            <Shimmer active={!waitingForAnswer}>{waitingForAnswer ? labels.waitingForAnswer : retry ? labels.retryPending : labels.agentWorking}</Shimmer></p>}
          {!session.natural && derived.compacting && <p role="status" className="m-0 px-1 text-xs text-muted-foreground">{labels.compacting}</p>}
          <ChatNotices natural={session.natural} state={state} error={error} onReconcile={() => act(controller.reconcile)} onRetry={() => act(controller.retrySameRequest)} />
        </div>
        <div>
          <ConversationFiles files={[...conversationFiles.values()]} />
          <MessageQueue items={queued} sending={state.outbox} withdraw={actions?.withdraw} actions={queueActions} />
          {voice.problem && <p role="alert" data-testid="voice-message-problem">{voice.problem}</p>}
          <Composer {...composer} layout={composerLayout} placeholder={labels.placeholder === 'Message the agent…' ? `Message ${title}…` : labels.placeholder} barStart={barStart} barNote={barNote} barEnd={voiceMessage && VoiceButton ? <>{tools}<VoiceButton voice={voice} disabled={state.disposed || !connected || state.send.kind === 'unknown'} /></> : tools} />
          {belowComposer !== undefined && <div data-testid="below-composer" className="pt-2">{belowComposer}</div>}
        </div>
      </div>
    </footer>
  </section>;
}
