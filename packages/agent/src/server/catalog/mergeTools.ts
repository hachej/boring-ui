import { ErrorCode, type ErrorCode as AgentErrorCode } from '../../shared/error-codes'
import {
  DEFAULT_TOOL_TRUST_LEVEL,
  type AgentTool,
  type CatalogTool,
  type ToolReadinessRequirement,
  type ToolTrustLevel,
} from '../../shared/tool'
import {
  withReadinessRequirements,
  wrapToolForReadiness,
  type ToolReadinessCheck,
} from '@hachej/boring-bash/agent'

export interface PluginToolRegistration {
  pluginName: string
  tools: AgentTool[]
  /**
   * Host-declared trust level for every tool in this registration. Declared by
   * the host that composes the catalog, never by the tool or its bundle.
   * Defaults to `trusted` to preserve first-party behavior; tenant/custom
   * bundles are registered as `untrusted`.
   */
  trust?: ToolTrustLevel
}

export interface ToolCollisionLogger {
  warn: (message: string) => void
}

export type ToolCollisionPolicy = 'last-wins' | 'error'

export class ToolCatalogCollisionError extends Error {
  readonly code: Extract<AgentErrorCode, 'AUTHORED_AGENT_TOOL_COLLISION'>
  readonly field = 'tools'

  constructor() {
    super('tool name collision is not allowed by this catalog policy')
    this.name = 'ToolCatalogCollisionError'
    this.code = ErrorCode.enum.AUTHORED_AGENT_TOOL_COLLISION
  }
}

export interface MergeToolsOptions {
  standardTools: AgentTool[]
  extraTools?: AgentTool[]
  pluginTools?: PluginToolRegistration[]
  logger?: ToolCollisionLogger
  checkReadiness?: ToolReadinessCheck
  collisionPolicy?: ToolCollisionPolicy
}

interface TrustedEntry {
  tool: AgentTool
  trust: ToolTrustLevel
}

function setLastRegistered(
  merged: Map<string, TrustedEntry>,
  tool: AgentTool,
  trust: ToolTrustLevel,
): void {
  merged.delete(tool.name)
  merged.set(tool.name, { tool, trust })
}

function assertNoToolCollisions(options: MergeToolsOptions): void {
  const seen = new Set<string>()
  const inspect = (tool: AgentTool): void => {
    if (seen.has(tool.name)) throw new ToolCatalogCollisionError()
    seen.add(tool.name)
  }

  for (const tool of options.standardTools) inspect(tool)
  for (const tool of options.extraTools ?? []) inspect(tool)
  for (const plugin of options.pluginTools ?? []) {
    for (const tool of plugin.tools) inspect(tool)
  }
}

/**
 * Compose the host's trust-annotated tool catalog.
 *
 * Trust is host-assigned at this catalog-construction seam: standard and extra
 * tools are first-party `trusted`; plugin registrations carry their
 * host-declared trust (default `trusted`). A tool object can never make itself
 * trusted — the level comes only from the registration the host supplies here.
 *
 * The returned {@link CatalogTool} entries carry the resolved trust level.
 * Trust routing (trusted → in-process, untrusted → stubbed sandbox seam) is
 * applied downstream by `routeCatalogForDispatch`, keeping this function a pure
 * composition step.
 */
export function mergeTools(options: MergeToolsOptions): CatalogTool[] {
  if (options.collisionPolicy === 'error') assertNoToolCollisions(options)

  const merged = new Map<string, TrustedEntry>()

  for (const tool of options.standardTools) {
    setLastRegistered(merged, tool, DEFAULT_TOOL_TRUST_LEVEL)
  }

  for (const tool of options.extraTools ?? []) {
    if (merged.has(tool.name)) {
      options.logger?.warn(
        `[catalog] Tool "${tool.name}" overridden by extraTools`,
      )
    }
    setLastRegistered(merged, tool, DEFAULT_TOOL_TRUST_LEVEL)
  }

  for (const plugin of options.pluginTools ?? []) {
    const trust = plugin.trust ?? DEFAULT_TOOL_TRUST_LEVEL
    for (const tool of plugin.tools) {
      if (merged.has(tool.name)) {
        options.logger?.warn(
          `[catalog] Tool "${tool.name}" overridden by plugin ${plugin.pluginName}`,
        )
      }
      const pluginTool = tool.readinessRequirements === undefined
        ? withReadinessRequirements(tool, ['workspace-fs'] satisfies ToolReadinessRequirement[])
        : tool
      setLastRegistered(merged, pluginTool, trust)
    }
  }

  return [...merged.values()].map((entry) => ({
    trust: entry.trust,
    tool: wrapToolForReadiness(entry.tool, options.checkReadiness),
  }))
}
