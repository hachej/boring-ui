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

function safeSkillFileSegments(path: string): string[] | null {
  if (path.includes('\0') || !path.endsWith('/SKILL.md')) return null
  const segments = path.split('/')
  if (segments.includes('.') || segments.includes('..')) return null
  return segments
}

export function isGeneratedReadonlySkillFilePath(path: string): boolean {
  if (path.startsWith('/')) return false
  const segments = safeSkillFileSegments(path)
  if (!segments || segments[0] !== '.boring-agent') return false
  return segments[1] === 'skills' || segments[1] === 'skills-users'
}

export function isReadonlySkillFilePath(path: string): boolean {
  if (!path.startsWith('/')) return false
  const segments = safeSkillFileSegments(path)
  if (!segments) return false
  const skillsIndex = segments.lastIndexOf('skills')
  if (skillsIndex < 0) return false
  const piIndex = segments.indexOf('.pi')
  const agentsIndex = segments.indexOf('.agents')
  // Narrow absolute-path exceptions: discovered skills may live outside the
  // workspace under Pi's legacy .pi/agent tree or a plugin-owned .agents tree.
  // Let the editor read actual SKILL.md files there, but never mutate them.
  return (
    (piIndex >= 0 && segments[piIndex + 1] === 'agent' && piIndex < skillsIndex)
    || (agentsIndex >= 0 && agentsIndex < skillsIndex)
  )
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
