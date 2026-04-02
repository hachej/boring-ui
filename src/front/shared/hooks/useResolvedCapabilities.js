import { useMemo } from 'react'

/**
 * Merges static (config-provided) capabilities with server-fetched capabilities.
 *
 * In browser-only mode (no server), static capabilities are returned as-is.
 * When a server is available, server-fetched values are merged on top.
 * In core/local mode where the server is unreachable, minimal capabilities
 * are inferred so the PI rail and local data backends still render.
 */
export default function useResolvedCapabilities({
  staticCapabilities,
  serverCapabilities,
  hasLocalDataBackend,
  nativeAgentEnabled,
}) {
  const capabilities = useMemo(() => {
    if (!staticCapabilities) {
      const featureCount = Object.keys(serverCapabilities?.features || {}).length
      // In core/local mode, capability fetch can be unavailable. Infer minimal
      // local capabilities so PI rail and local data backends still render.
      if (serverCapabilities?.version === 'unknown' && featureCount === 0) {
        return {
          version: 'inferred-local',
          features: {
            files: hasLocalDataBackend,
            git: hasLocalDataBackend,
            pi: true,
            chat_claude_code: nativeAgentEnabled,
          },
          routers: [],
        }
      }
      return serverCapabilities
    }
    if (!serverCapabilities || serverCapabilities.version === 'unknown') {
      return {
        version: staticCapabilities.version || 'static',
        features: { ...staticCapabilities.features },
        routers: staticCapabilities.routers || [],
        ...(staticCapabilities.macro_catalog ? { macro_catalog: staticCapabilities.macro_catalog } : {}),
      }
    }
    return {
      ...serverCapabilities,
      features: { ...staticCapabilities.features, ...serverCapabilities.features },
    }
  }, [
    staticCapabilities,
    serverCapabilities,
    hasLocalDataBackend,
    nativeAgentEnabled,
  ])

  return capabilities
}
