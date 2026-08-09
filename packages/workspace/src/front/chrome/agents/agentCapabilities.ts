import type { UiFileResource } from "../../../shared/types/filesystem"

/**
 * Transport decoding for the Agent details panel: every addressed-Agent
 * payload this page reads, turned into the shapes the view renders.
 *
 * Deliberately separate from the view. These are pure functions over `unknown`,
 * so their edge cases (missing fields, wrong types, hostile values) get direct
 * unit tests instead of a render plus six mocked fetches.
 */

export interface AgentSkillSummary {
  name: string
  description?: string
  source?: string
  invocable?: boolean
  resource?: UiFileResource
}

export interface AgentToolSummary {
  name: string
  description?: string
}

/** An authored file behind the agent's instructions, as the Host reports it. */
export interface AgentInstructionFile {
  resource: UiFileResource
  role: "persona"
}

export interface AgentDescription {
  model: string | null
  mcpServers: { id: string; tools: string[] }[]
  instructionFiles: AgentInstructionFile[]
}

/**
 * One panel status, not one per section. Every field below is filled by a
 * single `Promise.allSettled` and committed once, so "loading" genuinely is
 * global. Failure genuinely is per-request, so only that stays per-section.
 */
export interface SectionData<T> {
  error: boolean
  value: T[]
}

export interface AgentCapabilities {
  status: "loading" | "ready"
  describeError: boolean
  description?: AgentDescription
  skills: SectionData<AgentSkillSummary>
  tools: SectionData<AgentToolSummary>
  modelLabel: string | null
  instructionFiles: AgentInstructionFile[]
  /** Workspace-level instruction files that exist in this workspace. */
  workspaceInstructionFiles: string[]
}

const EMPTY_SECTION = { error: false, value: [] }

export const INITIAL_CAPABILITIES: AgentCapabilities = {
  status: "loading",
  describeError: false,
  skills: EMPTY_SECTION,
  tools: EMPTY_SECTION,
  modelLabel: null,
  instructionFiles: [],
  workspaceInstructionFiles: [],
}

/** Workspace-level instruction files that participate in every agent's context. */
export const WORKSPACE_INSTRUCTION_FILES = [
  { path: "AGENTS.md", blurb: "Workspace instructions every agent reads before working.", badge: "workspace" },
  { path: "CLAUDE.md", blurb: "Additional workspace instructions some agents also read.", badge: "workspace" },
] as const

export function parseSkills(payload: unknown): AgentSkillSummary[] {
  const skills = (payload as { skills?: unknown })?.skills
  if (!Array.isArray(skills)) return []
  // Validate then REBUILD, like parseTools. Checking `name` and asserting the
  // whole object through returned the raw payload: a non-string `description`
  // reached React as a child ("Objects are not valid as a React child" takes
  // the whole overlay down) and a non-string `source` hit `.trim()`.
  // Parsing is NOT policy: every well-formed skill survives here, including
  // the non-invocable ones the Skills page renders as management-only rows.
  // Callers that only want invocable skills filter for themselves.
  return skills
    .filter((skill): skill is Record<string, unknown> => typeof skill === "object" && skill !== null)
    .filter((skill) => typeof skill.name === "string" && skill.name.length > 0)
    .map((skill) => ({
      name: skill.name as string,
      ...(typeof skill.description === "string" && skill.description.trim()
        ? { description: skill.description.trim() }
        : {}),
      ...(typeof skill.source === "string" ? { source: skill.source } : {}),
      ...(typeof skill.invocable === "boolean" ? { invocable: skill.invocable } : {}),
      ...(isUiFileResourceShape(skill.resource) ? { resource: skill.resource } : {}),
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

/** Structural check only; safety lives in `openableFileResource`. */
function isUiFileResourceShape(value: unknown): value is UiFileResource {
  const record = value as { filesystem?: unknown; path?: unknown } | null
  return Boolean(record) && typeof record?.filesystem === "string" && typeof record?.path === "string"
}

export function parseTools(payload: unknown): AgentToolSummary[] {
  const tools = (payload as { tools?: unknown })?.tools
  if (!Array.isArray(tools)) return []
  return tools
    .filter((tool): tool is AgentToolSummary =>
      typeof (tool as AgentToolSummary)?.name === "string" && (tool as AgentToolSummary).name.length > 0)
    .map((tool) => ({
      name: tool.name,
      ...(typeof tool.description === "string" && tool.description.trim()
        ? { description: tool.description.trim() }
        : {}),
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

export function parseDescription(payload: unknown): AgentDescription {
  const record = (payload ?? {}) as {
    model?: unknown
    mcpServers?: unknown
    instructionFiles?: unknown
  }
  return {
    model: typeof record.model === "string" && record.model.trim() ? record.model.trim() : null,
    mcpServers: Array.isArray(record.mcpServers)
      ? record.mcpServers
          .filter((server): server is { id: string; tools?: unknown } =>
            typeof (server as { id?: unknown })?.id === "string" && ((server as { id: string }).id.length > 0))
          .map((server) => ({
            id: server.id,
            tools: Array.isArray(server.tools)
              ? server.tools.filter((tool): tool is string => typeof tool === "string")
              : [],
          }))
      : [],
    instructionFiles: Array.isArray(record.instructionFiles)
      ? record.instructionFiles
          .filter((file): file is { filesystem: unknown; path: unknown; role?: unknown } => Boolean(file))
          // The path guard lives at the render/open boundary
          // (`openableFileResource`); here we only keep well-formed refs.
          .filter((file) => typeof file.filesystem === "string" && typeof file.path === "string")
          .map((file) => ({
            resource: { filesystem: file.filesystem as string, path: file.path as string },
            role: "persona" as const,
          }))
      : [],
  }
}

/** Names of the root-level FILES a `/api/v1/tree` listing reports. */
export function parseRootFileNames(payload: unknown): string[] {
  const entries = (payload as { entries?: unknown })?.entries
  if (!Array.isArray(entries)) return []
  return entries
    .filter((entry) => (entry as { kind?: unknown })?.kind === "file" && typeof (entry as { name?: unknown }).name === "string")
    .map((entry) => (entry as { name: string }).name)
}

/**
 * Resolve the model shown in the Defaults section: the agent's pinned model when
 * set, else the host default, labeled through the models catalog.
 */
export function resolveModelLabel(modelsPayload: unknown, pinned: string | null): string | null {
  const record = (modelsPayload ?? {}) as {
    models?: unknown
    defaultModel?: { provider?: unknown; id?: unknown }
  }
  const models = Array.isArray(record.models)
    ? record.models.filter((model): model is { id: string; label?: string } =>
        typeof (model as { id?: unknown })?.id === "string")
    : []
  if (pinned) return models.find((model) => model.id === pinned)?.label ?? pinned
  const defaultId = typeof record.defaultModel?.id === "string" ? record.defaultModel.id : null
  if (!defaultId) return null
  return models.find((model) => model.id === defaultId)?.label ?? defaultId
}

/**
 * Server skill `source` values are internal scope labels (pi sourceInfo.scope,
 * e.g. "temporary", "project"). Map them to user words; unknown values render
 * no badge rather than leaking internal vocabulary.
 */
export function skillSourceLabel(source: string | undefined): string | undefined {
  if (!source) return undefined
  const value = source.trim().toLowerCase()
  if (value === "temporary" || value === "project" || value === "workspace") return "workspace"
  if (value === "user" || value === "global" || value === "host" || value === "fleet") return "built-in"
  if (value.startsWith("shared/")) return "shared"
  if (source.startsWith("@") || source.includes("/")) return "package"
  return undefined
}

/** The minimum this loader needs from the workspace plugin client. */
export interface AgentCapabilitiesClient {
  getJson(path: string, options?: { missingMessage?: string }): Promise<unknown>
}

/**
 * Reads everything the panel shows in ONE fan-out. Per-agent instruction
 * sources come from `/describe` — the Host owns that mapping — and only the
 * workspace-level files are discovered from a single root listing.
 */
export async function loadAgentCapabilities(
  client: AgentCapabilitiesClient,
  agentTypeId: string,
): Promise<AgentCapabilities> {
  // Each route is spelled in full: the #1029 matrix checker classifies literal
  // Agent routes, and a shared base prefix would hide them from it.
  const id = encodeURIComponent(agentTypeId)
  const [describe, skills, tools, models, rootTree] = await Promise.allSettled([
    client.getJson(`/api/v1/agents/${id}/describe`, { missingMessage: "This agent's details are unavailable." }),
    client.getJson(`/api/v1/agents/${id}/skills`, { missingMessage: "This agent's skills are unavailable." }),
    client.getJson(`/api/v1/agents/${id}/tools`, { missingMessage: "This agent's tools are unavailable." }),
    client.getJson(`/api/v1/agents/${id}/models`, { missingMessage: "Models are unavailable." }),
    client.getJson(`/api/v1/tree?path=.&filesystem=user`, { missingMessage: "Workspace files are unavailable." }),
  ])
  const description = describe.status === "fulfilled" ? parseDescription(describe.value) : undefined
  return {
    status: "ready",
    describeError: describe.status !== "fulfilled",
    ...(description ? { description } : {}),
    skills: {
      error: skills.status !== "fulfilled",
      // The panel lists what the agent can be ASKED to do, so policy-hidden
      // (non-invocable) skills are excluded here — the Skills page keeps them.
      value: skills.status === "fulfilled" ? parseSkills(skills.value).filter((skill) => skill.invocable !== false) : [],
    },
    tools: { error: tools.status !== "fulfilled", value: tools.status === "fulfilled" ? parseTools(tools.value) : [] },
    modelLabel: models.status === "fulfilled"
      ? resolveModelLabel(models.value, description?.model ?? null)
      : description?.model ?? null,
    instructionFiles: description?.instructionFiles ?? [],
    workspaceInstructionFiles: rootTree.status === "fulfilled" ? parseRootFileNames(rootTree.value) : [],
  }
}

/**
 * Does this file actually exist where the Host says it does?
 *
 * A SAFETY NET, not the mechanism that catches a mis-rooted host. Publication
 * is deterministic upstream: the fleet loader composes a seat by reading its
 * `instructions.md`, so the file provably exists on the server, and it only
 * publishes a ref when that file is also inside the root the `user` filesystem
 * serves (`AGENT_FLEET_SEAT_INSTRUCTIONS_PATH_UNPUBLISHABLE` otherwise). A
 * boot seam that passes the wrong root therefore renders NO row — it can no
 * longer render a row that 404s, and this probe must never be relied on to
 * paper over one.
 *
 * What remains is genuine drift: a file deleted, renamed or moved AFTER the
 * fleet composed. Opening such a ref used to 404 inside the viewer with no
 * toast, no row state and no visible change — the user clicked a healthy-looking
 * link and got nothing.
 *
 * Verified ON CLICK, deliberately, not for every row at load time. The panel
 * loader resolves everything in ONE `Promise.allSettled`, and it cannot know
 * these paths until `/describe` inside that fan-out has already resolved — so
 * pre-verification means a second request wave on every panel open, for every
 * agent, to pre-empt a failure that is rare. One probe per actual click costs
 * nothing when nothing is clicked, covers skills and instruction files with the
 * same code, and stays correct when a file disappears AFTER the panel loaded.
 */
export async function fileResourceExists(
  client: AgentCapabilitiesClient,
  resource: UiFileResource,
): Promise<boolean> {
  // Mirrors the filesystem plugin's own read: `user` is the server default and
  // passing it explicitly is not universally accepted.
  const params = new URLSearchParams({ path: resource.path })
  if (resource.filesystem !== "user") params.set("filesystem", resource.filesystem)
  try {
    await client.getJson(`/api/v1/files?${params.toString()}`, {
      missingMessage: `${resource.path} is unavailable.`,
    })
    return true
  } catch {
    return false
  }
}
