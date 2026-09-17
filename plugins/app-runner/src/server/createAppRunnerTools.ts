import type { AgentTool, ToolExecContext, ToolResult } from "@hachej/boring-workspace/shared"
import { APP_RUNNER_DEFAULT_DIR } from "../shared/constants"
import { sanitizeAppName } from "../shared/sanitize"
import type { AppRunnerIdentity, AppRunnerToolManifest } from "../shared/types"
import type { AppRunnerClient } from "./appRunnerClient"
import { AppRunnerHttpError } from "./appRunnerClient"
import type { AppRunnerStore } from "./appRunnerStore"
import { AppRunnerLimitError, collectAppFiles } from "./collectAppFiles"
import { commitPublishedFolder } from "./commitPublishedFolder"
import { identityFromToolContext } from "./resolveIdentity"
import { manifestFromVersionFiles } from "./readToolManifest"
import { resolveWorkspaceId } from "./resolveWorkspaceId"
import { isProfileAppName, profileAppName } from "./profileAddress"

export interface AppRunnerToolsOptions {
  workspaceRoot: string
  client: AppRunnerClient
  store: AppRunnerStore
}

function textResult(text: string, isError = false): ToolResult {
  return { content: [{ type: "text", text }], isError }
}

function errorResult(prefix: string, error: unknown): ToolResult {
  if (error instanceof AppRunnerLimitError) {
    return textResult(`${prefix}: ${error.message}`, true)
  }
  if (error instanceof AppRunnerHttpError) {
    return textResult(`${prefix}: app runner responded ${error.status}: ${error.message}`, true)
  }
  return textResult(`${prefix}: ${error instanceof Error ? error.message : String(error)}`, true)
}

function requireAppName(params: Record<string, unknown>): string | undefined {
  const value = params.appName
  if (typeof value !== "string" || !value.trim()) return undefined
  const appName = value.trim()
  if (isProfileAppName(appName) || appName === "profile") return undefined
  try {
    return sanitizeAppName(appName)
  } catch {
    return undefined
  }
}

function invalidAppName(toolName: string): ToolResult {
  return textResult(`${toolName} requires a non-empty app name outside the reserved profile namespace.`, true)
}

/** Re-read the active published manifest after activate or rollback. */
async function refreshStoredManifest(
  options: AppRunnerToolsOptions,
  workspaceId: string,
  appName: string,
  version: number,
  identity: AppRunnerIdentity,
  fallback?: AppRunnerToolManifest,
  signal?: AbortSignal,
): Promise<AppRunnerToolManifest | undefined> {
  try {
    const versionFiles = await options.client.versionFiles(workspaceId, appName, version, identity, signal)
    return manifestFromVersionFiles(versionFiles) ?? fallback
  } catch {
    return fallback
  }
}

export function createPublishAppTool(options: AppRunnerToolsOptions): AgentTool {
  return {
    name: "publish_app",
    description: "Commit and publish apps/<appName>/ (or a custom workspace-relative dir) and return its live URL.",
    promptSnippet: "Call publish_app after writing or updating apps/<appName>/. Tools in its published tools.json manifest mount natively after activation; draft edits do not change the tool inventory.",
    parameters: {
      type: "object",
      properties: {
        appName: { type: "string", description: "Stable app name. Sanitized to [a-z0-9-] for the runner." },
        dir: { type: "string", description: `Workspace-relative directory to publish. Defaults to "${APP_RUNNER_DEFAULT_DIR}".` },
        message: { type: "string", description: "Optional publish message shown in version history." },
      },
      required: ["appName"],
      additionalProperties: false,
    },
    async execute(params: Record<string, unknown>, ctx: ToolExecContext): Promise<ToolResult> {
      const appName = requireAppName(params)
      if (!appName) return invalidAppName("publish_app")
      const dir = typeof params.dir === "string" && params.dir.trim().length > 0 ? params.dir.trim() : `apps/${appName}`
      const message = typeof params.message === "string" ? params.message : undefined
      const workspaceId = resolveWorkspaceId(ctx, options.workspaceRoot)
      const identity = identityFromToolContext(ctx)

      try {
        const publishMessage = message?.trim() || `Publish ${appName}`
        const sha = await commitPublishedFolder(options.workspaceRoot, dir, publishMessage)
        const { files } = await collectAppFiles(options.workspaceRoot, dir, sha)
        const result = await options.client.publish(workspaceId, appName, files, identity, {
          kind: "app",
          message: publishMessage,
          sha,
        }, ctx.abortSignal)
        if (!result.activated) {
          return textResult(`publish_app stored version ${result.version} but activation failed: ${result.activationError || "migration or activation failed"}`, true)
        }
        const current = await options.client.current(workspaceId, appName, identity, ctx.abortSignal)
        const toolManifest = current.manifest
        await options.store.upsertApp({
          appName,
          workspaceId,
          kind: current.kind,
          version: current.version,
          sha: current.sha,
          url: result.url,
          updatedAt: new Date().toISOString(),
          toolManifest,
        })
        const manifestNote = toolManifest?.tools.length
          ? ` Registered ${toolManifest.tools.length} native app tool(s).`
          : ""
        return textResult(`Published "${appName}" as version ${result.version}: ${result.url}.${manifestNote}`)
      } catch (error) {
        return errorResult(`publish_app failed for "${appName}"`, error)
      }
    },
  }
}

export function createPublishProfileTool(options: AppRunnerToolsOptions): AgentTool {
  return {
    name: "publish_profile",
    description: "Publish the workspace profile/ folder and activate its instructions and tools.",
    parameters: {
      type: "object",
      properties: { message: { type: "string", description: "Publish message shown in version history." } },
      additionalProperties: false,
    },
    async execute(params: Record<string, unknown>, ctx: ToolExecContext): Promise<ToolResult> {
      const message = typeof params.message === "string" && params.message.trim() ? params.message.trim() : "Publish profile"
      const workspaceId = resolveWorkspaceId(ctx, options.workspaceRoot)
      const identity = identityFromToolContext(ctx)
      const name = profileAppName(identity.id)
      try {
        const sha = await commitPublishedFolder(options.workspaceRoot, "profile", message)
        const { files } = await collectAppFiles(options.workspaceRoot, "profile", sha)
        const published = await options.client.publish(workspaceId, name, files, identity, { kind: "profile", message, sha }, ctx.abortSignal)
        if (!published.activated) {
          return textResult(`publish_profile stored version ${published.version} but activation failed: ${published.activationError || "migration or activation failed"}`, true)
        }
        const current = await options.client.current(workspaceId, name, identity, ctx.abortSignal)
        await options.store.upsertApp({
          appName: name,
          workspaceId,
          ownerUserId: identity.id,
          kind: "profile",
          version: current.version,
          sha: current.sha,
          url: published.url,
          updatedAt: new Date().toISOString(),
          toolManifest: current.manifest,
        })
        return textResult(`Published profile version ${current.version}.`)
      } catch (error) {
        return errorResult("publish_profile failed", error)
      }
    },
  }
}

export function createUndoProfileTool(options: AppRunnerToolsOptions): AgentTool {
  return {
    name: "undo_profile",
    description: "Roll the published profile back to its previous version.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    async execute(_params: Record<string, unknown>, ctx: ToolExecContext): Promise<ToolResult> {
      const workspaceId = resolveWorkspaceId(ctx, options.workspaceRoot)
      const identity = identityFromToolContext(ctx)
      const name = profileAppName(identity.id)
      try {
        await options.client.rollback(workspaceId, name, identity, ctx.abortSignal)
        const current = await options.client.current(workspaceId, name, identity, ctx.abortSignal)
        await options.store.upsertApp({
          appName: name,
          workspaceId,
          ownerUserId: identity.id,
          kind: "profile",
          version: current.version,
          sha: current.sha,
          url: options.client.publicAppUrl(workspaceId, name),
          updatedAt: new Date().toISOString(),
          toolManifest: current.manifest,
        })
        return textResult(`Restored profile version ${current.version}.`)
      } catch (error) {
        return errorResult("undo_profile failed", error)
      }
    },
  }
}

export function createListAppVersionsTool(options: AppRunnerToolsOptions): AgentTool {
  return {
    name: "list_app_versions",
    description: "List published versions of a workspace app, most recent first.",
    parameters: {
      type: "object",
      properties: {
        appName: { type: "string", description: "The app name previously published with publish_app." },
      },
      required: ["appName"],
      additionalProperties: false,
    },
    async execute(params: Record<string, unknown>, ctx: ToolExecContext): Promise<ToolResult> {
      const appName = requireAppName(params)
      if (!appName) return invalidAppName("list_app_versions")
      const workspaceId = resolveWorkspaceId(ctx, options.workspaceRoot)
      try {
        const versions = await options.client.listVersions(workspaceId, appName, identityFromToolContext(ctx), ctx.abortSignal)
        return { content: [{ type: "text", text: JSON.stringify(versions) }], details: versions }
      } catch (error) {
        return errorResult(`list_app_versions failed for "${appName}"`, error)
      }
    },
  }
}

export function createRollbackAppTool(options: AppRunnerToolsOptions): AgentTool {
  return {
    name: "rollback_app",
    description: "Roll a published app back to its previous version.",
    parameters: {
      type: "object",
      properties: {
        appName: { type: "string", description: "The app name previously published with publish_app." },
      },
      required: ["appName"],
      additionalProperties: false,
    },
    async execute(params: Record<string, unknown>, ctx: ToolExecContext): Promise<ToolResult> {
      const appName = requireAppName(params)
      if (!appName) return invalidAppName("rollback_app")
      const workspaceId = resolveWorkspaceId(ctx, options.workspaceRoot)
      const identity = identityFromToolContext(ctx)
      try {
        await options.client.rollback(workspaceId, appName, identity, ctx.abortSignal)
        const versions = await options.client.listVersions(workspaceId, appName, identity, ctx.abortSignal)
        const current = versions.find((entry) => entry.current)
        if (current) {
          const toolManifest = await refreshStoredManifest(options, workspaceId, appName, current.version, identity, undefined, ctx.abortSignal)
          await options.store.upsertApp({
            appName,
            workspaceId,
            kind: current.kind,
            version: current.version,
            sha: current.sha,
            url: options.client.publicAppUrl(workspaceId, appName),
            updatedAt: new Date().toISOString(),
            toolManifest,
          })
        }
        return textResult(`Rolled back "${appName}" to its previous version.`)
      } catch (error) {
        return errorResult(`rollback_app failed for "${appName}"`, error)
      }
    },
  }
}

export function createActivateAppVersionTool(options: AppRunnerToolsOptions): AgentTool {
  return {
    name: "activate_app_version",
    description: "Activate a specific previously-published version of an app as current.",
    parameters: {
      type: "object",
      properties: {
        appName: { type: "string", description: "The app name previously published with publish_app." },
        version: { type: "number", description: "Version number to activate." },
      },
      required: ["appName", "version"],
      additionalProperties: false,
    },
    async execute(params: Record<string, unknown>, ctx: ToolExecContext): Promise<ToolResult> {
      const appName = requireAppName(params)
      if (!appName) return invalidAppName("activate_app_version")
      const version = params.version
      if (typeof version !== "number" || !Number.isFinite(version)) {
        return textResult("activate_app_version requires a numeric version.", true)
      }
      const workspaceId = resolveWorkspaceId(ctx, options.workspaceRoot)
      const identity = identityFromToolContext(ctx)
      try {
        await options.client.activate(workspaceId, appName, version, identity, ctx.abortSignal)
        const toolManifest = await refreshStoredManifest(options, workspaceId, appName, version, identity, undefined, ctx.abortSignal)
        const current = await options.client.current(workspaceId, appName, identity, ctx.abortSignal)
        await options.store.upsertApp({
          appName,
          workspaceId,
          kind: current.kind,
          version: current.version,
          sha: current.sha,
          url: options.client.publicAppUrl(workspaceId, appName),
          updatedAt: new Date().toISOString(),
          toolManifest,
        })
        return textResult(`Activated "${appName}" version ${version}.`)
      } catch (error) {
        return errorResult(`activate_app_version failed for "${appName}"`, error)
      }
    },
  }
}

export function createGetAppLogsTool(options: AppRunnerToolsOptions): AgentTool {
  return {
    name: "get_app_logs",
    description: "Get the last console lines and errors for the current version of a published app.",
    parameters: {
      type: "object",
      properties: {
        appName: { type: "string", description: "The app name previously published with publish_app." },
      },
      required: ["appName"],
      additionalProperties: false,
    },
    async execute(params: Record<string, unknown>, ctx: ToolExecContext): Promise<ToolResult> {
      const appName = requireAppName(params)
      if (!appName) return invalidAppName("get_app_logs")
      const workspaceId = resolveWorkspaceId(ctx, options.workspaceRoot)
      try {
        const logs = await options.client.logs(workspaceId, appName, identityFromToolContext(ctx), ctx.abortSignal)
        return { content: [{ type: "text", text: JSON.stringify(logs) }], details: logs }
      } catch (error) {
        return errorResult(`get_app_logs failed for "${appName}"`, error)
      }
    },
  }
}

export function createGetAppUsageTool(options: AppRunnerToolsOptions): AgentTool {
  return {
    name: "get_app_usage",
    description: "Get request counts and distinct users for the current version of a published app (last 24h and 7d).",
    parameters: {
      type: "object",
      properties: {
        appName: { type: "string", description: "The app name previously published with publish_app." },
      },
      required: ["appName"],
      additionalProperties: false,
    },
    async execute(params: Record<string, unknown>, ctx: ToolExecContext): Promise<ToolResult> {
      const appName = requireAppName(params)
      if (!appName) return invalidAppName("get_app_usage")
      const workspaceId = resolveWorkspaceId(ctx, options.workspaceRoot)
      try {
        const usage = await options.client.usage(workspaceId, appName, identityFromToolContext(ctx), ctx.abortSignal)
        return { content: [{ type: "text", text: JSON.stringify(usage) }], details: usage }
      } catch (error) {
        return errorResult(`get_app_usage failed for "${appName}"`, error)
      }
    },
  }
}


export function createAppRunnerTools(options: AppRunnerToolsOptions): AgentTool[] {
  return [
    createPublishAppTool(options),
    createPublishProfileTool(options),
    createUndoProfileTool(options),
    createListAppVersionsTool(options),
    createRollbackAppTool(options),
    createActivateAppVersionTool(options),
    createGetAppLogsTool(options),
    createGetAppUsageTool(options),
  ]
}
