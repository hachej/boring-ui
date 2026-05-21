import type { RuntimeProvisioningContribution } from "@hachej/boring-agent/server"
import { posix } from "node:path"
import type { FastifyPluginAsync } from "fastify"
import type { AgentTool } from "../../shared/types/agent-tool"

import {
  PI_PACKAGE_RESOURCE_FILTERS,
  type WorkspacePiPackageSource,
} from "./piPackages"

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
  agentTools?: AgentTool[]
  provisioning?: RuntimeProvisioningContribution
  routes?: FastifyPluginAsync
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

function isFilePathLike(value: unknown): value is string | URL {
  return (typeof value === "string" && value.length > 0 && !value.includes("\0")) || (isUrl(value) && value.protocol === "file:")
}

function validateNodePackageName(pluginId: string, index: number, packageName: string): void {
  if (packageName.trim() !== packageName || packageName.includes("\0") || packageName.includes("\\")) {
    fail(pluginId, `provisioning.nodePackages[${index}].packageName must be a valid npm package name`)
  }
  const parts = packageName.split("/")
  const validPart = (part: string) => part.length > 0 && part !== "." && part !== ".." && !part.includes("\0")
  if (packageName.startsWith("@")) {
    if (parts.length !== 2 || !parts[0].startsWith("@") || !validPart(parts[0].slice(1)) || !validPart(parts[1])) {
      fail(pluginId, `provisioning.nodePackages[${index}].packageName must be a valid scoped npm package name`)
    }
    return
  }
  if (parts.length !== 1 || !validPart(parts[0])) {
    fail(pluginId, `provisioning.nodePackages[${index}].packageName must be a valid npm package name`)
  }
}

function validateNodeBinName(pluginId: string, packageIndex: number, binName: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(binName) || binName === "." || binName === "..") {
    fail(pluginId, `provisioning.nodePackages[${packageIndex}].bins key "${binName}" must be a bin name without path separators`)
  }
}

function validateNodeBinTarget(pluginId: string, packageIndex: number, binName: string, target: unknown): void {
  if (typeof target !== "string" || target.length === 0 || target.includes("\0") || target.includes("\\")) {
    fail(pluginId, `provisioning.nodePackages[${packageIndex}].bins.${binName} must be a package-relative file path`)
  }
  const normalized = posix.normalize(target.replace(/^\.\//, ""))
  if (normalized === "." || normalized === ".." || normalized.startsWith("../") || normalized.startsWith("/")) {
    fail(pluginId, `provisioning.nodePackages[${packageIndex}].bins.${binName} must be a package-relative file path`)
  }
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
      validateNodePackageName(pluginId, i, spec.packageName)
      if (spec.version !== undefined && (typeof spec.version !== "string" || spec.version.length === 0 || spec.version.trim() !== spec.version || /[\s\0]/.test(spec.version))) {
        fail(pluginId, `provisioning.nodePackages[${i}].version must be a non-empty version string when provided`)
      }
      if (spec.packageRoot !== undefined && !isFilePathLike(spec.packageRoot)) {
        fail(pluginId, `provisioning.nodePackages[${i}].packageRoot must be a non-empty string or file URL when provided`)
      }
      if (spec.packageRoot === undefined && spec.version === undefined) {
        fail(pluginId, `provisioning.nodePackages[${i}] must provide packageRoot for a local source or version for a registry source`)
      }
      if (spec.bins !== undefined) {
        if (!spec.bins || typeof spec.bins !== "object" || Array.isArray(spec.bins)) {
          fail(pluginId, `provisioning.nodePackages[${i}].bins must be an object mapping bin names to package-relative paths when provided`)
        }
        for (const [binName, target] of Object.entries(spec.bins)) {
          validateNodeBinName(pluginId, i, binName)
          validateNodeBinTarget(pluginId, i, binName, target)
        }
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
  if (plugin.agentTools !== undefined) {
    if (!Array.isArray(plugin.agentTools)) {
      fail(plugin.id, "agentTools must be an array when provided")
    }
    plugin.agentTools.forEach((tool, index) => validateAgentTool(plugin.id, tool, index))
  }
  if (plugin.routes !== undefined && typeof plugin.routes !== "function") {
    fail(plugin.id, "routes must be a Fastify plugin function when provided")
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
