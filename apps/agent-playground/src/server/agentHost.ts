import Fastify, { type FastifyInstance } from 'fastify'

import {
  createAgentHost,
  createSandboxRuntimeModeAdapter,
  registerAgentHostEnvironmentRoutes,
  type AgentHarnessFactory,
  type CreatedAgentHost,
  type RuntimeModeAdapter,
} from '@hachej/boring-agent/server'
import type {
  AgentGateway,
  AgentScopeVerifier,
  AuthorizedAgentScope,
} from '@hachej/boring-agent/shared'

export const PLAYGROUND_AGENT_TYPE_ID = 'default'
export const PLAYGROUND_WORKSPACE_SCOPE_ID = 'agent-playground'
export const PLAYGROUND_AUTH_SUBJECT_ID = 'trusted-local'

export interface AgentPlaygroundRuntimeOptions {
  readonly workspaceRoot?: string
  readonly sessionRoot?: string
  readonly runtimeModeAdapter?: RuntimeModeAdapter
  readonly harnessFactory?: AgentHarnessFactory
  readonly logger?: boolean
}

export interface AgentPlaygroundRuntime {
  readonly app: FastifyInstance
  readonly created: CreatedAgentHost
  readonly gateway: AgentGateway
  readonly scope: AuthorizedAgentScope
  close(): Promise<void>
}

function createTrustedLocalScope(): {
  readonly scope: AuthorizedAgentScope
  readonly verifier: AgentScopeVerifier
} {
  const scope = Object.freeze({
    workspaceScopeId: PLAYGROUND_WORKSPACE_SCOPE_ID,
    authSubjectId: PLAYGROUND_AUTH_SUBJECT_ID,
  }) as AuthorizedAgentScope

  return {
    scope,
    verifier: {
      async verify(candidate) {
        if (candidate !== scope) throw new Error('agent-playground scope denied')
        return {
          workspaceScopeId: PLAYGROUND_WORKSPACE_SCOPE_ID,
          authSubjectId: PLAYGROUND_AUTH_SUBJECT_ID,
        }
      },
    },
  }
}

async function closeRuntime(created: CreatedAgentHost, app: FastifyInstance): Promise<void> {
  let firstError: unknown
  for (const operation of [
    () => app.close(),
    () => created.host.close(),
  ]) {
    try {
      await operation()
    } catch (error) {
      firstError ??= error
    }
  }
  if (firstError !== undefined) throw firstError
}

/** Small reference composition: one Host, one fixed local capability, one Gateway. */
export async function createAgentPlaygroundRuntime(
  options: AgentPlaygroundRuntimeOptions = {},
): Promise<AgentPlaygroundRuntime> {
  const workspaceRoot = options.workspaceRoot ?? process.cwd()
  const modeAdapter = options.runtimeModeAdapter ?? createSandboxRuntimeModeAdapter('direct')
  const { scope, verifier } = createTrustedLocalScope()
  const app = Fastify({ logger: options.logger ?? true, bodyLimit: 16 * 1024 * 1024 })
  const startedAt = Date.now()
  const created = await createAgentHost({
    agents: [{ agentTypeId: PLAYGROUND_AGENT_TYPE_ID, legacyDefault: true }],
    fleetCompiler: { async compile({ agents }) { return agents } },
    hostId: 'agent-playground',
    scopeVerifier: verifier,
    runtimeModeAdapter: modeAdapter,
    runtimeHost: modeAdapter.runtimeHost,
    sessionRoot: options.sessionRoot,
    ...(!options.sessionRoot ? { requestLedgerCompatibilityMode: 'development' as const } : {}),
    harnessFactory: options.harnessFactory,
    async resolveAuthorizedEnvironmentScope() {
      return {
        placementIdentity: JSON.stringify([modeAdapter.id, workspaceRoot]),
        workspaceRoot,
        provisioningFingerprint: JSON.stringify([modeAdapter.id, workspaceRoot]),
      }
    },
    async resolveAuthorizedAgentRuntimeScope() {
      return {
        identity: JSON.stringify(['agent-playground', modeAdapter.id, workspaceRoot]),
        physicalBindingIdentity: JSON.stringify([modeAdapter.id, workspaceRoot]),
        resourceInputDigest: JSON.stringify(['agent-playground', modeAdapter.id, workspaceRoot]),
        sessionNamespace: 'agent-playground',
      }
    },
  })

  try {
    app.get('/health', async () => ({
      status: 'ok',
      version: '0.1.0-dev',
      uptime: Math.floor((Date.now() - startedAt) / 1000),
    }))
    app.get('/ready', async () => ({ status: 'ready' }))
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
      defaultSessionId: PLAYGROUND_WORKSPACE_SCOPE_ID,
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
    close() {
      closePromise ??= closeRuntime(created, app)
      return closePromise
    },
  }
}
