import {
  MCP_ERROR_CODES,
  McpError,
  containsMcpSecret,
  toMcpSourceDto,
  type McpActor,
  type McpSource,
  type McpSourceRegistry,
  type McpSourceStatusPayload,
} from "../shared"

const SOURCE_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,160}$/

export function validateMcpSourceId(sourceId: string): string {
  const trimmed = sourceId.trim()
  if (!SOURCE_ID_PATTERN.test(trimmed)) throw new McpError(MCP_ERROR_CODES.SOURCE_NOT_FOUND, "MCP source not found")
  return trimmed
}

export function isActorOwnedMcpSource(actor: McpActor, source: McpSource | undefined): source is McpSource {
  return Boolean(source && source.workspaceId === actor.workspaceId && source.userId === actor.userId)
}

export async function requireActorOwnedMcpSource(registry: McpSourceRegistry, actor: McpActor, sourceId: string): Promise<McpSource> {
  const source = await registry.getSource(validateMcpSourceId(sourceId))
  if (!isActorOwnedMcpSource(actor, source)) throw new McpError(MCP_ERROR_CODES.SOURCE_NOT_FOUND, "MCP source not found")
  return source
}

export function assertMcpPublicPayloadSecretFree(value: unknown): void {
  if (containsMcpSecret(value)) throw new McpError(MCP_ERROR_CODES.SECRET_LEAK_GUARD, "MCP public payload contained secret material")
}

export function createMcpSourceStatusPayload(source: McpSource): McpSourceStatusPayload {
  const payload = {
    source: toMcpSourceDto(source),
    connectable: source.credentialProvider === "provider-managed" || source.credentialProvider === "composio-managed" || source.credentialProvider === "app-managed",
    canProbe: source.status === "connected",
    canDisconnect: source.status !== "unconfigured" && source.status !== "revoked",
  }
  assertMcpPublicPayloadSecretFree(payload)
  return payload
}
