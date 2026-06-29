import { readFile, stat } from 'node:fs/promises'

export interface ReadonlySkillFileStat {
  kind: 'file' | 'directory'
  size: number
  mtimeMs: number
}

export function isReadonlySkillFilePath(path: string): boolean {
  if (!path.startsWith('/')) return false
  if (path.includes('\0')) return false
  if (!path.endsWith('/SKILL.md')) return false
  // Narrow absolute-path exception: discovered pi skills may live outside the
  // workspace root (for example /root/.pi/agent/skills/... in containers).
  // Let the editor read those actual skill files, but never write/delete/move.
  return path.includes('/.pi/agent/') && path.includes('/skills/')
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
