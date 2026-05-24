import { createHmac, randomUUID, timingSafeEqual } from "node:crypto"
import {
  WorkspaceBridgeErrorCode,
  createWorkspaceBridgeError,
  type BridgeAuthContext,
  type WorkspaceBridgeError,
} from "../../shared/workspace-bridge-rpc"

export const WORKSPACE_BRIDGE_TOKEN_AUDIENCE = "workspace-bridge"

export interface WorkspaceBridgeRuntimeTokenClaims {
  aud: typeof WORKSPACE_BRIDGE_TOKEN_AUDIENCE
  workspaceId: string
  sessionId?: string
  pluginId?: string
  runtimeId?: string
  agentSessionId?: string
  toolCallId?: string
  capabilities: readonly string[]
  bridgeOrigin?: string
  deploymentId?: string
  iat: number
  exp: number
  jti: string
}

export interface MintWorkspaceBridgeRuntimeTokenOptions {
  secret: string
  workspaceId: string
  sessionId?: string
  pluginId?: string
  runtimeId?: string
  agentSessionId?: string
  toolCallId?: string
  capabilities: readonly string[]
  bridgeOrigin?: string
  deploymentId?: string
  ttlMs?: number
  nowMs?: number
  jti?: string
}

export interface VerifyWorkspaceBridgeRuntimeTokenOptions {
  secret: string
  nowMs?: number
  expectedWorkspaceId?: string
  expectedSessionId?: string
  expectedPluginId?: string
  expectedRuntimeId?: string
  expectedBridgeOrigin?: string
  expectedDeploymentId?: string
  requiredCapabilities?: readonly string[]
}

export interface VerifiedWorkspaceBridgeRuntimeToken {
  claims: WorkspaceBridgeRuntimeTokenClaims
  authContext: BridgeAuthContext
}

export function mintWorkspaceBridgeRuntimeToken(
  options: MintWorkspaceBridgeRuntimeTokenOptions,
): string {
  assertUsableSecret(options.secret)
  const nowMs = options.nowMs ?? Date.now()
  const ttlMs = options.ttlMs ?? 5 * 60_000
  const claims: WorkspaceBridgeRuntimeTokenClaims = {
    aud: WORKSPACE_BRIDGE_TOKEN_AUDIENCE,
    workspaceId: options.workspaceId,
    sessionId: options.sessionId,
    pluginId: options.pluginId,
    runtimeId: options.runtimeId,
    agentSessionId: options.agentSessionId,
    toolCallId: options.toolCallId,
    capabilities: [...options.capabilities],
    bridgeOrigin: options.bridgeOrigin,
    deploymentId: options.deploymentId,
    iat: Math.floor(nowMs / 1000),
    exp: Math.floor((nowMs + ttlMs) / 1000),
    jti: options.jti ?? randomUUID(),
  }
  return signClaims(claims, options.secret)
}

export function verifyWorkspaceBridgeRuntimeToken(
  token: string,
  options: VerifyWorkspaceBridgeRuntimeTokenOptions,
): VerifiedWorkspaceBridgeRuntimeToken {
  assertUsableSecret(options.secret)
  const claims = parseAndVerifyToken(token, options.secret)
  const now = Math.floor((options.nowMs ?? Date.now()) / 1000)
  if (claims.aud !== WORKSPACE_BRIDGE_TOKEN_AUDIENCE) {
    throw bridgeTokenError(WorkspaceBridgeErrorCode.InvalidToken, "Runtime bridge token has invalid audience")
  }
  if (claims.exp <= now) {
    throw bridgeTokenError(WorkspaceBridgeErrorCode.ExpiredToken, "Runtime bridge token has expired")
  }
  if (claims.iat > now + 60) {
    throw bridgeTokenError(WorkspaceBridgeErrorCode.InvalidToken, "Runtime bridge token is not valid yet")
  }

  expectClaim("workspaceId", claims.workspaceId, options.expectedWorkspaceId)
  expectClaim("sessionId", claims.sessionId, options.expectedSessionId)
  expectClaim("pluginId", claims.pluginId, options.expectedPluginId)
  expectClaim("runtimeId", claims.runtimeId, options.expectedRuntimeId)
  expectClaim("bridgeOrigin", claims.bridgeOrigin, options.expectedBridgeOrigin)
  expectClaim("deploymentId", claims.deploymentId, options.expectedDeploymentId)

  const missingCapability = (options.requiredCapabilities ?? []).find(
    (capability) => !claims.capabilities.includes(capability),
  )
  if (missingCapability) {
    throw bridgeTokenError(WorkspaceBridgeErrorCode.CapabilityDenied, "Runtime bridge token is missing a required capability")
  }

  return {
    claims,
    authContext: runtimeClaimsToBridgeAuthContext(claims),
  }
}

export function runtimeClaimsToBridgeAuthContext(
  claims: WorkspaceBridgeRuntimeTokenClaims,
): BridgeAuthContext {
  return {
    callerClass: "runtime",
    workspaceId: claims.workspaceId,
    sessionId: claims.sessionId,
    pluginId: claims.pluginId,
    capabilities: claims.capabilities,
    tokenId: claims.jti,
    expiresAt: new Date(claims.exp * 1000).toISOString(),
    actor: {
      actorKind: "agent",
      performedBy: {
        label: claims.pluginId
          ? `runtime:${claims.pluginId}`
          : claims.runtimeId
            ? `runtime:${claims.runtimeId}`
            : "runtime:agent",
        id: claims.agentSessionId ?? claims.runtimeId,
      },
      onBehalfOf: claims.sessionId ? { label: `session:${claims.sessionId}` } : undefined,
    },
  }
}

function signClaims(claims: WorkspaceBridgeRuntimeTokenClaims, secret: string): string {
  const header = { alg: "HS256", typ: "JWT" }
  const encodedHeader = base64UrlEncode(JSON.stringify(header))
  const encodedPayload = base64UrlEncode(JSON.stringify(claims))
  const signingInput = `${encodedHeader}.${encodedPayload}`
  return `${signingInput}.${hmac(signingInput, secret)}`
}

function parseAndVerifyToken(token: string, secret: string): WorkspaceBridgeRuntimeTokenClaims {
  const parts = token.split(".")
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    throw bridgeTokenError(WorkspaceBridgeErrorCode.InvalidToken, "Runtime bridge token is malformed")
  }
  const [headerPart, payloadPart, signature] = parts
  const signingInput = `${headerPart}.${payloadPart}`
  const expected = hmac(signingInput, secret)
  if (!safeEqual(signature, expected)) {
    throw bridgeTokenError(WorkspaceBridgeErrorCode.InvalidToken, "Runtime bridge token signature is invalid")
  }

  let header: unknown
  let payload: unknown
  try {
    header = JSON.parse(base64UrlDecode(headerPart))
    payload = JSON.parse(base64UrlDecode(payloadPart))
  } catch {
    throw bridgeTokenError(WorkspaceBridgeErrorCode.InvalidToken, "Runtime bridge token payload is invalid")
  }
  if (!header || typeof header !== "object" || (header as { alg?: unknown }).alg !== "HS256") {
    throw bridgeTokenError(WorkspaceBridgeErrorCode.InvalidToken, "Runtime bridge token algorithm is invalid")
  }
  return parseClaims(payload)
}

function parseClaims(payload: unknown): WorkspaceBridgeRuntimeTokenClaims {
  if (!payload || typeof payload !== "object") {
    throw bridgeTokenError(WorkspaceBridgeErrorCode.InvalidToken, "Runtime bridge token claims are invalid")
  }
  const claims = payload as Record<string, unknown>
  if (
    typeof claims.aud !== "string" ||
    typeof claims.workspaceId !== "string" ||
    !Array.isArray(claims.capabilities) ||
    !claims.capabilities.every((capability) => typeof capability === "string") ||
    typeof claims.iat !== "number" ||
    typeof claims.exp !== "number" ||
    typeof claims.jti !== "string"
  ) {
    throw bridgeTokenError(WorkspaceBridgeErrorCode.InvalidToken, "Runtime bridge token claims are invalid")
  }
  return {
    aud: claims.aud as typeof WORKSPACE_BRIDGE_TOKEN_AUDIENCE,
    workspaceId: claims.workspaceId,
    sessionId: optionalString(claims.sessionId),
    pluginId: optionalString(claims.pluginId),
    runtimeId: optionalString(claims.runtimeId),
    agentSessionId: optionalString(claims.agentSessionId),
    toolCallId: optionalString(claims.toolCallId),
    capabilities: [...claims.capabilities] as string[],
    bridgeOrigin: optionalString(claims.bridgeOrigin),
    deploymentId: optionalString(claims.deploymentId),
    iat: claims.iat,
    exp: claims.exp,
    jti: claims.jti,
  }
}

function expectClaim(
  name: string,
  actual: string | undefined,
  expected: string | undefined,
): void {
  if (expected !== undefined && actual !== expected) {
    throw bridgeTokenError(WorkspaceBridgeErrorCode.InvalidToken, `Runtime bridge token ${name} mismatch`)
  }
}

function bridgeTokenError(code: WorkspaceBridgeErrorCode, message: string): WorkspaceBridgeError {
  return createWorkspaceBridgeError(code, message)
}

function assertUsableSecret(secret: string): void {
  if (secret.length < 32) {
    throw bridgeTokenError(WorkspaceBridgeErrorCode.InvalidToken, "Runtime bridge token secret is too short")
  }
}

function hmac(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url")
}

function safeEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual)
  const expectedBuffer = Buffer.from(expected)
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value).toString("base64url")
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8")
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}
