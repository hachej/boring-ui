import { createHash } from "node:crypto"
import { existsSync, statSync } from "node:fs"
import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { parse as parseYaml, stringify as stringifyYaml } from "yaml"

export type LocalWorkspacePluginConfig = Record<string, unknown>

export interface LocalWorkspace {
  id: string
  name: string
  path: string
  createdAt: string
  updatedAt: string
  available: boolean
  plugins?: Record<string, LocalWorkspacePluginConfig>
}

interface StoredLocalWorkspace extends Omit<LocalWorkspace, "available"> {}

export interface LocalWorkspaceRegistry {
  path: string
  list(): Promise<LocalWorkspace[]>
  add(path: string, opts?: { name?: string; createIfMissing?: boolean }): Promise<LocalWorkspace>
  remove(id: string): Promise<void>
  rename(id: string, name: string): Promise<LocalWorkspace>
  setPluginConfig(id: string, pluginId: string, config: LocalWorkspacePluginConfig | null): Promise<LocalWorkspace>
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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function cloneJsonLike(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value
  if (Array.isArray(value)) return value.map(cloneJsonLike)
  if (isPlainRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneJsonLike(entry)]))
  }
  return undefined
}

type LegacyTaskProviderConfig = { provider: string; repo: string }

function parseLegacyTaskProvider(value: unknown): LegacyTaskProviderConfig | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  if (!trimmed || trimmed === "none") return undefined
  if (trimmed === "github" || trimmed === "github:auto") return { provider: "github", repo: "auto" }
  if (trimmed.startsWith("github:")) {
    const repo = trimmed.slice("github:".length).trim()
    if (/^[^/\s]+\/[^/\s]+$/.test(repo)) return { provider: "github", repo }
  }
  return undefined
}

function legacyTaskProviders(record: Record<string, unknown>): LegacyTaskProviderConfig[] | undefined {
  if (typeof record.taskProviders === "string") {
    const providers = record.taskProviders
      .split(",")
      .map((entry) => parseLegacyTaskProvider(entry))
      .filter((entry): entry is LegacyTaskProviderConfig => Boolean(entry))
    if (providers.length > 0) return providers
  }
  if (Array.isArray(record.taskProviders)) {
    const providers = record.taskProviders
      .map((entry): LegacyTaskProviderConfig | undefined => isPlainRecord(entry) && entry.provider === "github"
        ? { provider: "github", repo: typeof entry.repo === "string" ? entry.repo : "auto" }
        : undefined)
      .filter((entry): entry is LegacyTaskProviderConfig => Boolean(entry))
    if (providers.length > 0) return providers
  }
  const single = parseLegacyTaskProvider(record.taskProvider)
  return single ? [single] : undefined
}

function parsePlugins(value: unknown): Record<string, LocalWorkspacePluginConfig> | undefined {
  if (!isPlainRecord(value)) return undefined
  const entries = Object.entries(value)
    .map(([pluginId, config]) => [pluginId, cloneJsonLike(config)] as const)
    .filter((entry): entry is readonly [string, LocalWorkspacePluginConfig] => /^[a-zA-Z0-9_-]+$/.test(entry[0]) && isPlainRecord(entry[1]))
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function parseRegistryYaml(content: string): StoredLocalWorkspace[] {
  const parsed = parseYaml(content) as unknown
  if (!isPlainRecord(parsed) || !Array.isArray(parsed.workspaces)) return []
  return parsed.workspaces.flatMap((entry): StoredLocalWorkspace[] => {
    if (!isPlainRecord(entry)) return []
    const id = typeof entry.id === "string" ? entry.id : ""
    const name = typeof entry.name === "string" ? entry.name : ""
    const path = typeof entry.path === "string" ? entry.path : ""
    const createdAt = typeof entry.createdAt === "string" ? entry.createdAt : ""
    const updatedAt = typeof entry.updatedAt === "string" ? entry.updatedAt : ""
    if (!id || !name || !path || !createdAt || !updatedAt) return []
    const plugins = parsePlugins(entry.plugins)
    const legacyProviders = legacyTaskProviders(entry)
    return [{
      id,
      name,
      path,
      createdAt,
      updatedAt,
      ...(plugins || legacyProviders ? { plugins: { ...(plugins ?? {}), ...(legacyProviders ? { tasks: { providers: legacyProviders } } : {}) } } : {}),
    }]
  })
}

function serializeRegistryYaml(workspaces: StoredLocalWorkspace[]): string {
  return stringifyYaml({
    version: 1,
    workspaces: workspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      path: workspace.path,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
      ...(workspace.plugins && Object.keys(workspace.plugins).length > 0 ? { plugins: workspace.plugins } : {}),
    })),
  })
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
    async setPluginConfig(id: string, pluginId: string, config: LocalWorkspacePluginConfig | null) {
      const workspaces = await readStored()
      const workspace = workspaces.find((entry) => entry.id === id)
      if (!workspace) throw new Error(`workspace not found: ${id}`)
      workspace.plugins ??= {}
      if (config === null) delete workspace.plugins[pluginId]
      else workspace.plugins[pluginId] = config
      if (Object.keys(workspace.plugins).length === 0) delete workspace.plugins
      workspace.updatedAt = new Date().toISOString()
      await writeStored(workspaces)
      return withAvailability(workspace)
    },
  }
}
