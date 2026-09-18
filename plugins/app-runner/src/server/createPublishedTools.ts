import type { RemoteCapabilityDescriptor, ToolExecContext } from "@hachej/boring-workspace/shared"
import type { AppRunnerCurrent, AppRunnerRecord } from "../shared/types"
import type { AppRunnerClient } from "./appRunnerClient"
import type { AppRunnerStore } from "./appRunnerStore"
import { profileAppName, isProfileAppName } from "./profileAddress"
import { identityFromToolContext } from "./resolveIdentity"

export interface PublishedToolsProviderOptions {
  client: AppRunnerClient
  store: AppRunnerStore
}

type DynamicContext = Pick<ToolExecContext, "abortSignal" | "sessionId" | "userId" | "userEmail" | "userEmailVerified" | "workspaceId" | "requestId">

/**
 * Discovers serializable capability descriptors only. The agent runtime
 * independently re-fetches the hub manifest and constructs every executor.
 */
export function createPublishedToolsProvider(options: PublishedToolsProviderOptions): (context?: DynamicContext) => Promise<readonly RemoteCapabilityDescriptor[]> {
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
      if ((isProfile && current.kind !== "profile") || (!isProfile && current.kind !== "app") || !current.sha) return []
      if (current.version !== record.version || current.sha !== record.sha || current.kind !== record.kind) {
        await options.store.upsertApp(recordFromCurrent(record, current))
      }
      return current.manifest.tools.map((entry): RemoteCapabilityDescriptor => ({
        kind: current.kind,
        workspaceId,
        address: `${workspaceId}/${record.appName}`,
        version: current.version,
        sha: current.sha!,
        toolName: entry.name,
        description: entry.description || `Call ${entry.name} in published ${current.kind} ${record.appName}.`,
        inputSchema: entry.input ?? { type: "object", properties: {}, additionalProperties: false },
      }))
    }))
    const descriptors = groups.flat()
    const names = new Set<string>()
    for (const descriptor of descriptors) {
      const key = `${descriptor.address}:${descriptor.toolName}`
      if (names.has(key)) throw new Error(`published tool name collision for "${descriptor.toolName}"; manifests must expose unique tool names`)
      names.add(key)
    }
    return descriptors
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
