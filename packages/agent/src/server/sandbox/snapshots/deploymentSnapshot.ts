/**
 * Authoritative uv path installed by the Vercel Node-runtime bootstrap. `uv`
 * lands in the per-user bin (`pip install --user`), which is NOT on PATH for
 * non-interactive provisioning exec — so internal callers must use this explicit
 * path, never bare `uv`.
 */
export const VERCEL_UV_BIN = '/home/vercel-sandbox/.local/bin/uv'

/**
 * uv setup for Python-family runtimes (e.g. Vercel `python3.13`), which already
 * ship `pip` and usually `uv`. Verify-or-install via the on-PATH `uv`.
 */
export const UV_SETUP_COMMANDS = [
  'command -v uv >/dev/null 2>&1 || python3 -m pip install --upgrade uv',
  'uv --version',
] as const

/**
 * uv setup for Node-family runtimes (Vercel `node22`/`node24`/`node26`), which
 * ship node/npm/pnpm + Amazon Linux `python3` but NO `pip` and NO Astral `uv`
 * (`dnf install uv` resolves to libuv, not Astral uv). So: install `python3-pip`
 * via `sudo dnf`, install uv with `--user`, and verify the explicit UV_BIN.
 */
export const NODE_UV_SETUP_COMMANDS = [
  'command -v pip3 >/dev/null 2>&1 || sudo dnf install -y python3-pip',
  `[ -x ${VERCEL_UV_BIN} ] || python3 -m pip install --user --upgrade uv`,
  `${VERCEL_UV_BIN} --version`,
] as const

/** Vercel Node-family runtime selectors lack pip/uv and need NODE_UV_SETUP_COMMANDS. */
function isNodeFamilyRuntime(runtime: string | undefined): boolean {
  return typeof runtime === 'string' && /^node/i.test(runtime.trim())
}

/** uv setup commands appropriate for the given runtime family. */
export function uvSetupCommandsForRuntime(runtime: string | undefined): readonly string[] {
  return isNodeFamilyRuntime(runtime) ? NODE_UV_SETUP_COMMANDS : UV_SETUP_COMMANDS
}

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
      ...(opts.includeUv === false ? [] : uvSetupCommandsForRuntime(opts.runtime)),
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
