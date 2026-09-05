import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createFactoryHostedApp } from '@hachej/boring-factory/server'

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
  return await createFactoryHostedApp({
    appRoot: options.appRoot,
    repositoryRoot: options.repositoryRoot,
    workspaceRoot,
    stateRoot,
    env,
    ...(env.BORING_FACTORY_EPIC_KEY?.trim() ? { epicKey: env.BORING_FACTORY_EPIC_KEY.trim() } : {}),
    ...(env.BORING_FACTORY_FEATURE_NAME?.trim() ? { featureName: env.BORING_FACTORY_FEATURE_NAME.trim() } : {}),
    models: {
      orchestrator: env.BORING_FACTORY_ORCHESTRATOR_MODEL,
      worker: env.BORING_FACTORY_WORKER_MODEL,
      reviewer: env.BORING_FACTORY_REVIEWER_MODEL,
    },
    provider: env.BORING_FACTORY_SANDBOX_PROVIDER,
    logger: options.logger,
  })
}
