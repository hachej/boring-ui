import type { FastifyInstance } from 'fastify'
import type { RuntimeModeId } from './runtime/mode'
import type { AgentTool } from '../shared/tool'
import { fileRoutes } from './http/routes/file'
import { fsEventsRoutes } from './http/routes/fsEvents'
import { treeRoutes } from './http/routes/tree'
import { modelsRoutes, type ModelsRoutesOptions } from './http/routes/models'
import { skillsRoutes } from './http/routes/skills'
import { piChatRoutes, type PiChatRoutesOptions } from './http/routes/piChat'
import { systemPromptRoutes } from './http/routes/systemPrompt'
import { sessionChangesRoutes } from './http/routes/sessionChanges'
import { catalogRoutes, type CatalogRoutesOptions } from './http/routes/catalog'
import { readyStatusRoutes, type ReadyStatusRouteOptions } from './http/routes/readyStatus'
import { commandsRoutes } from './http/routes/commands'
import { reloadRoutes } from './http/routes/reload'
import { searchRoutes } from './http/routes/search'
import { gitRoutes } from './http/routes/git'
import { healthRoutes, type HealthRouteOptions } from './http/routes/health'
import type { InMemorySessionChangesTracker } from './http/sessionChangesTracker'

type RouteOptions<T> = T extends (
  app: FastifyInstance,
  opts: infer Options,
  done: (err?: Error) => void,
) => void ? Options : never

type RouteRegistrar = (app: FastifyInstance) => void | Promise<void>

/**
 * Narrow HTTP binding seam for the current Fastify adapters. Runtime suppliers
 * describe already-composed routes/tools/readiness here; this is not a generic
 * AgentFeature/plugin abstraction.
 */
export interface AgentRouteBindingProfile {
  runtimeMode: RuntimeModeId
  capabilities: {
    tools: string[]
    browserDraftNative?: boolean
  }
  sessionChangesTracker: InMemorySessionChangesTracker
  health: HealthRouteOptions & { register?: boolean }
  chat: PiChatRoutesOptions
  models?: ModelsRoutesOptions
  catalog: CatalogRoutesOptions
  readyStatus: ReadyStatusRouteOptions
  filesystem?: {
    file: RouteOptions<typeof fileRoutes>
    fsEvents: RouteOptions<typeof fsEventsRoutes>
    tree: RouteOptions<typeof treeRoutes>
    search: RouteOptions<typeof searchRoutes>
    git: RouteOptions<typeof gitRoutes>
  }
  systemPrompt?: RouteOptions<typeof systemPromptRoutes>
  skills?: RouteOptions<typeof skillsRoutes>
  commands?: RouteOptions<typeof commandsRoutes>
  reload?: RouteOptions<typeof reloadRoutes> | RouteRegistrar
  beforeRegister?: RouteRegistrar
  dispose?: () => void | Promise<void>
}

export function toolNames(tools: readonly AgentTool[]): string[] {
  return tools.map((tool) => tool.name)
}

export async function registerAgentRouteBindingProfile(
  app: FastifyInstance,
  profile: AgentRouteBindingProfile,
): Promise<void> {
  if (profile.dispose) {
    app.addHook('onClose', async () => {
      await profile.dispose?.()
    })
  }
  await profile.beforeRegister?.(app)

  const { register = true, ...health } = profile.health
  if (register) await app.register(healthRoutes, health)

  if (profile.filesystem) {
    await app.register(fileRoutes, profile.filesystem.file)
    await app.register(fsEventsRoutes, profile.filesystem.fsEvents)
    await app.register(treeRoutes, profile.filesystem.tree)
    await app.register(searchRoutes, profile.filesystem.search)
    await app.register(gitRoutes, profile.filesystem.git)
  }

  await app.register(piChatRoutes, profile.chat)
  if (profile.systemPrompt) await app.register(systemPromptRoutes, profile.systemPrompt)
  await app.register(modelsRoutes, profile.models ?? {})
  if (profile.skills) await app.register(skillsRoutes, profile.skills)
  await app.register(sessionChangesRoutes, { tracker: profile.sessionChangesTracker })
  if (profile.reload) {
    if (typeof profile.reload === 'function') {
      await profile.reload(app)
    } else {
      await app.register(reloadRoutes, profile.reload)
    }
  }
  await app.register(catalogRoutes, profile.catalog)
  if (profile.commands) await app.register(commandsRoutes, profile.commands)
  await app.register(readyStatusRoutes, profile.readyStatus)
}
