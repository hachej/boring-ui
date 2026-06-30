import {
  MCP_ERROR_CODES,
  McpError,
  containsMcpSecret,
  redactMcpSecrets,
  validateMcpToolName,
  type McpActor,
  type McpDoctorResult,
  type McpProbeResult,
  type McpReadonlyCallInput,
  type McpReadonlyCallResult,
  type McpSourceStatusPayload,
  type McpToolDescribeResult,
  type McpToolSearchResult,
} from "../shared"
import { assertMcpPublicPayloadSecretFree, validateMcpSourceId } from "./sourceAccess"
import type { BoringMcpSourceHandlers } from "./sourceHandlers"
import type { McpToolDescribeInput, McpToolsSearchInput } from "./toolCatalog"

export const BORING_MCP_AGENT_BRIDGE_TOOL_NAMES = [
  "mcp_servers_list",
  "mcp_server_status",
  "mcp_server_doctor",
  "mcp_server_probe",
  "mcp_tools_search",
  "mcp_tool_describe",
  "mcp_readonly_call",
] as const

export type BoringMcpAgentBridgeToolName = (typeof BORING_MCP_AGENT_BRIDGE_TOOL_NAMES)[number]

export interface BoringMcpAgentBridgeContext {
  actor: McpActor
}

export interface BoringMcpAgentBridgeToolDefinition {
  name: BoringMcpAgentBridgeToolName
  description: string
  inputSchema: Record<string, unknown>
  readOnly: true
}

export interface BoringMcpAgentBridgeTool<TInput = unknown, TResult = unknown> extends BoringMcpAgentBridgeToolDefinition {
  invoke(context: BoringMcpAgentBridgeContext, input: TInput): Promise<TResult>
}

export type BoringMcpAgentBridgeRegistry = Record<BoringMcpAgentBridgeToolName, BoringMcpAgentBridgeTool>

const EMPTY_INPUT_SCHEMA = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const

const SOURCE_ID_INPUT_SCHEMA = {
  type: "object",
  properties: {
    sourceId: { type: "string", description: "Stable boring-mcp source id." },
  },
  required: ["sourceId"],
  additionalProperties: false,
} as const

const TOOL_SEARCH_INPUT_SCHEMA = {
  type: "object",
  properties: {
    sourceId: { type: "string", description: "Optional source id to search within." },
    query: { type: "string", description: "Optional text query for tool name, summary, provider, or description." },
    refresh: { type: "boolean", description: "Refresh provider tool metadata before searching." },
  },
  additionalProperties: false,
} as const

const TOOL_DESCRIBE_INPUT_SCHEMA = {
  type: "object",
  properties: {
    sourceId: { type: "string", description: "Stable boring-mcp source id." },
    toolName: { type: "string", description: "Provider-native tool/action name." },
    expectedSchemaHash: { type: "string", description: "Optional sha256 schema hash to detect drift." },
    refresh: { type: "boolean", description: "Refresh provider tool metadata before describing." },
  },
  required: ["sourceId", "toolName"],
  additionalProperties: false,
} as const

const READONLY_CALL_INPUT_SCHEMA = {
  type: "object",
  properties: {
    sourceId: { type: "string", description: "Stable boring-mcp source id." },
    toolName: { type: "string", description: "Read-only provider-native tool/action name." },
    input: { description: "JSON-safe provider input for the read-only tool." },
    expectedSchemaHash: { type: "string", description: "Optional lowercase sha256 schema hash to detect drift before execution." },
  },
  required: ["sourceId", "toolName"],
  additionalProperties: false,
} as const

export const BORING_MCP_AGENT_BRIDGE_TOOL_DEFINITIONS: readonly BoringMcpAgentBridgeToolDefinition[] = [
  { name: "mcp_servers_list", description: "List MCP sources available to the current actor.", inputSchema: EMPTY_INPUT_SCHEMA, readOnly: true },
  { name: "mcp_server_status", description: "Get status and available actions for one MCP source.", inputSchema: SOURCE_ID_INPUT_SCHEMA, readOnly: true },
  { name: "mcp_server_doctor", description: "Diagnose configuration/status issues for one MCP source without provider execution.", inputSchema: SOURCE_ID_INPUT_SCHEMA, readOnly: true },
  { name: "mcp_server_probe", description: "Probe one connected MCP source for provider metadata and classified tools.", inputSchema: SOURCE_ID_INPUT_SCHEMA, readOnly: true },
  { name: "mcp_tools_search", description: "Search normalized MCP tool catalog entries across connected sources or one source.", inputSchema: TOOL_SEARCH_INPUT_SCHEMA, readOnly: true },
  { name: "mcp_tool_describe", description: "Describe one normalized MCP tool and report schema drift.", inputSchema: TOOL_DESCRIBE_INPUT_SCHEMA, readOnly: true },
  { name: "mcp_readonly_call", description: "Execute one governed read-only MCP tool call.", inputSchema: READONLY_CALL_INPUT_SCHEMA, readOnly: true },
]

function requireActor(context: BoringMcpAgentBridgeContext | undefined): McpActor {
  const actor = context?.actor
  if (!actor || typeof actor.userId !== "string" || typeof actor.workspaceId !== "string") {
    throw new McpError(MCP_ERROR_CODES.INPUT_INVALID, "MCP bridge tools require an explicit actor")
  }
  return actor
}

function inputRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new McpError(MCP_ERROR_CODES.INPUT_INVALID, "MCP bridge input must be an object")
  }
  return input as Record<string, unknown>
}

function optionalInputRecord(input: unknown): Record<string, unknown> {
  if (input === undefined) return {}
  return inputRecord(input)
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== "string") throw new McpError(MCP_ERROR_CODES.INPUT_INVALID, `MCP bridge ${key} must be a string`)
  return value
}

function optionalStringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (typeof value !== "string") throw new McpError(MCP_ERROR_CODES.INPUT_INVALID, `MCP bridge ${key} must be a string`)
  return value
}

function optionalBooleanField(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (typeof value !== "boolean") throw new McpError(MCP_ERROR_CODES.INPUT_INVALID, `MCP bridge ${key} must be a boolean`)
  return value
}

function parseEmptyInput(input: unknown): void {
  const record = optionalInputRecord(input)
  if (Object.keys(record).length > 0) throw new McpError(MCP_ERROR_CODES.INPUT_INVALID, "MCP bridge input must be empty")
}

function parseBridgeSourceId(sourceId: string): string {
  try {
    return validateMcpSourceId(sourceId)
  } catch {
    throw new McpError(MCP_ERROR_CODES.INPUT_INVALID, "MCP bridge sourceId is invalid")
  }
}

function parseSourceInput(input: unknown): { sourceId: string } {
  const record = inputRecord(input)
  return { sourceId: parseBridgeSourceId(stringField(record, "sourceId")) }
}

function parseSearchInput(input: unknown): McpToolsSearchInput {
  const record = optionalInputRecord(input)
  const sourceId = optionalStringField(record, "sourceId")
  return {
    sourceId: sourceId === undefined ? undefined : parseBridgeSourceId(sourceId),
    query: optionalStringField(record, "query"),
    refresh: optionalBooleanField(record, "refresh"),
  }
}

function parseDescribeInput(input: unknown): McpToolDescribeInput {
  const record = inputRecord(input)
  const toolName = stringField(record, "toolName")
  validateMcpToolName(toolName)
  return {
    sourceId: parseBridgeSourceId(stringField(record, "sourceId")),
    toolName,
    expectedSchemaHash: optionalStringField(record, "expectedSchemaHash"),
    refresh: optionalBooleanField(record, "refresh"),
  }
}

function parseReadonlyInput(input: unknown): McpReadonlyCallInput {
  const record = inputRecord(input)
  const toolName = stringField(record, "toolName")
  validateMcpToolName(toolName)
  const expectedSchemaHash = optionalStringField(record, "expectedSchemaHash")
  return {
    sourceId: parseBridgeSourceId(stringField(record, "sourceId")),
    toolName,
    input: record.input,
    expectedSchemaHash,
  }
}

async function invokeGuarded<TResult>(fn: () => Promise<TResult>): Promise<TResult> {
  try {
    const result = await fn()
    assertMcpPublicPayloadSecretFree(result)
    return result
  } catch (error) {
    if (error instanceof McpError) {
      const redactedDetails = redactMcpSecrets(error.details)
      const safeMessage = containsMcpSecret(error.message) ? "MCP bridge tool failed" : error.message
      throw new McpError(error.code, safeMessage, redactedDetails)
    }
    const redacted = redactMcpSecrets(error instanceof Error ? { name: error.name, message: error.message } : error)
    throw new McpError(MCP_ERROR_CODES.PROVIDER_ERROR, "MCP bridge tool failed", redacted)
  }
}

function tool<TInput, TResult>(
  definition: BoringMcpAgentBridgeToolDefinition,
  invoke: (actor: McpActor, input: TInput) => Promise<TResult>,
): BoringMcpAgentBridgeTool<TInput, TResult> {
  return {
    ...definition,
    async invoke(context, input) {
      const actor = requireActor(context)
      return invokeGuarded(() => invoke(actor, input))
    },
  }
}

export function createBoringMcpAgentBridgeRegistry(handlers: BoringMcpSourceHandlers): BoringMcpAgentBridgeRegistry {
  const byName = Object.fromEntries(BORING_MCP_AGENT_BRIDGE_TOOL_DEFINITIONS.map((definition) => [definition.name, definition])) as Record<BoringMcpAgentBridgeToolName, BoringMcpAgentBridgeToolDefinition>
  return {
    mcp_servers_list: tool(byName.mcp_servers_list, (actor, input: unknown) => {
      parseEmptyInput(input)
      return handlers.listSources(actor)
    }),
    mcp_server_status: tool(byName.mcp_server_status, (actor, input: unknown) => handlers.getSourceStatus(actor, parseSourceInput(input).sourceId)) as BoringMcpAgentBridgeTool<unknown, McpSourceStatusPayload>,
    mcp_server_doctor: tool(byName.mcp_server_doctor, (actor, input: unknown) => handlers.doctorSource(actor, parseSourceInput(input).sourceId)) as BoringMcpAgentBridgeTool<unknown, McpDoctorResult>,
    mcp_server_probe: tool(byName.mcp_server_probe, (actor, input: unknown) => handlers.probeSource(actor, parseSourceInput(input).sourceId)) as BoringMcpAgentBridgeTool<unknown, McpProbeResult>,
    mcp_tools_search: tool(byName.mcp_tools_search, (actor, input: unknown) => handlers.mcp_tools_search(actor, parseSearchInput(input))) as BoringMcpAgentBridgeTool<unknown, McpToolSearchResult>,
    mcp_tool_describe: tool(byName.mcp_tool_describe, (actor, input: unknown) => handlers.mcp_tool_describe(actor, parseDescribeInput(input))) as BoringMcpAgentBridgeTool<unknown, McpToolDescribeResult>,
    mcp_readonly_call: tool(byName.mcp_readonly_call, (actor, input: unknown) => handlers.mcp_readonly_call(actor, parseReadonlyInput(input))) as BoringMcpAgentBridgeTool<unknown, McpReadonlyCallResult>,
  }
}

export function listBoringMcpAgentBridgeTools(registry: BoringMcpAgentBridgeRegistry): BoringMcpAgentBridgeTool[] {
  return BORING_MCP_AGENT_BRIDGE_TOOL_NAMES.map((name) => registry[name])
}
