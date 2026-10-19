import type { ChannelEvent, ChannelMessage, ChannelSource, Conversation, Member, SharedChatState } from './channel-source.js';

export interface FakeChannelSeed {
  readonly me: Member;
  readonly members: Member[];
  readonly conversations: Conversation[];
  readonly messages: ChannelMessage[];
}
/** Fictional in-memory host. The controls exercise exactly the source events a real host delivers. */
export function createFakeChannelSource(seed: FakeChannelSeed) {
  const data = structuredClone(seed);
  const listeners = new Set<{ id: string; event: (event: ChannelEvent) => void; status?: ((status: SharedChatState['status']) => void) | undefined }>();
  const sends: Parameters<ChannelSource['send']>[0][] = [], actions: Parameters<ChannelSource['action']>[0][] = [];
  let online = true;
  function emit(event: ChannelEvent) {
    if (event.type === 'message') {
      const index = data.messages.findIndex(message => message.id === event.message.id);
      if (index < 0) data.messages.push(structuredClone(event.message)); else data.messages[index] = structuredClone(event.message);
    } else if (event.type === 'delta') {
      const message = data.messages.find(message => message.id === event.messageId && message.conversationId === event.conversationId);
      if (message) { message.text = (message.text ?? '') + event.text; message.streaming = true; }
    } else if (event.type === 'presence') for (const update of event.members) {
      const member = data.members.find(member => member.id === update.id); if (member) member.presence = update.presence;
    }
    else if (event.type === 'members') {
      for (const member of event.members) {
        const index = data.members.findIndex(existing => existing.id === member.id);
        if (index < 0) data.members.push(structuredClone(member)); else data.members[index] = structuredClone(member);
      }
      const conversation = data.conversations.find(conversation => conversation.id === event.conversationId);
      if (conversation) conversation.members = event.members.map(member => member.id);
    }
    if (online) for (const listener of [...listeners]) {
      const id = event.type === 'message' ? event.message.conversationId : event.type === 'presence' ? undefined : event.conversationId;
      if (id === undefined || id === listener.id) listener.event(structuredClone(event));
    }
  }
  return {
    me: data.me,
    conversations: async () => structuredClone(data.conversations),
    members: async (id: string) => structuredClone(data.members.filter(member => data.conversations.find(conversation => conversation.id === id)?.members.includes(member.id))),
    history: async (id: string, opts: { before?: string; limit: number }) => {
      const all = data.messages.filter(message => message.conversationId === id);
      const end = opts.before ? all.findIndex(message => message.id === opts.before) : all.length;
      if (end < 0) throw new Error('Unknown history cursor');
      const start = Math.max(0, end - opts.limit);
      return { messages: structuredClone(all.slice(start, end)), ...(start > 0 && all[start] ? { before: all[start].id } : {}) };
    },
    send: async (input: Parameters<ChannelSource['send']>[0]) => {
      sends.push({ ...input, mentions: [...input.mentions], ...(input.attachments ? { attachments: [...input.attachments] } : {}) });
      if (!online) throw new Error('Offline');
      const duplicate = data.messages.find(message => message.clientId === input.clientId && message.conversationId === input.conversationId);
      if (duplicate) return structuredClone(duplicate);
      const message: ChannelMessage = { id: `sent-${input.clientId}`, conversationId: input.conversationId, author: data.me.id, at: new Date().toISOString(), text: input.text, mentions: [...input.mentions], clientId: input.clientId };
      emit({ type: 'message', message }); return structuredClone(message);
    },
    action: async (input: Parameters<ChannelSource['action']>[0]) => { actions.push(structuredClone(input)); },
    subscribe: (id: string, event: (event: ChannelEvent) => void, status?: (status: SharedChatState['status']) => void) => {
      const listener = { id, event, status }; listeners.add(listener); status?.(online ? 'live' : 'offline');
      return () => { listeners.delete(listener); };
    },
    emit, sends, actions,
    setStatus: (status: SharedChatState['status']) => { online = status === 'live'; for (const listener of [...listeners]) listener.status?.(status); },
  } satisfies ChannelSource & { emit: typeof emit; sends: typeof sends; actions: typeof actions; setStatus: (status: SharedChatState['status']) => void };
}
