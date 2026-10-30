import type { PresentedArtifact } from '../chat-artifacts.js';
export type { PresentedArtifact } from '../chat-artifacts.js';
/** `roleLabel` is the host's own line beside the author (« the coach »); without it the view derives one from `kind` and `role`. */
export type Member = { id: string; name: string; kind: 'person' | 'agent' | 'admin'; role?: 'owner' | 'validator' | 'member' | 'admin' | `agent:${string}`; roleLabel?: string; avatarUrl?: string; presence?: 'here' | 'away' };
export type Conversation = { id: string; title: string; kind: 'main' | 'admin' | 'direct' | string; members: string[] };
/** `primary` is the card's main choice; `secondary` a quieter one (« Not now »). Without a variant the first action is primary. */
export type CardAction = { id: string; label: string; variant?: 'primary' | 'secondary' };
/**
 * `actions` offers several choices; the older single `action` still works and is used only when `actions` is absent.
 * `kind: 'pin'` is a comment pinned on a spot (`title` is the comment, `line` where it is pinned), shown as a quoted reply; absent or `request` is a request card.
 */
export type Card = { requestId: string; kind?: 'request' | 'pin'; title: string; line: string; since?: string; state?: string; action?: CardAction; actions?: CardAction[] };
/** The card's choices in order: `actions`, else the single `action`, else none. */
export function cardActions(card: Pick<Card, 'action' | 'actions'>): readonly CardAction[] {
  return card.actions ?? (card.action ? [card.action] : []);
}
/**
 * An agent's question to the people in the room (`ask_user`): `prompt`, the choices as buttons and, when `allowFreeText`, a free reply.
 * A reply to the message (`replyTo`) answers it; `answered` turns the buttons off.
 */
export type Question = { callId: string; prompt: string; options: string[]; allowFreeText: boolean; answered: boolean };
export type Step = { label: string; detail?: string; status: 'running' | 'done' | 'failed' };
export type AvatarState = 'working' | 'thinking' | 'waiting' | 'blocked' | 'done' | 'neutral';
/** Host lifecycle ids affect presentation only. Missing and unknown ids have no indicator. */
export const channelAvatarStates: Readonly<Record<string, AvatarState | undefined>> = Object.freeze({
  building: 'working', executing: 'working', checks: 'working', asked: 'thinking',
  question: 'waiting', answer: 'waiting', review: 'waiting', preview: 'waiting',
  platform: 'blocked', fixing: 'blocked', live: 'done', declined: 'neutral',
});
/** `kind: 'system'` marks a host notice (« Léa joined », « Shipped: … »): a small centred line, consecutive ones collapsed into one. */
export type ChannelMessage = { id: string; conversationId: string; author: string; at: string; via?: string; text?: string; kind?: 'system'; card?: Card; question?: Question; mentions?: string[]; replyTo?: string; artifacts?: PresentedArtifact[]; attachments?: { path: string; title?: string }[]; steps?: Step[]; streaming?: boolean; removed?: { by: string; at: string }; clientId?: string;
  /** Set only by the controller on the sender's own copy while the host has not confirmed it yet; a host never sends it. */
  pending?: true };
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
