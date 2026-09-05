import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { createFactoryEpicRegistry, validateFactoryEpicEntry, type FactoryEpicEntry } from './epicRegistry'

const execFileAsync = promisify(execFile)
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(async (root) => await rm(root, { recursive: true, force: true })))
})

async function fixture(): Promise<{ repositoryRoot: string; stateRoot: string; entry: FactoryEpicEntry }> {
  const repositoryRoot = await mkdtemp(resolve(tmpdir(), 'factory-registry-repo-'))
  const stateRoot = await mkdtemp(resolve(tmpdir(), 'factory-registry-state-'))
  temporaryRoots.push(repositoryRoot, stateRoot)
  await execFileAsync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: repositoryRoot })
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: repositoryRoot })
  await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: repositoryRoot })
  await writeFile(resolve(repositoryRoot, 'tracked.txt'), 'tracked')
  await execFileAsync('git', ['add', 'tracked.txt'], { cwd: repositoryRoot })
  await execFileAsync('git', ['commit', '--quiet', '-m', 'initial'], { cwd: repositoryRoot })
  const worktree = resolve(repositoryRoot, '.worktrees', 'registry-proof')
  await mkdir(resolve(repositoryRoot, '.worktrees'), { recursive: true })
  await execFileAsync('git', ['worktree', 'add', '-q', '-b', 'epic/registry-proof', worktree, 'HEAD'], { cwd: repositoryRoot })
  return {
    repositoryRoot,
    stateRoot,
    entry: {
      epicKey: 'registry-proof',
      featureName: 'Registry Proof',
      worktree,
      branch: 'epic/registry-proof',
      repositoryRoot,
      models: { orchestrator: 'openai:gpt-test' },
      createdAt: '2026-09-05T00:00:00.000Z',
      status: 'active',
    },
  }
}

describe('factory epic registry', () => {
  it('validates, atomically persists, reloads, and closes an entry', async () => {
    const { stateRoot, entry } = await fixture()
    const registry = createFactoryEpicRegistry(stateRoot)
    await expect(registry.register(entry)).resolves.toMatchObject(entry)
    await expect(registry.setOrchestratorSession(entry.epicKey, 'orch-1')).resolves.toMatchObject({ orchestratorSessionId: 'orch-1' })

    const onDisk = JSON.parse(await readFile(resolve(stateRoot, 'epics.json'), 'utf8')) as { epics: Record<string, FactoryEpicEntry> }
    expect(onDisk.epics[entry.epicKey]).toMatchObject({ epicKey: entry.epicKey, orchestratorSessionId: 'orch-1', status: 'active' })
    expect((await import('node:fs/promises')).readdir(stateRoot)).resolves.not.toEqual(expect.arrayContaining([expect.stringMatching(/\.tmp$/)]))

    const reloaded = createFactoryEpicRegistry(stateRoot)
    await expect(reloaded.load()).resolves.toEqual([expect.objectContaining({ epicKey: entry.epicKey, orchestratorSessionId: 'orch-1' })])
    await expect(reloaded.markClosed(entry.epicKey)).resolves.toMatchObject({ status: 'closed' })
  })

  it('rejects malformed keys, wrong branches, and paths outside the repository worktree set', async () => {
    const { repositoryRoot, entry } = await fixture()
    await expect(validateFactoryEpicEntry({ ...entry, epicKey: 'Not A Slug' })).rejects.toMatchObject({ code: 'INVALID_EPIC' })
    await expect(validateFactoryEpicEntry({ ...entry, branch: 'epic/wrong' })).rejects.toMatchObject({ code: 'INVALID_EPIC' })
    await expect(validateFactoryEpicEntry({ ...entry, worktree: repositoryRoot, branch: 'main' })).rejects.toMatchObject({ code: 'INVALID_EPIC' })

    const unrelatedRoot = await mkdtemp(resolve(tmpdir(), 'factory-registry-unrelated-'))
    temporaryRoots.push(unrelatedRoot)
    await execFileAsync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: unrelatedRoot })
    await expect(validateFactoryEpicEntry({ ...entry, worktree: unrelatedRoot })).rejects.toMatchObject({ code: 'INVALID_EPIC' })
    await expect(validateFactoryEpicEntry({ ...entry, repositoryRoot: entry.worktree })).rejects.toMatchObject({ code: 'INVALID_EPIC' })
    await expect(validateFactoryEpicEntry({ ...entry, repositoryRoot: resolve(repositoryRoot, '.worktrees') })).rejects.toMatchObject({ code: 'INVALID_EPIC' })
  })

  it('persists canonical paths and rejects active worktree or branch reuse', async () => {
    const { repositoryRoot, stateRoot, entry } = await fixture()
    const aliasRoot = await mkdtemp(resolve(tmpdir(), 'factory-registry-alias-'))
    temporaryRoots.push(aliasRoot)
    const repositoryAlias = resolve(aliasRoot, 'repository')
    const worktreeAlias = resolve(aliasRoot, 'worktree')
    await symlink(repositoryRoot, repositoryAlias)
    await symlink(entry.worktree, worktreeAlias)

    const registry = createFactoryEpicRegistry(stateRoot)
    await expect(registry.register({ ...entry, repositoryRoot: repositoryAlias, worktree: worktreeAlias })).resolves.toMatchObject({
      repositoryRoot,
      worktree: entry.worktree,
    })
    const persisted = JSON.parse(await readFile(resolve(stateRoot, 'epics.json'), 'utf8')) as { epics: Record<string, FactoryEpicEntry> }
    expect(persisted.epics[entry.epicKey]).toMatchObject({ repositoryRoot, worktree: entry.worktree })

    await expect(registry.register({ ...entry, epicKey: 'registry-reuse' })).rejects.toMatchObject({ code: 'EPIC_EXISTS' })

    const detachedA = resolve(repositoryRoot, '.worktrees', 'detached-a')
    const detachedB = resolve(repositoryRoot, '.worktrees', 'detached-b')
    await execFileAsync('git', ['worktree', 'add', '-q', '--detach', detachedA, 'HEAD'], { cwd: repositoryRoot })
    await execFileAsync('git', ['worktree', 'add', '-q', '--detach', detachedB, 'HEAD'], { cwd: repositoryRoot })
    const detachedEntry = {
      ...entry,
      epicKey: 'detached-a',
      featureName: 'Detached A',
      worktree: detachedA,
      branch: 'HEAD',
    }
    await expect(registry.register(detachedEntry)).resolves.toMatchObject({ epicKey: 'detached-a', branch: 'HEAD' })
    await expect(registry.register({ ...detachedEntry, epicKey: 'detached-b', featureName: 'Detached B', worktree: detachedB }))
      .rejects.toMatchObject({ code: 'EPIC_EXISTS' })
  })

  it('migrates the former launcher process entry to the host registry shape', async () => {
    const { repositoryRoot, stateRoot, entry } = await fixture()
    await writeFile(resolve(stateRoot, 'epics.json'), JSON.stringify({
      epics: {
        [entry.epicKey]: {
          epicKey: entry.epicKey,
          featureName: entry.featureName,
          workspaceRoot: entry.worktree,
          worktreeGitRoot: repositoryRoot,
          branch: entry.branch,
          apiPort: 5232,
          uiPort: 5222,
          pids: [123],
          startedAt: entry.createdAt,
        },
      },
    }))
    const registry = createFactoryEpicRegistry(stateRoot)
    await expect(registry.load()).resolves.toEqual([expect.objectContaining({
      epicKey: entry.epicKey,
      worktree: entry.worktree,
      repositoryRoot,
      status: 'active',
    })])
    const persisted = JSON.parse(await readFile(resolve(stateRoot, 'epics.json'), 'utf8')) as { epics: Record<string, Record<string, unknown>> }
    expect(persisted.epics[entry.epicKey]).not.toHaveProperty('pids')
    expect(persisted.epics[entry.epicKey]).not.toHaveProperty('apiPort')
  })
})
