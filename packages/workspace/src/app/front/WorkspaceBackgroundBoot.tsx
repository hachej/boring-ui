import { useEffect } from "react"
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
  workspaceRequestHeaders,
  type WorkspaceWarmupStatus,
} from "./workspacePreload"

const PREPARING_RETRY_DELAY_MS = 500

export interface WorkspaceBackgroundBootProps {
  workspaceId: string
  requestHeaders?: Record<string, string>
  apiBaseUrl?: string | null
  preloadPaths?: string[]
  provisionWorkspace?: boolean
  onStatusChange?: (status: WorkspaceWarmupStatus) => void
}

function sleepUntilRetry(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let timeout: ReturnType<typeof globalThis.setTimeout> | undefined
    const cleanup = () => {
      if (timeout) globalThis.clearTimeout(timeout)
      signal.removeEventListener("abort", onAbort)
    }
    const onAbort = () => {
      cleanup()
      reject(new DOMException("Warmup aborted", "AbortError"))
    }
    if (signal.aborted) {
      onAbort()
      return
    }
    timeout = globalThis.setTimeout(() => {
      cleanup()
      resolve()
    }, PREPARING_RETRY_DELAY_MS)
    signal.addEventListener("abort", onAbort, { once: true })
  })
}

async function fetchWarmupPath({
  apiBaseUrl,
  path,
  headers,
  signal,
  workspaceId,
}: {
  apiBaseUrl?: string | null
  path: string
  headers: Record<string, string>
  signal: AbortSignal
  workspaceId: string
}): Promise<{ status: "ready" } | { status: "preparing"; requirement?: "workspace-fs" | "sandbox-exec" | "ui-bridge" }> {
  const response = await fetch(preloadUrl(apiBaseUrl, path), { headers, signal })
  const payload = await readResponsePayload(response)
  if (!response.ok) {
    const preparing = parseRetryableWarmupPreparing(payload)
    if (preparing) return { status: "preparing", ...preparing }
    throw new Error(errorMessageFromPayload(payload) ?? `${path} failed with ${response.status}`)
  }

  if (isReadyStatusPath(path)) {
    const readyStatus = parseReadyStatusSse(payload)
    if (readyStatus?.state === "degraded") throw new Error(readyStatus.message ?? "Workspace failed to prepare")
  }

  if (payload && typeof payload === "object") {
    seedTreePreloadFromBody(apiBaseUrl, headers["x-boring-workspace-id"] ?? workspaceId, path, payload as { entries?: unknown })
  }
  return { status: "ready" }
}

export function WorkspaceBackgroundBoot({
  workspaceId,
  requestHeaders,
  apiBaseUrl,
  preloadPaths = DEFAULT_BOOT_PRELOAD_PATHS,
  provisionWorkspace = true,
  onStatusChange,
}: WorkspaceBackgroundBootProps) {
  useEffect(() => {
    let stale = false
    const controller = new AbortController()
    const headers = workspaceRequestHeaders(workspaceId, requestHeaders)

    async function warmup() {
      onStatusChange?.({ status: "preparing" })
      try {
        const paths = resolveBootPreloadPaths(preloadPaths, provisionWorkspace)
        const warmupPath = (path: string) => fetchWarmupPath({
          apiBaseUrl,
          path,
          headers,
          signal: controller.signal,
          workspaceId,
        })
        let results = await Promise.all(paths.map(async (path) => ({ path, result: await warmupPath(path) })))
        if (stale || controller.signal.aborted) return
        let preparingItems = results.filter((item) => item.result.status === "preparing")
        while (preparingItems.length > 0) {
          let requirement: "workspace-fs" | "sandbox-exec" | "ui-bridge" | undefined
          for (const item of preparingItems) {
            if (item.result.status === "preparing" && item.result.requirement) {
              requirement = item.result.requirement
              break
            }
          }
          onStatusChange?.({ status: "preparing", message: "Workspace is still preparing", ...(requirement ? { requirement } : {}) })
          await sleepUntilRetry(controller.signal)
          if (stale || controller.signal.aborted) return
          results = await Promise.all(preparingItems.map(async (item) => ({ path: item.path, result: await warmupPath(item.path) })))
          if (stale || controller.signal.aborted) return
          preparingItems = results.filter((item) => item.result.status === "preparing")
        }
        onStatusChange?.({ status: "ready" })
      } catch (error) {
        if (stale || controller.signal.aborted) return
        onStatusChange?.({
          status: "failed",
          message: error instanceof Error ? error.message : "Workspace failed to prepare",
        })
      }
    }

    void warmup()
    return () => {
      stale = true
      controller.abort()
    }
  }, [apiBaseUrl, onStatusChange, preloadPaths, provisionWorkspace, requestHeaders, workspaceId])

  return null
}
