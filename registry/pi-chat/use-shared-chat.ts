'use client';

import { useEffect, useState } from 'react';
import { createSharedChat } from '@hachej/boring-ui-kit/shared-chat';
import type { ChannelSource, Conversation, SharedChatController } from '@hachej/boring-ui-kit/shared-chat';
import type { ConversationsConfig } from './config';

/** The host's conversations in the existing History adapter. No visibility/role filtering and no new navigation. */
export function useSharedChat(source: ChannelSource) {
  const [list, setList] = useState<{ source: ChannelSource; items: Conversation[] }>();
  const [selection, setSelection] = useState<{ source: ChannelSource; id: string }>();
  const [error, setError] = useState<string>();
  const items = list?.source === source ? list.items : [];
  const conversationId = selection?.source === source ? selection.id : items[0]?.id;
  const [binding, setBinding] = useState<{ source: ChannelSource; id: string; controller: SharedChatController }>();
  useEffect(() => {
    let off = false; setError(undefined);
    void source.conversations().then(items => { if (!off) setList({ source, items }); }, cause => { if (!off) setError(String(cause)); });
    return () => { off = true; };
  }, [source]);
  useEffect(() => {
    if (conversationId === undefined) return;
    const controller = createSharedChat(source, { conversationId });
    setBinding({ source, id: conversationId, controller });
    return () => { void controller.dispose(); };
  }, [source, conversationId]);
  const conversations: ConversationsConfig = { items, activeId: conversationId, loading: list?.source !== source,
    onSelect: id => setSelection({ source, id }) };
  return { controller: binding?.source === source && binding.id === conversationId ? binding.controller : undefined, conversationId, conversations, error };
}
