import {
  MCP_ERROR_CODES,
  McpError,
  classifyMcpTool,
  containsMcpSecret,
  getMcpProviderTemplate,
  redactMcpSecrets,
  validateMcpToolName,
  type McpActor,
  type McpProviderTemplate,
  type McpReadonlyCallAuditEvent,
  type McpReadonlyCallInput,
  type McpReadonlyCallResult,
  type McpSourceRegistry,
  type McpToolCatalogEntry,
  type McpTransportClient,
} from "../shared"
import { assertMcpPublicPayloadSecretFree, requireActorOwnedMcpSource, validateMcpSourceId } from "./sourceAccess"
import { createBoringMcpToolCatalog, type McpToolCatalogCache } from "./toolCatalog"

export interface McpReadonlyCallAuditSink {
  record(event: McpReadonlyCallAuditEvent): void | Promise<void>
}

export interface BoringMcpReadonlyCallOptions {
  registry: McpSourceRegistry
  transport: McpTransportClient
  templates?: readonly McpProviderTemplate[]
  maxInputBytes?: number
  audit?: McpReadonlyCallAuditSink
  catalogCache?: McpToolCatalogCache
}

export interface BoringMcpReadonlyCaller {
  callReadonly(actor: McpActor, input: McpReadonlyCallInput): Promise<McpReadonlyCallResult>
}

interface ParsedReadonlyCall {
  sourceId: string
  toolName: string
  expectedSchemaHash?: string
  toolInput: unknown
}

const DEFAULT_MAX_INPUT_BYTES = 64 * 1024
const INVALID_AUDIT_VALUE = "[invalid]"

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function normalizeJsonValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new McpError(MCP_ERROR_CODES.INPUT_INVALID, "MCP tool input must be JSON-safe")
    return value
  }
  if (Array.isArray(value)) return value.map(normalizeJsonValue)
  if (isPlainRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, normalizeJsonValue(nested)]))
  }
  throw new McpError(MCP_ERROR_CODES.INPUT_INVALID, "MCP tool input must be JSON-safe")
}

function inputSizeBytes(input: unknown): number {
  return new TextEncoder().encode(JSON.stringify(input)).byteLength
}

function parseReadonlyCall(input: unknown, maxInputBytes: number): ParsedReadonlyCall {
  if (!isPlainRecord(input)) throw new McpError(MCP_ERROR_CODES.INPUT_INVALID, "MCP readonly call input must be an object")
  if (typeof input.sourceId !== "string") throw new McpError(MCP_ERROR_CODES.INPUT_INVALID, "MCP sourceId must be a string")
  if (typeof input.toolName !== "string") throw new McpError(MCP_ERROR_CODES.INPUT_INVALID, "MCP toolName must be a string")
  if (input.expectedSchemaHash !== undefined && (typeof input.expectedSchemaHash !== "string" || !isValidSchemaHash(input.expectedSchemaHash))) {
    throw new McpError(MCP_ERROR_CODES.INPUT_INVALID, "MCP expectedSchemaHash must be a sha256 schema hash")
  }

  if (containsMcpSecret(input.sourceId) || containsMcpSecret(input.toolName)) {
    throw new McpError(MCP_ERROR_CODES.INPUT_INVALID, "MCP readonly call identifiers looked like they contained a secret")
  }

  const toolInput = normalizeJsonValue(input.input ?? {})
  if (inputSizeBytes(toolInput) > maxInputBytes) {
    throw new McpError(MCP_ERROR_CODES.RESOURCE_LIMIT_EXCEEDED, "MCP tool input is too large")
  }
  if (containsMcpSecret(toolInput)) {
    throw new McpError(MCP_ERROR_CODES.SECRET_LEAK_GUARD, "MCP tool input looked like it contained a secret")
  }

  const sourceId = validateMcpSourceId(input.sourceId)
  validateMcpToolName(input.toolName)
  return {
    sourceId,
    toolName: input.toolName,
    expectedSchemaHash: input.expectedSchemaHash,
    toolInput,
  }
}

function assertReadOnlyTool(tool: McpToolCatalogEntry): void {
  if (!tool.enabled || tool.risk !== "read") {
    throw new McpError(MCP_ERROR_CODES.TOOL_NOT_ALLOWED, tool.blockedReasons[0] ?? "MCP tool is not allowed for read-only execution")
  }
}

function assertSchemaCurrent(tool: McpToolCatalogEntry, expectedSchemaHash?: string): void {
  if (expectedSchemaHash && expectedSchemaHash !== tool.schemaHash) {
    throw new McpError(MCP_ERROR_CODES.PROVIDER_TOOL_DRIFT, "MCP tool schema changed before execution")
  }
}

function assertTemplateAllowsReadonly(sourceProvider: string, toolName: string, templates?: readonly McpProviderTemplate[]): void {
  const template = getMcpProviderTemplate(sourceProvider, templates)
  const decision = template
    ? classifyMcpTool(template, toolName)
    : { allowed: false, risk: "unknown" as const, reason: "Tool provider has no read-only allowlist" }
  if (!decision.allowed || decision.risk !== "read") throw new McpError(MCP_ERROR_CODES.TOOL_NOT_ALLOWED, decision.reason)
}

function auditEvent(
  actor: McpActor,
  input: Pick<McpReadonlyCallInput, "sourceId" | "toolName" | "expectedSchemaHash">,
  outcome: McpReadonlyCallAuditEvent["outcome"],
  code?: string,
): McpReadonlyCallAuditEvent {
  return {
    operation: "mcp_readonly_call",
    outcome,
    workspaceId: actor.workspaceId,
    userId: actor.userId,
    sourceId: input.sourceId,
    toolName: input.toolName,
    expectedSchemaHash: input.expectedSchemaHash,
    code,
  }
}

function toErrorCode(error: unknown): string {
  return error instanceof McpError ? error.code : MCP_ERROR_CODES.PROVIDER_ERROR
}

function isValidSchemaHash(value: string): boolean {
  return /^sha256:[a-f0-9]{64}$/.test(value)
}

function auditSourceId(value: unknown): string {
  if (typeof value !== "string" || containsMcpSecret(value)) return INVALID_AUDIT_VALUE
  try {
    return validateMcpSourceId(value)
  } catch {
    return INVALID_AUDIT_VALUE
  }
}

function auditToolName(value: unknown): string {
  if (typeof value !== "string" || containsMcpSecret(value)) return INVALID_AUDIT_VALUE
  try {
    validateMcpToolName(value)
    return value
  } catch {
    return INVALID_AUDIT_VALUE
  }
}

function auditSchemaHash(value: unknown): string | undefined {
  return typeof value === "string" && !containsMcpSecret(value) && isValidSchemaHash(value) ? value : undefined
}

export function createBoringMcpReadonlyCaller(options: BoringMcpReadonlyCallOptions): BoringMcpReadonlyCaller {
  const catalog = createBoringMcpToolCatalog({ ...options, cache: options.catalogCache })
  const maxInputBytes = options.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES

  async function record(event: McpReadonlyCallAuditEvent): Promise<void> {
    try {
      await options.audit?.record(event)
    } catch {
      // Audit is metadata-only and must not mask security decisions or successful provider calls.
    }
  }

  return {
    async callReadonly(actor, input) {
      const raw: Record<string, unknown> = isPlainRecord(input) ? input : {}
      let request: Pick<McpReadonlyCallInput, "sourceId" | "toolName" | "expectedSchemaHash"> = {
        sourceId: auditSourceId(raw.sourceId),
        toolName: auditToolName(raw.toolName),
        expectedSchemaHash: auditSchemaHash(raw.expectedSchemaHash),
      }
      let audited = false
      try {
        const parsed = parseReadonlyCall(input, maxInputBytes)
        request = parsed
        const source = await requireActorOwnedMcpSource(options.registry, actor, parsed.sourceId)
        if (source.status !== "connected") throw new McpError(MCP_ERROR_CODES.SOURCE_UNAVAILABLE, "MCP source is not connected")

        // Deny before provider discovery: only pre-approved read tools may reach listTools/callTool.
        assertTemplateAllowsReadonly(source.provider, parsed.toolName, options.templates)

        const described = await catalog.describeTool(actor, {
          sourceId: parsed.sourceId,
          toolName: parsed.toolName,
          expectedSchemaHash: parsed.expectedSchemaHash,
          refresh: true,
        })
        assertReadOnlyTool(described.tool)
        assertSchemaCurrent(described.tool, parsed.expectedSchemaHash)

        let providerResult: unknown
        try {
          providerResult = await options.transport.callTool(source, parsed.toolName, parsed.toolInput)
        } catch (error) {
          if (error instanceof McpError) {
            const safeMessage = containsMcpSecret(error.message) ? "MCP provider tool call failed" : error.message
            await record(auditEvent(actor, request, "failure", error.code))
            audited = true
            throw new McpError(error.code, safeMessage, redactMcpSecrets(error.details))
          }
          const redacted = redactMcpSecrets(error instanceof Error ? { name: error.name, message: error.message } : error)
          await record(auditEvent(actor, request, "failure", MCP_ERROR_CODES.PROVIDER_ERROR))
          audited = true
          throw new McpError(MCP_ERROR_CODES.PROVIDER_ERROR, "MCP provider tool call failed", redacted)
        }

        const redacted = redactMcpSecrets(providerResult)
        if (containsMcpSecret(providerResult)) {
          await record(auditEvent(actor, request, "failure", MCP_ERROR_CODES.SECRET_LEAK_GUARD))
          audited = true
          throw new McpError(MCP_ERROR_CODES.SECRET_LEAK_GUARD, "MCP provider response looked like it contained a secret")
        }
        const response = { content: redacted }
        assertMcpPublicPayloadSecretFree(response)
        await record(auditEvent(actor, request, "success"))
        audited = true
        return response
      } catch (error) {
        const code = toErrorCode(error)
        if (!audited) {
          await record(auditEvent(actor, request, "blocked", code))
        }
        throw error
      }
    },
  }
}
