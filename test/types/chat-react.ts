import { useChatView, useControllerPerConversation, useConversationsClient, useRemoteChat, useTranscriptWindow, useRowChunks } from '@hachej/boring-ui-kit/chat-react';
import type { ChatController, NativeChatController } from '@hachej/boring-ui-kit/native-chat';
import type { SharedChatController } from '@hachej/boring-ui-kit/shared-chat';

export function useChatDeclarations(chat: ChatController, shared: SharedChatController) {
  const count: number = useChatView(chat, view => view?.entries.length ?? 0);
  const selected = useControllerPerConversation({ key: 'fictional', create: () => shared });
  if (selected.status === 'ready') {
    const concrete: SharedChatController = selected.controller;
    concrete.setReplyTo('fictional');
  }
  const remote = useRemoteChat({ conversationId: 'fictional', endpoint: id => `https://fictional.invalid/${id}`, fetch, identity: { runtimeId: 'r', scopeId: 's', principalId: 'p' } });
  if (remote.status === 'ready') {
    const concrete: NativeChatController = remote.controller;
    void concrete.reconcile();
  }
  const conversations = useConversationsClient({ endpoint: undefined, fetch, activeId: undefined, onSelect: () => {} });
  const rows = [{ key: 'fictional', custom: 1 }];
  const chunks = useRowChunks(rows);
  const custom: number | undefined = chunks[0]?.[0]?.custom;
  return { count, custom, conversations, window: useTranscriptWindow(rows) };
}
