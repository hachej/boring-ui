import { createHash } from 'node:crypto'
import { lstat, readFile, readdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { SandboxProvisioningOperationsV1 } from '../../shared/providerV1'
import { SandboxProviderError } from '../../shared/providerV1'
import {
  packProvisioningArtifact,
  resolveVercelArtifactInstallSource,
} from '../vercel-sandbox/provisioningAdapter'
import type { BlaxelSandboxExec } from './createBlaxelSandboxExec'
import type { BlaxelSandboxWorkspace } from './createBlaxelSandboxWorkspace'
import { BLAXEL_WORKSPACE_ROOT } from './config'
import { shellQuote } from './runtimeHelpers'

export const BLAXEL_PROVISIONING_CACHE_ROOT = `${BLAXEL_WORKSPACE_ROOT}/.boring/cache`
const RUNTIME_TMP = `${BLAXEL_WORKSPACE_ROOT}/.boring-agent/tmp`
const MAX_HOST_FILE_BYTES = 64 * 1024 * 1024
const MAX_HOST_COPY_BYTES = 512 * 1024 * 1024
const MAX_HOST_COPY_ENTRIES = 50_000

async function hostFs<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation() }
  catch (error) {
    if (error instanceof SandboxProviderError) throw error
    throw new SandboxProviderError(
      'RUNTIME_PROVISIONING_FAILED',
      'Blaxel host template filesystem operation failed',
    )
  }
}

export type BlaxelProvisioningAdapter = SandboxProvisioningOperationsV1 & {
  readonly mode: 'blaxel'
}

export async function fingerprintBlaxelHostTree(source: string | URL): Promise<string> {
  const sourcePath = source instanceof URL ? fileURLToPath(source) : source
  const sourceInfo = await hostFs(() => lstat(sourcePath))
  if (sourceInfo.isSymbolicLink()) {
    throw new SandboxProviderError('RUNTIME_PROVISIONING_FAILED', 'Blaxel template rejects symbolic links')
  }
  const approvedRoot = await hostFs(() => realpath(sourcePath))
  const hash = createHash('sha256').update('blaxel-template-v1\0')
  const state = { bytes: 0, entries: 0 }
  async function visit(current: string, relative: string): Promise<void> {
    state.entries += 1
    if (state.entries > MAX_HOST_COPY_ENTRIES) {
      throw new SandboxProviderError('RUNTIME_PROVISIONING_FAILED', 'Blaxel template exceeds the file-count limit')
    }
    const info = await hostFs(() => lstat(current))
    if (info.isSymbolicLink()) {
      throw new SandboxProviderError('RUNTIME_PROVISIONING_FAILED', 'Blaxel template rejects symbolic links')
    }
    const resolved = await hostFs(() => realpath(current))
    if (resolved !== approvedRoot && !resolved.startsWith(`${approvedRoot}/`)) {
      throw new SandboxProviderError('RUNTIME_PROVISIONING_FAILED', 'Blaxel template escaped its approved source')
    }
    if (info.isDirectory()) {
      hash.update(`d\0${relative}\0`)
      const entries = await hostFs(() => readdir(current, { withFileTypes: true }))
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        await visit(join(current, entry.name), relative ? `${relative}/${entry.name}` : entry.name)
      }
      return
    }
    if (!info.isFile()) {
      throw new SandboxProviderError('RUNTIME_PROVISIONING_FAILED', 'Blaxel template accepts only regular files and directories')
    }
    if (info.size > MAX_HOST_FILE_BYTES || state.bytes + info.size > MAX_HOST_COPY_BYTES) {
      throw new SandboxProviderError('RUNTIME_PROVISIONING_FAILED', 'Blaxel template exceeds the byte limit')
    }
    state.bytes += info.size
    hash.update(`f\0${relative}\0${info.size}\0`)
    hash.update(await hostFs(() => readFile(current)))
    hash.update('\0')
  }
  await visit(sourcePath, '')
  return hash.digest('hex')
}

export function createBlaxelProvisioningAdapter(input: {
  workspace: BlaxelSandboxWorkspace
  sandbox: BlaxelSandboxExec
}): BlaxelProvisioningAdapter {
  const workspaceFs = {
    async exists(path: string) {
      try { await input.workspace.stat(path); return true }
      catch (error) {
        if ((error as { code?: unknown } | null)?.code === 'ENOENT') return false
        throw error
      }
    },
    async rm(path: string) {
      try { await input.workspace.unlink(path) }
      catch (error) {
        if ((error as { code?: unknown } | null)?.code !== 'ENOENT') throw error
      }
    },
    async mkdir(path: string) { await input.workspace.mkdir(path, { recursive: true }) },
    async writeText(path: string, content: string) { await input.workspace.writeFile(path, content) },
    async readText(path: string) {
      try { return await input.workspace.readFile(path) }
      catch (error) {
        if ((error as { code?: unknown } | null)?.code === 'ENOENT') return null
        throw error
      }
    },
    async copyFromHost(source: string | URL, target: string) {
      const sourcePath = source instanceof URL ? fileURLToPath(source) : source
      const approvedRoot = await hostFs(() => realpath(sourcePath))
      const state = { bytes: 0, entries: 0 }
      async function copy(current: string, remoteTarget: string): Promise<void> {
        state.entries += 1
        if (state.entries > MAX_HOST_COPY_ENTRIES) {
          throw new SandboxProviderError('RUNTIME_PROVISIONING_FAILED', 'Blaxel host copy exceeds the file-count limit')
        }
        const info = await hostFs(() => lstat(current))
        if (info.isSymbolicLink()) {
          throw new SandboxProviderError('RUNTIME_PROVISIONING_FAILED', 'Blaxel host copy rejects symbolic links')
        }
        const resolved = await hostFs(() => realpath(current))
        if (resolved !== approvedRoot && !resolved.startsWith(`${approvedRoot}/`)) {
          throw new SandboxProviderError('RUNTIME_PROVISIONING_FAILED', 'Blaxel host copy escaped its approved source')
        }
        if (info.isDirectory()) {
          await input.workspace.mkdir(remoteTarget, { recursive: true })
          const entries = await hostFs(() => readdir(current, { withFileTypes: true }))
          for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
            await copy(join(current, entry.name), `${remoteTarget}/${entry.name}`)
          }
          return
        }
        if (!info.isFile()) {
          throw new SandboxProviderError('RUNTIME_PROVISIONING_FAILED', 'Blaxel host copy accepts only regular files and directories')
        }
        if (info.size > MAX_HOST_FILE_BYTES || state.bytes + info.size > MAX_HOST_COPY_BYTES) {
          throw new SandboxProviderError('RUNTIME_PROVISIONING_FAILED', 'Blaxel host copy exceeds the byte limit')
        }
        state.bytes += info.size
        const parent = remoteTarget.includes('/') ? remoteTarget.slice(0, remoteTarget.lastIndexOf('/')) : '.'
        await input.workspace.mkdir(parent, { recursive: true })
        await input.workspace.writeBinaryFile!(remoteTarget, new Uint8Array(await hostFs(() => readFile(current))))
      }
      await copy(sourcePath, target)
    },
  }

  return {
    mode: 'blaxel',
    async exec(command, args, opts) {
      const result = await input.sandbox.exec(
        [shellQuote(command), ...args.map(shellQuote)].join(' '),
        { cwd: opts?.cwd ?? BLAXEL_WORKSPACE_ROOT, env: opts?.env, timeoutMs: opts?.timeoutMs },
      )
      if (result.exitCode !== 0) {
        throw new SandboxProviderError('RUNTIME_PROVISIONING_FAILED', `Blaxel provisioning command exited ${result.exitCode}`)
      }
      return {
        stdout: new TextDecoder().decode(result.stdout),
        stderr: new TextDecoder().decode(result.stderr),
      }
    },
    async resolveInstallSource(source, opts) {
      return await resolveVercelArtifactInstallSource({
        workspaceFs,
        prepareArtifact: packProvisioningArtifact,
        runtimeTmpDir: RUNTIME_TMP,
        source,
        opts,
      })
    },
    workspaceFs,
    getRuntimeCacheRoot: () => BLAXEL_PROVISIONING_CACHE_ROOT,
  }
}
