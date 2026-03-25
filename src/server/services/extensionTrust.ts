/**
 * Extension trust model for child app plugins.
 *
 * Two modes:
 * - trusted-local (self-hosted): all server plugins allowed freely
 * - allowlist (hosted/managed): only admin-approved routers/tools load
 *
 * Browser-only panel extensions require no server trust.
 */

export type ExtensionTrustMode = 'trusted-local' | 'allowlist'

export interface ExtensionTrustConfig {
  /** Trust mode: trusted-local allows everything, allowlist restricts */
  mode: ExtensionTrustMode
  /** API version for extension compatibility */
  api_version: number
  /** Approved router names (allowlist mode only) */
  allowedRouters?: string[]
  /** Approved tool names (allowlist mode only) */
  allowedTools?: string[]
}

/** Default trust configuration for self-hosted deployments. */
export const DEFAULT_TRUST_CONFIG: ExtensionTrustConfig = {
  mode: 'trusted-local',
  api_version: 1,
}

/**
 * Check if a server-side router is allowed to load.
 * In trusted-local mode, all routers are allowed.
 * In allowlist mode, only explicitly listed routers are allowed.
 */
export function isRouterAllowed(
  config: ExtensionTrustConfig,
  routerName: string,
): boolean {
  if (config.mode === 'trusted-local') return true
  return (config.allowedRouters ?? []).includes(routerName)
}

/**
 * Check if an agent tool is allowed to register.
 * In trusted-local mode, all tools are allowed.
 * In allowlist mode, only explicitly listed tools are allowed.
 */
export function isToolAllowed(
  config: ExtensionTrustConfig,
  toolName: string,
): boolean {
  if (config.mode === 'trusted-local') return true
  return (config.allowedTools ?? []).includes(toolName)
}
