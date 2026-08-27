/**
 * Recovery contract for gh-1402.
 *
 * Decision 28 (gh-1386) makes default-Agent resolution fail closed: a persisted
 * `default_agent_type_id` naming a seat that no longer exists throws instead of
 * silently substituting another Agent. That guarantee is right, but on its own
 * it leaves the workspace owner with a 409 and no way forward.
 *
 * This module is the transport contract that makes the state *recoverable*:
 * a diagnostic read that reports the unavailable seat alongside the seats that
 * ARE available, and an explicit write that repins the workspace default. The
 * write is only ever reached from a user's deliberate choice, so the "nothing
 * rewrites a non-NULL persisted value automatically" line still holds.
 */
export const WORKSPACE_DEFAULT_AGENT_ROUTE = '/api/v1/workspace/default-agent'

export interface WorkspaceDefaultAgentOption {
  readonly agentTypeId: string
  readonly label: string
}

export interface WorkspaceDefaultAgentState {
  readonly workspaceId: string
  /**
   * `unavailable` means the persisted seat is not in the validated fleet, so
   * every gated effect in this workspace is refused until it is repinned.
   */
  readonly status: 'ok' | 'unavailable'
  /** NULL only during the rolling-migration window; never invented by the read. */
  readonly persistedDefaultAgentTypeId: string | null
  readonly availableAgents: readonly WorkspaceDefaultAgentOption[]
}
