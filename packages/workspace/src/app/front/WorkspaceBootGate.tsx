import { useEffect, useState, type ReactNode } from "react"
import { WorkspaceLoadingState } from "../../front/components/WorkspaceLoadingState"
import {
  DEFAULT_BOOT_PRELOAD_PATHS,
  errorMessageFromPayload,
  isReadyStatusPath,
  parseReadyStatusSse,
  parseRetryableWarmupPreparing,
  preloadUrl,
  readResponsePayload,
  resolveBootPreloadPaths,
  seedTreePreloadFromBody,
  treePreloadDir,
  workspaceRequestHeaders,
} from "./workspacePreload"

export interface WorkspaceBootGateProps {
  workspaceId: string
  requestHeaders?: Record<string, string>
  apiBaseUrl?: string | null
  preloadPaths?: string[]
  provisionWorkspace?: boolean
  loadingFallback?: ReactNode | ((status: string) => ReactNode)
  errorFallback?: ReactNode | ((message: string) => ReactNode)
  children: ReactNode
}

type WorkspaceBootState =
  | { status: "loading"; label: string }
  | { status: "ready" }
  | { status: "error"; message: string }

export function WorkspaceBootGate({
  workspaceId,
  requestHeaders,
  apiBaseUrl,
  preloadPaths = DEFAULT_BOOT_PRELOAD_PATHS,
  provisionWorkspace = true,
  loadingFallback,
  errorFallback,
  children,
}: WorkspaceBootGateProps) {
  const [state, setState] = useState<WorkspaceBootState>({
    status: "loading",
    label: "Waking workspace runtime",
  })

  useEffect(() => {
    const controller = new AbortController()
    const headers = workspaceRequestHeaders(workspaceId, requestHeaders)

    async function fetchOk(path: string): Promise<"ready" | "preparing"> {
      const response = await fetch(preloadUrl(apiBaseUrl, path), {
        headers,
        signal: controller.signal,
      })
      const payload = await readResponsePayload(response)
      if (!response.ok) {
        if (parseRetryableWarmupPreparing(payload)) return "preparing"
        throw new Error(errorMessageFromPayload(payload) ?? `${path} failed with ${response.status}`)
      }

      if (isReadyStatusPath(path)) {
        const readyStatus = parseReadyStatusSse(payload)
        if (readyStatus?.state === "degraded") throw new Error(readyStatus.message ?? "Workspace failed to prepare")
      }

      const dir = treePreloadDir(path)
      if (dir !== null && payload && typeof payload === "object") {
        seedTreePreloadFromBody(apiBaseUrl, headers["x-boring-workspace-id"] ?? workspaceId, path, payload as { entries?: unknown })
      }
      return "ready"
    }

    async function boot() {
      setState({ status: "loading", label: "Waking workspace runtime" })
      try {
        const paths = resolveBootPreloadPaths(preloadPaths, provisionWorkspace)
        let results = await Promise.all(paths.map(async (path) => ({ path, status: await fetchOk(path) })))
        let preparingPaths = results.filter((result) => result.status === "preparing").map((result) => result.path)
        if (preparingPaths.length > 0 && paths.some(isReadyStatusPath)) {
          results = await Promise.all(preparingPaths.map(async (path) => ({ path, status: await fetchOk(path) })))
          preparingPaths = results.filter((result) => result.status === "preparing").map((result) => result.path)
        }
        if (preparingPaths.length > 0) {
          setState({ status: "loading", label: "Workspace is still preparing" })
          return
        }
        if (!controller.signal.aborted) setState({ status: "ready" })
      } catch (error) {
        if (controller.signal.aborted) return
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "Unknown workspace boot error",
        })
      }
    }

    void boot()
    return () => controller.abort()
  }, [apiBaseUrl, preloadPaths, provisionWorkspace, requestHeaders, workspaceId])

  if (state.status === "ready") return <>{children}</>

  if (state.status === "error") {
    if (typeof errorFallback === "function") return <>{errorFallback(state.message)}</>
    if (errorFallback) return <>{errorFallback}</>
    return (
      <WorkspaceLoadingState
        title="Workspace failed to open"
        description={state.message}
        status="Retry by reloading the page"
      />
    )
  }

  if (typeof loadingFallback === "function") return <>{loadingFallback(state.label)}</>
  if (loadingFallback) return <>{loadingFallback}</>
  return (
    <WorkspaceLoadingState
      title="Opening workspace"
      description="Waking the sandbox and preparing files, sessions, and layout."
      status={state.label}
    />
  )
}
