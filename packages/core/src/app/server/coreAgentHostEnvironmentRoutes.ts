import {
  fileRoutes,
  filesystemsRoutes,
  fsEventsRoutes,
  gitRoutes,
  searchRoutes,
  treeRoutes,
} from '@hachej/boring-bash/server'
import {
  deepLinkRoutes,
  type AgentRuntimeHostOperations,
  type AuthorizedAgentScope,
  type CreatedAgentHost,
} from '@hachej/boring-agent/server'
import type { ShareEntryStore } from '@hachej/boring-agent/shared'
import type { FastifyInstance, FastifyRequest } from 'fastify'

export interface CoreAgentHostEnvironmentRoutesOptions {
  readonly agentHost: CreatedAgentHost
  readonly authorizeAgentRequest: (request: FastifyRequest) => Promise<AuthorizedAgentScope>
  readonly runtimeHost: AgentRuntimeHostOperations
  readonly shareEntryStore?: ShareEntryStore
}

/**
 * Mounts Core-owned filesystem/share routes over one request-scoped Host
 * Environment lease. Finite requests release after the response; the FS event
 * transport keeps its lease until the underlying socket closes.
 */
export async function registerCoreAgentHostEnvironmentRoutes(
  app: FastifyInstance,
  options: CoreAgentHostEnvironmentRoutesOptions,
): Promise<void> {
  const leases = new WeakMap<FastifyRequest, Promise<Awaited<ReturnType<CreatedAgentHost['acquireEnvironment']>>>>()
  const deferred = new WeakSet<FastifyRequest>()
  const released = new WeakSet<FastifyRequest>()
  const transportClosed = new WeakSet<FastifyRequest>()

  const release = async (request: FastifyRequest) => {
    if (released.has(request)) return
    released.add(request)
    const pending = leases.get(request)
    if (!pending) return
    try {
      ;(await pending).release()
    } catch {
      // Acquisition failures have no lease to release and retain their original error.
    }
  }
  const acquire = (request: FastifyRequest) => {
    let pending = leases.get(request)
    if (!pending) {
      pending = (async () => options.agentHost.acquireEnvironment({
        authorizedScope: await options.authorizeAgentRequest(request),
        intent: { kind: 'http-route', requestId: request.id },
      }))()
      leases.set(request, pending)
      pending.catch(() => leases.delete(request))
    }
    return pending
  }
  const deferLeaseRelease = (request: FastifyRequest) => {
    if (deferred.has(request)) return
    deferred.add(request)
    if (transportClosed.has(request)) void release(request)
  }

  app.addHook('onRequest', async (request, reply) => {
    const close = () => {
      transportClosed.add(request)
      if (deferred.has(request)) void release(request)
    }
    request.raw.once('aborted', close)
    reply.raw.once('close', close)
  })
  app.addHook('onResponse', async (request) => {
    if (!deferred.has(request)) await release(request)
  })
  app.addHook('onError', async (request) => {
    if (!deferred.has(request)) await release(request)
  })

  const getFilesystemBindings = async (request: FastifyRequest) => {
    const bindings = (await acquire(request)).filesystemBindings
    return bindings ? [...bindings] : undefined
  }

  await app.register(fileRoutes, {
    getWorkspace: async (request: FastifyRequest) => (await acquire(request)).workspace,
    getFilesystemBindings,
  })
  await app.register(filesystemsRoutes, { getFilesystemBindings })
  await app.register(fsEventsRoutes, {
    getWorkspace: async (request: FastifyRequest) => (await acquire(request)).workspace,
    deferLeaseRelease,
  })
  await app.register(treeRoutes, {
    getWorkspace: async (request: FastifyRequest) => (await acquire(request)).workspace,
    getFilesystemBindings,
  })
  await app.register(searchRoutes, {
    getFileSearch: async (request: FastifyRequest) => (await acquire(request)).fileSearch,
    getFilesystemBindings,
  })
  if (options.shareEntryStore) {
    await app.register(deepLinkRoutes, {
      store: options.shareEntryStore,
      getWorkspace: async (request: FastifyRequest) => (await acquire(request)).workspace,
    })
  }
  await app.register(gitRoutes, {
    getWorkspace: async (request: FastifyRequest) => (await acquire(request)).gitWorkspace,
    getWorkspaceHostRoot: options.runtimeHost.getNodeWorkspaceHostRoot,
  })
}
