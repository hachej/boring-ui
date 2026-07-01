import type { WorkspaceBridge, CausedBy } from "./types"
import type { WorkspaceStore, PanelState } from "../store/types"

export interface UIStatePut {
  v: 1
  causedBy: CausedBy
  openPanels: PanelState[]
  activePanel: string | null
  activeFile: string | null
  visibleFiles: string[]
  dirtyFiles: string[]
}

export interface BridgeClientOptions {
  endpoint: string
  bridge: WorkspaceBridge
  store: StoreApi
  authToken?: string
  pollMode?: boolean
  pollInterval?: number
  onAuthError?: (statusCode: number) => void
  onVersionMismatch?: (version: number) => void
  onConnectionChange?: (connected: boolean) => void
}

type StoreApi = {
  getState: () => WorkspaceStore
  subscribe: (listener: (state: WorkspaceStore, prev: WorkspaceStore) => void) => () => void
}

interface SSECommand {
  v: number
  kind: string
  params: Record<string, unknown>
}

interface SSEError {
  v: number
  code: string
  message: string
}

type CommandKind =
  | "openFile"
  | "openPanel"
  | "closePanel"
  | "closeWorkbenchLeftPane"
  | "showNotification"
  | "navigateToLine"
  | "expandToFile"
  | "markDirty"
  | "markClean"

const DEBOUNCE_MS = 100
const DEFAULT_POLL_INTERVAL = 3000

function buildHeaders(authToken?: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`
  return headers
}

function snapshotState(store: StoreApi, causedBy: CausedBy): UIStatePut {
  const state = store.getState()
  return {
    v: 1,
    causedBy,
    openPanels: state.panels,
    activePanel: state.activePanel,
    activeFile: state.activeFile,
    visibleFiles: state.visibleFiles,
    dirtyFiles: Object.keys(state.dirtyFiles),
  }
}

async function dispatchCommand(
  bridge: WorkspaceBridge,
  kind: string,
  params: Record<string, unknown>,
): Promise<void> {
  switch (kind as CommandKind) {
    case "openFile":
      await bridge.openFile(
        params.path as string,
        params.mode || params.filesystem
          ? {
              mode: params.mode as "view" | "edit" | "diff" | undefined,
              filesystem: params.filesystem as string | undefined,
            }
          : undefined,
      )
      break
    case "openPanel":
      await bridge.openPanel({
        id: params.id as string,
        component: params.component as string,
        params: params.params as Record<string, unknown> | undefined,
        title: params.title as string | undefined,
      })
      break
    case "closePanel":
      await bridge.closePanel(params.id as string)
      break
    case "closeWorkbenchLeftPane":
      await bridge.closeWorkbenchLeftPane()
      break
    case "showNotification":
      await bridge.showNotification(
        params.msg as string,
        params.level as "info" | "warn" | "error" | undefined,
      )
      break
    case "navigateToLine":
      await bridge.navigateToLine(
        params.file as string,
        params.line as number,
      )
      break
    case "expandToFile":
      await bridge.expandToFile(params.path as string)
      break
    case "markDirty":
      bridge.markDirty(params.path as string)
      break
    case "markClean":
      bridge.markClean(params.path as string)
      break
  }
}

export interface BridgeClient {
  connect(): void
  disconnect(): void
  pushState(causedBy: CausedBy): void
}

export function createBridgeClient(options: BridgeClientOptions): BridgeClient {
  const {
    endpoint,
    bridge,
    store,
    authToken,
    pollMode = false,
    pollInterval = DEFAULT_POLL_INTERVAL,
    onAuthError,
    onVersionMismatch,
    onConnectionChange,
  } = options

  let eventSource: EventSource | null = null
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let storeUnsub: (() => void) | null = null
  let connected = false
  let destroyed = false
  let agentCommandDepth = 0

  function setConnected(value: boolean) {
    if (destroyed) return
    if (connected !== value) {
      connected = value
      onConnectionChange?.(value)
    }
  }

  async function putState(causedBy: CausedBy): Promise<void> {
    if (destroyed) return
    const body = snapshotState(store, causedBy)
    try {
      const response = await fetch(`${endpoint}/api/v1/ui/state`, {
        method: "PUT",
        headers: buildHeaders(authToken),
        body: JSON.stringify(body),
      })
      if (destroyed) return
      if (response.status === 401 || response.status === 403) {
        onAuthError?.(response.status)
      }
    } catch {
      // Network error — state push is best-effort
    }
  }

  function debouncedPutState(causedBy: CausedBy): void {
    if (debounceTimer !== null) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      putState(causedBy)
    }, DEBOUNCE_MS)
  }

  function handleSSEMessage(eventType: string, data: string): void {
    if (destroyed) return
    switch (eventType) {
      case "init": {
        setConnected(true)
        putState("restore")
        break
      }
      case "command": {
        let parsed: SSECommand
        try {
          parsed = JSON.parse(data)
        } catch {
          return
        }
        if (parsed.v !== 1) {
          onVersionMismatch?.(parsed.v)
          return
        }
        agentCommandDepth++
        dispatchCommand(bridge, parsed.kind, parsed.params).finally(() => {
          agentCommandDepth--
        })
        break
      }
      case "error": {
        let parsed: SSEError
        try {
          parsed = JSON.parse(data)
        } catch {
          return
        }
        if (parsed.v !== 1) {
          onVersionMismatch?.(parsed.v)
          return
        }
        bridge.showNotification(parsed.message, "error")
        break
      }
      case "heartbeat":
        break
    }
  }

  function connectSSE(): void {
    const url = `${endpoint}/api/v1/ui/commands/next`
    const es = new EventSource(url, { withCredentials: true })

    es.addEventListener("init", (e: MessageEvent) => {
      handleSSEMessage("init", e.data)
    })

    es.addEventListener("command", (e: MessageEvent) => {
      handleSSEMessage("command", e.data)
    })

    es.addEventListener("error", (e: Event) => {
      if ((e as MessageEvent).data) {
        handleSSEMessage("error", (e as MessageEvent).data)
      } else {
        setConnected(false)
      }
    })

    es.addEventListener("heartbeat", (e: MessageEvent) => {
      handleSSEMessage("heartbeat", e.data)
    })

    eventSource = es
  }

  async function poll(): Promise<void> {
    if (destroyed) return
    try {
      const url = `${endpoint}/api/v1/ui/commands/next?poll=true`
      const response = await fetch(url, { headers: buildHeaders(authToken) })
      if (destroyed) return
      if (response.status === 401 || response.status === 403) {
        onAuthError?.(response.status)
        return
      }
      if (!response.ok) return
      const commands: SSECommand[] = await response.json()
      if (!Array.isArray(commands)) return
      for (const cmd of commands) {
        if (destroyed) return
        if (cmd.v !== 1) {
          onVersionMismatch?.(cmd.v)
          continue
        }
        agentCommandDepth++
        try {
          await dispatchCommand(bridge, cmd.kind, cmd.params)
        } finally {
          agentCommandDepth--
        }
      }
      setConnected(true)
    } catch {
      setConnected(false)
    }
  }

  function subscribeToStore(): void {
    storeUnsub = store.subscribe(() => {
      if (destroyed) return
      const causedBy: CausedBy = agentCommandDepth > 0 ? "agent" : "user"
      debouncedPutState(causedBy)
    })
  }

  const client: BridgeClient = {
    connect() {
      destroyed = false
      const useSSE = !pollMode && typeof EventSource !== "undefined"
      if (useSSE) {
        connectSSE()
      } else {
        poll()
        pollTimer = setInterval(poll, pollInterval)
      }
      subscribeToStore()
    },

    disconnect() {
      if (eventSource) {
        eventSource.close()
        eventSource = null
      }
      if (pollTimer !== null) {
        clearInterval(pollTimer)
        pollTimer = null
      }
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer)
        debounceTimer = null
      }
      if (storeUnsub) {
        storeUnsub()
        storeUnsub = null
      }
      setConnected(false)
      destroyed = true
    },

    pushState(causedBy: CausedBy) {
      putState(causedBy)
    },
  }

  return client
}
