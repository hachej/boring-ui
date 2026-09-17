import { createHash } from "node:crypto"
import { types as utilTypes } from "node:util"
import type { RunContext } from "../../../shared/harness.js"
import type { AgentTool, RemoteCapabilityDescriptor, ToolExecContext, ToolResult } from "../../../shared/tool.js"
import { getEnv } from "../../config/env.js"

interface HubCurrent {
  version: number
  kind: string
  sha: string | null
  manifest: { tools: Array<{ name: string; description?: string; input?: Record<string, unknown> }> }
}

export interface RemoteCapabilityRuntimeOptions {
  baseUrl?: string
  token?: string
  authSecret?: string
  fetchImpl?: typeof fetch
}

const segment = (value: string) => createHash("sha256").update(value.normalize("NFC"), "utf8").digest("hex").slice(0, 20)

const result = (value: unknown, isError = false): ToolResult => ({
  content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }],
  details: value,
  ...(isError ? { isError: true } : {}),
})

function snapshotData(value: unknown, seen = new Set<object>()): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value !== "object" || utilTypes.isProxy(value) || seen.has(value)) {
    throw new Error("remote capability descriptor must be a plain serializable data object without accessors, proxies, or functions")
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null && prototype !== Array.prototype) {
    throw new Error("remote capability descriptor must be a plain serializable data object without accessors, proxies, or functions")
  }
  if (Object.getOwnPropertySymbols(value).length) {
    throw new Error("remote capability descriptor must be a plain serializable data object without accessors, proxies, or functions")
  }
  seen.add(value)
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const copy: unknown[] | Record<string, unknown> = Array.isArray(value) ? [] : Object.create(null)
  for (const [key, property] of Object.entries(descriptors)) {
    if (!("value" in property) || property.get || property.set || typeof property.value === "function") {
      throw new Error("remote capability descriptor must be a plain serializable data object without accessors, proxies, or functions")
    }
    if (Array.isArray(copy) && key === "length") continue
    copy[key as keyof typeof copy] = snapshotData(property.value, seen) as never
  }
  seen.delete(value)
  return copy
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`
  }
  return JSON.stringify(value)
}

function assertDescriptor(value: unknown): asserts value is RemoteCapabilityDescriptor {
  if (!value || typeof value !== "object") {
    throw new Error("remote capability descriptor must be a plain serializable data object without accessors, proxies, or functions")
  }
  const descriptor = value as Record<string, unknown>
  const allowed = new Set(["kind", "workspaceId", "address", "version", "sha", "toolName", "description", "inputSchema"])
  if (Object.keys(descriptor).some((key) => !allowed.has(key))
    || typeof descriptor.kind !== "string" || !descriptor.kind
    || typeof descriptor.workspaceId !== "string" || !descriptor.workspaceId
    || typeof descriptor.address !== "string" || !descriptor.address
    || !Number.isSafeInteger(descriptor.version) || (descriptor.version as number) < 1
    || typeof descriptor.sha !== "string" || !descriptor.sha
    || typeof descriptor.toolName !== "string" || !descriptor.toolName
    || typeof descriptor.description !== "string"
    || !descriptor.inputSchema || typeof descriptor.inputSchema !== "object" || Array.isArray(descriptor.inputSchema)) {
    throw new Error("remote capability descriptor is malformed")
  }
}

function identity(context: Pick<RunContext, "userId" | "userEmail">): { id: string; name: string; email?: string } {
  const id = context.userId?.trim()
  if (!id) throw new Error("authenticated user identity is required to mount remote capabilities")
  return { id, name: context.userEmail ?? id, ...(context.userEmail ? { email: context.userEmail } : {}) }
}

export async function buildVerifiedRemoteCapability(
  value: unknown,
  context: RunContext,
  options: RemoteCapabilityRuntimeOptions = {},
): Promise<AgentTool> {
  const descriptor = snapshotData(value)
  assertDescriptor(descriptor)
  if (descriptor.workspaceId !== context.workspaceId?.trim()) {
    throw new Error(`remote capability "${descriptor.toolName}" workspace does not match the authenticated workspace`)
  }
  const [addressWorkspace, appName, ...rest] = descriptor.address.split("/")
  if (rest.length || !addressWorkspace || !appName || addressWorkspace !== descriptor.workspaceId) {
    throw new Error(`remote capability "${descriptor.toolName}" has an invalid address`)
  }

  const baseUrl = (options.baseUrl ?? getEnv("BORING_APP_RUNNER_URL") ?? "http://127.0.0.1:9877").replace(/\/+$/, "")
  const fetchImpl = options.fetchImpl ?? fetch
  const actor = identity(context)
  const headers: Record<string, string> = {
    "X-Boring-User": JSON.stringify(actor),
    "X-Boring-Workspace": descriptor.workspaceId,
  }
  const token = options.token ?? getEnv("BORING_APP_RUNNER_TOKEN")
  const authSecret = options.authSecret ?? getEnv("BORING_APP_RUNNER_AUTH_SECRET")
  if (token) headers.Authorization = `Bearer ${token}`
  if (authSecret) headers["X-Boring-App-Auth"] = authSecret
  const path = `/w/${encodeURIComponent(descriptor.workspaceId)}/${encodeURIComponent(appName)}`
  const currentResponse = await fetchImpl(`${baseUrl}${path}/current`, {
    method: "GET",
    headers,
    signal: context.abortSignal,
  })
  if (!currentResponse.ok) throw new Error(`remote capability "${descriptor.toolName}" address did not resolve`)
  const current = await currentResponse.json() as HubCurrent
  const manifestTool = current.manifest?.tools?.find((tool) => tool.name === descriptor.toolName)
  const schema = manifestTool?.input ?? { type: "object", properties: {}, additionalProperties: false }
  if (current.kind !== descriptor.kind || current.version !== descriptor.version || current.sha !== descriptor.sha
    || !manifestTool || stableJson(schema) !== stableJson(descriptor.inputSchema)) {
    throw new Error(`remote capability "${descriptor.toolName}" does not match the fresh hub manifest`)
  }
  return Object.freeze({
    name: descriptor.kind === "profile"
      ? `profile_${segment(descriptor.toolName)}`
      : `app_${segment(appName)}_${segment(descriptor.toolName)}`,
    description: descriptor.description,
    parameters: descriptor.inputSchema,
    async execute(params: Record<string, unknown>, executionContext: ToolExecContext) {
      if (executionContext.workspaceId?.trim() !== descriptor.workspaceId) {
        return result(`Published tool ${descriptor.toolName} refused: executing workspace does not match its published workspace.`, true)
      }
      const executionActor = identity(executionContext)
      const executionHeaders = { ...headers, "X-Boring-User": JSON.stringify(executionActor), "Content-Type": "application/json" }
      const response = await fetchImpl(`${baseUrl}${path}/tools/${encodeURIComponent(descriptor.toolName)}?version=${descriptor.version}`, {
        method: "POST",
        headers: executionHeaders,
        body: JSON.stringify(params),
        signal: executionContext.abortSignal,
      })
      const body = await response.text()
      let parsed: unknown = body
      try { parsed = body ? JSON.parse(body) : undefined } catch { /* preserve text */ }
      return response.ok ? result(parsed) : result(`app runner responded ${response.status}: ${body}`, true)
    },
  })
}
