import type { ToolExecContext } from "@hachej/boring-workspace/shared"
import type { AppRunnerClient } from "./appRunnerClient"
import type { AppRunnerStore } from "./appRunnerStore"
import { identityFromToolContext } from "./resolveIdentity"

export function createPublishedProfilePromptProvider(options: {
  client: AppRunnerClient
  store: AppRunnerStore
}): (context?: Pick<ToolExecContext, "abortSignal" | "sessionId" | "userId" | "userEmail" | "userEmailVerified" | "workspaceId" | "requestId">) => Promise<string | undefined> {
  let cachedVersion: number | undefined
  let cachedInstructions: string | undefined
  return async (context) => {
    const workspaceId = context?.workspaceId?.trim()
    if (!workspaceId) throw new Error("authenticated workspace identity is required to load profile instructions")
    const profile = (await options.store.listApps()).find((record) => record.kind === "profile" && record.workspaceId === workspaceId)
    if (!profile) return undefined
    const current = await options.client.current(workspaceId, profile.appName, identityFromToolContext(context ?? {}))
    if (current.version !== cachedVersion) {
      cachedVersion = current.version
      cachedInstructions = current.instructions?.trim() || undefined
      if (current.version !== profile.version || current.sha !== profile.sha) {
        await options.store.upsertApp({
          ...profile,
          version: current.version,
          sha: current.sha,
          updatedAt: new Date().toISOString(),
          toolManifest: current.manifest,
        })
      }
    }
    return cachedInstructions
  }
}
