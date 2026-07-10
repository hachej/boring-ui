import { readFile, stat } from 'node:fs/promises'
import { basename, normalize } from 'node:path/posix'

export interface ReadonlySkillFileStat {
  kind: 'file' | 'directory'
  size: number
  mtimeMs: number
}

export interface ReadonlySkillFileRegistry {
  replace(scope: string, paths: readonly string[]): void
  has(scope: string, path: string): boolean
  protects(scope: string, path: string): boolean
}

function normalizeRegistryPath(path: string): string | null {
  if (path.includes('\0')) return null
  return normalize(path)
}

function readonlySkillCollectionIndex(segments: string[]): number {
  const skillsIndex = segments.lastIndexOf('skills')
  if (skillsIndex < 0) return -1
  const piIndex = segments.indexOf('.pi')
  const agentsIndex = segments.indexOf('.agents')
  if (piIndex >= 0 && segments[piIndex + 1] === 'agent' && piIndex < skillsIndex) return skillsIndex
  if (agentsIndex >= 0 && agentsIndex < skillsIndex) return skillsIndex
  return -1
}

function isWithinReadonlySkillCollection(path: string): boolean {
  return readonlySkillCollectionIndex(path.split('/')) >= 0
}

function readonlySkillProtectedRoots(path: string): string[] {
  const segments = path.split('/')
  const skillsIndex = readonlySkillCollectionIndex(segments)
  if (skillsIndex < 0) {
    if (basename(path) === 'SKILL.md') {
      const skillDir = segments.slice(0, -1).join('/')
      return skillDir ? [skillDir, path] : [path]
    }
    return [path]
  }
  const roots: string[] = []
  const firstProtectedIndex = skillsIndex + 1
  if (firstProtectedIndex >= segments.length) return [path]
  for (let i = firstProtectedIndex; i < segments.length; i += 1) {
    roots.push(segments.slice(0, i + 1).join('/'))
  }
  return roots
}

export function protectsReadonlySkillPath(paths: readonly string[], path: string): boolean {
  const normalized = normalizeRegistryPath(path)
  if (normalized === null) return false
  const roots = paths.flatMap((candidate) => {
    const candidatePath = normalizeRegistryPath(candidate)
    return candidatePath ? readonlySkillProtectedRoots(candidatePath) : []
  })
  for (const root of roots) {
    if (
      !isWithinReadonlySkillCollection(normalized)
      && !normalized.startsWith(`${root}/`)
      && !root.startsWith(`${normalized}/`)
    ) {
      continue
    }
    if (
      normalized === root
      || normalized.startsWith(`${root}/`)
      || root.startsWith(`${normalized}/`)
    ) {
      return true
    }
  }
  return false
}

export function createReadonlySkillFileRegistry(maxScopes = 256): ReadonlySkillFileRegistry {
  const pathsByScope = new Map<string, Set<string>>()
  const rootsByScope = new Map<string, Set<string>>()
  return {
    replace(scope, paths) {
      pathsByScope.delete(scope)
      rootsByScope.delete(scope)
      const normalizedPaths = paths.flatMap((path) => {
        const normalized = normalizeRegistryPath(path)
        return normalized ? [normalized] : []
      })
      pathsByScope.set(scope, new Set(normalizedPaths))
      rootsByScope.set(scope, new Set(normalizedPaths.flatMap(readonlySkillProtectedRoots)))
      while (pathsByScope.size > maxScopes) {
        const oldest = pathsByScope.keys().next().value
        if (typeof oldest !== 'string') break
        pathsByScope.delete(oldest)
        rootsByScope.delete(oldest)
      }
    },
    has(scope, path) {
      const normalized = normalizeRegistryPath(path)
      return normalized !== null && pathsByScope.get(scope)?.has(normalized) === true
    },
    protects(scope, path) {
      const roots = rootsByScope.get(scope)
      if (!roots) return false
      return protectsReadonlySkillPath([...roots], path)
    },
  }
}

function safeSkillPathSegments(path: string): string[] | null {
  if (path.includes('\0')) return null
  const segments = path.split('/')
  if (segments.includes('.') || segments.includes('..')) return null
  return segments
}

export function isGeneratedReadonlySkillPath(path: string): boolean {
  if (path.startsWith('/') || path.includes('\0')) return false
  const canonical = normalize(path)
  if (canonical === '..' || canonical.startsWith('../')) return false
  const segments = canonical.split('/')
  if (segments[0] !== '.boring-agent') return false
  return segments[1] === 'skills'
    || segments[1] === 'skills-users'
    || segments[1] === 'skills-requests'
}

export function isGeneratedReadonlySkillFilePath(path: string): boolean {
  return basename(normalize(path)) === 'SKILL.md' && isGeneratedReadonlySkillPath(path)
}

export function isGeneratedReadonlySkillContainerPath(path: string): boolean {
  if (path.startsWith('/') || path.includes('\0')) return false
  return normalize(path) === '.boring-agent' || isGeneratedReadonlySkillPath(path)
}

export function isReadonlySkillFilePath(path: string): boolean {
  if (!path.startsWith('/')) return false
  if (!path.endsWith('/SKILL.md')) return false
  const segments = safeSkillPathSegments(path)
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

export async function readReadonlySkillFile(path: string): Promise<{ content: string; stat: ReadonlySkillFileStat }> {
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

export async function statReadonlySkillFile(path: string): Promise<ReadonlySkillFileStat> {
  const fsStat = await stat(path)
  return {
    kind: fsStat.isDirectory() ? 'directory' : 'file',
    size: fsStat.size,
    mtimeMs: fsStat.mtimeMs,
  }
}
