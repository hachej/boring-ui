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
import type { AgentSkillResourceSnapshot } from '../http/routes/skills'
import { systemPromptRoutes } from '../http/routes/systemPrompt'
import type { SessionChangesTracker } from '../http/sessionChangesTracker'
import type { AgentMeteringSink } from '../pi-chat/metering'
import type { ReadyStatusTracker } from '../runtime/readyStatus'
import { canonicalDigest } from './canonical'
import type { AgentHostRuntime, RuntimeBinding } from './createAgentHost'
import type { EmbeddedAgentGateway } from './embeddedGateway'
import type { AgentHostDirectProjectionOptions, AgentInstructionFileRef } from './types'
import { projectStableServiceError } from './stableServiceError'
import {
  resolveAgentMcpGrants,
  type McpConnectorCatalog,
  type McpGrantDiagnostic,
  type ResolvedMcpConnectorGrant,
} from './mcpGrants'
import type { McpGrantStore } from './mcpGrantStore'

/**
 * Optional per-agent MCP grant resolution, wired into the capability
 * projection so `mcpServerRefs` resolve through this seam and no parallel
 * authorization path. Omitting this entirely preserves prior behavior
 * (no MCP connectors surfaced through this binding).
 */
export interface AgentHostRuntimeCapabilityMcpGrantsOptions {
  readonly store: McpGrantStore
  readonly catalog?: McpConnectorCatalog
  /** The Agent definition's declared `mcpServerRefs` for a given agentTypeId, treated as connector ids. */
  getMcpServerRefs(agentTypeId: string): readonly string[] | undefined
}

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
  /**
   * Skill-resource locator/catalog snapshot for the current reload
   * generation, sourced from `ResolvedAgentRuntimeScope.getSkillResourceSnapshot`.
   * Carries package-managed skill locators through the capability-projection
   * path (Option A) rather than through the legacy path-shaped
   * `additionalSkillPaths` hot-reload API, which #970 retires.
   */
  readonly skillResourceSnapshot?: AgentSkillResourceSnapshot
  readonly runContext: RunContext
  /**
   * Connectors/tools this Agent is actually granted, resolved through
   * per-agent MCP grants (gh-1087). Undefined when no grant seam is
   * configured on this projection; empty array is default-deny (declared
   * refs exist but nothing was granted).
   */
  readonly mcpGrants?: readonly ResolvedMcpConnectorGrant[]
  /** Stable-coded diagnostics for any declared `mcpServerRefs` entry that was dropped during resolution. */
  readonly mcpGrantDiagnostics?: readonly McpGrantDiagnostic[]
}

/**
 * User-facing "what can this agent do?" description. Authorized at the same
 * per-agent bar as every sibling route, but served without materializing a
 * runtime binding: everything here comes from the compiled fleet spec plus
 * the MCP grant seam.
 *
 * Deliberately NARROW: only what needs the compiled spec or the grant seam.
 * Identity (`label`) and `pluginIds` already come from the fleet list route,
 * and duplicating them here forced the client to reconcile two shapes for the
 * same fact.
 *
 * The composed `systemPrompt` used to ship here too. Its ONLY consumer was the
 * Agent details "System prompt" section, which the owner removed as unhelpful:
 * a wall of composed text nobody could act on. Serving a whole agent's
 * instructions to every details open with no reader left is pure payload, so
 * the field went with the section. `instructionFiles` is what survives — the
 * authored sources, which the operator can actually open and edit.
 */
export interface AgentHostAgentDescription {
  readonly agentTypeId: string
  /** Exact package declaration and computed identity for configured Agents. */
  readonly definition?: { readonly version: string; readonly digest: string }
  /** Preferred model id from the agent definition, when pinned. */
  readonly model: string | null
  /**
   * Authored instruction sources behind this agent's instructions. The Host is the only
   * component that knows these locations (seat and agentTypeId are unrelated
   * fleet.yaml fields), so clients render what they are given rather than
   * guessing a persona directory.
   */
  readonly instructionFiles: readonly AgentInstructionFileRef[]
  /** MCP connectors this agent is actually granted (default-deny). */
  readonly mcpServers: readonly { readonly id: string; readonly tools: readonly string[] }[]
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
  describeAgent(input: {
    readonly request: FastifyRequest
    readonly agentTypeId: string
  }): Promise<AgentHostAgentDescription>
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
  readonly mcpGrants?: AgentHostRuntimeCapabilityMcpGrantsOptions
}): AgentHostRuntimeCapabilityProjection {
  const { runtime, gateway, options, mcpGrants } = input
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
  /**
   * The per-agent authorization decision, shared by every per-agent route.
   * `runtime.resolveAgentRuntimeScope` invokes the host's
   * `resolveAuthorizedAgentRuntimeScope` hook, which is the ONLY seam where a
   * host can deny THIS subject access to THIS agentTypeId — workspace-scope
   * authorization alone does not answer that question. Read-only projections
   * stop here; routes that actually drive the harness continue into
   * `resolveBinding`.
   */
  const authorizeAgentAccess = async (request: FastifyRequest, agentTypeId: string) => {
    const { scope, claim } = await authorize(request)
    const resolved = await runtime.resolveAgentRuntimeScope(
      agentTypeId,
      scope,
      claim,
      'new-binding',
      request.id,
    )
    return { scope, claim, resolved }
  }
  const resolve = async (request: FastifyRequest, agentTypeId: string, sessionId?: string) => {
    if (sessionId) {
      const { scope } = await authorize(request)
      const pinned = await gateway.resolveHostSessionBinding(scope, { agentTypeId, sessionId })
      return { scope, claim: pinned.claim, binding: pinned.binding }
    }
    const { scope, claim, resolved } = await authorizeAgentAccess(request, agentTypeId)
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
      // Start the (host-implemented, effectively synchronous) skill-resource
      // read and immediately read hot-reloadable pi resources in the same
      // synchronous tick — no `await` sits between the two calls, so a
      // concurrent reload cannot swap the host's registry generation in
      // between them (Option A: one immutable snapshot per read). Awaiting
      // afterwards only unwraps a promise that has already settled.
      const skillResourceSnapshotPromise = binding.scope.getSkillResourceSnapshot?.({
        scope: claim,
        sessionId,
        requestId: request.id,
      })
      const hotResources = binding.scope.pi?.getHotReloadableResources?.()
      const skillResourceSnapshot = await skillResourceSnapshotPromise
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
      let resolvedMcpGrants: readonly ResolvedMcpConnectorGrant[] | undefined
      let mcpGrantDiagnostics: readonly McpGrantDiagnostic[] | undefined
      if (mcpGrants) {
        const refs = mcpGrants.getMcpServerRefs(agentTypeId) ?? []
        const listed = refs.length > 0
          ? await mcpGrants.store.listGrants(claim.workspaceScopeId)
          : { grants: [], diagnostics: [] }
        const resolved = resolveAgentMcpGrants({
          workspaceId: claim.workspaceScopeId,
          agentTypeId,
          mcpServerRefs: refs,
          grants: listed.grants,
          catalog: mcpGrants.catalog,
        })
        resolvedMcpGrants = resolved.connectors
        mcpGrantDiagnostics = [...listed.diagnostics, ...resolved.diagnostics]
      }
      return {
        harness: binding.composition.harness,
        tools: binding.composition.tools,
        mcpGrants: resolvedMcpGrants,
        mcpGrantDiagnostics,
        workspace: binding.composition.runtimeBundle.workspace,
        readyTracker: binding.composition.readyTracker,
        pi,
        additionalSkillPaths: binding.environmentLease.provisioning?.skillPaths,
        skillResourceSnapshot,
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
    async describeAgent({ request, agentTypeId }) {
      // Authorize BEFORE looking the agent up, matching `resolve()` and every
      // sibling route. Checking existence first turns an unauthorized request
      // into an agent-existence oracle: unknown vs denied are distinguishable
      // without any right to ask.
      const { claim } = await authorizeAgentAccess(request, agentTypeId)
      const spec = runtime.compiledById.get(agentTypeId)
      if (!spec) {
        throw new AgentGatewayError(AgentGatewayErrorCode.AGENT_TYPE_UNKNOWN, 'agent type is not available')
      }
      const legacy = 'legacyDefault' in spec
      let mcpServers: AgentHostAgentDescription['mcpServers'] = []
      if (mcpGrants) {
        const refs = mcpGrants.getMcpServerRefs(agentTypeId) ?? []
        if (refs.length > 0) {
          const listed = await mcpGrants.store.listGrants(claim.workspaceScopeId)
          const resolved = resolveAgentMcpGrants({
            workspaceId: claim.workspaceScopeId,
            agentTypeId,
            mcpServerRefs: refs,
            grants: listed.grants,
            catalog: mcpGrants.catalog,
          })
          mcpServers = resolved.connectors.map((connector) => ({
            id: connector.connectorId,
            tools: connector.allowedTools,
          }))
        }
      }
      return {
        agentTypeId,
        ...(!legacy && spec.definition.version && spec.definition.digest
          ? { definition: { version: spec.definition.version, digest: spec.definition.digest } }
          : {}),
        model: legacy ? null : spec.model?.preferred ?? null,
        instructionFiles: legacy ? [] : spec.instructionFiles ?? [],
        mcpServers,
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
      getSkillResourceSnapshot: async (request) => (await resolve(request, agentId(request))).skillResourceSnapshot,
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

    app.get('/api/v1/agents/:agentTypeId/describe', async (request, reply) => {
      const value = params(AgentParams, request, reply)
      if (!value) return
      try {
        return reply.code(200).send(await projection.describeAgent({
          request,
          agentTypeId: value.agentTypeId,
        }))
      } catch (error) {
        return sendError(reply, error)
      }
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
