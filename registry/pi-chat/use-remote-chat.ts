import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { createNativeChatController } from '@hachej/boring-ui-kit/native-chat';
import type { ChatIdentity, NativeChatController } from '@hachej/boring-ui-kit/native-chat';
import { createRemoteChat } from '@hachej/boring-ui-kit/remote-chat';
import type { RemoteChat } from '@hachej/boring-ui-kit/remote-chat';
import type { PiChatActions } from './session';

// ---- Placement: where the chat is shown, reported by the component that shows it and sent with each submit (see `useRemoteChat`).
// `PiChat` reports `docked`, `AmbientChat` (also a docked chat floated by its divider) reports `floating`. Advisory for the model, never
// authority. See docs/architecture/PAGE-TOOLS.md (PLACE-1..3; draft PR #1698).
export type ChatPlacement = 'docked' | 'floating';

// Keyed by controller: a page can hold several chats, and floating or docking keeps the controller (PLACE-3).
const placements = new WeakMap<NativeChatController, ChatPlacement>();

/** Reports the placement of the chat showing `controller` while the caller is mounted. */
export function useChatPlacement(controller: NativeChatController, placement: ChatPlacement): void {
  useLayoutEffect(() => {
    placements.set(controller, placement);
    return () => { if (placements.get(controller) === placement) placements.delete(controller); };
  }, [controller, placement]);
}

export function readChatPlacement(controller: NativeChatController | undefined): ChatPlacement | undefined {
  return controller ? placements.get(controller) : undefined;
}

export type RemoteChatState =
  | { readonly status: 'connecting'; readonly conversationId: string | undefined }
  | { readonly status: 'offline'; readonly conversationId: string | undefined; readonly error: string }
  | { readonly status: 'ready'; readonly conversationId: string; readonly controller: NativeChatController; readonly actions: PiChatActions; readonly configure: RemoteChat['configure'] };

/**
 * One native chat controller per selected conversation over the host's chat transport (`createChatTransportHandler` of
 * `@hachej/boring-agent/chat-transport`). `endpoint(id)` names the transport URL of a conversation; `fetch` is the host's authenticated fetch.
 * The remote chat reopens a dropped stream itself (the controller reads `reconnecting` meanwhile); it never means the task stopped.
 * A failed connect retries every second. The previous conversation's controller is never handed out: it is disposed on change.
 */
export function useRemoteChat({ conversationId, endpoint, fetch, identity, requestContext }: {
  readonly conversationId: string | undefined;
  readonly endpoint: (conversationId: string) => string | URL;
  readonly fetch: (request: Request) => Promise<Response>;
  readonly identity: ChatIdentity | undefined;
  /**
   * The current screen context, read at each submit (for example `readAgentContext` of the app-shell item). The submit's `context` is
   * `{ placement, screen }`: the chat's placement (`docked` or `floating`, reported by `PiChat` / `AmbientChat`) and this value.
   */
  readonly requestContext?: () => Readonly<Record<string, unknown>> | undefined;
}): RemoteChatState {
  const url = conversationId === undefined ? undefined : String(endpoint(conversationId));
  const key = JSON.stringify([conversationId, url, identity?.runtimeId, identity?.scopeId, identity?.principalId]);
  const binding = useMemo(() => ({ key, fetch, requestContext }), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { binding.fetch = fetch; binding.requestContext = requestContext; }, [binding, fetch, requestContext]);
  const [stored, setStored] = useState<{ readonly binding: typeof binding; readonly chat: RemoteChatState }>();
  useEffect(() => {
    if (conversationId === undefined || !identity || url === undefined) return;
    const setChat = (chat: RemoteChatState) => setStored({ binding, chat });
    let disposed = false, controller: NativeChatController | undefined, remote: RemoteChat | undefined;
    const context = () => {
      const placement = readChatPlacement(controller), screen = binding.requestContext?.();
      return placement || screen ? { ...(placement && { placement }), ...(screen && { screen }) } : undefined;
    };
    setChat({ status: 'connecting', conversationId });
    void (async () => {
      while (!disposed) {
        try {
          remote = await createRemoteChat({ endpoint: url, fetch: request => binding.fetch(request), requestContext: context });
          if (disposed) return void remote.close();
          controller = createNativeChatController({ identity, ...remote });
          await controller.connect();
          if (disposed) return void controller.dispose();
          // Human-in-the-loop answers and queue withdrawal are optional on the transport: pass only what it offers.
          const actions: { answer?: RemoteChat['answer']; withdraw?: RemoteChat['withdraw'] } = {};
          if (typeof remote.answer === 'function') actions.answer = remote.answer;
          if (typeof remote.withdraw === 'function') actions.withdraw = remote.withdraw;
          setChat({ status: 'ready', controller, conversationId, actions, configure: remote.configure });
          return;
        } catch (error) {
          controller?.dispose(); controller = undefined; void remote?.close(); remote = undefined;
          if (disposed) return;
          setChat({ status: 'offline', conversationId, error: String((error as Error)?.message ?? error) });
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    })();
    return () => { disposed = true; controller?.dispose(); void remote?.close(); };
  }, [binding]); // eslint-disable-line react-hooks/exhaustive-deps
  return identity && stored?.binding === binding ? stored.chat : { status: 'connecting', conversationId };
}
