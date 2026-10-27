'use client';

import { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { EntryRecord } from '@earendil-works/pi-durable';
import type { ImageContent, ToolCall, ToolResultMessage } from '@earendil-works/pi-ai';
import type { ChatAttachment, ChatHistoryState } from '@hachej/boring-ui-kit/native-chat';
import type { ChatController } from '@hachej/boring-ui-kit/native-chat';
import { useMessageScroller, useMessageScrollerScrollable } from '@/components/ui/message-scroller';
import { Button } from '@/components/ui/button';
import type { ComposerFeedback, ComposerProps, PendingUpload } from './composer';
import type { ConversationFile } from './conversation-files';
import type { AttachmentsConfig, EffortConfig, MentionsConfig, ModelConfig, ModelRef, PastedText, PasteToFile, SlashConfig } from './config';
import { displayName, looksLikeMarkdown, mentionToken, pieces } from './config';
import type { CommandMentions } from './config';
import type { ChatCards, ChatTextPart, RowContext } from './message';
import type { QueueActions, QueuedMessage } from './queue';
import type { AnswerOutcome, ChatArtifactsConfig } from './config';
import { derive, isFileBlock, object, queuedMessages, waitingForAnswer as waitsForAnswer } from './rows';
import type { ChatCard, Mode, Row } from './rows';
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


export type FilesHandler = (files: readonly File[], target: Pick<ReturnType<ChatController['getSnapshot']>, 'identity' | 'conversationId'> & { readonly signal: AbortSignal }) => Promise<readonly ChatAttachment[]>;

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

export function useChatSession(options: ChatSessionOptions) {
  const { controller, activeController: active, mode, presentation, actions, renderEntry, hideLine, historicalMessageActions, unread, replyError, renderTool: catchAll, toolRenderers, renderText, cards, groupTool, commandMentions, onOpenImage, onCopy, onComposerKeyDown, onFiles, fileAccept,
    slash, mentions, attachments, model, effort, artifacts, messageActions, replyFooter, afterSend, rowExtras, feedback, onOpenFile, fileChanges, pasteToFile, composerChips, composerHeader, composerHasContent, onPickFiles } = options;
  const { labels } = useChatText();
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(0);
  const [picked, setPicked] = useState<readonly string[]>([]);
  const [pending, setPending] = useState<readonly PendingUpload[]>([]);
  const [changing, setChanging] = useState<'model' | 'effort' | null>(null);
  const [changeError, setChangeError] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<{ readonly model?: ModelRef; readonly effort?: string }>({});
  const uploadIds = useRef(0);
  const uploads = useRef(new Set<AbortController>()), mounted = useRef(false);
  const textarea = useRef<HTMLTextAreaElement | null>(null);
  const current = () => mounted.current && active.current === controller && !controller.getSnapshot().disposed;
  // The latest text, for a connection failure that lands after the labels changed.
  const latestLabels = useRef(labels);
  useLayoutEffect(() => { latestLabels.current = labels; });
  useEffect(() => {
    mounted.current = true;
    const live = uploads.current;
    // A controller disposed before mount throws synchronously; the chat then renders its disposed state.
    if (!controller.getSnapshot().disposed) void controller.connect().catch(cause => {
      if (mounted.current && active.current === controller && !controller.getSnapshot().disposed) setError(cause instanceof Error ? cause.message : latestLabels.current.connectionFailed);
    });
    return () => { mounted.current = false; for (const upload of live) upload.abort(); live.clear(); };
  }, [controller, active]);

  const natural = presentation === 'natural';
  // A tool's own renderer comes first; `renderTool` stays the catch-all.
  const renderTool = useMemo(() => toolRenderers ? (call: ToolCall, result: ToolResultMessage | undefined) => (Object.hasOwn(toolRenderers, call.name) ? toolRenderers[call.name]?.(call, result) : undefined) ?? catchAll?.(call, result) : catchAll, [toolRenderers, catchAll]);
  const developer = mode === 'developer' && !natural;
  // Only the recogniser takes part in deriving rows; which card is open changes without rebuilding them.
  const offered = artifacts?.recognise && artifacts.Card ? artifacts : undefined;
  const recognise = offered?.recognise, detect = offered?.detect;
  const artifactDetect = useMemo(() => recognise ? { recognise, detect } : undefined, [recognise, detect]);
  const subagent = cards?.subagent;
  const derived = useMemo(() => derive(state.view, { mode, presentation, hideLine, renderEntry, renderTool, groupTool, artifacts: artifactDetect, subagent }), [state.view, mode, presentation, hideLine, renderEntry, renderTool, groupTool, artifactDetect, subagent]);
  const queued = useMemo(() => queuedMessages(state.view), [state.view]);
  const { run } = derived;
  const earlier = useMemo<readonly Row[]>(() => {
    if (!state.view || !('entries' in state.history)) return [];
    const activeIds = new Set(state.view.entries.map(entry => entry.id));
    const entries = state.history.entries.filter(entry => !activeIds.has(entry.id));
    return derive({ ...state.view, entries, docs: {} }, { mode, presentation, hideLine, renderEntry: undefined, renderTool: undefined, groupTool: undefined, artifacts: artifactDetect, subagent }).rows
      .map(row => ({ ...row, key: `history:${row.key}`, historical: true }));
  }, [state.view, state.history, mode, presentation, hideLine, artifactDetect, subagent]);
  const rows = useMemo(() => [...earlier, ...derived.rows], [earlier, derived.rows]);
  const files = useMemo(() => {
    const found = new Map<string, ConversationFile>();
    const open = onOpenFile ?? mentions?.open;
    const add = (path: string) => {
      const normalized = path.replace(/^\.\//, '');
      const id = `file:${normalized}`;
      if (!found.has(id)) found.set(id, { id, name: displayName(normalized), open: open ? () => open(normalized) : undefined });
    };
    for (const path of picked) add(path);
    for (const item of state.draft.attachments) found.set(`draft:${item.id}`, { id: `draft:${item.id}`, name: item.name, open: onOpenImage ? () => onOpenImage(item.content) : undefined });
    for (const row of derived.rows) {
      if (row.type === 'user') {
        const content = typeof row.message.content === 'string' ? [{ type: 'text' as const, text: row.message.content }] : row.message.content;
        for (const [index, part] of content.entries()) {
          if (part.type === 'text' && !isFileBlock(part.text)) for (const piece of pieces(part.text, { mentions: true, skills: [] })) { if (piece.kind === 'mention' && piece.value) add(piece.value); }
          if (part.type === 'image') { const id = `image:${row.key}:${index}`; found.set(id, { id, name: labels.imageAttachment, open: onOpenImage ? () => onOpenImage(part) : undefined }); }
        }
      }
      if (row.type !== 'assistant') continue;
      for (const part of row.parts) {
        if (part.kind === 'artifact' && part.artifact.state === 'ready' && part.artifact.path !== undefined) {
          const descriptor = part.artifact.descriptor as never, id = `file:${part.artifact.path.replace(/^\.\//, '')}`;
          found.set(id, { id, name: displayName(part.artifact.path), open: artifacts?.open ? () => artifacts.open(descriptor) : undefined });
        }
        if (!natural && part.kind === 'tool' && part.entry.result && !part.entry.result.isError && ['read', 'write', 'edit'].includes(part.entry.call.name)) {
          const path = part.entry.call.arguments['path'];
          if (typeof path === 'string') add(path);
        }
      }
    }
    return [...found.values()];
  }, [derived.rows, natural, picked, state.draft.attachments, artifacts, onOpenFile, mentions?.open, onOpenImage, labels.imageAttachment]);

  const report = (cause: unknown) => { if (current()) setError(cause instanceof Error ? cause.message : labels.actionFailedShort); };
  const act = (action: () => Promise<unknown>) => {
    setError(null);
    try { void action().catch(report); } catch (cause) { report(cause); }
  };
  // A send being confirmed does not block the next one: the controller empties the composer at once and queues the next message behind it.
  // Only a submission whose outcome is unknown blocks, until it is checked or retried.
  const unconfirmed = state.send.kind === 'unknown';
  const connected = state.connection.kind === 'connected';
  const sendBlocked = uploading > 0 || state.disposed || !connected || unconfirmed;
  /** Puts a message back into the composer ahead of whatever is there now (nothing is dropped). */
  const putBack = (text: string, images: readonly ChatAttachment[]) => {
    if (controller.getSnapshot().disposed) return;
    const draft = controller.getSnapshot().draft;
    controller.setText([text, draft.text].filter(value => value.trim()).join('\n'));
    if (images.length) controller.setAttachments([...images, ...draft.attachments.filter(item => !images.some(image => image.id === item.id))]);
  };
  const working = Boolean(run);
  const waitingForAnswer = waitsForAnswer(derived.rows);
  const send = () => {
    if (sendBlocked || !current()) return;
    const attach = feedback && feedback.count > 0 ? feedback.attach : undefined;
    if (attach) {
      // The pending feedback goes with this message: the host attaches it to the text, then the native send reads the draft.
      act(async () => {
        // Like any send, the composer empties at once; the person's own text comes back if the feedback or the message is refused.
        const typed = controller.getSnapshot().draft;
        controller.setText(''); controller.setAttachments([]);
        let attached: Awaited<ReturnType<typeof attach>>;
        try { attached = await attach(typed.text); }
        catch (cause) { putBack(typed.text, typed.attachments); throw cause; }
        if (attached.kind === 'refused') { putBack(typed.text, typed.attachments); throw new Error(attached.reason); }
        if (!current()) { putBack(typed.text, typed.attachments); return; }
        const submission = await controller.send('followUp', { text: attached.text, attachments: typed.attachments, restore: { text: typed.text, attachments: typed.attachments } });
        if (submission) feedback?.sent();
      });
      afterSend?.();
      textarea.current?.focus();
      return;
    }
    act(() => controller.send('followUp'));
    afterSend?.();
    textarea.current?.focus();
  };
  // A queued message is taken back (withdrawn) before it is edited or steered; if Pi already placed it, that is reported and nothing is lost.
  async function takeBack(item: QueuedMessage) {
    if (!actions?.withdraw) throw new Error(labels.queueLocked);
    const outcome = await actions.withdraw(item.id);
    if (outcome === 'already_placed' || outcome === 'settled') throw new Error(labels.tooLate);
  }
  const queuedContent = (item: QueuedMessage) => {
    const parts = Array.isArray(item.content) ? item.content as readonly { type?: unknown; text?: unknown; data?: unknown; mimeType?: unknown }[] : [];
    const text = typeof item.content === 'string' ? item.content : parts.flatMap(part => part?.type === 'text' && typeof part.text === 'string' && !isFileBlock(part.text) ? [part.text] : []).join('\n');
    const images: ChatAttachment[] = parts.flatMap((part, index) => part?.type === 'image' && typeof part.data === 'string' && typeof part.mimeType === 'string'
      ? [{ id: `queued-${String(item.id)}-${index}`, name: `image-${index + 1}`, content: { type: 'image' as const, data: part.data, mimeType: part.mimeType } }] : []);
    return { text, images };
  };
  const queueActions: QueueActions | undefined = actions?.withdraw ? {
    edit: async item => {
      await takeBack(item);
      const { text, images } = queuedContent(item), draft = controller.getSnapshot().draft;
      controller.setText(draft.text.trim() ? `${text}\n${draft.text}` : text);
      if (images.length) controller.setAttachments([...draft.attachments, ...images]);
      textarea.current?.focus();
    },
    steer: async item => {
      if (sendBlocked) throw new Error(labels.waitToSteer);
      await takeBack(item);
      const { text, images } = queuedContent(item);
      // Sent as explicit content, so the person's own draft is never touched; a refused steer comes back into the composer (the controller
      // puts it back), an unknown one is held for checking.
      try {
        const submission = await controller.send('steer', { text, attachments: images });
        if (!submission && current() && controller.getSnapshot().send.kind === 'blocked') setError(labels.steerRefused);
      } catch (cause) { putBack(text, images); if (current()) setError(cause instanceof Error ? cause.message : labels.steerFailed); }
    },
  } : undefined;
  const addMentions = (paths: readonly string[]) => {
    const text = controller.getSnapshot().draft.text;
    controller.setText(`${text}${text && !/\s$/.test(text) ? ' ' : ''}${paths.map(mentionToken).join(' ')} `);
    setPicked(value => [...new Set([...value, ...paths])]);
  };
  /** Uploads files; `restore` (a pasted text) is what their pending cards undo: it abandons the upload and puts the text back. */
  async function upload(files: readonly File[], paste?: { readonly restore: () => void; readonly after: string }) {
    if (!files.length || !current()) return;
    if (onPickFiles) { onPickFiles(files); return; }
    if (!onFiles && !attachments) return;
    const abort = new AbortController(); uploads.current.add(abort); setUploading(value => value + 1);
    const ids = files.map(() => `upload-${++uploadIds.current}`);
    const settle = (failure?: string) => setPending(items => failure === undefined ? items.filter(item => !ids.includes(item.id))
      : items.map(item => ids.includes(item.id) ? { ...item, state: 'failed', error: failure } : item));
    const cancel = paste && (() => { abort.abort(); setPending(items => items.filter(item => !ids.includes(item.id))); paste.restore(); });
    setPending(items => [...items, ...files.map((file, index): PendingUpload => ({ id: ids[index]!, name: file.name, state: 'uploading',
      ...(cancel && paste ? { cancel, restoreWhile: paste.after } : {}) }))]);
    try {
      let added: readonly ChatAttachment[] = [];
      let paths: string[] = [];
      if (attachments) {
        for (const result of await attachments.upload([...files], abort.signal)) {
          if (result.image) added = [...added, { id: `image-${Date.now()}-${++uploadIds.current}`, name: result.name, content: { type: 'image', data: result.image.data, mimeType: result.image.mimeType } }];
          else if (result.path) paths = [...paths, result.path];
        }
      } else added = await onFiles!(files, { identity: state.identity, conversationId: state.conversationId, signal: abort.signal });
      if (current() && !abort.signal.aborted) {
        if (added.length) controller.setAttachments([...controller.getSnapshot().draft.attachments, ...added]);
        if (paths.length) addMentions(paths);
        settle();
      }
    } catch (cause) { if (!abort.signal.aborted) { settle(cause instanceof Error ? cause.message : labels.uploadFailedShort); if (!attachments) report(cause); } }
    finally { uploads.current.delete(abort); if (current()) setUploading(value => value - 1); }
  }
  /** A paste the composer took: saved as a file under `uploads/` (Send then references it). Cancelling puts the text back where it was pasted. */
  const pasteText = (paste: PastedText) => {
    if (!attachments || !current()) return;
    const at = new Date(), two = (value: number) => String(value).padStart(2, '0');
    const stamp = `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} ${two(at.getHours())}-${two(at.getMinutes())}-${two(at.getSeconds())}`;
    const markdown = looksLikeMarkdown(paste.text);
    const file = new File([paste.text], `${labels.pastedFileName(stamp)}${markdown ? '.md' : '.txt'}`, { type: markdown ? 'text/markdown' : 'text/plain' });
    // The pasted text replaces its selection when the paste is accepted, so the draft shows what is left. Restoring inserts the text at
    // the same place and deletes nothing: whatever was typed since stays.
    const draft = controller.getSnapshot().draft.text;
    const start = Math.min(paste.start, draft.length), end = Math.min(Math.max(paste.end, start), draft.length);
    const after = `${draft.slice(0, start)}${draft.slice(end)}`;
    controller.setText(after);
    const restore = () => {
      if (!current()) return;
      const now = controller.getSnapshot().draft.text;
      const at = Math.min(start, now.length);
      controller.setText(`${now.slice(0, at)}${paste.text}${now.slice(at)}`);
      textarea.current?.focus();
    };
    void upload([file], { restore, after });
  };
  const agentDoc = object(state.view?.docs['pi.agent']);
  const currentModel = object(agentDoc?.['model']);
  const viewModel: ModelRef | undefined = typeof currentModel?.['provider'] === 'string' && typeof currentModel['modelId'] === 'string' ? { provider: currentModel['provider'], modelId: currentModel['modelId'] } : undefined;
  const viewEffort = typeof agentDoc?.['thinkingLevel'] === 'string' ? agentDoc['thinkingLevel'] : undefined;
  // Show the accepted choice until the watch delivers it, so the label does not flicker back.
  useEffect(() => {
    const same = optimistic.model && viewModel && optimistic.model.provider === viewModel.provider && optimistic.model.modelId === viewModel.modelId;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- drops the optimistic choice once the watch delivers it; runs only when it matches, so it settles
    if (same || (optimistic.effort !== undefined && optimistic.effort === viewEffort)) setOptimistic(value => ({ ...(same ? {} : value.model ? { model: value.model } : {}), ...(optimistic.effort === viewEffort ? {} : value.effort ? { effort: value.effort } : {}) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- viewModel is rebuilt every render; its provider and modelId are what it compares
  }, [optimistic, viewModel?.provider, viewModel?.modelId, viewEffort]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- cleared text drops the picked mentions once, after commit; the updater keeps an empty list as is
  useEffect(() => { if (!state.draft.text) setPicked(value => value.length ? [] : value); }, [state.draft.text]);
  async function change(kind: 'model' | 'effort', apply: () => Promise<void>, accepted: () => void, rejected: () => void) {
    if (changing || !current()) return;
    setChanging(kind); setChangeError(null);
    try { await apply(); if (current()) accepted(); }
    catch (cause) { if (current()) { rejected(); setChangeError(cause instanceof Error && cause.message ? cause.message : labels.changeRefused); } }
    finally { if (current()) setChanging(null); }
  }
  const activateMention = (command: { readonly name: string; readonly behavior: 'execute' | 'insert' }) => {
    if (!current() || controller.getSnapshot().connection.kind !== 'connected') return;
    const catalog = commandMentions;
    const selected = catalog?.commands.find(item => item.name === command.name && item.behavior === command.behavior);
    if (catalog && selected) act(async () => catalog.onActivate({ name: selected.name, behavior: selected.behavior }));
  };
  const rowContext = useMemo<RowContext>(() => ({
    developer, natural, renderText, cards, groupTool, onOpenImage, onCopy, openFile: onOpenFile ?? mentions?.open, fileChanges,
    commandMentions: commandMentions ? { commands: commandMentions.commands, onActivate: activateMention } : undefined,
    answer: actions?.answer,
    artifacts: offered?.Card ? { open: offered.open, isOpen: offered.isOpen, kinds: offered.kinds, Card: offered.Card } : undefined,
    messageActions, historicalMessageActions, unread, replyError,
    replyFooter,
    pieces: slash?.skills?.length || mentions || attachments ? { mentions: Boolean(mentions), uploads: Boolean(attachments), skills: (slash?.skills ?? []).map(skill => skill.name), openMention: mentions?.open, renderMention: mentions?.renderSent ?? mentions?.render, preview: mentions?.preview, audioUrl: mentions?.audioUrl } : undefined,
    ...rowExtras,
  // eslint-disable-next-line react-hooks/exhaustive-deps -- lists the fields rows read, not whole objects: activateMention changes every render and must not rebuild every row.
  }), [controller, developer, natural, renderText, cards, groupTool, onOpenImage, onCopy, onOpenFile, fileChanges, commandMentions, actions?.answer, slash?.skills, mentions, mentions?.open, mentions?.render, mentions?.renderSent, mentions?.preview, mentions?.audioUrl, attachments, offered?.open, offered?.isOpen, offered?.kinds, offered?.Card, messageActions, historicalMessageActions, unread, replyError, replyFooter, rowExtras]);

  /** The model-and-effort pill and the note that reports a refused change. */
  const pickers = () => {
    const disabled = changing !== null || state.disposed || !connected;
    // The pill is drawn by the component the config carries (`pi-chat-pickers`); without one there is no pill.
    const Picker = model?.Picker ?? effort?.Picker;
    const barStart = (model || effort) && Picker ? <Picker model={model} effort={effort} currentModel={optimistic.model ?? viewModel} currentEffort={optimistic.effort ?? viewEffort} disabled={disabled} busy={changing}
      onModel={next => void change('model', () => model!.change(next), () => setOptimistic(value => ({ ...value, model: next })), () => {})}
      onEffort={next => void change('effort', () => effort!.change(next), () => setOptimistic(value => ({ ...value, effort: next })), () => {})} /> : undefined;
    const barNote = changeError ? <Button variant="ghost" size="sm" role="alert" data-testid="configure-error" title={`${changeError} (${labels.dismissHint})`} onClick={() => setChangeError(null)}
      className="min-w-0 max-w-[16rem]"><span className="truncate">{changeError}</span></Button> : undefined;
    return { barStart, barNote };
  };

  const empty = connected && !state.view?.entries.length && !rows.length;
  const loading = (state.connection.kind === 'idle' || state.connection.kind === 'connecting') && !state.view;

  const camera = attachments ? attachments.Camera : options.camera;
  /** Everything `Composer` needs from the session; a surface adds its layout and slots. */
  const composer = {
    text: state.draft.text, onText: (text: string) => controller.setText(text), onKeyDown: onComposerKeyDown, textareaRef: textarea,
    attachments: state.draft.attachments.map(item => ({ id: item.id, name: item.name, mimeType: item.content.mimeType, data: item.content.data })),
    onRemoveAttachment: (id: string) => controller.setAttachments(controller.getSnapshot().draft.attachments.filter(item => item.id !== id)),
    working, sendBlocked, disabled: state.disposed, stopRequested: state.stop === 'requested',
    onSend: send, onStop: () => act(controller.stop),
    hasFiles: Boolean(composerHasContent),
    uploading: uploading > 0, canAttach: Boolean(onPickFiles || onFiles || attachments), ...(camera ? { camera } : {}), fileAccept: attachments ? attachments.accept ?? '' : fileAccept, onPickFiles: (files: readonly File[]) => { void upload(files); },
    slash, onSlashError: report, mentions, mentionPaths: picked, onMentionPicked: (path: string) => setPicked(value => value.includes(path) ? value : [...value, path]),
    uploads: pending, onDismissUpload: (id: string) => setPending(items => items.filter(item => item.id !== id)),
    onPasteText: attachments ? pasteText : undefined, pasteToFile,
    quote: composerHeader,
    feedback, chips: composerChips,
  };

  return { state, derived, rows, queued, queueActions, working, waitingForAnswer, connected, sendBlocked, error, setError, report, act, current, textarea, rowContext, composer, files, pickers, empty, loading, developer, natural };
}

export type ChatSession = ReturnType<typeof useChatSession>;

export interface ChatPaging { readonly first?: number; readonly more?: number }
export const PAGE_FIRST = 60, PAGE_MORE = 40, CHUNK = 20;

/**
 * Rows grouped into runs of at most `size` keys, kept stable across renders. Rows already placed never change run: rows revealed
 * above form new runs (the run nearest the old top is the full one), rows added below fill the last run, then start new ones.
 */
export function chunkKeys(previous: readonly (readonly string[])[], keys: readonly string[], size = CHUNK): string[][] {
  const owner = new Map<string, number>();
  previous.forEach((run, index) => { for (const key of run) owner.set(key, index); });
  const known = keys.findIndex(key => owner.has(key));
  const lead = known < 0 ? keys.length : known;
  const runs: string[][] = [];
  for (let end = lead; end > 0; end -= size) runs.unshift(keys.slice(Math.max(0, end - size), end));
  let current: string[] = [], from: number | undefined;
  for (const key of keys.slice(lead)) {
    const placed = owner.get(key);
    if (!current.length || (placed !== undefined ? placed !== from : current.length >= size)) { current = []; runs.push(current); from = placed; }
    current.push(key);
  }
  return runs;
}

/**
 * The scroller measures every one of its items on each scroll event and frame (@shadcn/react 0.3.1), so a long transcript gives it
 * runs of `CHUNK` rows instead of single rows: 500 messages are 25 measurements, not 500. A run keeps its element while rows are
 * revealed above it, so the scroller's prepend anchor still holds; a run's array is reused while its rows are unchanged.
 */
export function useRowChunks<T extends { readonly key: string }>(rows: readonly T[], size = CHUNK): readonly (readonly T[])[] {
  // A derived cache of the last runs, read and replaced inside the memo only: the same rows always give the same runs.
  const previous = useRef<{ readonly keys: readonly (readonly string[])[]; readonly runs: ReadonlyMap<string, readonly T[]> }>({ keys: [], runs: new Map() });
  return useMemo(() => {
    const byKey = new Map(rows.map(row => [row.key, row]));
    // eslint-disable-next-line react-hooks/refs -- reads the run cache to keep run boundaries and arrays stable; no setState, no render loop
    const keys = chunkKeys(previous.current.keys, rows.map(row => row.key), size);
    // eslint-disable-next-line react-hooks/refs -- the mapper reuses the cached array of an unchanged run (see above)
    const runs = keys.map(run => {
      const items = run.map(key => byKey.get(key)!);
      const before = previous.current.runs.get(run[0]!);
      return before && before.length === items.length && before.every((item, index) => item === items[index]) ? before : items;
    });
    // eslint-disable-next-line react-hooks/refs -- stores the runs for the next rows; a cache write, not state, so it triggers no render
    previous.current = { keys, runs: new Map(runs.map(run => [run[0]!.key, run])) };
    return runs;
  }, [rows, size]);
}

/** One scroll root for current and archived rows. Native paging stays in the borrowed controller. */
export function useTranscript(rows: readonly { readonly key: string }[], page = PAGE_FIRST, more = PAGE_MORE, history?: { readonly state: ChatHistoryState; readonly connected: boolean; readonly load: () => Promise<void> }, automatic = true) {
  if (!Number.isSafeInteger(page) || page < 1) throw new TypeError('Chat displayLimit must be a positive integer');
  if (!Number.isSafeInteger(more) || more < 1) throw new TypeError('Chat paging.more must be a positive integer');
  const [limit, setLimit] = useState(page);
  const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null);
  const [loaded, setLoaded] = useState(0);
  const pending = useRef(false);
  const anchor = useRef<{ readonly length: number; readonly limit: number } | undefined>(undefined);
  const { scrollToEnd } = useMessageScroller();
  const scrollable = useMessageScrollerScrollable();
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const scrollToBottom = useCallback((behavior?: 'instant') => scrollToEnd({ behavior: behavior === 'instant' ? 'instant' : 'smooth' }), [scrollToEnd]);
  const stick = { scrollRef: setScroller, scrollToBottom, isAtBottom: !scrollable.end };
  const hidden = Math.max(0, rows.length - limit);
  const historyState = history?.state, historyConnected = history?.connected, historyLoad = history?.load;
  const reveal = useCallback(() => {
    if (pending.current || anchor.current) return;
    const state = historyState;
    if (hidden === 0 && (!historyConnected || !state || state.kind === 'disabled' || state.kind === 'loading' || state.kind === 'ready' && !state.hasMore)) return;
    anchor.current = { length: rows.length, limit };
    // A revealed page renders as a transition: React mounts it in small slices, so scrolling stays responsive meanwhile.
    if (hidden > 0) startTransition(() => setLimit(value => value + more));
    else if (historyLoad) {
      pending.current = true;
      void Promise.resolve().then(historyLoad).catch(() => { anchor.current = undefined; }).finally(() => { pending.current = false; });
    }
  }, [hidden, historyState, historyConnected, historyLoad, rows.length, limit, more]);
  useLayoutEffect(() => {
    const saved = anchor.current;
    if (!scroller || !saved || history?.state.kind === 'loading') return;
    const added = Math.max(0, rows.length - saved.length);
    if (limit < saved.limit + added) { startTransition(() => setLimit(saved.limit + added)); return; }
    anchor.current = undefined;
    setLoaded(count => count + Math.max(0, Math.min(rows.length, limit) - Math.min(saved.length, saved.limit)));
  }, [rows, limit, scroller, history?.state]);
  // Automatic paging: the sentinel near the top, once the reader has been away from the top (so the mount, which starts at the
  // top before the scroller settles at the end, loads nothing). A fast scroll lands on 0 before the sentinel is seen: the scroll
  // listener and every new observer (after each page) check again, instead of the reader's distance at that one moment.
  const near = useRef(false), away = useRef(false), revealNow = useRef(reveal);
  useLayoutEffect(() => { revealNow.current = reveal; });
  useEffect(() => {
    if (!automatic || !scroller) return;
    const onScroll = () => { if (scroller.scrollTop > 8) away.current = true; if (near.current && away.current) revealNow.current(); };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, [automatic, scroller]);
  useEffect(() => {
    if (!automatic || !scroller || !sentinel || typeof IntersectionObserver === 'undefined' || history?.state.kind === 'loading' || history?.state.kind === 'error') return;
    const observer = new IntersectionObserver(entries => {
      near.current = entries.at(-1)?.isIntersecting ?? near.current;
      if (near.current && (scroller.scrollHeight <= scroller.clientHeight || away.current)) reveal();
    }, { root: scroller, rootMargin: '240px 0px 0px' });
    observer.observe(sentinel);
    return () => { observer.disconnect(); near.current = false; };
  }, [automatic, scroller, sentinel, reveal, history?.state]);
  const revealTo = (key: string) => { const index = rows.findIndex(row => row.key === key); if (index >= 0) setLimit(value => Math.max(value, rows.length - index)); };
  return { stick, hidden, reveal, revealTo, sentinelRef: setSentinel, loaded, visible: <T,>(items: readonly T[]): readonly T[] => hidden ? items.slice(hidden) : items, reset: () => { anchor.current = undefined; setLimit(page); } };
}
