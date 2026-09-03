import { mkdir } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { createNodeWorkspace } from '@hachej/boring-sandbox/providers/node-workspace'
import { createWorkspaceAgentServer } from '@hachej/boring-workspace/app/server'
import { createWorkspaceBeadsOperations } from '@hachej/boring-tasks/server'
import { loadNativeFactoryFleet, FACTORY_ORCHESTRATOR_AGENT_TYPE_ID } from './factoryFleet'
import { createFactoryLoopPlugin } from './loopPlugin'
import { createFactorySandboxPlugin, FACTORY_WORKSPACE_SCOPE_ID } from './sandboxComposition'

export interface CreateFactoryPlaygroundOptions {
  readonly appRoot: string
  readonly repositoryRoot: string
  readonly workspaceRoot?: string
  readonly logger?: boolean
  readonly env?: NodeJS.ProcessEnv
}

export async function createFactoryPlayground(options: CreateFactoryPlaygroundOptions) {
  const env = options.env ?? process.env
  const workspaceRoot = resolve(options.workspaceRoot ?? env.BORING_FACTORY_WORKSPACE_ROOT ?? options.repositoryRoot)
  const stateRoot = resolve(env.BORING_FACTORY_STATE_ROOT ?? resolve(options.appRoot, '.factory-state'))
  await mkdir(stateRoot, { recursive: true })
  const agents = await loadNativeFactoryFleet(options.repositoryRoot, {
    orchestrator: env.BORING_FACTORY_ORCHESTRATOR_MODEL,
    worker: env.BORING_FACTORY_WORKER_MODEL,
  })
  const beadsOperations = createWorkspaceBeadsOperations(createNodeWorkspace(workspaceRoot))

  const app = await createWorkspaceAgentServer({
    workspaceRoot,
    appRoot: options.appRoot,
    sessionId: FACTORY_WORKSPACE_SCOPE_ID,
    sessionRoot: env.BORING_AGENT_SESSION_ROOT,
    requestLedgerPath: resolve(stateRoot, 'request-ledger.sqlite'),
    mode: 'direct',
    logger: options.logger ?? true,
    readonlyWorkspacePaths: ['.agents'],
    agents,
    defaultAgentTypeId: FACTORY_ORCHESTRATOR_AGENT_TYPE_ID,
    externalPlugins: false,
    pi: {
      noContextFiles: true,
      noExtensions: true,
      noAmbientPackages: true,
      noSkills: true,
    },
    workspaceScopedDefaultPluginAgentContributions: true,
    plugins: [
      createFactoryLoopPlugin(),
      createFactorySandboxPlugin(workspaceRoot, stateRoot, env),
      {
        dir: resolve(options.repositoryRoot, 'plugins/tasks'),
        options: {
          beadsOperations,
          config: { providers: [{ provider: 'github', repo: 'auto' }, { provider: 'beads' }] },
        },
        trust: 'internal',
      },
      {
        dir: resolve(options.repositoryRoot, 'plugins/boring-automation'),
        trust: 'internal',
      },
    ],
    defaultPluginPackages: ['@hachej/boring-ask-user'],
    workspaceBridge: { allowInsecureLocalCliBrowserAuth: true },
  })

  app.get('/api/v1/workspace/meta', async () => ({
    projectName: 'Boring Factory',
    workspaceId: FACTORY_WORKSPACE_SCOPE_ID,
    workspaceRoot,
    workspaceLabel: basename(workspaceRoot),
    defaultAgentTypeId: FACTORY_ORCHESTRATOR_AGENT_TYPE_ID,
    agentTypeIds: agents.map((agent) => agent.agentTypeId),
    sandboxProvider: env.BORING_FACTORY_SANDBOX_PROVIDER === 'vercel' ? 'vercel' : 'local-simulation',
  }))

  return app
}
