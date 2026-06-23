import type { RuntimeBundle, RuntimeEnvContribution, RuntimeEnvContributionContext, RuntimeModeId } from "@hachej/boring-agent/server"
import type { WorkspaceBridgeRegistry } from "./registry"
import { mintWorkspaceBridgeRuntimeRefreshToken, mintWorkspaceBridgeRuntimeToken } from "./runtimeToken"

const BRIDGE_CALL_PATH = "/api/v1/workspace-bridge/call"
const BRIDGE_TOKEN_PATH = "/api/v1/workspace-bridge/token"

export type WorkspaceBridgeRuntimeEnvDisabledReason =
  | "bridge-url-missing"
  | "runtime-token-secret-missing"
  | "runtime-capabilities-missing"
  | "remote-bridge-url-must-be-https"
  | "remote-bridge-url-must-not-be-localhost"
  | "bridge-url-invalid"

export interface WorkspaceBridgeRuntimeEnvOptions {
  /** Opt in to runtime SDK/CLI bridge env injection. Defaults to true when bridgeUrl is set. */
  enabled?: boolean
  /** Trusted, externally reachable app origin or full /api/v1/workspace-bridge/call URL. */
  bridgeUrl?: string
  /** Allow plain HTTP for local/dev endpoints. Remote runtimes still require HTTPS. */
  allowInsecureHttp?: boolean
  /**
   * Explicit capability strings minted into runtime bridge tokens. These are
   * grants the registry checks at call time, not resource-ownership checks;
   * operation handlers must still enforce their own domain/resource scope.
   */
  capabilities?: readonly string[]
  /** Runtime call-token TTL. Defaults to the token primitive default. */
  tokenTtlMs?: number
  /** Runtime refresh-token TTL. Defaults to the token primitive default. */
  refreshTokenTtlMs?: number
  /** Optional audit/session claim. */
  sessionId?: string
}

export type WorkspaceBridgeRuntimePlacement = "local" | "remote"

export interface CreateWorkspaceBridgeRuntimeEnvContributionOptions {
  workspaceId: string
  runtimeMode: RuntimeModeId
  registry: WorkspaceBridgeRegistry
  runtimeTokenSecret?: string
  runtimeRefreshTokenSecret?: string
  runtimeEnv?: WorkspaceBridgeRuntimeEnvOptions
  /** Provider-neutral fallback used when getEnv is called without a RuntimeEnvContributionContext (mostly tests). */
  runtimePlacement?: WorkspaceBridgeRuntimePlacement
}

export function createWorkspaceBridgeRuntimeEnvContribution(
  options: CreateWorkspaceBridgeRuntimeEnvContributionOptions,
): RuntimeEnvContribution | undefined {
  const enabled = options.runtimeEnv?.enabled ?? Boolean(options.runtimeEnv?.bridgeUrl)
  if (!enabled) return undefined

  const bridgeUrl = resolveBridgeCallUrl(options.runtimeEnv?.bridgeUrl)
  const tokenUrl = resolveBridgeTokenUrl(options.runtimeEnv?.bridgeUrl)
  const capabilities = options.runtimeEnv?.capabilities

  return {
    id: "workspace-bridge-runtime-env",
    getEnv: (ctx?: RuntimeEnvContributionContext): Record<string, string> => {
      const runtimePlacement = resolveRuntimePlacement(ctx?.runtimeBundle, options.runtimePlacement)
      const disabledReason = validateRuntimeBridgeUrl({
        bridgeUrl,
        runtimePlacement,
        allowInsecureHttp: options.runtimeEnv?.allowInsecureHttp,
        hasRuntimeTokenSecret: Boolean(options.runtimeTokenSecret),
        hasCapabilities: Array.isArray(capabilities) && capabilities.length > 0,
      })
      if (disabledReason) {
        return { BORING_WORKSPACE_BRIDGE_DISABLED: disabledReason }
      }
      const token = mintWorkspaceBridgeRuntimeToken({
        secret: options.runtimeTokenSecret!,
        workspaceId: options.workspaceId,
        sessionId: options.runtimeEnv?.sessionId,
        runtimeId: options.runtimeMode,
        capabilities: capabilities!,
        ttlMs: options.runtimeEnv?.tokenTtlMs,
      })
      const refreshToken = options.runtimeRefreshTokenSecret && tokenUrl && isRefreshTokenUrlSafe(tokenUrl)
        ? mintWorkspaceBridgeRuntimeRefreshToken({
            secret: options.runtimeRefreshTokenSecret,
            workspaceId: options.workspaceId,
            sessionId: options.runtimeEnv?.sessionId,
            runtimeId: options.runtimeMode,
            capabilities: capabilities!,
            ttlMs: options.runtimeEnv?.refreshTokenTtlMs,
            tokenTtlMs: options.runtimeEnv?.tokenTtlMs,
          })
        : undefined
      return {
        BORING_WORKSPACE_BRIDGE_URL: bridgeUrl!,
        BORING_WORKSPACE_BRIDGE_TOKEN: token,
        ...(refreshToken ? {
          BORING_WORKSPACE_BRIDGE_TOKEN_URL: tokenUrl!,
          BORING_WORKSPACE_BRIDGE_REFRESH_TOKEN: refreshToken,
        } : {}),
        BORING_WORKSPACE_ID: options.workspaceId,
        BORING_AGENT_SESSION_ID: options.runtimeEnv?.sessionId ?? options.workspaceId,
      }
    },
  }
}

export function resolveBridgeCallUrl(value: string | undefined): string | undefined {
  return resolveBridgeUrl(value, BRIDGE_CALL_PATH)
}

export function resolveBridgeTokenUrl(value: string | undefined): string | undefined {
  return resolveBridgeUrl(value, BRIDGE_TOKEN_PATH)
}

function resolveBridgeUrl(value: string | undefined, path: string): string | undefined {
  if (!value?.trim()) return undefined
  try {
    const url = new URL(value)
    if (url.pathname === "" || url.pathname === "/" || url.pathname === BRIDGE_CALL_PATH || url.pathname === BRIDGE_TOKEN_PATH) {
      url.pathname = path
    }
    return url.toString()
  } catch {
    return undefined
  }
}

function isRefreshTokenUrlSafe(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === "https:" || (url.protocol === "http:" && isLoopbackHost(url.hostname))
  } catch {
    return false
  }
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]"
}

function resolveRuntimePlacement(
  runtimeBundle: RuntimeBundle | undefined,
  fallback: WorkspaceBridgeRuntimePlacement | undefined,
): WorkspaceBridgeRuntimePlacement {
  if (runtimeBundle?.filesystem?.kind === "remote-workspace" || runtimeBundle?.bash?.kind === "remote") return "remote"
  return fallback ?? "local"
}

function validateRuntimeBridgeUrl(options: {
  bridgeUrl: string | undefined
  runtimePlacement: WorkspaceBridgeRuntimePlacement
  allowInsecureHttp?: boolean
  hasRuntimeTokenSecret: boolean
  hasCapabilities: boolean
}): WorkspaceBridgeRuntimeEnvDisabledReason | undefined {
  if (!options.bridgeUrl) return "bridge-url-missing"
  if (!options.hasRuntimeTokenSecret) return "runtime-token-secret-missing"
  if (!options.hasCapabilities) return "runtime-capabilities-missing"
  let url: URL
  try {
    url = new URL(options.bridgeUrl)
  } catch {
    return "bridge-url-invalid"
  }
  const isRemote = options.runtimePlacement === "remote"
  const isLocalhost = isLoopbackHost(url.hostname)
  if (isRemote && url.protocol !== "https:") return "remote-bridge-url-must-be-https"
  if (isRemote && isLocalhost) return "remote-bridge-url-must-not-be-localhost"
  if (url.protocol === "http:" && !options.allowInsecureHttp && !isLocalhost) return "remote-bridge-url-must-be-https"
  if (url.protocol !== "http:" && url.protocol !== "https:") return "bridge-url-invalid"
  return undefined
}
