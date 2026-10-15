/** Compile-checked host wiring, not implemented Boring runtime/adapters.
 * Do not widen these examples into a second tool registration or engine API.
 */
import type { Context, Harness, Registry, Conversation, AgentChange } from '@hachej/boring-agent/native';
import type { EnvironmentFactory } from '@hachej/boring-execution';
import type { ResourceClient } from '@hachej/boring-files';
import type { ViewerController } from '@hachej/boring-ui-kit';
import type { ChatSource } from '@hachej/boring-ui-kit/pi';
import type { HarnessOptions } from '@earendil-works/pi-durable';

/** Preserve the exact native factory: target, committed reads, Context, async,
 * undefined and conversation-specific cwd. Never return a singleton whose cwd
 * silently ignores the current native target, or acquire a fresh VM per call.
 * The host explicitly installs CodingTools and selects extensions beforehand.
 */
export function remoteCodingBindings(registry: Registry, env: EnvironmentFactory) {
  return { registry, env } satisfies Pick<HarnessOptions, 'registry' | 'env'>;
}

export async function backgroundAppConversation(harness: Harness, agent: AgentChange, context: Context) {
  return harness.createConversation({ ownership: { kind: 'ownerless' }, agent }, context);
}

/** No compulsory resource mount for a sidecar; add clients only when needed. */
export function assistantBesideApp<State, Actions, Tools>(bindings: {
  conversation: Conversation;
  chat: ChatSource;
  viewer: ViewerController<State, Actions, Tools>;
  resources?: ResourceClient;
}) {
  return bindings;
}
