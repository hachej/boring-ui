import type { AppRunnerClient } from "./appRunnerClient"
import type { AppRunnerStore } from "./appRunnerStore"

const HOST_IDENTITY = { id: "boring-host", name: "Boring Host" }

export function createPublishedProfilePromptProvider(options: {
  client: AppRunnerClient
  store: AppRunnerStore
}): () => Promise<string | undefined> {
  let cachedVersion: number | undefined
  let cachedInstructions: string | undefined
  return async () => {
    const profile = (await options.store.listApps()).find((record) => record.kind === "profile")
    if (!profile) return undefined
    const current = await options.client.current(profile.workspaceId, profile.appName, HOST_IDENTITY)
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
