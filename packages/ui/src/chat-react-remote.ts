'use client';

import { useLayoutEffect, useMemo, useRef } from 'react';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { createNativeChatController } from './native-chat.js';
import type { ChatAttachment, ChatController, ChatConversation, ChatIdentity, ChatLink, NativeChatController } from './native-chat.js';
import { createRemoteChat } from './remote-chat.js';
import type { RemoteChat, RemoteChatOptions } from './remote-chat.js';
import { useControllerPerConversation } from './chat-react-controller.js';

// ---- Placement: where the chat is shown, reported by the component that shows it and sent with each submit (see `useRemoteChat`).
// `PiChat` reports `docked`, `AmbientChat` (also a docked chat floated by its divider) reports `floating`. Advisory for the model, never
// authority. See docs/architecture/PAGE-TOOLS.md (PLACE-1..3).
export type ChatPlacement = 'docked' | 'floating';

// Keyed by controller (a page can hold several chats; floating or docking keeps the controller, PLACE-3). Each mounted presenter has its own
// registration, so unmounting one never clears another's; the latest surviving registration wins.
const placements = new WeakMap<ChatController, { readonly placement: ChatPlacement }[]>();

/** Reports the placement of the chat showing `controller` while the caller is mounted. */
export function useChatPlacement(controller: ChatController, placement: ChatPlacement): void {
  useLayoutEffect(() => {
    const entry = { placement };
    const list = placements.get(controller) ?? [];
    placements.set(controller, [...list, entry]);
    return () => {
      const rest = (placements.get(controller) ?? []).filter(item => item !== entry);
      if (rest.length) placements.set(controller, rest); else placements.delete(controller);
    };
  }, [controller, placement]);
}

export function readChatPlacement(controller: ChatController | undefined): ChatPlacement | undefined {
  return controller ? placements.get(controller)?.at(-1)?.placement : undefined;
}

type RemoteActions = Partial<Pick<RemoteChat, 'answer' | 'withdraw'>>;
/**
 * `connecting` carries the controller as soon as it exists (D-1434, before the host's first view lands): its composer takes messages at
 * once, shows them as the person's own and sends them, in order, once connected; the transcript appears with the first view. `actions` and
 * `configure` wait for the connection. `ready` still means the first view landed, with the same controller; a host that waits for `ready`
 * (or ignores `controller` while connecting) behaves as before. If connecting fails the state turns `offline` without a controller, and
 * the messages not sent come back in the next attempt's composer.
 */
export type RemoteChatState =
  | { readonly status: 'connecting'; readonly conversationId: string | undefined; readonly controller?: NativeChatController; readonly actions?: RemoteActions; readonly configure?: RemoteChat['configure'] }
  | { readonly status: 'offline'; readonly conversationId: string | undefined; readonly error: string }
  | { readonly status: 'ready'; readonly conversationId: string; readonly controller: NativeChatController; readonly actions: RemoteActions; readonly configure: RemoteChat['configure'] };

/** A remote chat being opened: `current` once its first view arrived. Members called earlier wait for it. */
interface PendingRemote {
  readonly remote: Promise<RemoteChat>;
  current?: RemoteChat;
  readonly actions: Required<RemoteActions>;
  readonly configure: RemoteChat['configure'];
}

/**
 * The conversation and link the controller borrows while the remote chat opens. Each member waits for the remote and then forwards
 * to it unchanged; the identity is the selection until the server's view names it (the controller reads it again on connect).
 */
function pendingConversation(pending: PendingRemote, selection: string): { readonly conversation: ChatConversation; readonly link: ChatLink } {
  const forward = <K extends 'watch' | 'abort' | 'entries' | 'submit'>(name: K): ChatConversation[K] =>
    (async (...args: unknown[]) => ((await pending.remote).conversation[name] as (...values: unknown[]) => unknown)(...args)) as unknown as ChatConversation[K];
  const conversation: ChatConversation = {
    get id() { return (pending.current?.conversation.id ?? selection) as ChatConversation['id']; },
    watch: forward('watch'), submit: forward('submit'), abort: forward('abort'), entries: forward('entries'),
    commit: async (change, context) => (await pending.remote).conversation.commit(change, context),
  };
  const link: ChatLink = {
    reconnecting: () => pending.current?.link.reconnecting() ?? false,
    subscribe: listener => {
      let off: (() => void) | undefined, gone = false;
      void pending.remote.then(remote => { if (!gone) off = remote.link.subscribe(listener); }, () => {});
      return () => { gone = true; off?.(); };
    },
  };
  return { conversation, link };
}

/** What a controller that never connected still holds (messages taken from the composer, then the draft), to give to the next attempt. */
function unsent(controller: NativeChatController): { readonly text: string; readonly attachments: readonly ChatAttachment[] } {
  const snapshot = controller.getSnapshot(), drafts = [...snapshot.echo.map(item => item.draft), snapshot.draft];
  const attachments = drafts.flatMap(item => item.attachments).filter((item, index, all) => all.findIndex(other => other.id === item.id) === index);
  return { text: drafts.map(item => item.text).filter(text => text.trim()).join('\n'), attachments };
}

export interface RemoteChatHookOptions {
  readonly conversationId: string | undefined;
  readonly endpoint: (conversationId: string) => string | URL;
  readonly fetch: (request: Request) => Promise<Response>;
  readonly identity: ChatIdentity | undefined;
  /** Read at each submit; placement is merged alongside the host's unchanged screen context. Advisory, never authority. */
  readonly requestContext?: () => Readonly<Record<string, unknown>> | undefined;
  readonly transport?: RemoteChatOptions['transport'];
  readonly webSocket?: RemoteChatOptions['webSocket'];
}

/** One owned native controller per selection; the remote transport itself reopens dropped streams. Failed acquisition retries each second. */
export function useRemoteChat({ conversationId, endpoint, fetch, identity, requestContext, transport, webSocket }: RemoteChatHookOptions): RemoteChatState {
  const url = conversationId === undefined ? undefined : String(endpoint(conversationId));
  const key = identity && conversationId !== undefined ? JSON.stringify([conversationId, url, identity.runtimeId, identity.scopeId, identity.principalId, transport]) : undefined;
  const latest = useRef({ fetch, requestContext, webSocket });
  useLayoutEffect(() => { latest.current = { fetch, requestContext, webSocket }; });
  // Transport ownership stays with the controller that acquired it, including when connect or selection changes race.
  const remotes = useMemo(() => new WeakMap<NativeChatController, PendingRemote>(), []);
  // Messages a failed attempt never sent, by selection, for the next attempt's composer.
  const carried = useMemo(() => new Map<string, ReturnType<typeof unsent>>(), []);
  const selected = useControllerPerConversation({ key,
    // The controller exists at once; the remote chat opens behind it (D-1434). Its watch, submits and actions wait for the first view.
    create: () => {
      let controller: NativeChatController | undefined;
      const remote = createRemoteChat({ endpoint: url!, fetch: request => latest.current.fetch(request),
        requestContext: () => {
          const placement = readChatPlacement(controller), screen = latest.current.requestContext?.();
          return placement || screen ? { ...screen, ...(placement && { placement }) } : undefined;
        }, ...(transport ? { transport } : {}), ...(latest.current.webSocket ? { webSocket: latest.current.webSocket } : {}) });
      const pending: PendingRemote = { remote,
        actions: { answer: async (...args) => (await remote).answer(...args), withdraw: async (...args) => (await remote).withdraw(...args) },
        configure: async (...args) => (await remote).configure(...args) };
      void remote.then(value => { pending.current = value; }, () => {});
      try {
        const { conversation, link } = pendingConversation(pending, conversationId!);
        controller = createNativeChatController({ identity: identity!, conversation, context: BACKGROUND_CONTEXT, link,
          definitelyNotAdmitted: error => pending.current?.definitelyNotAdmitted(error) ?? false });
      } catch (error) { void remote.then(value => value.close(), () => {}); throw error; }
      remotes.set(controller, pending);
      const back = carried.get(String(key));
      if (back) {
        carried.delete(String(key));
        if (back.text) controller.setText(back.text);
        if (back.attachments.length) controller.setAttachments(back.attachments);
      }
      // `connecting` at once, so the chat shows it and takes messages; the native watch opening waits for the remote's first view.
      void controller.connect();
      return controller;
    },
    connect: async controller => {
      try { await remotes.get(controller)!.remote; }
      catch (error) { const back = unsent(controller); if (back.text || back.attachments.length) carried.set(String(key), back); throw error; }
      await controller.connect();
    },
    dispose: async controller => {
      // Start both: closing a transport may release a pending native watch opening.
      const pending = controller.dispose(), remote = remotes.get(controller);
      try { await (remote?.current ?? await remote?.remote.catch(() => undefined))?.close(); } finally { await pending; remotes.delete(controller); }
    },
  });
  if (selected.status === 'ready' && conversationId !== undefined) {
    const remote = remotes.get(selected.controller)!.current!;
    const actions = { ...(typeof remote.answer === 'function' ? { answer: remote.answer } : {}),
      ...(typeof remote.withdraw === 'function' ? { withdraw: remote.withdraw } : {}) };
    return { status: 'ready', conversationId, controller: selected.controller, actions, configure: remote.configure };
  }
  if (selected.status === 'offline') return { status: 'offline', conversationId, error: String((selected.error as Error)?.message ?? selected.error) };
  const early = selected.controller && remotes.get(selected.controller);
  return early && selected.controller ? { status: 'connecting', conversationId, controller: selected.controller, actions: early.actions, configure: early.configure } : { status: 'connecting', conversationId };
}
