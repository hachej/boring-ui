import type { AgentTool, ToolExecContext, ToolResult } from "@hachej/boring-workspace/shared"
import { APP_RUNNER_DEFAULT_DIR } from "../shared/constants"
import type { AppRunnerClient } from "./appRunnerClient"
import { AppRunnerHttpError } from "./appRunnerClient"
import type { AppRunnerStore } from "./appRunnerStore"
import { AppRunnerLimitError, collectAppFiles } from "./collectAppFiles"
import { resolveWorkspaceId } from "./resolveWorkspaceId"

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
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

export function createPublishAppTool(options: AppRunnerToolsOptions): AgentTool {
  return {
    name: "publish_app",
    description: "Publish the workspace app/ folder (or a custom dir) to the app runner and return a live URL.",
    promptSnippet: "Call publish_app after writing/updating app/index.js and app/index.html to deploy the app and get a live URL to share.",
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
      if (!appName) return textResult("publish_app requires a non-empty appName.", true)
      const dir = typeof params.dir === "string" && params.dir.trim().length > 0 ? params.dir.trim() : APP_RUNNER_DEFAULT_DIR
      const message = typeof params.message === "string" ? params.message : undefined
      const workspaceId = resolveWorkspaceId(ctx, options.workspaceRoot)

      try {
        const { files } = await collectAppFiles(options.workspaceRoot, dir)
        const result = await options.client.publish(workspaceId, appName, files, message)
        await options.store.upsertApp({
          appName,
          version: result.version,
          url: result.url,
          updatedAt: new Date().toISOString(),
        })
        return textResult(`Published "${appName}" as version ${result.version}: ${result.url}`)
      } catch (error) {
        return errorResult(`publish_app failed for "${appName}"`, error)
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
      if (!appName) return textResult("list_app_versions requires a non-empty appName.", true)
      const workspaceId = resolveWorkspaceId(ctx, options.workspaceRoot)
      try {
        const versions = await options.client.listVersions(workspaceId, appName)
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
      if (!appName) return textResult("rollback_app requires a non-empty appName.", true)
      const workspaceId = resolveWorkspaceId(ctx, options.workspaceRoot)
      try {
        await options.client.rollback(workspaceId, appName)
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
      if (!appName) return textResult("activate_app_version requires a non-empty appName.", true)
      const version = params.version
      if (typeof version !== "number" || !Number.isFinite(version)) {
        return textResult("activate_app_version requires a numeric version.", true)
      }
      const workspaceId = resolveWorkspaceId(ctx, options.workspaceRoot)
      try {
        await options.client.activate(workspaceId, appName, version)
        await options.store.upsertApp({
          appName,
          version,
          url: options.client.publicAppUrl(workspaceId, appName),
          updatedAt: new Date().toISOString(),
        })
        return textResult(`Activated "${appName}" version ${version}.`)
      } catch (error) {
        return errorResult(`activate_app_version failed for "${appName}"`, error)
      }
    },
  }
}

export function createAppRunnerTools(options: AppRunnerToolsOptions): AgentTool[] {
  return [
    createPublishAppTool(options),
    createListAppVersionsTool(options),
    createRollbackAppTool(options),
    createActivateAppVersionTool(options),
  ]
}
