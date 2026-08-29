"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Bot, ChevronDown, RefreshCw, X } from "lucide-react"
import { IconButton } from "@hachej/boring-ui-kit"
import { cn } from "../../lib/utils"
import { postUiCommand } from "../../bridge"
import { ManagementOverlaySurface } from "../management/ManagementOverlaySurface"
import { useOptionalWorkspacePluginClient } from "../../plugin/useWorkspacePluginClient"
import { uiFileResourceKey, type UiFileResource } from "../../../shared/types/filesystem"
import { openableFileResource } from "../../../shared/skills/openableFileResource"
import { CardRows, DetailSection, DividedRows, MetaRow, type DetailRowModel } from "./detailSections"
import {
  INITIAL_CAPABILITIES,
  UNAVAILABLE_CAPABILITIES,
  fileResourceExists,
  loadAgentCapabilities,
  skillSourceLabel,
  type AgentCapabilities,
} from "./agentCapabilities"

export interface AgentDetailsOverlayAgent {
  agentTypeId: string
  label: string
  description?: string
  pluginIds?: readonly string[]
}

export interface AgentDetailsOverlayProps {
  agent: AgentDetailsOverlayAgent
  onClose: () => void
  /**
   * Reload this agent's composition (the `agent.reload` host effect). The host
   * owns the request; this overlay owns only the chrome. Absent ⇒ the host
   * cannot reload agents here, and the action is not rendered at all: a
   * permanently dead control teaches the user nothing.
   *
   * Resolves with the host's own message when it has one, and REJECTS on
   * failure — the overlay reports either outcome.
   */
  onReloadAgent?: (agentTypeId: string) => Promise<string | undefined | void>
  headerInsetStart?: boolean
  headerInsetEnd?: boolean
}

/** User-facing words for a `role` discriminator the server sends. */
const INSTRUCTION_ROLE_COPY = {
  persona: { name: "Persona instructions", blurb: "What this agent is asked to be and to do." },
} as const

/**
 * Runtime-scope pin semantics, said in user words: a reload recompiles the
 * agent, but chats already running keep the composition they were pinned to.
 */
const RELOADED_MESSAGE = "Agent reloaded. New chats use the updated instructions; chats already open keep the composition they started with."

export function AgentDetailsOverlay({
  agent,
  onClose,
  onReloadAgent,
  headerInsetStart = false,
  headerInsetEnd = false,
}: AgentDetailsOverlayProps) {
  const client = useOptionalWorkspacePluginClient()
  const [capabilities, setCapabilities] = useState<AgentCapabilities>(INITIAL_CAPABILITIES)
  const [expandedTool, setExpandedTool] = useState<string | null>(null)
  // Refs whose file turned out not to exist when the user clicked them. Keyed
  // by resource so the row that failed — and only that row — degrades.
  const [missingResourceKeys, setMissingResourceKeys] = useState<ReadonlySet<string>>(() => new Set())
  const [reloading, setReloading] = useState(false)

  // Every commit is stamped with the generation that started it: switching
  // agents fast must never let a slow response for agent A land on agent B.
  const generationRef = useRef(0)
  useEffect(() => () => { generationRef.current += 1 }, [])

  const agentTypeId = agent.agentTypeId
  const load = useCallback(async () => {
    const generation = ++generationRef.current
    if (!client) {
      setCapabilities(UNAVAILABLE_CAPABILITIES)
      return
    }
    setCapabilities(INITIAL_CAPABILITIES)
    const next = await loadAgentCapabilities(client, agentTypeId)
    if (generationRef.current !== generation) return
    setCapabilities(next)
  }, [agentTypeId, client])

  useEffect(() => {
    setExpandedTool(null)
    setMissingResourceKeys(new Set())
    setReloading(false)
    void load()
  }, [load])

  /**
   * Persona instructions are compiled into the composition at host load and
   * only refresh through the `agent.reload` host effect — there is no watcher.
   * Editing `instructions.md` from THIS page and seeing nothing happen is the
   * failure this action removes.
   */
  const reloadAgent = useCallback(async () => {
    if (!onReloadAgent) return
    // Invalidate any in-flight load: it describes the composition the host is
    // in the middle of replacing, so it must not commit on top of the reload.
    const generation = ++generationRef.current
    setReloading(true)
    let message: string | undefined
    let failure: string | undefined
    try {
      message = (await onReloadAgent(agentTypeId)) || undefined
    } catch (error) {
      failure = error instanceof Error ? error.message : "Agent reload failed."
    }
    // A newer generation means the panel moved on (agent switch or unmount):
    // neither the toast nor the refresh belongs to this panel any more.
    if (generationRef.current !== generation) return
    setReloading(false)
    postUiCommand({
      kind: "showNotification",
      params: { msg: failure ?? message ?? RELOADED_MESSAGE, level: failure ? "error" : "info" },
    })
    // Only a reload that actually landed changes what this page should show.
    if (!failure) await load()
  }, [agentTypeId, load, onReloadAgent])

  const loading = capabilities.status === "loading"
  const description = capabilities.description.status === "loaded"
    ? capabilities.description.value
    : undefined
  // Plugin ids are the fleet list's fact; /describe deliberately does not
  // restate them in a second shape.
  const pluginIds = agent.pluginIds ?? []

  /**
   * Open a server-reported file, or say why it can't be opened.
   *
   * A ref the path guard ACCEPTS can still address a file that isn't there
   * (personas ship in the app image; `user` serves the workspace). That used to
   * 404 inside the viewer with no toast and no state change — the user clicked a
   * healthy link and nothing at all happened. Probe first, and on failure both
   * name the missing path AND remember it, so the row stops pretending to be a
   * link instead of failing the same way on the next click.
   */
  const openFile = useCallback(async (resource: UiFileResource, label: string) => {
    if (client) {
      // Same generation guard the panel load uses: the probe is a round trip,
      // so switching agents mid-flight must not open the PREVIOUS agent's file
      // or mark a row on a panel that is no longer on screen.
      const generation = generationRef.current
      const probe = await fileResourceExists(client, resource)
      if (generationRef.current !== generation) return
      if (probe.status === "missing") {
        setMissingResourceKeys((current) => new Set(current).add(uiFileResourceKey(resource)))
        postUiCommand({
          kind: "showNotification",
          params: { msg: `${label} isn't in this workspace (${resource.path}).`, level: "error" },
        })
        return
      }
      if (probe.status === "error") {
        postUiCommand({
          kind: "showNotification",
          params: { msg: `${label} couldn't be checked right now (${resource.path}). Try again.`, level: "error" },
        })
        return
      }
    }
    postUiCommand({ kind: "openFile", params: { ...resource, mode: "view" } })
  }, [client])

  // Server-reported instruction files go through the SAME open guard as
  // skills; a ref the guard rejects renders as a plain, unopenable row.
  // Every list in this overlay tiebreaks its key with the row's index, because
  // the host can report the same file, filesystem or skill twice. Without it
  // React reconciles by a key two rows share and a badge lands on the wrong
  // row — an "unavailable" mark on a file that is actually there, for instance.
  const instructionRows: DetailRowModel[] = [
    ...(description?.instructionFiles ?? []).map((file, index) => {
      const guarded = openableFileResource(file.resource)
      // Two different unopenable states, two different truths to tell: the
      // guard rejected the location, or the location is fine but nothing is
      // there. Collapsing them into one message sends operators hunting for a
      // path problem that doesn't exist.
      const missing = Boolean(guarded && missingResourceKeys.has(uiFileResourceKey(guarded)))
      const resource = missing ? undefined : guarded
      const copy = INSTRUCTION_ROLE_COPY[file.role]
      return {
        key: `agent\u0000${uiFileResourceKey(file.resource)}\u0000${index}`,
        title: copy.name,
        // An inert card with no explanation reads as a rendering bug. Say
        // what happened instead of showing a row that just doesn't respond.
        blurb: resource
          ? copy.blurb
          : missing
          ? `${copy.blurb} This file isn't in this workspace — ${file.resource.path} was not found.`
          : `${copy.blurb} This file can't be opened from here — its recorded location is not a valid workspace path.`,
        ...(resource ? { badge: undefined } : { badge: "unavailable" }),
        icon: "file" as const,
        ...(resource ? {
          onOpen: () => void openFile(resource, copy.name),
          openAriaLabel: `Open ${copy.name}`,
          openTitle: `Open ${resource.path}`,
        } : {}),
      }
    }),
  ]

  const skills = capabilities.skills.status === "loaded" ? capabilities.skills.value : []
  const tools = capabilities.tools.status === "loaded" ? capabilities.tools.value : []
  const skillRows: DetailRowModel[] = skills.map((skill, index) => {
    const guarded = openableFileResource(skill.resource)
    // Skill files are exposed to exactly the same "well-formed ref, absent
    // file" case as instructions, so they degrade through the same state.
    const missing = Boolean(guarded && missingResourceKeys.has(uiFileResourceKey(guarded)))
    const resource = missing ? undefined : guarded
    const badge = missing ? "unavailable" : skillSourceLabel(skill.source)
    return {
      key: `${skill.resource ? uiFileResourceKey(skill.resource) : skill.name}\u0000${index}`,
      title: `/${skill.name}`,
      ...(badge ? { badge } : {}),
      ...(missing
        ? { blurb: `${skill.description ? `${skill.description} ` : ""}This skill's file isn't in this workspace — ${skill.resource?.path ?? "its file"} was not found.` }
        : skill.description ? { blurb: skill.description } : {}),
      icon: "file" as const,
      ...(resource ? {
        onOpen: () => void openFile(resource, `/${skill.name}`),
        openAriaLabel: `Open skill ${skill.name}`,
        openTitle: "Open this skill",
      } : {}),
    }
  })

  const skillCount = loading ? undefined : skills.length
  const toolCount = loading ? undefined : tools.length

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
          {onReloadAgent ? (
            <IconButton
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => void reloadAgent()}
              disabled={reloading || loading}
              aria-label={`Reload ${agent.label}`}
              title="Reload agent"
              className="text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className={cn("size-3", (reloading || loading) && "animate-spin")} strokeWidth={1.75} />
            </IconButton>
          ) : null}
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
            <DetailSection
              id="agent-instructions-heading" title="Instructions"
              loading={loading} empty={instructionRows.length === 0}
              // Without this the section claims the agent HAS no instructions
              // when the truth is that we failed to ask.
              error={capabilities.description.status === "error"}
              errorText="Instructions couldn't be fully loaded."
              emptyText="No instruction files."
            >
              <CardRows rows={instructionRows} />
            </DetailSection>

            <DetailSection
              id="agent-skills-heading" title="Skills"
              hint={skillCount ? `${skillCount}` : undefined}
              loading={loading} empty={skillRows.length === 0}
              error={capabilities.skills.status === "error"} errorText="Skills couldn't be loaded."
              emptyText="No skills."
            >
              <CardRows rows={skillRows} />
            </DetailSection>

            <DetailSection
              id="agent-tools-heading" title="Tools"
              hint={toolCount ? `${toolCount}` : undefined}
              loading={loading} empty={tools.length === 0}
              error={capabilities.tools.status === "error"} errorText="Tools couldn't be loaded."
              emptyText="No tools."
            >
              <DividedRows>
                {tools.map((tool, index) => {
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
              error={capabilities.description.status === "error"} errorText="MCP access couldn't be loaded."
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
              id="agent-defaults-heading" title="Defaults"
              loading={loading}
              empty={capabilities.modelLabel.status === "error" || !capabilities.modelLabel.value}
              error={capabilities.modelLabel.status === "error"} errorText="Defaults couldn't be loaded."
              emptyText="Uses the host default model."
            >
              <dl className="mt-3 divide-y divide-border/50 border-y border-border/60">
                <div className="flex min-h-11 items-baseline justify-between gap-3 py-2.5 sm:min-h-0">
                  <dt className="text-sm text-muted-foreground">Default model</dt>
                  <dd className="min-w-0 truncate text-sm font-medium text-foreground">
                    {capabilities.modelLabel.status === "loaded" ? capabilities.modelLabel.value : null}
                  </dd>
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
