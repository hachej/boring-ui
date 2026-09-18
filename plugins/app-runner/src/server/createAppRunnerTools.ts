import type { AgentTool, ToolExecContext, ToolResult } from "@hachej/boring-workspace/shared"
import { z } from "zod"
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

export const APP_RUNNER_TOOL_NAME = "app"

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

/** Sanitize a candidate app/profile name, rejecting the reserved profile namespace. */
function sanitizeName(value: string): string | undefined {
  const name = value.trim()
  if (!name || isProfileAppName(name) || name === "profile") return undefined
  try {
    return sanitizeAppName(name)
  } catch {
    return undefined
  }
}

function invalidName(action: string): ToolResult {
  return textResult(`${action} requires a non-empty "name" outside the reserved profile namespace.`, true)
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

async function publishApp(options: AppRunnerToolsOptions, ctx: ToolExecContext, name: string, dir: string, message?: string): Promise<ToolResult> {
  const workspaceId = resolveWorkspaceId(ctx, options.workspaceRoot)
  const identity = identityFromToolContext(ctx)
  try {
    ctx.abortSignal.throwIfAborted()
    const publishMessage = message?.trim() || `Publish ${name}`
    const sha = await commitPublishedFolder(options.workspaceRoot, dir, publishMessage)
    ctx.abortSignal.throwIfAborted()
    const { files } = await collectAppFiles(options.workspaceRoot, dir, sha)
    ctx.abortSignal.throwIfAborted()
    const result = await options.client.publish(workspaceId, name, files, identity, {
      kind: "app",
      message: publishMessage,
      sha,
    }, ctx.abortSignal)
    if (!result.activated) {
      return textResult(`publish stored version ${result.version} but activation failed: ${result.activationError || "migration or activation failed"}`, true)
    }
    const current = await options.client.current(workspaceId, name, identity, ctx.abortSignal)
    const toolManifest = current.manifest
    await options.store.upsertApp({
      appName: name,
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
    return textResult(`Published "${name}" as version ${result.version}: ${result.url}.${manifestNote}`)
  } catch (error) {
    return errorResult(`publish failed for "${name}"`, error)
  }
}

async function publishProfile(options: AppRunnerToolsOptions, ctx: ToolExecContext, message?: string): Promise<ToolResult> {
  const workspaceId = resolveWorkspaceId(ctx, options.workspaceRoot)
  const identity = identityFromToolContext(ctx)
  const name = profileAppName(identity.id)
  const publishMessage = message?.trim() || "Publish profile"
  try {
    ctx.abortSignal.throwIfAborted()
    const sha = await commitPublishedFolder(options.workspaceRoot, "profile", publishMessage)
    ctx.abortSignal.throwIfAborted()
    const { files } = await collectAppFiles(options.workspaceRoot, "profile", sha)
    ctx.abortSignal.throwIfAborted()
    const published = await options.client.publish(workspaceId, name, files, identity, { kind: "profile", message: publishMessage, sha }, ctx.abortSignal)
    if (!published.activated) {
      return textResult(`publish stored version ${published.version} but activation failed: ${published.activationError || "migration or activation failed"}`, true)
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
    return errorResult("publish failed for profile", error)
  }
}

async function undoProfile(options: AppRunnerToolsOptions, ctx: ToolExecContext): Promise<ToolResult> {
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
}

async function listVersions(options: AppRunnerToolsOptions, ctx: ToolExecContext, appName: string): Promise<ToolResult> {
  const workspaceId = resolveWorkspaceId(ctx, options.workspaceRoot)
  try {
    const versions = await options.client.listVersions(workspaceId, appName, identityFromToolContext(ctx), ctx.abortSignal)
    return { content: [{ type: "text", text: JSON.stringify(versions) }], details: versions }
  } catch (error) {
    return errorResult(`versions failed for "${appName}"`, error)
  }
}

async function rollbackApp(options: AppRunnerToolsOptions, ctx: ToolExecContext, appName: string): Promise<ToolResult> {
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
    return errorResult(`rollback failed for "${appName}"`, error)
  }
}

async function activateVersion(options: AppRunnerToolsOptions, ctx: ToolExecContext, appName: string, version: number): Promise<ToolResult> {
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
    return errorResult(`activate failed for "${appName}"`, error)
  }
}

async function getLogs(options: AppRunnerToolsOptions, ctx: ToolExecContext, appName: string): Promise<ToolResult> {
  const workspaceId = resolveWorkspaceId(ctx, options.workspaceRoot)
  try {
    const logs = await options.client.logs(workspaceId, appName, identityFromToolContext(ctx), ctx.abortSignal)
    return { content: [{ type: "text", text: JSON.stringify(logs) }], details: logs }
  } catch (error) {
    return errorResult(`logs failed for "${appName}"`, error)
  }
}

async function getUsage(options: AppRunnerToolsOptions, ctx: ToolExecContext, appName: string): Promise<ToolResult> {
  const workspaceId = resolveWorkspaceId(ctx, options.workspaceRoot)
  try {
    const usage = await options.client.usage(workspaceId, appName, identityFromToolContext(ctx), ctx.abortSignal)
    return { content: [{ type: "text", text: JSON.stringify(usage) }], details: usage }
  } catch (error) {
    return errorResult(`usage failed for "${appName}"`, error)
  }
}

const nonEmpty = z.string().trim().min(1)

const publishInput = z.object({
  action: z.literal("publish"),
  kind: z.enum(["app", "profile"]),
  name: nonEmpty.optional(),
  dir: nonEmpty.optional(),
  message: z.string().optional(),
}).strict()
const nameOnlyInput = (action: "versions" | "rollback" | "logs" | "usage") => z.object({
  action: z.literal(action),
  name: nonEmpty,
}).strict()
const activateInput = z.object({
  action: z.literal("activate"),
  name: nonEmpty,
  version: z.number(),
}).strict()
const undoProfileInput = z.object({ action: z.literal("undo_profile") }).strict()

const AppToolInputSchema = z.discriminatedUnion("action", [
  publishInput,
  nameOnlyInput("versions"),
  activateInput,
  nameOnlyInput("rollback"),
  undoProfileInput,
  nameOnlyInput("logs"),
  nameOnlyInput("usage"),
])

export type AppToolInput = z.infer<typeof AppToolInputSchema>
export type AppToolAction = AppToolInput["action"]

function invalidBody(message: string): ToolResult {
  return textResult(`app: ${message}`, true)
}

export function createAppTool(options: AppRunnerToolsOptions): AgentTool {
  return {
    name: APP_RUNNER_TOOL_NAME,
    description: [
      "Manage a published workspace app or per-user profile: publish it, or inspect and change what is live.",
      "publish (changes what is live): commit and publish apps/<name>/ (kind app) or profile/ (kind profile); returns URL, version, sha.",
      "activate, rollback, undo_profile (each changes what is live): switch the current version of an app, the previous version of an app, or the previous version of the caller's profile.",
      "versions, logs, usage (read-only): version history, recent console output, or request/user counts for the current version.",
    ].join(" "),
    promptSnippet: "Call app with action \"publish\" after writing or updating apps/<name>/ or profile/. Published tools.json manifests mount natively after activation; draft edits have no effect until publish.",
    parameters: appToolJsonSchema(),
    async execute(params: Record<string, unknown>, ctx: ToolExecContext): Promise<ToolResult> {
      const parsed = AppToolInputSchema.safeParse(params)
      if (!parsed.success) return invalidBody(zodErrorMessage(parsed.error))
      const input = parsed.data

      if (input.action === "publish") {
        if (input.kind === "profile") {
          if (input.name !== undefined) return invalidBody('"name" is not used for kind "profile"; the profile is the caller\'s own.')
          if (input.dir !== undefined) return invalidBody('"dir" is not supported for kind "profile".')
          return publishProfile(options, ctx, input.message)
        }
        if (!input.name) return invalidBody('"name" is required for kind "app".')
        const name = sanitizeName(input.name)
        if (!name) return invalidName("publish")
        const dir = input.dir?.trim() || `apps/${name}`
        return publishApp(options, ctx, name, dir, input.message)
      }

      if (input.action === "undo_profile") {
        return undoProfile(options, ctx)
      }

      const name = sanitizeName(input.name)
      if (!name) return invalidName(input.action)

      switch (input.action) {
        case "versions": return listVersions(options, ctx, name)
        case "rollback": return rollbackApp(options, ctx, name)
        case "logs": return getLogs(options, ctx, name)
        case "usage": return getUsage(options, ctx, name)
        case "activate": return activateVersion(options, ctx, name, input.version)
      }
    },
  }
}

function zodErrorMessage(error: z.ZodError): string {
  const issue = error.issues[0]
  if (!issue) return "invalid input."
  if (issue.code === "invalid_union_discriminator") {
    return `unknown action; expected one of ${(issue as z.ZodInvalidUnionDiscriminatorIssue).options.join(", ")}.`
  }
  const field = issue.path[0]
  if (field !== undefined) return `"${String(field)}" is invalid: ${issue.message}.`
  return `${issue.message}.`
}

function appToolJsonSchema(): Record<string, unknown> {
  const name = { type: "string", minLength: 1, description: "App or profile name previously published, or to publish." }
  const dir = { type: "string", minLength: 1, description: `Workspace-relative directory to publish for kind "app". Defaults to "${APP_RUNNER_DEFAULT_DIR}".` }
  const message = { type: "string", description: "Optional publish message shown in version history." }
  const version = { type: "number", description: "Version number to activate." }
  const actionOnly = (action: string, extra: Record<string, unknown> = {}, required: string[] = []) => ({
    type: "object",
    properties: { action: { const: action }, ...extra },
    required: ["action", ...required],
    additionalProperties: false,
  })
  return {
    oneOf: [
      actionOnly("publish", { kind: { enum: ["app", "profile"] }, name, dir, message }, ["kind"]),
      actionOnly("versions", { name }, ["name"]),
      actionOnly("activate", { name, version }, ["name", "version"]),
      actionOnly("rollback", { name }, ["name"]),
      actionOnly("undo_profile"),
      actionOnly("logs", { name }, ["name"]),
      actionOnly("usage", { name }, ["name"]),
    ],
  }
}

export function createAppRunnerTools(options: AppRunnerToolsOptions): AgentTool[] {
  return [createAppTool(options)]
}
