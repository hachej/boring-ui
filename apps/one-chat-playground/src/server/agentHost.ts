import { readFile } from 'node:fs/promises'
import path from 'node:path'

import Fastify, { type FastifyInstance } from 'fastify'

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
import { createAskUser } from './askUser.js'
import { compactAfterAgreement, createCompactCommandExtension } from './compaction.js'
import { createInstructionsLoader } from './instructionsFile.js'
import { createInstructionsTools } from './instructionsTool.js'
import { createMemoryTools } from './memoryTools.js'
import { createReloadTool, createSessionTracker, trackSessions, watchExtensions } from './reloadTools.js'
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
/** Pinned: one chat, one session, for the life of the app. */
export const ONE_CHAT_SESSION_ID = 'one-chat'
/** Skills that ship with the user's app, vendored into the workspace. */
export const SKILLS_RELATIVE_DIR = path.join('.pi', 'skills')

export interface OneChatRuntimeOptions {
  /** The user's app. The agent's read/write/edit/bash all act here. */
  readonly workspaceRoot: string
  readonly sessionRoot?: string
  /** Where the pending-question record lives. Defaults under the session root. */
  readonly askUserStatePath?: string
  /** Absolute path to the plain-language system prompt appended for the colleague. */
  readonly systemPromptPath?: string
  /** Absolute paths to the isolated builder and documenter prompts. */
  readonly builderPromptPath?: string
  readonly documenterPromptPath?: string
  readonly allowedOrigins?: readonly string[]
  readonly runtimeModeAdapter?: RuntimeModeAdapter
  readonly logger?: boolean
}

export interface OneChatRuntime {
  readonly app: FastifyInstance
  readonly created: CreatedAgentHost
  readonly gateway: AgentGateway
  readonly scope: AuthorizedAgentScope
  readonly stage: StageBus
  close(): Promise<void>
}

function createTrustedLocalScope(): { scope: AuthorizedAgentScope; verifier: AgentScopeVerifier } {
  const scope = Object.freeze({
    workspaceScopeId: ONE_CHAT_WORKSPACE_SCOPE_ID,
    authSubjectId: ONE_CHAT_AUTH_SUBJECT_ID,
  }) as AuthorizedAgentScope

  return {
    scope,
    verifier: {
      async verify(candidate) {
        if (candidate !== scope) throw new Error('one-chat-playground scope denied')
        return {
          workspaceScopeId: ONE_CHAT_WORKSPACE_SCOPE_ID,
          authSubjectId: ONE_CHAT_AUTH_SUBJECT_ID,
        }
      },
    },
  }
}

async function readSystemPrompt(promptPath: string | undefined): Promise<string | undefined> {
  if (!promptPath) return undefined
  const body = (await readFile(promptPath, 'utf8')).trim()
  return body || undefined
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
 * The agent half of "One Chat, One Screen": the same one-host/one-scope shape as
 * apps/agent-playground, plus the two stage tools and the plain-language prompt.
 */
export async function createOneChatRuntime(options: OneChatRuntimeOptions): Promise<OneChatRuntime> {
  const workspaceRoot = path.resolve(options.workspaceRoot)
  const modeAdapter = options.runtimeModeAdapter ?? createSandboxRuntimeModeAdapter('direct')
  const { scope, verifier } = createTrustedLocalScope()
  const stage = createStageBus()
  const allowedOrigins = options.allowedOrigins ?? resolveAllowedOriginsFromEnv()
  const stageTools = createStageTools({ bus: stage, allowedOrigins })
  const instructionsTools = createInstructionsTools({ workspaceRoot })
  const askUser = createAskUser({
    statePath: options.askUserStatePath
      ?? path.join(options.sessionRoot ?? path.join(workspaceRoot, '.boring-agent'), 'ask-user.json'),
    agentTypeId: ONE_CHAT_AGENT_TYPE_ID,
    defaultSessionId: ONE_CHAT_SESSION_ID,
  })
  let hostApp: FastifyInstance | undefined
  let createdHost: CreatedAgentHost | undefined
  const sessions = createSessionTracker()
  const log = (message: string) => hostApp?.log.info(message)
  const reloadOptions = {
    agentTypeId: ONE_CHAT_AGENT_TYPE_ID,
    getApp: () => hostApp,
    sessions,
    log,
  }
  const reloadTool = createReloadTool(reloadOptions)
  const [basePrompt, builderPrompt, documenterPrompt] = await Promise.all([
    readSystemPrompt(options.systemPromptPath),
    readSystemPrompt(options.builderPromptPath),
    readSystemPrompt(options.documenterPromptPath),
  ])
  const instructions = createInstructionsLoader({ workspaceRoot, basePrompt })
  const memoryTools = createMemoryTools({
    workspaceRoot,
    onAgreement(slug, sessionId) {
      sessions.remember(sessionId)
      setTimeout(() => {
        if (!hostApp || !createdHost) return
        void compactAfterAgreement({
          app: hostApp,
          gateway: createdHost.gateway,
          scope,
          sessions,
          slug,
          log,
        }).catch((error) => log(`compaction failed for ${slug}: ${String(error)}`))
      }, 0)
    },
  })
  const runAgentTools = createRunAgentTools({
    workspaceRoot,
    scope,
    getGateway: () => createdHost?.gateway,
    sessions,
    log,
  })

  const app = Fastify({ logger: options.logger ?? true, bodyLimit: 16 * 1024 * 1024 })
  hostApp = app
  const stopWatchingExtensions = watchExtensions({ ...reloadOptions, workspaceRoot })
  const startedAt = Date.now()
  const created = await createAgentHost({
    agents: [
      {
        agentTypeId: ONE_CHAT_AGENT_TYPE_ID,
        definition: {
          instructions: "You are the assistant built into the user's app.",
          label: 'App assistant',
          version: '1',
        },
      },
      {
        agentTypeId: BUILDER_AGENT_TYPE_ID,
        definition: {
          instructions: 'You build one agreed app intent in a fresh session.',
          label: 'Builder',
          version: '1',
        },
      },
      {
        agentTypeId: DOCUMENTER_AGENT_TYPE_ID,
        definition: {
          instructions: 'You record one completed app intent in a fresh session.',
          label: 'Documenter',
          version: '1',
        },
      },
    ],
    fleetCompiler: { async compile({ agents }) { return agents } },
    hostId: 'one-chat-playground',
    scopeVerifier: verifier,
    runtimeModeAdapter: modeAdapter,
    runtimeHost: modeAdapter.runtimeHost,
    sessionRoot: options.sessionRoot,
    ...(!options.sessionRoot ? { inMemoryRequestLedgerMode: 'development' as const } : {}),
    async resolveAuthorizedEnvironmentScope() {
      return {
        placementIdentity: JSON.stringify([modeAdapter.id, workspaceRoot]),
        workspaceRoot,
        provisioningFingerprint: JSON.stringify([modeAdapter.id, workspaceRoot]),
      }
    },
    async resolveAuthorizedAgentRuntimeScope({ agentTypeId }) {
      const isColleague = agentTypeId === ONE_CHAT_AGENT_TYPE_ID
      const prompt = agentTypeId === BUILDER_AGENT_TYPE_ID
        ? builderPrompt
        : agentTypeId === DOCUMENTER_AGENT_TYPE_ID
          ? documenterPrompt
          : undefined
      return {
        identity: JSON.stringify(['one-chat-playground', agentTypeId, modeAdapter.id, workspaceRoot]),
        physicalBindingIdentity: JSON.stringify([agentTypeId, modeAdapter.id, workspaceRoot]),
        resourceInputDigest: JSON.stringify(['one-chat-playground', agentTypeId, modeAdapter.id, workspaceRoot]),
        sessionNamespace: `one-chat-playground:${agentTypeId}`,
        // Every seat gets only the skills shipped in the user's app. The two
        // paths cover the tiny sample app and the standard template app.
        pi: {
          additionalSkillPaths: [
            path.join(workspaceRoot, SKILLS_RELATIVE_DIR),
            path.join(workspaceRoot, 'skills'),
          ],
          ...(isColleague ? { extensionFactories: [createCompactCommandExtension] } : {}),
        },
        ...(isColleague
          ? {
              extraTools: trackSessions([
                ...stageTools,
                ...instructionsTools,
                ...memoryTools,
                ...runAgentTools,
                askUser.tool,
                reloadTool,
              ], sessions),
              loadSystemPromptAppend: () => instructions.load(),
            }
          : { systemPromptAppend: prompt }),
      }
    },
  })
  createdHost = created

  try {
    app.get('/health', async () => ({
      status: 'ok',
      uptime: Math.floor((Date.now() - startedAt) / 1000),
    }))
    app.get('/ready', async () => ({ status: 'ready' }))
    registerStageRoutes(app, stage)
    await askUser.registerRoutes(app)
    await registerAgentHostEnvironmentRoutes(app, {
      created,
      authorizeAgentRequest: async () => scope,
      runtimeHost: modeAdapter.runtimeHost,
      getWorkspaceHostRoot: modeAdapter.workspaceFsCapability === 'strong'
        ? async () => workspaceRoot
        : undefined,
    })
    await app.register(created.registerDirectRoutes({
      authorizeAgentRequest: async () => scope,
      defaultSessionId: ONE_CHAT_SESSION_ID,
    }))
  } catch (error) {
    await closeRuntime(created, app, () => { instructions.close(); stopWatchingExtensions() }).catch(() => {})
    throw error
  }

  let closePromise: Promise<void> | undefined
  return {
    app,
    created,
    gateway: created.gateway,
    scope,
    stage,
    close() {
      closePromise ??= closeRuntime(created, app, () => { instructions.close(); stopWatchingExtensions() })
      return closePromise
    },
  }
}
