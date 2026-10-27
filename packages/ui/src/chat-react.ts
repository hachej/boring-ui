'use client';

/** Opt-in UI projection over the native controller; owns no Pi execution or controller lifetime. */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { ChatController } from './native-chat.js';
import { artifactKey, artifactTurn, artifactVersions, createPresentAcks, follows, pendingPresents, presentPath } from './chat-view.js';
import type { ArtifactDescriptor, ArtifactDetect, PresentAcksHost } from './chat-view.js';

export { useChatDraft } from './chat-react-draft.js';
export { useControllerPerConversation } from './chat-react-controller.js';
export type { ControllerPerConversationOptions, ConversationControllerState } from './chat-react-controller.js';
export { chunkKeys, useRowChunks, useTranscript, useTranscriptWindow, PAGE_FIRST, PAGE_MORE, CHUNK } from './chat-react-transcript.js';
export type { ChatPaging } from './chat-react-transcript.js';
export { useChatPlacement, readChatPlacement, useRemoteChat } from './chat-react-remote.js';
export type { ChatPlacement, RemoteChatState, RemoteChatHookOptions } from './chat-react-remote.js';
export { useConversationsClient, useConversations } from './chat-react-conversations.js';
export type { ConversationItem, ConversationsClient, ConversationsClientOptions } from './chat-react-conversations.js';

const subscribeNothing = () => () => {};
/** Selects the authorized native view using the controller's own cached snapshot and subscription. Borrows its lifetime. */
export function useChatView<T>(controller: ChatController | undefined, select: (view: ReturnType<ChatController['getSnapshot']>['view']) => T): T {
  const getView = useCallback(() => controller?.getSnapshot().view, [controller]);
  const view = useSyncExternalStore(controller?.subscribe ?? subscribeNothing, getView, () => undefined);
  return useMemo(() => select(view), [view, select]);
}
const identityView = (view: ReturnType<ChatController['getSnapshot']>['view']) => view;

export interface ArtifactSelection { readonly descriptor: ArtifactDescriptor; readonly follow: boolean }
export interface ArtifactShown { readonly path: string; readonly revision: string; readonly hidden?: true }
export interface ArtifactFailed { readonly path: string; readonly revision: string; readonly reason: string }
export interface ArtifactFollowOptions {
  readonly controller: ChatController | undefined;
  readonly conversationId?: string | undefined;
  readonly detect?: ArtifactDetect | undefined;
  readonly active: ArtifactSelection | null;
  readonly onOpen: (selection: ArtifactSelection) => void;
  readonly autoOpen?: boolean | undefined;
  /** Host presentation guards are read when an effect or action considers opening, never during render. */
  readonly unsaved?: (() => boolean) | undefined;
  readonly narrow?: (() => boolean) | undefined;
  readonly showing: (path: string) => boolean;
  readonly openPresent: (path: string) => boolean;
  readonly answer?: PresentAcksHost['answer'] | undefined;
}

/** One version/follow/auto-open and present-ack rule for every chat surface. Mount evidence must come from the viewer. */
export function useArtifactFollow(options: ArtifactFollowOptions) {
  const { controller, conversationId, detect, active, autoOpen = false } = options;
  const view = useChatView(controller, identityView);
  const versions = useMemo(() => artifactVersions(view, detect), [view, detect]);
  const turn = useMemo(() => artifactTurn(view), [view]);
  const calls = useMemo(() => pendingPresents(view), [view]);
  const latest = useRef(options);
  // Latest host callbacks are used only by effects and event handlers, never to derive render output.
  latest.current = options;
  const seen = useRef(new Map<string, Set<string>>());
  const closedInTurn = useRef(new Map<string, number>());
  const instanceId = useId();
  // A controller/conversation switch cannot carry a mount report, delayed callback or retry into the new binding.
  // Child layout effects may report a committed mount before this hook's layout effect; teardown then fences delayed reports.
  const binding = useMemo(() => ({ active: true, controller, conversationId }), [controller, conversationId]);
  const current = useCallback(() => binding.active && latest.current.controller === binding.controller && latest.current.conversationId === binding.conversationId, [binding]);
  const acks = useMemo(() => createPresentAcks({ instanceId,
    answer: (id, body) => current() ? latest.current.answer?.(id, body) : undefined,
    open: path => current() && latest.current.openPresent(path),
  }), [current, instanceId]);
  useLayoutEffect(() => { binding.active = true; return () => { binding.active = false; }; }, [binding]);
  useEffect(() => {
    if (!controller || conversationId === undefined) return;
    const keys = versions.map(version => JSON.stringify([artifactKey(version), version.revision]));
    const known = seen.current.get(conversationId);
    if (!known) { seen.current.set(conversationId, new Set(keys)); return; }
    const fresh = versions.filter((_, index) => !known.has(keys[index]!));
    for (const key of keys) known.add(key);
    if (!autoOpen || !fresh.length || latest.current.unsaved?.() || latest.current.narrow?.() || closedInTurn.current.get(conversationId) === turn) return;
    latest.current.onOpen({ descriptor: fresh[0]!, follow: true });
  }, [versions, controller, conversationId, turn, autoOpen]);
  useEffect(() => {
    if (!options.answer || conversationId === undefined) return;
    acks.consider(calls, { closedThisTurn: closedInTurn.current.get(conversationId) === turn,
      unsaved: latest.current.unsaved?.() === true, narrow: latest.current.narrow?.() === true, autoOpen,
      showing: path => latest.current.showing(path) });
  }, [acks, calls, conversationId, turn, autoOpen, options.answer]);
  const onShown = useCallback((shown: ArtifactShown) => {
    if (!current()) return;
    const report = { path: presentPath(shown.path), revision: shown.revision };
    if (shown.hidden) acks.hidden(report); else acks.shown(report);
  }, [acks, current]);
  const onFailed = useCallback((failed: ArtifactFailed) => { if (current()) acks.failed({ ...failed, path: presentPath(failed.path) }); }, [acks, current]);
  const recordClosed = useCallback(() => { if (conversationId !== undefined) closedInTurn.current.set(conversationId, turn); }, [conversationId, turn]);
  const open = useCallback((descriptor: ArtifactDescriptor) => latest.current.onOpen({ descriptor, follow: follows(descriptor, versions) }), [versions]);
  const isOpen = useCallback((descriptor: ArtifactDescriptor) => Boolean(active && artifactKey(active.descriptor) === artifactKey(descriptor) &&
    (active.follow ? follows(descriptor, versions) : descriptor.revision === active.descriptor.revision)), [active, versions]);
  const known = useMemo(() => active ? versions.filter(version => artifactKey(version) === artifactKey(active.descriptor)) : [], [active, versions]);
  const shown = active ? active.follow ? known[0] ?? active.descriptor : active.descriptor : undefined;
  const select = useCallback((version: ArtifactDescriptor | 'latest') => {
    if (active) latest.current.onOpen(version === 'latest' ? { descriptor: known[0] ?? active.descriptor, follow: true } : { descriptor: version, follow: false });
  }, [active, known]);
  return { versions, turn, known, shown, open, isOpen, select, recordClosed, onShown, onFailed };
}
