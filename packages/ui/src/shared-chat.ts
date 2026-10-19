import type { ChatAttempt, ChatDraft, ChatSendInput, NativeChatController, NativeChatSnapshot } from './native-chat.js';
import { randomUUID } from '@hachej/boring-files/platform';
import { createChatOutbox } from './chat-outbox.js';
import type { Card, ChannelEvent, ChannelMessage, ChannelSource, Member, SharedChatState } from './channel-source.js';
export type * from './channel-source.js';

export type SharedChatSnapshot = Omit<NativeChatSnapshot, 'conversationId' | 'send' | 'shared'> & {
  readonly conversationId: string;
  readonly shared: SharedChatState;
  readonly send: { readonly kind: 'idle' | 'submitting' | 'admitted' | 'unknown' } | { readonly kind: 'blocked'; readonly reason: string };
};
export type ChatSnapshot = NativeChatSnapshot | SharedChatSnapshot;
/** The renderer's existing draft/lifecycle contract. Native controllers retain their concrete conversation and native return values. */
export type ChatController = Pick<NativeChatController, 'subscribe' | 'setText' | 'setAttachments' | 'clearHistory' | 'loadEarlier' | 'connect' | 'stop' | 'dispose'> & {
  readonly getSnapshot: () => ChatSnapshot;
  readonly send: (whenBusy?: ChatAttempt['whenBusy'], input?: ChatSendInput) => Promise<unknown>;
  readonly reconcile: () => Promise<unknown>;
  readonly retrySameRequest: () => Promise<unknown>;
  readonly action?: (card: Card) => Promise<void>;
  readonly remove?: ((message: ChannelMessage) => Promise<void>) | undefined;
  readonly canRemove?: (message: ChannelMessage) => boolean;
};

/** Host-owned multi-party log, not a Pi conversation or an agent runtime. One adapter per selected conversation. */
export function createSharedChat(source: ChannelSource, options: { readonly conversationId: string; readonly limit?: number }) {
  const id = options.conversationId, limit = options.limit ?? 60;
  let snapshot: SharedChatSnapshot = Object.freeze<SharedChatSnapshot>({ identity: { runtimeId: 'shared-chat', scopeId: id, principalId: source.me.id }, conversationId: id,
    connection: { kind: 'idle' }, draft: { text: '', attachments: [], version: 0 }, outbox: [], history: { kind: 'idle' }, send: { kind: 'idle' }, stop: 'idle', disposed: false,
    shared: { me: structuredClone(source.me), members: [], messages: [], status: 'reconnecting' } });
  const listeners = new Set<() => void>();
  const outbox = createChatOutbox<Parameters<ChannelSource['send']>[0], ChannelMessage>();
  let unsubscribe: (() => void) | undefined, opening: Promise<void> | undefined, paging: Promise<void> | undefined, before: string | undefined;
  let revision = 0;
  const publish = (change: Partial<SharedChatSnapshot>) => {
    if (snapshot.disposed) return;
    snapshot = Object.freeze({ ...snapshot, ...change });
    for (const listener of [...listeners]) listener();
  };
  const active = () => { if (snapshot.disposed) throw new Error('Chat controller is disposed'); };
  const merge = (messages: readonly ChannelMessage[], prepend = false) => {
    // New stream events always win over an overlapping history read. Replacements keep the row's position and identity.
    const existing = snapshot.shared.messages;
    const all = prepend ? [...messages, ...existing] : [...existing, ...messages];
    const byId = new Map<string, ChannelMessage>();
    for (const message of all) {
      if (message.conversationId !== id) continue;
      if (message.clientId) for (const [key, value] of byId) if (value.clientId === message.clientId && key !== message.id) byId.delete(key);
      byId.set(message.id, structuredClone(message));
    }
    publish({ shared: { ...snapshot.shared, messages: [...byId.values()] } });
  };
  const acknowledge = (message: ChannelMessage) => {
    merge([message]);
    if (message.clientId) outbox.resolve(message.clientId, message);
  };
  const sendOne = (clientId: string, input: Parameters<ChannelSource['send']>[0]) => {
    void source.send(structuredClone(input)).then(message => {
      if (snapshot.disposed) return;
      if (message.conversationId !== id || message.clientId !== clientId) throw new Error('Shared send returned another clientId or conversation');
      acknowledge(message);
    }).catch(() => {
      // The host may have committed. Keep exactly this payload and clientId until an echo, reconnect or explicit retry.
      if (outbox.get(clientId)) publish({ send: { kind: 'unknown' } });
    });
  };
  const replay = () => { for (const call of outbox.values()) sendOne(call.input.clientId, call.input); };
  async function refresh() {
    // Walk backward to the newest known message, not just one page: a long disconnect must not drop a gap.
    const known = new Set(snapshot.shared.messages.map(message => message.id));
    let cursor: string | undefined;
    const seen = new Set<string>();
    do {
      const started = revision;
      const page = await source.history(id, { limit, ...(cursor ? { before: cursor } : {}) });
      if (snapshot.disposed) return;
      merge(page.messages, started !== revision || cursor !== undefined);
      if (!known.size && cursor === undefined) before = page.before;
      if (!page.before || !known.size || page.messages.some(message => known.has(message.id))) break;
      if (seen.has(page.before)) throw new Error('Channel history cursor did not progress');
      seen.add(page.before); cursor = page.before;
    } while (cursor);
    publish({ history: { kind: 'ready', entries: [], hasMore: before !== undefined } });
  }
  const event = (event: ChannelEvent) => {
    revision++;
    if (event.type === 'message') acknowledge(event.message);
    else if (event.type === 'delta' && event.conversationId === id) {
      const message = snapshot.shared.messages.find(message => message.id === event.messageId);
      if (message) merge([{ ...message, text: (message.text ?? '') + event.text, streaming: true }]);
    } else if (event.type === 'presence') {
      publish({ shared: { ...snapshot.shared, members: snapshot.shared.members.map(member => {
        const update = event.members.find(update => update.id === member.id);
        return update ? { ...member, presence: update.presence } : member;
      }) } });
    } else if (event.type === 'members' && event.conversationId === id) publish({ shared: { ...snapshot.shared, members: structuredClone(event.members) } });
  };
  let reconnect: Promise<void> | undefined;
  const status = (value: SharedChatState['status']) => {
    const previous = snapshot.shared.status;
    publish({ shared: { ...snapshot.shared, status: value }, connection: { kind: value === 'live' ? 'connected' : 'reconnecting' } });
    if (value === 'live' && previous !== 'live' && !opening && !reconnect) {
      reconnect = refresh().then(replay).catch(error => publish({ connection: { kind: 'error', error } })).finally(() => { reconnect = undefined; });
    }
  };
  const controller = {
    getSnapshot: (): SharedChatSnapshot => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setText: (text: string) => { active(); publish({ draft: { ...snapshot.draft, text, version: snapshot.draft.version + 1 } }); },
    setAttachments: (attachments: ChatDraft['attachments']) => { active(); publish({ draft: { ...snapshot.draft, attachments, version: snapshot.draft.version + 1 } }); },
    clearHistory: () => { active(); },
    loadEarlier: (): Promise<void> => {
      active();
      if (paging) return paging;
      if (!before) return Promise.resolve();
      const cursor = before;
      publish({ history: { kind: 'loading', entries: [], hasMore: true } });
      paging = source.history(id, { before: cursor, limit }).then(page => {
        if (page.before === cursor) throw new Error('Channel history cursor did not progress');
        before = page.before; merge(page.messages, true);
        publish({ history: { kind: 'ready', entries: [], hasMore: before !== undefined } });
      }).catch(error => publish({ history: { kind: 'error', entries: [], hasMore: true, error } })).finally(() => { paging = undefined; });
      return paging;
    },
    connect: (): Promise<void> => {
      active();
      if (opening) return opening;
      if (unsubscribe) return Promise.resolve();
      publish({ connection: { kind: 'connecting' } });
      opening = Promise.resolve().then(async () => {
        // Subscribe first: events arriving during the initial reads cannot fall through the history gap.
        unsubscribe = source.subscribe(id, event, status);
        const started = revision;
        const members = await source.members(id);
        if (snapshot.disposed) return;
        if (started === revision || !snapshot.shared.members.length) publish({ shared: { ...snapshot.shared, members: structuredClone(members) } });
        await refresh();
        status('live');
      }).catch(error => { unsubscribe?.(); unsubscribe = undefined; publish({ connection: { kind: 'error', error } }); }).finally(() => { opening = undefined; });
      return opening;
    },
    send: async (_whenBusy?: ChatAttempt['whenBusy'], input?: ChatSendInput): Promise<ChannelMessage | undefined> => {
      active();
      const selected = input ?? snapshot.draft;
      if (!selected.text.trim() && !selected.attachments?.length) return;
      if (selected.attachments?.length) throw new Error('Use shared file attachments, not native image payloads');
      const clientId = randomUUID();
      const mentions = snapshot.shared.members.filter(member => hasMemberMention(selected.text, member)).map(member => member.id);
      const payload = { conversationId: id, text: selected.text, mentions, clientId };
      const result = outbox.enqueue(clientId, payload);
      publish({ ...(!input ? { draft: { text: '', attachments: [], version: snapshot.draft.version + 1 } } : {}), send: { kind: 'submitting' } });
      sendOne(clientId, payload);
      try { const message = await result; publish({ send: { kind: 'admitted' } }); return message; }
      catch { return undefined; }
    },
    reconcile: async () => { active(); await refresh(); },
    retrySameRequest: async () => { active(); replay(); },
    stop: async () => { throw new Error('Only the host controls when an agent speaks'); },
    dispose: async () => {
      if (snapshot.disposed) return;
      unsubscribe?.(); unsubscribe = undefined;
      for (const call of outbox.values()) call.reject(new Error('Shared chat disposed'));
      outbox.clear();
      snapshot = Object.freeze<SharedChatSnapshot>({ ...snapshot, disposed: true, connection: { kind: 'closed' } });
      for (const listener of [...listeners]) listener();
      listeners.clear();
      return undefined;
    },
    action: (card: Card) => card.action ? source.action({ conversationId: id, requestId: card.requestId, actionId: card.action.id }) : Promise.resolve(),
    remove: source.remove && source.canRemove ? (message: ChannelMessage) => source.canRemove?.(message) === true ? source.remove!(message.id) : Promise.reject(new Error('Removal refused')) : undefined,
    canRemove: (message: ChannelMessage) => Boolean(source.remove && source.canRemove?.(message)),
  } satisfies ChatController & { action: (card: Card) => Promise<void>; remove: ((message: ChannelMessage) => Promise<void>) | undefined; canRemove: (message: ChannelMessage) => boolean };
  return controller;
}
export type SharedChatController = ReturnType<typeof createSharedChat>;

/** The composer uses the existing quoted @ token grammar. Names are display text; only resolved member ids leave the adapter. */
export function memberMention(member: Member): string {
  return /[\s"\\]/.test(member.id) ? `@"${member.id.replace(/[\\"]/g, '\\$&')}"` : `@${member.id}`;
}
function hasMemberMention(text: string, member: Member): boolean {
  const token = memberMention(member);
  return [...text.matchAll(/(^|\s)(@"(?:[^"\\]|\\.)*"|@[^\s]+)/g)].some(match => match[2] === token);
}

export { createFakeChannelSource } from './fake-channel.js';
export type { FakeChannelSeed } from './fake-channel.js';
export { createChannelSocket } from './channel-socket.js';
export type { ChannelSocketOptions } from './channel-socket.js';
