import type { AgentTool, ToolExecContext, ToolResult } from "@hachej/boring-workspace/shared"
import type { AppRunnerCurrent, AppRunnerRecord } from "../shared/types"
import type { AppRunnerClient } from "./appRunnerClient"
import { AppRunnerHttpError } from "./appRunnerClient"
import type { AppRunnerStore } from "./appRunnerStore"
import { identityFromToolContext } from "./resolveIdentity"

function result(value: unknown, isError = false): ToolResult {
  const text = typeof value === "string" ? value : JSON.stringify(value)
  return { content: [{ type: "text", text }], details: value, ...(isError ? { isError: true } : {}) }
}

function toolSegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "")
}

export interface PublishedToolsProviderOptions {
  client: AppRunnerClient
  store: AppRunnerStore
}

type DynamicContext = Pick<ToolExecContext, "abortSignal" | "sessionId" | "userId" | "userEmail" | "userEmailVerified" | "workspaceId" | "requestId">

export function createPublishedToolsProvider(options: PublishedToolsProviderOptions): (context?: DynamicContext) => Promise<readonly AgentTool[]> {
  const cache = new Map<string, readonly AgentTool[]>()

  return async (context) => {
    const workspaceId = context?.workspaceId?.trim()
    if (!workspaceId) throw new Error("authenticated workspace identity is required to load published tools")
    const identity = identityFromToolContext(context ?? {})
    const records = (await options.store.listApps()).filter((record) => record.workspaceId === workspaceId)
    const groups = await Promise.all(records.map(async (record) => {
      let current: AppRunnerCurrent
      try {
        current = await options.client.current(workspaceId, record.appName, identity)
      } catch {
        return []
      }
      if (current.version !== record.version || current.sha !== record.sha || current.kind !== record.kind) {
        await options.store.upsertApp(recordFromCurrent(record, current))
      }
      const cacheKey = `${record.appName}:${current.version}`
      const cached = cache.get(cacheKey)
      if (cached) return cached
      const tools = current.manifest.tools.map((entry): AgentTool => ({
        name: `${current.kind === "profile" ? "profile" : `app_${toolSegment(record.appName)}`}_${toolSegment(entry.name)}`,
        description: entry.description || `Call ${entry.name} in published ${current.kind} ${record.appName}.`,
        parameters: entry.input ?? { type: "object", properties: {}, additionalProperties: false },
        async execute(params: Record<string, unknown>, ctx: ToolExecContext): Promise<ToolResult> {
          try {
            const executingWorkspaceId = ctx.workspaceId?.trim()
            if (!executingWorkspaceId || executingWorkspaceId !== workspaceId) {
              return result(`Published tool ${entry.name} refused: executing workspace does not match its published workspace.`, true)
            }
            const value = await options.client.callTool(
              executingWorkspaceId,
              record.appName,
              entry.name,
              params,
              identityFromToolContext(ctx),
            )
            return result(value)
          } catch (error) {
            const message = error instanceof AppRunnerHttpError
              ? `app runner responded ${error.status}: ${error.message}`
              : error instanceof Error ? error.message : String(error)
            return result(`Published tool ${entry.name} failed: ${message}`, true)
          }
        },
      }))
      cache.set(cacheKey, tools)
      return tools
    }))
    return groups.flat()
  }
}

function recordFromCurrent(record: AppRunnerRecord, current: AppRunnerCurrent): AppRunnerRecord {
  return {
    ...record,
    kind: current.kind,
    version: current.version,
    sha: current.sha,
    updatedAt: new Date().toISOString(),
    toolManifest: current.manifest,
  }
}
