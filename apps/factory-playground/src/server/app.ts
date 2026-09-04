import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { resolveFactoryEpicKey, createFactoryHostedApp } from '@hachej/boring-factory/server'

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
  const epicKey = await resolveFactoryEpicKey(workspaceRoot, env)
  return await createFactoryHostedApp({
    appRoot: options.appRoot,
    repositoryRoot: options.repositoryRoot,
    workspaceRoot,
    epicKey,
    stateRoot,
    env,
    provider: env.BORING_FACTORY_SANDBOX_PROVIDER,
    logger: options.logger,
  })
}
