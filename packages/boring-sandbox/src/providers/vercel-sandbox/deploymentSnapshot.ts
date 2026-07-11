import type {
  DeploymentSnapshotProvider,
  DeploymentSnapshotRecipe,
} from './snapshotRecipe'
import {
  bakeSnapshotIfNeeded,
  type BakeLogger,
  type SnapshotBakeResult,
  type VercelBakeClient,
} from './bake'

export { UV_SETUP_COMMANDS as VERCEL_UV_SETUP_COMMANDS } from './snapshotRecipe'

export interface VercelDeploymentSnapshotOptions {
  client: VercelBakeClient
  snapshotId?: string
  runtime?: string
  cachePath?: string
  logger?: BakeLogger
  now?: () => Date
  /**
   * Extra deploy-time setup commands baked into the reusable snapshot.
   * Use for runtime primitives such as uv or OS tools, not workspace content.
   */
  setupCommands?: readonly string[]
  pythonPackages?: readonly string[]
  systemPackages?: readonly string[]
}

export function createVercelDeploymentSnapshotProvider(
  opts: Omit<VercelDeploymentSnapshotOptions, 'runtime' | 'setupCommands' | 'pythonPackages' | 'systemPackages'>,
): DeploymentSnapshotProvider {
  return {
    async prepareDeploymentSnapshot(recipe: DeploymentSnapshotRecipe): Promise<SnapshotBakeResult> {
      return await bakeSnapshotIfNeeded({
        client: opts.client,
        snapshotId: opts.snapshotId,
        runtime: recipe.runtime,
        cachePath: opts.cachePath,
        logger: opts.logger,
        now: opts.now,
        setupCommands: recipe.setupCommands,
        pythonPackages: recipe.pythonPackages,
        systemPackages: recipe.systemPackages,
      })
    },
  }
}

export async function prepareVercelDeploymentSnapshot(
  opts: VercelDeploymentSnapshotOptions,
): Promise<SnapshotBakeResult> {
  return await bakeSnapshotIfNeeded({
    client: opts.client,
    snapshotId: opts.snapshotId,
    runtime: opts.runtime,
    cachePath: opts.cachePath,
    logger: opts.logger,
    now: opts.now,
    setupCommands: opts.setupCommands,
    pythonPackages: opts.pythonPackages,
    systemPackages: opts.systemPackages,
  })
}
