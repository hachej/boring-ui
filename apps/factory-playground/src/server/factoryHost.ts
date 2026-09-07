import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createFactoryHost, deriveFactoryWorkspaceScopeId } from '@hachej/boring-factory/server'
import { createWorkspaceAgentServer } from '@hachej/boring-workspace/app/server'

export interface FactoryRegistration {
  readonly workspaceRoot: string
  readonly stateRoot: string
  readonly provider?: string
  readonly apiPort: number
  readonly uiPort: number
  readonly models?: {
    readonly orchestrator?: string
    readonly worker?: string
    readonly reviewer?: string
  }
}

export interface StartFactoryHostOptions {
  readonly appRoot: string
  readonly repositoryRoot: string
  readonly registration: FactoryRegistration
  readonly env?: NodeJS.ProcessEnv
  readonly logger?: boolean
  /** Tests and in-process embedders may bind routes without opening a socket. */
  readonly listen?: boolean
}

export async function startFactoryHost(options: StartFactoryHostOptions) {
  const env = options.env ?? process.env
  const registration = options.registration
  const workspaceRoot = resolve(registration.workspaceRoot)
  const stateRoot = resolve(registration.stateRoot)
  await mkdir(stateRoot, { recursive: true })

  const hostEnv: NodeJS.ProcessEnv = {
    ...env,
    BORING_FACTORY_WORKSPACE_ROOT: workspaceRoot,
    BORING_FACTORY_STATE_ROOT: stateRoot,
    BORING_AGENT_SESSION_ROOT: env.BORING_AGENT_SESSION_ROOT ?? resolve(stateRoot, 'sessions'),
    BORING_FACTORY_SANDBOX_PROVIDER: registration.provider ?? env.BORING_FACTORY_SANDBOX_PROVIDER,
    AGENT_API_PORT: String(registration.apiPort),
    PORT: String(registration.uiPort),
    ...(registration.models?.orchestrator ? { BORING_FACTORY_ORCHESTRATOR_MODEL: registration.models.orchestrator } : {}),
    ...(registration.models?.worker ? { BORING_FACTORY_WORKER_MODEL: registration.models.worker } : {}),
    ...(registration.models?.reviewer ? { BORING_FACTORY_REVIEWER_MODEL: registration.models.reviewer } : {}),
  }

  const host = await createFactoryHost({
    appRoot: options.appRoot,
    repositoryRoot: options.repositoryRoot,
    workspaceRoot,
    stateRoot,
    env: hostEnv,
    models: registration.models,
    provider: registration.provider,
    logger: options.logger,
    epicKey: env.BORING_FACTORY_EPIC_KEY,
    featureName: env.BORING_FACTORY_FEATURE_NAME,
  })

  const app = await createWorkspaceAgentServer({
    workspaceRoot,
    appRoot: options.appRoot,
    sessionId: deriveFactoryWorkspaceScopeId(),
    sessionRoot: hostEnv.BORING_AGENT_SESSION_ROOT,
    requestLedgerPath: resolve(stateRoot, 'request-ledger.sqlite'),
    mode: 'direct',
    logger: options.logger ?? true,
    readonlyWorkspacePaths: ['.agents'],
    agents: host.agents,
    defaultAgentTypeId: host.agents[0]?.agentTypeId ?? 'factory-orchestrator',
    externalPlugins: false,
    pi: { noContextFiles: true, noExtensions: true, noAmbientPackages: true, noSkills: true },
    workspaceScopedDefaultPluginAgentContributions: true,
    plugins: host.plugins as never,
    defaultPluginPackages: ['@hachej/boring-ask-user'],
    workspaceBridge: { allowInsecureLocalCliBrowserAuth: true },
  })
  try {
    host.bind(app)
    await host.rearm()
    if (options.listen !== false) await app.listen({ host: '127.0.0.1', port: registration.apiPort })
    return { app, host, env: hostEnv }
  } catch (error) {
    host.close()
    await app.close()
    throw error
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const workspaceRoot = process.env.BORING_FACTORY_WORKSPACE_ROOT
  const stateRoot = process.env.BORING_FACTORY_STATE_ROOT
  const apiPort = Number(process.env.AGENT_API_PORT || '5230')
  const uiPort = Number(process.env.PORT || '5220')
  if (!workspaceRoot || !stateRoot) {
    console.error('factory-host requires BORING_FACTORY_WORKSPACE_ROOT and BORING_FACTORY_STATE_ROOT')
    process.exitCode = 1
  } else {
    startFactoryHost({
      appRoot: resolve(import.meta.dirname, '..'),
      repositoryRoot: resolve(import.meta.dirname, '../../..'),
      registration: {
        workspaceRoot,
        stateRoot,
        provider: process.env.BORING_FACTORY_SANDBOX_PROVIDER,
        apiPort,
        uiPort,
        models: {
          orchestrator: process.env.BORING_FACTORY_ORCHESTRATOR_MODEL,
          worker: process.env.BORING_FACTORY_WORKER_MODEL,
          reviewer: process.env.BORING_FACTORY_REVIEWER_MODEL,
        },
      },
    }).catch((error) => {
      console.error(error)
      process.exitCode = 1
    })
  }
}
