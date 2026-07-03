import {
  BORING_MCP_PLUGIN_ID,
  MCP_ERROR_CODES,
  McpError,
  containsMcpSecret,
  redactMcpSecrets,
  type McpActor,
  type McpProviderTemplate,
  type McpSource,
  type McpSourceRegistry,
  type McpTransportClient,
} from "../shared"
import { BORING_MCP_AGENT_BRIDGE_TOOL_NAMES, type BoringMcpAgentBridgeRegistry } from "./agentBridge"
import { assertMcpPublicPayloadSecretFree, createMcpSourceStatusPayload, isActorOwnedMcpSource } from "./sourceAccess"

export type McpProviderOperation = "listTools" | "listResources" | "readResource" | "callTool"

export interface McpProviderCallContext {
  actor?: McpActor
  sourceId: string
  operation: McpProviderOperation
  toolName?: string
}

export interface McpProviderRateBudgetGate {
  check(context: McpProviderCallContext): void | Promise<void>
}

export interface McpProviderHardeningOptions {
  timeoutMs?: number
  metadataRetries?: number
  gate?: McpProviderRateBudgetGate
}

export interface InMemoryMcpRateBudgetGateOptions {
  maxCalls: number
  windowMs: number
  maxToolCalls?: number
}

export class InMemoryMcpRateBudgetGate implements McpProviderRateBudgetGate {
  private readonly buckets = new Map<string, { startedAt: number; calls: number; toolCalls: number }>()

  constructor(private readonly options: InMemoryMcpRateBudgetGateOptions) {}

  check(context: McpProviderCallContext): void {
    const now = Date.now()
    const key = `${context.actor?.workspaceId ?? "unknown"}:${context.actor?.userId ?? "unknown"}:${context.sourceId}`
    const current = this.buckets.get(key)
    const bucket = current && now - current.startedAt < this.options.windowMs
      ? current
      : { startedAt: now, calls: 0, toolCalls: 0 }
    bucket.calls += 1
    if (context.operation === "callTool") bucket.toolCalls += 1
    this.buckets.set(key, bucket)

    if (bucket.calls > this.options.maxCalls) {
      throw new McpError(MCP_ERROR_CODES.RESOURCE_LIMIT_EXCEEDED, "MCP provider rate budget exceeded")
    }
    if (this.options.maxToolCalls !== undefined && bucket.toolCalls > this.options.maxToolCalls) {
      throw new McpError(MCP_ERROR_CODES.RESOURCE_LIMIT_EXCEEDED, "MCP provider tool-call budget exceeded")
    }
  }
}

function isAbortLike(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")
}

async function withProviderTimeout<T>(operation: () => Promise<T>, timeoutMs?: number): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) return operation()
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation(),
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new McpError(MCP_ERROR_CODES.PROVIDER_TIMEOUT, "MCP provider operation timed out")), timeoutMs)
      }),
    ])
  } catch (error) {
    if (error instanceof McpError && error.code === MCP_ERROR_CODES.PROVIDER_TIMEOUT) throw error
    if (isAbortLike(error)) throw new McpError(MCP_ERROR_CODES.PROVIDER_TIMEOUT, "MCP provider operation timed out")
    throw error
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

async function withMetadataRetry<T>(operation: () => Promise<T>, retries: number): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      if (error instanceof McpError) throw error
      lastError = error
    }
  }
  throw lastError
}

function normalizeProviderError(error: unknown): never {
  if (error instanceof McpError) {
    const safeMessage = containsMcpSecret(error.message) ? "MCP provider operation failed" : error.message
    throw new McpError(error.code, safeMessage, redactMcpSecrets(error.details))
  }
  const details = redactMcpSecrets(error instanceof Error ? { name: error.name, message: error.message } : error)
  throw new McpError(MCP_ERROR_CODES.PROVIDER_ERROR, "MCP provider operation failed", details)
}

export function createHardenedMcpTransport(
  transport: McpTransportClient,
  options: McpProviderHardeningOptions = {},
  actor?: McpActor,
): McpTransportClient {
  async function guard<T>(context: Omit<McpProviderCallContext, "actor">, operation: () => Promise<T>, retryMetadata = false): Promise<T> {
    const run = async () => {
      await options.gate?.check({ ...context, actor })
      return withProviderTimeout(operation, options.timeoutMs)
    }
    try {
      return retryMetadata ? await withMetadataRetry(run, options.metadataRetries ?? 0) : await run()
    } catch (error) {
      normalizeProviderError(error)
    }
  }

  return {
    listTools(source, input) {
      return guard({ sourceId: source.id, operation: "listTools" }, () => transport.listTools(source, input), true)
    },
    listResources(source) {
      return guard({ sourceId: source.id, operation: "listResources" }, () => transport.listResources(source), true)
    },
    readResource(source, uri) {
      return guard({ sourceId: source.id, operation: "readResource" }, () => transport.readResource(source, uri), true)
    },
    callTool(source, toolName, input) {
      return guard({ sourceId: source.id, operation: "callTool", toolName }, () => transport.callTool(source, toolName, input), false)
    },
  }
}

export async function verifyMcpDisconnectResult(
  registry: McpSourceRegistry,
  actor: McpActor,
  sourceId: string,
  disconnected: McpSource | undefined,
) {
  if (!isActorOwnedMcpSource(actor, disconnected)) {
    throw new McpError(MCP_ERROR_CODES.SOURCE_NOT_FOUND, "MCP source not found")
  }
  const disconnectedSource = disconnected
  const latest = await registry.getSource(sourceId)
  const source = isActorOwnedMcpSource(actor, latest) ? latest : disconnectedSource
  if (source.status === "connected") {
    throw new McpError(MCP_ERROR_CODES.SOURCE_UNAVAILABLE, "MCP source disconnect verification failed")
  }
  const result = createMcpSourceStatusPayload(source)
  assertMcpPublicPayloadSecretFree(result)
  return result
}

export interface BoringMcpLaunchGateInput {
  pluginId?: string
  registry?: McpSourceRegistry
  transport?: McpTransportClient
  bridge?: Partial<BoringMcpAgentBridgeRegistry>
  templates?: readonly McpProviderTemplate[]
  hardening?: McpProviderHardeningOptions
  maxReadonlyInputBytes?: number
  docsReviewed?: boolean
}

export type BoringMcpLaunchGateIssueCode =
  | "MCP_LAUNCH_PLUGIN_MISSING"
  | "MCP_LAUNCH_REGISTRY_INCOMPLETE"
  | "MCP_LAUNCH_TRANSPORT_MISSING"
  | "MCP_LAUNCH_BRIDGE_TOOL_MISSING"
  | "MCP_LAUNCH_TEMPLATES_MISSING"
  | "MCP_LAUNCH_RATE_BUDGET_MISSING"
  | "MCP_LAUNCH_TIMEOUT_MISSING"
  | "MCP_LAUNCH_INPUT_LIMIT_MISSING"
  | "MCP_LAUNCH_OPERATOR_DOCS_MISSING"
  | "MCP_LAUNCH_SECRET_LEAK"

export interface BoringMcpLaunchGateIssue {
  level: "error"
  code: BoringMcpLaunchGateIssueCode
  message: string
}

export interface BoringMcpLaunchGateResult {
  ok: boolean
  issues: BoringMcpLaunchGateIssue[]
}

function issue(code: BoringMcpLaunchGateIssueCode, message: string): BoringMcpLaunchGateIssue {
  return { level: "error", code, message }
}

export function evaluateBoringMcpLaunchGate(input: BoringMcpLaunchGateInput): BoringMcpLaunchGateResult {
  const issues: BoringMcpLaunchGateIssue[] = []
  if (input.pluginId !== BORING_MCP_PLUGIN_ID) issues.push(issue("MCP_LAUNCH_PLUGIN_MISSING", "boring-mcp plugin id is not enabled"))
  if (!input.registry?.listSources || !input.registry.getSource || !input.registry.disconnectSource) issues.push(issue("MCP_LAUNCH_REGISTRY_INCOMPLETE", "source registry must support list/get/disconnect"))
  if (!input.transport?.listTools || !input.transport.listResources || !input.transport.readResource || !input.transport.callTool) issues.push(issue("MCP_LAUNCH_TRANSPORT_MISSING", "MCP transport client is not configured"))
  for (const name of BORING_MCP_AGENT_BRIDGE_TOOL_NAMES) {
    if (!input.bridge?.[name]) issues.push(issue("MCP_LAUNCH_BRIDGE_TOOL_MISSING", `missing bridge tool ${name}`))
  }
  if (!input.templates?.length) issues.push(issue("MCP_LAUNCH_TEMPLATES_MISSING", "at least one provider template must be configured"))
  if (!input.hardening?.gate) issues.push(issue("MCP_LAUNCH_RATE_BUDGET_MISSING", "rate/budget gate is not configured"))
  if (!input.hardening?.timeoutMs || input.hardening.timeoutMs <= 0) issues.push(issue("MCP_LAUNCH_TIMEOUT_MISSING", "provider timeout is not configured"))
  if (!input.maxReadonlyInputBytes || input.maxReadonlyInputBytes <= 0) issues.push(issue("MCP_LAUNCH_INPUT_LIMIT_MISSING", "read-only input byte limit is not configured"))
  if (!input.docsReviewed) issues.push(issue("MCP_LAUNCH_OPERATOR_DOCS_MISSING", "operator smoke checklist has not been reviewed"))
  if (containsMcpSecret(input)) issues.push(issue("MCP_LAUNCH_SECRET_LEAK", "launch gate input looked like it contained a secret"))
  return { ok: issues.length === 0, issues }
}
