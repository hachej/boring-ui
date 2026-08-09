"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Bot, ChevronDown, ExternalLink, X } from "lucide-react"
import { IconButton } from "@hachej/boring-ui-kit"
import { cn } from "../../lib/utils"
import { postUiCommand } from "../../bridge"
import { ManagementOverlaySurface } from "../management/ManagementOverlaySurface"
import { useOptionalWorkspacePluginClient } from "../../plugin/useWorkspacePluginClient"
import { uiFileResourceKey } from "../../../shared/types/filesystem"
import { openableFileResource } from "../../../shared/skills/openableFileResource"
import { CardRows, DetailSection, DividedRows, MetaRow, type DetailRowModel } from "./detailSections"
import {
  INITIAL_CAPABILITIES,
  WORKSPACE_INSTRUCTION_FILES,
  formatComposedPromptMarkdown,
  loadAgentCapabilities,
  normalizePromptText,
  readLiveSystemPrompt,
  skillSourceLabel,
  type AgentCapabilities,
} from "./agentCapabilities"

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

/** Rough size past which the prompt preview clamps and offers the full text. */
const SYSTEM_PROMPT_PREVIEW_LIMIT = 280

/** User-facing words for a `role` discriminator the server sends. */
const INSTRUCTION_ROLE_COPY = {
  persona: { name: "Persona instructions", blurb: "What this agent is asked to be and to do." },
} as const

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
    if (!client) {
      // No API client in this embedding: sections fall back to quiet
      // empty states rather than spinners that never resolve.
      setCapabilities({ ...INITIAL_CAPABILITIES, status: "ready" })
      return
    }
    setCapabilities(INITIAL_CAPABILITIES)
    const next = await loadAgentCapabilities(client, agentTypeId)
    if (generationRef.current !== generation) return
    setCapabilities(next)
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
  // Plugin ids are the fleet list's fact; /describe deliberately does not
  // restate them in a second shape.
  const pluginIds = agent.pluginIds ?? []

  const openFile = useCallback((resource: { filesystem: string; path: string }) => {
    postUiCommand({ kind: "openFile", params: { ...resource, mode: "view" } })
  }, [])

  const openComposedPrompt = useCallback(async () => {
    // The composed prompt is not an authored file; re-read the live
    // composition, materialize it into the workspace scratch area through the
    // existing files adapter, then open it through the single UI dispatch
    // path. The file is regenerated on every open so it always reflects the
    // current composition rather than a stale snapshot.
    if (!client || !systemPrompt) return
    const path = `.boring/agent-prompts/${agentTypeId}.md`
    // Same generation guard as the panel load: the re-read is a round trip, so
    // switching agents mid-flight would otherwise write and open the PREVIOUS
    // agent's prompt.
    const generation = generationRef.current
    const livePrompt = await readLiveSystemPrompt(client, agentTypeId, systemPrompt)
    if (generationRef.current !== generation) return
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

  // Server-reported instruction files go through the SAME open guard as
  // skills; a ref the guard rejects renders as a plain, unopenable row.
  const instructionRows: DetailRowModel[] = [
    ...capabilities.instructionFiles.map((file) => {
      const resource = openableFileResource(file.resource)
      const copy = INSTRUCTION_ROLE_COPY[file.role]
      return {
        key: uiFileResourceKey(file.resource),
        title: copy.name,
        // An inert card with no explanation reads as a rendering bug. Say
        // what happened instead of showing a row that just doesn't respond.
        blurb: resource ? copy.blurb : `${copy.blurb} This file can't be opened from here — its recorded location is not a valid workspace path.`,
        ...(resource ? { badge: undefined } : { badge: "unavailable" }),
        icon: "file" as const,
        ...(resource ? {
          onOpen: () => openFile(resource),
          openAriaLabel: `Open ${copy.name}`,
          openTitle: `Open ${resource.path}`,
        } : {}),
      }
    }),
    ...WORKSPACE_INSTRUCTION_FILES
      .filter((file) => capabilities.workspaceInstructionFiles.includes(file.path))
      .map((file) => ({
        key: file.path,
        title: file.path,
        badge: file.badge,
        blurb: file.blurb,
        icon: "file" as const,
        onOpen: () => openFile({ filesystem: "user", path: file.path }),
        openAriaLabel: `Open ${file.path}`,
        openTitle: `Open ${file.path}`,
      })),
  ]

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
    const resource = openableFileResource(skill.resource)
    const badge = skillSourceLabel(skill.source)
    return {
      key: skill.resource ? uiFileResourceKey(skill.resource) : `${skill.name}\0${index}`,
      title: `/${skill.name}`,
      ...(badge ? { badge } : {}),
      ...(skill.description ? { blurb: skill.description } : {}),
      icon: "file" as const,
      ...(resource ? {
        onOpen: () => openFile(resource),
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
              loading={loading} empty={instructionRows.length === 0}
              // Without this the section claims the agent HAS no instructions
              // when the truth is that we failed to ask.
              error={capabilities.describeError} errorText="Instructions couldn't be loaded."
              emptyText="No instruction files."
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
                {capabilities.tools.value.map((tool, index) => {
                  // The server may report duplicate names; a name-only key
                  // collides AND makes both rows expand together.
                  const toolKey = `${tool.name}\u0000${index}`
                  const expanded = expandedTool === toolKey
                  return (
                    <li key={toolKey} className="min-w-0">
                      <button
                        type="button"
                        onClick={() => setExpandedTool((current) => current === toolKey ? null : toolKey)}
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
                {(description?.mcpServers ?? []).map((server, index) => (
                  <MetaRow
                    key={`${server.id}\u0000${index}`}
                    title={server.id}
                    meta={server.tools.length === 1 ? "1 tool" : `${server.tools.length} tools`}
                    {...(server.tools.length > 0 ? { detail: server.tools.join(", ") } : {})}
                  />
                ))}
              </DividedRows>
            </DetailSection>

            <DetailSection
              id="agent-plugins-heading" title="Plugins"
              loading={loading && pluginIds.length === 0} empty={pluginIds.length === 0}
              emptyText="No plugins."
            >
              <DividedRows>
                {pluginIds.map((pluginId, index) => <MetaRow key={`${pluginId}\u0000${index}`} title={pluginId} meta="Enabled" />)}
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
