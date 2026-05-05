import { useEffect, useState, type ReactNode } from "react"
import { WorkspaceLoadingState } from "../../front/components/WorkspaceLoadingState"
import { setPreloadedTreeEntries } from "../../plugins/filesystemPlugin/front/data/treePreloadCache"

const DEFAULT_BOOT_PRELOAD_PATHS = ["/api/v1/tree?path=.", "/api/v1/agent/sessions"]

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

function preloadUrl(apiBaseUrl: string | null | undefined, path: string): string {
  if (/^https?:\/\//i.test(path)) return path
  if (!apiBaseUrl) return path
  return `${apiBaseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`
}

function treePreloadDir(path: string): string | null {
  const url = new URL(path, "http://workspace.local")
  if (url.pathname !== "/api/v1/tree") return null
  return url.searchParams.get("path") ?? "."
}

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
    const headers = requestHeaders ?? { "x-boring-workspace-id": workspaceId }

    async function fetchOk(path: string): Promise<void> {
      const response = await fetch(preloadUrl(apiBaseUrl, path), {
        headers,
        signal: controller.signal,
      })
      if (!response.ok) {
        const text = await response.text().catch(() => "")
        throw new Error(text || `${path} failed with ${response.status}`)
      }

      const dir = treePreloadDir(path)
      if (dir === null) return
      const body = await response.clone().json().catch(() => null) as { entries?: unknown } | null
      if (!body || !Array.isArray(body.entries)) return
      setPreloadedTreeEntries(apiBaseUrl, headers["x-boring-workspace-id"] ?? workspaceId, dir, body.entries)
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
