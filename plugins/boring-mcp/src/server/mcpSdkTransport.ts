import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import {
  MCP_ERROR_CODES,
  McpError,
  redactMcpSecrets,
  type McpDiscoveredResource,
  type McpDiscoveredTool,
  type McpSource,
  type McpToolCallResult,
  type McpTransportClient,
} from "../shared"

export interface McpSdkEndpointResolverInput {
  source: McpSource
}

export interface McpSdkEndpoint {
  url: string | URL
  headers?: Record<string, string>
}

export interface McpSdkTransportOptions {
  endpoint: McpSdkEndpoint | ((input: McpSdkEndpointResolverInput) => McpSdkEndpoint | Promise<McpSdkEndpoint>)
  clientName?: string
  clientVersion?: string
}

async function resolveEndpoint(options: McpSdkTransportOptions, source: McpSource): Promise<McpSdkEndpoint> {
  return typeof options.endpoint === "function" ? options.endpoint({ source }) : options.endpoint
}

function normalizeUrl(value: string | URL): URL {
  try {
    return value instanceof URL ? value : new URL(value)
  } catch {
    throw new McpError(MCP_ERROR_CODES.PROVIDER_CONFIG_INVALID, "Invalid MCP endpoint URL")
  }
}

function normalizeHeaders(headers: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!headers) return undefined
  return Object.fromEntries(Object.entries(headers).filter(([key, value]) => key.trim() && typeof value === "string"))
}

function normalizeError(error: unknown): McpError {
  if (error instanceof McpError) return error
  const message = error instanceof Error ? error.message : String(error)
  return new McpError(MCP_ERROR_CODES.PROVIDER_ERROR, "MCP provider request failed", { message: redactMcpSecrets(message) })
}

async function withClient<T>(options: McpSdkTransportOptions, source: McpSource, run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ name: options.clientName ?? "boring-mcp", version: options.clientVersion ?? "0.0.0" })
  try {
    const endpoint = await resolveEndpoint(options, source)
    const transport = new StreamableHTTPClientTransport(normalizeUrl(endpoint.url), {
      requestInit: { headers: normalizeHeaders(endpoint.headers) },
    })
    await client.connect(transport)
    return await run(client)
  } catch (error) {
    throw normalizeError(error)
  } finally {
    await client.close().catch(() => undefined)
  }
}

function normalizeTool(tool: { name: string; description?: string; inputSchema?: unknown }): McpDiscoveredTool {
  return { name: tool.name, description: tool.description, inputSchema: tool.inputSchema }
}

function normalizeResource(resource: { uri: string; name?: string; description?: string; mimeType?: string }): McpDiscoveredResource {
  return { uri: resource.uri, name: resource.name, description: resource.description, mimeType: resource.mimeType }
}

export function createMcpSdkStreamableHttpTransport(options: McpSdkTransportOptions): McpTransportClient {
  return {
    async listTools(source) {
      return withClient(options, source, async (client) => {
        const result = await client.listTools()
        return result.tools.map(normalizeTool)
      })
    },

    async listResources(source) {
      return withClient(options, source, async (client) => {
        const result = await client.listResources()
        return result.resources.map(normalizeResource)
      })
    },

    async readResource(source, uri) {
      return withClient(options, source, async (client) => client.readResource({ uri }))
    },

    async callTool(source, toolName, input): Promise<McpToolCallResult> {
      return withClient(options, source, async (client) => {
        const result = await client.callTool({ name: toolName, arguments: input && typeof input === "object" ? input as Record<string, unknown> : {} })
        return { content: result.content }
      })
    },
  }
}
