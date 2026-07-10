import type { InterruptReceipt, StopReceipt } from './chat'
import type { AgentEvent, AgentSendInput } from './events'

export interface WorkspaceAgentDispatcherContext {
  workspaceId: string
  userId: string
}

export type WorkspaceAgentDispatcherSendInput = Omit<AgentSendInput, 'ctx'>

export interface WorkspaceAgentDispatcher {
  send(input: WorkspaceAgentDispatcherSendInput): AsyncIterable<AgentEvent>
  interrupt(sessionId: string): Promise<InterruptReceipt>
  stop(sessionId: string): Promise<StopReceipt>
}
