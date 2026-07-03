import {
  MCP_ERROR_CODES,
  McpAccessFacade,
  McpError,
  doctorMcpSource,
  toMcpSourceDto,
  type McpActor,
  type McpDoctorResult,
  type McpProbeResult,
  type McpProviderTemplate,
  type McpSourceDto,
  type McpSourceRegistry,
  type McpSourceStatusPayload,
  type McpReadonlyCallInput,
  type McpReadonlyCallResult,
  type McpToolDescribeResult,
  type McpToolSearchResult,
  type McpTransportClient,
} from "../shared"
import { createHardenedMcpTransport, verifyMcpDisconnectResult, type McpProviderHardeningOptions } from "./hardening"
import { assertMcpPublicPayloadSecretFree, createMcpSourceStatusPayload, requireActorOwnedMcpSource, validateMcpSourceId } from "./sourceAccess"
import { createBoringMcpReadonlyCaller, type McpReadonlyCallAuditSink } from "./readonlyCall"
import { InMemoryMcpToolCatalogCache, createBoringMcpToolCatalog, type McpToolDescribeInput, type McpToolsSearchInput } from "./toolCatalog"

export interface BoringMcpSourceHandlersOptions {
  registry: McpSourceRegistry
  transport: McpTransportClient
  templates?: readonly McpProviderTemplate[]
  maxReadonlyInputBytes?: number
  audit?: McpReadonlyCallAuditSink
  hardening?: McpProviderHardeningOptions
}

export interface BoringMcpSourceHandlers {
  listSources(actor: McpActor): Promise<{ sources: McpSourceDto[] }>
  getSourceStatus(actor: McpActor, sourceId: string): Promise<McpSourceStatusPayload>
  doctorSource(actor: McpActor, sourceId: string): Promise<McpDoctorResult>
  probeSource(actor: McpActor, sourceId: string): Promise<McpProbeResult>
  searchTools(actor: McpActor, input?: McpToolsSearchInput): Promise<McpToolSearchResult>
  describeTool(actor: McpActor, input: McpToolDescribeInput): Promise<McpToolDescribeResult>
  mcp_tools_search(actor: McpActor, input?: McpToolsSearchInput): Promise<McpToolSearchResult>
  mcp_tool_describe(actor: McpActor, input: McpToolDescribeInput): Promise<McpToolDescribeResult>
  callReadonly(actor: McpActor, input: McpReadonlyCallInput): Promise<McpReadonlyCallResult>
  mcp_readonly_call(actor: McpActor, input: McpReadonlyCallInput): Promise<McpReadonlyCallResult>
  disconnectSource(actor: McpActor, sourceId: string): Promise<McpSourceStatusPayload>
}

export function createBoringMcpSourceHandlers(options: BoringMcpSourceHandlersOptions): BoringMcpSourceHandlers {
  const catalogCache = new InMemoryMcpToolCatalogCache()

  function transportFor(actor: McpActor) {
    return createHardenedMcpTransport(options.transport, options.hardening, actor)
  }

  function facadeFor(actor: McpActor) {
    return new McpAccessFacade({ store: options.registry, transport: transportFor(actor), templates: options.templates })
  }

  function catalogFor(actor: McpActor) {
    return createBoringMcpToolCatalog({ ...options, transport: transportFor(actor), cache: catalogCache })
  }

  function readonlyCallerFor(actor: McpActor) {
    return createBoringMcpReadonlyCaller({
      registry: options.registry,
      transport: transportFor(actor),
      templates: options.templates,
      maxInputBytes: options.maxReadonlyInputBytes,
      audit: options.audit,
      catalogCache,
    })
  }

  return {
    async listSources(actor) {
      const result = { sources: (await facadeFor(actor).listSources(actor)).map(toMcpSourceDto) }
      assertMcpPublicPayloadSecretFree(result)
      return result
    },

    async getSourceStatus(actor, sourceId) {
      const source = await requireActorOwnedMcpSource(options.registry, actor, sourceId)
      return createMcpSourceStatusPayload(source)
    },

    async doctorSource(actor, sourceId) {
      const source = await requireActorOwnedMcpSource(options.registry, actor, sourceId)
      const result = doctorMcpSource(source, options.templates)
      assertMcpPublicPayloadSecretFree(result)
      return result
    },

    async probeSource(actor, sourceId) {
      const normalizedSourceId = validateMcpSourceId(sourceId)
      const result = await facadeFor(actor).probeSource(actor, normalizedSourceId)
      assertMcpPublicPayloadSecretFree(result)
      return result
    },

    async searchTools(actor, input) {
      return catalogFor(actor).searchTools(actor, input)
    },

    async describeTool(actor, input) {
      return catalogFor(actor).describeTool(actor, input)
    },

    async mcp_tools_search(actor, input) {
      return catalogFor(actor).searchTools(actor, input)
    },

    async mcp_tool_describe(actor, input) {
      return catalogFor(actor).describeTool(actor, input)
    },

    async callReadonly(actor, input) {
      return readonlyCallerFor(actor).callReadonly(actor, input)
    },

    async mcp_readonly_call(actor, input) {
      return readonlyCallerFor(actor).callReadonly(actor, input)
    },

    async disconnectSource(actor, sourceId) {
      const normalizedSourceId = validateMcpSourceId(sourceId)
      await requireActorOwnedMcpSource(options.registry, actor, normalizedSourceId)
      if (!options.registry.disconnectSource) {
        throw new McpError(MCP_ERROR_CODES.SOURCE_UNAVAILABLE, "MCP source disconnect is not configured")
      }
      const source = await options.registry.disconnectSource(actor, normalizedSourceId)
      return verifyMcpDisconnectResult(options.registry, actor, normalizedSourceId, source)
    },
  }
}
