import { afterEach, expect, test, vi } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { __gitTestUtils, resolveGitFileUrl } from '../gitFileUrl'

const tempRoots: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function makeRoot(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempRoots.push(dir)
  return dir
}

test('returns disabled when workspace is not a git repo', async () => {
  const workspaceRoot = await makeRoot('boring-git-url-')
  await writeFile(join(workspaceRoot, 'index.ts'), 'export {}\n')

  const result = await resolveGitFileUrl(workspaceRoot, 'index.ts')
  expect(result).toEqual({ enabled: false, reason: 'Workspace is not inside a Git repository.' })
})

test('builds github urls from origin and branch', async () => {
  const workspaceRoot = await makeRoot('boring-git-url-repo-')
  await mkdir(join(workspaceRoot, 'src'), { recursive: true })
  await writeFile(join(workspaceRoot, 'src', 'main.ts'), 'export {}\n')

  vi.spyOn(__gitTestUtils, 'runGit').mockImplementation(async (args: string[]) => {
    const joined = args.join(' ')
    if (joined === 'rev-parse --show-toplevel') return workspaceRoot
    if (joined === 'remote get-url origin') return 'git@github.com:hachej/boring-ui.git'
    if (joined === 'symbolic-ref --quiet --short HEAD') return 'main'
    throw new Error(`unexpected git args: ${joined}`)
  })

  const result = await resolveGitFileUrl(workspaceRoot, 'src/main.ts')
  expect(result).toEqual({
    enabled: true,
    url: 'https://github.com/hachej/boring-ui/blob/main/src/main.ts',
  })
})

test('falls back to commit sha when HEAD is detached', async () => {
  const workspaceRoot = await makeRoot('boring-git-url-detached-')
  await writeFile(join(workspaceRoot, 'README.md'), '# hi\n')

  vi.spyOn(__gitTestUtils, 'runGit').mockImplementation(async (args: string[]) => {
    const joined = args.join(' ')
    if (joined === 'rev-parse --show-toplevel') return workspaceRoot
    if (joined === 'remote get-url origin') return 'https://github.com/hachej/boring-ui.git'
    if (joined === 'symbolic-ref --quiet --short HEAD') throw new Error('detached')
    if (joined === 'rev-parse HEAD') return 'abc123'
    throw new Error(`unexpected git args: ${joined}`)
  })

  const result = await resolveGitFileUrl(workspaceRoot, 'README.md')
  expect(result).toEqual({
    enabled: true,
    url: 'https://github.com/hachej/boring-ui/blob/abc123/README.md',
  })
})
