import type { PluginSkillSource, ProvisionWorkspaceRuntimeOptions } from "@hachej/boring-agent/server"
import type { FastifyPluginAsync } from "fastify"
import type { WorkspaceBridgeOperationDefinition } from "../../shared/workspace-bridge-rpc"
import type { AgentTool } from "../../shared/types/agent-tool"
import { validateWorkspaceBridgeOperationDefinition, type WorkspaceBridgeHandler } from "../workspaceBridge/registry"

import {
  PI_PACKAGE_RESOURCE_FILTERS,
  type WorkspacePiPackageSource,
} from "./piPackages"

type WorkspaceRuntimeProvisioning = NonNullable<ProvisionWorkspaceRuntimeOptions["plugins"][number]["provisioning"]>

export interface WorkspaceServerPluginAsset {
  /** Stable asset name within this plugin, e.g. "sdk" or "workspace-template". */
  name: string
  /** Source directory or file owned by the plugin. Relative strings are resolved by the app integration. */
  source: string | URL
  /** Optional runtime target path within this plugin's asset namespace. Defaults to name. */
  target?: string
}

export interface WorkspaceBridgeHandlerContribution {
  definition: WorkspaceBridgeOperationDefinition
  handler: WorkspaceBridgeHandler
}

export interface WorkspaceServerPluginShutdown {
  /** Stop admitting plugin-owned background work. Must return promptly because Fastify preClose is timed. */
  begin(): void | Promise<void>
  /** Drain already admitted work before the agent runtime starts draining. */
  drain(): Promise<void>
}

export interface WorkspaceServerPlugin {
  id: string
  label?: string
  /**
   * Native Pi package sources required by this workspace integration.
   * Workspace declares them; @hachej/boring-agent applies them through Pi's native
   * resource loader without asking Pi packages to export Boring adapters.
   */
  piPackages?: WorkspacePiPackageSource[]
  /**
   * Native pi extension entrypoints contributed by this plugin.
   * Passed to DefaultResourceLoader.additionalExtensionPaths so pi owns jiti
   * loading and ctx.reload() re-imports fresh source.
   */
  extensionPaths?: string[]
  systemPrompt?: string
  skills?: PluginSkillSource[]
  agentTools?: AgentTool[]
  /** Trusted boot-time host RPC handlers. Only app/internal server plugins should provide these. */
  workspaceBridgeHandlers?: WorkspaceBridgeHandlerContribution[]
  provisioning?: WorkspaceRuntimeProvisioning
  /** Static filesystem assets this plugin needs in production/serverless bundles. */
  assets?: WorkspaceServerPluginAsset[]
  routes?: FastifyPluginAsync
  /** Optional lifecycle for trusted plugin-owned background work. */
  shutdown?: WorkspaceServerPluginShutdown
  /** UI state keys owned by this plugin that browser state PUTs must not overwrite. */
  preservedUiStateKeys?: string[]
}



function fail(pluginId: string, message: string): never {
  throw new Error(`server plugin "${pluginId}": ${message}`)
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

function validatePiPackages(pluginId: string, piPackages: unknown[]): void {
  for (let i = 0; i < piPackages.length; i++) {
    const source = piPackages[i]
    if (typeof source === "string") {
      if (source.length === 0) {
        fail(pluginId, `piPackages[${i}] must be a non-empty string`)
      }
      continue
    }

    if (!source || typeof source !== "object" || Array.isArray(source)) {
      fail(pluginId, `piPackages[${i}] must be a string or package source object`)
    }

    const candidate = source as Record<string, unknown>
    if (typeof candidate.source !== "string" || candidate.source.length === 0) {
      fail(pluginId, `piPackages[${i}].source must be a non-empty string`)
    }
    for (const key of PI_PACKAGE_RESOURCE_FILTERS) {
      const value = candidate[key]
      if (value === undefined) continue
      if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.length === 0)) {
        fail(pluginId, `piPackages[${i}].${key} must be a string array when provided`)
      }
    }
  }
}

function validateSkills(pluginId: string, skills: PluginSkillSource[]): void {
  for (let i = 0; i < skills.length; i++) {
    const skill = skills[i]
    if (!skill || typeof skill !== "object") {
      fail(pluginId, `skills[${i}] must be an object`)
    }
    if (!skill.name || typeof skill.name !== "string") {
      fail(pluginId, `skills[${i}].name must be a non-empty string`)
    }
    if (!isPathLike(skill.source)) {
      fail(pluginId, `skills[${i}].source must be a string or URL`)
    }
  }
}

function validatePluginAssets(pluginId: string, assets: WorkspaceServerPluginAsset[]): void {
  for (let i = 0; i < assets.length; i++) {
    const asset = assets[i]
    if (!asset || typeof asset !== "object") {
      fail(pluginId, `assets[${i}] must be an object`)
    }
    if (!asset.name || typeof asset.name !== "string") {
      fail(pluginId, `assets[${i}].name must be a non-empty string`)
    }
    if (!isPathLike(asset.source)) {
      fail(pluginId, `assets[${i}].source must be a string or URL`)
    }
    if (asset.target !== undefined && (!asset.target || typeof asset.target !== "string")) {
      fail(pluginId, `assets[${i}].target must be a non-empty string when provided`)
    }
  }
}

function validateWorkspaceBridgeHandlers(pluginId: string, handlers: WorkspaceBridgeHandlerContribution[]): void {
  for (let i = 0; i < handlers.length; i++) {
    const entry = handlers[i]
    if (!entry || typeof entry !== "object") {
      fail(pluginId, `workspaceBridgeHandlers[${i}] must be an object`)
    }
    if (!entry.definition || typeof entry.definition !== "object") {
      fail(pluginId, `workspaceBridgeHandlers[${i}].definition must be an object`)
    }
    try {
      validateWorkspaceBridgeOperationDefinition(entry.definition)
    } catch (error) {
      const message = error && typeof error === "object" && "message" in error
        ? String((error as { message?: unknown }).message)
        : "invalid WorkspaceBridge operation definition"
      fail(pluginId, `workspaceBridgeHandlers[${i}].definition invalid: ${message}`)
    }
    if (typeof entry.handler !== "function") {
      fail(pluginId, `workspaceBridgeHandlers[${i}].handler must be a function`)
    }
  }
}

function validateProvisioning(
  pluginId: string,
  provisioning: WorkspaceRuntimeProvisioning,
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

  if (provisioning.nodePackages !== undefined) {
    if (!Array.isArray(provisioning.nodePackages)) {
      fail(pluginId, "provisioning.nodePackages must be an array when provided")
    }
    for (let i = 0; i < provisioning.nodePackages.length; i++) {
      const spec = provisioning.nodePackages[i]
      if (!spec || typeof spec !== "object") {
        fail(pluginId, `provisioning.nodePackages[${i}] must be an object`)
      }
      if (!spec.id || typeof spec.id !== "string") {
        fail(pluginId, `provisioning.nodePackages[${i}].id must be a non-empty string`)
      }
      if (!spec.packageName || typeof spec.packageName !== "string") {
        fail(pluginId, `provisioning.nodePackages[${i}].packageName must be a non-empty string`)
      }
      if (spec.packageRoot !== undefined && !isPathLike(spec.packageRoot)) {
        fail(pluginId, `provisioning.nodePackages[${i}].packageRoot must be a string or URL`)
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
  if (plugin.piPackages !== undefined) {
    if (!Array.isArray(plugin.piPackages)) {
      fail(plugin.id, "piPackages must be an array when provided")
    }
    validatePiPackages(plugin.id, plugin.piPackages)
  }
  if (plugin.extensionPaths !== undefined) {
    if (!Array.isArray(plugin.extensionPaths)) {
      fail(plugin.id, "extensionPaths must be an array when provided")
    }
    plugin.extensionPaths.forEach((path, index) => {
      if (typeof path !== "string" || path.length === 0) {
        fail(plugin.id, `extensionPaths[${index}] must be a non-empty string`)
      }
    })
  }
  if (plugin.skills !== undefined) {
    if (!Array.isArray(plugin.skills)) {
      fail(plugin.id, "skills must be an array when provided")
    }
    validateSkills(plugin.id, plugin.skills)
  }
  if (plugin.agentTools !== undefined) {
    if (!Array.isArray(plugin.agentTools)) {
      fail(plugin.id, "agentTools must be an array when provided")
    }
    plugin.agentTools.forEach((tool, index) => validateAgentTool(plugin.id, tool, index))
  }
  if (plugin.assets !== undefined) {
    if (!Array.isArray(plugin.assets)) {
      fail(plugin.id, "assets must be an array when provided")
    }
    validatePluginAssets(plugin.id, plugin.assets)
  }
  if (plugin.workspaceBridgeHandlers !== undefined) {
    if (!Array.isArray(plugin.workspaceBridgeHandlers)) {
      fail(plugin.id, "workspaceBridgeHandlers must be an array when provided")
    }
    validateWorkspaceBridgeHandlers(plugin.id, plugin.workspaceBridgeHandlers)
  }
  if (plugin.routes !== undefined && typeof plugin.routes !== "function") {
    fail(plugin.id, "routes must be a Fastify plugin function when provided")
  }
  if (plugin.shutdown !== undefined && (
    !plugin.shutdown
    || typeof plugin.shutdown !== "object"
    || typeof plugin.shutdown.begin !== "function"
    || typeof plugin.shutdown.drain !== "function"
  )) {
    fail(plugin.id, "shutdown must provide begin and drain functions when provided")
  }
  if (plugin.preservedUiStateKeys !== undefined) {
    if (!Array.isArray(plugin.preservedUiStateKeys) || plugin.preservedUiStateKeys.some((key) => typeof key !== "string" || key.length === 0)) {
      fail(plugin.id, "preservedUiStateKeys must be a non-empty string array when provided")
    }
  }
  if (plugin.provisioning !== undefined) {
    validateProvisioning(plugin.id, plugin.provisioning)
  }
}

export function defineServerPlugin<T extends WorkspaceServerPlugin>(plugin: T): T {
  validateServerPlugin(plugin)
  return { ...plugin }
}
