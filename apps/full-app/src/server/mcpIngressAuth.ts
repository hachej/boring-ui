import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'

import type { FastifyRequest } from 'fastify'
import { ManagedAgentMcpError } from '@hachej/boring-agent/server'
import { ErrorCode } from '@hachej/boring-agent/shared'

/**
 * Step 1B MCP ingress (#806) two-tier authentication seam.
 *
 * The same managed-agent MCP ingress path serves two deployment shapes, with
 * the mode chosen by deployment/runtime config (mirrors `BORING_AGENT_MODE`):
 *
 * - `hosted` (SaaS / full-app on a server): external MCP clients are UNTRUSTED
 *   and must AUTHENTICATE. This slice ships a static, secret-backed bearer
 *   binding. Full OAuth (the MCP-spec authorization server / per-user issued
 *   bearers) is the NEXT slice — it drops in as another {@link
 *   McpIngressAuthenticator} without touching the route.
 * - `local-trusted` (CLI / a locally-running agent): the peer is a TRUSTED
 *   co-located process. Authentication is a lightweight loopback + local-token
 *   check, NOT the full OAuth dance.
 *
 * Authentication only proves *who is calling* and *which bound principal /
 * workspace* the credential maps to. It never grants membership: the route
 * still revalidates app + membership + persisted workspace type before any
 * dispatcher or model work. See {@link AGENT-CONSUMPTION-MODES.md} Mode 0.
 */
export const MCP_INGRESS_AUTH_MODES = ['hosted', 'local-trusted'] as const

export type McpIngressAuthMode = (typeof MCP_INGRESS_AUTH_MODES)[number]

export function isMcpIngressAuthMode(value: unknown): value is McpIngressAuthMode {
  return typeof value === 'string' && (MCP_INGRESS_AUTH_MODES as readonly string[]).includes(value)
}

/**
 * The bound principal/workspace a successful authentication resolves to. This
 * is the credential binding only; membership and workspace type are revalidated
 * by the route on every request against live Core authority.
 */
export interface McpIngressPrincipalBinding {
  readonly principalUserId: string
  readonly workspaceId: string
}

export type McpIngressAuthOutcome =
  | { readonly ok: true; readonly binding: McpIngressPrincipalBinding }
  | { readonly ok: false }

export interface McpIngressAuthenticator {
  readonly mode: McpIngressAuthMode
  /**
   * Decide whether the request is authenticated. Must run BEFORE any workspace
   * load, dispatcher resolution, or model work, and must never disclose which
   * check failed.
   */
  authenticate(request: FastifyRequest): McpIngressAuthOutcome
}

const BEARER_PREFIX = 'Bearer '

/** Loopback peers accepted by the `local-trusted` authenticator. */
const LOOPBACK_ADDRESSES = new Set<string>([
  '127.0.0.1',
  '::1',
  '::ffff:127.0.0.1',
])

export interface HostedBearerAuthenticatorOptions {
  readonly bearerToken: string
  readonly binding: McpIngressPrincipalBinding
}

/**
 * HOSTED path. Untrusted external clients present a static, secret-backed
 * bearer (constant-time compare). Slice-1 authenticated-bearer cut; OAuth is
 * the next slice.
 */
export function createHostedBearerAuthenticator(
  options: HostedBearerAuthenticatorOptions,
): McpIngressAuthenticator {
  const { bearerToken, binding } = options
  if (!bearerToken) {
    throw new ManagedAgentMcpError(
      ErrorCode.enum.CONFIG_INVALID,
      'managed-agent MCP hosted auth requires a bearer token',
    )
  }
  return {
    mode: 'hosted',
    authenticate(request) {
      const provided = bearerTokenFromRequest(request.raw)
      if (!provided) return { ok: false }
      if (!constantTimeEquals(bearerToken, provided)) return { ok: false }
      return { ok: true, binding }
    },
  }
}

export interface LocalTrustedAuthenticatorOptions {
  readonly localToken: string
  readonly binding: McpIngressPrincipalBinding
  /** Override for tests; defaults to {@link LOOPBACK_ADDRESSES}. */
  readonly loopbackAddresses?: Iterable<string>
}

/**
 * LOCAL / CLI path. A co-located trusted agent authenticates via loopback +
 * local token. A non-loopback peer is denied even with the correct token; a
 * missing/wrong token is denied. No OAuth.
 */
export function createLocalTrustedAuthenticator(
  options: LocalTrustedAuthenticatorOptions,
): McpIngressAuthenticator {
  const { localToken, binding } = options
  if (!localToken) {
    throw new ManagedAgentMcpError(
      ErrorCode.enum.CONFIG_INVALID,
      'managed-agent MCP local-trusted auth requires a local token',
    )
  }
  const loopback = new Set<string>(options.loopbackAddresses ?? LOOPBACK_ADDRESSES)
  return {
    mode: 'local-trusted',
    authenticate(request) {
      // Loopback is required and checked first: a non-loopback peer must be
      // denied even if it somehow presents the correct local token.
      if (!isLoopbackRequest(request, loopback)) return { ok: false }
      const provided = bearerTokenFromRequest(request.raw)
      if (!provided) return { ok: false }
      if (!constantTimeEquals(localToken, provided)) return { ok: false }
      return { ok: true, binding }
    },
  }
}

function isLoopbackRequest(request: FastifyRequest, loopback: ReadonlySet<string>): boolean {
  const socketAddress = request.raw.socket?.remoteAddress
  if (socketAddress && loopback.has(socketAddress)) return true
  // Fastify normalizes the peer address onto `request.ip`; fall back to it when
  // the raw socket address is unavailable (e.g. light-my-request injection).
  const requestIp = request.ip
  return Boolean(requestIp && loopback.has(requestIp))
}

function bearerTokenFromRequest(request: IncomingMessage): string | undefined {
  const authorization = request.headers.authorization
  if (typeof authorization !== 'string') return undefined
  if (!authorization.startsWith(BEARER_PREFIX)) return undefined
  const token = authorization.slice(BEARER_PREFIX.length).trim()
  return token || undefined
}

/**
 * Constant-time string comparison that does not early-return on length
 * mismatch length disclosure.
 */
function constantTimeEquals(expected: string, actual: string): boolean {
  const expectedBytes = Buffer.from(expected)
  const actualBytes = Buffer.from(actual)
  if (expectedBytes.byteLength !== actualBytes.byteLength) {
    timingSafeEqual(expectedBytes, expectedBytes)
    return false
  }
  return timingSafeEqual(expectedBytes, actualBytes)
}
