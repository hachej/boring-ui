import {
  type BashOperations,
  type BashSpawnHook,
  type BashToolOptions,
  createLocalBashOperations,
} from '@mariozechner/pi-coding-agent'

import { buildBwrapArgs } from '../../sandbox/bwrap/buildBwrapArgs'
import { withWorkspacePythonEnv } from '../../sandbox/workspacePythonEnv'
import { remoteSandboxBashOps } from '../operations/remoteSandbox'
import { mergeRuntimeProvisioningEnv, type RuntimeProvisioningOptions } from '../../runtime/env'
import { getRuntimeBundleStorageRoot, type RuntimeBashStrategy, type RuntimeBundle } from '../../runtime/mode'

function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`
}

function bwrapSpawnHook(
  workspaceRoot: string,
  runtime?: RuntimeProvisioningOptions,
  sandboxRoot = '/workspace',
): BashSpawnHook {
  const args = buildBwrapArgs(workspaceRoot)
  const bwrapPrefix = ['bwrap', ...args].map(shellEscape).join(' ')
  return (context) => ({
    ...context,
    command: `${bwrapPrefix} bash -lc ${shellEscape(context.command)}`,
    env: withWorkspacePythonEnv({
      workspaceRoot,
      env: mergeRuntimeProvisioningEnv(runtime, context.env),
      sandboxRoot,
    }),
  })
}

function directSpawnHook(
  workspaceRoot: string,
  runtime?: RuntimeProvisioningOptions,
  preserveHostHome = true,
): BashSpawnHook {
  return (context) => ({
    ...context,
    env: withWorkspacePythonEnv({
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
    spawnHook: directSpawnHook(storageRoot, runtime, strategy.preserveHostHome ?? true),
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
    spawnHook: bwrapSpawnHook(storageRoot, runtime, strategy.sandboxRoot),
  }
}

function remoteBashToolOptions(
  bundle: RuntimeBundle,
  runtime: RuntimeProvisioningOptions | undefined,
  executionRuntimeEnv: Record<string, string> | undefined,
  strategy: Extract<RuntimeBashStrategy, { kind: 'remote' }>,
): BashToolOptions {
  return {
    operations: remoteSandboxBashOps(bundle.sandbox, {
      defaultPath: strategy.defaultPath,
      runtime,
      executionRuntimeEnv,
    }),
  }
}

export function createBashToolOptionsForRuntime(
  bundle: RuntimeBundle,
  runtime?: RuntimeProvisioningOptions,
  executionRuntimeEnv?: Record<string, string>,
): BashToolOptions {
  const strategy = bundle.bash ?? { kind: 'host' as const, preserveHostHome: true }
  switch (strategy.kind) {
    case 'host':
      return hostBashToolOptions(bundle, runtime, strategy)
    case 'local-sandbox':
      return localSandboxBashToolOptions(bundle, runtime, strategy)
    case 'remote':
      return remoteBashToolOptions(bundle, runtime, executionRuntimeEnv, strategy)
  }
}
