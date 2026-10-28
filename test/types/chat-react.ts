import { useChatSession, useChatView, useControllerPerConversation, useConversationsClient, useRemoteChat, useTranscriptWindow, useRowChunks } from '@hachej/boring-ui-kit/chat-react';
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


export function useHeadlessSessionDeclarations(chat: NativeChatController, labels: import('@hachej/boring-ui-kit/chat-react').ChatSessionLabels) {
  const session = useChatSession<string>({ controller: chat, activeController: { current: chat }, mode: 'expert', labels,
    renderEntry: entry => ({ content: entry.kind, inline: true }), onFocus: () => {},
    mentions: { kinds: { meal: { label: (path: string) => path } } }, slash: { skills: [{ name: 'cook' }] },
    attachments: { upload: async files => files.map(file => ({ name: file.name, path: `uploads/${file.name}` })) },
    model: { change: async model => { const provider: string = model.provider; void provider; } } });
  const snapshot: ReturnType<ChatController['getSnapshot']> = session.state;
  const status: string | undefined = session.derived.stageStatus;
  // @ts-expect-error session content remains the selected concrete content type.
  const invalid: number | undefined = session.derived.stageStatus;
  return { snapshot, status, invalid, session };
}
// @ts-expect-error The headless root never exports optional native/React session behavior.
import { useChatSession as forbiddenRootSession } from '@hachej/boring-ui-kit';
void forbiddenRootSession;
