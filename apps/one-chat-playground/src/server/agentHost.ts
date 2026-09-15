import path from 'node:path'
import { fileURLToPath } from 'node:url'

import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'

import {
  createAgentHost,
  createSandboxRuntimeModeAdapter,
  registerAgentHostEnvironmentRoutes,
  type CreatedAgentHost,
  type RuntimeModeAdapter,
} from '@hachej/boring-agent/server'
import type {
  AgentGateway,
  AgentScopeVerifier,
  AuthorizedAgentScope,
} from '@hachej/boring-agent/shared'

import { resolveAllowedOriginsFromEnv } from '../shared/allowedOrigins.js'
import { bindToolGroups, loadOneChatAgentPackages, type OneChatSeat } from './agentPackages.js'
import { createAskUser, registerScopedAskUserRoutes, type OneChatAskUser } from './askUser.js'
import { compactAfterAgreement, createCompactCommandExtension } from './compaction.js'
import { createInstructionsLoader, type InstructionsLoader } from './instructionsFile.js'
import { createInstructionsTools } from './instructionsTool.js'
import { createMemoryTools } from './memoryTools.js'
import { createSessionTracker, trackSessions, type SessionTracker } from './reloadTools.js'
import {
  BUILDER_AGENT_TYPE_ID,
  DOCUMENTER_AGENT_TYPE_ID,
  createRunAgentTools,
} from './runAgentTools.js'
import { createStageBus, registerStageRoutes, type StageBus } from './stageBus.js'
import { createStageTools } from './stageTools.js'

export const ONE_CHAT_AGENT_TYPE_ID = 'default'
export const ONE_CHAT_WORKSPACE_SCOPE_ID = 'one-chat-playground'
export const ONE_CHAT_AUTH_SUBJECT_ID = 'trusted-local'
export const ONE_CHAT_SESSION_ID = 'one-chat'
export const ONE_CHAT_APP_HEADER = 'x-one-chat-app'
export const SKILLS_RELATIVE_DIR = path.join('.pi', 'skills')
export const ONE_CHAT_AGENTS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../agents')

export interface OneChatRuntimeApp {
  readonly slug: string
  readonly workspaceRoot: string
  readonly appBaseUrl: string
}

export interface OneChatRuntimeOptions {
  /** Legacy single-app seam. It is exposed as the default app. */
  readonly workspaceRoot?: string
  /** Multi-app seam. The request header selects one of these host-owned roots. */
  readonly resolveApp?: (slug: string) => OneChatRuntimeApp | undefined
  readonly defaultAppSlug?: string
  readonly sessionRoot?: string
  readonly askUserStatePath?: string
  readonly agentsRoot?: string
  readonly appBaseUrl?: string
  readonly allowedOrigins?: readonly string[]
  readonly runtimeModeAdapter?: RuntimeModeAdapter
  readonly logger?: boolean
}

export interface OneChatRuntime {
  readonly app: FastifyInstance
  readonly created: CreatedAgentHost
  readonly gateway: AgentGateway
  scopeForApp(slug: string): AuthorizedAgentScope
  stageForApp(slug: string): StageBus
  close(): Promise<void>
}

interface AppRuntimeResources {
  readonly app: OneChatRuntimeApp
  readonly scope: AuthorizedAgentScope
  readonly stage: StageBus
  readonly askUser: OneChatAskUser
  readonly instructions: InstructionsLoader
  readonly sessions: SessionTracker
  readonly boundBySeat: Record<OneChatSeat, ReturnType<typeof bindToolGroups>>
}

function scopeIdForApp(slug: string, defaultSlug: string): string {
  return slug === defaultSlug ? ONE_CHAT_WORKSPACE_SCOPE_ID : `${ONE_CHAT_WORKSPACE_SCOPE_ID}:${slug}`
}

function requestAppSlug(request: FastifyRequest, fallback: string): string {
  const header = request.headers[ONE_CHAT_APP_HEADER]
  if (typeof header === 'string' && header.trim()) return header.trim()
  const query = request.query
  if (query && typeof query === 'object' && 'app' in query && typeof (query as { app?: unknown }).app === 'string') {
    const slug = (query as { app: string }).app.trim()
    if (slug) return slug
  }
  return fallback
}

async function closeRuntime(created: CreatedAgentHost, app: FastifyInstance, onClose?: () => void): Promise<void> {
  let firstError: unknown
  onClose?.()
  for (const operation of [() => app.close(), () => created.host.close()]) {
    try {
      await operation()
    } catch (error) {
      firstError ??= error
    }
  }
  if (firstError !== undefined) throw firstError
}

/**
 * One Agent Host, many request-scoped app bindings. The public host header is
 * converted to an AuthorizedAgentScope, and the existing Agent Host resolver
 * then binds workspace, tools, prompt watchers and session namespace from that
 * verified scope. This keeps one gateway/protocol while isolating every app.
 */
export async function createOneChatRuntime(options: OneChatRuntimeOptions): Promise<OneChatRuntime> {
  const defaultSlug = options.defaultAppSlug ?? 'default'
  const legacyRoot = options.workspaceRoot ? path.resolve(options.workspaceRoot) : undefined
  const resolveConfiguredApp = options.resolveApp ?? ((slug: string) => {
    if (!legacyRoot || slug !== defaultSlug) return undefined
    return {
      slug,
      workspaceRoot: legacyRoot,
      appBaseUrl: options.appBaseUrl ?? 'http://127.0.0.1:5321/',
    }
  })
  if (!options.resolveApp && !legacyRoot) throw new TypeError('createOneChatRuntime requires workspaceRoot or resolveApp')

  const agentPackages = await loadOneChatAgentPackages(options.agentsRoot ?? ONE_CHAT_AGENTS_ROOT)
  const modeAdapter = options.runtimeModeAdapter ?? createSandboxRuntimeModeAdapter('direct')
  const allowedOrigins = options.allowedOrigins ?? resolveAllowedOriginsFromEnv()
  const scopes = new Map<string, AuthorizedAgentScope>()
  const resources = new Map<string, AppRuntimeResources>()
  let hostApp: FastifyInstance | undefined
  let createdHost: CreatedAgentHost | undefined

  const appDescriptor = (slug: string): OneChatRuntimeApp => {
    const resolved = resolveConfiguredApp(slug)
    if (!resolved || resolved.slug !== slug) throw new Error(`Unknown one-chat app: ${slug}`)
    return { ...resolved, workspaceRoot: path.resolve(resolved.workspaceRoot) }
  }

  const scopeForApp = (slug: string): AuthorizedAgentScope => {
    appDescriptor(slug)
    let scope = scopes.get(slug)
    if (!scope) {
      scope = Object.freeze({
        workspaceScopeId: scopeIdForApp(slug, defaultSlug),
        authSubjectId: ONE_CHAT_AUTH_SUBJECT_ID,
      }) as AuthorizedAgentScope
      scopes.set(slug, scope)
    }
    return scope
  }

  const slugForScope = (scope: AuthorizedAgentScope): string => {
    for (const [slug, candidate] of scopes) {
      if (candidate === scope) return slug
    }
    throw new Error('one-chat-playground scope denied')
  }

  const verifier: AgentScopeVerifier = {
    async verify(candidate) {
      const slug = slugForScope(candidate)
      appDescriptor(slug)
      return {
        workspaceScopeId: candidate.workspaceScopeId,
        authSubjectId: candidate.authSubjectId,
      }
    },
  }

  const resourcesForApp = (slug: string): AppRuntimeResources => {
    const existing = resources.get(slug)
    if (existing) return existing
    const app = appDescriptor(slug)
    const scope = scopeForApp(slug)
    const workspaceRoot = app.workspaceRoot
    const stage = createStageBus()
    const sessions = createSessionTracker()
    const instructions = createInstructionsLoader({ workspaceRoot, basePrompt: undefined })
    const requestHeaders = { [ONE_CHAT_APP_HEADER]: slug }
    const log = (message: string) => hostApp?.log.info(`[${slug}] ${message}`)
    const colleagueUsesCompact = agentPackages.colleague.tools.includes('compact')
    const memoryTools = createMemoryTools({
      workspaceRoot,
      ...(colleagueUsesCompact
        ? {
            onAgreement(intentSlug: string, sessionId: string | undefined) {
              sessions.remember(sessionId)
              setTimeout(() => {
                if (!hostApp || !createdHost) return
                void compactAfterAgreement({
                  app: hostApp,
                  gateway: createdHost.gateway,
                  scope,
                  sessions,
                  slug: intentSlug,
                  requestHeaders,
                  log,
                }).catch((error) => log(`compaction failed for ${intentSlug}: ${String(error)}`))
              }, 0)
            },
          }
        : {}),
    })
    const askUserStatePath = options.askUserStatePath && slug === defaultSlug
      ? options.askUserStatePath
      : path.join(options.sessionRoot ?? path.join(workspaceRoot, '.boring-agent'), slug, 'ask-user.json')
    const askUser = createAskUser({
      statePath: askUserStatePath,
      agentTypeId: ONE_CHAT_AGENT_TYPE_ID,
      defaultSessionId: ONE_CHAT_SESSION_ID,
    })
    void askUser.abandonStale().catch((error) => log(`stale question cleanup failed: ${String(error)}`))
    const runAgentTools = createRunAgentTools({
      workspaceRoot,
      scope,
      getGateway: () => createdHost?.gateway,
      sessions,
      activityBus: stage,
      appBaseUrl: app.appBaseUrl,
      log,
    })
    const availableToolGroups = {
      intents: memoryTools,
      instructions: createInstructionsTools({ workspaceRoot }),
      stage: createStageTools({ bus: stage, allowedOrigins, appBaseUrl: app.appBaseUrl }),
      ask_user: [askUser.tool],
      run_agents: runAgentTools,
    } as const
    const boundBySeat = Object.fromEntries(
      (Object.keys(agentPackages) as OneChatSeat[]).map((seat) => [
        seat,
        bindToolGroups(agentPackages[seat].tools, availableToolGroups),
      ]),
    ) as AppRuntimeResources['boundBySeat']
    const createdResources = {
      app,
      scope,
      stage,
      askUser,
      instructions,
      sessions,
      boundBySeat,
    }
    resources.set(slug, createdResources)
    return createdResources
  }

  const authorizeAgentRequest = async (request: FastifyRequest) => {
    const slug = requestAppSlug(request, defaultSlug)
    return scopeForApp(slug)
  }

  const app = Fastify({ logger: options.logger ?? true, bodyLimit: 16 * 1024 * 1024 })
  hostApp = app
  const startedAt = Date.now()
  const created = await createAgentHost({
    agents: [
      { agentTypeId: ONE_CHAT_AGENT_TYPE_ID, definition: agentPackages.colleague },
      { agentTypeId: BUILDER_AGENT_TYPE_ID, definition: agentPackages.builder },
      { agentTypeId: DOCUMENTER_AGENT_TYPE_ID, definition: agentPackages.documenter },
    ].map(({ agentTypeId, definition }) => ({
      agentTypeId,
      definition: {
        instructions: definition.instructions,
        label: definition.label,
        version: definition.version,
        ...(definition.definitionDigest ? { digest: definition.definitionDigest } : {}),
      },
    })),
    fleetCompiler: { async compile({ agents }) { return agents } },
    hostId: 'one-chat-playground',
    scopeVerifier: verifier,
    runtimeModeAdapter: modeAdapter,
    runtimeHost: modeAdapter.runtimeHost,
    sessionRoot: options.sessionRoot,
    ...(!options.sessionRoot ? { inMemoryRequestLedgerMode: 'development' as const } : {}),
    async resolveAuthorizedEnvironmentScope({ authorizedScope }) {
      const selected = resourcesForApp(slugForScope(authorizedScope))
      return {
        placementIdentity: JSON.stringify([modeAdapter.id, selected.app.workspaceRoot]),
        workspaceRoot: selected.app.workspaceRoot,
        provisioningFingerprint: JSON.stringify([modeAdapter.id, selected.app.workspaceRoot]),
      }
    },
    async resolveAuthorizedAgentRuntimeScope({ authorizedScope, agentTypeId }) {
      const selected = resourcesForApp(slugForScope(authorizedScope))
      const isColleague = agentTypeId === ONE_CHAT_AGENT_TYPE_ID
      const seat: OneChatSeat = isColleague
        ? 'colleague'
        : agentTypeId === BUILDER_AGENT_TYPE_ID
          ? 'builder'
          : 'documenter'
      const agentPackage = agentPackages[seat]
      const bound = selected.boundBySeat[seat]
      const identity = [
        'one-chat-playground',
        selected.app.slug,
        agentTypeId,
        agentPackage.definitionDigest,
        agentPackage.tools,
        modeAdapter.id,
        selected.app.workspaceRoot,
      ]
      return {
        identity: JSON.stringify(identity),
        physicalBindingIdentity: JSON.stringify([agentTypeId, modeAdapter.id, selected.app.workspaceRoot]),
        resourceInputDigest: JSON.stringify(identity),
        sessionNamespace: selected.app.slug === defaultSlug
          ? `one-chat-playground-${agentTypeId}`
          : `one-chat-playground-${selected.app.slug}-${agentTypeId}`,
        pi: {
          // Direct mode is trusted-host execution. Never discover executable
          // code authored in an app workspace in this process.
          noExtensions: true,
          additionalSkillPaths: isColleague
            ? [
                path.join(agentPackage.packageRoot, 'skills'),
                path.join(selected.app.workspaceRoot, SKILLS_RELATIVE_DIR),
                path.join(selected.app.workspaceRoot, 'skills'),
              ]
            : seat === 'builder'
              ? [path.join(agentPackage.packageRoot, 'skills')]
              : [],
          ...(bound.compact ? { extensionFactories: [createCompactCommandExtension((message) => hostApp?.log.info(`[${selected.app.slug}] ${message}`))] } : {}),
        },
        ...(bound.tools.length
          ? { extraTools: isColleague ? trackSessions(bound.tools, selected.sessions) : [...bound.tools] }
          : {}),
        ...(isColleague ? { loadSystemPromptAppend: () => selected.instructions.load() } : {}),
      }
    },
  })
  createdHost = created

  try {
    app.get('/health', async () => ({ status: 'ok', uptime: Math.floor((Date.now() - startedAt) / 1000) }))
    app.get('/ready', async () => ({ status: 'ready' }))
    registerStageRoutes(app, async (request) => resourcesForApp(requestAppSlug(request, defaultSlug)).stage)
    registerScopedAskUserRoutes(app, async (request) => resourcesForApp(requestAppSlug(request, defaultSlug)).askUser)
    await registerAgentHostEnvironmentRoutes(app, {
      created,
      authorizeAgentRequest,
      runtimeHost: modeAdapter.runtimeHost,
    })
    await app.register(created.registerDirectRoutes({
      authorizeAgentRequest,
      defaultSessionId: ONE_CHAT_SESSION_ID,
    }))
  } catch (error) {
    await closeRuntime(created, app, () => {
      for (const selected of resources.values()) selected.instructions.close()
    }).catch(() => {})
    throw error
  }

  let closePromise: Promise<void> | undefined
  return {
    app,
    created,
    gateway: created.gateway,
    scopeForApp,
    stageForApp: (slug) => resourcesForApp(slug).stage,
    close() {
      closePromise ??= closeRuntime(created, app, () => {
        for (const selected of resources.values()) selected.instructions.close()
      })
      return closePromise
    },
  }
}
