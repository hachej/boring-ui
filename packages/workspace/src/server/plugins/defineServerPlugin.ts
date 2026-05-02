import type { RuntimeProvisioningContribution } from "@boring/agent/server"
import type { FastifyPluginAsync } from "fastify"
import type { AgentTool } from "../../shared/types/agent-tool"

export interface WorkspaceServerPlugin {
  id: string
  label?: string
  systemPrompt?: string
  agentTools?: AgentTool[]
  provisioning?: RuntimeProvisioningContribution
  routes?: FastifyPluginAsync
}

export class ServerPluginError extends Error {
  constructor(message: string) {
    super(message)
  }
}

function fail(pluginId: string, message: string): never {
  throw new ServerPluginError(`server plugin "${pluginId}": ${message}`)
}

function isUrl(value: unknown): value is URL {
  return value instanceof URL
}

function isPathLike(value: unknown): value is string | URL {
  return (typeof value === "string" && value.length > 0) || isUrl(value)
}

function validateAgentTool(pluginId: string, tool: unknown, index: number): void {
  if (!tool || typeof tool !== "object") {
    fail(pluginId, `agentTools[${index}] must be an object`)
  }
  const candidate = tool as Record<string, unknown>
  if (!candidate.name || typeof candidate.name !== "string") {
    fail(pluginId, `agentTools[${index}].name must be a non-empty string`)
  }
  if (typeof candidate.description !== "string") {
    fail(pluginId, `agentTools[${index}].description must be a string`)
  }
  if (!candidate.parameters || typeof candidate.parameters !== "object") {
    fail(pluginId, `agentTools[${index}].parameters must be an object`)
  }
  if (typeof candidate.execute !== "function") {
    fail(pluginId, `agentTools[${index}].execute must be a function`)
  }
}

function validateProvisioning(
  pluginId: string,
  provisioning: RuntimeProvisioningContribution,
): void {
  if (!provisioning || typeof provisioning !== "object") {
    fail(pluginId, "provisioning must be an object")
  }

  if (provisioning.templateDirs !== undefined) {
    if (!Array.isArray(provisioning.templateDirs)) {
      fail(pluginId, "provisioning.templateDirs must be an array when provided")
    }
    for (let i = 0; i < provisioning.templateDirs.length; i++) {
      const contribution = provisioning.templateDirs[i]
      if (!contribution || typeof contribution !== "object") {
        fail(pluginId, `provisioning.templateDirs[${i}] must be an object`)
      }
      if (!contribution.id || typeof contribution.id !== "string") {
        fail(pluginId, `provisioning.templateDirs[${i}].id must be a non-empty string`)
      }
      if (!isPathLike(contribution.path)) {
        fail(pluginId, `provisioning.templateDirs[${i}].path must be a string or URL`)
      }
      if (
        contribution.target !== undefined &&
        typeof contribution.target !== "string"
      ) {
        fail(pluginId, `provisioning.templateDirs[${i}].target must be a string when provided`)
      }
    }
  }

  if (provisioning.python !== undefined) {
    if (!Array.isArray(provisioning.python)) {
      fail(pluginId, "provisioning.python must be an array when provided")
    }
    for (let i = 0; i < provisioning.python.length; i++) {
      const spec = provisioning.python[i]
      if (!spec || typeof spec !== "object") {
        fail(pluginId, `provisioning.python[${i}] must be an object`)
      }
      if (!spec.id || typeof spec.id !== "string") {
        fail(pluginId, `provisioning.python[${i}].id must be a non-empty string`)
      }
      if (!isPathLike(spec.projectFile)) {
        fail(pluginId, `provisioning.python[${i}].projectFile must be a string or URL`)
      }
      if (
        spec.extraLibs !== undefined &&
        (!Array.isArray(spec.extraLibs) ||
          spec.extraLibs.some((item) => typeof item !== "string"))
      ) {
        fail(pluginId, `provisioning.python[${i}].extraLibs must be a string array when provided`)
      }
      if (spec.env !== undefined) {
        if (!spec.env || typeof spec.env !== "object" || Array.isArray(spec.env)) {
          fail(pluginId, `provisioning.python[${i}].env must be an object when provided`)
        }
        for (const [key, value] of Object.entries(spec.env)) {
          if (!key || !isPathLike(value)) {
            fail(pluginId, `provisioning.python[${i}].env values must be strings or URLs`)
          }
        }
      }
    }
  }
}

export function validateServerPlugin(plugin: WorkspaceServerPlugin): void {
  if (!plugin.id || typeof plugin.id !== "string") {
    fail(plugin.id ?? "<unknown>", "id must be a non-empty string")
  }
  if (plugin.label !== undefined && typeof plugin.label !== "string") {
    fail(plugin.id, "label must be a string when provided")
  }
  if (plugin.systemPrompt !== undefined && typeof plugin.systemPrompt !== "string") {
    fail(plugin.id, "systemPrompt must be a string when provided")
  }
  if (plugin.agentTools !== undefined) {
    if (!Array.isArray(plugin.agentTools)) {
      fail(plugin.id, "agentTools must be an array when provided")
    }
    plugin.agentTools.forEach((tool, index) => validateAgentTool(plugin.id, tool, index))
  }
  if (plugin.routes !== undefined && typeof plugin.routes !== "function") {
    fail(plugin.id, "routes must be a Fastify plugin function when provided")
  }
  if (plugin.provisioning !== undefined) {
    validateProvisioning(plugin.id, plugin.provisioning)
  }
}

export function defineServerPlugin<T extends WorkspaceServerPlugin>(plugin: T): T {
  validateServerPlugin(plugin)
  return Object.assign({}, plugin)
}
