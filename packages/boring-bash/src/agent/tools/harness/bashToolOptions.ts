import { lstatSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'

import {
  type BashOperations,
  type BashSpawnHook,
  type BashToolOptions,
  createLocalBashOperations,
} from '@mariozechner/pi-coding-agent'

import { remoteSandboxBashOps } from '../operations/remoteSandbox'
import { mergeRuntimeProvisioningEnv, type RuntimeProvisioningOptions } from '../../runtime/env'
import { getRuntimeBundleStorageRoot, type RuntimeBashStrategy, type RuntimeBundle } from '../../runtime/types'

function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`
}

const RUNTIME_CONFIG_INVALID_CODE = 'CONFIG_INVALID' as const

function invalidReadonlyRoot(): never {
  throw Object.assign(new Error('readonly workspace shell roots are no longer safe to mount'), {
    code: RUNTIME_CONFIG_INVALID_CODE,
  })
}

/** Per-spawn check: roots and ancestor chains only; deep-tree qualification stays construction-only. */
function assertReadonlyMountSourcesForSpawn(workspaceRoot: string, readonlyPaths: readonly string[]): void {
  if (!isAbsolute(workspaceRoot)) invalidReadonlyRoot()
  let canonicalRoot: string
  try {
    const rootStat = lstatSync(workspaceRoot)
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) invalidReadonlyRoot()
    canonicalRoot = realpathSync(workspaceRoot)
  } catch {
    invalidReadonlyRoot()
  }
  for (const readonlyPath of readonlyPaths) {
    const segments = readonlyPath.replace(/\\/g, '/').split('/')
    if (!readonlyPath || readonlyPath.startsWith('/') || readonlyPath.includes('\0')
      || segments.some((segment) => !segment || segment === '.' || segment === '..')) invalidReadonlyRoot()
    let current = workspaceRoot
    for (const [index, segment] of segments.entries()) {
      current = join(current, segment)
      try {
        const stat = lstatSync(current)
        if (stat.isSymbolicLink() || (index < segments.length - 1 && !stat.isDirectory())) invalidReadonlyRoot()
      } catch {
        invalidReadonlyRoot()
      }
    }
    let canonical: string
    try { canonical = realpathSync(current) } catch { invalidReadonlyRoot() }
    const rel = relative(canonicalRoot!, canonical!)
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) invalidReadonlyRoot()
  }
}

function bwrapSpawnHook(
  bundle: RuntimeBundle,
  workspaceRoot: string,
  runtime?: RuntimeProvisioningOptions,
  sandboxRoot = '/workspace',
): BashSpawnHook {
  const runtimeHost = bundle.runtimeHost
  if (!runtimeHost) throw new Error('local sandbox runtime requires injected host operations')
  const readonlyPaths = bundle.readonlyWorkspacePathEnforcement === 'operations-and-shell'
    ? bundle.readonlyWorkspacePolicy?.readonlyPaths ?? []
    : []
  const args = readonlyPaths.length > 0
    ? runtimeHost.buildBwrapArgs(workspaceRoot, { readonlyWorkspacePaths: readonlyPaths })
    : runtimeHost.buildBwrapArgs(workspaceRoot)
  const bwrapPrefix = ['bwrap', ...args].map(shellEscape).join(' ')
  return (context) => {
    if (readonlyPaths.length > 0) assertReadonlyMountSourcesForSpawn(workspaceRoot, readonlyPaths)
    return {
      ...context,
      // The inner command runs at sandboxRoot inside bwrap, but the host-side
      // process must spawn from a real host path. GitHub runners do not have a
      // /workspace directory, so keep the outer cwd on the mounted storage root.
      cwd: workspaceRoot,
      command: `${bwrapPrefix} bash -lc ${shellEscape(context.command)}`,
      env: runtimeHost.withWorkspacePythonEnv({
        workspaceRoot,
        env: mergeRuntimeProvisioningEnv(runtime, context.env),
        sandboxRoot,
      }),
    }
  }
}

function directSpawnHook(
  bundle: RuntimeBundle,
  workspaceRoot: string,
  runtime?: RuntimeProvisioningOptions,
  preserveHostHome = true,
): BashSpawnHook {
  const runtimeHost = bundle.runtimeHost
  if (!runtimeHost) throw new Error('direct runtime requires injected host operations')
  return (context) => ({
    ...context,
    env: runtimeHost.withWorkspacePythonEnv({
      workspaceRoot,
      env: mergeRuntimeProvisioningEnv(runtime, context.env),
      preserveHostHome,
    }),
  })
}

function localBashOperationsWithRuntimeEnv(bundle: RuntimeBundle): BashOperations {
  const local = createLocalBashOperations()
  return {
    async exec(command, cwd, options) {
      const runtimeEnv = await bundle.getRuntimeEnv?.()
      return local.exec(command, cwd, {
        ...options,
        env: { ...(options.env ?? {}), ...(runtimeEnv ?? {}) },
      })
    },
  }
}

function hostBashToolOptions(
  bundle: RuntimeBundle,
  runtime: RuntimeProvisioningOptions | undefined,
  strategy: Extract<RuntimeBashStrategy, { kind: 'host' }>,
): BashToolOptions {
  const storageRoot = getRuntimeBundleStorageRoot(bundle)
  return {
    operations: localBashOperationsWithRuntimeEnv(bundle),
    spawnHook: directSpawnHook(bundle, storageRoot, runtime, strategy.preserveHostHome ?? true),
  }
}

function localSandboxBashToolOptions(
  bundle: RuntimeBundle,
  runtime: RuntimeProvisioningOptions | undefined,
  strategy: Extract<RuntimeBashStrategy, { kind: 'local-sandbox' }>,
): BashToolOptions {
  const storageRoot = getRuntimeBundleStorageRoot(bundle)
  return {
    // localBashOperationsWithRuntimeEnv() injects bundle.getRuntimeEnv()
    // into the outer shell env before the spawned sandbox shell command runs,
    // so bridge runtime env reaches local sandboxed commands without relying
    // on provisioning PATH/env alone.
    operations: localBashOperationsWithRuntimeEnv(bundle),
    spawnHook: bwrapSpawnHook(bundle, storageRoot, runtime, strategy.sandboxRoot),
  }
}

function remoteBashToolOptions(
  bundle: RuntimeBundle,
  runtime: RuntimeProvisioningOptions | undefined,
  executionRuntimeEnv: Record<string, string> | undefined,
  strategy: Extract<RuntimeBashStrategy, { kind: 'remote' }>,
): BashToolOptions {
  return {
    operations: remoteSandboxBashOps(bundle.sandbox, bundle.workspace, {
      defaultPath: strategy.defaultPath,
      runtime,
      executionRuntimeEnv,
    }),
  }
}

function defaultBashStrategyForBundle(bundle: RuntimeBundle): RuntimeBashStrategy {
  return bundle.sandbox.placement === 'remote'
    ? { kind: 'remote' }
    : { kind: 'host', preserveHostHome: true }
}

export function createBashToolOptionsForRuntime(
  bundle: RuntimeBundle,
  runtime?: RuntimeProvisioningOptions,
  executionRuntimeEnv?: Record<string, string>,
): BashToolOptions {
  const strategy = bundle.bash ?? defaultBashStrategyForBundle(bundle)
  if (
    bundle.readonlyWorkspacePolicy
    && bundle.readonlyWorkspacePathEnforcement === 'operations-and-shell'
    && strategy.kind !== 'local-sandbox'
  ) {
    throw Object.assign(new Error('strong readonly workspace shell enforcement requires local-sandbox bash'), {
      code: RUNTIME_CONFIG_INVALID_CODE,
    })
  }
  switch (strategy.kind) {
    case 'host':
      return hostBashToolOptions(bundle, runtime, strategy)
    case 'local-sandbox':
      return localSandboxBashToolOptions(bundle, runtime, strategy)
    case 'remote':
      return remoteBashToolOptions(bundle, runtime, executionRuntimeEnv, strategy)
  }
}
