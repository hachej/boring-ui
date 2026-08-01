import type { FastifyInstance, FastifyRequest } from 'fastify'
import {
  fileRoutes,
  fsEventsRoutes,
  gitRoutes,
  searchRoutes,
  treeRoutes,
} from '@hachej/boring-bash/server'
import type { AuthorizedAgentScope } from '../../shared/index'
import type { AgentRuntimeHostOperations } from '../runtime/runtimeHost'
import type { CreatedAgentHost } from './types'

export interface AgentHostEnvironmentHttpProjectionOptions {
  readonly created: CreatedAgentHost
  readonly authorizeAgentRequest: (request: FastifyRequest) => Promise<AuthorizedAgentScope>
  readonly runtimeHost?: AgentRuntimeHostOperations
  readonly getWorkspaceHostRoot?: (request: FastifyRequest) => string | undefined | Promise<string | undefined>
}

/**
 * Mount application-owned filesystem routes over finite Host Environment leases.
 * The FS event stream explicitly retains its lease until the transport closes.
 */
export async function registerAgentHostEnvironmentRoutes(
  app: FastifyInstance,
  options: AgentHostEnvironmentHttpProjectionOptions,
): Promise<void> {
  const leases = new WeakMap<FastifyRequest, Promise<Awaited<ReturnType<CreatedAgentHost['acquireEnvironment']>>>>()
  const deferred = new WeakSet<FastifyRequest>()
  const released = new WeakSet<FastifyRequest>()
  const observingTransport = new WeakSet<FastifyRequest>()
  const transportClosed = new WeakSet<FastifyRequest>()
  const gitHostRoots = new WeakMap<object, string>()

  const acquire = (request: FastifyRequest) => {
    if (!observingTransport.has(request)) {
      observingTransport.add(request)
      const markClosed = () => {
        transportClosed.add(request)
        if (deferred.has(request)) void release(request)
      }
      request.raw.once('aborted', markClosed)
      request.raw.socket.once('close', markClosed)
    }
    let lease = leases.get(request)
    if (!lease) {
      lease = options.authorizeAgentRequest(request).then(async (authorizedScope) => {
        return await options.created.acquireEnvironment({
          authorizedScope,
          intent: { kind: 'http-route', requestId: request.id },
        })
      })
      leases.set(request, lease)
    }
    return lease
  }

  const release = async (request: FastifyRequest) => {
    if (released.has(request)) return
    released.add(request)
    const lease = leases.get(request)
    if (!lease) return
    try {
      await (await lease).release()
    } catch {
      // Cleanup must not replace the route/acquisition error or fail a
      // response that has already been written.
    }
  }

  app.addHook('onResponse', async (request) => {
    if (!deferred.has(request)) await release(request)
  })
  app.addHook('onError', async (request) => {
    if (!deferred.has(request)) await release(request)
  })

  const getWorkspace = async (request: FastifyRequest) => (await acquire(request)).workspace
  const getGitWorkspace = async (request: FastifyRequest) => {
    const workspace = (await acquire(request)).gitWorkspace
    const hostRoot = await options.getWorkspaceHostRoot?.(request)
    if (hostRoot) gitHostRoots.set(workspace as object, hostRoot)
    return workspace
  }
  const getFileSearch = async (request: FastifyRequest) => (await acquire(request)).fileSearch
  const getFilesystemBindings = async (request: FastifyRequest) => [
    ...((await acquire(request)).filesystemBindings ?? []),
  ]
  const deferLeaseRelease = (request: FastifyRequest, reply: import('fastify').FastifyReply) => {
    if (deferred.has(request)) return
    deferred.add(request)
    reply.raw.once('close', () => {
      transportClosed.add(request)
      void release(request)
    })
    if (transportClosed.has(request)) void release(request)
  }

  await app.register(fileRoutes, { getWorkspace, getFilesystemBindings })
  await app.register(fsEventsRoutes, { getWorkspace, deferLeaseRelease })
  await app.register(treeRoutes, { getWorkspace, getFilesystemBindings })
  await app.register(searchRoutes, { getFileSearch })
  await app.register(gitRoutes, {
    getWorkspace: getGitWorkspace,
    getWorkspaceHostRoot: (workspace) => gitHostRoots.get(workspace as object)
      ?? options.runtimeHost?.getNodeWorkspaceHostRoot(workspace),
  })
}
