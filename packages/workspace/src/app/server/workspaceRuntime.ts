import path from "node:path"
import { createInMemoryBridge } from "../../server/bridge/createInMemoryBridge"
import type { UiBridge } from "../../shared/ui-bridge"

export class WorkspaceRuntimeError extends Error {
  statusCode: number

  constructor(message: string, statusCode: number) {
    super(message)
    this.name = "WorkspaceRuntimeError"
    this.statusCode = statusCode
  }
}

export function validateWorkspaceIdSegment(value: string): string {
  const workspaceId = value.trim()
  if (!workspaceId) throw new WorkspaceRuntimeError("workspace id is required", 400)
  if (
    workspaceId.includes("\0") ||
    workspaceId.includes("/") ||
    workspaceId.includes("\\") ||
    workspaceId.includes("..") ||
    path.isAbsolute(workspaceId)
  ) {
    throw new WorkspaceRuntimeError("invalid workspace id", 400)
  }
  return workspaceId
}

export interface ResolveWorkspaceIdFromRequestOptions {
  headerName?: string
  queryName?: string
}

function firstString(value: unknown): string | undefined {
  if (typeof value === "string") return value
  if (!Array.isArray(value)) return undefined
  return value.find((item): item is string => typeof item === "string")
}

export function resolveWorkspaceIdFromRequest(
  request: { headers?: Record<string, unknown>; query?: unknown },
  opts: ResolveWorkspaceIdFromRequestOptions = {},
): string {
  const headerName = opts.headerName ?? "x-boring-workspace-id"
  const normalizedHeaderName = headerName.toLowerCase()
  const queryName = opts.queryName ?? "workspaceId"
  const headers = request.headers ?? {}
  const headerValue = headers[normalizedHeaderName]
    ?? headers[headerName]
    ?? Object.entries(headers).find(([key]) => key.toLowerCase() === normalizedHeaderName)?.[1]
  const query = request.query as Record<string, unknown> | undefined
  const queryValue = query?.[queryName]
  const rawValue = firstString(headerValue) ?? firstString(queryValue) ?? ""
  return validateWorkspaceIdSegment(rawValue)
}

export interface WorkspaceBridgeRegistry {
  get(workspaceId: string): UiBridge
  delete(workspaceId: string): boolean
  clear(): void
}

export function createWorkspaceBridgeRegistry(): WorkspaceBridgeRegistry {
  const bridges = new Map<string, UiBridge>()
  return {
    get(workspaceId: string): UiBridge {
      const safeWorkspaceId = validateWorkspaceIdSegment(workspaceId)
      let bridge = bridges.get(safeWorkspaceId)
      if (!bridge) {
        bridge = createInMemoryBridge()
        bridges.set(safeWorkspaceId, bridge)
      }
      return bridge
    },
    delete(workspaceId: string): boolean {
      return bridges.delete(validateWorkspaceIdSegment(workspaceId))
    },
    clear(): void {
      bridges.clear()
    },
  }
}

export interface WorkspaceProvisioningCache {
  ensure(workspaceRoot: string): Promise<void>
  clear(workspaceRoot?: string): void
}

export function createWorkspaceProvisioningCache(
  provision: (workspaceRoot: string) => Promise<void>,
): WorkspaceProvisioningCache {
  const pendingByRoot = new Map<string, Promise<void>>()
  return {
    ensure(workspaceRoot: string): Promise<void> {
      const root = path.resolve(workspaceRoot)
      const existing = pendingByRoot.get(root)
      if (existing) return existing
      const pending = Promise.resolve()
        .then(() => provision(root))
        .catch((error) => {
          pendingByRoot.delete(root)
          throw error
        })
      pendingByRoot.set(root, pending)
      return pending
    },
    clear(workspaceRoot?: string): void {
      if (workspaceRoot) {
        pendingByRoot.delete(path.resolve(workspaceRoot))
        return
      }
      pendingByRoot.clear()
    },
  }
}
