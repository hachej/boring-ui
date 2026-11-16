import type { Row } from '@hachej/boring-ui-kit/chat-view';
import type { ReplyRef } from '../pi-chat/config';
import { replyRef } from '../pi-chat/rows';

/** What the folded card (`composer: 'bar'`, conversation closed) shows. At most one of these, in this order of precedence. */
export type FoldedCardKind = 'question' | 'working' | 'failed' | 'reply';

/** What the card has to show, as booleans: the agent's question, work under way, a failed turn, a reply that came while folded. */
export interface FoldedCardState { readonly question: boolean; readonly working: boolean; readonly failed: boolean; readonly reply: boolean }

/**
 * A question waits for the person first, then work in progress (a new turn clears an earlier failure), then a failed turn (it beats a reply: a turn
 * that wrote some text and then failed did not finish), then a reply. Nothing to show gives `undefined`.
 */
export function foldedCardKind(state: FoldedCardState): FoldedCardKind | undefined {
  if (state.question) return 'question';
  if (state.working) return 'working';
  if (state.failed) return 'failed';
  return state.reply ? 'reply' : undefined;
}

/**
 * The turn that failed, when the conversation's last message is the assistant's failed one (`stopReason: 'error'`, a run that ended without an answer
 * included). Any later message of the person (a send, even one still going out) or of the assistant takes it away. The same reference the thread's
 * `replyError` receives.
 */
export function failedReply(rows: readonly Row<unknown>[]): ReplyRef | undefined {
  const last = rows.findLast(row => row.type === 'user' || row.type === 'assistant');
  return last?.type === 'assistant' && last.stopReason === 'error' ? replyRef(last) : undefined;
}
