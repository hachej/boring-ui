/** Optional native Pi presentation integration, not part of headless UI root.
 * Preserve native asynchronous backpressure, exact operations and close reason.
 */
import type { ConversationWatch } from '@earendil-works/pi-durable';
export type { ConversationView, ConversationWatch, WatchEnd } from '@earendil-works/pi-durable';

export interface ChatSource {
  /** Host binds authentication/native Context to the selected conversation.
   * No new SnapshotSubscription or copied native watch lifecycle.
   */
  readonly open: (signal?: AbortSignal) => Promise<ConversationWatch>;
}
