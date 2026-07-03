import Arcade from "@arcadeai/arcadejs"
import type { ArcadeSharePointRuntimeConfig } from "./arcadeConfig"

export interface ArcadeToolExecuteInput {
  toolName: string
  userId?: string
  input?: Record<string, unknown>
}

export interface ArcadeAuthorizationInput {
  userId?: string
  providerId?: string
  scopes?: string[]
}

export interface ArcadeAuthorizationStatusInput {
  authorizationId: string
}

interface ArcadeClientLike {
  tools: {
    execute(body: {
      tool_name: string
      user_id?: string
      input?: Record<string, unknown>
    }): Promise<unknown>
  }
  auth: {
    start(userId: string, provider: string, options?: { scopes?: string[] }): Promise<unknown>
    status(query: { id: string }): Promise<unknown>
  }
}

export class ArcadeJsToolRuntime {
  private readonly client: ArcadeClientLike
  private readonly config: ArcadeSharePointRuntimeConfig

  constructor(config: ArcadeSharePointRuntimeConfig, client: ArcadeClientLike = createArcadeClient(config)) {
    this.config = config
    this.client = client
  }

  executeTool(request: ArcadeToolExecuteInput): Promise<unknown> {
    return this.client.tools.execute({
      tool_name: request.toolName,
      user_id: this.resolveUserId(request.userId),
      input: request.input,
    })
  }

  startAuthorization(request: ArcadeAuthorizationInput = {}): Promise<unknown> {
    return this.client.auth.start(
      this.resolveUserId(request.userId),
      request.providerId ?? this.config.defaultProviderId,
      { scopes: request.scopes ?? [] },
    )
  }

  getAuthorizationStatus(request: ArcadeAuthorizationStatusInput): Promise<unknown> {
    return this.client.auth.status({ id: request.authorizationId })
  }

  private resolveUserId(userId?: string): string {
    const resolved = userId ?? this.config.defaultUserId
    if (!resolved) {
      throw new Error("Arcade user id is required for SharePoint Arcade runtime calls")
    }
    return resolved
  }
}

function createArcadeClient(config: ArcadeSharePointRuntimeConfig): ArcadeClientLike {
  return new Arcade({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
  })
}
