import type { Plugin, CatalogConfig, PluginOutput, LeftTabOutput, AgentTool } from "./types"
import type { CommandConfig, PanelConfig } from "../types/panel"

export type PluginErrorKind =
  | "validation"
  | "duplicate-id"
  | "mount"
  | "contribution"

export class PluginError extends Error {
  constructor(
    public readonly kind: PluginErrorKind,
    message: string,
  ) {
    super(message)
  }
}

const VALID_PLACEMENTS = new Set([
  "left",
  "center",
  "right",
  "bottom",
  "left-tab",
  "right-tab",
])
const VALID_OUTPUT_TYPES = new Set([
  "left-tab",
  "panel",
  "command",
  "catalog",
  "binding",
  "provider",
  "surface-resolver",
  "agent-tool",
])

function fail(pluginId: string, msg: string): never {
  throw new PluginError("validation", `plugin "${pluginId}": ${msg}`)
}

function validatePanels(pluginId: string, panels: PanelConfig[]): void {
  const ids = new Set<string>()
  for (let i = 0; i < panels.length; i++) {
    const p = panels[i]
    if (!p.id || typeof p.id !== "string") {
      fail(pluginId, `panels[${i}].id must be a non-empty string`)
    }
    if (ids.has(p.id)) {
      fail(pluginId, `panels[${i}].id "${p.id}" is duplicated within this plugin`)
    }
    ids.add(p.id)
    if (p.placement && !VALID_PLACEMENTS.has(p.placement)) {
      fail(
        pluginId,
        `panels[${i}].placement must be one of ${[...VALID_PLACEMENTS].join(", ")} (got: "${p.placement}")`,
      )
    }
    if (p.lazy) {
      if (typeof p.component !== "function") {
        fail(
          pluginId,
          `panels[${i}].component must be a thunk when lazy:true (got: ${typeof p.component})`,
        )
      }
    } else {
      if (typeof p.component !== "function") {
        fail(
          pluginId,
          `panels[${i}].component must be a ComponentType (got: ${typeof p.component})`,
        )
      }
    }
  }
}

function validateCommands(pluginId: string, commands: CommandConfig[]): void {
  const ids = new Set<string>()
  for (let i = 0; i < commands.length; i++) {
    const c = commands[i]
    if (!c.id || typeof c.id !== "string") {
      fail(pluginId, `commands[${i}].id must be a non-empty string`)
    }
    if (ids.has(c.id)) {
      fail(pluginId, `commands[${i}].id "${c.id}" is duplicated within this plugin`)
    }
    ids.add(c.id)
    if (typeof c.run !== "function") {
      fail(
        pluginId,
        `commands[${i}].run must be a function (got: ${typeof c.run})`,
      )
    }
    if (c.keywords !== undefined) {
      if (!Array.isArray(c.keywords)) {
        fail(pluginId, `commands[${i}].keywords must be an array when provided`)
      }
      for (let j = 0; j < c.keywords.length; j++) {
        if (!c.keywords[j] || typeof c.keywords[j] !== "string") {
          fail(
            pluginId,
            `commands[${i}].keywords[${j}] must be a non-empty string`,
          )
        }
      }
    }
  }
}

function validateCatalogs(pluginId: string, catalogs: CatalogConfig[]): void {
  const ids = new Set<string>()
  for (let i = 0; i < catalogs.length; i++) {
    const cat = catalogs[i]
    if (!cat.id || typeof cat.id !== "string") {
      fail(pluginId, `catalogs[${i}].id must be a non-empty string`)
    }
    if (ids.has(cat.id)) {
      fail(pluginId, `catalogs[${i}].id "${cat.id}" is duplicated within this plugin`)
    }
    ids.add(cat.id)
    if (
      !cat.adapter ||
      typeof cat.adapter !== "object" ||
      typeof cat.adapter.search !== "function"
    ) {
      fail(
        pluginId,
        `catalogs[${i}].adapter.search must be a function (got: ${typeof cat.adapter?.search})`,
      )
    }
    if (typeof cat.onSelect !== "function") {
      fail(
        pluginId,
        `catalogs[${i}].onSelect must be a function (got: ${typeof cat.onSelect})`,
      )
    }
  }
}

function validateAgentTools(pluginId: string, tools: unknown[]): void {
  for (let i = 0; i < tools.length; i++) {
    const valid = validateAgentTool(tools[i])
    if (!valid) {
      fail(
        pluginId,
        `agentTools[${i}] is not a valid AgentTool (missing required fields: name, description, parameters, execute)`,
      )
    }
  }
}

function validateAgentTool(tool: unknown): AgentTool | null {
  if (!tool || typeof tool !== "object") return null
  const candidate = tool as Record<string, unknown>
  if (typeof candidate.name !== "string" || candidate.name.length === 0) return null
  if (typeof candidate.description !== "string") return null
  if (!candidate.parameters || typeof candidate.parameters !== "object") return null
  if (typeof candidate.execute !== "function") return null
  return candidate as unknown as AgentTool
}

function validateBindings(pluginId: string, bindings: unknown[]): void {
  for (let i = 0; i < bindings.length; i++) {
    if (typeof bindings[i] !== "function") {
      fail(pluginId, `bindings[${i}] must be a component function (got: ${typeof bindings[i]})`)
    }
  }
}

function validateSurfaceResolverOutput(
  pluginId: string,
  output: Extract<PluginOutput, { type: "surface-resolver" }>,
  index: number,
): void {
  const resolver = output.resolver
  if (!resolver || typeof resolver !== "object") {
    fail(pluginId, `outputs[${index}].resolver must be an object`)
  }
  if (!resolver.id || typeof resolver.id !== "string") {
    fail(pluginId, `outputs[${index}].resolver.id must be a non-empty string`)
  }
  if (typeof resolver.resolve !== "function") {
    fail(pluginId, `outputs[${index}].resolver.resolve must be a function`)
  }
}

function validateLeftTabOutput(
  pluginId: string,
  output: LeftTabOutput,
  index: number,
): void {
  if (!output.id || typeof output.id !== "string") {
    fail(pluginId, `outputs[${index}].id must be a non-empty string`)
  }
  if (!output.title || typeof output.title !== "string") {
    fail(pluginId, `outputs[${index}].title must be a non-empty string`)
  }
  if (output.lazy) {
    if (typeof output.component !== "function") {
      fail(
        pluginId,
        `outputs[${index}].component must be a thunk when lazy:true (got: ${typeof output.component})`,
      )
    }
  } else if (typeof output.component !== "function") {
    fail(
      pluginId,
      `outputs[${index}].component must be a ComponentType (got: ${typeof output.component})`,
    )
  }
}

function outputIdentity(output: PluginOutput, index: number): string {
  switch (output.type) {
    case "left-tab":
      return `${output.type}:${output.id}`
    case "panel":
      return `${output.type}:${output.panel?.id ?? `<missing:${index}>`}`
    case "command":
      return `${output.type}:${output.command?.id ?? `<missing:${index}>`}`
    case "catalog":
      return `${output.type}:${output.catalog?.id ?? `<missing:${index}>`}`
    case "binding":
    case "provider":
      return `${output.type}:${output.id}`
    case "surface-resolver":
      return `${output.type}:${output.resolver?.id ?? `<missing:${index}>`}`
    case "agent-tool":
      return `${output.type}:${output.id}`
    default:
      return `<unknown:${index}>`
  }
}

function validateOutputs(pluginId: string, outputs: PluginOutput[]): void {
  const ids = new Set<string>()
  for (let i = 0; i < outputs.length; i++) {
    const output = outputs[i] as PluginOutput | undefined
    if (!output || typeof output !== "object") {
      fail(pluginId, `outputs[${i}] must be an object`)
    }
    if (!VALID_OUTPUT_TYPES.has(output.type)) {
      fail(
        pluginId,
        `outputs[${i}].type must be one of ${[...VALID_OUTPUT_TYPES].join(", ")} (got: "${(output as { type?: unknown }).type}")`,
      )
    }
    const identity = outputIdentity(output, i)
    if (ids.has(identity)) {
      fail(pluginId, `outputs[${i}] "${identity}" is duplicated within this plugin`)
    }
    ids.add(identity)

    switch (output.type) {
      case "left-tab":
        validateLeftTabOutput(pluginId, output, i)
        break
      case "panel":
        if (!output.panel || typeof output.panel !== "object") {
          fail(pluginId, `outputs[${i}].panel must be an object`)
        }
        validatePanels(pluginId, [output.panel])
        break
      case "command":
        if (!output.command || typeof output.command !== "object") {
          fail(pluginId, `outputs[${i}].command must be an object`)
        }
        validateCommands(pluginId, [output.command])
        break
      case "catalog":
        if (!output.catalog || typeof output.catalog !== "object") {
          fail(pluginId, `outputs[${i}].catalog must be an object`)
        }
        validateCatalogs(pluginId, [output.catalog])
        break
      case "binding":
        if (!output.id || typeof output.id !== "string") {
          fail(pluginId, `outputs[${i}].id must be a non-empty string`)
        }
        validateBindings(pluginId, [output.component])
        break
      case "provider":
        if (!output.id || typeof output.id !== "string") {
          fail(pluginId, `outputs[${i}].id must be a non-empty string`)
        }
        validateBindings(pluginId, [output.component])
        break
      case "surface-resolver":
        validateSurfaceResolverOutput(pluginId, output, i)
        break
      case "agent-tool":
        if (!output.id || typeof output.id !== "string") {
          fail(pluginId, `outputs[${i}].id must be a non-empty string`)
        }
        validateAgentTools(pluginId, [output.tool])
        break
    }
  }
}

function validatePlugin(spec: Plugin): void {
  if (!spec.id || typeof spec.id !== "string") {
    fail(spec.id ?? "<unknown>", "id must be a non-empty string")
  }
  if (spec.panels) validatePanels(spec.id, spec.panels)
  if (spec.commands) validateCommands(spec.id, spec.commands)
  if (spec.catalogs) validateCatalogs(spec.id, spec.catalogs)
  if (spec.bindings) validateBindings(spec.id, spec.bindings)
  if (spec.agentTools) validateAgentTools(spec.id, spec.agentTools)
  if (spec.outputs) validateOutputs(spec.id, spec.outputs)
}

export function definePlugin(spec: Plugin): Plugin {
  validatePlugin(spec)
  return Object.assign({}, spec)
}
