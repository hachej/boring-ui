import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  invalidateEpicSnapshot,
  peekEpicSnapshot,
  registryKey,
  resolveEpicSnapshot,
  sha256File,
  type ResolveEpicSnapshotOptions,
} from './snapshotRegistry'
import type { WarmSnapshotResult } from './warmSnapshot'

const execFileAsync = promisify(execFile)
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(async (root) => await rm(root, { recursive: true, force: true })))
})

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(resolve(tmpdir(), prefix))
  temporaryRoots.push(dir)
  return dir
}

async function createGitWorkspaceRoot(lockfileContent = 'lockfile-v1'): Promise<string> {
  const root = await makeTempDir('factory-registry-workspace-')
  await execFileAsync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: root })
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: root })
  await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: root })
  await execFileAsync('git', ['remote', 'add', 'origin', 'https://example.test/org/repo.git'], { cwd: root })
  await writeFile(resolve(root, 'pnpm-lock.yaml'), lockfileContent)
  await execFileAsync('git', ['add', '.'], { cwd: root })
  await execFileAsync('git', ['commit', '--quiet', '-m', 'initial'], { cwd: root })
  return root
}

const AUTH = { token: 'tok', teamId: 'team', projectId: 'proj' }

function fakeCreateSnapshot(overrides: Partial<WarmSnapshotResult> = {}) {
  let calls = 0
  const fn = vi.fn(async (): Promise<WarmSnapshotResult> => {
    calls += 1
    return {
      snapshotId: `snap_${calls}`,
      baseSha: 'deadbeef',
      lockfileSha256: 'sha256:fixed-lock-hash',
      builtAt: new Date().toISOString(),
      durationMs: 1,
      ...overrides,
    }
  })
  return fn
}

/** `git ls-remote origin <sha>` requires a real reachable remote; stub it out by monkeypatching `execFile` isn't practical here, so tests instead point `origin` at the workspace itself (a valid local git remote) and push the commit there so `ls-remote` succeeds. */
async function makeSelfOriginWorkspace(): Promise<string> {
  const bareRemote = await makeTempDir('factory-registry-bare-')
  await execFileAsync('git', ['init', '--quiet', '--bare'], { cwd: bareRemote })
  const root = await createGitWorkspaceRoot()
  await execFileAsync('git', ['remote', 'set-url', 'origin', bareRemote], { cwd: root })
  await execFileAsync('git', ['push', '-q', 'origin', 'HEAD:refs/heads/main'], { cwd: root })
  return root
}

describe('resolveEpicSnapshot', () => {
  it('builds and stores a fresh entry on a cache miss, keyed by epicKey + lockfile hash', async () => {
    const workspaceRoot = await makeSelfOriginWorkspace()
    const stateRoot = await makeTempDir('factory-registry-state-')
    const createSnapshot = fakeCreateSnapshot()

    const result = await resolveEpicSnapshot({
      epicKey: 'epic-a',
      workspaceRoot,
      stateRoot,
      auth: AUTH,
      createSnapshot,
    })

    expect(result.reused).toBe(false)
    expect(result.snapshotId).toBe('snap_1')
    expect(createSnapshot).toHaveBeenCalledTimes(1)

    const lockfileSha256 = await sha256File(resolve(workspaceRoot, 'pnpm-lock.yaml'))
    const registryPath = resolve(stateRoot, 'snapshots.json')
    const stored = JSON.parse(await readFile(registryPath, 'utf8'))
    expect(stored.entries[registryKey('epic-a', lockfileSha256)].snapshotId).toBe('snap_1')
  })

  it('reuses a cached entry with the same lockfile hash even if HEAD has advanced', async () => {
    const workspaceRoot = await makeSelfOriginWorkspace()
    const stateRoot = await makeTempDir('factory-registry-state-')
    const createSnapshot = fakeCreateSnapshot()

    const first = await resolveEpicSnapshot({ epicKey: 'epic-a', workspaceRoot, stateRoot, auth: AUTH, createSnapshot })

    // Advance HEAD without touching the lockfile, and push so ls-remote would still succeed if called.
    await writeFile(resolve(workspaceRoot, 'extra.txt'), 'more work')
    await execFileAsync('git', ['add', '.'], { cwd: workspaceRoot })
    await execFileAsync('git', ['commit', '-q', '-m', 'second commit'], { cwd: workspaceRoot })
    await execFileAsync('git', ['push', '-q', 'origin', 'HEAD:refs/heads/main'], { cwd: workspaceRoot })

    const second = await resolveEpicSnapshot({ epicKey: 'epic-a', workspaceRoot, stateRoot, auth: AUTH, createSnapshot })

    expect(second.reused).toBe(true)
    expect(second.snapshotId).toBe(first.snapshotId)
    expect(createSnapshot).toHaveBeenCalledTimes(1)
  })

  it('builds a new snapshot when the lockfile hash changes even for the same epicKey', async () => {
    const workspaceRoot = await makeSelfOriginWorkspace()
    const stateRoot = await makeTempDir('factory-registry-state-')
    const createSnapshot = fakeCreateSnapshot()

    await resolveEpicSnapshot({ epicKey: 'epic-a', workspaceRoot, stateRoot, auth: AUTH, createSnapshot })

    await writeFile(resolve(workspaceRoot, 'pnpm-lock.yaml'), 'lockfile-v2')
    await execFileAsync('git', ['add', '.'], { cwd: workspaceRoot })
    await execFileAsync('git', ['commit', '-q', '-m', 'bump lockfile'], { cwd: workspaceRoot })
    await execFileAsync('git', ['push', '-q', 'origin', 'HEAD:refs/heads/main'], { cwd: workspaceRoot })

    const second = await resolveEpicSnapshot({ epicKey: 'epic-a', workspaceRoot, stateRoot, auth: AUTH, createSnapshot })
    expect(second.reused).toBe(false)
    expect(createSnapshot).toHaveBeenCalledTimes(2)
  })

  it('rebuilds once an entry has expired', async () => {
    const workspaceRoot = await makeSelfOriginWorkspace()
    const stateRoot = await makeTempDir('factory-registry-state-')
    const createSnapshot = fakeCreateSnapshot()
    let now = Date.parse('2026-01-01T00:00:00.000Z')

    await resolveEpicSnapshot({ epicKey: 'epic-a', workspaceRoot, stateRoot, auth: AUTH, createSnapshot, now: () => now })

    // Fast-forward past the 7-day-minus-1-hour expiry.
    now += 8 * 24 * 60 * 60 * 1000
    const second = await resolveEpicSnapshot({ epicKey: 'epic-a', workspaceRoot, stateRoot, auth: AUTH, createSnapshot, now: () => now })

    expect(second.reused).toBe(false)
    expect(createSnapshot).toHaveBeenCalledTimes(2)
  })

  it('single-flights concurrent callers for the same key into one snapshot build', async () => {
    const workspaceRoot = await makeSelfOriginWorkspace()
    const stateRoot = await makeTempDir('factory-registry-state-')
    // Real fs/git I/O in resolveEpicSnapshot's path before createSnapshot is
    // reached takes real (if short) time, so two calls fired back-to-back
    // (no await between them) both land inside the same window regardless
    // of exactly how long createSnapshot itself takes — no manual timing
    // control needed to exercise the single-flight path.
    const createSnapshot = fakeCreateSnapshot({ snapshotId: 'snap_concurrent' })

    const options: ResolveEpicSnapshotOptions = { epicKey: 'epic-a', workspaceRoot, stateRoot, auth: AUTH, createSnapshot }
    const callA = resolveEpicSnapshot(options)
    const callB = resolveEpicSnapshot(options)

    const [resultA, resultB] = await Promise.all([callA, callB])
    expect(createSnapshot).toHaveBeenCalledTimes(1)
    expect(resultA.snapshotId).toBe('snap_concurrent')
    expect(resultB.snapshotId).toBe('snap_concurrent')
  })

  it('throws a clear error when HEAD is not reachable on origin', async () => {
    const workspaceRoot = await createGitWorkspaceRoot() // origin points at a fake, never-pushed URL
    const stateRoot = await makeTempDir('factory-registry-state-')
    const createSnapshot = fakeCreateSnapshot()

    await expect(resolveEpicSnapshot({ epicKey: 'epic-a', workspaceRoot, stateRoot, auth: AUTH, createSnapshot }))
      .rejects.toThrow(/push the epic branch first/)
    expect(createSnapshot).not.toHaveBeenCalled()
  })
})

describe('peekEpicSnapshot / invalidateEpicSnapshot', () => {
  it('peeks the most recently built entry for an epicKey without triggering a build', async () => {
    const workspaceRoot = await makeSelfOriginWorkspace()
    const stateRoot = await makeTempDir('factory-registry-state-')
    expect(await peekEpicSnapshot(stateRoot, 'epic-a')).toBeUndefined()

    const createSnapshot = fakeCreateSnapshot()
    const built = await resolveEpicSnapshot({ epicKey: 'epic-a', workspaceRoot, stateRoot, auth: AUTH, createSnapshot })

    const peeked = await peekEpicSnapshot(stateRoot, 'epic-a')
    expect(peeked?.snapshotId).toBe(built.snapshotId)
  })

  it('invalidating an entry makes the next resolve rebuild', async () => {
    const workspaceRoot = await makeSelfOriginWorkspace()
    const stateRoot = await makeTempDir('factory-registry-state-')
    const createSnapshot = fakeCreateSnapshot()

    const first = await resolveEpicSnapshot({ epicKey: 'epic-a', workspaceRoot, stateRoot, auth: AUTH, createSnapshot })
    await invalidateEpicSnapshot(stateRoot, 'epic-a', first.lockfileSha256)

    const second = await resolveEpicSnapshot({ epicKey: 'epic-a', workspaceRoot, stateRoot, auth: AUTH, createSnapshot })
    expect(second.reused).toBe(false)
    expect(createSnapshot).toHaveBeenCalledTimes(2)
  })
})
