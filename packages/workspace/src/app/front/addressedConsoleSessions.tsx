import { useCallback, useEffect, useRef, type MutableRefObject } from "react"
import type { WorkspaceSessionRef } from "../../front/sessionIdentity"
import type {
  UseWorkspaceAgentSessions,
  WorkspaceAddressedAgentOption,
  WorkspaceAgentSession,
  WorkspaceAgentSessionsApi,
} from "./WorkspaceAgentFront"

export interface AddressedConsoleSessionsHostProps<
  TSession extends WorkspaceAgentSession = WorkspaceAgentSession,
> {
  agents: readonly WorkspaceAddressedAgentOption[]
  useSessions: UseWorkspaceAgentSessions<TSession>
  requestHeaders: Record<string, string>
  storageKey: string
  workspaceId: string
  apiBaseUrl?: string
  enabled: boolean
  onController: (agentTypeId: string, controller: WorkspaceAgentSessionsApi<TSession>) => void
  onControllerRemoved: (agentTypeId: string) => void
}

export interface AddressedConsoleControllerOptions<
  TSession extends WorkspaceAgentSession = WorkspaceAgentSession,
> {
  enabled: boolean
  selectedAgentTypeId?: string
  selectAgentTypeId: (agentTypeId: string) => void
  controllers: MutableRefObject<Map<string, WorkspaceAgentSessionsApi<TSession>>>
}

/**
 * Routes every addressed action by the composite session owner. Selection is
 * changed before switching a pane whose owner differs from the current agent.
 */
export function useAddressedConsoleController<
  TSession extends WorkspaceAgentSession = WorkspaceAgentSession,
>({
  enabled,
  selectedAgentTypeId,
  selectAgentTypeId,
  controllers,
}: AddressedConsoleControllerOptions<TSession>) {
  const pendingActivationRef = useRef<WorkspaceSessionRef | null>(null)

  const activate = useCallback((session: WorkspaceSessionRef) => {
    if (!enabled || !session.agentTypeId) return false
    if (session.agentTypeId !== selectedAgentTypeId) {
      pendingActivationRef.current = session
      selectAgentTypeId(session.agentTypeId)
      return true
    }
    controllers.current.get(session.agentTypeId)?.switch(session.sessionId)
    return true
  }, [controllers, enabled, selectAgentTypeId, selectedAgentTypeId])

  useEffect(() => {
    const pending = pendingActivationRef.current
    if (!enabled || !pending?.agentTypeId || pending.agentTypeId !== selectedAgentTypeId) return
    const controller = controllers.current.get(pending.agentTypeId)
    if (!controller || controller.loading) return
    pendingActivationRef.current = null
    controller.switch(pending.sessionId)
  })

  const deleteSession = useCallback((session: WorkspaceSessionRef) => {
    if (!enabled || !session.agentTypeId) return undefined
    return controllers.current.get(session.agentTypeId)?.delete(session.sessionId)
  }, [controllers, enabled])

  const refreshSession = useCallback((session: WorkspaceSessionRef) => {
    if (!enabled || !session.agentTypeId) return undefined
    return controllers.current.get(session.agentTypeId)?.refresh?.({ background: true })
  }, [controllers, enabled])

  return { activate, deleteSession, refreshSession }
}

function AddressedConsoleSessionSource<
  TSession extends WorkspaceAgentSession = WorkspaceAgentSession,
>({
  agentTypeId,
  useSessions,
  requestHeaders,
  storageKey,
  workspaceId,
  apiBaseUrl,
  enabled,
  onController,
  onControllerRemoved,
}: Omit<AddressedConsoleSessionsHostProps<TSession>, "agents"> & {
  agentTypeId: string
}) {
  const controller = useSessions({
    requestHeaders,
    storageKey,
    agentTypeId,
    workspaceId,
    apiBaseUrl,
    enabled,
  })

  useEffect(() => {
    onController(agentTypeId, controller)
  })

  useEffect(() => () => {
    onControllerRemoved(agentTypeId)
  }, [agentTypeId, onControllerRemoved])

  return null
}

/**
 * Keeps one session source mounted per addressed owner. The parent routes
 * actions through the matching controller instead of widening whichever
 * controller happens to be selected.
 */
export function AddressedConsoleSessionsHost<
  TSession extends WorkspaceAgentSession = WorkspaceAgentSession,
>({
  agents,
  ...props
}: AddressedConsoleSessionsHostProps<TSession>) {
  return (
    <>
      {agents.map((agent) => (
        <AddressedConsoleSessionSource
          key={agent.agentTypeId}
          {...props}
          agentTypeId={agent.agentTypeId}
        />
      ))}
    </>
  )
}
