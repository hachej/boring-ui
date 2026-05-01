export const UV_SETUP_COMMANDS = [
  'command -v uv >/dev/null 2>&1 || python3 -m pip install --upgrade uv',
  'uv --version',
] as const

export type DeploymentSnapshotStatus = 'skipped' | 'cache-hit' | 'baked' | 'failed'

export interface DeploymentSnapshotRecipe {
  /** Provider runtime/image selector. Example: Vercel's python3.13 runtime. */
  runtime?: string
  /** OS packages to bake into the reusable runtime layer. */
  systemPackages?: readonly string[]
  /** Python packages to bake into the reusable runtime layer. */
  pythonPackages?: readonly string[]
  /** Ordered setup commands for runtime primitives such as uv. */
  setupCommands?: readonly string[]
}

export interface DeploymentSnapshotResult {
  status: DeploymentSnapshotStatus
  reason: string
  hash?: string
  snapshotId?: string
  error?: unknown
}

export interface DeploymentSnapshotProvider {
  prepareDeploymentSnapshot(recipe: DeploymentSnapshotRecipe): Promise<DeploymentSnapshotResult>
}

export interface BuildDeploymentSnapshotRecipeOptions extends DeploymentSnapshotRecipe {
  /** Defaults true: install/check uv at deploy-time so workspaces boot fast. */
  includeUv?: boolean
}

export function buildDeploymentSnapshotRecipe(
  opts: BuildDeploymentSnapshotRecipeOptions = {},
): DeploymentSnapshotRecipe {
  return {
    runtime: opts.runtime,
    systemPackages: opts.systemPackages,
    pythonPackages: opts.pythonPackages,
    setupCommands: [
      ...(opts.includeUv === false ? [] : UV_SETUP_COMMANDS),
      ...(opts.setupCommands ?? []),
    ],
  }
}

export async function prepareDeploymentSnapshot(
  provider: DeploymentSnapshotProvider,
  recipe: DeploymentSnapshotRecipe,
): Promise<DeploymentSnapshotResult> {
  return await provider.prepareDeploymentSnapshot(recipe)
}
