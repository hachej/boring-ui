import type { AgentTool, ToolExecContext, ToolResult } from "@hachej/boring-workspace/shared"
import { APP_RUNNER_DEFAULT_DIR } from "../shared/constants"
import type { AppRunnerIdentity, AppRunnerToolManifest } from "../shared/types"
import type { AppRunnerClient } from "./appRunnerClient"
import { AppRunnerHttpError } from "./appRunnerClient"
import type { AppRunnerStore } from "./appRunnerStore"
import { AppRunnerLimitError, collectAppFiles } from "./collectAppFiles"
import { commitPublishedFolder } from "./commitPublishedFolder"
import { identityFromToolContext } from "./resolveIdentity"
import { manifestFromVersionFiles, readToolManifest } from "./readToolManifest"
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

/** Re-reads the manifest for whatever version is now active and stores it, so the
 * generic `call_app_tool` dispatcher (see below) reflects publish/activate/rollback. */
async function refreshStoredManifest(
  options: AppRunnerToolsOptions,
  workspaceId: string,
  appName: string,
  version: number,
  identity: AppRunnerIdentity,
  fallback?: AppRunnerToolManifest,
): Promise<AppRunnerToolManifest | undefined> {
  try {
    const versionFiles = await options.client.versionFiles(workspaceId, appName, version, identity)
    return manifestFromVersionFiles(versionFiles) ?? fallback
  } catch {
    return fallback
  }
}

export function createPublishAppTool(options: AppRunnerToolsOptions): AgentTool {
  return {
    name: "publish_app",
    description: "Publish the workspace app/ folder (or a custom dir) to the app runner and return a live URL.",
    promptSnippet: "Call publish_app after writing/updating app/index.js and app/index.html to deploy the app and get a live URL to share. An optional app/tools.json manifest lets the app expose its own callable tools to the agent, auto-registered after publish (see call_app_tool).",
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
      const dir = typeof params.dir === "string" && params.dir.trim().length > 0 ? params.dir.trim() : `apps/${appName}`
      const message = typeof params.message === "string" ? params.message : undefined
      const workspaceId = resolveWorkspaceId(ctx, options.workspaceRoot)
      const identity = identityFromToolContext(ctx)

      try {
        const publishMessage = message?.trim() || `Publish ${appName}`
        const sha = await commitPublishedFolder(options.workspaceRoot, dir, publishMessage)
        const { files } = await collectAppFiles(options.workspaceRoot, dir)
        const result = await options.client.publish(workspaceId, appName, files, identity, {
          kind: "app",
          message: publishMessage,
          sha,
        })
        const current = await options.client.current(workspaceId, appName, identity)
        const toolManifest = current.manifest
        await options.store.upsertApp({
          appName,
          kind: current.kind,
          version: current.version,
          sha: current.sha,
          url: result.url,
          updatedAt: new Date().toISOString(),
          toolManifest,
        })
        const manifestNote = toolManifest?.tools.length
          ? ` Registered ${toolManifest.tools.length} app tool(s) — call them with call_app_tool.`
          : ""
        return textResult(`Published "${appName}" as version ${result.version}: ${result.url}.${manifestNote}`)
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
        const versions = await options.client.listVersions(workspaceId, appName, identityFromToolContext(ctx))
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
      const identity = identityFromToolContext(ctx)
      try {
        await options.client.rollback(workspaceId, appName, identity)
        const versions = await options.client.listVersions(workspaceId, appName, identity)
        const current = versions.find((entry) => entry.current)
        if (current) {
          const toolManifest = await refreshStoredManifest(options, workspaceId, appName, current.version, identity)
          await options.store.upsertApp({
            appName,
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
      if (!appName) return textResult("activate_app_version requires a non-empty appName.", true)
      const version = params.version
      if (typeof version !== "number" || !Number.isFinite(version)) {
        return textResult("activate_app_version requires a numeric version.", true)
      }
      const workspaceId = resolveWorkspaceId(ctx, options.workspaceRoot)
      const identity = identityFromToolContext(ctx)
      try {
        await options.client.activate(workspaceId, appName, version, identity)
        const toolManifest = await refreshStoredManifest(options, workspaceId, appName, version, identity)
        const current = await options.client.current(workspaceId, appName, identity)
        await options.store.upsertApp({
          appName,
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
      if (!appName) return textResult("get_app_logs requires a non-empty appName.", true)
      const workspaceId = resolveWorkspaceId(ctx, options.workspaceRoot)
      try {
        const logs = await options.client.logs(workspaceId, appName, identityFromToolContext(ctx))
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
      if (!appName) return textResult("get_app_usage requires a non-empty appName.", true)
      const workspaceId = resolveWorkspaceId(ctx, options.workspaceRoot)
      try {
        const usage = await options.client.usage(workspaceId, appName, identityFromToolContext(ctx))
        return { content: [{ type: "text", text: JSON.stringify(usage) }], details: usage }
      } catch (error) {
        return errorResult(`get_app_usage failed for "${appName}"`, error)
      }
    },
  }
}

/**
 * Generic dispatcher for `app/tools.json`-declared app tools.
 *
 * The workspace plugin system only supports boot-time-static `agentTools`
 * (see `packages/workspace/docs/PLUGIN_SYSTEM.md` §4.5: "boring.server
 * routes/agentTools: ... Boot-time only", true for both trust tiers) — there
 * is no supported mechanism to register a brand-new named tool per app/tool
 * pair at publish time. Rather than fight that, this exposes one static
 * tool that looks up the *current* manifest from the JSON store (refreshed
 * on publish/activate/rollback, see above) at call time and forwards to the
 * runner. This is an explicit, documented deviation from the literal
 * `app_{app}_{tool}`-per-tool-name ask.
 */
export function createCallAppToolTool(options: AppRunnerToolsOptions): AgentTool {
  return {
    name: "call_app_tool",
    description: "Call a tool an app declared in its app/tools.json manifest (registered automatically after publish_app).",
    parameters: {
      type: "object",
      properties: {
        appName: { type: "string", description: "The app name previously published with publish_app." },
        tool: { type: "string", description: "Tool name as declared in app/tools.json." },
        input: { type: "object", description: "Input matching the tool's declared input schema.", additionalProperties: true },
      },
      required: ["appName", "tool"],
      additionalProperties: false,
    },
    async execute(params: Record<string, unknown>, ctx: ToolExecContext): Promise<ToolResult> {
      const appName = requireAppName(params)
      if (!appName) return textResult("call_app_tool requires a non-empty appName.", true)
      const toolName = typeof params.tool === "string" ? params.tool.trim() : ""
      if (!toolName) return textResult("call_app_tool requires a non-empty tool name.", true)
      const apps = await options.store.listApps()
      const app = apps.find((entry) => entry.appName === appName)
      const declared = app?.toolManifest?.tools.find((entry) => entry.name === toolName)
      if (!declared) {
        return textResult(`"${appName}" has no tool named "${toolName}" in its published app/tools.json manifest.`, true)
      }
      const workspaceId = resolveWorkspaceId(ctx, options.workspaceRoot)
      try {
        const result = await options.client.callTool(workspaceId, appName, toolName, params.input ?? {}, identityFromToolContext(ctx))
        return { content: [{ type: "text", text: JSON.stringify(result) }], details: result }
      } catch (error) {
        return errorResult(`call_app_tool failed for "${appName}.${toolName}"`, error)
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
    createGetAppLogsTool(options),
    createGetAppUsageTool(options),
    createCallAppToolTool(options),
  ]
}
