import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, rm, symlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { createDirectSandboxProvider } from '@hachej/boring-sandbox/providers/direct'
import type { DisposableSandboxProviderV1 } from '@hachej/boring-sandbox/shared'

const execFileAsync = promisify(execFile)

/** Untracked dependency roots that are linked (never copied) into a snapshot so tests can resolve packages. */
const LINKED_DEPENDENCY_ROOTS = ['node_modules'] as const

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/**
 * Snapshot the exact committed HEAD of `sourceRoot` into `targetRoot`.
 * Only tracked content at that SHA is materialised (a shared local clone), so
 * untracked trees such as `node_modules` are never copied; they are symlinked
 * read-through instead. Returns the snapshotted SHA.
 */
export async function snapshotCommittedHead(sourceRoot: string, targetRoot: string): Promise<string> {
  const sha = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot })).stdout.trim()
  await execFileAsync('git', ['clone', '--quiet', '--shared', '--no-checkout', sourceRoot, targetRoot])
  await execFileAsync('git', ['checkout', '--quiet', '--detach', sha], { cwd: targetRoot })
  for (const name of LINKED_DEPENDENCY_ROOTS) {
    const source = resolve(sourceRoot, name)
    if (await exists(source)) await symlink(source, resolve(targetRoot, name), 'dir')
  }
  return sha
}

/**
 * Local-only disposable provider for deterministic Factory dogfood runs.
 * Each lease is an exact-SHA snapshot of the shared epic worktree's committed
 * HEAD; uncommitted edits and untracked trees never enter the sandbox, and the
 * sandbox filesystem never flows back. It proves lease routing and exact-SHA
 * isolation, not security confinement.
 */
export function createLocalDisposableProvider(seedRoot: string): DisposableSandboxProviderV1 {
  const direct = createDirectSandboxProvider()
  return {
    ...direct,
    async create(context) {
      await snapshotCommittedHead(seedRoot, context.workspaceRoot)
      const pair = await direct.create(context)
      let disposed = false
      return {
        ...pair,
        async dispose() {
          if (disposed) return
          disposed = true
          try {
            await pair.dispose()
          } finally {
            await rm(context.workspaceRoot, { recursive: true, force: true })
          }
        },
      }
    },
    disposableProfile: {
      contractVersion: 'boring-sandbox.disposable-provider.v1',
      resume: false,
      publishedCleanupOwner: 'returned-pair',
      ambiguousCreate: 'correlated-reconciliation',
      providerConfigDigest: digest(`factory-playground-local-exact-sha:${seedRoot}`),
    },
  }
}
