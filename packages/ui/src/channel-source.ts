export type Member = { id: string; name: string; kind: 'person' | 'agent' | 'admin'; role?: 'owner' | 'validator' | 'member' | 'admin' | `agent:${string}`; avatarUrl?: string; presence?: 'here' | 'away' };
export type Conversation = { id: string; title: string; kind: 'main' | 'admin' | 'direct' | string; members: string[] };
export type Card = { requestId: string; title: string; line: string; since?: string; action?: { id: string; label: string } };
export type ChannelMessage = { id: string; conversationId: string; author: string; at: string; text?: string; card?: Card; mentions?: string[]; replyTo?: string; attachments?: { path: string; title?: string }[]; streaming?: boolean; removed?: { by: string; at: string }; clientId?: string };
export type ChannelEvent =
  | { type: 'message'; message: ChannelMessage }
  | { type: 'delta'; messageId: string; conversationId: string; text: string }
  | { type: 'presence'; members: { id: string; presence: 'here' | 'away' }[] }
  | { type: 'members'; conversationId: string; members: Member[] };
export interface ChannelSource {
  readonly me: Member;
  readonly conversations: () => Promise<Conversation[]>;
  readonly members: (conversationId: string) => Promise<Member[]>;
  readonly history: (conversationId: string, opts: { before?: string; limit: number }) => Promise<{ messages: ChannelMessage[]; before?: string }>;
  readonly send: (input: { conversationId: string; text: string; mentions: string[]; replyTo?: string; clientId: string; attachments?: File[] }) => Promise<ChannelMessage>;
  readonly action: (input: { conversationId: string; requestId: string; actionId: string }) => Promise<void>;
  readonly remove?: (messageId: string) => Promise<void>;
  readonly canRemove?: (message: ChannelMessage) => boolean;
  readonly subscribe: (conversationId: string, onEvent: (event: ChannelEvent) => void, onStatus?: (status: 'live' | 'reconnecting' | 'offline') => void) => () => void;
}
export interface SharedChatState {
  readonly me: Member;
  readonly members: readonly Member[];
  readonly messages: readonly ChannelMessage[];
  readonly status: 'live' | 'reconnecting' | 'offline';
}
