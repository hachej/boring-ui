import { validateTool } from "@boring/agent/shared"
import type { Plugin, CatalogConfig } from "./types"
import type { PanelConfig } from "../../front/registry/types"
import type { CommandConfig } from "../../front/registry/types"

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
    const valid = validateTool(tools[i])
    if (!valid) {
      fail(
        pluginId,
        `agentTools[${i}] is not a valid AgentTool (missing required fields: name, description, parameters, execute)`,
      )
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
  if (spec.agentTools) validateAgentTools(spec.id, spec.agentTools)
}

export function definePlugin(spec: Plugin): Plugin {
  validatePlugin(spec)
  return Object.assign({}, spec)
}
