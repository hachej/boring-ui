import {
  MCP_ERROR_CODES,
  McpAccessFacade,
  McpError,
  toMcpSourceDto,
  type McpActor,
  type McpProbeResult,
  type McpSourceDto,
  type McpSourceRegistry,
  type McpSourceStatusPayload,
  type McpTransportClient,
} from "../shared"
import { assertMcpPublicPayloadSecretFree, createMcpSourceStatusPayload, isActorOwnedMcpSource, requireActorOwnedMcpSource, validateMcpSourceId } from "./sourceAccess"

export interface BoringMcpSourceHandlersOptions {
  registry: McpSourceRegistry
  transport: McpTransportClient
}

export interface BoringMcpSourceHandlers {
  listSources(actor: McpActor): Promise<{ sources: McpSourceDto[] }>
  getSourceStatus(actor: McpActor, sourceId: string): Promise<McpSourceStatusPayload>
  probeSource(actor: McpActor, sourceId: string): Promise<McpProbeResult>
  disconnectSource(actor: McpActor, sourceId: string): Promise<McpSourceStatusPayload>
}

export function createBoringMcpSourceHandlers(options: BoringMcpSourceHandlersOptions): BoringMcpSourceHandlers {
  const facade = new McpAccessFacade({ store: options.registry, transport: options.transport })

  return {
    async listSources(actor) {
      const result = { sources: (await options.registry.listSources(actor)).map(toMcpSourceDto) }
      assertMcpPublicPayloadSecretFree(result)
      return result
    },

    async getSourceStatus(actor, sourceId) {
      const source = await requireActorOwnedMcpSource(options.registry, actor, sourceId)
      return createMcpSourceStatusPayload(source)
    },

    async probeSource(actor, sourceId) {
      const normalizedSourceId = validateMcpSourceId(sourceId)
      const result = await facade.probeSource(actor, normalizedSourceId)
      assertMcpPublicPayloadSecretFree(result)
      return result
    },

    async disconnectSource(actor, sourceId) {
      const normalizedSourceId = validateMcpSourceId(sourceId)
      await requireActorOwnedMcpSource(options.registry, actor, normalizedSourceId)
      if (!options.registry.disconnectSource) {
        throw new McpError(MCP_ERROR_CODES.SOURCE_UNAVAILABLE, "MCP source disconnect is not configured")
      }
      const source = await options.registry.disconnectSource(actor, normalizedSourceId)
      if (!isActorOwnedMcpSource(actor, source)) {
        throw new McpError(MCP_ERROR_CODES.SOURCE_NOT_FOUND, "MCP source not found")
      }
      return createMcpSourceStatusPayload(source)
    },
  }
}
