import { lstat, readFile, readdir, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { posix } from 'node:path'

import type {
  RuntimeFilesystemBinding,
  RuntimeFilesystemBindingOperations,
} from '@hachej/boring-agent/server'

import {
  READONLY_PROJECTION_BINDING_NOT_FOUND_CODE,
  READONLY_PROJECTION_INVALID_PATH_CODE,
  READONLY_PROJECTION_MUTATION_CODE,
  ReadonlyProjectionOperationError,
} from './readonlyProjectionOperations'

export interface ReadonlyMultiRootMount {
  readonly logicalRoot: string
  readonly sourceRoot: string
}

interface CanonicalMount {
  readonly logicalRoot: string
  readonly sourceRoot: string
}

function invalidPath(filesystem: string, operation: string): ReadonlyProjectionOperationError {
  return new ReadonlyProjectionOperationError(
    READONLY_PROJECTION_INVALID_PATH_CODE,
    'readonly resource path is not found or denied',
    { filesystem, path: 'not_found_or_denied', operation },
  )
}

async function redactOperationErrors<T>(
  filesystem: string,
  operation: string,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof ReadonlyProjectionOperationError) throw error
    throw invalidPath(filesystem, operation)
  }
}

function normalizeLogicalPath(path: string): string {
  if (!path || path.includes('\0') || path.includes('\\') || path.startsWith('/')) throw new Error('invalid')
  if (/%(?:2e|2f|5c)/i.test(path) || /^[a-z][a-z0-9+.-]*:/i.test(path)) throw new Error('invalid')
  const parts = path.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..')) throw new Error('invalid')
  const normalized = posix.normalize(path)
  if (normalized !== path) throw new Error('invalid')
  return normalized
}

function normalizeLogicalRoot(path: string): string {
  return normalizeLogicalPath(path.replace(/\/$/, ''))
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function logicalMatch(mount: CanonicalMount, path: string): string | undefined {
  if (path === mount.logicalRoot) return ''
  if (!path.startsWith(`${mount.logicalRoot}/`)) return undefined
  return path.slice(mount.logicalRoot.length + 1)
}

function mountForPath(
  filesystem: string,
  mounts: readonly CanonicalMount[],
  path: string,
  operation: string,
): { mount: CanonicalMount; remainder: string } {
  for (const mount of mounts) {
    const remainder = logicalMatch(mount, path)
    if (remainder !== undefined) return { mount, remainder }
  }
  throw invalidPath(filesystem, operation)
}

async function confinedTarget(
  filesystem: string,
  mount: CanonicalMount,
  remainder: string,
  operation: string,
): Promise<string> {
  const lexical = resolve(mount.sourceRoot, ...remainder.split('/').filter(Boolean))
  if (!isInside(mount.sourceRoot, lexical)) throw invalidPath(filesystem, operation)
  const canonical = await realpath(lexical).catch(() => { throw invalidPath(filesystem, operation) })
  if (!isInside(mount.sourceRoot, canonical)) throw invalidPath(filesystem, operation)
  return canonical
}

function page<T>(values: readonly T[], options?: { limit?: number; offset?: number }): T[] {
  const offset = Math.max(0, Math.trunc(options?.offset ?? 0))
  const limit = options?.limit == null ? undefined : Math.max(0, Math.trunc(options.limit))
  return limit == null ? values.slice(offset) : values.slice(offset, offset + limit)
}

function glob(pattern: string): RegExp {
  const doubleStar = '__BORING_DOUBLE_STAR__'
  const escaped = pattern
    .replace(/\*\*/g, doubleStar)
    .replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
    .replace(/\*/g, '[^/]*')
    .replaceAll(doubleStar, '.*')
  return new RegExp(`^${escaped}$`)
}

async function walkMountFiles(
  filesystem: string,
  mount: CanonicalMount,
  logicalPath: string,
  target: string,
  visited = new Set<string>(),
): Promise<Array<{ logicalPath: string; target: string }>> {
  const canonical = await realpath(target).catch(() => { throw invalidPath(filesystem, 'walk') })
  if (!isInside(mount.sourceRoot, canonical)) throw invalidPath(filesystem, 'walk')
  if (visited.has(canonical)) return []
  visited.add(canonical)

  const targetStat = await stat(canonical)
  if (targetStat.isFile()) return [{ logicalPath, target: canonical }]
  if (!targetStat.isDirectory()) return []

  const files: Array<{ logicalPath: string; target: string }> = []
  for (const entry of await readdir(canonical, { withFileTypes: true })) {
    const entryLogical = `${logicalPath}/${entry.name}`
    const entryTarget = join(canonical, entry.name)
    const entryCanonical = await realpath(entryTarget).catch(() => { throw invalidPath(filesystem, 'walk') })
    if (!isInside(mount.sourceRoot, entryCanonical)) throw invalidPath(filesystem, 'walk')
    const entryStat = await stat(entryCanonical)
    if (entryStat.isDirectory()) {
      files.push(...await walkMountFiles(filesystem, mount, entryLogical, entryCanonical, visited))
    } else if (entryStat.isFile()) {
      files.push({ logicalPath: entryLogical, target: entryCanonical })
    }
  }
  return files
}

function assertDescriptorFilesystem(
  expectedFilesystem: string,
  filesystem: string,
  path: string,
  operation: string,
): string {
  if (filesystem !== expectedFilesystem) {
    throw new ReadonlyProjectionOperationError(
      READONLY_PROJECTION_BINDING_NOT_FOUND_CODE,
      'readonly resource binding is unavailable',
      { filesystem, path: 'not_found_or_denied', operation },
    )
  }
  try {
    return normalizeLogicalPath(path)
  } catch {
    throw invalidPath(expectedFilesystem, operation)
  }
}

/**
 * Build one confined readonly binding from explicitly admitted roots. The
 * caller owns the filesystem identity; this package has no Agent value edge.
 */
export async function createAgentResourceFilesystemBinding(
  filesystem: string,
  inputMounts: readonly ReadonlyMultiRootMount[],
): Promise<RuntimeFilesystemBinding> {
  if (!filesystem) throw invalidPath('unknown', 'mount')
  const mounts: CanonicalMount[] = []
  for (const input of inputMounts) {
    let logicalRoot: string
    try {
      logicalRoot = normalizeLogicalRoot(input.logicalRoot)
    } catch {
      throw invalidPath(filesystem, 'mount')
    }
    const sourceRoot = await realpath(resolve(input.sourceRoot)).catch(() => {
      throw invalidPath(filesystem, 'mount')
    })
    if (!(await lstat(sourceRoot)).isDirectory()) throw invalidPath(filesystem, 'mount')
    if (mounts.some((mount) =>
      logicalRoot === mount.logicalRoot ||
      logicalRoot.startsWith(`${mount.logicalRoot}/`) ||
      mount.logicalRoot.startsWith(`${logicalRoot}/`)
    )) throw invalidPath(filesystem, 'mount')
    mounts.push({ logicalRoot, sourceRoot })
  }
  mounts.sort((left, right) => left.logicalRoot.localeCompare(right.logicalRoot))

  async function files(path: string, operation: string) {
    const match = mountForPath(filesystem, mounts, path, operation)
    const target = await confinedTarget(filesystem, match.mount, match.remainder, operation)
    return walkMountFiles(filesystem, match.mount, path, target)
  }

  const operations = {
    async read(descriptor) {
      return redactOperationErrors(filesystem, 'read', async () => {
        const path = assertDescriptorFilesystem(filesystem, descriptor.filesystem, descriptor.path, 'read')
        const match = mountForPath(filesystem, mounts, path, 'read')
        const target = await confinedTarget(filesystem, match.mount, match.remainder, 'read')
        const targetStat = await stat(target)
        if (!targetStat.isFile()) throw invalidPath(filesystem, 'read')
        return { content: await readFile(target, 'utf8'), mtimeMs: targetStat.mtimeMs }
      })
    },
    async list(descriptor) {
      return redactOperationErrors(filesystem, 'list', async () => {
        const path = assertDescriptorFilesystem(filesystem, descriptor.filesystem, descriptor.path, 'list')
        const match = mountForPath(filesystem, mounts, path, 'list')
        const target = await confinedTarget(filesystem, match.mount, match.remainder, 'list')
        if (!(await stat(target)).isDirectory()) throw invalidPath(filesystem, 'list')
        const entries: string[] = []
        for (const entry of await readdir(target)) {
          const canonical = await realpath(join(target, entry)).catch(() => { throw invalidPath(filesystem, 'list') })
          if (!isInside(match.mount.sourceRoot, canonical)) throw invalidPath(filesystem, 'list')
          entries.push(entry)
        }
        return { entries: entries.sort() }
      })
    },
    async find(descriptor, pattern, options) {
      return redactOperationErrors(filesystem, 'find', async () => {
        const path = assertDescriptorFilesystem(filesystem, descriptor.filesystem, descriptor.path, 'find')
        const matcher = glob(pattern)
        const paths = (await files(path, 'find'))
          .map((entry) => entry.logicalPath)
          .filter((entry) => matcher.test(entry) || matcher.test(posix.basename(entry)))
          .sort()
        return { paths: page(paths, options) }
      })
    },
    async grep(descriptor, pattern, options) {
      return redactOperationErrors(filesystem, 'grep', async () => {
        const path = assertDescriptorFilesystem(filesystem, descriptor.filesystem, descriptor.path, 'grep')
        const matches: Array<{ path: string; line: number; text: string }> = []
        for (const entry of await files(path, 'grep')) {
          const content = await readFile(entry.target, 'utf8')
          content.split('\n').forEach((text, index) => {
            if (text.includes(pattern)) matches.push({ path: entry.logicalPath, line: index + 1, text })
          })
        }
        return { matches: page(matches, options) }
      })
    },
    async stat(descriptor) {
      return redactOperationErrors(filesystem, 'stat', async () => {
        const path = assertDescriptorFilesystem(filesystem, descriptor.filesystem, descriptor.path, 'stat')
        const match = mountForPath(filesystem, mounts, path, 'stat')
        const target = await confinedTarget(filesystem, match.mount, match.remainder, 'stat')
        return { isDirectory: (await stat(target)).isDirectory() }
      })
    },
    rejectMutation(operation, descriptor): never {
      const path = assertDescriptorFilesystem(filesystem, descriptor.filesystem, descriptor.path, operation)
      mountForPath(filesystem, mounts, path, operation)
      throw new ReadonlyProjectionOperationError(
        READONLY_PROJECTION_MUTATION_CODE,
        `filesystem is readonly for ${operation}`,
        { filesystem, path: 'readonly', operation },
      )
    },
  } satisfies RuntimeFilesystemBindingOperations

  return { filesystem, access: 'readonly', operations }
}
