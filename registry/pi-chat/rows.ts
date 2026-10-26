import type { ReactNode } from 'react';
import type { ConversationView } from '@earendil-works/pi-durable';
import { derive as deriveView } from '@hachej/boring-ui-kit/chat-view';
import type * as View from '@hachej/boring-ui-kit/chat-view';

/*
 * The row model lives in the kit (`@hachej/boring-ui-kit/chat-view`): native Pi view → display rows, the waiting rule and the run
 * notices. This file only fixes its card content to React nodes and keeps the names the chat's files import.
 */
export { APPROVAL_DETAILS, isFileBlock, markLeads, object, queuedMessages, replyMeta, segments, streamParts, targetContent, waitingForAnswer, waitingPart, waits } from '@hachej/boring-ui-kit/chat-view';
export type { ApprovalDecision, Mode, QueuedMessage, StreamPart } from '@hachej/boring-ui-kit/chat-view';
export type ChatCard = View.ChatCard<ReactNode>;
export type Part = View.Part<ReactNode>;
export type Row = View.Row<ReactNode>;
export type Derived = View.Derived<ReactNode>;
export type DeriveOptions = View.DeriveOptions<ReactNode>;
export type Step = View.Step<ReactNode>;
export type Segment = View.Segment<ReactNode>;
export const derive: (view: ConversationView | undefined, options: DeriveOptions) => Derived = deriveView;
