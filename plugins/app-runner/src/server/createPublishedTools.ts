import type { AgentTool, ToolExecContext, ToolResult } from "@hachej/boring-workspace/shared"
import type { AppRunnerCurrent, AppRunnerRecord } from "../shared/types"
import type { AppRunnerClient } from "./appRunnerClient"
import { AppRunnerHttpError } from "./appRunnerClient"
import type { AppRunnerStore } from "./appRunnerStore"
import { profileAppName, isProfileAppName } from "./profileAddress"
import { identityFromToolContext } from "./resolveIdentity"

function result(value: unknown, isError = false): ToolResult {
  const text = typeof value === "string" ? value : JSON.stringify(value)
  return { content: [{ type: "text", text }], details: value, ...(isError ? { isError: true } : {}) }
}

function toolSegment(value: string): string {
  return Buffer.from(value.normalize("NFC"), "utf8").toString("hex")
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
    const permittedProfile = profileAppName(identity.id)
    const records = (await options.store.listApps()).filter((record) =>
      record.workspaceId === workspaceId
      && (record.appName === permittedProfile || (!isProfileAppName(record.appName) && record.kind !== "profile")),
    )
    const groups = await Promise.all(records.map(async (record) => {
      const isProfile = record.appName === permittedProfile
      let current: AppRunnerCurrent
      try {
        current = await options.client.current(workspaceId, record.appName, identity, context?.abortSignal)
      } catch {
        return []
      }
      if ((isProfile && current.kind !== "profile") || (!isProfile && current.kind !== "app")) return []
      if (current.version !== record.version || current.sha !== record.sha || current.kind !== record.kind) {
        await options.store.upsertApp(recordFromCurrent(record, current))
      }
      const cacheKey = `${workspaceId}:${isProfile ? identity.id : "shared"}:${record.appName}:${current.version}:${current.sha ?? ""}`
      const cached = cache.get(cacheKey)
      if (cached) return cached
      const tools = current.manifest.tools.map((entry): AgentTool => ({
        name: `${isProfile ? "profile" : `app_${toolSegment(record.appName)}`}_${toolSegment(entry.name)}`,
        description: entry.description || `Call ${entry.name} in published ${current.kind} ${record.appName}.`,
        parameters: entry.input ?? { type: "object", properties: {}, additionalProperties: false },
        async execute(params: Record<string, unknown>, ctx: ToolExecContext): Promise<ToolResult> {
          try {
            const executingWorkspaceId = ctx.workspaceId?.trim()
            if (!executingWorkspaceId || executingWorkspaceId !== workspaceId) {
              return result(`Published tool ${entry.name} refused: executing workspace does not match its published workspace.`, true)
            }
            const executingIdentity = identityFromToolContext(ctx)
            if (isProfile && record.appName !== profileAppName(executingIdentity.id)) {
              return result(`Published tool ${entry.name} refused: profile address does not match the acting user.`, true)
            }
            const value = await options.client.callTool(
              executingWorkspaceId,
              record.appName,
              entry.name,
              params,
              executingIdentity,
              current.version,
              ctx.abortSignal,
            )
            return result(value)
          } catch (error) {
            if (error instanceof AppRunnerHttpError && error.status === 409) {
              const latest = await options.client.current(workspaceId, record.appName, identityFromToolContext(ctx), ctx.abortSignal)
              await options.store.upsertApp(recordFromCurrent(record, latest))
              return result(
                `Published tool ${entry.name} is stale because ${record.appName} changed from version ${current.version} to ${latest.version}. Retry after the tool inventory refreshes.`,
                true,
              )
            }
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
    const tools = groups.flat()
    const owners = new Map<string, string>()
    for (const tool of tools) {
      const owner = `${tool.name}`
      if (owners.has(tool.name)) {
        throw new Error(`published tool name collision for "${tool.name}"; manifests must expose unique tool names`)
      }
      owners.set(tool.name, owner)
    }
    return tools
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
