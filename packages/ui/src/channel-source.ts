export type Member = { id: string; name: string; kind: 'person' | 'agent' | 'admin'; role?: 'owner' | 'validator' | 'member' | 'admin' | `agent:${string}`; avatarUrl?: string; presence?: 'here' | 'away' };
export type Conversation = { id: string; title: string; kind: 'main' | 'admin' | 'direct' | string; members: string[] };
export type Card = { requestId: string; title: string; line: string; since?: string; state?: string; action?: { id: string; label: string } };
export type Step = { label: string; detail?: string; status: 'running' | 'done' | 'failed' };
export type AvatarState = 'working' | 'thinking' | 'waiting' | 'blocked' | 'done' | 'neutral';
/** Host lifecycle ids affect presentation only. Missing and unknown ids have no indicator. */
export const channelAvatarStates: Readonly<Record<string, AvatarState | undefined>> = Object.freeze({
  building: 'working', executing: 'working', checks: 'working', asked: 'thinking',
  question: 'waiting', answer: 'waiting', review: 'waiting', preview: 'waiting',
  platform: 'blocked', fixing: 'blocked', live: 'done', declined: 'neutral',
});
export type ChannelMessage = { id: string; conversationId: string; author: string; at: string; text?: string; card?: Card; mentions?: string[]; replyTo?: string; attachments?: { path: string; title?: string }[]; steps?: Step[]; streaming?: boolean; removed?: { by: string; at: string }; clientId?: string };
export type ChannelEvent =
  | { type: 'message'; message: ChannelMessage }
  | { type: 'delta'; messageId: string; conversationId: string; text: string }
  | { type: 'step'; messageId: string; conversationId: string; index: number; step: Step }
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
  readonly files: readonly File[];
  readonly replyTo: string | undefined;
  readonly status: 'live' | 'reconnecting' | 'offline';
}
