import { execFile } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { promisify } from 'node:util'
import { createNodeWorkspace } from '@hachej/boring-sandbox/providers/node-workspace'
import { createWorkspaceAgentServer } from '@hachej/boring-workspace/app/server'
import { createWorkspaceBeadsOperations } from '@hachej/boring-tasks/server'
import { loadNativeFactoryFleet, deriveFeatureName, FACTORY_ORCHESTRATOR_AGENT_TYPE_ID } from './factoryFleet'
import { createFactoryDelegatePlugin } from './delegatePlugin'
import { createFactorySupervisionPlugin } from './supervisionPlugin'
import { createFactoryDemoPlugin } from './demoPlugin'
import { createFactorySandboxPlugin, FACTORY_WORKSPACE_SCOPE_ID } from './sandboxComposition'

export interface CreateFactoryPlaygroundOptions {
  readonly appRoot: string
  readonly repositoryRoot: string
  readonly workspaceRoot?: string
  readonly logger?: boolean
  readonly env?: NodeJS.ProcessEnv
}

const execFileAsync = promisify(execFile)

async function resolveEpicKey(workspaceRoot: string, env: NodeJS.ProcessEnv): Promise<string> {
  const configured = env.BORING_FACTORY_EPIC_KEY?.trim()
  if (configured) return configured
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: workspaceRoot })
    const branch = stdout.trim()
    if (branch) return branch
  } catch {
    // not a git repo (or git unavailable): fall back to the workspace directory name below.
  }
  return basename(workspaceRoot)
}

export async function createFactoryPlayground(options: CreateFactoryPlaygroundOptions) {
  const env = options.env ?? process.env
  const workspaceRoot = resolve(options.workspaceRoot ?? env.BORING_FACTORY_WORKSPACE_ROOT ?? options.repositoryRoot)
  const stateRoot = resolve(env.BORING_FACTORY_STATE_ROOT ?? resolve(options.appRoot, '.factory-state'))
  await mkdir(stateRoot, { recursive: true })
  const epicKey = await resolveEpicKey(workspaceRoot, env)
  const featureName = deriveFeatureName(epicKey, env)
  const agents = await loadNativeFactoryFleet(options.repositoryRoot, {
    orchestrator: env.BORING_FACTORY_ORCHESTRATOR_MODEL,
    worker: env.BORING_FACTORY_WORKER_MODEL,
    reviewer: env.BORING_FACTORY_REVIEWER_MODEL,
    epicKey,
    featureName,
  })
  const beadsOperations = createWorkspaceBeadsOperations(createNodeWorkspace(workspaceRoot))
  const delegate = createFactoryDelegatePlugin({ workspaceScopeId: FACTORY_WORKSPACE_SCOPE_ID, epicKey, featureName, workspaceRoot })
  const supervision = createFactorySupervisionPlugin({ stateRoot })
  const demo = createFactoryDemoPlugin({ stateRoot, workspaceRoot, epicKey, env })

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
      supervision.plugin,
      demo.plugin,
      createFactorySandboxPlugin(workspaceRoot, stateRoot, env),
      delegate.plugin,
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

  delegate.bind(app)
  supervision.bind(app)
  await supervision.rearm()
  await demo.rearm()

  app.get('/api/v1/workspace/meta', async () => ({
    projectName: 'Boring Factory',
    workspaceId: FACTORY_WORKSPACE_SCOPE_ID,
    workspaceRoot,
    workspaceLabel: basename(workspaceRoot),
    epicKey,
    featureName,
    defaultAgentTypeId: FACTORY_ORCHESTRATOR_AGENT_TYPE_ID,
    agentTypeIds: agents.map((agent) => agent.agentTypeId),
    sandboxProvider: env.BORING_FACTORY_SANDBOX_PROVIDER === 'vercel' ? 'vercel' : 'local-simulation',
  }))

  return app
}
