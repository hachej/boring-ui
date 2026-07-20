import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'

import { assertRealPathWithinWorkspace } from '../workspace/paths'

export interface ReadonlySkillFileStat {
  kind: 'file' | 'directory'
  size: number
  mtimeMs: number
}

interface ReadonlySkillConfinementError extends Error {
  statusCode: number
  reason: string
  requestedPath: string
}

export function isReadonlySkillFilePath(path: string): boolean {
  if (!path.startsWith('/')) return false
  if (path.includes('\0')) return false
  if (!path.endsWith('/SKILL.md')) return false
  // Defensive: never accept traversal segments. `resolve()` would collapse
  // them, but keeping them out means the accepted set is only literal,
  // already-normalized absolute paths — no surprising `..` rewrites.
  if (path.split('/').some((segment) => segment === '..')) return false
  // Narrow absolute-path exception: discovered pi skills may live outside the
  // workspace root (for example <agentDir>/skills/... — a shared, read-only
  // global skills location). Confinement to the caller's allowed roots is
  // enforced separately by `assertReadonlySkillFileConfined` before any read.
  return path.includes('/.pi/agent/') && path.includes('/skills/')
}

function isLexicallyInside(root: string, resolvedPath: string): boolean {
  if (!root) return false
  const rel = relative(resolve(root), resolvedPath)
  return !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * Confine a read-only skill-file path to the caller's authorized roots.
 *
 * The route bypasses the normal workspace-relative confinement so it can read
 * discovered global skills that live outside the workspace root, but that
 * bypass must never reach the whole host filesystem. `allowedRoots` is the
 * caller's workspace root plus the explicitly-shared global skills root
 * (pi's agent dir). We reuse the workspace adapter's realpath boundary check
 * (`assertRealPathWithinWorkspace`) so symlink escapes are rejected exactly
 * as they are for every other `user`-filesystem read.
 */
export async function assertReadonlySkillFileConfined(
  path: string,
  allowedRoots: readonly string[],
): Promise<void> {
  const resolved = resolve(path)
  const lexicalRoot = allowedRoots.find((root) => isLexicallyInside(root, resolved))
  if (!lexicalRoot) {
    throw Object.assign(new Error('read-only skill file escapes allowed roots'), {
      statusCode: 403,
      reason: 'path-escape',
      requestedPath: path,
    }) as ReadonlySkillConfinementError
  }
  // Realpath boundary: a symlink under an allowed root must not escape it.
  // A missing file surfaces as ENOENT here → classified as 404, matching the
  // normal `user`-fs read path.
  await assertRealPathWithinWorkspace(lexicalRoot, resolved)
}

export async function readReadonlySkillFile(
  path: string,
  allowedRoots: readonly string[],
): Promise<{ content: string; stat: ReadonlySkillFileStat }> {
  await assertReadonlySkillFileConfined(path, allowedRoots)
  const [content, fsStat] = await Promise.all([
    readFile(path, 'utf-8'),
    stat(path),
  ])
  return {
    content,
    stat: {
      kind: fsStat.isDirectory() ? 'directory' : 'file',
      size: fsStat.size,
      mtimeMs: fsStat.mtimeMs,
    },
  }
}

export async function statReadonlySkillFile(
  path: string,
  allowedRoots: readonly string[],
): Promise<ReadonlySkillFileStat> {
  await assertReadonlySkillFileConfined(path, allowedRoots)
  const fsStat = await stat(path)
  return {
    kind: fsStat.isDirectory() ? 'directory' : 'file',
    size: fsStat.size,
    mtimeMs: fsStat.mtimeMs,
  }
}
