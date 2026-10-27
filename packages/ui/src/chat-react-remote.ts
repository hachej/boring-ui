'use client';

import { useLayoutEffect, useMemo, useRef } from 'react';
import { createNativeChatController } from './native-chat.js';
import type { ChatController, ChatIdentity, NativeChatController } from './native-chat.js';
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

export type RemoteChatState =
  | { readonly status: 'connecting'; readonly conversationId: string | undefined }
  | { readonly status: 'offline'; readonly conversationId: string | undefined; readonly error: string }
  | { readonly status: 'ready'; readonly conversationId: string; readonly controller: NativeChatController; readonly actions: Partial<Pick<RemoteChat, 'answer' | 'withdraw'>>; readonly configure: RemoteChat['configure'] };

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
  const remotes = useMemo(() => new WeakMap<NativeChatController, RemoteChat>(), []);
  const selected = useControllerPerConversation({ key,
    create: async () => {
      let controller: NativeChatController | undefined;
      const remote = await createRemoteChat({ endpoint: url!, fetch: request => latest.current.fetch(request),
        requestContext: () => {
          const placement = readChatPlacement(controller), screen = latest.current.requestContext?.();
          return placement || screen ? { ...screen, ...(placement && { placement }) } : undefined;
        }, ...(transport ? { transport } : {}), ...(latest.current.webSocket ? { webSocket: latest.current.webSocket } : {}) });
      try {
        controller = createNativeChatController({ identity: identity!, ...remote });
        remotes.set(controller, remote);
        return controller;
      } catch (error) { await remote.close(); throw error; }
    },
    connect: controller => controller.connect(),
    dispose: async controller => {
      // Start both: closing a transport may release a pending native watch opening.
      const pending = controller.dispose();
      try { await remotes.get(controller)?.close(); } finally { await pending; remotes.delete(controller); }
    },
  });
  if (selected.status === 'ready' && conversationId !== undefined) {
    const remote = remotes.get(selected.controller)!;
    const actions = { ...(typeof remote.answer === 'function' ? { answer: remote.answer } : {}),
      ...(typeof remote.withdraw === 'function' ? { withdraw: remote.withdraw } : {}) };
    return { status: 'ready', conversationId, controller: selected.controller, actions, configure: remote.configure };
  }
  return selected.status === 'offline' ? { status: 'offline', conversationId, error: String((selected.error as Error)?.message ?? selected.error) } : { status: 'connecting', conversationId };
}
