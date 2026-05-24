import { useEffect, useState, type ReactNode } from "react"
import { WorkspaceLoadingState } from "../../front/components/WorkspaceLoadingState"
import {
  DEFAULT_BOOT_PRELOAD_PATHS,
  errorMessageFromPayload,
  preloadUrl,
  readResponsePayload,
  seedTreePreloadFromBody,
  treePreloadDir,
  workspaceRequestHeaders,
} from "./workspacePreload"

export interface WorkspaceBootGateProps {
  workspaceId: string
  requestHeaders?: Record<string, string>
  apiBaseUrl?: string | null
  preloadPaths?: string[]
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

    async function fetchOk(path: string): Promise<void> {
      const response = await fetch(preloadUrl(apiBaseUrl, path), {
        headers,
        signal: controller.signal,
      })
      if (!response.ok) {
        const payload = await readResponsePayload(response)
        throw new Error(errorMessageFromPayload(payload) ?? `${path} failed with ${response.status}`)
      }

      const dir = treePreloadDir(path)
      if (dir === null) return
      const body = await response.clone().json().catch(() => null) as { entries?: unknown } | null
      seedTreePreloadFromBody(apiBaseUrl, headers["x-boring-workspace-id"] ?? workspaceId, path, body)
    }

    async function boot() {
      setState({ status: "loading", label: "Waking workspace runtime" })
      try {
        await Promise.all(preloadPaths.map(fetchOk))
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
  }, [apiBaseUrl, preloadPaths, requestHeaders, workspaceId])

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
