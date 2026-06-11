import { useEffect } from "react"
import {
  DEFAULT_BOOT_PRELOAD_PATHS,
  errorMessageFromPayload,
  isReadyStatusPath,
  parseReadyStatusSse,
  parseRetryableWarmupPreparing,
  preloadUrl,
  readResponsePayload,
  readyStatusSupportsWorkspaceUse,
  resolveBootPreloadPaths,
  seedTreePreloadFromBody,
  workspaceRequestHeaders,
  type ReadyStatusWarmupSnapshot,
  type WorkspaceRuntimeDependenciesWarmupStatus,
  type WorkspaceWarmupStatus,
} from "./workspacePreload"

const PREPARING_RETRY_DELAY_MS = 500
// Per-attempt budget for a single warmup request. Right after a server
// (re)start the event loop can be saturated for tens of seconds by cold
// plugin transforms; an un-timed fetch issued in that window hangs
// indefinitely and pins the "Preparing workspace" overlay even though the
// server becomes ready moments later (recoverable only by remounting, e.g.
// switching workspaces). Treat a slow attempt as retryable-preparing so the
// normal retry loop re-issues a fresh request against the recovered server.
const WARMUP_ATTEMPT_TIMEOUT_MS = 10_000

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

async function readFirstReadyStatusSnapshot(response: Response): Promise<ReadyStatusWarmupSnapshot | null> {
  const body = response.body
  if (!body) return parseReadyStatusSse(await readResponsePayload(response))

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (value) {
        buffer += decoder.decode(value, { stream: !done })
        const first = parseReadyStatusSse(buffer)
        if (first) return first
      }
      if (done) {
        buffer += decoder.decode()
        return parseReadyStatusSse(buffer)
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}

type WarmupPathResult =
  | { status: "ready"; runtimeDependencies?: WorkspaceRuntimeDependenciesWarmupStatus }
  | { status: "preparing"; requirement?: "workspace-fs" | "sandbox-exec" | "ui-bridge"; runtimeDependencies?: WorkspaceRuntimeDependenciesWarmupStatus }

function runtimeDependenciesFromReadyStatus(status: ReadyStatusWarmupSnapshot | null): WorkspaceRuntimeDependenciesWarmupStatus | undefined {
  if (
    status?.runtimeDependenciesState !== "preparing" &&
    status?.runtimeDependenciesState !== "ready" &&
    status?.runtimeDependenciesState !== "failed"
  ) return undefined
  return {
    state: status.runtimeDependenciesState,
    ...(status.runtimeDependenciesMessage ? { message: status.runtimeDependenciesMessage } : {}),
    ...(status.runtimeDependenciesRequirement ? { requirement: status.runtimeDependenciesRequirement } : {}),
  }
}

async function fetchReadyStatusWarmupPath(response: Response): Promise<WarmupPathResult> {
  if (!response.ok) {
    const payload = await readResponsePayload(response)
    const preparing = parseRetryableWarmupPreparing(payload)
    if (preparing) return { status: "preparing" }
    throw new Error(errorMessageFromPayload(payload) ?? `/api/v1/ready-status failed with ${response.status}`)
  }

  const readyStatus = await readFirstReadyStatusSnapshot(response)
  const runtimeDependencies = runtimeDependenciesFromReadyStatus(readyStatus)
  const workspaceUsable = readyStatusSupportsWorkspaceUse(readyStatus)
  if (readyStatus?.state === "degraded" || readyStatus?.state === "failed") {
    if (workspaceUsable && runtimeDependencies?.state === "failed") {
      return { status: "ready", runtimeDependencies }
    }
    throw new Error(readyStatus.message ?? "Workspace failed to prepare")
  }
  return workspaceUsable
    ? { status: "ready", ...(runtimeDependencies ? { runtimeDependencies } : {}) }
    : { status: "preparing", ...(runtimeDependencies ? { runtimeDependencies } : {}) }
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
}): Promise<WarmupPathResult> {
  // Bound each attempt and treat timeouts/network-level failures (server
  // restarting, connection refused) as retryable-preparing rather than a
  // terminal failure: the caller's retry loop re-issues a fresh attempt.
  const attempt = new AbortController()
  const timeout = globalThis.setTimeout(() => attempt.abort(new DOMException("Warmup attempt timed out", "TimeoutError")), WARMUP_ATTEMPT_TIMEOUT_MS)
  const onOuterAbort = () => attempt.abort(signal.reason)
  if (signal.aborted) onOuterAbort()
  signal.addEventListener("abort", onOuterAbort, { once: true })
  try {
    const response = await fetch(preloadUrl(apiBaseUrl, path), { headers, signal: attempt.signal })
    if (isReadyStatusPath(path)) return await fetchReadyStatusWarmupPath(response)

    const payload = await readResponsePayload(response)
    if (!response.ok) {
      const preparing = parseRetryableWarmupPreparing(payload)
      if (preparing) return { status: "preparing", ...preparing }
      throw new Error(errorMessageFromPayload(payload) ?? `${path} failed with ${response.status}`)
    }

    if (payload && typeof payload === "object") {
      seedTreePreloadFromBody(apiBaseUrl, headers["x-boring-workspace-id"] ?? workspaceId, path, payload as { entries?: unknown })
    }
    return { status: "ready" }
  } catch (error) {
    if (signal.aborted) throw error
    // Attempt timeout or network-level failure (TypeError: Failed to fetch /
    // aborted body read): retryable, not fatal. HTTP-level errors with a
    // payload are thrown above and stay terminal.
    if (attempt.signal.aborted || (error instanceof TypeError)) return { status: "preparing" }
    throw error
  } finally {
    globalThis.clearTimeout(timeout)
    signal.removeEventListener("abort", onOuterAbort)
  }
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
        let runtimeDependencies = results.find((item) => item.result.runtimeDependencies)?.result.runtimeDependencies
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
          runtimeDependencies = results.find((item) => item.result.runtimeDependencies)?.result.runtimeDependencies ?? runtimeDependencies
          preparingItems = results.filter((item) => item.result.status === "preparing")
        }
        onStatusChange?.({ status: "ready", ...(runtimeDependencies ? { runtimeDependencies } : {}) })

        while (runtimeDependencies?.state === "preparing") {
          await sleepUntilRetry(controller.signal)
          if (stale || controller.signal.aborted) return
          const result = await warmupPath("/api/v1/ready-status")
          if (stale || controller.signal.aborted) return
          runtimeDependencies = result.runtimeDependencies
          if (runtimeDependencies) {
            onStatusChange?.({ status: "ready", runtimeDependencies })
          }
        }
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
