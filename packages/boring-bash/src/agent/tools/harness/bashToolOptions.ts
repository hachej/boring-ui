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

function bwrapSpawnHook(
  bundle: RuntimeBundle,
  workspaceRoot: string,
  runtime?: RuntimeProvisioningOptions,
  sandboxRoot = '/workspace',
): BashSpawnHook {
  const runtimeHost = bundle.runtimeHost
  if (!runtimeHost) throw new Error('local sandbox runtime requires injected host operations')
  const args = runtimeHost.buildBwrapArgs(workspaceRoot)
  const bwrapPrefix = ['bwrap', ...args].map(shellEscape).join(' ')
  return (context) => ({
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
  })
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
  switch (strategy.kind) {
    case 'host':
      return hostBashToolOptions(bundle, runtime, strategy)
    case 'local-sandbox':
      return localSandboxBashToolOptions(bundle, runtime, strategy)
    case 'remote':
      return remoteBashToolOptions(bundle, runtime, executionRuntimeEnv, strategy)
  }
}
