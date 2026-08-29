import type { PromptPayload } from './piChatCommand'

/** Server-only prompt admission selector; browser schemas never accept requireIdle. */
export type AgentPromptPayload = PromptPayload & { readonly requireIdle?: true }
