import { createHmac, randomUUID, timingSafeEqual } from "node:crypto"
import {
  WorkspaceBridgeErrorCode,
  createWorkspaceBridgeError,
  type BridgeAuthContext,
  type WorkspaceBridgeError,
} from "../../shared/workspace-bridge-rpc"

export const WORKSPACE_BRIDGE_TOKEN_AUDIENCE = "workspace-bridge"
export const WORKSPACE_BRIDGE_REFRESH_TOKEN_AUDIENCE = "workspace-bridge-refresh"

interface WorkspaceBridgeTokenClaimsBase {
  aud: string
  workspaceId: string
  sessionId?: string
  runtimeId?: string
  capabilities: readonly string[]
  iat: number
  exp: number
  jti: string
  tokenTtlMs?: number
}

export interface WorkspaceBridgeRuntimeTokenClaims extends WorkspaceBridgeTokenClaimsBase {
  aud: typeof WORKSPACE_BRIDGE_TOKEN_AUDIENCE
}

export interface WorkspaceBridgeRuntimeRefreshTokenClaims extends WorkspaceBridgeTokenClaimsBase {
  aud: typeof WORKSPACE_BRIDGE_REFRESH_TOKEN_AUDIENCE
  /** Short-lived call-token TTL to use when this refresh token re-mints. */
  tokenTtlMs?: number
}

export interface MintWorkspaceBridgeRuntimeTokenOptions {
  secret: string
  workspaceId: string
  sessionId?: string
  runtimeId?: string
  capabilities: readonly string[]
  ttlMs?: number
  nowMs?: number
  jti?: string
}

export interface MintWorkspaceBridgeRuntimeRefreshTokenOptions extends MintWorkspaceBridgeRuntimeTokenOptions {
  /** Short-lived call-token TTL to use when this refresh token re-mints. */
  tokenTtlMs?: number
}

export interface VerifyWorkspaceBridgeRuntimeTokenOptions {
  secret: string
  nowMs?: number
  requiredCapabilities?: readonly string[]
}

export interface VerifyWorkspaceBridgeRuntimeRefreshTokenOptions {
  secret: string
  nowMs?: number
}

export interface VerifiedWorkspaceBridgeRuntimeToken {
  claims: WorkspaceBridgeRuntimeTokenClaims
  authContext: BridgeAuthContext
}

export interface VerifiedWorkspaceBridgeRuntimeRefreshToken {
  claims: WorkspaceBridgeRuntimeRefreshTokenClaims
}

export function mintWorkspaceBridgeRuntimeToken(
  options: MintWorkspaceBridgeRuntimeTokenOptions,
): string {
  return mintWorkspaceBridgeToken({
    ...options,
    audience: WORKSPACE_BRIDGE_TOKEN_AUDIENCE,
    ttlMs: options.ttlMs ?? 5 * 60_000,
  })
}

export function mintWorkspaceBridgeRuntimeRefreshToken(
  options: MintWorkspaceBridgeRuntimeRefreshTokenOptions,
): string {
  return mintWorkspaceBridgeToken({
    ...options,
    audience: WORKSPACE_BRIDGE_REFRESH_TOKEN_AUDIENCE,
    // Refresh tokens intentionally outlive short call tokens, but remain
    // sandbox-bound by workspace/session/runtime/capabilities claims.
    ttlMs: options.ttlMs ?? 24 * 60 * 60_000,
    tokenTtlMs: options.tokenTtlMs,
  })
}

export function verifyWorkspaceBridgeRuntimeToken(
  token: string,
  options: VerifyWorkspaceBridgeRuntimeTokenOptions,
): VerifiedWorkspaceBridgeRuntimeToken {
  assertUsableSecret(options.secret)
  const claims = parseAndVerifyToken(token, options.secret)
  const now = Math.floor((options.nowMs ?? Date.now()) / 1000)
  ensureLiveTokenClaims(claims, now, WORKSPACE_BRIDGE_TOKEN_AUDIENCE, "Runtime bridge token")

  const missingCapability = (options.requiredCapabilities ?? []).find(
    (capability) => !claims.capabilities.includes(capability),
  )
  if (missingCapability) {
    throw bridgeTokenError(WorkspaceBridgeErrorCode.CapabilityDenied, "Runtime bridge token is missing a required capability")
  }

  const runtimeClaims = claims as WorkspaceBridgeRuntimeTokenClaims
  return {
    claims: runtimeClaims,
    authContext: runtimeClaimsToBridgeAuthContext(runtimeClaims),
  }
}

export function verifyWorkspaceBridgeRuntimeRefreshToken(
  token: string,
  options: VerifyWorkspaceBridgeRuntimeRefreshTokenOptions,
): VerifiedWorkspaceBridgeRuntimeRefreshToken {
  assertUsableSecret(options.secret)
  const claims = parseAndVerifyToken(token, options.secret)
  const now = Math.floor((options.nowMs ?? Date.now()) / 1000)
  ensureLiveTokenClaims(claims, now, WORKSPACE_BRIDGE_REFRESH_TOKEN_AUDIENCE, "Runtime bridge refresh token")
  return { claims: claims as WorkspaceBridgeRuntimeRefreshTokenClaims }
}

export function runtimeClaimsToBridgeAuthContext(
  claims: WorkspaceBridgeRuntimeTokenClaims,
): BridgeAuthContext {
  return {
    callerClass: "runtime",
    workspaceId: claims.workspaceId,
    sessionId: claims.sessionId,
    capabilities: claims.capabilities,
    tokenId: claims.jti,
    expiresAt: new Date(claims.exp * 1000).toISOString(),
    actor: {
      actorKind: "agent",
      performedBy: {
        label: claims.runtimeId ? `runtime:${claims.runtimeId}` : "runtime:agent",
        id: claims.runtimeId,
      },
      onBehalfOf: claims.sessionId ? { label: `session:${claims.sessionId}` } : undefined,
    },
  }
}

function mintWorkspaceBridgeToken(options: MintWorkspaceBridgeRuntimeTokenOptions & {
  audience: typeof WORKSPACE_BRIDGE_TOKEN_AUDIENCE | typeof WORKSPACE_BRIDGE_REFRESH_TOKEN_AUDIENCE
  tokenTtlMs?: number
}): string {
  assertUsableSecret(options.secret)
  const nowMs = options.nowMs ?? Date.now()
  const claims: WorkspaceBridgeTokenClaimsBase = {
    aud: options.audience,
    workspaceId: options.workspaceId,
    sessionId: options.sessionId,
    runtimeId: options.runtimeId,
    capabilities: [...options.capabilities],
    iat: Math.floor(nowMs / 1000),
    exp: Math.floor((nowMs + options.ttlMs!) / 1000),
    jti: options.jti ?? randomUUID(),
    ...(options.tokenTtlMs !== undefined ? { tokenTtlMs: options.tokenTtlMs } : {}),
  }
  return signClaims(claims, options.secret)
}

function ensureLiveTokenClaims(
  claims: WorkspaceBridgeTokenClaimsBase,
  now: number,
  expectedAudience: typeof WORKSPACE_BRIDGE_TOKEN_AUDIENCE | typeof WORKSPACE_BRIDGE_REFRESH_TOKEN_AUDIENCE,
  label: string,
): void {
  if (claims.aud !== expectedAudience) {
    throw bridgeTokenError(WorkspaceBridgeErrorCode.InvalidToken, `${label} has invalid audience`)
  }
  if (claims.exp <= now) {
    throw bridgeTokenError(WorkspaceBridgeErrorCode.ExpiredToken, `${label} has expired`)
  }
  if (claims.iat > now + 60) {
    throw bridgeTokenError(WorkspaceBridgeErrorCode.InvalidToken, `${label} is not valid yet`)
  }
}

function signClaims(claims: WorkspaceBridgeTokenClaimsBase, secret: string): string {
  const header = { alg: "HS256", typ: "JWT" }
  const encodedHeader = base64UrlEncode(JSON.stringify(header))
  const encodedPayload = base64UrlEncode(JSON.stringify(claims))
  const signingInput = `${encodedHeader}.${encodedPayload}`
  return `${signingInput}.${hmac(signingInput, secret)}`
}

function parseAndVerifyToken(token: string, secret: string): WorkspaceBridgeTokenClaimsBase {
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

function parseClaims(payload: unknown): WorkspaceBridgeTokenClaimsBase {
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
  if (claims.tokenTtlMs !== undefined && (typeof claims.tokenTtlMs !== "number" || !Number.isFinite(claims.tokenTtlMs) || claims.tokenTtlMs <= 0)) {
    throw bridgeTokenError(WorkspaceBridgeErrorCode.InvalidToken, "Runtime bridge token claims are invalid")
  }
  return {
    aud: claims.aud,
    workspaceId: claims.workspaceId,
    sessionId: optionalString(claims.sessionId),
    runtimeId: optionalString(claims.runtimeId),
    capabilities: [...claims.capabilities] as string[],
    iat: claims.iat,
    exp: claims.exp,
    jti: claims.jti,
    ...(typeof claims.tokenTtlMs === "number" ? { tokenTtlMs: claims.tokenTtlMs } : {}),
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
