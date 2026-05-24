import { join } from 'node:path'

import { getBoringAgentRuntimeEnv, type BoringAgentRuntimePaths } from '../runtimeLayout'
import { ErrorCode, toProvisioningError } from './errors'
import {
  createNodeRuntimeFingerprint,
  createRuntimeFingerprint,
  shouldInstallRuntime,
  writeFingerprintAfterSuccessfulInstall,
} from './fingerprint'
import type { RuntimeNodePackageSpec, WorkspaceProvisioningAdapter } from './types'

export interface EnsureNodeRuntimeResult {
  changed: boolean
  pathEntries: string[]
  fingerprint: string | null
}

const NODE_RUNTIME_REL = '.boring-agent/node'
const NODE_PACKAGE_JSON_REL = `${NODE_RUNTIME_REL}/package.json`

function parseNodeMajor(version: string): number | null {
  const match = version.trim().match(/^v?(\d+)\./)
  return match ? Number(match[1]) : null
}

async function commandOutput(
  adapter: WorkspaceProvisioningAdapter,
  command: string,
  args: string[],
): Promise<string> {
  const result = await adapter.exec(command, args)
  return result?.stdout?.trim() ?? ''
}

export async function ensureNodeEnv(adapter: WorkspaceProvisioningAdapter): Promise<{
  nodeVersion: string
  npmVersion: string
}> {
  try {
    const nodeVersion = await commandOutput(adapter, 'node', ['--version'])
    const npmVersion = await commandOutput(adapter, 'npm', ['--version'])
    const major = parseNodeMajor(nodeVersion || process.version)

    if (major === null || major < 18) {
      throw new Error(`Unsupported Node.js version for runtime provisioning: ${nodeVersion || process.version}`)
    }

    return {
      nodeVersion: nodeVersion || process.version,
      npmVersion: npmVersion || 'unknown',
    }
  } catch (error) {
    throw toProvisioningError(
      ErrorCode.enum.PROVISIONING_NODE_PREFLIGHT_FAILED,
      'node-preflight',
      error,
      { runtime: 'node' },
    )
  }
}

function nodeInstallSource(spec: RuntimeNodePackageSpec): string {
  return spec.version ? `${spec.packageName}@${spec.version}` : spec.packageName
}

function expectedNodeOutputs(paths: BoringAgentRuntimePaths, packages: RuntimeNodePackageSpec[]): string[] {
  return packages.flatMap((pkg) =>
    (pkg.expectedBins ?? []).map((bin) => join(paths.nodeBin, bin)),
  )
}

export async function ensureNodeRuntime(options: {
  adapter: WorkspaceProvisioningAdapter
  runtimeLayout: BoringAgentRuntimePaths
  packages: RuntimeNodePackageSpec[]
}): Promise<EnsureNodeRuntimeResult> {
  if (options.packages.length === 0) {
    return { changed: false, pathEntries: [], fingerprint: null }
  }

  const versions = await ensureNodeEnv(options.adapter)
  const fingerprint = createNodeRuntimeFingerprint({
    ...versions,
    packages: options.packages,
  })
  const fingerprintPath = join(options.runtimeLayout.node, '.fingerprint')
  const expectedOutputs = expectedNodeOutputs(options.runtimeLayout, options.packages)

  if (!(await shouldInstallRuntime({
    fingerprintPath,
    desiredFingerprint: fingerprint,
    expectedOutputs,
  }))) {
    return {
      changed: false,
      pathEntries: [options.runtimeLayout.nodeBin],
      fingerprint,
    }
  }

  const installSources: string[] = []
  for (const pkg of options.packages) {
    if (pkg.packageRoot) {
      const packageFingerprint = createRuntimeFingerprint({ kind: 'node-source', package: pkg })
      installSources.push(await options.adapter.resolveInstallSource(pkg.packageRoot, {
        kind: 'node',
        id: pkg.id,
        fingerprint: packageFingerprint,
      }))
      continue
    }

    installSources.push(nodeInstallSource(pkg))
  }

  await writeFingerprintAfterSuccessfulInstall({
    fingerprintPath,
    fingerprint,
    install: async () => {
      await options.adapter.workspaceFs.rm(NODE_RUNTIME_REL)
      await options.adapter.workspaceFs.mkdir(NODE_RUNTIME_REL)
      await options.adapter.workspaceFs.writeText(
        NODE_PACKAGE_JSON_REL,
        `${JSON.stringify({ name: 'boring-agent-runtime', private: true }, null, 2)}\n`,
      )
      try {
        await options.adapter.exec('npm', [
          'install',
          '--prefix',
          options.runtimeLayout.node,
          ...installSources,
        ], {
          cwd: options.runtimeLayout.workspaceRoot,
          env: getBoringAgentRuntimeEnv(
            options.runtimeLayout,
            options.adapter.getRuntimeCacheRoot(),
          ),
        })
      } catch (error) {
        throw toProvisioningError(
          ErrorCode.enum.PROVISIONING_NPM_INSTALL_FAILED,
          'node-packages',
          error,
          { runtime: 'node', packageIds: options.packages.map((pkg) => pkg.id) },
        )
      }
    },
  })

  return {
    changed: true,
    pathEntries: [options.runtimeLayout.nodeBin],
    fingerprint,
  }
}
