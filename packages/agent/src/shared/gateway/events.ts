import type { PiChatEvent } from '../chat'
import type { AgentSessionRef, JsonSafe } from './types'

/** Placement-independent event envelope. `seq` is the only replay cursor. */
export interface AgentSessionEvent {
  readonly ref: AgentSessionRef
  readonly seq: number
  readonly event: JsonSafe<PiChatEvent>
}
