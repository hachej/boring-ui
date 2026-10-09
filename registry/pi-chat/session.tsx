'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { KeyboardEvent } from 'react';
import type { EntryRecord } from '@earendil-works/pi-durable';
import type { ImageContent, ToolCall, ToolResultMessage } from '@earendil-works/pi-ai';
import type { ChatAttachment, NativeChatController } from '@hachej/boring-ui-kit/native-chat';
import { useStickToBottom } from 'use-stick-to-bottom';
import type { ComposerFeedback, PendingUpload } from './composer';
import type { AttachmentsConfig, EffortConfig, MentionsConfig, ModelConfig, ModelRef, SlashConfig } from './config';
import { ModelEffortPicker } from './pickers';
import type { CommandMentions } from './markdown';
import type { RowContext } from './message';
import type { QueueActions, QueuedMessage } from './queue';
import type { AnswerOutcome } from './question-card';
import type { ArtifactsConfig } from './artifact';
import { derive, isFileBlock, object, queuedMessages } from './rows';
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
  readonly actions?: PiChatActions;
  readonly renderEntry?: (entry: EntryRecord) => ChatCard | undefined;
  readonly renderTool?: (call: ToolCall, result: ToolResultMessage | undefined) => ChatCard | undefined;
  readonly groupTool?: (call: ToolCall, result: ToolResultMessage) => boolean;
  readonly commandMentions?: CommandMentions;
  readonly onOpenImage?: (image: ImageContent) => void;
  readonly onCopy?: (text: string) => Promise<void>;
  readonly onComposerKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  readonly fileAccept?: string;
  /** `/` menu of host commands and skills. Omit it and `/` is just text. */
  readonly slash?: SlashConfig;
  /** `@` workspace file mentions: a picker, composer chips and styled mentions in sent messages. */
  readonly mentions?: MentionsConfig;
  /** Attach button, paste and drop through the host's upload. Takes the place of `onFiles` and `fileAccept`. */
  readonly attachments?: AttachmentsConfig;
  /** Model picker in the composer bar. The current model comes from the view's `pi.agent` document. */
  readonly model?: ModelConfig;
  /** Thinking level picker in the composer bar. The current level comes from the view's `pi.agent` document. */
  readonly effort?: EffortConfig;
  /** Artifact cards: tool results that carry a descriptor become a card that opens the artifact in the host's panel. Omit it and nothing changes. */
  readonly artifacts?: ArtifactsConfig;
  /**
   * Host actions under each settled reply, beside Copy (and Fork): `header` ones as buttons, `menu` ones in a "…" menu. Test ids
   * `reply-action-<id>`, the menu `reply-action-more`.
   */
  readonly messageActions?: ((reply: ReplyRef) => readonly BlockAction[]) | undefined;
}


export type FilesHandler = (files: readonly File[], target: Pick<ReturnType<NativeChatController['getSnapshot']>, 'identity' | 'conversationId'> & { readonly signal: AbortSignal }) => Promise<readonly ChatAttachment[]>;

/** The chat behaviour every surface over a `NativeChatController` shares (`PiChat`, `AmbientChat`): sending, queue actions, uploads, pickers, rows. */
export interface ChatSessionOptions extends Readonly<{ [Key in keyof ChatFeatureProps]: ChatFeatureProps[Key] | undefined }> {
  readonly controller: NativeChatController;
  /** The controller the host currently passes; a surface that outlives its controller stops acting on the old one. */
  readonly activeController: { readonly current: NativeChatController };
  readonly mode: Mode;
  readonly fileAccept: string;
  readonly onFiles?: FilesHandler | undefined;
  /** Runs after a message was accepted for sending (for example to scroll to the bottom). */
  readonly afterSend?: (() => void) | undefined;
  /** Extra attributes of the row context a surface needs (for example per-reply actions). */
  readonly rowExtras?: Partial<RowContext> | undefined;
  /** The optional Feedback button: when feedback is pending, Send attaches it to the message first. */
  readonly feedback?: ComposerFeedback | undefined;
}

export function useChatSession(options: ChatSessionOptions) {
  const { controller, activeController: active, mode, actions, renderEntry, renderTool, groupTool, commandMentions, onOpenImage, onCopy, onComposerKeyDown, onFiles, fileAccept,
    slash, mentions, attachments, model, effort, artifacts, messageActions, afterSend, rowExtras, feedback } = options;
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
  useEffect(() => {
    mounted.current = true;
    // A controller disposed before mount throws synchronously; the chat then renders its disposed state.
    if (!controller.getSnapshot().disposed) void controller.connect().catch(cause => { if (current()) setError(cause instanceof Error ? cause.message : labels.connectionFailed); });
    return () => { mounted.current = false; for (const upload of uploads.current) upload.abort(); uploads.current.clear(); };
  }, [controller]);

  const developer = mode === 'developer';
  // Only the recogniser takes part in deriving rows; which card is open changes without rebuilding them.
  const artifactDetect = useMemo(() => artifacts ? { detect: artifacts.detect } : undefined, [Boolean(artifacts), artifacts?.detect]); // eslint-disable-line react-hooks/exhaustive-deps
  const derived = useMemo(() => derive(state.view, { mode, renderEntry, renderTool, groupTool, artifacts: artifactDetect }), [state.view, mode, renderEntry, renderTool, groupTool, artifactDetect]);
  const queued = useMemo(() => queuedMessages(state.view), [state.view]);
  const { rows, run } = derived;

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
  const waitingForAnswer = rows.some(row => row.type === 'assistant' && row.parts.some(part => (part.kind === 'question' || part.kind === 'approval') && !part.live && !part.result));
  const send = () => {
    if (sendBlocked || !current()) return;
    const attach = feedback?.pending ? feedback.attach : undefined;
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
        if (submission) feedback?.sent?.();
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
    controller.setText(`${text}${text && !/\s$/.test(text) ? ' ' : ''}${paths.map(path => `@${path}`).join(' ')} `);
    setPicked(value => [...new Set([...value, ...paths])]);
  };
  async function upload(files: readonly File[]) {
    if ((!onFiles && !attachments) || !files.length || !current()) return;
    const abort = new AbortController(); uploads.current.add(abort); setUploading(value => value + 1);
    const ids = files.map(() => `upload-${++uploadIds.current}`);
    const settle = (failure?: string) => setPending(items => failure === undefined ? items.filter(item => !ids.includes(item.id))
      : items.map(item => ids.includes(item.id) ? { ...item, state: 'failed', error: failure } : item));
    setPending(items => [...items, ...files.map((file, index): PendingUpload => ({ id: ids[index]!, name: file.name, state: 'uploading' }))]);
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
  const agentDoc = object(state.view?.docs['pi.agent']);
  const currentModel = object(agentDoc?.['model']);
  const viewModel: ModelRef | undefined = typeof currentModel?.['provider'] === 'string' && typeof currentModel['modelId'] === 'string' ? { provider: currentModel['provider'], modelId: currentModel['modelId'] } : undefined;
  const viewEffort = typeof agentDoc?.['thinkingLevel'] === 'string' ? agentDoc['thinkingLevel'] : undefined;
  // Show the accepted choice until the watch delivers it, so the label does not flicker back.
  useEffect(() => {
    const same = optimistic.model && viewModel && optimistic.model.provider === viewModel.provider && optimistic.model.modelId === viewModel.modelId;
    if (same || (optimistic.effort !== undefined && optimistic.effort === viewEffort)) setOptimistic(value => ({ ...(same ? {} : value.model ? { model: value.model } : {}), ...(optimistic.effort === viewEffort ? {} : value.effort ? { effort: value.effort } : {}) }));
  }, [optimistic, viewModel?.provider, viewModel?.modelId, viewEffort]);
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
    developer, groupTool, onOpenImage, onCopy,
    commandMentions: commandMentions ? { commands: commandMentions.commands, onActivate: activateMention } : undefined,
    answer: actions?.answer,
    artifacts: artifacts ? { open: artifacts.open, isOpen: artifacts.isOpen } : undefined,
    messageActions,
    pieces: slash?.skills?.length || mentions ? { mentions: Boolean(mentions), skills: (slash?.skills ?? []).map(skill => skill.name), openMention: mentions?.open } : undefined,
    ...rowExtras,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [developer, groupTool, onOpenImage, onCopy, commandMentions, actions?.answer, slash?.skills, mentions, mentions?.open, artifacts?.open, artifacts?.isOpen, messageActions, rowExtras]);

  /** The model-and-effort pill and the note that reports a refused change. */
  const pickers = () => {
    const disabled = changing !== null || state.disposed || !connected;
    const barStart = model || effort ? <ModelEffortPicker model={model} effort={effort} currentModel={optimistic.model ?? viewModel} currentEffort={optimistic.effort ?? viewEffort} disabled={disabled} busy={changing}
      onModel={next => void change('model', () => model!.change(next), () => setOptimistic(value => ({ ...value, model: next })), () => {})}
      onEffort={next => void change('effort', () => effort!.change(next), () => setOptimistic(value => ({ ...value, effort: next })), () => {})} /> : undefined;
    const barNote = changeError ? <button type="button" role="alert" data-testid="configure-error" title={`${changeError} (${labels.dismissHint})`} onClick={() => setChangeError(null)}
      className="min-w-0 max-w-[16rem] cursor-pointer truncate rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive outline-none focus-visible:ring-2 focus-visible:ring-ring/60">{changeError}</button> : undefined;
    return { barStart, barNote };
  };

  const empty = connected && !state.view?.entries.length && !rows.length;
  const loading = (state.connection.kind === 'idle' || state.connection.kind === 'connecting') && !state.view;

  /** Everything `Composer` needs from the session; a surface adds its layout and slots. */
  const composer = {
    text: state.draft.text, onText: (text: string) => controller.setText(text), onKeyDown: onComposerKeyDown, textareaRef: textarea,
    attachments: state.draft.attachments.map(item => ({ id: item.id, name: item.name, mimeType: item.content.mimeType, data: item.content.data })),
    onRemoveAttachment: (id: string) => controller.setAttachments(controller.getSnapshot().draft.attachments.filter(item => item.id !== id)),
    working, sendBlocked, disabled: state.disposed, stopRequested: state.stop === 'requested',
    onSend: send, onStop: () => act(controller.stop),
    uploading: uploading > 0, canAttach: Boolean(onFiles || attachments), fileAccept: attachments ? attachments.accept ?? '' : fileAccept, onPickFiles: (files: readonly File[]) => { void upload(files); },
    slash, onSlashError: report, mentions, mentionPaths: picked, onMentionPicked: (path: string) => setPicked(value => value.includes(path) ? value : [...value, path]),
    uploads: pending, onDismissUpload: (id: string) => setPending(items => items.filter(item => item.id !== id)),
    feedback,
  };

  return { state, derived, rows, queued, queueActions, working, waitingForAnswer, connected, sendBlocked, error, setError, report, act, current, textarea, rowContext, composer, pickers, empty, loading, developer };
}

export type ChatSession = ReturnType<typeof useChatSession>;

/** Scroll-to-bottom transcript with older rows revealed in pages as the person scrolls up. */
export function useTranscript(rows: readonly unknown[], page = 60, more = 40) {
  const [limit, setLimit] = useState(page);
  const anchor = useRef<{ readonly height: number; readonly top: number } | undefined>(undefined);
  const stick = useStickToBottom({ initial: 'instant', resize: 'smooth' });
  const hidden = Math.max(0, rows.length - limit);
  // Reveal older rows when the person scrolls near the top, keeping the same rows in view.
  const reveal = useCallback(() => {
    const element = stick.scrollRef.current;
    if (element) anchor.current = { height: element.scrollHeight, top: element.scrollTop };
    setLimit(value => value + more);
  }, [stick.scrollRef, more]);
  useLayoutEffect(() => {
    const element = stick.scrollRef.current, saved = anchor.current;
    if (element && saved) { element.scrollTop = saved.top + element.scrollHeight - saved.height; anchor.current = undefined; }
  }, [limit, stick.scrollRef]);
  useEffect(() => {
    const element = stick.scrollRef.current;
    if (!element) return;
    const onScroll = () => { if (element.scrollTop < 240 && element.scrollHeight > element.clientHeight && hidden > 0 && !anchor.current) reveal(); };
    element.addEventListener('scroll', onScroll, { passive: true });
    return () => element.removeEventListener('scroll', onScroll);
  }, [hidden, reveal, stick.scrollRef]);
  return { stick, hidden, reveal, visible: <T,>(items: readonly T[]): readonly T[] => hidden ? items.slice(hidden) : items, reset: () => setLimit(page) };
}
