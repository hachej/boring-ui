import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { AgentGatewayError, AgentGatewayErrorCode } from '../../shared/index'
import { ErrorCode } from '../../shared/error-codes'
import type { AgentHarness, RunContext } from '../../shared/harness'
import type { AgentTool } from '../../shared/tool'
import type { Workspace } from '../../shared/workspace'
import type { PiHarnessOptions } from '../harness/pi-coding-agent/createHarness'
import { catalogRoutes } from '../http/routes/catalog'
import { modelsRoutes, type ModelsRoutesOptions } from '../http/routes/models'
import { readyStatusRoutes } from '../http/routes/readyStatus'
import { sessionChangesRoutes } from '../http/routes/sessionChanges'
import { skillsRoutes } from '../http/routes/skills'
import { systemPromptRoutes } from '../http/routes/systemPrompt'
import type { SessionChangesTracker } from '../http/sessionChangesTracker'
import type { AgentMeteringSink } from '../pi-chat/metering'
import type { ReadyStatusTracker } from '../runtime/readyStatus'
import { canonicalDigest } from './canonical'
import type { AgentHostRuntime, RuntimeBinding } from './createAgentHost'
import type { EmbeddedAgentGateway } from './embeddedGateway'
import type { AgentHostDirectProjectionOptions } from './types'
import { projectStableServiceError } from './stableServiceError'

const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]+$/
const AgentParams = z.object({ agentTypeId: z.string().min(1).max(128) }).passthrough()
const ReloadBody = z.object({
  requestId: z.string().trim().min(1).max(128).regex(SAFE_REQUEST_ID),
  sessionId: z.string().trim().min(1).max(128).optional(),
}).strict()
const CommandBody = z.object({
  requestId: z.string().trim().min(1).max(128).regex(SAFE_REQUEST_ID),
  sessionId: z.string().trim().min(1).max(128),
  name: z.string().trim().min(1).max(256),
  args: z.string().max(1_000_000),
}).strict()

export interface AgentHostRuntimeCapabilityBinding {
  readonly harness: AgentHarness
  readonly tools: readonly AgentTool[]
  readonly workspace: Workspace
  readonly readyTracker: ReadyStatusTracker
  readonly pi?: PiHarnessOptions
  readonly additionalSkillPaths?: readonly string[]
  readonly runContext: RunContext
}

export interface AgentHostRuntimeCapabilityProjection {
  readonly filterModels?: ModelsRoutesOptions['filterModels']
  readonly sessionChangesTracker?: SessionChangesTracker
  readonly metering?: Pick<AgentMeteringSink, 'isEnabled'>
  registerSubscription(close: () => void | Promise<void>): () => void
  authorizeRequest(input: {
    readonly request: FastifyRequest
    readonly agentTypeId: string
  }): Promise<void>
  resolveBinding(input: {
    readonly request: FastifyRequest
    readonly agentTypeId: string
    readonly sessionId?: string
  }): Promise<AgentHostRuntimeCapabilityBinding>
  reload(input: {
    readonly request: FastifyRequest
    readonly agentTypeId: string
    readonly requestId: string
    readonly sessionId?: string
  }): Promise<unknown>
  executeCommand(input: {
    readonly request: FastifyRequest
    readonly agentTypeId: string
    readonly requestId: string
    readonly sessionId: string
    readonly name: string
    readonly args: string
  }): Promise<unknown>
}

/** Builds the Host-owned runtime capability adapter without acquiring bindings during route registration. */
export function createAgentHostRuntimeCapabilityProjection(input: {
  readonly runtime: AgentHostRuntime
  readonly gateway: EmbeddedAgentGateway
  readonly options: Pick<
    AgentHostDirectProjectionOptions,
    'authorizeAgentRequest' | 'defaultSessionId' | 'filterModels' | 'sessionChangesTracker'
  >
}): AgentHostRuntimeCapabilityProjection {
  const { runtime, gateway, options } = input
  const authorized = new WeakMap<FastifyRequest, Promise<{
    scope: import('../../shared/index').AuthorizedAgentScope
    claim: import('../../shared/index').VerifiedAgentScopeClaim
  }>>()
  const authorize = (request: FastifyRequest) => {
    let result = authorized.get(request)
    if (!result) {
      result = (async () => {
        const scope = await options.authorizeAgentRequest(request)
        const claim = await runtime.verify(scope)
        return { scope, claim }
      })()
      authorized.set(request, result)
    }
    return result
  }
  const resolve = async (request: FastifyRequest, agentTypeId: string, sessionId?: string) => {
    const { scope, claim } = await authorize(request)
    if (sessionId) {
      const pinned = await gateway.resolveHostSessionBinding(scope, { agentTypeId, sessionId })
      return { scope, claim: pinned.claim, binding: pinned.binding }
    }
    const resolved = await runtime.resolveAgentRuntimeScope(
      agentTypeId,
      scope,
      claim,
      'new-binding',
      request.id,
    )
    const binding = await runtime.resolveBinding(agentTypeId, scope, claim, resolved)
    return { scope, claim, binding }
  }
  return {
    filterModels: options.filterModels,
    sessionChangesTracker: options.sessionChangesTracker,
    metering: runtime.options.metering,
    registerSubscription: runtime.registerSubscription,
    async authorizeRequest({ request, agentTypeId }) {
      await authorize(request)
      if (!runtime.compiledById.has(agentTypeId)) {
        throw new AgentGatewayError(AgentGatewayErrorCode.AGENT_TYPE_UNKNOWN, 'agent type is not available')
      }
    },
    async resolveBinding({ request, agentTypeId, sessionId }) {
      const { claim, binding } = await resolve(request, agentTypeId, sessionId)
      const hotResources = binding.scope.pi?.getHotReloadableResources?.()
      const pi = hotResources
        ? {
            ...binding.scope.pi,
            additionalSkillPaths: [
              ...(binding.scope.pi?.additionalSkillPaths ?? []),
              ...(hotResources.additionalSkillPaths ?? []),
            ],
            packages: [
              ...(binding.scope.pi?.packages ?? []),
              ...(hotResources.packages ?? []),
            ],
            extensionPaths: [
              ...(binding.scope.pi?.extensionPaths ?? []),
              ...(hotResources.extensionPaths ?? []),
            ],
          }
        : binding.scope.pi
      const user = (request as typeof request & {
        user?: { id?: unknown; email?: unknown; emailVerified?: unknown } | null
      }).user
      return {
        harness: binding.composition.harness,
        tools: binding.composition.tools,
        workspace: binding.composition.runtimeBundle.workspace,
        readyTracker: binding.composition.readyTracker,
        pi,
        additionalSkillPaths: binding.environmentLease.provisioning?.skillPaths,
        runContext: {
          abortSignal: new AbortController().signal,
          workdir: binding.composition.runtimeBundle.workspace.root,
          workspaceId: claim.workspaceScopeId,
          requestId: request.id,
          userId: claim.authSubjectId,
          sessionCtx: {
            workspaceId: claim.workspaceScopeId,
            runtimeScopeIdentity: binding.scope.identity,
          },
          ...(typeof user?.email === 'string' && user.email.trim()
            ? { userEmail: user.email.trim() }
            : {}),
          userEmailVerified: user?.emailVerified === true,
        },
      }
    },
    async executeCommand({ request, agentTypeId, requestId, sessionId, name, args }) {
      const { scope, binding } = await resolve(request, agentTypeId, sessionId)
      if (!binding.composition.harness.executeSlashCommand) {
        throw new AgentGatewayError(
          AgentGatewayErrorCode.AGENT_COMMAND_INVALID_STATE,
          'Command execution is not supported by this Agent',
        )
      }
      const target = { kind: 'session' as const, ref: { agentTypeId, sessionId } }
      return await gateway.runHostEffect({
        scope,
        operation: 'session.command.execute',
        target,
        requestId,
        payload: { ref: target.ref, name, args },
        action: () => runtime.runBindingOperation(binding.key, async () => {
          await binding.composition.harness.executeSlashCommand!(sessionId, name, args, {
            abortSignal: new AbortController().signal,
            workdir: binding.composition.runtimeBundle.workspace.root,
            workspaceId: scope.workspaceScopeId,
            requestId,
            userId: scope.authSubjectId,
            sessionCtx: {
              workspaceId: scope.workspaceScopeId,
              runtimeScopeIdentity: binding.scope.identity,
            },
          })
          return { ok: true, sessionId, name }
        }),
      })
    },
    async reload({ request, agentTypeId, requestId, sessionId }) {
      const { scope, claim } = await authorize(request)
      const candidate = await runtime.resolveAgentRuntimeScope(
        agentTypeId,
        scope,
        claim,
        'reload',
        requestId,
        sessionId,
      )
      if (!candidate.resourceInputDigest?.trim()) {
        throw new TypeError('reload candidate requires an immutable resourceInputDigest')
      }
      const candidateIdentity = canonicalDigest(candidate.identity)
      const candidateFingerprint = canonicalDigest(candidate.environment.provisioningFingerprint)
      const candidatePhysicalBinding = canonicalDigest(candidate.physicalBindingIdentity ?? candidate.identity)
      const target = { kind: 'agent' as const, agentTypeId }
      const reloadSessionId = sessionId ?? options.defaultSessionId ?? 'default'
      let binding: RuntimeBinding | undefined
      return await gateway.runHostEffect({
        scope,
        operation: 'agent.reload',
        target,
        requestId,
        payload: {
          target,
          sessionId: sessionId ?? null,
          candidateIdentity,
          candidateFingerprint,
          candidatePhysicalBinding,
          candidateInputDigest: candidate.resourceInputDigest,
        },
        classify: async () => {
          const current = runtime.findPublishedCurrentBinding(
            agentTypeId,
            claim.workspaceScopeId,
            candidate.physicalBindingIdentity ?? candidate.identity,
            candidate.identity,
            candidate.environment.provisioningFingerprint,
          )
          if (sessionId) {
            const pinned = (await gateway.inspectPublishedSessionBinding(scope, { agentTypeId, sessionId })).binding
            if (current && pinned.generation !== current.generation) {
              return {
                kind: 'reject' as const,
                error: {
                  code: AgentGatewayErrorCode.AGENT_RUNTIME_RESTART_REQUIRED,
                  message: 'Session is pinned to a retired Agent runtime; restart is required',
                },
              }
            }
          }
          binding = current
          if (!binding) {
            return {
              kind: 'reject' as const,
              error: new AgentGatewayError(
                AgentGatewayErrorCode.AGENT_COMMAND_INVALID_STATE,
                'Agent runtime binding is not currently published',
              ).toJSON(),
            }
          }
          const currentIdentity = canonicalDigest(binding.scope.identity)
          const currentFingerprint = canonicalDigest(binding.scope.environment.provisioningFingerprint)
          const currentPhysicalBinding = canonicalDigest(binding.scope.physicalBindingIdentity ?? binding.scope.identity)
          if (
            currentIdentity !== candidateIdentity
            || currentFingerprint !== candidateFingerprint
            || currentPhysicalBinding !== candidatePhysicalBinding
          ) {
            return {
              kind: 'reject' as const,
              error: {
                code: AgentGatewayErrorCode.AGENT_RUNTIME_RESTART_REQUIRED,
                message: 'Agent runtime identity changed; restart is required',
                details: {
                  currentIdentity,
                  candidateIdentity,
                  currentFingerprint,
                  candidateFingerprint,
                  currentPhysicalBinding,
                  candidatePhysicalBinding,
                },
              },
            }
          }
          await candidate.revalidateResourceInputs?.()
          return { kind: 'execute' as const }
        },
        action: async () => {
          const current = binding
          if (!current) throw new TypeError('reload executed before binding classification')
          return await runtime.runBindingOperation(current.key, async () => {
            // Admission is asynchronous and occurs after classification. Fence
            // again before the first external reload mutation; failures from
            // this post-begin point intentionally remain outcome-unknown.
            await candidate.revalidateResourceInputs?.()
            if (!current.composition.harness.reloadSession) {
              throw new AgentGatewayError(
                AgentGatewayErrorCode.AGENT_COMMAND_INVALID_STATE,
                'Agent harness does not support reload',
              )
            }
            const applied = await candidate.applyReload?.({
              runtimeBundle: current.composition.runtimeBundle,
            })
            await candidate.revalidateResourceInputs?.()
            const reloaded = await current.composition.harness.reloadSession(reloadSessionId)
            await candidate.revalidateResourceInputs?.()
            const diagnostics = (current.composition.harness.getResourceDiagnostics?.(reloadSessionId) ?? [])
              .map((entry) => ({ source: entry.source, message: entry.message }))
            const mergedDiagnostics = [
              ...(candidate.reloadMetadata?.diagnostics ?? []),
              ...(applied?.diagnostics ?? []),
              ...diagnostics,
            ]
            const restartWarnings = [
              ...(candidate.reloadMetadata?.restartWarnings ?? []),
              ...(applied?.restartWarnings ?? []),
            ]
            return {
              ok: true,
              ...(sessionId ? { sessionId } : {}),
              reloaded,
              ...(mergedDiagnostics.length > 0 ? { diagnostics: mergedDiagnostics } : {}),
              ...(restartWarnings.length
                ? { restartWarnings }
                : {}),
            }
          })
        },
      })
    },
  }
}

function params<T>(schema: z.ZodType<T>, request: FastifyRequest, reply: FastifyReply): T | undefined {
  const parsed = schema.safeParse(request.params)
  if (parsed.success) return parsed.data
  reply.code(400).send({
    error: {
      code: AgentGatewayErrorCode.AGENT_COMMAND_INVALID_STATE,
      message: parsed.error.issues[0]?.message ?? 'invalid params',
    },
  })
  return undefined
}

function body<T>(schema: z.ZodType<T>, request: FastifyRequest, reply: FastifyReply): T | undefined {
  const parsed = schema.safeParse(request.body)
  if (parsed.success) return parsed.data
  reply.code(400).send({
    error: {
      code: AgentGatewayErrorCode.AGENT_COMMAND_INVALID_STATE,
      message: parsed.error.issues[0]?.message ?? 'invalid body',
    },
  })
  return undefined
}

function statusFor(error: AgentGatewayError): number {
  if (error.code === AgentGatewayErrorCode.AGENT_SCOPE_DENIED) return 403
  if (
    error.code === AgentGatewayErrorCode.AGENT_TYPE_UNKNOWN
    || error.code === AgentGatewayErrorCode.AGENT_SESSION_NOT_FOUND
  ) return 404
  if (
    error.code === AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT
    || error.code === AgentGatewayErrorCode.AGENT_REQUEST_IN_PROGRESS
    || error.code === AgentGatewayErrorCode.AGENT_REQUEST_OUTCOME_UNKNOWN
    || error.code === AgentGatewayErrorCode.AGENT_RUNTIME_RESTART_REQUIRED
    || error.code === AgentGatewayErrorCode.AGENT_COMMAND_INVALID_STATE
    || error.code === AgentGatewayErrorCode.AGENT_SESSION_RUNTIME_SCOPE_MISMATCH
  ) return 409
  if (error.code === AgentGatewayErrorCode.AGENT_GATEWAY_CLOSED) return 503
  return 400
}

function sendError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof AgentGatewayError) {
    return reply.code(statusFor(error)).send({ error: error.toJSON() })
  }
  const stable = projectStableServiceError(error)
  if (stable) {
    return reply.code(stable.statusCode).send({ error: stable.error })
  }
  throw error
}

function meteringEnabled(metering: Pick<AgentMeteringSink, 'isEnabled'> | undefined): boolean {
  if (!metering) return false
  return metering.isEnabled ? metering.isEnabled() === true : true
}

/** Host-owned addressed routes that require a runtime binding/harness. */
export function createAgentHostRuntimeCapabilityRoutes(
  projection: AgentHostRuntimeCapabilityProjection,
): FastifyPluginAsync {
  return async (app) => {
    app.setErrorHandler((error, _request, reply) => sendError(reply, error))
    const cache = new WeakMap<FastifyRequest, Map<string, Promise<AgentHostRuntimeCapabilityBinding>>>()
    const resolve = (request: FastifyRequest, agentTypeId: string, sessionId?: string) => {
      let entries = cache.get(request)
      if (!entries) {
        entries = new Map()
        cache.set(request, entries)
      }
      const key = JSON.stringify([agentTypeId, sessionId ?? null])
      let value = entries.get(key)
      if (!value) {
        value = projection.resolveBinding({ request, agentTypeId, sessionId })
        entries.set(key, value)
      }
      return value
    }
    const agentId = (request: FastifyRequest) =>
      (request.params as { agentTypeId: string }).agentTypeId

    await app.register(modelsRoutes, {
      path: '/api/v1/agents/:agentTypeId/models',
      filterModels: projection.filterModels,
      authorizeRequest: async (request) => { await resolve(request, agentId(request)) },
    })
    await app.register(skillsRoutes, {
      path: '/api/v1/agents/:agentTypeId/skills',
      authorizeRequest: async (request) => { await resolve(request, agentId(request)) },
      getWorkspace: async (request) => (await resolve(request, agentId(request))).workspace,
      getAdditionalSkillPaths: async (request) => [
        ...((await resolve(request, agentId(request))).additionalSkillPaths ?? []),
        ...((await resolve(request, agentId(request))).pi?.additionalSkillPaths ?? []),
      ],
      getPiPackages: async (request) => (await resolve(request, agentId(request))).pi?.packages,
      getNoSkills: async (request) => (await resolve(request, agentId(request))).pi?.noSkills,
    })
    await app.register(catalogRoutes, {
      path: '/api/v1/agents/:agentTypeId/tools',
      authorizeRequest: async (request) => { await resolve(request, agentId(request)) },
      getTools: async (request) => [...(await resolve(request, agentId(request))).tools],
    })
    await app.register(systemPromptRoutes, {
      path: '/api/v1/agents/:agentTypeId/sessions/:sessionId/system-prompt',
      sessionIdParam: 'sessionId',
      authorizeRequest: async (request) => {
        const value = request.params as { agentTypeId: string; sessionId: string }
        await resolve(request, value.agentTypeId, value.sessionId)
      },
      getHarness: async (request) => {
        const value = request.params as { agentTypeId: string; sessionId: string }
        return (await resolve(request, value.agentTypeId, value.sessionId)).harness
      },
    })
    await app.register(sessionChangesRoutes, {
      path: '/api/v1/agents/:agentTypeId/sessions/:sessionId/changes',
      sessionIdParam: 'sessionId',
      tracker: projection.sessionChangesTracker,
      authorizeRequest: async (request) => {
        const value = request.params as { agentTypeId: string; sessionId: string }
        await resolve(request, value.agentTypeId, value.sessionId)
      },
      resolveScope: async (request, sessionId) => {
        const value = request.params as { agentTypeId: string }
        const binding = await resolve(request, value.agentTypeId, sessionId)
        return {
          workspaceScopeId: binding.runContext.workspaceId,
          agentTypeId: value.agentTypeId,
          sessionId,
        }
      },
    })
    await app.register(readyStatusRoutes, {
      path: '/api/v1/agents/:agentTypeId/ready-status',
      authorizeRequest: async (request) => { await resolve(request, agentId(request)) },
      getTracker: async (request) => (await resolve(request, agentId(request))).readyTracker,
      registerStreamClose: projection.registerSubscription,
    })

    app.get('/api/v1/agents/:agentTypeId/commands', async (request, reply) => {
      const value = params(AgentParams, request, reply)
      if (!value) return
      try {
        const query = request.query as { sessionId?: unknown }
        const sessionId = typeof query.sessionId === 'string' && query.sessionId.trim()
          ? query.sessionId.trim()
          : 'default'
        // Session-addressed discovery shares execution's pinned binding. The
        // sessionless form remains current-generation Host tooling only.
        const binding = await resolve(
          request,
          value.agentTypeId,
          typeof query.sessionId === 'string' && query.sessionId.trim() ? sessionId : undefined,
        )
        const commands = await binding.harness.getSlashCommands?.(sessionId, binding.runContext) ?? []
        return reply.code(200).send({ commands })
      } catch (error) {
        return sendError(reply, error)
      }
    })

    app.post('/api/v1/agents/:agentTypeId/commands/execute', async (request, reply) => {
      const rawAgentTypeId = (request.params as { agentTypeId?: unknown }).agentTypeId
      try {
        await projection.authorizeRequest({
          request,
          agentTypeId: typeof rawAgentTypeId === 'string' ? rawAgentTypeId : '',
        })
      } catch (error) {
        return sendError(reply, error)
      }
      const value = params(AgentParams, request, reply)
      if (!value) return
      const input = body(CommandBody, request, reply)
      if (!input) return
      if (meteringEnabled(projection.metering)) {
        return reply.code(409).send({
          error: {
            code: ErrorCode.enum.METERING_UNSUPPORTED_COMMAND,
            message: 'Slash command execution is disabled while metering is configured.',
            details: { command: input.name },
          },
        })
      }
      try {
        return reply.code(200).send(await projection.executeCommand({
          request,
          agentTypeId: value.agentTypeId,
          ...input,
        }))
      } catch (error) {
        return sendError(reply, error)
      }
    })

    app.post('/api/v1/agents/:agentTypeId/reload', async (request, reply) => {
      const value = params(AgentParams, request, reply)
      if (!value) return
      const input = body(ReloadBody, request, reply)
      if (!input) return
      try {
        return reply.code(200).send(await projection.reload({
          request,
          agentTypeId: value.agentTypeId,
          ...input,
        }))
      } catch (error) {
        return sendError(reply, error)
      }
    })
  }
}
