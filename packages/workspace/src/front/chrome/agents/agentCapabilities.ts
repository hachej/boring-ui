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
export type SourceResult<T> =
  | { status: "loaded"; value: T }
  | { status: "error"; error: string }

export interface AgentCapabilities {
  status: "loading" | "ready"
  description: SourceResult<AgentDescription>
  skills: SourceResult<AgentSkillSummary[]>
  tools: SourceResult<AgentToolSummary[]>
  modelLabel: SourceResult<string | null>
}

/** A loaded-but-empty list. Generic so each field keeps its own element type. */
const loadedEmpty = <T>(): SourceResult<T[]> => ({ status: "loaded", value: [] })

export const INITIAL_CAPABILITIES: AgentCapabilities = {
  status: "loading",
  description: { status: "loaded", value: { model: null, mcpServers: [], instructionFiles: [] } },
  skills: loadedEmpty<AgentSkillSummary>(),
  tools: loadedEmpty<AgentToolSummary>(),
  modelLabel: { status: "loaded", value: null },
}

export const UNAVAILABLE_CAPABILITIES: AgentCapabilities = {
  status: "ready",
  description: { status: "error", error: "This agent's details are unavailable." },
  skills: { status: "error", error: "Failed to load this agent's skills." },
  tools: { status: "error", error: "Failed to load this agent's tools." },
  modelLabel: { status: "error", error: "Models are unavailable." },
}

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

export interface LoadAgentCapabilitySectionsOptions {
  refresh?: boolean
  includeNonInvocableSkills?: boolean
}

function sourceError(reason: unknown, fallback: string): SourceResult<never> {
  return {
    status: "error",
    error: reason instanceof Error ? reason.message : fallback,
  }
}

/** Load only the two capability sections shared by both Agent surfaces. */
export async function loadAgentCapabilitySections(
  client: AgentCapabilitiesClient,
  agentTypeId: string,
  options: LoadAgentCapabilitySectionsOptions = {},
): Promise<Pick<AgentCapabilities, "skills" | "tools">> {
  const id = encodeURIComponent(agentTypeId)
  const query = options.refresh ? "?refresh=1" : ""
  const [skills, tools] = await Promise.allSettled([
    client.getJson(`/api/v1/agents/${id}/skills${query}`, {
      missingMessage: "Failed to load this agent's skills.",
    }),
    client.getJson(`/api/v1/agents/${id}/tools${query}`, {
      missingMessage: "Failed to load this agent's tools.",
    }),
  ])
  return {
    skills: skills.status === "fulfilled"
      ? {
        status: "loaded",
        value: parseSkills(skills.value).filter((skill) => options.includeNonInvocableSkills || skill.invocable !== false),
      }
      : sourceError(skills.reason, "Failed to load this agent's skills."),
    tools: tools.status === "fulfilled"
      ? { status: "loaded", value: parseTools(tools.value) }
      : sourceError(tools.reason, "Failed to load this agent's tools."),
  }
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
  const [[describe, models], sections] = await Promise.all([
    Promise.allSettled([
      client.getJson(`/api/v1/agents/${id}/describe`, { missingMessage: "This agent's details are unavailable." }),
      client.getJson(`/api/v1/agents/${id}/models`, { missingMessage: "Models are unavailable." }),
    ]),
    loadAgentCapabilitySections(client, agentTypeId),
  ])
  const description = describe.status === "fulfilled" ? parseDescription(describe.value) : undefined
  return {
    status: "ready",
    description: description
      ? { status: "loaded", value: description }
      : sourceError(describe.status === "rejected" ? describe.reason : undefined, "This agent's details are unavailable."),
    // The details panel lists what the agent can be ASKED to do, so the shared
    // section loader's default excludes policy-hidden (non-invocable) skills.
    ...sections,
    modelLabel: models.status === "fulfilled"
      ? { status: "loaded", value: resolveModelLabel(models.value, description?.model ?? null) }
      : description?.model
        ? { status: "loaded", value: description.model }
        : sourceError(models.status === "rejected" ? models.reason : undefined, "Models are unavailable."),
  }
}

/**
 * Does this file actually exist where the Host says it does?
 *
 * A SAFETY NET, not the mechanism that catches a mis-rooted host. Publication
 * is deterministic upstream: the fleet loader composes a seat by reading its
 * `instructions.md`, so the file provably exists on the server, and `describe`
 * only publishes a ref when that file also canonically resolves inside the
 * root the `user` filesystem serves FOR THAT REQUEST
 * (`AGENT_FLEET_SEAT_INSTRUCTIONS_PATH_UNPUBLISHABLE` otherwise). A request
 * served from a workspace the personas are outside of therefore renders NO
 * row — it can no longer render a row that 404s, and this probe must never be
 * relied on to paper over one.
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
export type FileResourceProbeResult =
  | { status: "exists" }
  | { status: "missing" }
  | { status: "error" }

export async function fileResourceExists(
  client: AgentCapabilitiesClient,
  resource: UiFileResource,
): Promise<FileResourceProbeResult> {
  // Mirrors the filesystem plugin's own read: `user` is the server default and
  // passing it explicitly is not universally accepted.
  const params = new URLSearchParams({ path: resource.path })
  if (resource.filesystem !== "user") params.set("filesystem", resource.filesystem)
  try {
    await client.getJson(`/api/v1/files?${params.toString()}`, {
      missingMessage: `${resource.path} is unavailable.`,
    })
    return { status: "exists" }
  } catch (error) {
    const status = typeof error === "object" && error !== null && "status" in error
      ? (error as { status?: unknown }).status
      : undefined
    return status === 404
      ? { status: "missing" }
      : { status: "error" }
  }
}
