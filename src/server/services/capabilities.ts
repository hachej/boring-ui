/**
 * Capabilities service — transport-independent capability discovery.
 * Mirrors Python's capabilities.py build_capabilities_response().
 */
import type { CapabilitiesResponse, RouterInfo } from '../../shared/types.js'
import type { ServerConfig } from '../config.js'

export interface CapabilitiesServiceDeps {
  config: ServerConfig
  enabledRouters: RouterInfo[]
  enabledFeatures: Record<string, boolean>
}

export interface CapabilitiesService {
  getCapabilities(): CapabilitiesResponse
}

export function createCapabilitiesService(
  _deps: CapabilitiesServiceDeps,
): CapabilitiesService {
  throw new Error(
    'Not implemented — see bd-1wkce.1 (Phase 4: Capabilities endpoint)',
  )
}
