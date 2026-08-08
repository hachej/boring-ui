"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { BookOpen, Bot, ChevronDown, ExternalLink, FileText, X } from "lucide-react"
import { IconButton } from "@hachej/boring-ui-kit"
import { cn } from "../../lib/utils"
import { postUiCommand } from "../../bridge"
import { ManagementOverlaySurface } from "../management/ManagementOverlaySurface"
import { useOptionalWorkspacePluginClient } from "../../plugin/useWorkspacePluginClient"
import { uiFileResourceKey, type UiFileResource } from "../../../shared/types/filesystem"
import { openableSkillResource } from "../../../shared/skills/openableSkillResource"

export interface AgentDetailsOverlayAgent {
  agentTypeId: string
  label: string
  description?: string
  pluginIds?: readonly string[]
  sessionsStatus?: "loading" | "loaded" | "error"
}

export interface AgentDetailsOverlayProps {
  agent: AgentDetailsOverlayAgent
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

interface InstructionFileRow {
  path: string
  name: string
  blurb: string
  badge?: string
}

interface AgentDescription {
  systemPrompt: string | null
  model: string | null
  plugins: { id: string }[]
  mcpServers: { id: string; tools: string[] }[]
  /** Authored instruction sources, as reported by the Host. */
  instructionFiles: { path: string; name: string }[]
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

/**
 * One panel status, not four. Every section is filled by a single
 * `Promise.allSettled` + a single commit, so per-section "loading" flags were
 * fiction: they always flipped together. Failure IS per-section (each request
 * settles on its own), so only the error flag is kept per section.
 */
interface SectionData<T> {
  error: boolean
  value: T[]
}

interface AgentCapabilities {
  status: "loading" | "ready"
  describeError: boolean
  description?: AgentDescription
  skills: SectionData<AgentSkillSummary>
  tools: SectionData<AgentToolSummary>
  knowledge: SectionData<KnowledgeSource>
  modelLabel: string | null
  instructionFiles: InstructionFileRow[]
}

const EMPTY_SECTION = { error: false, value: [] }

const INITIAL_CAPABILITIES: AgentCapabilities = {
  status: "loading",
  describeError: false,
  skills: EMPTY_SECTION,
  tools: EMPTY_SECTION,
  knowledge: EMPTY_SECTION,
  modelLabel: null,
  instructionFiles: [],
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
    instructionFiles?: unknown
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
    instructionFiles: Array.isArray(record.instructionFiles)
      ? record.instructionFiles
          .filter((file): file is { path: string; name?: unknown } =>
            typeof (file as { path?: unknown })?.path === "string" && (file as { path: string }).path.length > 0)
          .map((file) => ({
            path: file.path,
            name: typeof file.name === "string" && file.name.trim() ? file.name.trim() : file.path,
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
 * Resolve the model shown in the Defaults section: the agent's pinned model when
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

/** A fence long enough to survive any fence already present in `body`. */
function codeFenceFor(body: string): string {
  const longest = [...body.matchAll(/^\s*(`{3,})/gm)]
    .reduce((max, match) => Math.max(max, match[1]?.length ?? 0), 0)
  return "`".repeat(Math.max(4, longest + 1))
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
    (_match, name: string, body: string) => {
      const trimmed = body.trim()
      const fence = codeFenceFor(trimmed)
      return `**Attached skill: /${name}**\n\n${fence}text\n${trimmed}\n${fence}`
    },
  )
}

/**
 * Heading + the ONE loading/empty/error spine every section shares. Sections
 * supply only what actually differs: their words and their list markup. Eight
 * hand-rolled copies of this spine had already drifted into three different
 * loading guards and three different error ternaries.
 */
function DetailSection({ id, title, hint, loading, empty, error, errorText, emptyText, children }: {
  id: string
  title: string
  hint?: string
  loading: boolean
  empty: boolean
  error?: boolean
  errorText?: string
  emptyText: string
  children: ReactNode
}) {
  return (
    <section aria-labelledby={id}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 id={id} className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{title}</h3>
        {hint ? <span className="shrink-0 text-[11px] text-muted-foreground/80">{hint}</span> : null}
      </div>
      {loading ? (
        <div aria-hidden="true" className="mt-3 animate-pulse border-y border-border/60 py-3">
          <div className="h-3.5 w-1/3 rounded bg-foreground/[0.08]" />
          <div className="mt-2 h-3 w-3/5 rounded bg-foreground/[0.06]" />
        </div>
      ) : empty ? (
        <p className="mt-3 border-y border-border/60 py-3 text-sm text-muted-foreground">
          {error && errorText ? errorText : emptyText}
        </p>
      ) : children}
    </section>
  )
}

/** Card list wrapper shared by Instructions / Knowledge / Skills. */
function CardRows({ rows }: { rows: readonly DetailRowModel[] }) {
  return <ul role="list" className="mt-3 grid gap-2">{rows.map((row) => <DetailRow key={row.key} row={row} />)}</ul>
}

/** Bordered list wrapper shared by Tools / MCP / Plugins. */
function DividedRows({ children }: { children: ReactNode }) {
  return <ul role="list" className="mt-3 divide-y divide-border/50 border-y border-border/60">{children}</ul>
}

export interface DetailRowModel {
  key: string
  title: string
  badge?: string
  blurb?: string
  /** Knowledge blurbs are single-line; instruction/skill blurbs wrap to two. */
  blurbTruncate?: boolean
  icon?: "file" | "book"
  /** Present ⇒ the row is a button that opens something. */
  onOpen?: () => void
  openAriaLabel?: string
  openTitle?: string
}

/**
 * The single card row used by Instructions, Knowledge and Skills. Owns
 * card-vs-div, the badge, the blurb and the trailing icon — the three
 * byte-identical copies this replaces had already started drifting apart.
 */
function DetailRow({ row }: { row: DetailRowModel }) {
  const Icon = row.icon === "book" ? BookOpen : FileText
  const body = (
    <div className="flex min-h-11 w-full items-start justify-between gap-3 px-3 py-2.5 sm:min-h-0">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="min-w-0 truncate text-sm font-medium leading-5 text-foreground">{row.title}</span>
          {row.badge ? (
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground">{row.badge}</span>
          ) : null}
        </div>
        {row.blurb ? (
          <p className={cn(
            "mt-1 text-xs leading-5 text-muted-foreground",
            row.blurbTruncate ? "truncate" : "line-clamp-2",
          )}>{row.blurb}</p>
        ) : null}
      </div>
      {row.icon && row.onOpen ? (
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground/70 transition-colors group-hover:text-foreground" strokeWidth={1.75} aria-hidden="true" />
      ) : null}
    </div>
  )
  return (
    <li className="min-w-0">
      {row.onOpen ? (
        <button
          type="button"
          onClick={row.onOpen}
          title={row.openTitle}
          aria-label={row.openAriaLabel}
          className="group block w-full rounded-xl border border-border/60 bg-card/70 text-left transition-colors hover:border-border hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          {body}
        </button>
      ) : (
        <div className="rounded-xl border border-border/60 bg-card/70">{body}</div>
      )}
    </li>
  )
}

/** Rough size past which the prompt preview clamps and offers the full text. */
const SYSTEM_PROMPT_PREVIEW_LIMIT = 280

export function AgentDetailsOverlay({
  agent,
  onClose,
  headerInsetStart = false,
  headerInsetEnd = false,
}: AgentDetailsOverlayProps) {
  const client = useOptionalWorkspacePluginClient()
  const [capabilities, setCapabilities] = useState<AgentCapabilities>(INITIAL_CAPABILITIES)
  const [promptExpanded, setPromptExpanded] = useState(false)
  const [expandedTool, setExpandedTool] = useState<string | null>(null)

  // Every commit is stamped with the generation that started it: switching
  // agents fast must never let a slow response for agent A land on agent B.
  const generationRef = useRef(0)
  useEffect(() => () => { generationRef.current += 1 }, [])

  const agentTypeId = agent.agentTypeId
  const load = useCallback(async () => {
    const generation = ++generationRef.current
    const isStale = () => generationRef.current !== generation
    if (!client) {
      // No API client in this embedding: sections fall back to quiet
      // empty states rather than spinners that never resolve.
      setCapabilities({ ...INITIAL_CAPABILITIES, status: "ready" })
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
      // One root listing (no 404 noise) tells us which workspace-level
      // instruction files exist. Per-agent instruction sources are NOT probed
      // for here: the Host reports them on /describe.
      client.getJson(`/api/v1/tree?path=.&filesystem=user`, { missingMessage: "Workspace files are unavailable." }),
    ])
    if (isStale()) return
    const rootFiles = new Set(
      rootTree.status === "fulfilled" && Array.isArray((rootTree.value as { entries?: unknown })?.entries)
        ? ((rootTree.value as { entries: Array<{ name?: unknown; kind?: unknown }> }).entries)
            .filter((entry) => entry?.kind === "file" && typeof entry.name === "string")
            .map((entry) => entry.name as string)
        : [],
    )
    const description = describe.status === "fulfilled" ? parseDescription(describe.value) : undefined
    const instructionFiles: InstructionFileRow[] = [
      ...(description?.instructionFiles ?? []).map((file) => ({
        path: file.path,
        name: file.name,
        blurb: "What this agent is asked to be and to do.",
      })),
      ...WORKSPACE_INSTRUCTION_FILES
        .filter((file) => rootFiles.has(file.path))
        .map((file) => ({ path: file.path, name: file.path, blurb: file.blurb, badge: file.badge })),
    ]
    setCapabilities({
      status: "ready",
      describeError: describe.status !== "fulfilled",
      ...(description ? { description } : {}),
      skills: { error: skills.status !== "fulfilled", value: skills.status === "fulfilled" ? parseSkills(skills.value) : [] },
      tools: { error: tools.status !== "fulfilled", value: tools.status === "fulfilled" ? parseTools(tools.value) : [] },
      knowledge: {
        error: filesystems.status !== "fulfilled",
        value: filesystems.status === "fulfilled" ? parseKnowledge(filesystems.value) : [],
      },
      modelLabel: models.status === "fulfilled"
        ? resolveModelLabel(models.value, description?.model ?? null)
        : description?.model ?? null,
      instructionFiles,
    })
  }, [agentTypeId, client])

  useEffect(() => {
    setPromptExpanded(false)
    setExpandedTool(null)
    void load()
  }, [load])

  const loading = capabilities.status === "loading"
  const description = capabilities.description
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

  const openComposedPrompt = useCallback(async () => {
    // The composed prompt is not an authored file; re-read the live
    // composition, materialize it into the workspace scratch area through the
    // existing files adapter, then open it through the single UI dispatch
    // path. The file is regenerated on every open so it always reflects the
    // current composition rather than a stale snapshot.
    if (!client || !systemPrompt) return
    const path = `.boring/agent-prompts/${agentTypeId}.md`
    // A failed re-read is NOT a user-facing failure: the cached prompt is a
    // perfectly good fallback, and reporting it as "couldn't open" would be a
    // lie about an open that then succeeds.
    let livePrompt = systemPrompt
    try {
      livePrompt = parseDescription(await client.getJson(
        `/api/v1/agents/${encodeURIComponent(agentTypeId)}/describe`,
        { missingMessage: "This agent's details are unavailable." },
      )).systemPrompt ?? systemPrompt
    } catch {
      // keep the cached prompt
    }
    try {
      await client.postJson("/api/v1/files", {
        path,
        filesystem: "user",
        // The files route creates the parent chain itself; a fresh workspace
        // without `.boring/` must not silently fail the write.
        createDirs: true,
        content: `# ${agent.label} — composed system prompt\n\n> Read-only generated view. Regenerated from the live composition each time it is opened from Agent details — edits here have no effect.\n\n${formatComposedPromptMarkdown(livePrompt)}\n`,
        returnMtimeMs: false,
      })
      postUiCommand({ kind: "openFile", params: { filesystem: "user", path, mode: "view" } })
    } catch {
      postUiCommand({ kind: "showNotification", params: { msg: "Couldn't open the composed prompt.", level: "error" } })
    }
  }, [agent.label, agentTypeId, client, systemPrompt])

  // Plain derivations, not memos: these are cheap object maps feeding an
  // unmemoized row component, so a useMemo here would only buy ceremony.
  const instructionRows: DetailRowModel[] = capabilities.instructionFiles.map((file) => ({
    key: file.path,
    title: file.name,
    ...(file.badge ? { badge: file.badge } : {}),
    blurb: file.blurb,
    icon: "file" as const,
    onOpen: () => openInstructionFile(file.path),
    openAriaLabel: `Open ${file.name}`,
    openTitle: `Open ${file.path}`,
  }))

  const knowledgeRows: DetailRowModel[] = capabilities.knowledge.value.map((source) => ({
    key: source.filesystem,
    title: source.label,
    ...(source.access === "readonly" ? { badge: "read-only" } : {}),
    blurb: `Files this agent can ${source.access === "readonly" ? "read" : "read and edit"}.`,
    blurbTruncate: true,
    icon: "book" as const,
    // Reveal the mounted filesystem in the workbench file tree.
    onOpen: () => postUiCommand({
      kind: "expandToFile",
      params: { filesystem: source.filesystem, path: source.rootDir && source.rootDir !== "." ? source.rootDir : "" },
    }),
    openAriaLabel: `Browse ${source.label} files`,
    openTitle: `Browse ${source.label}`,
  }))

  const skillRows: DetailRowModel[] = capabilities.skills.value.map((skill, index) => {
    const resource = openableSkillResource(skill)
    const badge = skillSourceLabel(skill.source)
    return {
      key: skill.resource ? uiFileResourceKey(skill.resource) : `${skill.name}\0${index}`,
      title: `/${skill.name}`,
      ...(badge ? { badge } : {}),
      ...(skill.description ? { blurb: skill.description } : {}),
      icon: "file" as const,
      ...(resource ? {
        onOpen: () => postUiCommand({ kind: "openFile", params: { ...resource, mode: "view" } }),
        openAriaLabel: `Open skill ${skill.name}`,
        openTitle: "Open this skill",
      } : {}),
    }
  })

  const skillCount = loading ? undefined : capabilities.skills.value.length
  const toolCount = loading ? undefined : capabilities.tools.value.length

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
        actions={(
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
        )}
      >
        <div className="boring-scrollbar-discreet min-h-0 flex-1 overflow-y-auto p-4">
          <div className="grid max-w-3xl gap-7">
            <DetailSection
              id="agent-instructions-heading" title="Instructions"
              loading={loading && instructionRows.length === 0} empty={instructionRows.length === 0}
              emptyText="No workspace instruction files."
            >
              <CardRows rows={instructionRows} />
            </DetailSection>

            <DetailSection
              id="agent-knowledge-heading" title="Knowledge"
              hint={knowledgeRows.length > 1 ? `${knowledgeRows.length}` : undefined}
              loading={loading} empty={knowledgeRows.length === 0}
              error={capabilities.knowledge.error} errorText="Knowledge sources couldn't be loaded."
              emptyText="No knowledge sources."
            >
              <CardRows rows={knowledgeRows} />
            </DetailSection>

            <DetailSection
              id="agent-skills-heading" title="Skills"
              hint={skillCount ? `${skillCount}` : undefined}
              loading={loading} empty={skillRows.length === 0}
              error={capabilities.skills.error} errorText="Skills couldn't be loaded."
              emptyText="No skills."
            >
              <CardRows rows={skillRows} />
            </DetailSection>

            <DetailSection
              id="agent-tools-heading" title="Tools"
              hint={toolCount ? `${toolCount}` : undefined}
              loading={loading} empty={capabilities.tools.value.length === 0}
              error={capabilities.tools.error} errorText="Tools couldn't be loaded."
              emptyText="No tools."
            >
              <DividedRows>
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
              </DividedRows>
            </DetailSection>

            <DetailSection
              id="agent-mcp-heading" title="MCP access"
              loading={loading} empty={!description || description.mcpServers.length === 0}
              error={capabilities.describeError} errorText="MCP access couldn't be loaded."
              emptyText="No MCP servers connected."
            >
              <DividedRows>
                {(description?.mcpServers ?? []).map((server) => (
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
              </DividedRows>
            </DetailSection>

            <DetailSection
              id="agent-plugins-heading" title="Plugins"
              loading={loading && pluginIds.length === 0} empty={pluginIds.length === 0}
              emptyText="No plugins."
            >
              <DividedRows>
                {pluginIds.map((pluginId) => (
                  <li key={pluginId} className="flex min-h-11 items-center justify-between gap-3 py-2.5 sm:min-h-0">
                    <span className="min-w-0 truncate text-sm font-medium text-foreground">{pluginId}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">Enabled</span>
                  </li>
                ))}
              </DividedRows>
            </DetailSection>

            <DetailSection
              id="agent-system-prompt-heading" title="System prompt"
              loading={loading} empty={!promptText}
              error={capabilities.describeError} errorText="The system prompt couldn't be loaded."
              emptyText="This agent uses the default instructions."
            >
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
            </DetailSection>

            <DetailSection
              id="agent-defaults-heading" title="Defaults"
              loading={loading} empty={!capabilities.modelLabel}
              emptyText="Uses the host default model."
            >
              <dl className="mt-3 divide-y divide-border/50 border-y border-border/60">
                <div className="flex min-h-11 items-baseline justify-between gap-3 py-2.5 sm:min-h-0">
                  <dt className="text-sm text-muted-foreground">Default model</dt>
                  <dd className="min-w-0 truncate text-sm font-medium text-foreground">{capabilities.modelLabel}</dd>
                </div>
              </dl>
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
