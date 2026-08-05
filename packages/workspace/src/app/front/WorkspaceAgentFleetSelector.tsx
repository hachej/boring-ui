import { AlertTriangle, Bot, ChevronDown } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"

export interface WorkspaceAgentFleetOption {
  readonly agentTypeId: string
  readonly label: string
  readonly description?: string
}

interface WorkspaceAgentFleetState {
  readonly status: "disabled" | "loading" | "ready" | "error"
  readonly options: readonly WorkspaceAgentFleetOption[]
  readonly selectedAgentTypeId: string
  readonly diagnostic?: string
}

interface StoredWorkspaceAgentFleetState extends WorkspaceAgentFleetState {
  readonly scopeKey: string
}

export interface UseWorkspaceAgentFleetOptions {
  readonly enabled: boolean
  readonly hostDefaultAgentTypeId: string
  readonly apiBaseUrl?: string
  readonly requestHeaders: Readonly<Record<string, string>>
  readonly storageKey: string
}

export interface WorkspaceAgentFleetSelection extends WorkspaceAgentFleetState {
  readonly selectAgent: (agentTypeId: string) => void
}

function hostDefaultOption(agentTypeId: string): WorkspaceAgentFleetOption {
  return { agentTypeId, label: "Agent" }
}

function readStoredSelection(storageKey: string): string | null {
  try {
    return globalThis.localStorage?.getItem(storageKey) ?? null
  } catch {
    return null
  }
}

function writeStoredSelection(storageKey: string, agentTypeId: string): void {
  try {
    globalThis.localStorage?.setItem(storageKey, agentTypeId)
  } catch {
    // Best-effort UI preference only.
  }
}

function parseFleet(payload: unknown): WorkspaceAgentFleetOption[] {
  if (!Array.isArray(payload) || payload.length > 100) throw new Error("invalid fleet response")
  const seen = new Set<string>()
  const fleet: WorkspaceAgentFleetOption[] = []
  for (const value of payload) {
    if (!value || typeof value !== "object") throw new Error("invalid fleet response")
    const item = value as Record<string, unknown>
    if (typeof item.agentTypeId !== "string" || !item.agentTypeId || item.agentTypeId.length > 200) {
      throw new Error("invalid fleet response")
    }
    if (typeof item.label !== "string" || !item.label || item.label.length > 200 || seen.has(item.agentTypeId)) {
      throw new Error("invalid fleet response")
    }
    if (item.description !== undefined && (typeof item.description !== "string" || item.description.length > 1_000)) {
      throw new Error("invalid fleet response")
    }
    seen.add(item.agentTypeId)
    fleet.push({
      agentTypeId: item.agentTypeId,
      label: item.label,
      ...(typeof item.description === "string" ? { description: item.description } : {}),
    })
  }
  return fleet
}

export function useWorkspaceAgentFleet(options: UseWorkspaceAgentFleetOptions): WorkspaceAgentFleetSelection {
  const fallback = useMemo(() => hostDefaultOption(options.hostDefaultAgentTypeId), [options.hostDefaultAgentTypeId])
  const [storedState, setStoredState] = useState<StoredWorkspaceAgentFleetState>(() => ({
    scopeKey: options.storageKey,
    status: options.enabled ? "loading" : "disabled",
    options: [fallback],
    selectedAgentTypeId: options.hostDefaultAgentTypeId,
  }))
  const state: WorkspaceAgentFleetState = storedState.scopeKey === options.storageKey
    ? storedState
    : {
        status: options.enabled ? "loading" : "disabled",
        options: [fallback],
        selectedAgentTypeId: options.hostDefaultAgentTypeId,
      }

  useEffect(() => {
    if (!options.enabled) {
      setStoredState({ scopeKey: options.storageKey, status: "disabled", options: [fallback], selectedAgentTypeId: options.hostDefaultAgentTypeId })
      return
    }
    let cancelled = false
    setStoredState({ scopeKey: options.storageKey, status: "loading", options: [fallback], selectedAgentTypeId: options.hostDefaultAgentTypeId })
    const base = options.apiBaseUrl?.replace(/\/$/, "") ?? ""
    void fetch(`${base}/api/v1/agents`, { headers: { ...options.requestHeaders } })
      .then(async (response) => {
        if (!response.ok) throw new Error("fleet request failed")
        return parseFleet(await response.json())
      })
      .then((fleet) => {
        if (cancelled) return
        const defaultPresent = fleet.some((item) => item.agentTypeId === options.hostDefaultAgentTypeId)
        const available = defaultPresent ? fleet : [fallback, ...fleet]
        const stored = readStoredSelection(options.storageKey)
        const selectedAgentTypeId = stored && fleet.some((item) => item.agentTypeId === stored)
          ? stored
          : options.hostDefaultAgentTypeId
        if (stored && !fleet.some((item) => item.agentTypeId === stored)) {
          writeStoredSelection(options.storageKey, options.hostDefaultAgentTypeId)
        }
        setStoredState({
          scopeKey: options.storageKey,
          status: "ready",
          options: available,
          selectedAgentTypeId,
          ...(!defaultPresent ? { diagnostic: "Host-default Agent is absent from the advertised fleet; existing default behavior is preserved." } : {}),
        })
      })
      .catch(() => {
        if (cancelled) return
        setStoredState({
          scopeKey: options.storageKey,
          status: "error",
          options: [fallback],
          selectedAgentTypeId: options.hostDefaultAgentTypeId,
          diagnostic: "Agent list is unavailable; new chats will use the host-default Agent.",
        })
      })
    return () => { cancelled = true }
  }, [fallback, options.apiBaseUrl, options.enabled, options.hostDefaultAgentTypeId, options.requestHeaders, options.storageKey])

  const selectAgent = useCallback((agentTypeId: string) => {
    setStoredState((current) => {
      if (current.scopeKey !== options.storageKey || current.status !== "ready" || !current.options.some((item) => item.agentTypeId === agentTypeId)) return current
      writeStoredSelection(options.storageKey, agentTypeId)
      return { ...current, selectedAgentTypeId: agentTypeId }
    })
  }, [options.storageKey])

  return { ...state, selectAgent }
}

export function WorkspaceAgentFleetSelector({ fleet }: { fleet: WorkspaceAgentFleetSelection }) {
  if (fleet.status === "disabled") return null
  const selected = fleet.options.find((item) => item.agentTypeId === fleet.selectedAgentTypeId)
  const disabled = fleet.status !== "ready" || fleet.options.length < 2

  return (
    <div
      data-boring-workspace-part="agent-fleet-selector"
      className="flex min-w-0 items-center gap-2 rounded-lg border border-border/60 bg-muted/25 px-2 py-1 text-foreground"
      title={fleet.diagnostic ?? selected?.description}
    >
      <Bot className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
      <div className="min-w-0">
        <div className="text-[10px] font-medium leading-3 text-muted-foreground">New chats</div>
        <label className="relative flex min-w-0 items-center">
          <span className="sr-only">Agent for new chats</span>
          <select
            aria-label="Agent for new chats"
            value={fleet.selectedAgentTypeId}
            disabled={disabled}
            onChange={(event) => fleet.selectAgent(event.currentTarget.value)}
            className="h-5 min-w-0 max-w-40 appearance-none truncate bg-transparent pr-5 text-xs font-semibold leading-5 outline-none disabled:cursor-default disabled:opacity-70 focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            {fleet.options.map((agent) => (
              <option key={agent.agentTypeId} value={agent.agentTypeId}>{agent.label}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-0 size-3 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
        </label>
      </div>
      {fleet.diagnostic ? (
        <AlertTriangle className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-label={fleet.diagnostic} />
      ) : null}
      <span className="sr-only" aria-live="polite">
        {fleet.status === "loading" ? "Loading Agents." : fleet.diagnostic ?? `New chats use ${selected?.label ?? "Agent"}.`}
      </span>
    </div>
  )
}
