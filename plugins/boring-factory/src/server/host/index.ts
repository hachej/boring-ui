import { mkdir } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { createNodeWorkspace } from '@hachej/boring-sandbox/providers/node-workspace'
import { createWorkspaceAgentServer } from '@hachej/boring-workspace/app/server'
import type { FastifyInstance } from 'fastify'
import { createWorkspaceBeadsOperations } from '@hachej/boring-tasks/server'
import {
  createFactorySandboxPlugin,
  getFactorySandboxSnapshotInfo,
  resolveFactoryEpicKey,
  warmUpFactorySandboxSnapshot,
} from '../sandbox'
import { loadNativeFactoryFleet, deriveFeatureName, FACTORY_ORCHESTRATOR_AGENT_TYPE_ID } from './factoryFleet'
import { createFactoryDelegatePlugin } from './delegatePlugin'
import { createFactorySupervisionPlugin } from './supervisionPlugin'
import { createFactoryDemoPlugin } from './demoPlugin'

export interface CreateFactoryHostOptions {
  readonly repositoryRoot: string
  readonly workspaceRoot: string
  readonly epicKey: string
  readonly featureName?: string
  readonly stateRoot: string
  readonly env?: NodeJS.ProcessEnv
  readonly provider?: string
  readonly appRoot?: string
  readonly logger?: boolean
}

export interface FactoryHostHandle {
  readonly agents: Awaited<ReturnType<typeof loadNativeFactoryFleet>>
  readonly plugins: readonly unknown[]
  bind(app: FastifyInstance): void
  rearm(): Promise<void>
  close(): void
}

export function deriveFactoryWorkspaceScopeId(epicKey: string): string {
  return `factory-${epicKey}`
}

export async function createFactoryHost(options: CreateFactoryHostOptions): Promise<FactoryHostHandle> {
  const env = options.env ?? process.env
  const workspaceRoot = resolve(options.workspaceRoot)
  const stateRoot = resolve(options.stateRoot)
  const featureName = options.featureName ?? deriveFeatureName(options.epicKey, env)
  const workspaceScopeId = deriveFactoryWorkspaceScopeId(options.epicKey)
  await mkdir(stateRoot, { recursive: true })

  const agents = await loadNativeFactoryFleet(options.repositoryRoot, {
    orchestrator: options.provider ?? env.BORING_FACTORY_ORCHESTRATOR_MODEL,
    worker: options.provider ?? env.BORING_FACTORY_WORKER_MODEL,
    reviewer: options.provider ?? env.BORING_FACTORY_REVIEWER_MODEL,
    epicKey: options.epicKey,
    featureName,
  })
  const beadsOperations = createWorkspaceBeadsOperations(createNodeWorkspace(workspaceRoot))
  const delegate = createFactoryDelegatePlugin({ workspaceScopeId, epicKey: options.epicKey, featureName, workspaceRoot })
  const supervision = createFactorySupervisionPlugin({ stateRoot, workspaceScopeId })
  const demo = createFactoryDemoPlugin({ stateRoot, workspaceRoot, epicKey: options.epicKey, env, workspaceScopeId })
  const sandboxPlugin = createFactorySandboxPlugin(workspaceRoot, stateRoot, env, options.epicKey, workspaceScopeId)
  const taskPlugin = {
    dir: resolve(options.repositoryRoot, 'plugins/tasks'),
    options: { beadsOperations, config: { providers: [{ provider: 'github', repo: 'auto' }, { provider: 'beads' }] } },
    trust: 'internal' as const,
  }
  const automationPlugin = { dir: resolve(options.repositoryRoot, 'plugins/boring-automation'), trust: 'internal' as const }

  return {
    agents,
    plugins: [supervision.plugin, demo.plugin, sandboxPlugin, delegate.plugin, taskPlugin, automationPlugin],
    bind(app) {
      delegate.bind(app)
      supervision.bind(app)
      app.get('/api/v1/workspace/meta', async () => ({
        projectName: 'Boring Factory',
        workspaceId: workspaceScopeId,
        workspaceRoot,
        workspaceLabel: basename(workspaceRoot),
        epicKey: options.epicKey,
        featureName,
        defaultAgentTypeId: FACTORY_ORCHESTRATOR_AGENT_TYPE_ID,
        agentTypeIds: agents.map((agent) => agent.agentTypeId),
        sandboxProvider: (options.provider ?? env.BORING_FACTORY_SANDBOX_PROVIDER) === 'vercel' ? 'vercel' : 'local-simulation',
        sandboxSnapshot: await getFactorySandboxSnapshotInfo({ stateRoot, epicKey: options.epicKey, env }),
      }))
    },
    async rearm() {
      await supervision.rearm()
      await demo.rearm()
      void warmUpFactorySandboxSnapshot({ workspaceRoot, stateRoot, epicKey: options.epicKey, env })
    },
    close() {
      supervision.close()
      demo.close()
    },
  }
}

export async function createFactoryHostedApp(options: CreateFactoryHostOptions): Promise<FastifyInstance> {
  const env = options.env ?? process.env
  const host = await createFactoryHost(options)
  const app = await createWorkspaceAgentServer({
    workspaceRoot: resolve(options.workspaceRoot),
    appRoot: options.appRoot ?? options.repositoryRoot,
    sessionId: deriveFactoryWorkspaceScopeId(options.epicKey),
    sessionRoot: env.BORING_AGENT_SESSION_ROOT,
    requestLedgerPath: resolve(options.stateRoot, 'request-ledger.sqlite'),
    mode: 'direct',
    logger: options.logger ?? true,
    readonlyWorkspacePaths: ['.agents'],
    agents: host.agents,
    defaultAgentTypeId: FACTORY_ORCHESTRATOR_AGENT_TYPE_ID,
    externalPlugins: false,
    pi: { noContextFiles: true, noExtensions: true, noAmbientPackages: true, noSkills: true },
    workspaceScopedDefaultPluginAgentContributions: true,
    plugins: host.plugins as never,
    defaultPluginPackages: ['@hachej/boring-ask-user'],
    workspaceBridge: { allowInsecureLocalCliBrowserAuth: true },
  })
  host.bind(app)
  await host.rearm()
  return app
}
