import type { RuntimeEnvContribution, RuntimeModeId } from "@hachej/boring-agent/server"
import type { WorkspaceBridgeRegistry } from "./registry"
import { mintWorkspaceBridgeRuntimeToken } from "./runtimeToken"

const BRIDGE_CALL_PATH = "/api/v1/workspace-bridge/call"

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
  /** Runtime token TTL. Defaults to the token primitive default. */
  tokenTtlMs?: number
  /** Optional audit/session claim. */
  sessionId?: string
}

export interface CreateWorkspaceBridgeRuntimeEnvContributionOptions {
  workspaceId: string
  runtimeMode: RuntimeModeId
  registry: WorkspaceBridgeRegistry
  runtimeTokenSecret?: string
  runtimeEnv?: WorkspaceBridgeRuntimeEnvOptions
}

export function createWorkspaceBridgeRuntimeEnvContribution(
  options: CreateWorkspaceBridgeRuntimeEnvContributionOptions,
): RuntimeEnvContribution | undefined {
  const enabled = options.runtimeEnv?.enabled ?? Boolean(options.runtimeEnv?.bridgeUrl)
  if (!enabled) return undefined

  const bridgeUrl = resolveBridgeCallUrl(options.runtimeEnv?.bridgeUrl)
  const capabilities = options.runtimeEnv?.capabilities
  const disabledReason = validateRuntimeBridgeUrl({
    bridgeUrl,
    runtimeMode: options.runtimeMode,
    allowInsecureHttp: options.runtimeEnv?.allowInsecureHttp,
    hasRuntimeTokenSecret: Boolean(options.runtimeTokenSecret),
    hasCapabilities: Array.isArray(capabilities) && capabilities.length > 0,
  })

  return {
    id: "workspace-bridge-runtime-env",
    getEnv: (): Record<string, string> => {
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
      return {
        BORING_WORKSPACE_BRIDGE_URL: bridgeUrl!,
        BORING_WORKSPACE_BRIDGE_TOKEN: token,
        BORING_WORKSPACE_ID: options.workspaceId,
        BORING_AGENT_SESSION_ID: options.runtimeEnv?.sessionId ?? options.workspaceId,
      }
    },
  }
}

export function resolveBridgeCallUrl(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined
  try {
    const url = new URL(value)
    if (url.pathname === "" || url.pathname === "/") {
      url.pathname = BRIDGE_CALL_PATH
    }
    return url.toString()
  } catch {
    return undefined
  }
}

function validateRuntimeBridgeUrl(options: {
  bridgeUrl: string | undefined
  runtimeMode: RuntimeModeId
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
  const isRemote = options.runtimeMode === "vercel-sandbox"
  const isLocalhost = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1"
  if (isRemote && url.protocol !== "https:") return "remote-bridge-url-must-be-https"
  if (isRemote && isLocalhost) return "remote-bridge-url-must-not-be-localhost"
  if (url.protocol === "http:" && !options.allowInsecureHttp && !isLocalhost) return "remote-bridge-url-must-be-https"
  if (url.protocol !== "http:" && url.protocol !== "https:") return "bridge-url-invalid"
  return undefined
}
