import type { WorkspaceBridge, CausedBy } from "./types"
import type { WorkspaceStore, PanelState } from "../store/types"
import type { FilesystemId, UiFileOpenMode } from "../../shared/types/filesystem"
import { UI_STATE_INVALIDATION_COMMAND } from "../../shared/ui-bridge"
import { dispatchUiStateInvalidation } from "./uiStateInvalidation"
import { startUiCommandTransport } from "./uiCommandStream"

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
  | typeof UI_STATE_INVALIDATION_COMMAND

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
              mode: params.mode as UiFileOpenMode | undefined,
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
    case "expandToFile": {
      const filesystem = params.filesystem as FilesystemId | undefined
      if (filesystem) await bridge.expandToFile(params.path as string, { filesystem })
      else await bridge.expandToFile(params.path as string)
      break
    }
    case "markDirty":
      bridge.markDirty(params.path as string)
      break
    case "markClean":
      bridge.markClean(params.path as string)
      break
    case UI_STATE_INVALIDATION_COMMAND:
      dispatchUiStateInvalidation(params)
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

  let stopCommandTransport: (() => void) | null = null
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let storeUnsub: (() => void) | null = null
  let destroyed = false
  let agentCommandDepth = 0

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

  async function handleCommand(raw: unknown): Promise<void> {
    if (destroyed) return
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return
    const parsed = raw as SSECommand
    if (parsed.v !== 1) {
      onVersionMismatch?.(parsed.v)
      return
    }
    if (!parsed.params || typeof parsed.params !== "object" || Array.isArray(parsed.params)) return
    agentCommandDepth++
    try {
      await dispatchCommand(bridge, parsed.kind, parsed.params)
    } finally {
      agentCommandDepth--
    }
  }

  function handleServerError(raw: unknown): void {
    if (destroyed || !raw || typeof raw !== "object" || Array.isArray(raw)) return
    const parsed = raw as SSEError
    if (parsed.v !== 1) {
      onVersionMismatch?.(parsed.v)
      return
    }
    bridge.showNotification(parsed.message, "error")
  }

  function connectCommandTransport(): () => void {
    return startUiCommandTransport({
      endpoint,
      eventSourceCtor: pollMode ? null : undefined,
      eventSourceInit: { withCredentials: true },
      fetcher: (input, init) => fetch(input, {
        ...init,
        headers: buildHeaders(authToken),
      }),
      pollIntervalMs: pollInterval,
      onCommand: handleCommand,
      onInit: () => { void putState("restore") },
      onServerError: handleServerError,
      onPollResponse: (response) => {
        if (response.status === 401 || response.status === 403) {
          onAuthError?.(response.status)
        }
      },
      onConnectionChange,
    })
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
      stopCommandTransport = connectCommandTransport()
      subscribeToStore()
    },

    disconnect() {
      if (stopCommandTransport) {
        stopCommandTransport()
        stopCommandTransport = null
      }
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer)
        debounceTimer = null
      }
      if (storeUnsub) {
        storeUnsub()
        storeUnsub = null
      }
      destroyed = true
    },

    pushState(causedBy: CausedBy) {
      putState(causedBy)
    },
  }

  return client
}
