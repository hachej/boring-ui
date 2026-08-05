import { createBeadsTaskSource } from "./beadsSource"
import type { BeadsOperations } from "./beadsOperations"
import { createGhCliGitHubIssueExecutor, createGitHubTaskSource, createWorkspaceGitHubTaskSource } from "./githubSource"
import { createTaskSourceRegistry, type BoringTaskSourceRegistry, type BoringTaskSourceRuntime } from "./sourceRuntime"
import { TaskSourceServiceError } from "./taskSourceService"

interface TaskProviderConfig {
  provider: "github" | "beads"
  repo?: string
}

function invalidConfig(message: string): never {
  throw new TaskSourceServiceError(400, "TASK_INVALID_BODY", message)
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
  const allowedSet = new Set(allowed)
  const unsupported = Object.keys(value).find((key) => !allowedSet.has(key))
  if (unsupported) invalidConfig(`${field} contains unsupported key: ${unsupported}`)
}

function taskProvidersFromConfig(config: unknown): TaskProviderConfig[] {
  if (config === undefined || config === null) return []
  if (typeof config !== "object" || Array.isArray(config)) invalidConfig("Tasks config must be an object")
  const root = config as Record<string, unknown>
  exactKeys(root, ["providers"], "Tasks config")
  if (root.providers === undefined) return []
  if (!Array.isArray(root.providers)) invalidConfig("Tasks providers must be an array")
  let beadsSeen = false
  return root.providers.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) invalidConfig(`Tasks provider ${index} must be an object`)
    const provider = entry as Record<string, unknown>
    if (provider.provider === "beads") {
      exactKeys(provider, ["provider"], `Tasks provider ${index}`)
      if (beadsSeen) invalidConfig("Tasks config permits only one Beads provider")
      beadsSeen = true
      return { provider: "beads" }
    }
    if (provider.provider === "github") {
      exactKeys(provider, ["provider", "repo"], `Tasks provider ${index}`)
      if (provider.repo !== undefined && typeof provider.repo !== "string") invalidConfig(`Tasks provider ${index}.repo must be a string`)
      const repo = typeof provider.repo === "string" ? provider.repo.trim() : "auto"
      if (!repo) invalidConfig(`Tasks provider ${index}.repo must not be empty`)
      if (repo !== "auto" && !/^[^/\s]+\/[^/\s]+$/.test(repo)) invalidConfig(`Tasks provider ${index}.repo must be owner/name or auto`)
      return { provider: "github", repo }
    }
    invalidConfig(`Tasks provider ${index}.provider is unsupported`)
  })
}

export function createTaskSourceRegistryFromConfig(
  config: unknown,
  options: { workspaceRoot?: string; beadsOperations?: BeadsOperations } = {},
): BoringTaskSourceRegistry {
  let githubIndex = 0
  const sources = taskProvidersFromConfig(config).map((provider): BoringTaskSourceRuntime => {
    if (provider.provider === "beads") return createBeadsTaskSource({ operations: options.beadsOperations })
    githubIndex += 1
    const repo = provider.repo ?? "auto"
    if (repo !== "auto") {
      const [owner, name] = repo.split("/") as [string, string]
      return createGitHubTaskSource({
        owner,
        repo: name,
        executor: createGhCliGitHubIssueExecutor({ workspaceRoot: options.workspaceRoot }),
      })
    }
    return createWorkspaceGitHubTaskSource({
      workspaceRoot: options.workspaceRoot,
      sourceId: githubIndex === 1 ? "github:workspace" : `github:workspace:${githubIndex}`,
    })
  })
  return createTaskSourceRegistry(sources)
}
