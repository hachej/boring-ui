import {
  MCP_ERROR_CODES,
  McpAccessFacade,
  McpError,
  toMcpSourceDto,
  type McpActor,
  type McpProbeResult,
  type McpSource,
  type McpSourceDto,
  type McpSourceRegistry,
  type McpSourceStatusPayload,
  type McpTransportClient,
} from "../shared"

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

const SOURCE_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,160}$/

function validateSourceId(sourceId: string): string {
  const trimmed = sourceId.trim()
  if (!SOURCE_ID_PATTERN.test(trimmed)) {
    throw new McpError(MCP_ERROR_CODES.SOURCE_NOT_FOUND, "MCP source not found")
  }
  return trimmed
}

function isOwnedSource(actor: McpActor, source: McpSource | undefined): source is McpSource {
  return Boolean(source && source.workspaceId === actor.workspaceId && source.userId === actor.userId)
}

async function requireOwnedSource(registry: McpSourceRegistry, actor: McpActor, sourceId: string): Promise<McpSource> {
  const source = await registry.getSource(validateSourceId(sourceId))
  if (!isOwnedSource(actor, source)) {
    throw new McpError(MCP_ERROR_CODES.SOURCE_NOT_FOUND, "MCP source not found")
  }
  return source
}

function statusPayload(source: McpSource): McpSourceStatusPayload {
  return {
    source: toMcpSourceDto(source),
    connectable: source.credentialProvider === "provider-managed" || source.credentialProvider === "app-managed",
    canProbe: source.status !== "revoked",
    canDisconnect: source.status !== "unconfigured" && source.status !== "revoked",
  }
}

export function createBoringMcpSourceHandlers(options: BoringMcpSourceHandlersOptions): BoringMcpSourceHandlers {
  const facade = new McpAccessFacade({ store: options.registry, transport: options.transport })

  return {
    async listSources(actor) {
      const sources = await options.registry.listSources(actor)
      return { sources: sources.map(toMcpSourceDto) }
    },

    async getSourceStatus(actor, sourceId) {
      const source = await requireOwnedSource(options.registry, actor, sourceId)
      return statusPayload(source)
    },

    async probeSource(actor, sourceId) {
      const normalizedSourceId = validateSourceId(sourceId)
      return facade.probeSource(actor, normalizedSourceId)
    },

    async disconnectSource(actor, sourceId) {
      const normalizedSourceId = validateSourceId(sourceId)
      await requireOwnedSource(options.registry, actor, normalizedSourceId)
      if (!options.registry.disconnectSource) {
        throw new McpError(MCP_ERROR_CODES.SOURCE_UNAVAILABLE, "MCP source disconnect is not configured")
      }
      const source = await options.registry.disconnectSource(actor, normalizedSourceId)
      if (!isOwnedSource(actor, source)) {
        throw new McpError(MCP_ERROR_CODES.SOURCE_NOT_FOUND, "MCP source not found")
      }
      return statusPayload(source)
    },
  }
}
