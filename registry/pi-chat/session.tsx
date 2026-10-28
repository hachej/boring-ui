'use client';

import { useCallback, useMemo, useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { EntryRecord } from '@earendil-works/pi-durable';
import type { ImageContent, ToolCall, ToolResultMessage } from '@earendil-works/pi-ai';
import { PAGE_FIRST, PAGE_MORE, useTranscriptWindow } from '@hachej/boring-ui-kit/chat-react';
import type { ChatPaging } from '@hachej/boring-ui-kit/chat-react';
import type { ChatHistoryState } from '@hachej/boring-ui-kit/native-chat';
import type { ChatController } from '@hachej/boring-ui-kit/native-chat';
import { useMessageScroller, useMessageScrollerScrollable } from '@/components/ui/message-scroller';
import { Button } from '@/components/ui/button';
import type { ComposerFeedback, ComposerProps } from './composer';
import type { AttachmentsConfig, EffortConfig, MentionsConfig, ModelConfig, SlashConfig } from './config';
import type { PasteToFile } from '@hachej/boring-ui-kit/chat-text';
import type { CommandMentions } from './config';
import type { ChatCards, ChatTextPart, RowContext } from './message';
import type { QueuedMessage } from './queue';
import type { AnswerOutcome, ChatArtifactsConfig } from './config';
import type { ChatCard, Mode } from './rows';
import { useChatText } from './labels';
import type { BlockAction } from '../button/actions';
import type { ReplyRef } from './config';

/** What the host lets the person do beyond typing. Pass `remote.answer` and `remote.withdraw` from `createRemoteChat()`. */
export interface PiChatActions {
  /** Resolve a pending `ask_user` question. Without it, question cards are read-only. */
  readonly answer?: (questionId: string, answer: string) => Promise<AnswerOutcome>;
  /** Withdraw a queued message before Pi places it. Without it, queued messages cannot be cancelled. */
  readonly withdraw?: (id: QueuedMessage['id']) => Promise<unknown>;
}

/** The props `PiChat` and `AmbientChat` both take and hand to `useChatSession`. */
export interface ChatFeatureProps {
  /** `expert` hides successful tool details and reasoning; `developer` shows everything. */
  readonly mode?: Mode;
  /** `natural` shows only messages, replies and question, approval and artifact cards, with one "Preparing…" status while the agent works: no tool steps, reasoning, file discovery or raw error text. Omit it and nothing changes. */
  readonly presentation?: 'natural';
  /** Show a retained voice message's audio player. Default false: transcript only; uploaded audio and stored tokens are unchanged. */
  readonly voiceReplay?: boolean;
  readonly actions?: PiChatActions;
  readonly renderEntry?: (entry: EntryRecord) => ChatCard | undefined;
  /** Omit complete assistant lines from display, copy and actions. Live trailing fragments wait for a newline or settlement. Not transport redaction. */
  readonly hideLine?: (line: string) => boolean;
  /** Initial number of displayed rows (default 60). An explicit limit uses Show earlier, not automatic paging; nothing is deleted. */
  readonly displayLimit?: number;
  /** Automatic paging: rows shown first (default 60) and rows added each time the reader reaches the top (default 40). Ignored with `displayLimit`. */
  readonly paging?: ChatPaging;
  /** Explicitly enable messageActions for paged history too; other historical controls remain inert. */
  readonly historicalMessageActions?: boolean;
  /** Host-rendered unread indicator, keyed by the reply. The host owns seen state and its persistence. */
  readonly unread?: (reply: ReplyRef) => ReactNode;
  /** Message inside the single native response-error notice. Null/undefined keeps the default; native status and metadata stay unchanged. */
  readonly replyError?: (reply: ReplyRef) => ReactNode;
  /** Card for any tool call; the catch-all after `toolRenderers`. */
  readonly renderTool?: (call: ToolCall, result: ToolResultMessage | undefined) => ChatCard | undefined;
  /** Cards for tool calls, keyed by tool name (same contract as `renderTool`). An entry that returns undefined falls back to `renderTool`. */
  readonly toolRenderers?: Readonly<Record<string, (call: ToolCall, result: ToolResultMessage | undefined) => ChatCard | undefined>> | undefined;
  /** Draws an assistant text part. Default: plain text (`markdownText` of `pi-chat-markdown` draws Markdown). */
  readonly renderText?: ((part: ChatTextPart) => ReactNode) | undefined;
  /**
   * The question, approval and sub-agent cards (`pi-chat-question`, `pi-chat-approval`, `pi-chat-subagent`; `withChatPlugins` adds them all).
   * Without a question or approval card the chat shows that it waits for the person's answer, with no answer UI; without the sub-agent card a
   * sub-agent call is an ordinary tool step.
   */
  readonly cards?: ChatCards | undefined;
  readonly groupTool?: (call: ToolCall, result: ToolResultMessage) => boolean;
  readonly commandMentions?: CommandMentions;
  readonly onOpenImage?: (image: ImageContent) => void;
  readonly onCopy?: (text: string) => Promise<void>;
  readonly onComposerKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  readonly fileAccept?: string;
  /** Optional pills at the left of the composer's controls row. */
  readonly composerChips?: ComposerProps['chips'];
  /** Contextual host content above the input, for example a removable quote. */
  readonly composerHeader?: ReactNode;
  /** Host-owned content participates in send readiness without native image attachments. */
  readonly composerHasContent?: boolean;
  /** Retain files for the host's send operation instead of uploading immediately. */
  readonly onPickFiles?: (files: readonly File[]) => void;
  /** `/` menu of host commands and skills. Omit it and `/` is just text. */
  readonly slash?: SlashConfig;
  /** Show successful native write/edit paths as file cards under each reply. Off by default: only hosts with workspace file tools should opt in. */
  readonly fileChanges?: boolean;
  /** Opens a file from an upload or write/edit card. Falls back to mentions.open. */
  readonly onOpenFile?: (path: string) => void;
  /** Pastes above these limits become a file through `attachments` (on by default, 2000 characters or 40 lines). Needs `attachments`. */
  readonly pasteToFile?: PasteToFile;
  /** `@` workspace file mentions: a picker, composer chips and styled mentions in sent messages. */
  readonly mentions?: MentionsConfig;
  /** Attach button, paste and drop through the host's upload. Takes the place of `onFiles` and `fileAccept`. */
  readonly attachments?: AttachmentsConfig;
  /** Model picker in the composer bar. The current model comes from the view's `pi.agent` document. */
  readonly model?: ModelConfig;
  /** Thinking level picker in the composer bar. The current level comes from the view's `pi.agent` document. */
  readonly effort?: EffortConfig;
  /**
   * Artifact cards: tool results that carry a descriptor become a card that opens the artifact in the host's panel. The card and its recogniser
   * come from `pi-artifacts` (`withChatPlugins` adds them); without them, or without this prop, no artifact is offered.
   */
  readonly artifacts?: ChatArtifactsConfig;
  /**
   * Host actions under each settled reply, beside Copy (and Fork): `header` ones as buttons, `menu` ones in a "…" menu. Test ids
   * `reply-action-<id>`, the menu `reply-action-more`.
   */
  readonly messageActions?: ((reply: ReplyRef) => readonly BlockAction[]) | undefined;
  /** A line under each settled reply (for example the model that answered and the time it took), for the host to show to some people only. */
  readonly replyFooter?: ((reply: ReplyRef) => ReactNode) | undefined;
}


// Compatibility type export for one release.
export type { FilesHandler } from '@hachej/boring-ui-kit/chat-react';
import { useChatSession as useHeadlessChatSession } from '@hachej/boring-ui-kit/chat-react';
import type { FilesHandler } from '@hachej/boring-ui-kit/chat-react';

/** The chat behaviour every surface over a `NativeChatController` shares (`PiChat`, `AmbientChat`): sending, queue actions, uploads, pickers, rows. */
export interface ChatSessionOptions extends Readonly<{ [Key in keyof ChatFeatureProps]: ChatFeatureProps[Key] | undefined }> {
  readonly controller: ChatController;
  /** The controller the host currently passes; a surface that outlives its controller stops acting on the old one. */
  readonly activeController: { readonly current: ChatController };
  readonly mode: Mode;
  readonly fileAccept: string;
  readonly onFiles?: FilesHandler | undefined;
  /** The phone camera for an `onFiles` chat (`attachments.Camera` is used with `attachments`). */
  readonly camera?: AttachmentsConfig['Camera'];
  /** Runs after a message was accepted for sending (for example to scroll to the bottom). */
  readonly afterSend?: (() => void) | undefined;
  /** Extra attributes of the row context a surface needs (for example per-reply actions). */
  readonly rowExtras?: Partial<RowContext> | undefined;
  /** The optional annotate toggle: when notes are pending (`count` > 0), Send attaches them to the message first. */
  readonly feedback?: ComposerFeedback | undefined;
}

/** Presentation adapter; all session state and controller protocols live in the kit. */
export function useChatSession(options: ChatSessionOptions) {
  const { controller, activeController, mode, presentation, voiceReplay, actions, renderEntry, hideLine, historicalMessageActions, unread, replyError, renderTool, toolRenderers, renderText, cards, groupTool, commandMentions, onOpenImage, onCopy, onComposerKeyDown, onFiles, fileAccept,
    slash, mentions, attachments, model, effort, artifacts, messageActions, replyFooter, afterSend, rowExtras, feedback, onOpenFile, fileChanges, composerChips, composerHeader, composerHasContent, onPickFiles, pasteToFile } = options;
  const { labels } = useChatText();
  const textarea = useRef<HTMLTextAreaElement | null>(null);
  const offered = artifacts?.recognise && artifacts.Card ? artifacts : undefined;
  const sessionArtifacts = useMemo(() => offered?.recognise ? { recognise: offered.recognise, detect: offered.detect, open: offered.open } : undefined, [offered]);
  const session = useHeadlessChatSession<ReactNode>({ controller, activeController, mode, presentation, actions, renderEntry, hideLine, renderTool, toolRenderers,
    groupTool, subagent: cards?.subagent, onOpenImage, onFiles, mentions, slash, attachments, model, effort,
    artifacts: sessionArtifacts,
    afterSend, feedback, onOpenFile, onPickFiles, commandMentions, labels, onFocus: () => textarea.current?.focus() });
  const { state, developer, natural, connected, working, sendBlocked, act } = session;
  const rowContext = useMemo<RowContext>(() => ({
    developer, natural, voiceReplay, renderText, cards, groupTool, onOpenImage, onCopy, openFile: onOpenFile ?? mentions?.open, fileChanges,
    commandMentions: commandMentions ? { commands: commandMentions.commands, onActivate: session.activateMention } : undefined,
    answer: actions?.answer,
    artifacts: offered?.Card ? { open: offered.open, isOpen: offered.isOpen, kinds: offered.kinds, Card: offered.Card } : undefined,
    messageActions, historicalMessageActions, unread, replyError,
    replyFooter,
    pieces: slash?.skills?.length || mentions || attachments ? { kinds: mentions?.kinds, mentions: Boolean(mentions), uploads: Boolean(attachments), skills: (slash?.skills ?? []).map(skill => skill.name), openMention: mentions?.open, renderMention: mentions?.renderSent ?? mentions?.render, preview: mentions?.preview, audioUrl: mentions?.audioUrl } : undefined,
    ...rowExtras,
  // eslint-disable-next-line react-hooks/exhaustive-deps -- lists the fields rows read, not whole objects: activateMention changes every render and must not rebuild every row.
  }), [controller, developer, natural, voiceReplay, renderText, cards, groupTool, onOpenImage, onCopy, onOpenFile, fileChanges, commandMentions, actions?.answer, slash?.skills, mentions, mentions?.open, mentions?.render, mentions?.renderSent, mentions?.preview, mentions?.audioUrl, attachments, offered?.open, offered?.isOpen, offered?.kinds, offered?.Card, messageActions, historicalMessageActions, unread, replyError, replyFooter, rowExtras]);

  /** The model-and-effort pill and the note that reports a refused change. */
  const pickers = () => {
    const disabled = session.changing !== null || state.disposed || !connected;
    // The pill is drawn by the component the config carries (`pi-chat-pickers`); without one there is no pill.
    const Picker = model?.Picker ?? effort?.Picker;
    const barStart = (model || effort) && Picker ? <Picker model={model} effort={effort} currentModel={session.currentModel} currentEffort={session.currentEffort} disabled={disabled} busy={session.changing}
      onModel={next => void session.changeModel(next)}
      onEffort={next => void session.changeEffort(next)} /> : undefined;
    const barNote = session.changeError ? <Button variant="ghost" size="sm" role="alert" data-testid="configure-error" title={`${session.changeError} (${labels.dismissHint})`} onClick={session.dismissChangeError}
      className="min-w-0 max-w-[16rem]"><span className="truncate">{session.changeError}</span></Button> : undefined;
    return { barStart, barNote };
  };

  const camera = attachments ? attachments.Camera : options.camera;
  /** Everything `Composer` needs from the session; a surface adds its layout and slots. */
  const composer = {
    text: state.draft.text, onText: (text: string) => controller.setText(text), onKeyDown: onComposerKeyDown, textareaRef: textarea,
    attachments: state.draft.attachments.map(item => ({ id: item.id, name: item.name, mimeType: item.content.mimeType, data: item.content.data })),
    onRemoveAttachment: (id: string) => controller.setAttachments(controller.getSnapshot().draft.attachments.filter(item => item.id !== id)),
    working, sendBlocked, disabled: state.disposed, stopRequested: state.stop === 'requested',
    onSend: session.send, onStop: () => act(controller.stop),
    hasFiles: Boolean(composerHasContent),
    uploading: session.uploading > 0, canAttach: Boolean(onPickFiles || onFiles || attachments), ...(camera ? { camera } : {}), fileAccept: attachments ? attachments.accept ?? '' : fileAccept, onPickFiles: (files: readonly File[]) => { void session.upload(files); },
    slash, onSlashError: session.report, mentions, mentionPaths: session.picked, onMentionPicked: session.pickMention,
    uploads: session.pending, onDismissUpload: session.dismissUpload,
    onPasteText: attachments ? session.pasteText : undefined, pasteToFile,
    quote: composerHeader,
    feedback, chips: composerChips,
  };

  return { ...session, textarea, rowContext, composer, pickers };
}

export type ChatSession = ReturnType<typeof useChatSession>;

// Compatibility exports for one release; MessageScroller remains the only scroll owner.
export { chunkKeys, useRowChunks, PAGE_FIRST, PAGE_MORE, CHUNK } from '@hachej/boring-ui-kit/chat-react';
export type { ChatPaging } from '@hachej/boring-ui-kit/chat-react';

/** Thin presentation adapter to the host's shadcn MessageScroller. */
export function useTranscript(rows: readonly { readonly key: string }[], page = PAGE_FIRST, more = PAGE_MORE, history?: { readonly state: ChatHistoryState; readonly connected: boolean; readonly load: () => Promise<void> }, automatic = true) {
  const window = useTranscriptWindow(rows, page, more, history, automatic);
  const { scrollToEnd } = useMessageScroller();
  const scrollable = useMessageScrollerScrollable();
  const scrollToBottom = useCallback((behavior?: 'instant') => scrollToEnd({ behavior: behavior === 'instant' ? 'instant' : 'smooth' }), [scrollToEnd]);
  return { ...window, stick: { scrollRef: window.scrollRef, scrollToBottom, isAtBottom: !scrollable.end } };
}
