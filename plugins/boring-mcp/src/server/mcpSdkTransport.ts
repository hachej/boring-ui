import { lookup as dnsLookup } from "node:dns/promises"
import type { LookupAddress, LookupOptions } from "node:dns"
import { isIP } from "node:net"
import { Agent, fetch as undiciFetch } from "undici"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import {
  MCP_ERROR_CODES,
  McpError,
  isBlockedMcpEndpointIpAddress,
  isUserRegisteredMcpSource,
  redactMcpSecrets,
  validateUserRegisteredMcpEndpoint,
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

export interface McpSdkResolvedAddress {
  address: string
  family: 4 | 6
}

export type McpSdkDnsResolver = (hostname: string) => Promise<readonly McpSdkResolvedAddress[]>

export interface McpSdkTransportOptions {
  endpoint: McpSdkEndpoint | ((input: McpSdkEndpointResolverInput) => McpSdkEndpoint | Promise<McpSdkEndpoint>)
  clientName?: string
  clientVersion?: string
  /** Test/embedding seam; production defaults to node:dns lookup with all records. */
  dnsResolver?: McpSdkDnsResolver
}

async function resolveEndpoint(options: McpSdkTransportOptions, source: McpSource): Promise<McpSdkEndpoint> {
  return typeof options.endpoint === "function" ? options.endpoint({ source }) : options.endpoint
}

export function snapshotMcpEndpointUrl(value: string | URL): URL {
  try {
    return new URL(value.toString())
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

async function defaultDnsResolver(hostname: string): Promise<readonly McpSdkResolvedAddress[]> {
  const addresses = await dnsLookup(hostname, { all: true, verbatim: true })
  return addresses.filter((entry): entry is McpSdkResolvedAddress => entry.family === 4 || entry.family === 6)
}

/** Resolve every address once, reject the whole hostname if any answer is unsafe, then select one vetted address to pin. */
export async function resolveUserRegisteredMcpAddress(
  hostname: string,
  resolver: McpSdkDnsResolver = defaultDnsResolver,
): Promise<McpSdkResolvedAddress> {
  let addresses: readonly McpSdkResolvedAddress[]
  try {
    addresses = await resolver(hostname)
  } catch {
    throw new McpError(
      MCP_ERROR_CODES.USER_REGISTERED_ENDPOINT_HOST_BLOCKED,
      "User-registered MCP endpoint hostname could not be resolved",
      { reason: "dns_resolution_failed" },
    )
  }
  if (addresses.length === 0) {
    throw new McpError(
      MCP_ERROR_CODES.USER_REGISTERED_ENDPOINT_HOST_BLOCKED,
      "User-registered MCP endpoint hostname did not resolve to an IP address",
      { reason: "dns_resolution_failed" },
    )
  }
  if (addresses.some(({ address, family }) => isIP(address) !== family || isBlockedMcpEndpointIpAddress(address))) {
    throw new McpError(
      MCP_ERROR_CODES.USER_REGISTERED_ENDPOINT_HOST_BLOCKED,
      "User-registered MCP endpoint resolved to a blocked network address",
      { reason: "resolved_address_blocked" },
    )
  }
  return addresses[0]
}

export function createPinnedMcpDispatcher(hostname: string, pinned: McpSdkResolvedAddress): Agent {
  return new Agent({
    connect: {
      lookup(requestedHostname: string, options: LookupOptions, callback: (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void) {
        if (requestedHostname.toLowerCase().replace(/\.$/, "") !== hostname.toLowerCase().replace(/\.$/, "")) {
          const error = new Error("Pinned MCP dispatcher refused an unexpected hostname") as NodeJS.ErrnoException
          error.code = "ENOTFOUND"
          callback(error, "", 0)
          return
        }
        if (options.all) callback(null, [pinned])
        else callback(null, pinned.address, pinned.family)
      },
    },
  })
}

export function createPinnedMcpFetch(dispatcher: Agent): typeof globalThis.fetch {
  return (input, init) => {
    const requestUrl = typeof input === "string" || input instanceof URL ? input : input.url
    const undiciInit = init as Parameters<typeof undiciFetch>[1]
    return undiciFetch(requestUrl, { ...undiciInit, dispatcher, redirect: "error" }) as unknown as Promise<Response>
  }
}

async function withClient<T>(options: McpSdkTransportOptions, source: McpSource, run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ name: options.clientName ?? "boring-mcp", version: options.clientVersion ?? "0.0.0" })
  let dispatcher: Agent | undefined
  try {
    const endpoint = await resolveEndpoint(options, source)
    const url = snapshotMcpEndpointUrl(endpoint.url)
    const requestInit: RequestInit = { headers: normalizeHeaders(endpoint.headers) }
    let fetch: typeof globalThis.fetch | undefined

    if (isUserRegisteredMcpSource(source)) {
      validateUserRegisteredMcpEndpoint(url.toString(), "streamable-http")
      const hostname = url.hostname.replace(/^\[|\]$/g, "")
      const pinned = await resolveUserRegisteredMcpAddress(hostname, options.dnsResolver)
      dispatcher = createPinnedMcpDispatcher(hostname, pinned)
      requestInit.redirect = "error"
      fetch = createPinnedMcpFetch(dispatcher)
    }

    const transport = new StreamableHTTPClientTransport(url, { requestInit, fetch })
    await client.connect(transport)
    return await run(client)
  } catch (error) {
    throw normalizeError(error)
  } finally {
    await client.close().catch(() => undefined)
    await dispatcher?.close().catch(() => undefined)
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
