'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ToolCall, ToolResultMessage } from '@earendil-works/pi-ai';
import type { ChatAttachment, ChatController } from './native-chat.js';
import { derive, isFileBlock, object, queuedMessages, waitingForAnswer as waitsForAnswer } from './chat-view.js';
import type { ChatCard, DeriveOptions, Mode, QueuedMessage, Row } from './chat-view.js';
import { appendToDraft, displayName, looksLikeMarkdown, mentionToken, pieces, prependToDraft } from './chat-text.js';

/** A conversation's observed file; opening remains a host operation, not workspace ownership. */
export interface ConversationFile { readonly id: string; readonly name: string; readonly open: (() => void) | undefined }
export interface ModelRef { readonly provider: string; readonly modelId: string }
export interface PastedText { readonly text: string; readonly start: number; readonly end: number }
export interface UploadResult {
  readonly path?: string;
  readonly image?: { readonly data: string; readonly mimeType: string };
  readonly name: string;
}
export interface PendingUpload {
  readonly id: string; readonly name: string; readonly state: 'uploading' | 'failed'; readonly error?: string;
  readonly cancel?: (() => void) | undefined;
  readonly restoreWhile?: string | undefined;
}
export type FilesHandler = (files: readonly File[], target: Pick<ReturnType<ChatController['getSnapshot']>, 'identity' | 'conversationId'> & { readonly signal: AbortSignal }) => Promise<readonly ChatAttachment[]>;
export interface QueueActions {
  readonly edit?: ((item: QueuedMessage) => Promise<void>) | undefined;
  readonly steer?: ((item: QueuedMessage) => Promise<void>) | undefined;
}
/** Send-time feedback only; the annotate button and its state remain host presentation. */
export interface ChatSessionFeedback {
  readonly count: number;
  readonly attach: (text: string) => Promise<{ readonly kind: 'ok'; readonly text: string } | { readonly kind: 'refused'; readonly reason: string }>;
  readonly sent: () => void;
}
export interface ChatSessionLabels {
  readonly connectionFailed: string; readonly actionFailedShort: string; readonly imageAttachment: string;
  readonly queueLocked: string; readonly tooLate: string; readonly waitToSteer: string;
  readonly steerRefused: string; readonly steerFailed: string; readonly uploadFailedShort: string;
  readonly pastedFileName: (stamp: string) => string; readonly changeRefused: string;
}
export interface ChatSessionOptions<Content = unknown> extends Partial<DeriveOptions<Content>> {
  readonly controller: ChatController;
  /** Surfaces remount on controller replacement. Late effects/actions also check this live binding. */
  readonly activeController: { readonly current: ChatController };
  readonly mode: Mode;
  readonly labels: ChatSessionLabels;
  readonly actions?: { readonly withdraw?: ((id: QueuedMessage['id']) => Promise<unknown>) | undefined } | undefined;
  readonly toolRenderers?: Readonly<Record<string, (call: ToolCall, result: ToolResultMessage | undefined) => ChatCard<Content> | undefined>> | undefined;
  readonly artifacts?: (NonNullable<DeriveOptions<Content>['artifacts']> & { readonly open?: ((artifact: never) => void) | undefined }) | undefined;
  readonly mentions?: { readonly open?: ((path: string) => void) | undefined } | undefined;
  readonly onOpenFile?: ((path: string) => void) | undefined;
  readonly onOpenImage?: ((image: ChatAttachment['content']) => void) | undefined;
  readonly onFiles?: FilesHandler | undefined;
  readonly onPickFiles?: ((files: readonly File[]) => void) | undefined;
  readonly attachments?: { readonly upload: (files: File[], signal: AbortSignal) => Promise<readonly UploadResult[]> } | undefined;
  readonly model?: { readonly change: (model: ModelRef) => Promise<void> } | undefined;
  readonly effort?: { readonly change: (level: string) => Promise<void> } | undefined;
  readonly commandMentions?: { readonly commands: readonly { readonly name: string; readonly behavior: 'execute' | 'insert' }[]; readonly onActivate: (command: { readonly name: string; readonly behavior: 'execute' | 'insert' }) => void } | undefined;
  readonly feedback?: ChatSessionFeedback | undefined;
  readonly afterSend?: (() => void) | undefined;
  /** Focus is presentation; called only by actions, never during render. */
  readonly onFocus?: (() => void) | undefined;
}

/** Headless session over the public native controller snapshot/commands. Borrows it; cleanup only aborts this hook's uploads. */
export function useChatSession<Content = unknown>(options: ChatSessionOptions<Content>) {
  const { controller, activeController: active, mode, presentation, actions, renderEntry, hideLine, renderTool: catchAll, toolRenderers, groupTool, subagent,
    onOpenImage, onFiles, mentions, attachments, model, effort, artifacts, afterSend, feedback, onOpenFile, onPickFiles, commandMentions, onFocus, labels } = options;
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
  const recognise = artifacts?.recognise, detect = artifacts?.detect;
  const artifactDetect = useMemo(() => recognise ? { recognise, detect } : undefined, [recognise, detect]);
  const derived = useMemo(() => derive(state.view, { mode, presentation, hideLine, renderEntry, renderTool, groupTool, artifacts: artifactDetect, subagent }), [state.view, mode, presentation, hideLine, renderEntry, renderTool, groupTool, artifactDetect, subagent]);
  const queued = useMemo(() => queuedMessages(state.view), [state.view]);
  const { run } = derived;
  const earlier = useMemo<readonly Row<Content>[]>(() => {
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
          found.set(id, { id, name: displayName(part.artifact.path), open: artifacts?.open ? () => artifacts.open?.(descriptor) : undefined });
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
    controller.setText(prependToDraft(draft.text, text));
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
        try {
          const submission = await controller.send('followUp', { text: attached.text, attachments: typed.attachments, restore: { text: typed.text, attachments: typed.attachments } });
          if (submission) feedback?.sent();
        } catch (cause) { putBack(typed.text, typed.attachments); throw cause; }
      });
      afterSend?.();
      onFocus?.();
      return;
    }
    act(() => controller.send('followUp'));
    afterSend?.();
    onFocus?.();
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
      controller.setText(prependToDraft(draft.text, text));
      if (images.length) controller.setAttachments([...draft.attachments, ...images]);
      onFocus?.();
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
    controller.setText(`${appendToDraft(text, paths.map(mentionToken).join(' '))} `);
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
      onFocus?.();
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
  const empty = connected && !state.view?.entries.length && !rows.length;
  const loading = (state.connection.kind === 'idle' || state.connection.kind === 'connecting') && !state.view;
  return { state, derived, rows, queued, queueActions, working, waitingForAnswer, connected, sendBlocked, error, setError, report, act, current,
    files, empty, loading, developer, natural, send, putBack, upload, pasteText, picked, pending, uploading, activateMention,
    pickMention: (path: string) => setPicked(value => value.includes(path) ? value : [...value, path]),
    dismissUpload: (id: string) => setPending(items => items.filter(item => item.id !== id)),
    currentModel: optimistic.model ?? viewModel, currentEffort: optimistic.effort ?? viewEffort,
    changing, changeError, dismissChangeError: () => setChangeError(null),
    changeModel: (next: ModelRef) => change('model', () => model!.change(next), () => setOptimistic(value => ({ ...value, model: next })), () => {}),
    changeEffort: (next: string) => change('effort', () => effort!.change(next), () => setOptimistic(value => ({ ...value, effort: next })), () => {}),
  };
}
export type ChatSession<Content = unknown> = ReturnType<typeof useChatSession<Content>>;
