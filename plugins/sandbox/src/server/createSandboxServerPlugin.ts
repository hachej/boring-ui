import { createHash } from 'node:crypto'
import type { FastifyPluginAsync } from 'fastify'
import { defineServerPlugin, type WorkspaceServerPlugin } from '@hachej/boring-workspace/server'

import { createSandboxBashTool } from './sandboxBashTool'
import { createSandboxManagementTool } from './sandboxManagementTool'
import { sandboxLeaseOwnerIdForSession } from './leaseOwner'
import type { SandboxLeaseService } from './leaseService'

export interface SandboxLeaseServiceFactoryContext {
  readonly workspaceScopeId: string
  readonly agentTypeId: string
}

export interface CreateSandboxServerPluginOptions {
  /** Host-owned workspace identity. Never derive this value from tool input. */
  readonly workspaceScopeId: string
  /** Independent host-owned grant. Authored Agent plugin selection is insufficient. */
  readonly authorizedAgentTypeIds: readonly string[]
  /** Digest of the admitted plugin package/executable bytes. Independent of host authority. */
  readonly pluginContentDigest: string
  /** Stable host policy/profile digest included separately in Agent runtime identity. */
  readonly authorityDigest: string
  /** Host factory closes over provider, credentials, profile, quotas, TTL, roots, and snapshot. */
  readonly createLeaseService: (context: SandboxLeaseServiceFactoryContext) => SandboxLeaseService
}

export function createSandboxServerPlugin(
  options: CreateSandboxServerPluginOptions,
): WorkspaceServerPlugin {
  if (!options.workspaceScopeId.trim()) throw new TypeError('sandbox workspaceScopeId is required')
  if (!options.pluginContentDigest.trim()) throw new TypeError('sandbox pluginContentDigest is required')
  if (!options.authorityDigest.trim()) throw new TypeError('sandbox authorityDigest is required')
  const authorized = new Set(options.authorizedAgentTypeIds)
  if (authorized.size !== options.authorizedAgentTypeIds.length || [...authorized].some((id) => !id.trim())) {
    throw new TypeError('sandbox authorizedAgentTypeIds must be unique non-empty strings')
  }

  const services = new Map<string, SandboxLeaseService>()
  const assertAuthorized = (agentTypeId: string): void => {
    if (!authorized.has(agentTypeId)) {
      throw new Error(`sandbox host grant denied for Agent "${agentTypeId}"`)
    }
  }
  const serviceFor = (agentTypeId: string): SandboxLeaseService => {
    assertAuthorized(agentTypeId)
    let service = services.get(agentTypeId)
    if (!service) {
      service = options.createLeaseService({
        workspaceScopeId: options.workspaceScopeId,
        agentTypeId,
      })
      services.set(agentTypeId, service)
    }
    return service
  }
  const lazyServiceFor = (agentTypeId: string): SandboxLeaseService => ({
    acquire: (...args) => serviceFor(agentTypeId).acquire(...args),
    listOwn: (...args) => serviceFor(agentTypeId).listOwn(...args),
    status: (...args) => serviceFor(agentTypeId).status(...args),
    release: (...args) => serviceFor(agentTypeId).release(...args),
    withPair: (...args) => serviceFor(agentTypeId).withPair(...args),
  }) as SandboxLeaseService

  const routes: FastifyPluginAsync = async (app) => {
    app.addHook('onClose', async () => {
      const results = await Promise.allSettled([...services.values()].map(async (service) => await service.dispose()))
      const failures = results
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map((result) => result.reason)
      if (failures.length > 0) throw new AggregateError(failures, 'sandbox plugin cleanup failed')
      services.clear()
    })
  }

  const contentDigest = createHash('sha256')
    .update(JSON.stringify({
      contract: 'boring-sandbox-plugin.runtime.v1',
      executable: options.pluginContentDigest,
      authority: options.authorityDigest,
    }))
    .digest('hex')

  return defineServerPlugin({
    id: 'sandbox',
    label: 'Disposable sandbox',
    contentDigest,
    agentConfigContract: { keys: [] },
    agentToolFactory({ agentTypeId }) {
      assertAuthorized(agentTypeId)
      const leases = lazyServiceFor(agentTypeId)
      const toolOptions = {
        leases,
        workspaceScopeId: options.workspaceScopeId,
        agentTypeId,
      }
      return [
        createSandboxManagementTool(toolOptions),
        createSandboxBashTool(toolOptions),
      ]
    },
    async onAgentSessionDelete({ workspaceScopeId, agentTypeId, sessionId }) {
      if (workspaceScopeId !== options.workspaceScopeId) {
        throw new Error('sandbox session cleanup workspace scope mismatch')
      }
      const service = services.get(agentTypeId)
      if (!service) return
      await service.releaseOwner(sandboxLeaseOwnerIdForSession({ workspaceScopeId, agentTypeId }, sessionId))
    },
    routes,
  })
}
