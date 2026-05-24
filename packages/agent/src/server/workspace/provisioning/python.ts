import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { getBoringAgentRuntimeEnv, type BoringAgentRuntimePaths } from '../runtimeLayout'
import { ErrorCode, toProvisioningError } from './errors'
import {
  createPythonRuntimeFingerprint,
  createRuntimeFingerprint,
  isValidFingerprint,
} from './fingerprint'
import type { RuntimePythonSpec, WorkspaceProvisioningAdapter } from './types'

export interface EnsureUvResult {
  uvBin: string
  uvVersion: string
  installedWorkspaceUv: boolean
}

export interface EnsurePythonRuntimeResult {
  changed: boolean
  env: Record<string, string>
  pathEntries: string[]
  fingerprint: string | null
}

const VENV_REL = '.boring-agent/venv'
const VENV_FINGERPRINT_REL = `${VENV_REL}/.fingerprint`
const UV_BIN_REL = '.boring-agent/sdk/uv/bin/uv'

function sourceToPath(source: string | URL): string {
  return source instanceof URL ? fileURLToPath(source) : source
}

async function commandOutput(
  adapter: WorkspaceProvisioningAdapter,
  command: string,
  args: string[],
): Promise<string> {
  const result = await adapter.exec(command, args)
  return result?.stdout?.trim() ?? ''
}

export async function ensureUv(options: {
  adapter: WorkspaceProvisioningAdapter
  runtimeLayout: BoringAgentRuntimePaths
  uvStandaloneSource?: string | URL
}): Promise<EnsureUvResult> {
  try {
    return {
      uvBin: 'uv',
      uvVersion: await commandOutput(options.adapter, 'uv', ['--version']) || 'uv unknown',
      installedWorkspaceUv: false,
    }
  } catch {
    if (!options.uvStandaloneSource) {
      throw toProvisioningError(
        ErrorCode.enum.PROVISIONING_UV_BOOTSTRAP_FAILED,
        'uv-bootstrap',
        new Error('uv is required for Python runtime provisioning; install uv or provide a standalone uv binary'),
        { runtime: 'python' },
      )
    }
  }

  try {
    await options.adapter.workspaceFs.mkdir('.boring-agent/sdk/uv/bin')
    await options.adapter.workspaceFs.copyFromHost(options.uvStandaloneSource, UV_BIN_REL)
    const uvBin = join(options.runtimeLayout.uvBin, 'uv')
    await options.adapter.exec('chmod', ['+x', uvBin], { cwd: options.runtimeLayout.workspaceRoot })

    return {
      uvBin,
      uvVersion: await commandOutput(options.adapter, uvBin, ['--version']) || 'uv unknown',
      installedWorkspaceUv: true,
    }
  } catch (error) {
    throw toProvisioningError(
      ErrorCode.enum.PROVISIONING_UV_BOOTSTRAP_FAILED,
      'uv-bootstrap',
      error,
      { runtime: 'python' },
    )
  }
}

async function ensurePythonEnv(adapter: WorkspaceProvisioningAdapter): Promise<string> {
  return await commandOutput(adapter, 'python3', ['--version']) || 'Python unknown'
}

function pythonInstallSource(spec: RuntimePythonSpec): string {
  if (spec.version && spec.packageName) return `${spec.packageName}==${spec.version}`
  if (spec.packageName) return spec.packageName
  throw new Error(`Python runtime package ${spec.id} must declare packageName when no projectFile/packageRoot is provided`)
}

function sourceRootForPythonSpec(spec: RuntimePythonSpec): string | URL | null {
  if (spec.packageRoot) return spec.packageRoot
  if (spec.projectFile) return dirname(sourceToPath(spec.projectFile))
  return null
}

function expectedPythonOutputs(paths: BoringAgentRuntimePaths, packages: RuntimePythonSpec[]): string[] {
  return packages.flatMap((pkg) =>
    (pkg.expectedBins ?? []).map((bin) => join(paths.venvBin, bin)),
  )
}

function collectPythonEnv(packages: RuntimePythonSpec[]): Record<string, string> {
  const env: Record<string, string> = {}
  for (const pkg of packages) {
    for (const [key, value] of Object.entries(pkg.env ?? {})) {
      env[key] = String(value)
    }
  }
  return env
}

function toWorkspaceRel(paths: BoringAgentRuntimePaths, absolutePath: string): string {
  return relative(paths.workspaceRoot, absolutePath).split(sep).join('/')
}

async function shouldInstallPythonRuntime(options: {
  adapter: WorkspaceProvisioningAdapter
  runtimeLayout: BoringAgentRuntimePaths
  desiredFingerprint: string
  expectedOutputs: string[]
}): Promise<boolean> {
  const currentFingerprint = (await options.adapter.workspaceFs.readText(VENV_FINGERPRINT_REL))?.trim()
  if (!currentFingerprint || !isValidFingerprint(currentFingerprint) || currentFingerprint !== options.desiredFingerprint) {
    return true
  }

  for (const output of options.expectedOutputs) {
    if (!(await options.adapter.workspaceFs.exists(toWorkspaceRel(options.runtimeLayout, output)))) return true
  }
  return false
}

export async function ensurePythonRuntime(options: {
  adapter: WorkspaceProvisioningAdapter
  runtimeLayout: BoringAgentRuntimePaths
  packages: RuntimePythonSpec[]
  uvStandaloneSource?: string | URL
}): Promise<EnsurePythonRuntimeResult> {
  const env = collectPythonEnv(options.packages)
  if (options.packages.length === 0) {
    return { changed: false, env, pathEntries: [], fingerprint: null }
  }

  const pythonVersion = await ensurePythonEnv(options.adapter)
  const uv = await ensureUv(options)
  const fingerprint = createPythonRuntimeFingerprint({
    packages: options.packages,
    pythonVersion,
    uvVersion: uv.uvVersion,
  })
  const expectedOutputs = expectedPythonOutputs(options.runtimeLayout, options.packages)

  if (!(await shouldInstallPythonRuntime({
    adapter: options.adapter,
    runtimeLayout: options.runtimeLayout,
    desiredFingerprint: fingerprint,
    expectedOutputs,
  }))) {
    return {
      changed: false,
      env,
      pathEntries: [options.runtimeLayout.venvBin, options.runtimeLayout.uvBin],
      fingerprint,
    }
  }

  const installSources: string[] = []
  for (const pkg of options.packages) {
    const sourceRoot = sourceRootForPythonSpec(pkg)
    if (sourceRoot) {
      const packageFingerprint = createRuntimeFingerprint({ kind: 'python-source', package: pkg })
      installSources.push(await options.adapter.resolveInstallSource(sourceRoot, {
        kind: 'python',
        id: pkg.id,
        fingerprint: packageFingerprint,
      }))
    } else {
      installSources.push(pythonInstallSource(pkg))
    }
    installSources.push(...pkg.extraLibs ?? [])
  }

  await options.adapter.workspaceFs.rm(VENV_REL)
  try {
    await options.adapter.exec(uv.uvBin, ['venv', options.runtimeLayout.venv], {
      cwd: options.runtimeLayout.workspaceRoot,
      env: getBoringAgentRuntimeEnv(
        options.runtimeLayout,
        options.adapter.getRuntimeCacheRoot(),
      ),
    })
    await options.adapter.exec(uv.uvBin, [
      'pip',
      'install',
      '--python',
      options.runtimeLayout.venvPython,
      ...installSources,
    ], {
      cwd: options.runtimeLayout.workspaceRoot,
      env: {
        ...getBoringAgentRuntimeEnv(
          options.runtimeLayout,
          options.adapter.getRuntimeCacheRoot(),
        ),
        ...env,
      },
    })
  } catch (error) {
    throw toProvisioningError(
      ErrorCode.enum.PROVISIONING_UV_INSTALL_FAILED,
      'python-packages',
      error,
      { runtime: 'python', packageIds: options.packages.map((pkg) => pkg.id) },
    )
  }
  await options.adapter.workspaceFs.writeText(VENV_FINGERPRINT_REL, `${fingerprint}\n`)

  return {
    changed: true,
    env,
    pathEntries: [options.runtimeLayout.venvBin, options.runtimeLayout.uvBin],
    fingerprint,
  }
}
