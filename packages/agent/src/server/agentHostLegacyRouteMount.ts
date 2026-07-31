import type { FastifyInstance, FastifyRequest } from 'fastify'
import {
  fileRoutes,
  filesystemsRoutes,
  fsEventsRoutes,
  gitRoutes,
  searchRoutes,
  treeRoutes,
} from '@hachej/boring-bash/server'
import type { AgentTool } from '../shared/tool'
import type { AgentHarness } from '../shared/harness'
import type { AuthorizedAgentScope, VerifiedAgentScopeClaim } from '../shared/gateway/types'
import {
  getOptionalRuntimeBundleStorageRoot,
  type RuntimeBundle,
  type RuntimeFilesystemBinding,
  type RuntimeModeId,
} from './runtime/mode'
import type { AgentRuntimeHostOperations } from './runtime/runtimeHost'
import type { WorkspaceProvisioningResult } from './workspace/provisioning'
import type { CompatibilityResolvedAgentRuntimeScope } from './agent-host/buildAgentComposition'
import type { AgentHostLegacyProjectionRuntime } from './agent-host/types'
import type { AgentHostLegacyRoutePolicyOptions } from './agentHostLegacyRouteOptions'
import type { ReadyStatusTracker } from './runtime/readyStatus'
import type { AgentCoreSessionService, PiSessionRequestContext } from '../core/piChatSessionService'
import { AgentEffectAdmissionError } from '../core/piChatSessionService'
import { ErrorCode } from '../shared/error-codes'
import { healthRoutes } from './http/routes/health'
import { modelsRoutes } from './http/routes/models'
import { skillsRoutes } from './http/routes/skills'
import { piChatRoutes } from './http/routes/piChat'
import { systemPromptRoutes } from './http/routes/systemPrompt'
import { sessionChangesRoutes } from './http/routes/sessionChanges'
import { catalogRoutes } from './http/routes/catalog'
import { readyStatusRoutes } from './http/routes/readyStatus'
import { commandsRoutes } from './http/routes/commands'

function isPiSessionHttpRequest(request: FastifyRequest): boolean {
  const pathname = request.url.split('?', 1)[0] ?? request.url
  const apiIndex = pathname.indexOf('/api/v1/')
  const apiPath = apiIndex >= 0 ? pathname.slice(apiIndex) : pathname
  return apiPath === '/api/v1/agent/pi-chat/sessions'
    || apiPath.startsWith('/api/v1/agent/pi-chat/')
    || /^\/api\/v1\/agents\/[^/]+\/sessions(?:\/|$)/.test(apiPath)
}
import { deepLinkRoutes } from './http/routes/deepLink'
import type { InMemorySessionChangesTracker } from './http/sessionChangesTracker'

const DEFAULT_VERSION = '0.1.0-dev'
const DEFAULT_WORKSPACE_ID = 'default'

type HostWithCapabilitiesContributor = FastifyInstance & {
  registerCapabilitiesContributor?: (
    name: string,
    fn: (ctx: { config: unknown }) => unknown | Promise<unknown>,
  ) => void
}

interface LegacyRouteBinding {
  readonly runtimeBundle: RuntimeBundle
  readonly workspaceRoot: string
  readonly runtimeProvisioning?: WorkspaceProvisioningResult
  readonly readyTracker: ReadyStatusTracker
  readonly harness: AgentHarness
  readonly tools: AgentTool[]
  readonly piChatService: AgentCoreSessionService
  readonly hostScope: CompatibilityResolvedAgentRuntimeScope
  readonly assertActive: () => void
  readonly reprovision: (request?: FastifyRequest) => Promise<WorkspaceProvisioningResult | undefined>
  lastReloadDiagnostics?: Array<{ source: string; message: string; pluginId?: string }>
}

interface LegacySkillScope {
  readonly root: string
  readonly pi: import('./harness/pi-coding-agent/createHarness').ResolvedPiHarnessOptions
}

export interface MountOrderedAgentHostLegacyRoutesInput {
  readonly app: FastifyInstance
  readonly opts: AgentHostLegacyRoutePolicyOptions
  readonly runtime: AgentHostLegacyProjectionRuntime
  readonly defaultAgentTypeId: string
  readonly sessionId: string
  readonly workspaceRoot: string
  readonly resolvedMode: RuntimeModeId
  readonly runtimeHost?: AgentRuntimeHostOperations
  readonly requestScopedRuntime: boolean
  readonly modelsWorkspaceScoped: boolean
  readonly staticBinding: LegacyRouteBinding | null
  readonly hasRuntimeProvisioningInput: boolean
  readonly sessionChangesTracker: InMemorySessionChangesTracker
  readonly agentToolNames: string[]
  readonly getAvailableModelProviders: () => string[]
  readonly getRequestWorkspaceId: (request: FastifyRequest) => string
  readonly getRequestAuthSubject: (request?: FastifyRequest) => string | undefined
  readonly promoteRawFileWorkspaceQueryToHeader: (request: FastifyRequest) => void
  readonly isWorkspaceAgnosticAgentRequest: (
    request: FastifyRequest,
    options?: { readyStatusWorkspaceScoped?: boolean; modelsWorkspaceScoped?: boolean },
  ) => boolean
  readonly getBindingForRequest: (
    request: FastifyRequest,
    options?: { failIfPending?: boolean },
  ) => Promise<LegacyRouteBinding>
  readonly getFilesystemBindingsForRequest: (request: FastifyRequest) => Promise<RuntimeFilesystemBinding[] | undefined>
  readonly getSkillsScopeForRequest: (request: FastifyRequest) => Promise<LegacySkillScope>
  readonly issueScope: (
    claim: VerifiedAgentScopeClaim,
    runtimeScope: CompatibilityResolvedAgentRuntimeScope,
  ) => AuthorizedAgentScope
  readonly deferLeaseRelease: (request: FastifyRequest) => void
}

/** Mounts the audited legacy/application route families in their canonical order. */
export async function mountOrderedAgentHostLegacyRoutes(
  input: MountOrderedAgentHostLegacyRoutesInput,
): Promise<void> {
  const {
    app,
    opts,
    runtime: agentHost,
    defaultAgentTypeId,
    sessionId,
    workspaceRoot,
    resolvedMode,
    runtimeHost,
    requestScopedRuntime,
    modelsWorkspaceScoped,
    staticBinding,
    hasRuntimeProvisioningInput,
    sessionChangesTracker,
    agentToolNames,
    getAvailableModelProviders,
    getRequestWorkspaceId,
    getRequestAuthSubject,
    promoteRawFileWorkspaceQueryToHeader,
    isWorkspaceAgnosticAgentRequest,
    getBindingForRequest,
    getFilesystemBindingsForRequest,
    getSkillsScopeForRequest,
    issueScope,
    deferLeaseRelease,
  } = input
  const bindingLifecycle = { deferRequestUntilTransportClose: deferLeaseRelease }
  const hostWithCapabilitiesContributor = app as HostWithCapabilitiesContributor
  if (
    typeof hostWithCapabilitiesContributor.registerCapabilitiesContributor ===
    'function'
  ) {
    hostWithCapabilitiesContributor.registerCapabilitiesContributor(
      'agent',
      () => ({
        agent: {
          runtimeMode: resolvedMode,
          tools: agentToolNames,
          modelProviders: getAvailableModelProviders(),
        },
      }),
    )
  }

  // Bridge host app's request.user → agent's request.workspaceContext.
  // In embedded mode core's authHook already populates request.user;
  // this hook maps it to the shape agent routes expect. Scoped to agent
  // routes only (Fastify encapsulates hooks within the plugin).
  app.addHook('onRequest', async (request, reply) => {
    const user = (request as unknown as {
      user?: { id: string; email?: string; emailVerified?: boolean } | null
    }).user
    let workspaceId = DEFAULT_WORKSPACE_ID
    promoteRawFileWorkspaceQueryToHeader(request)
    if (opts.getWorkspaceId && !isWorkspaceAgnosticAgentRequest(request, { readyStatusWorkspaceScoped: requestScopedRuntime, modelsWorkspaceScoped })) {
      try {
        workspaceId = (await opts.getWorkspaceId(request)).trim()
      } catch (error) {
        if (
          typeof error === 'object'
          && error !== null
          && 'status' in error
          && error.status === 421
          && 'code' in error
          && error.code === ErrorCode.enum.AGENT_HOST_SCOPE_VIOLATION
        ) {
          throw error
        }
        const statusCode = typeof (error as { statusCode?: unknown })?.statusCode === 'number'
          ? (error as { statusCode: number }).statusCode
          : 400
        const message = statusCode >= 500
          ? 'workspace scope failed'
          : error instanceof Error
            ? error.message
            : 'workspace id is required'
        return reply.code(statusCode).send({
          error: { code: ErrorCode.enum.WORKSPACE_UNINITIALIZED, message },
        })
      }
      if (workspaceId.length === 0) {
        return reply.code(400).send({
          error: {
            code: ErrorCode.enum.WORKSPACE_UNINITIALIZED,
            message: 'workspace id is required',
          },
        })
      }
    }
    let authSubject = user?.id
    if (opts.resolvePiSessionRequestContext && isPiSessionHttpRequest(request)) {
      const storageScopeHeader = request.headers['x-boring-storage-scope']
      const defaultContext: PiSessionRequestContext = {
        workspaceId,
        storageScope: typeof storageScopeHeader === 'string' && storageScopeHeader.length > 0
          ? storageScopeHeader
          : undefined,
        authSubject,
        authEmail: typeof user?.email === 'string' && user.email.length > 0 ? user.email : undefined,
        authEmailVerified: user?.emailVerified === true,
        requestId: request.id,
      }
      const sessionContext = await opts.resolvePiSessionRequestContext(request, defaultContext)
      ;(request as FastifyRequest & { piSessionRequestContext?: PiSessionRequestContext }).piSessionRequestContext = {
        ...sessionContext,
        workspaceId,
        requestId: sessionContext.requestId || request.id,
      }
      authSubject = sessionContext.authSubject
    }
    request.workspaceContext = {
      workspaceId,
      authenticated: !!user,
      ...(authSubject ? { authSubject } : {}),
    }
  })

  const registerHealthRoute = opts.registerHealthRoute ?? true
  if (registerHealthRoute) {
    await app.register(healthRoutes, {
      version: opts.version ?? DEFAULT_VERSION,
      getReadiness: () => staticBinding?.readyTracker.getReadiness() ?? {
        sandboxReady: true,
        harnessReady: true,
      },
    })
  }

  await app.register(fileRoutes, {
    getWorkspace: async (request) => (await getBindingForRequest(request)).runtimeBundle.workspace,
    getFilesystemBindings: getFilesystemBindingsForRequest,
  })
  await app.register(filesystemsRoutes, {
    getFilesystemBindings: getFilesystemBindingsForRequest,
  })
  await app.register(fsEventsRoutes, {
    getWorkspace: async (request) => (await getBindingForRequest(request)).runtimeBundle.workspace,
    deferLeaseRelease: bindingLifecycle.deferRequestUntilTransportClose,
  })
  await app.register(treeRoutes, {
    getWorkspace: async (request) => (await getBindingForRequest(request)).runtimeBundle.workspace,
    getFilesystemBindings: getFilesystemBindingsForRequest,
  })
  await app.register(searchRoutes, {
    getFileSearch: async (request) => (await getBindingForRequest(request)).runtimeBundle.fileSearch,
    getFilesystemBindings: getFilesystemBindingsForRequest,
  })
  if (opts.shareEntryStore) {
    await app.register(deepLinkRoutes, {
      store: opts.shareEntryStore,
      getWorkspace: async (request) => (await getBindingForRequest(request)).runtimeBundle.workspace,
    })
  }
  await app.register(gitRoutes, {
    getWorkspace: async (request) => {
      const runtimeBundle = (await getBindingForRequest(request)).runtimeBundle
      const storageRoot = getOptionalRuntimeBundleStorageRoot(runtimeBundle)
      return storageRoot === undefined
        ? runtimeBundle.workspace
        : runtimeHost?.createNodeWorkspace(storageRoot) ?? runtimeBundle.workspace
    },
    getWorkspaceHostRoot: runtimeHost?.getNodeWorkspaceHostRoot,
  })
  await app.register(agentHost.createAddressedRoutes({
    async authorizeRequest(request) {
      const binding = await getBindingForRequest(request)
      return issueScope({
        workspaceScopeId: getRequestWorkspaceId(request),
        authSubjectId: getRequestAuthSubject(request) ?? 'legacy',
      }, binding.hostScope)
    },
    defaultAgentTypeId,
  }))
  await app.register(piChatRoutes, {
    getService: async (request) => {
      const binding = await getBindingForRequest(request)
      const scope = issueScope({
        workspaceScopeId: getRequestWorkspaceId(request),
        authSubjectId: getRequestAuthSubject(request) ?? 'legacy',
      }, binding.hostScope)
      return agentHost.createPiChatService({
        service: binding.piChatService,
        scope,
        agentTypeId: defaultAgentTypeId,
      })
    },
    deferLeaseRelease: bindingLifecycle.deferRequestUntilTransportClose,
  })
  await app.register(systemPromptRoutes, {
    getHarness: async (request) => (await getBindingForRequest(request)).harness,
  })
  await app.register(modelsRoutes, {
    filterModels: opts.filterModels,
  })
  await app.register(skillsRoutes, {
    workspace: staticBinding
      ? runtimeHost?.createNodeWorkspace(workspaceRoot) ?? staticBinding.runtimeBundle.workspace
      : undefined,
    additionalSkillPaths: [
      ...(staticBinding?.runtimeProvisioning?.skillPaths ?? []),
      ...(opts.pi?.additionalSkillPaths ?? []),
    ],
    piPackages: opts.pi?.packages,
    // Undefined is fine: skillsRoutes resolves it through the canonical
    // harness policy (withPiHarnessDefaults), same as the factory above.
    noSkills: opts.pi?.noSkills,
    getWorkspace: staticBinding
      ? undefined
      : async (request) => {
          const scope = await getSkillsScopeForRequest(request)
          if (runtimeHost) return runtimeHost.createNodeWorkspace(scope.root)
          return (await getBindingForRequest(request)).runtimeBundle.workspace
        },
    getAdditionalSkillPaths: staticBinding && !hasRuntimeProvisioningInput && !opts.pi?.getHotReloadableResources
      ? undefined
      : async (request) => {
          const scope = await getSkillsScopeForRequest(request)
          if (!hasRuntimeProvisioningInput) return scope.pi.additionalSkillPaths
          const binding = await getBindingForRequest(request)
          return [
            ...(binding.runtimeProvisioning?.skillPaths ?? []),
            ...(scope.pi.additionalSkillPaths ?? []),
          ]
        },
    getPiPackages: staticBinding && !opts.pi?.getHotReloadableResources
      ? undefined
      : async (request) => (await getSkillsScopeForRequest(request)).pi.packages,
    getNoSkills: staticBinding
      ? undefined
      : async (request) => (await getSkillsScopeForRequest(request)).pi.noSkills,
  })
  await app.register(sessionChangesRoutes, { tracker: sessionChangesTracker })
  app.post<{ Body: { sessionId?: string } }>('/api/v1/agent/reload', async (request, reply) => {
    const workspaceId = getRequestWorkspaceId(request)
    const binding = await getBindingForRequest(request)
    if (!binding.harness.reloadSession) {
      return reply.status(501).send({ ok: false, error: 'Agent harness does not support reload' })
    }

    try {
      await opts.admitEffect?.({ workspaceId, requestId: request.id })
      await binding.reprovision(request)
      binding.assertActive()
      const hookResult = await opts.beforeReload?.({
        workspaceId,
        workspaceRoot: binding.workspaceRoot,
        request,
      })
      binding.assertActive()
      const reloadSessionId = request.body?.sessionId || sessionId
      const reloaded = await binding.harness.reloadSession(reloadSessionId)
      binding.assertActive()
      const restart_warnings = hookResult?.restart_warnings
      const diagnostics: Array<{ source: string; message: string; pluginId?: string }> = [
        ...(hookResult?.diagnostics ?? []),
        ...(binding.harness.getResourceDiagnostics?.(reloadSessionId) ?? []).map((d) => ({
          source: d.source,
          // The harness already folds the path into the message (front only
          // renders `.message`).
          message: d.message,
        })),
      ]
      // If the harness reported nothing reloaded (no live agent session yet),
      // surface a note so a "/reload had no effect" state is observable rather
      // than looking like a clean reload.
      if (!reloaded) {
        diagnostics.push({
          source: 'reload',
          message: 'No live agent session to reload yet — changes apply to the next session.',
        })
      }
      binding.lastReloadDiagnostics = diagnostics
      return {
        ok: true,
        sessionId: reloadSessionId,
        reloaded,
        ...(restart_warnings && restart_warnings.length > 0 ? { restart_warnings } : {}),
        ...(diagnostics.length > 0 ? { diagnostics } : {}),
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (error instanceof AgentEffectAdmissionError) {
        return reply.status(error.statusCode).send({ ok: false, error: { code: error.code, message } })
      }
      return reply.status(422).send({ ok: false, error: message })
    }
  })
  await app.register(catalogRoutes, staticBinding
    ? { tools: staticBinding.tools }
    : { getTools: async (request) => (await getBindingForRequest(request)).tools },
  )
  await app.register(commandsRoutes, staticBinding
    ? {
        harness: staticBinding.harness,
        defaultSessionId: sessionId,
        workdir: staticBinding.runtimeBundle.workspace.root,
        metering: opts.metering,
        admitEffect: opts.admitEffect,
      }
    : {
        defaultSessionId: sessionId,
        getHarness: async (request) => (await getBindingForRequest(request)).harness,
        getWorkdir: async (request) => (await getBindingForRequest(request)).runtimeBundle.workspace.root,
        metering: opts.metering,
        admitEffect: opts.admitEffect,
      },
  )
  await app.register(readyStatusRoutes, staticBinding
    ? { tracker: staticBinding.readyTracker, deferLeaseRelease: bindingLifecycle.deferRequestUntilTransportClose }
    : {
        getTracker: async (request) => (await getBindingForRequest(request)).readyTracker,
        deferLeaseRelease: bindingLifecycle.deferRequestUntilTransportClose,
      },
  )

}
