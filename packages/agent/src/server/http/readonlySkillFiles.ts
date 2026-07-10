import { readFile, stat } from 'node:fs/promises'

export interface ReadonlySkillFileStat {
  kind: 'file' | 'directory'
  size: number
  mtimeMs: number
}

export interface ReadonlySkillFileRegistry {
  replace(scope: string, paths: readonly string[]): void
  has(scope: string, path: string): boolean
}

export function createReadonlySkillFileRegistry(maxScopes = 256): ReadonlySkillFileRegistry {
  const pathsByScope = new Map<string, Set<string>>()
  return {
    replace(scope, paths) {
      pathsByScope.delete(scope)
      pathsByScope.set(scope, new Set(paths))
      while (pathsByScope.size > maxScopes) {
        const oldest = pathsByScope.keys().next().value
        if (typeof oldest !== 'string') break
        pathsByScope.delete(oldest)
      }
    },
    has(scope, path) {
      return pathsByScope.get(scope)?.has(path) === true
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
  if (path.startsWith('/')) return false
  const segments = safeSkillPathSegments(path)
  if (!segments || segments[0] !== '.boring-agent') return false
  return segments[1] === 'skills' || segments[1] === 'skills-users'
}

export function isGeneratedReadonlySkillFilePath(path: string): boolean {
  return path.endsWith('/SKILL.md') && isGeneratedReadonlySkillPath(path)
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
