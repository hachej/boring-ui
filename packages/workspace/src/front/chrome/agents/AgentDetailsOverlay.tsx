"use client"

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { BookOpen, Bot, ChevronDown, ExternalLink, FileText, MessageSquarePlus, X } from "lucide-react"
import { IconButton } from "@hachej/boring-ui-kit"
import { cn } from "../../lib/utils"
import { postUiCommand } from "../../bridge"
import { ManagementOverlaySurface } from "../management/ManagementOverlaySurface"
import { useOptionalWorkspacePluginClient } from "../../plugin/useWorkspacePluginClient"
import { uiFileResourceKey, type UiFileResource } from "../../../shared/types/filesystem"
import { isSafePluginRelativePath } from "../../../shared/plugins/manifest"

export interface AgentDetailsOverlayAgent {
  agentTypeId: string
  label: string
  description?: string
  pluginIds?: readonly string[]
  sessionsStatus?: "loading" | "loaded" | "error"
}

export interface AgentDetailsOverlayProps {
  agent: AgentDetailsOverlayAgent
  sessionCount: number
  onCreateSession: () => void
  onClose: () => void
  headerInsetStart?: boolean
  headerInsetEnd?: boolean
}

interface AgentSkillSummary {
  name: string
  description?: string
  source?: string
  invocable?: boolean
  resource?: UiFileResource
}

interface AgentToolSummary {
  name: string
  description?: string
}

interface AgentDescription {
  systemPrompt: string | null
  model: string | null
  plugins: { id: string }[]
  mcpServers: { id: string; tools: string[] }[]
}

interface KnowledgeSource {
  filesystem: string
  label: string
  rootDir?: string
  access?: string
}

/** Workspace-level instruction files that participate in every agent's context. */
const WORKSPACE_INSTRUCTION_FILES = [
  { path: "AGENTS.md", blurb: "Workspace instructions every agent reads before working.", badge: "workspace" },
  { path: "CLAUDE.md", blurb: "Additional workspace instructions for Claude-based agents.", badge: "workspace" },
] as const

/** Personas live as plugin-shaped packages under .agents/personas/<name>/. */
const PERSONAS_DIR = ".agents/personas"

interface InstructionFileRow {
  path: string
  name: string
  blurb: string
  badge?: string
}

/** Match this agent's persona directory (agent ids may carry a fleet prefix, e.g. boring-concierge -> concierge). */
function matchPersonaDir(agentTypeId: string, dirs: readonly string[]): string | undefined {
  return dirs.find((dir) => dir === agentTypeId)
    ?? dirs.find((dir) => agentTypeId === `boring-${dir}` || agentTypeId.endsWith(`-${dir}`))
}

type SectionStatus = "loading" | "ready" | "error"

interface AgentCapabilities {
  describe: { status: SectionStatus; value?: AgentDescription }
  skills: { status: SectionStatus; value: AgentSkillSummary[] }
  tools: { status: SectionStatus; value: AgentToolSummary[] }
  modelLabel: string | null
  knowledge: { status: SectionStatus; value: KnowledgeSource[] }
  instructionFiles: InstructionFileRow[]
}

const INITIAL_CAPABILITIES: AgentCapabilities = {
  describe: { status: "loading" },
  skills: { status: "loading", value: [] },
  tools: { status: "loading", value: [] },
  modelLabel: null,
  knowledge: { status: "loading", value: [] },
  instructionFiles: [],
}

function isSafeRelativeSkillPath(value: unknown): value is string {
  return typeof value === "string"
    && isSafePluginRelativePath(value)
    && !/%(?:2e|2f|5c)/i.test(value)
    && !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)
    && !value.split("/").some((segment) => segment === "" || segment === ".")
}

function openableResource(skill: AgentSkillSummary): UiFileResource | undefined {
  const resource = skill.resource
  return resource
    && typeof resource.filesystem === "string"
    && resource.filesystem.length > 0
    && isSafeRelativeSkillPath(resource.path)
    ? resource
    : undefined
}

function parseSkills(payload: unknown): AgentSkillSummary[] {
  const skills = (payload as { skills?: unknown })?.skills
  if (!Array.isArray(skills)) return []
  return skills
    .filter((skill): skill is AgentSkillSummary =>
      typeof (skill as AgentSkillSummary)?.name === "string" && (skill as AgentSkillSummary).name.length > 0)
    .filter((skill) => skill.invocable !== false)
    .sort((left, right) => left.name.localeCompare(right.name))
}

function parseTools(payload: unknown): AgentToolSummary[] {
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

function parseDescription(payload: unknown): AgentDescription {
  const record = (payload ?? {}) as {
    systemPrompt?: unknown
    model?: unknown
    plugins?: unknown
    mcpServers?: unknown
  }
  return {
    systemPrompt: typeof record.systemPrompt === "string" && record.systemPrompt.trim()
      ? record.systemPrompt
      : null,
    model: typeof record.model === "string" && record.model.trim() ? record.model.trim() : null,
    plugins: Array.isArray(record.plugins)
      ? record.plugins
          .map((plugin) => (plugin as { id?: unknown })?.id)
          .filter((id): id is string => typeof id === "string" && id.length > 0)
          .map((id) => ({ id }))
      : [],
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
  }
}

function parseKnowledge(payload: unknown): KnowledgeSource[] {
  const filesystems = (payload as { filesystems?: unknown })?.filesystems
  if (!Array.isArray(filesystems)) return []
  return filesystems
    .filter((entry): entry is { filesystem: string; label?: unknown; rootDir?: unknown; access?: unknown } =>
      typeof (entry as { filesystem?: unknown })?.filesystem === "string")
    .map((entry) => ({
      filesystem: entry.filesystem,
      label: typeof entry.label === "string" && entry.label.trim() ? entry.label : entry.filesystem,
      ...(typeof entry.rootDir === "string" ? { rootDir: entry.rootDir } : {}),
      ...(typeof entry.access === "string" ? { access: entry.access } : {}),
    }))
}

/**
 * Resolve the model shown in the header strip: the agent's pinned model when
 * set, else the host default, labeled through the models catalog.
 */
function resolveModelLabel(modelsPayload: unknown, pinned: string | null): string | null {
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
function skillSourceLabel(source: string | undefined): string | undefined {
  if (!source) return undefined
  const value = source.trim().toLowerCase()
  if (value === "temporary" || value === "project" || value === "workspace") return "workspace"
  if (value === "user" || value === "global" || value === "host" || value === "fleet") return "built-in"
  if (value.startsWith("shared/")) return "shared"
  if (source.startsWith("@") || source.includes("/")) return "package"
  return undefined
}

/**
 * Prompt text flows like prose in the preview: single newlines inside a
 * paragraph collapse to spaces, blank lines keep paragraph breaks.
 */
function normalizePromptText(prompt: string): string {
  return prompt
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean)
    .join("\n\n")
}

/**
 * Presentation-only formatting for the GENERATED composed-prompt file: each
 * host-attached skill block (frontmatter + body) renders as a fenced code
 * block under a small caption, so the workbench viewer doesn't typeset raw
 * frontmatter as prose. The actual composition the server uses is untouched.
 */
function formatComposedPromptMarkdown(prompt: string): string {
  return prompt.replace(
    /<!--\s*boring-skill:start\s+name=([\w./-]+)[^>]*-->\n?([\s\S]*?)<!--\s*boring-skill:end[^>]*-->/g,
    (_match, name: string, body: string) =>
      `**Attached skill: /${name}**\n\n\`\`\`\`text\n${body.trim()}\n\`\`\`\``,
  )
}

function DetailSection({ id, title, hint, children }: {
  id: string
  title: string
  hint?: string
  children: ReactNode
}) {
  return (
    <section aria-labelledby={id}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 id={id} className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{title}</h3>
        {hint ? <span className="shrink-0 text-[11px] text-muted-foreground/80">{hint}</span> : null}
      </div>
      {children}
    </section>
  )
}

function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="mt-3 border-y border-border/60 py-3 text-sm text-muted-foreground">{children}</p>
}

function SectionSkeleton() {
  return (
    <div aria-hidden="true" className="mt-3 animate-pulse border-y border-border/60 py-3">
      <div className="h-3.5 w-1/3 rounded bg-foreground/[0.08]" />
      <div className="mt-2 h-3 w-3/5 rounded bg-foreground/[0.06]" />
    </div>
  )
}

function CardRowButton({ onClick, ariaLabel, title, children }: {
  onClick: () => void
  ariaLabel: string
  title: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
      className="group block w-full rounded-xl border border-border/60 bg-card/70 text-left transition-colors hover:border-border hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      {children}
    </button>
  )
}

/** Rough size past which the prompt preview clamps and offers the full text. */
const SYSTEM_PROMPT_PREVIEW_LIMIT = 280

export function AgentDetailsOverlay({
  agent,
  sessionCount,
  onCreateSession,
  onClose,
  headerInsetStart = false,
  headerInsetEnd = false,
}: AgentDetailsOverlayProps) {
  const client = useOptionalWorkspacePluginClient()
  const [capabilities, setCapabilities] = useState<AgentCapabilities>(INITIAL_CAPABILITIES)
  const [promptExpanded, setPromptExpanded] = useState(false)
  const [expandedTool, setExpandedTool] = useState<string | null>(null)

  const agentTypeId = agent.agentTypeId
  const load = useCallback(async () => {
    if (!client) {
      // No API client in this embedding: sections fall back to quiet
      // empty states rather than spinners that never resolve.
      setCapabilities({
        ...INITIAL_CAPABILITIES,
        describe: { status: "ready" },
        skills: { status: "ready", value: [] },
        tools: { status: "ready", value: [] },
        knowledge: { status: "ready", value: [] },
      })
      return
    }
    setCapabilities(INITIAL_CAPABILITIES)
    const base = `/api/v1/agents/${encodeURIComponent(agentTypeId)}`
    const [describe, skills, tools, models, filesystems, rootTree] = await Promise.allSettled([
      client.getJson(`${base}/describe`, { missingMessage: "This agent's details are unavailable." }),
      client.getJson(`${base}/skills`, { missingMessage: "This agent's skills are unavailable." }),
      client.getJson(`${base}/tools`, { missingMessage: "This agent's tools are unavailable." }),
      client.getJson(`${base}/models`, { missingMessage: "Models are unavailable." }),
      client.getJson(`/api/v1/filesystems`, { missingMessage: "Knowledge sources are unavailable." }),
      // One root listing (no 404 noise) tells us which instruction files exist.
      client.getJson(`/api/v1/tree?path=.&filesystem=user`, { missingMessage: "Workspace files are unavailable." }),
    ])
    const treeNames = (tree: PromiseSettledResult<unknown>, kind: string): string[] =>
      tree.status === "fulfilled" && Array.isArray((tree.value as { entries?: unknown })?.entries)
        ? ((tree.value as { entries: Array<{ name?: unknown; kind?: unknown }> }).entries)
            .filter((entry) => entry?.kind === kind && typeof entry.name === "string")
            .map((entry) => entry.name as string)
        : []
    const rootFiles = new Set(treeNames(rootTree, "file"))
    // Persona discovery descends only through directories the parent listing
    // reports, so a workspace without personas produces zero 404s.
    const listDirs = async (path: string): Promise<string[]> => treeNames(
      await Promise.allSettled([
        client.getJson(`/api/v1/tree?path=${encodeURIComponent(path)}&filesystem=user`, { missingMessage: `${path} is unavailable.` }),
      ]).then(([entry]) => entry),
      "dir",
    )
    let personaDir: string | undefined
    if (treeNames(rootTree, "dir").includes(".agents")) {
      const agentsDirs = await listDirs(".agents")
      if (agentsDirs.includes("personas")) {
        personaDir = matchPersonaDir(agentTypeId, await listDirs(PERSONAS_DIR))
      }
    }
    const instructionFiles: InstructionFileRow[] = [
      ...(personaDir ? [{
        path: `${PERSONAS_DIR}/${personaDir}/instructions.md`,
        name: "Persona instructions",
        blurb: "What this agent is asked to be and to do.",
      }] : []),
      ...WORKSPACE_INSTRUCTION_FILES
        .filter((file) => rootFiles.has(file.path))
        .map((file) => ({ path: file.path, name: file.path, blurb: file.blurb, badge: file.badge })),
    ]
    const description = describe.status === "fulfilled" ? parseDescription(describe.value) : undefined
    setCapabilities({
      describe: description ? { status: "ready", value: description } : { status: "error" },
      skills: skills.status === "fulfilled"
        ? { status: "ready", value: parseSkills(skills.value) }
        : { status: "error", value: [] },
      tools: tools.status === "fulfilled"
        ? { status: "ready", value: parseTools(tools.value) }
        : { status: "error", value: [] },
      modelLabel: models.status === "fulfilled"
        ? resolveModelLabel(models.value, description?.model ?? null)
        : description?.model ?? null,
      knowledge: filesystems.status === "fulfilled"
        ? { status: "ready", value: parseKnowledge(filesystems.value) }
        : { status: "error", value: [] },
      instructionFiles,
    })
  }, [agentTypeId, client])

  useEffect(() => {
    setPromptExpanded(false)
    setExpandedTool(null)
    void load()
  }, [load])

  const statusLabel = agent.sessionsStatus === "error"
    ? "Unavailable"
    : agent.sessionsStatus === "loading" ? "Loading" : "Ready"

  const description = capabilities.describe.value
  const systemPrompt = description?.systemPrompt ?? null
  const promptText = useMemo(() => systemPrompt ? normalizePromptText(systemPrompt) : null, [systemPrompt])
  const promptNeedsToggle = Boolean(promptText && promptText.length > SYSTEM_PROMPT_PREVIEW_LIMIT)
  // The list endpoint's pluginIds keep the section meaningful while /describe
  // loads (or on hosts that don't serve it yet).
  const pluginIds = useMemo(() => {
    if (description && description.plugins.length > 0) return description.plugins.map((plugin) => plugin.id)
    return [...(agent.pluginIds ?? [])]
  }, [agent.pluginIds, description])

  const openInstructionFile = useCallback((path: string) => {
    postUiCommand({ kind: "openFile", params: { filesystem: "user", path, mode: "view" } })
  }, [])

  const openKnowledgeRoot = useCallback((source: KnowledgeSource) => {
    // Reveal the mounted filesystem in the workbench file tree.
    postUiCommand({ kind: "expandToFile", params: { filesystem: source.filesystem, path: source.rootDir && source.rootDir !== "." ? source.rootDir : "" } })
  }, [])

  const openComposedPrompt = useCallback(async () => {
    // The composed prompt is not an authored file; re-read the live
    // composition, materialize it into the workspace scratch area through the
    // existing files adapter, then open it through the single UI dispatch
    // path. The file is regenerated on every open so it always reflects the
    // current composition rather than a stale snapshot.
    if (!client || !systemPrompt) return
    const path = `.boring/agent-prompts/${agentTypeId}.md`
    try {
      const fresh = parseDescription(await client.getJson(
        `/api/v1/agents/${encodeURIComponent(agentTypeId)}/describe`,
        { missingMessage: "This agent's details are unavailable." },
      ))
      const livePrompt = fresh.systemPrompt ?? systemPrompt
      // The files route does not create parent directories; mkdir is
      // best-effort because it 409s when the directory already exists.
      await client.postJson("/api/v1/dirs", { path: ".boring/agent-prompts", filesystem: "user" }).catch(() => undefined)
      await client.postJson("/api/v1/files", {
        path,
        filesystem: "user",
        content: `# ${agent.label} — composed system prompt\n\n> Read-only generated view. Regenerated from the live composition each time it is opened from Agent details — edits here have no effect.\n\n${formatComposedPromptMarkdown(livePrompt)}\n`,
        returnMtimeMs: false,
      })
      postUiCommand({ kind: "openFile", params: { filesystem: "user", path, mode: "view" } })
    } catch {
      postUiCommand({ kind: "showNotification", params: { msg: "Couldn't open the composed prompt.", level: "error" } })
    }
  }, [agent.label, agentTypeId, client, systemPrompt])

  const skillCount = capabilities.skills.status === "ready" ? capabilities.skills.value.length : undefined
  const toolCount = capabilities.tools.status === "ready" ? capabilities.tools.value.length : undefined

  return (
    <div role="region" aria-label={`${agent.label} details`} className="h-full min-h-0">
      <ManagementOverlaySurface
        part="agent-details-overlay"
        title={agent.label}
        description={agent.description || "Workspace agent"}
        headerInsetStart={headerInsetStart}
        headerInsetEnd={headerInsetEnd}
        icon={(
          <span className="grid size-7 place-items-center rounded-lg bg-[color:oklch(from_var(--accent)_l_c_h/0.12)] text-[color:var(--accent)]">
            <Bot className="size-4" strokeWidth={1.75} aria-hidden="true" />
          </span>
        )}
        actions={(<>
          <IconButton
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={onCreateSession}
            aria-label={`New chat with ${agent.label}`}
            title="New chat"
            className="text-muted-foreground hover:text-foreground"
          >
            <MessageSquarePlus className="size-3" strokeWidth={1.75} />
          </IconButton>
          <IconButton
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={onClose}
            aria-label={`Close ${agent.label} details`}
            title="Close"
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-3" strokeWidth={1.75} />
          </IconButton>
        </>)}
      >
        <div className="boring-scrollbar-discreet min-h-0 flex-1 overflow-y-auto p-4">
          <div className="grid max-w-3xl gap-7">
            <section aria-labelledby="agent-overview-heading">
              <h3 id="agent-overview-heading" className="sr-only">Overview</h3>
              <p className="text-sm leading-6 text-foreground/85">
                {agent.description || `${agent.label} is ready to chat and work in this workspace.`}
              </p>
              <dl className="mt-3 flex flex-wrap items-center gap-x-8 gap-y-2 border-y border-border/60 py-3">
                <div className="flex items-baseline gap-2">
                  <dt className="text-[11px] font-medium text-muted-foreground">Chats</dt>
                  <dd className="text-sm font-semibold tabular-nums text-foreground">{sessionCount}</dd>
                </div>
                <div className="flex items-baseline gap-2">
                  <dt className="text-[11px] font-medium text-muted-foreground">Status</dt>
                  <dd className="text-sm font-semibold text-foreground">{statusLabel}</dd>
                </div>
                {capabilities.modelLabel ? (
                  <div className="flex min-w-0 items-baseline gap-2">
                    <dt className="text-[11px] font-medium text-muted-foreground">Model</dt>
                    <dd className="min-w-0 truncate text-sm font-semibold text-foreground">{capabilities.modelLabel}</dd>
                  </div>
                ) : null}
              </dl>
            </section>

            <DetailSection id="agent-instructions-heading" title="Instructions">
              {capabilities.describe.status === "loading" && capabilities.instructionFiles.length === 0 ? (
                <SectionSkeleton />
              ) : capabilities.instructionFiles.length === 0 ? (
                <EmptyLine>No workspace instruction files.</EmptyLine>
              ) : (
                <ul role="list" className="mt-3 grid gap-2">
                  {capabilities.instructionFiles.map((file) => (
                    <li key={file.path} className="min-w-0">
                      <CardRowButton
                        onClick={() => openInstructionFile(file.path)}
                        ariaLabel={`Open ${file.name}`}
                        title={`Open ${file.path}`}
                      >
                        <div className="flex min-h-11 w-full items-start justify-between gap-3 px-3 py-2.5 sm:min-h-0">
                          <div className="min-w-0">
                            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                              <span className="min-w-0 truncate text-sm font-medium leading-5 text-foreground">{file.name}</span>
                              {file.badge ? (
                                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground">{file.badge}</span>
                              ) : null}
                            </div>
                            <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{file.blurb}</p>
                          </div>
                          <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground/70 transition-colors group-hover:text-foreground" strokeWidth={1.75} aria-hidden="true" />
                        </div>
                      </CardRowButton>
                    </li>
                  ))}
                </ul>
              )}
            </DetailSection>

            <DetailSection
              id="agent-knowledge-heading"
              title="Knowledge"
              hint={capabilities.knowledge.value.length > 1 ? `${capabilities.knowledge.value.length}` : undefined}
            >
              {capabilities.knowledge.status === "loading" ? <SectionSkeleton /> : capabilities.knowledge.value.length === 0 ? (
                <EmptyLine>
                  {capabilities.knowledge.status === "error"
                    ? "Knowledge sources couldn't be loaded."
                    : "No knowledge sources."}
                </EmptyLine>
              ) : (
                <ul role="list" className="mt-3 grid gap-2">
                  {capabilities.knowledge.value.map((source) => (
                    <li key={source.filesystem} className="min-w-0">
                      <CardRowButton
                        onClick={() => openKnowledgeRoot(source)}
                        ariaLabel={`Browse ${source.label} files`}
                        title={`Browse ${source.label}`}
                      >
                        <div className="flex min-h-11 w-full items-start justify-between gap-3 px-3 py-2.5 sm:min-h-0">
                          <div className="min-w-0">
                            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                              <span className="min-w-0 truncate text-sm font-medium leading-5 text-foreground">{source.label}</span>
                              {source.access === "readonly" ? (
                                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground">read-only</span>
                              ) : null}
                            </div>
                            <p className="mt-1 truncate text-xs leading-5 text-muted-foreground">
                              Files this agent can {source.access === "readonly" ? "read" : "read and edit"}.
                            </p>
                          </div>
                          <BookOpen className="mt-0.5 size-4 shrink-0 text-muted-foreground/70 transition-colors group-hover:text-foreground" strokeWidth={1.75} aria-hidden="true" />
                        </div>
                      </CardRowButton>
                    </li>
                  ))}
                </ul>
              )}
            </DetailSection>

            <DetailSection
              id="agent-skills-heading"
              title="Skills"
              hint={skillCount !== undefined && skillCount > 0 ? `${skillCount}` : undefined}
            >
              {capabilities.skills.status === "loading" ? <SectionSkeleton /> : capabilities.skills.value.length === 0 ? (
                <EmptyLine>
                  {capabilities.skills.status === "error"
                    ? "Skills couldn't be loaded."
                    : "No skills."}
                </EmptyLine>
              ) : (
                <ul role="list" className="mt-3 grid gap-2">
                  {capabilities.skills.value.map((skill, index) => {
                    const resource = openableResource(skill)
                    const body = (
                      <div className="flex min-h-11 w-full items-start justify-between gap-3 px-3 py-2.5 sm:min-h-0">
                        <div className="min-w-0">
                          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                            <span className="min-w-0 truncate text-sm font-medium leading-5 text-foreground">/{skill.name}</span>
                            {skillSourceLabel(skill.source) ? (
                              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground">{skillSourceLabel(skill.source)}</span>
                            ) : null}
                          </div>
                          {skill.description ? (
                            <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{skill.description}</p>
                          ) : null}
                        </div>
                        {resource ? (
                          <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground/70 transition-colors group-hover:text-foreground" strokeWidth={1.75} aria-hidden="true" />
                        ) : null}
                      </div>
                    )
                    return (
                      <li key={skill.resource ? uiFileResourceKey(skill.resource) : `${skill.name}\0${index}`} className="min-w-0">
                        {resource ? (
                          <CardRowButton
                            onClick={() => postUiCommand({ kind: "openFile", params: { ...resource, mode: "view" } })}
                            ariaLabel={`Open skill ${skill.name}`}
                            title="Open this skill"
                          >
                            {body}
                          </CardRowButton>
                        ) : (
                          <div className="rounded-xl border border-border/60 bg-card/70">{body}</div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </DetailSection>

            <DetailSection
              id="agent-tools-heading"
              title="Tools"
              hint={toolCount !== undefined && toolCount > 0 ? `${toolCount}` : undefined}
            >
              {capabilities.tools.status === "loading" ? <SectionSkeleton /> : capabilities.tools.value.length === 0 ? (
                <EmptyLine>
                  {capabilities.tools.status === "error"
                    ? "Tools couldn't be loaded."
                    : "No tools."}
                </EmptyLine>
              ) : (
                <ul role="list" className="mt-3 divide-y divide-border/50 border-y border-border/60">
                  {capabilities.tools.value.map((tool) => {
                    const expanded = expandedTool === tool.name
                    return (
                      <li key={tool.name} className="min-w-0">
                        <button
                          type="button"
                          onClick={() => setExpandedTool((current) => current === tool.name ? null : tool.name)}
                          aria-expanded={expanded}
                          className="group flex min-h-11 w-full items-start justify-between gap-3 py-2.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 sm:min-h-0"
                        >
                          <span className="min-w-0">
                            <span className="block truncate font-mono text-[13px] font-medium leading-5 text-foreground">{tool.name}</span>
                            {tool.description ? (
                              <span className={cn(
                                "mt-0.5 block text-xs leading-5 text-muted-foreground",
                                expanded ? "whitespace-pre-wrap break-words" : "line-clamp-1",
                              )}>{tool.description}</span>
                            ) : null}
                          </span>
                          {tool.description ? (
                            <ChevronDown className={cn("mt-1 size-3.5 shrink-0 text-muted-foreground/60 transition-transform group-hover:text-foreground", expanded && "rotate-180")} strokeWidth={1.75} aria-hidden="true" />
                          ) : null}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </DetailSection>

            <DetailSection id="agent-mcp-heading" title="MCP access">
              {capabilities.describe.status === "loading" ? <SectionSkeleton /> : !description || description.mcpServers.length === 0 ? (
                <EmptyLine>
                  {capabilities.describe.status === "error"
                    ? "MCP access couldn't be loaded."
                    : "No MCP servers connected."}
                </EmptyLine>
              ) : (
                <ul role="list" className="mt-3 divide-y divide-border/50 border-y border-border/60">
                  {description.mcpServers.map((server) => (
                    <li key={server.id} className="py-2.5">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 truncate text-sm font-medium text-foreground">{server.id}</span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {server.tools.length === 1 ? "1 tool" : `${server.tools.length} tools`}
                        </span>
                      </div>
                      {server.tools.length > 0 ? (
                        <p className="mt-1 break-words text-xs leading-5 text-muted-foreground">{server.tools.join(", ")}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </DetailSection>

            <DetailSection id="agent-plugins-heading" title="Plugins">
              {capabilities.describe.status === "loading" && pluginIds.length === 0 ? <SectionSkeleton /> : pluginIds.length === 0 ? (
                <EmptyLine>No plugins.</EmptyLine>
              ) : (
                <ul role="list" className="mt-3 divide-y divide-border/50 border-y border-border/60">
                  {pluginIds.map((pluginId) => (
                    <li key={pluginId} className="flex min-h-11 items-center justify-between gap-3 py-2.5 sm:min-h-0">
                      <span className="min-w-0 truncate text-sm font-medium text-foreground">{pluginId}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">Enabled</span>
                    </li>
                  ))}
                </ul>
              )}
            </DetailSection>

            <DetailSection id="agent-system-prompt-heading" title="System prompt">
              {capabilities.describe.status === "loading" ? <SectionSkeleton /> : promptText ? (
                <div className="mt-3">
                  <p className="text-[11px] leading-5 text-muted-foreground/80">
                    Composed automatically from this page's pieces — instructions, skills, and tools.
                  </p>
                  <p className={cn(
                    "mt-2 whitespace-pre-line break-words border-l-2 border-border/60 pl-3 text-xs leading-5 text-muted-foreground",
                    promptNeedsToggle && !promptExpanded && "line-clamp-3",
                  )}>{promptText}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                    {promptNeedsToggle ? (
                      <button
                        type="button"
                        onClick={() => setPromptExpanded((current) => !current)}
                        aria-expanded={promptExpanded}
                        className="inline-flex min-h-11 items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 sm:min-h-0"
                      >
                        <ChevronDown className={cn("size-3.5 transition-transform", promptExpanded && "rotate-180")} strokeWidth={1.75} aria-hidden="true" />
                        {promptExpanded ? "Show less" : "Show more"}
                      </button>
                    ) : null}
                    {client ? (
                      <button
                        type="button"
                        onClick={() => void openComposedPrompt()}
                        className="inline-flex min-h-11 items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 sm:min-h-0"
                      >
                        <ExternalLink className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                        Open in workbench
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : (
                <EmptyLine>
                  {capabilities.describe.status === "error"
                    ? "The system prompt couldn't be loaded."
                    : "This agent uses the default instructions."}
                </EmptyLine>
              )}
            </DetailSection>

            <dl className="border-t border-border/60 pt-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <dt className="text-[11px] font-medium text-muted-foreground">Agent ID</dt>
                <dd className="break-all font-mono text-xs text-muted-foreground">{agent.agentTypeId}</dd>
              </div>
            </dl>
          </div>
        </div>
      </ManagementOverlaySurface>
    </div>
  )
}
