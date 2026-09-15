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
import { createStageBus, registerStageRoutes, type StageBus } from './stageBus.js'
import { createStageTools } from './stageTools.js'

export const ONE_CHAT_AGENT_TYPE_ID = 'default'
export const ONE_CHAT_WORKSPACE_SCOPE_ID = 'one-chat-playground'
export const ONE_CHAT_AUTH_SUBJECT_ID = 'trusted-local'
/** Pinned: one chat, one session, for the life of the app. */
export const ONE_CHAT_SESSION_ID = 'one-chat'

export interface OneChatRuntimeOptions {
  /** The user's app. The agent's read/write/edit/bash all act here. */
  readonly workspaceRoot: string
  readonly sessionRoot?: string
  /** Absolute path to the plain-language system prompt appended for this agent. */
  readonly systemPromptPath?: string
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

async function closeRuntime(created: CreatedAgentHost, app: FastifyInstance): Promise<void> {
  let firstError: unknown
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
  const systemPromptAppend = await readSystemPrompt(options.systemPromptPath)

  const app = Fastify({ logger: options.logger ?? true, bodyLimit: 16 * 1024 * 1024 })
  const startedAt = Date.now()
  const created = await createAgentHost({
    agents: [{
      agentTypeId: ONE_CHAT_AGENT_TYPE_ID,
      definition: {
        instructions: "You are the assistant built into the user's app.",
        label: 'App assistant',
        version: '1',
      },
    }],
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
    async resolveAuthorizedAgentRuntimeScope() {
      return {
        identity: JSON.stringify(['one-chat-playground', modeAdapter.id, workspaceRoot]),
        physicalBindingIdentity: JSON.stringify([modeAdapter.id, workspaceRoot]),
        resourceInputDigest: JSON.stringify(['one-chat-playground', modeAdapter.id, workspaceRoot]),
        sessionNamespace: 'one-chat-playground',
        extraTools: stageTools,
        ...(systemPromptAppend ? { systemPromptAppend } : {}),
      }
    },
  })

  try {
    app.get('/health', async () => ({
      status: 'ok',
      uptime: Math.floor((Date.now() - startedAt) / 1000),
    }))
    app.get('/ready', async () => ({ status: 'ready' }))
    registerStageRoutes(app, stage)
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
    await closeRuntime(created, app).catch(() => {})
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
      closePromise ??= closeRuntime(created, app)
      return closePromise
    },
  }
}
