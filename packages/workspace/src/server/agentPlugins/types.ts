import type { FastifyReply, FastifyRequest } from "fastify"

export interface BoringPackageField {
  /** Stable runtime id. Defaults to package name when omitted. */
  id?: string
  front?: string
  /**
   * Optional dynamic boring server asset entry. Omit for convention-based
   * server/index.{ts,js}; set false when a package has static Fastify routes
   * that are not compatible with the dynamic exact-route API yet.
   */
  server?: string | false
  label?: string
  panels?: Array<{ id: string; title?: string }>
  commands?: Array<{ id: string; title: string; panelId?: string }>
  leftTabs?: Array<{ id: string; title: string; panelId: string }>
  surfaceResolvers?: Array<{ id: string; surfaceKind: string; panelId: string }>
  systemPrompt?: string
  derivesFrom?: string
}

export interface BoringPluginManifest {
  id: string
  rootDir: string
  version: string
  boring: BoringPackageField
  frontPath?: string
  frontUrl?: string
  serverPath?: string
}

export type BoringPluginEvent =
  | {
      type: "boring.plugin.load"
      id: string
      boring: BoringPackageField
      version: string
      revision: number
      frontUrl?: string
    }
  | { type: "boring.plugin.unload"; id: string; revision: number }
  | { type: "boring.plugin.error"; id: string; revision: number; message: string }

export interface BoringPluginListEntry {
  id: string
  boring: BoringPackageField
  version: string
  revision: number
  frontUrl?: string
}

export type BoringServerRouteHandler = (
  request: FastifyRequest,
  reply: FastifyReply,
) => unknown | Promise<unknown>

export interface CapturedBoringServerRoute {
  method: string
  path: string
  handler: BoringServerRouteHandler
}

export interface BoringServerAPI {
  get(path: string, handler: BoringServerRouteHandler): void
  post(path: string, handler: BoringServerRouteHandler): void
  put(path: string, handler: BoringServerRouteHandler): void
  patch(path: string, handler: BoringServerRouteHandler): void
  delete(path: string, handler: BoringServerRouteHandler): void
}

export type BoringServerFactory = (api: BoringServerAPI) => void | Promise<void>
