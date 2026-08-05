import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { workspaceSessionKey } from "../../front/sessionIdentity"
import type {
  UseWorkspaceAgentSessions,
  WorkspaceAgentSession,
  WorkspaceAgentSessionsApi,
} from "./WorkspaceAgentFront"

export interface WorkspaceAddressedAgentOption {
  agentTypeId: string
  label: string
  description?: string
}

interface FleetSnapshot<TSession extends WorkspaceAgentSession> {
  sourceIdentity: string
  controller: WorkspaceAgentSessionsApi<TSession>
}

interface AddressedFleetSessionsOptions<TSession extends WorkspaceAgentSession> {
  agents: readonly WorkspaceAddressedAgentOption[]
  selectedAgentTypeId: string | undefined
  selectAgentTypeId: (agentTypeId: string) => void
  discoveryLoading: boolean
  discoveryError: Error | undefined
  useSessions: UseWorkspaceAgentSessions<TSession>
  requestHeaders: Record<string, string>
  storageKey: string
  workspaceId: string
  apiBaseUrl?: string
  enabled: boolean
  refreshKey?: unknown
  fleetSourceIdentity: string
  sourceIdentityForAgent: (agentTypeId: string) => string
}

interface AddressedFleetSessionsResult<TSession extends WorkspaceAgentSession> {
  api: WorkspaceAgentSessionsApi<TSession>
  sources: ReactNode
  statuses: ReadonlyMap<string, "loading" | "loaded" | "error">
}

function sessionStateEqual(
  current: WorkspaceAgentSession | null | undefined,
  next: WorkspaceAgentSession | null | undefined,
): boolean {
  if (current == null || next == null) return current === next
  return current.id === next.id
    && current.agentTypeId === next.agentTypeId
    && current.title === next.title
    && current.updatedAt === next.updatedAt
    && current.turnCount === next.turnCount
    && current.nativeSessionId === next.nativeSessionId
    && current.hasAssistantReply === next.hasAssistantReply
    && current.ephemeral === next.ephemeral
    && current.status === next.status
}

function controllerStateEqual<TSession extends WorkspaceAgentSession>(
  current: WorkspaceAgentSessionsApi<TSession>,
  next: WorkspaceAgentSessionsApi<TSession>,
): boolean {
  return current.sourceIdentity === next.sourceIdentity
    && current.loading === next.loading
    && current.loadingMore === next.loadingMore
    && current.hasMore === next.hasMore
    && current.error === next.error
    && current.activeSessionId === next.activeSessionId
    && current.resumeSessionId === next.resumeSessionId
    && current.activeSessionAgentTypeId === next.activeSessionAgentTypeId
    && sessionStateEqual(current.activeSession, next.activeSession)
    && current.workspaceId === next.workspaceId
    && current.sessions.length === next.sessions.length
    && current.sessions.every((session, index) => sessionStateEqual(session, next.sessions[index]))
}

function sessionTime(session: WorkspaceAgentSession): number {
  if (typeof session.updatedAt === "number") return session.updatedAt
  if (typeof session.updatedAt !== "string") return 0
  const parsed = Date.parse(session.updatedAt)
  return Number.isNaN(parsed) ? 0 : parsed
}

function FleetSessionSource<TSession extends WorkspaceAgentSession>({
  agentTypeId,
  expectedSourceIdentity,
  useSessions,
  requestHeaders,
  storageKey,
  workspaceId,
  apiBaseUrl,
  enabled,
  refreshKey,
  publish,
  remove,
}: Omit<AddressedFleetSessionsOptions<TSession>,
  "agents" | "selectedAgentTypeId" | "selectAgentTypeId" | "discoveryLoading" | "discoveryError" | "fleetSourceIdentity" | "sourceIdentityForAgent"
> & {
  agentTypeId: string
  expectedSourceIdentity: string
  publish: (agentTypeId: string, sourceIdentity: string, controller: WorkspaceAgentSessionsApi<TSession>) => void
  remove: (agentTypeId: string, sourceIdentity: string) => void
}) {
  const controller = useSessions({
    requestHeaders,
    storageKey: `${storageKey}:${agentTypeId}`,
    sessionStorageScope: `${workspaceId}:${agentTypeId}`,
    agentTypeId,
    workspaceId,
    apiBaseUrl,
    enabled,
    refreshKey,
    sourceIdentity: expectedSourceIdentity,
  })

  useEffect(() => {
    publish(agentTypeId, expectedSourceIdentity, controller)
  })
  useEffect(() => () => remove(agentTypeId, expectedSourceIdentity), [agentTypeId, expectedSourceIdentity, remove])
  return null
}

export function useAddressedFleetSessions<TSession extends WorkspaceAgentSession>({
  agents,
  selectedAgentTypeId,
  selectAgentTypeId,
  discoveryLoading,
  discoveryError,
  useSessions,
  requestHeaders,
  storageKey,
  workspaceId,
  apiBaseUrl,
  enabled,
  refreshKey,
  fleetSourceIdentity,
  sourceIdentityForAgent,
}: AddressedFleetSessionsOptions<TSession>): AddressedFleetSessionsResult<TSession> {
  const controllersRef = useRef(new Map<string, FleetSnapshot<TSession>>())
  const [snapshots, setSnapshots] = useState<Map<string, FleetSnapshot<TSession>>>(() => new Map())

  const publish = useCallback((agentTypeId: string, sourceIdentity: string, controller: WorkspaceAgentSessionsApi<TSession>) => {
    if (controller.sourceIdentity !== sourceIdentity) return
    const snapshot = { sourceIdentity, controller }
    controllersRef.current.set(agentTypeId, snapshot)
    setSnapshots((previous) => {
      const current = previous.get(agentTypeId)
      if (current?.sourceIdentity === sourceIdentity && controllerStateEqual(current.controller, controller)) return previous
      const next = new Map(previous)
      next.set(agentTypeId, snapshot)
      return next
    })
  }, [])

  const remove = useCallback((agentTypeId: string, sourceIdentity: string) => {
    if (controllersRef.current.get(agentTypeId)?.sourceIdentity !== sourceIdentity) return
    controllersRef.current.delete(agentTypeId)
    setSnapshots((previous) => {
      if (previous.get(agentTypeId)?.sourceIdentity !== sourceIdentity) return previous
      const next = new Map(previous)
      next.delete(agentTypeId)
      return next
    })
  }, [])

  const sources = enabled ? agents.map((agent) => {
    const expectedSourceIdentity = sourceIdentityForAgent(agent.agentTypeId)
    return (
      <FleetSessionSource
        key={`${agent.agentTypeId}:${expectedSourceIdentity}`}
        agentTypeId={agent.agentTypeId}
        expectedSourceIdentity={expectedSourceIdentity}
        useSessions={useSessions}
        requestHeaders={requestHeaders}
        storageKey={storageKey}
        workspaceId={workspaceId}
        apiBaseUrl={apiBaseUrl}
        enabled
        refreshKey={refreshKey}
        publish={publish}
        remove={remove}
      />
    )
  }) : null

  const api = useMemo<WorkspaceAgentSessionsApi<TSession>>(() => {
    const authoritative = agents.flatMap((agent) => {
      const expected = sourceIdentityForAgent(agent.agentTypeId)
      const snapshot = snapshots.get(agent.agentTypeId)
      if (!snapshot || snapshot.sourceIdentity !== expected) return []
      return snapshot.controller.sessions.map((session) => ({
        ...session,
        agentTypeId: session.agentTypeId ?? agent.agentTypeId,
      }))
    }).sort((left, right) => sessionTime(right) - sessionTime(left)) as TSession[]
    const selectedSnapshot = selectedAgentTypeId ? snapshots.get(selectedAgentTypeId) : undefined
    const selected = selectedSnapshot && selectedSnapshot.sourceIdentity === (selectedAgentTypeId ? sourceIdentityForAgent(selectedAgentTypeId) : undefined)
      ? selectedSnapshot.controller
      : undefined
    const ownerFor = (id: string, requested?: string) => {
      if (requested) return requested
      const owners = authoritative.filter((session) => session.id === id).map((session) => session.agentTypeId)
      return owners.length === 1 ? owners[0] : selectedAgentTypeId
    }
    const controllerFor = (owner: string | undefined) => {
      if (!owner) return undefined
      const snapshot = controllersRef.current.get(owner)
      return snapshot?.sourceIdentity === sourceIdentityForAgent(owner) ? snapshot.controller : undefined
    }
    const statuses = agents.map((agent) => {
      const expected = sourceIdentityForAgent(agent.agentTypeId)
      const snapshot = snapshots.get(agent.agentTypeId)
      return !snapshot || snapshot.sourceIdentity !== expected || snapshot.controller.loading
        ? "loading" as const
        : snapshot.controller.error ? "error" as const : "loaded" as const
    })
    const controllers = agents.map((agent) => controllerFor(agent.agentTypeId)).filter((controller): controller is WorkspaceAgentSessionsApi<TSession> => Boolean(controller))
    const loading = discoveryLoading || agents.length === 0 || statuses.some((status) => status === "loading")
    const allFailed = statuses.length > 0 && statuses.every((status) => status === "error")
    const error = discoveryError ?? (allFailed ? controllers.map((controller) => controller.error).find(Boolean) : undefined)
    const hasMore = controllers.some((controller) => controller.hasMore)
    return {
      sourceIdentity: fleetSourceIdentity,
      sessions: authoritative,
      loading,
      loadingMore: controllers.some((controller) => controller.loadingMore),
      hasMore,
      inventoryAuthoritative: !loading && !hasMore && statuses.every((status) => status === "loaded"),
      error,
      activeSessionId: selected?.activeSessionId,
      resumeSessionId: selected?.resumeSessionId,
      activeSessionAgentTypeId: selectedAgentTypeId,
      activeSession: selected?.activeSession
        ? { ...selected.activeSession, agentTypeId: selected.activeSession.agentTypeId ?? selectedAgentTypeId } as TSession
        : undefined,
      workspaceId,
      switch(id, requestedOwner) {
        const owner = ownerFor(id, requestedOwner)
        if (owner && owner !== selectedAgentTypeId) selectAgentTypeId(owner)
        controllerFor(owner)?.switch(id, owner)
      },
      create(input) {
        const owner = input?.agentTypeId ?? selectedAgentTypeId
        const controller = controllerFor(owner)
        if (!owner || !controller) return Promise.reject(new Error("Agent sessions are not ready"))
        const { agentTypeId: _agentTypeId, ...createInput } = input ?? {}
        return Promise.resolve(controller.create(createInput)).then((session) => ({
          ...session,
          agentTypeId: session.agentTypeId ?? owner,
        }) as TSession)
      },
      rename(id, title, requestedOwner) {
        const owner = ownerFor(id, requestedOwner)
        return controllerFor(owner)?.rename?.(id, title, owner)
      },
      delete(id, requestedOwner) {
        const owner = ownerFor(id, requestedOwner)
        return controllerFor(owner)?.delete(id, owner)
      },
      loadMore: async () => {
        await Promise.all(controllers.filter((controller) => controller.hasMore).map((controller) => controller.loadMore?.()))
      },
      refresh: async (options) => {
        await Promise.all(agents.map((agent) => controllerFor(agent.agentTypeId)?.refresh?.(options)))
      },
    }
  }, [agents, discoveryError, discoveryLoading, fleetSourceIdentity, selectAgentTypeId, selectedAgentTypeId, snapshots, sourceIdentityForAgent, workspaceId])

  const statuses = useMemo(() => new Map(agents.map((agent) => {
    const expected = sourceIdentityForAgent(agent.agentTypeId)
    const snapshot = snapshots.get(agent.agentTypeId)
    const status = !snapshot || snapshot.sourceIdentity !== expected || snapshot.controller.loading
      ? "loading" as const
      : snapshot.controller.error ? "error" as const : "loaded" as const
    return [agent.agentTypeId, status]
  })), [agents, snapshots, sourceIdentityForAgent])

  return { api, sources, statuses }
}
