import { createHash } from "node:crypto"
import { existsSync, statSync } from "node:fs"
import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"

export interface LocalWorkspaceTaskProvider {
  type: "github"
  repo?: string
}

export interface LocalWorkspace {
  id: string
  name: string
  path: string
  createdAt: string
  updatedAt: string
  available: boolean
  /** @deprecated Use taskProviders. Kept for older registry files. */
  taskProvider?: LocalWorkspaceTaskProvider
  taskProviders?: LocalWorkspaceTaskProvider[]
}

interface StoredLocalWorkspace extends Omit<LocalWorkspace, "available"> {}

export interface LocalWorkspaceRegistry {
  path: string
  list(): Promise<LocalWorkspace[]>
  add(path: string, opts?: { name?: string; createIfMissing?: boolean }): Promise<LocalWorkspace>
  remove(id: string): Promise<void>
  rename(id: string, name: string): Promise<LocalWorkspace>
  get(id: string): Promise<LocalWorkspace | null>
}

const DEFAULT_REGISTRY_PATH = resolve(homedir(), ".boring-ui", "workspaces.yaml")

export function getDefaultLocalWorkspaceRegistryPath(): string {
  return process.env.BORING_UI_WORKSPACES_PATH
    ? resolve(process.env.BORING_UI_WORKSPACES_PATH)
    : DEFAULT_REGISTRY_PATH
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "workspace"
}

function workspaceIdForPath(path: string): string {
  const hash = createHash("sha1").update(path).digest("hex").slice(0, 8)
  return `${slugify(basename(path))}-${hash}`
}

function yamlString(value: string): string {
  if (/^[a-zA-Z0-9_./:@ -]+$/.test(value) && !value.startsWith(" ") && !value.endsWith(" ")) {
    return value
  }
  return JSON.stringify(value)
}

function unquoteYamlString(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ""
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return trimmed.slice(1, -1)
    }
  }
  return trimmed
}

function parseRegistryYaml(content: string): StoredLocalWorkspace[] {
  const result: StoredLocalWorkspace[] = []
  let current: Partial<StoredLocalWorkspace> | null = null

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#") || trimmed === "version: 1" || trimmed === "workspaces:") continue

    const itemMatch = line.match(/^\s*-\s+id:\s*(.*)$/)
    if (itemMatch) {
      if (current?.id && current.name && current.path && current.createdAt && current.updatedAt) {
        result.push(current as StoredLocalWorkspace)
      }
      current = { id: unquoteYamlString(itemMatch[1] ?? "") }
      continue
    }

    const fieldMatch = line.match(/^\s+(name|path|createdAt|updatedAt|taskProvider|taskProviders):\s*(.*)$/)
    if (fieldMatch && current) {
      const key = fieldMatch[1]
      const value = unquoteYamlString(fieldMatch[2] ?? "")
      if (key === "taskProvider") {
        current.taskProvider = parseTaskProvider(value)
      } else if (key === "taskProviders") {
        current.taskProviders = parseTaskProviders(value)
      } else {
        current[key as keyof Omit<StoredLocalWorkspace, "taskProvider" | "taskProviders">] = value
      }
    }
  }

  if (current?.id && current.name && current.path && current.createdAt && current.updatedAt) {
    result.push(current as StoredLocalWorkspace)
  }
  return result
}

function serializeRegistryYaml(workspaces: StoredLocalWorkspace[]): string {
  const lines = ["version: 1", "workspaces:"]
  for (const workspace of workspaces) {
    lines.push(
      `  - id: ${yamlString(workspace.id)}`,
      `    name: ${yamlString(workspace.name)}`,
      `    path: ${yamlString(workspace.path)}`,
      `    createdAt: ${yamlString(workspace.createdAt)}`,
      `    updatedAt: ${yamlString(workspace.updatedAt)}`,
    )
    if (workspace.taskProviders?.length) {
      lines.push(`    taskProviders: ${yamlString(workspace.taskProviders.map(serializeTaskProvider).join(", "))}`)
    } else if (workspace.taskProvider) {
      lines.push(`    taskProvider: ${yamlString(serializeTaskProvider(workspace.taskProvider))}`)
    }
  }
  return `${lines.join("\n")}\n`
}

function parseTaskProvider(value: string): LocalWorkspaceTaskProvider | undefined {
  const trimmed = value.trim()
  if (!trimmed || trimmed === "none") return undefined
  if (trimmed === "github" || trimmed === "github:auto") return { type: "github" }
  if (trimmed.startsWith("github:")) {
    const repo = trimmed.slice("github:".length).trim()
    if (/^[^/\s]+\/[^/\s]+$/.test(repo)) return { type: "github", repo }
  }
  return undefined
}

function parseTaskProviders(value: string): LocalWorkspaceTaskProvider[] | undefined {
  const providers = value
    .split(",")
    .map((entry) => parseTaskProvider(entry))
    .filter((entry): entry is LocalWorkspaceTaskProvider => Boolean(entry))
  return providers.length > 0 ? providers : undefined
}

function serializeTaskProvider(provider: LocalWorkspaceTaskProvider): string {
  return provider.repo ? `github:${provider.repo}` : "github:auto"
}

function expandHomePath(input: string): string {
  if (input === "~") return homedir()
  if (input.startsWith("~/") || input.startsWith("~\\")) return join(homedir(), input.slice(2))
  return input
}

async function resolveWorkspacePath(input: string): Promise<string> {
  const absolute = resolve(expandHomePath(input))
  try {
    return await realpath(absolute)
  } catch {
    return absolute
  }
}

function pathIsDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function pathExists(path: string): boolean {
  return existsSync(path)
}

function withAvailability(workspace: StoredLocalWorkspace): LocalWorkspace {
  return { ...workspace, available: pathIsDirectory(workspace.path) }
}

export function createLocalWorkspaceRegistry(path = getDefaultLocalWorkspaceRegistryPath()): LocalWorkspaceRegistry {
  async function readStored(): Promise<StoredLocalWorkspace[]> {
    try {
      return parseRegistryYaml(await readFile(path, "utf-8"))
    } catch (error) {
      if ((error as { code?: unknown })?.code === "ENOENT") return []
      throw error
    }
  }

  async function writeStored(workspaces: StoredLocalWorkspace[]): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
    await writeFile(tmp, serializeRegistryYaml(workspaces), "utf-8")
    await rename(tmp, path)
  }

  return {
    path,
    async list() {
      return (await readStored()).map(withAvailability)
    },
    async get(id: string) {
      const workspace = (await readStored()).find((entry) => entry.id === id)
      return workspace ? withAvailability(workspace) : null
    },
    async add(inputPath: string, opts?: { name?: string; createIfMissing?: boolean }) {
      const workspacePath = await resolveWorkspacePath(inputPath)
      if (pathExists(workspacePath) && !pathIsDirectory(workspacePath)) {
        throw new Error(`workspace path is not a directory: ${workspacePath}`)
      }
      if (!pathExists(workspacePath) && opts?.createIfMissing) {
        await mkdir(workspacePath, { recursive: true })
      }
      const now = new Date().toISOString()
      const workspaces = await readStored()
      const id = workspaceIdForPath(workspacePath)
      const existing = workspaces.find((entry) => entry.id === id)
      if (existing) return withAvailability(existing)
      const workspace: StoredLocalWorkspace = {
        id,
        name: opts?.name?.trim() || basename(workspacePath) || id,
        path: workspacePath,
        createdAt: now,
        updatedAt: now,
      }
      workspaces.push(workspace)
      await writeStored(workspaces)
      return withAvailability(workspace)
    },
    async remove(id: string) {
      await writeStored((await readStored()).filter((entry) => entry.id !== id))
    },
    async rename(id: string, name: string) {
      const nextName = name.trim()
      if (!nextName) throw new Error("workspace name is required")
      const workspaces = await readStored()
      const workspace = workspaces.find((entry) => entry.id === id)
      if (!workspace) throw new Error(`workspace not found: ${id}`)
      workspace.name = nextName
      workspace.updatedAt = new Date().toISOString()
      await writeStored(workspaces)
      return withAvailability(workspace)
    },
  }
}
