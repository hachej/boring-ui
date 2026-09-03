import { execFile } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { executeCloseEpic, lookupFactoryPrStatus, type EpicClosureDeps } from './epicClosure'
import type { DemoEntry } from './demoPlugin'

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process')
  return { ...actual, execFile: vi.fn() }
})

const mockedExecFile = vi.mocked(execFile)

afterEach(async () => {
  await rm('unused', { force: true }).catch(() => {})
  vi.restoreAllMocks()
  mockedExecFile.mockReset()
})

function createExecFileMock(script: (file: string, args: readonly string[]) => unknown | Promise<unknown>) {
  mockedExecFile.mockImplementation(((file: string, args: readonly string[], options: unknown, callback?: (...cbArgs: unknown[]) => void) => {
    const cb = typeof options === 'function' ? options : callback
    Promise.resolve(script(file, args)).then((result) => {
      const value = result as { stdout?: string; stderr?: string }
      cb?.(null, { stdout: value.stdout ?? '', stderr: value.stderr ?? '' })
    }, (error) => {
      cb?.(error as Error, { stdout: '', stderr: '' })
    })
    return {} as never
  }) as never)
}

function deps(overrides: Partial<EpicClosureDeps> = {}): EpicClosureDeps {
  return {
    workspaceRoot: 'workspace',
    epicKey: 'epic-closure',
    featureName: 'Epic Closure',
    workspaceScopeId: 'factory-playground',
    getApp: () => ({ inject: vi.fn(async () => ({ statusCode: 200, json: () => ({ isError: false }) })) }) as never,
    demoControl: { listDemos: async () => ({}), stopDemo: async () => 'stopped' },
    supervisionControl: { stopSupervision: async () => {} },
    invalidateAllSnapshotsForEpic: async () => ({ removedKeys: [] }),
    ...overrides,
  }
}

function mergedPr(overrides: Record<string, unknown> = {}) {
  return {
    number: 17,
    url: 'https://example/pr/17',
    state: 'MERGED',
    mergedAt: 'now',
    mergeCommit: { oid: 'a'.repeat(40) },
    headRefName: 'epic/epic-closure',
    headRefOid: 'a'.repeat(40),
    headRepository: { name: 'repo' },
    headRepositoryOwner: { login: 'owner' },
    isCrossRepository: false,
    ...overrides,
  }
}

describe('lookupFactoryPrStatus', () => {
  it('returns available PR details', async () => {
    createExecFileMock((file, args) => {
      expect(file).toBe('gh')
      expect(args).toEqual(['pr', 'view', 'epic/epic-closure', '--json', 'number,url,state,mergedAt,mergeCommit,headRefName,headRefOid,headRepository,headRepositoryOwner,isCrossRepository'])
      return { stdout: JSON.stringify({ number: 17, url: 'https://example.test/pr/17', state: 'MERGED', mergedAt: '2026-09-03T00:00:00Z' }) }
    })
    await expect(lookupFactoryPrStatus('workspace', 'epic/epic-closure')).resolves.toEqual({
      pr: { number: 17, url: 'https://example.test/pr/17', state: 'MERGED', mergedAt: '2026-09-03T00:00:00Z' },
      prLookup: { status: 'available' },
    })
  })

  it('classifies gh absence, not-found, and generic error without throwing', async () => {
    createExecFileMock(() => { throw Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }) })
    await expect(lookupFactoryPrStatus('workspace', 'epic/epic-closure')).resolves.toMatchObject({ pr: null, prLookup: { status: 'gh-unavailable' } })

    mockedExecFile.mockReset()
    createExecFileMock(() => { throw new Error('no pull requests found for branch') })
    await expect(lookupFactoryPrStatus('workspace', 'epic/epic-closure')).resolves.toMatchObject({ pr: null, prLookup: { status: 'not-found' } })

    mockedExecFile.mockReset()
    createExecFileMock(() => { throw new Error('boom') })
    await expect(lookupFactoryPrStatus('workspace', 'epic/epic-closure')).resolves.toEqual({ pr: null, prLookup: { status: 'error', message: 'boom' } })
  })
})

describe('executeCloseEpic', () => {
  it('rejects a non-integer prNumber, invalid cleanup, and missing session id', async () => {
    const base = deps()
    await expect(executeCloseEpic({ prNumber: '17' }, { abortSignal: new AbortController().signal, toolCallId: 'c1', sessionId: 'orch' }, base)).resolves.toMatchObject({ isError: true, details: { code: 'INVALID_INPUT' } })
    await expect(executeCloseEpic({ prNumber: 17, cleanup: 'yes' }, { abortSignal: new AbortController().signal, toolCallId: 'c1b', sessionId: 'orch' }, base)).resolves.toMatchObject({ isError: true, details: { code: 'INVALID_INPUT' } })
    await expect(executeCloseEpic({ prNumber: 17 }, { abortSignal: new AbortController().signal, toolCallId: 'c2' }, base)).resolves.toMatchObject({ isError: true, details: { code: 'INVALID_INPUT' } })
  })

  it('refuses when branch lookup is unavailable, mismatched, PR head-sha mismatched, merge-sha mismatched, not merged, cross-repo, repo mismatch, or invalid branch ref', async () => {
    createExecFileMock((file, args) => {
      if (file === 'git' && args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return { stdout: 'epic/epic-closure\n' }
      if (file === 'git' && args[0] === 'rev-parse' && args[1] === 'HEAD') return { stdout: 'a'.repeat(40) + '\n' }
      throw Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' })
    })
    await expect(executeCloseEpic({ prNumber: 17 }, { abortSignal: new AbortController().signal, toolCallId: 'c1', sessionId: 'orch' }, deps())).resolves.toMatchObject({ isError: true, details: { code: 'PR_LOOKUP_UNAVAILABLE' } })

    mockedExecFile.mockReset()
    createExecFileMock((file, args) => {
      if (file === 'git' && args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return { stdout: 'epic/epic-closure\n' }
      if (file === 'git' && args[0] === 'rev-parse' && args[1] === 'HEAD') return { stdout: 'a'.repeat(40) + '\n' }
      if (args[2] === 'epic/epic-closure') return { stdout: JSON.stringify({ number: 18, url: 'x', state: 'OPEN', mergedAt: null }) }
      return { stdout: JSON.stringify({ number: 18, url: 'x', state: 'OPEN', mergedAt: null, mergeCommit: null, headRefName: 'epic/epic-closure' }) }
    })
    await expect(executeCloseEpic({ prNumber: 17 }, { abortSignal: new AbortController().signal, toolCallId: 'c2', sessionId: 'orch' }, deps())).resolves.toMatchObject({ isError: true, details: { code: 'PR_NUMBER_MISMATCH' } })

    mockedExecFile.mockReset()
    createExecFileMock((file, args) => {
      if (file === 'git' && args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return { stdout: 'epic/epic-closure\n' }
      if (file === 'git' && args[0] === 'rev-parse' && args[1] === 'HEAD') return { stdout: 'c'.repeat(40) + '\n' }
      if (args[2] === 'epic/epic-closure') return { stdout: JSON.stringify({ number: 17, url: 'x', state: 'MERGED', mergedAt: 'now' }) }
      if (args[2] === '17') return { stdout: JSON.stringify(mergedPr({ mergeCommit: { oid: 'a'.repeat(40) }, headRefName: 'wrong-branch', headRefOid: 'c'.repeat(40) })) }
      return { stdout: JSON.stringify({ issues: [] }) }
    })
    await expect(executeCloseEpic({ prNumber: 17 }, { abortSignal: new AbortController().signal, toolCallId: 'c3', sessionId: 'orch' }, deps())).resolves.toMatchObject({ isError: true, details: { code: 'PR_HEAD_MISMATCH' } })

    mockedExecFile.mockReset()
    createExecFileMock((file, args) => {
      if (file === 'git' && args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return { stdout: 'epic/epic-closure\n' }
      if (file === 'git' && args[0] === 'rev-parse' && args[1] === 'HEAD') return { stdout: 'c'.repeat(40) + '\n' }
      if (args[2] === 'epic/epic-closure') return { stdout: JSON.stringify({ number: 17, url: 'x', state: 'MERGED', mergedAt: 'now' }) }
      if (args[2] === '17') return { stdout: JSON.stringify(mergedPr({ mergeCommit: { oid: 'c'.repeat(40) }, headRefOid: 'd'.repeat(40) })) }
      return { stdout: JSON.stringify({ issues: [] }) }
    })
    await expect(executeCloseEpic({ prNumber: 17 }, { abortSignal: new AbortController().signal, toolCallId: 'c3b', sessionId: 'orch' }, deps())).resolves.toMatchObject({ isError: true, details: { code: 'PR_HEAD_SHA_MISMATCH' } })

    mockedExecFile.mockReset()
    createExecFileMock((file, args) => {
      if (file === 'git' && args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return { stdout: 'epic/epic-closure\n' }
      if (file === 'git' && args[0] === 'rev-parse' && args[1] === 'HEAD') return { stdout: 'c'.repeat(40) + '\n' }
      if (file === 'git' && args[0] === 'remote') return { stdout: 'git@github.com:owner/repo.git\n' }
      if (args[2] === 'epic/epic-closure') return { stdout: JSON.stringify({ number: 17, url: 'x', state: 'MERGED', mergedAt: 'now' }) }
      if (args[2] === '17') return { stdout: JSON.stringify(mergedPr({ mergeCommit: { oid: 'd'.repeat(40) }, headRefOid: 'c'.repeat(40) })) }
      if (file === 'br' && args[0] === 'list') return { stdout: JSON.stringify({ issues: [{ id: 'factory-epic-closure', status: 'closed' }] }) }
      throw new Error(`unexpected ${file} ${args.join(' ')}`)
    })
    await expect(executeCloseEpic({ prNumber: 17 }, { abortSignal: new AbortController().signal, toolCallId: 'c3c', sessionId: 'orch' }, deps())).resolves.toMatchObject({ isError: false, details: { verifiedPr: { mergeCommitSha: 'd'.repeat(40) } } })

    mockedExecFile.mockReset()
    createExecFileMock((file, args) => {
      if (file === 'git' && args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return { stdout: 'epic/epic-closure\n' }
      if (file === 'git' && args[0] === 'rev-parse' && args[1] === 'HEAD') return { stdout: 'a'.repeat(40) + '\n' }
      if (args[2] === 'epic/epic-closure') return { stdout: JSON.stringify({ number: 17, url: 'x', state: 'OPEN', mergedAt: null }) }
      if (args[2] === '17') return { stdout: JSON.stringify({ ...mergedPr(), state: 'OPEN', mergedAt: null, mergeCommit: null }) }
      return { stdout: JSON.stringify({ issues: [] }) }
    })
    await expect(executeCloseEpic({ prNumber: 17 }, { abortSignal: new AbortController().signal, toolCallId: 'c4', sessionId: 'orch' }, deps())).resolves.toMatchObject({ isError: true, details: { code: 'PR_NOT_MERGED' } })

    mockedExecFile.mockReset()
    createExecFileMock((file, args) => {
      if (file === 'git' && args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return { stdout: 'epic/epic-closure\n' }
      if (file === 'git' && args[0] === 'rev-parse' && args[1] === 'HEAD') return { stdout: 'a'.repeat(40) + '\n' }
      if (file === 'gh' && args[2] === 'epic/epic-closure') return { stdout: JSON.stringify({ number: 17, url: 'x', state: 'MERGED', mergedAt: 'now' }) }
      if (file === 'gh' && args[2] === '17') return { stdout: JSON.stringify(mergedPr({ isCrossRepository: true })) }
      return { stdout: JSON.stringify({ issues: [] }) }
    })
    await expect(executeCloseEpic({ prNumber: 17 }, { abortSignal: new AbortController().signal, toolCallId: 'c4b', sessionId: 'orch' }, deps())).resolves.toMatchObject({ isError: true, details: { code: 'PR_CROSS_REPOSITORY' } })

    mockedExecFile.mockReset()
    createExecFileMock((file, args) => {
      if (file === 'git' && args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return { stdout: 'epic/epic-closure\n' }
      if (file === 'git' && args[0] === 'rev-parse' && args[1] === 'HEAD') return { stdout: 'a'.repeat(40) + '\n' }
      if (file === 'git' && args[0] === 'remote') return { stdout: 'git@github.com:other/repo.git\n' }
      if (file === 'gh' && args[2] === 'epic/epic-closure') return { stdout: JSON.stringify({ number: 17, url: 'x', state: 'MERGED', mergedAt: 'now' }) }
      if (file === 'gh' && args[2] === '17') return { stdout: JSON.stringify(mergedPr()) }
      return { stdout: JSON.stringify({ issues: [] }) }
    })
    await expect(executeCloseEpic({ prNumber: 17 }, { abortSignal: new AbortController().signal, toolCallId: 'c4c', sessionId: 'orch' }, deps())).resolves.toMatchObject({ isError: true, details: { code: 'PR_REPOSITORY_MISMATCH' } })

    mockedExecFile.mockReset()
    createExecFileMock((file, args) => {
      if (file === 'git' && args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return { stdout: '../bad\n' }
      if (file === 'git' && args[0] === 'rev-parse' && args[1] === 'HEAD') return { stdout: 'a'.repeat(40) + '\n' }
      if (file === 'git' && args[0] === 'remote') return { stdout: 'git@github.com:owner/repo.git\n' }
      if (file === 'gh' && args[2] === '../bad') return { stdout: JSON.stringify({ number: 17, url: 'x', state: 'MERGED', mergedAt: 'now' }) }
      if (file === 'gh' && args[2] === '17') return { stdout: JSON.stringify({ ...mergedPr(), headRefName: '../bad' }) }
      return { stdout: JSON.stringify({ issues: [] }) }
    })
    await expect(executeCloseEpic({ prNumber: 17 }, { abortSignal: new AbortController().signal, toolCallId: 'c4d', sessionId: 'orch' }, deps())).resolves.toMatchObject({ isError: true, details: { code: 'INVALID_BRANCH_REF' } })
  })

  it('refuses when the epic Bead is not unique', async () => {
    createExecFileMock((file, args) => {
      if (file === 'git' && args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return { stdout: 'epic/epic-closure\n' }
      if (file === 'git' && args[0] === 'rev-parse' && args[1] === 'HEAD') return { stdout: 'a'.repeat(40) + '\n' }
      if (file === 'git' && args[0] === 'remote') return { stdout: 'git@github.com:owner/repo.git\n' }
      if (file === 'gh' && args[2] === 'epic/epic-closure') return { stdout: JSON.stringify({ number: 17, url: 'x', state: 'MERGED', mergedAt: 'now' }) }
      if (file === 'gh' && args[2] === '17') return { stdout: JSON.stringify(mergedPr()) }
      return { stdout: JSON.stringify({ issues: [{ id: 'child-1', status: 'open' }] }) }
    })
    await expect(executeCloseEpic({ prNumber: 17 }, { abortSignal: new AbortController().signal, toolCallId: 'c5', sessionId: 'orch' }, deps())).resolves.toMatchObject({ isError: true, details: { code: 'EPIC_BEAD_NOT_UNIQUE' } })
  })

  it('closes child Beads after demo stop, invalidates snapshots, skips current-branch deletion, closes the epic last, and then stops supervision', async () => {
    const operations: string[] = []
    const demoEntries: Record<string, DemoEntry> = {
      demo1: { sandboxId: 'sandbox-1', url: 'https://demo', sha: 'c'.repeat(40), port: 3000, command: 'node', startedAt: 's', expiresAt: 'e', sessionId: 'orch-a' },
    }
    createExecFileMock((file, args) => {
      if (file === 'git' && args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return { stdout: 'epic/epic-closure\n' }
      if (file === 'git' && args[0] === 'rev-parse' && args[1] === 'HEAD') return { stdout: 'a'.repeat(40) + '\n' }
      if (file === 'git' && args[0] === 'remote') return { stdout: 'git@github.com:owner/repo.git\n' }
      if (file === 'git' && args[0] === 'symbolic-ref') return { stdout: 'refs/remotes/origin/main\n' }
      if (file === 'git' && args[0] === 'ls-remote') return { stdout: '' }
      if (file === 'gh' && args[2] === 'epic/epic-closure') return { stdout: JSON.stringify({ number: 17, url: 'https://example/pr/17', state: 'MERGED', mergedAt: 'now' }) }
      if (file === 'gh' && args[2] === '17') return { stdout: JSON.stringify(mergedPr()) }
      if (file === 'br' && args[0] === 'list') {
        return { stdout: JSON.stringify({ issues: [
          { id: 'factory-epic-closure', status: 'open', assignee: 'orch-a' },
          { id: 'factory-epic-closure-jgcj.1', status: 'open', assignee: 'worker-1' },
          { id: 'factory-epic-closure-jgcj.2', status: 'closed', assignee: 'worker-2' },
        ] }) }
      }
      if (file === 'br' && args[0] === 'close') {
        operations.push(`close:${args[1]}`)
        return { stdout: '' }
      }
      throw new Error(`unexpected ${file} ${args.join(' ')}`)
    })

    const result = await executeCloseEpic(
      { prNumber: 17 },
      { abortSignal: new AbortController().signal, toolCallId: 'c6', sessionId: 'orch-a' },
      deps({
        demoControl: {
          listDemos: async () => demoEntries,
          stopDemo: async (id) => { operations.push(`demo:${id}`); delete demoEntries[id]; return 'stopped' },
        },
        supervisionControl: {
          stopSupervision: async (sessionId) => { operations.push(`supervision:${sessionId}`) },
        },
        invalidateAllSnapshotsForEpic: async (stateRoot) => { operations.push(`snapshots:${stateRoot}`); return { removedKeys: ['epic-closure:a', 'epic-closure:b'] } },
      }),
    )

    expect(result.isError).toBe(false)
    expect(operations).toEqual(['demo:demo1', 'close:factory-epic-closure-jgcj.1', 'snapshots:workspace/apps/factory-playground/.factory-state', 'close:factory-epic-closure', 'supervision:orch-a'])
    expect(result.details).toMatchObject({
      overall: 'complete',
      callingSessionId: 'orch-a',
      closedBeadIds: ['factory-epic-closure-jgcj.1', 'factory-epic-closure'],
      alreadyClosedBeadIds: ['factory-epic-closure-jgcj.2'],
      workerSessionIds: ['worker-1', 'worker-2'],
      cleanup: {
        cleanupRequested: true,
        snapshotRegistry: { status: 'invalidated', removedKeys: ['epic-closure:a', 'epic-closure:b'] },
        branchDeletion: { status: 'already-absent' },
      },
      supervision: { status: 'stopped' },
    })
  })

  it('supports cleanup: false by skipping snapshots and branch deletion cleanly', async () => {
    const operations: string[] = []
    createExecFileMock((file, args) => {
      if (file === 'git' && args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return { stdout: 'epic/epic-closure\n' }
      if (file === 'git' && args[0] === 'rev-parse' && args[1] === 'HEAD') return { stdout: 'a'.repeat(40) + '\n' }
      if (file === 'git' && args[0] === 'remote') return { stdout: 'git@github.com:owner/repo.git\n' }
      if (file === 'gh' && args[2] === 'epic/epic-closure') return { stdout: JSON.stringify({ number: 17, url: 'https://example/pr/17', state: 'MERGED', mergedAt: 'now' }) }
      if (file === 'gh' && args[2] === '17') return { stdout: JSON.stringify(mergedPr()) }
      if (file === 'br' && args[0] === 'list') return { stdout: JSON.stringify({ issues: [{ id: 'factory-epic-closure', status: 'open' }] }) }
      if (file === 'br' && args[0] === 'close') { operations.push(`close:${args[1]}`); return { stdout: '' } }
      throw new Error(`unexpected ${file} ${args.join(' ')}`)
    })

    const result = await executeCloseEpic({ prNumber: 17, cleanup: false }, { abortSignal: new AbortController().signal, toolCallId: 'c6b', sessionId: 'orch-a' }, deps())
    expect(result.details).toMatchObject({
      overall: 'complete',
      cleanup: {
        cleanupRequested: false,
        snapshotRegistry: { status: 'skipped' },
        branchDeletion: { status: 'skipped', reason: 'cleanup disabled' },
      },
    })
    expect(operations).toEqual(['close:factory-epic-closure'])
  })

  it('returns partial and leaves epic/supervision untouched when snapshot cleanup fails', async () => {
    const operations: string[] = []
    createExecFileMock((file, args) => {
      if (file === 'git' && args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return { stdout: 'epic/epic-closure\n' }
      if (file === 'git' && args[0] === 'rev-parse' && args[1] === 'HEAD') return { stdout: 'a'.repeat(40) + '\n' }
      if (file === 'git' && args[0] === 'remote') return { stdout: 'git@github.com:owner/repo.git\n' }
      if (file === 'git' && args[0] === 'symbolic-ref') return { stdout: 'refs/remotes/origin/default\n' }
      if (file === 'gh' && args[2] === 'epic/epic-closure') return { stdout: JSON.stringify({ number: 17, url: 'https://example/pr/17', state: 'MERGED', mergedAt: 'now' }) }
      if (file === 'gh' && args[2] === '17') return { stdout: JSON.stringify(mergedPr()) }
      if (file === 'br' && args[0] === 'list') {
        return { stdout: JSON.stringify({ issues: [
          { id: 'factory-epic-closure', status: 'open', assignee: 'orch-a' },
          { id: 'factory-epic-closure-jgcj.1', status: 'closed', assignee: 'worker-1' },
        ] }) }
      }
      if (file === 'br' && args[0] === 'close') { operations.push(`close:${args[1]}`); return { stdout: '' } }
      throw new Error(`unexpected ${file} ${args.join(' ')}`)
    })

    const partial = await executeCloseEpic(
      { prNumber: 17 },
      { abortSignal: new AbortController().signal, toolCallId: 'c7', sessionId: 'orch-a' },
      deps({
        invalidateAllSnapshotsForEpic: async () => { throw new Error('snapshot failed') },
        supervisionControl: { stopSupervision: async (sessionId) => { operations.push(`supervision:${sessionId}`) } },
      }),
    )
    expect(partial.details).toMatchObject({
      overall: 'partial',
      code: 'CLEANUP_FAILED',
      cleanup: {
        snapshotRegistry: { status: 'failed', error: 'snapshot failed' },
        branchDeletion: { status: 'failed' },
      },
      supervision: { status: 'failed', error: 'blocked by failed cleanup' },
    })
    expect(operations).toEqual([])
  })

  it('treats already-absent remote refs as idempotent success on a non-current branch', async () => {
    createExecFileMock((file, args) => {
      if (file === 'git' && args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return { stdout: 'release/closed-epic\n' }
      if (file === 'git' && args[0] === 'rev-parse' && args[1] === 'HEAD') return { stdout: 'a'.repeat(40) + '\n' }
      if (file === 'git' && args[0] === 'remote') return { stdout: 'git@github.com:owner/repo.git\n' }
      if (file === 'git' && args[0] === 'symbolic-ref') throw new Error('no origin head')
      if (file === 'git' && args[0] === 'ls-remote') return { stdout: '' }
      if (file === 'gh' && args[2] === 'release/closed-epic') return { stdout: JSON.stringify({ number: 17, url: 'https://example/pr/17', state: 'MERGED', mergedAt: 'now' }) }
      if (file === 'gh' && args[2] === '17') return { stdout: JSON.stringify(mergedPr({ headRefName: 'release/closed-epic' })) }
      if (file === 'br' && args[0] === 'list') return { stdout: JSON.stringify({ issues: [{ id: 'factory-epic-closure', status: 'closed' }] }) }
      throw new Error(`unexpected ${file} ${args.join(' ')}`)
    })

    const result = await executeCloseEpic({ prNumber: 17 }, { abortSignal: new AbortController().signal, toolCallId: 'c8', sessionId: 'orch-a' }, deps())
    expect(result.details).toMatchObject({
      overall: 'complete',
      cleanup: {
        branchDeletion: { status: 'already-absent', branch: 'release/closed-epic' },
      },
    })
  })

  it('uses the verified PR head branch for cleanup commands and receipts, not a mutable local branch alias after verification', async () => {
    const gitCommands: string[] = []
    createExecFileMock((file, args) => {
      if (file === 'git') gitCommands.push(args.join(' '))
      if (file === 'git' && args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return { stdout: 'release/closed-epic\n' }
      if (file === 'git' && args[0] === 'rev-parse' && args[1] === 'HEAD') return { stdout: 'a'.repeat(40) + '\n' }
      if (file === 'git' && args[0] === 'remote') return { stdout: 'git@github.com:owner/repo.git\n' }
      if (file === 'git' && args[0] === 'symbolic-ref') throw new Error('no origin head')
      if (file === 'git' && args[0] === 'ls-remote') return { stdout: 'a'.repeat(40) + '\trefs/heads/release/closed-epic\n' }
      if (file === 'git' && args[0] === 'push') return { stdout: '' }
      if (file === 'gh' && args[2] === 'release/closed-epic') return { stdout: JSON.stringify({ number: 17, url: 'https://example/pr/17', state: 'MERGED', mergedAt: 'now' }) }
      if (file === 'gh' && args[2] === '17') return { stdout: JSON.stringify(mergedPr({ headRefName: 'release/closed-epic' })) }
      if (file === 'br' && args[0] === 'list') return { stdout: JSON.stringify({ issues: [{ id: 'factory-epic-closure', status: 'closed' }] }) }
      throw new Error(`unexpected ${file} ${args.join(' ')}`)
    })

    const result = await executeCloseEpic({ prNumber: 17 }, { abortSignal: new AbortController().signal, toolCallId: 'c8b', sessionId: 'orch-a' }, deps())
    expect(result.details).toMatchObject({
      overall: 'complete',
      cleanup: {
        branchDeletion: { status: 'deleted', branch: 'release/closed-epic', headRefOid: 'a'.repeat(40) },
      },
    })
    expect(gitCommands).toContain('ls-remote --heads origin release/closed-epic')
    expect(gitCommands).toContain(`push --force-with-lease=refs/heads/release/closed-epic:${'a'.repeat(40)} origin --delete release/closed-epic`)
    expect(gitCommands).not.toContain('ls-remote --heads origin local-alias')
  })

  it('returns partial and leaves epic/supervision untouched when a demo stop or child close fails, and reruns idempotently', async () => {
    const demoEntries: Record<string, DemoEntry> = {
      demo1: { sandboxId: 'sandbox-1', url: 'https://demo', sha: 'c'.repeat(40), port: 3000, command: 'node', startedAt: 's', expiresAt: 'e' },
    }
    let closeChildFails = true
    const operations: string[] = []
    createExecFileMock((file, args) => {
      if (file === 'git' && args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return { stdout: 'epic/epic-closure\n' }
      if (file === 'git' && args[0] === 'rev-parse' && args[1] === 'HEAD') return { stdout: 'a'.repeat(40) + '\n' }
      if (file === 'git' && args[0] === 'remote') return { stdout: 'git@github.com:owner/repo.git\n' }
      if (file === 'gh' && args[2] === 'epic/epic-closure') return { stdout: JSON.stringify({ number: 17, url: 'https://example/pr/17', state: 'MERGED', mergedAt: 'now' }) }
      if (file === 'gh' && args[2] === '17') return { stdout: JSON.stringify(mergedPr()) }
      if (file === 'br' && args[0] === 'list') {
        return { stdout: JSON.stringify({ issues: [
          { id: 'factory-epic-closure', status: 'open', assignee: 'orch-a' },
          { id: 'factory-epic-closure-jgcj.1', status: 'open', assignee: 'worker-1' },
        ] }) }
      }
      if (file === 'br' && args[0] === 'close') {
        operations.push(`close:${args[1]}`)
        if (args[1] === 'factory-epic-closure-jgcj.1' && closeChildFails) throw new Error('close failed')
        return { stdout: '' }
      }
      throw new Error(`unexpected ${file} ${args.join(' ')}`)
    })

    const sharedDeps = deps({
      demoControl: {
        listDemos: async () => demoEntries,
        stopDemo: async (id) => { operations.push(`demo:${id}`); delete demoEntries[id]; return 'stopped' },
      },
      supervisionControl: {
        stopSupervision: async (sessionId) => { operations.push(`supervision:${sessionId}`) },
      },
      invalidateAllSnapshotsForEpic: async (stateRoot) => { operations.push(`snapshots:${stateRoot}`); return { removedKeys: [] } },
    })

    const partial = await executeCloseEpic({ prNumber: 17 }, { abortSignal: new AbortController().signal, toolCallId: 'c9', sessionId: 'orch-a' }, sharedDeps)
    expect(partial.details).toMatchObject({ overall: 'partial', closedBeadIds: [], alreadyClosedBeadIds: [], supervision: { status: 'failed' } })
    expect(operations).toEqual(['demo:demo1', 'close:factory-epic-closure-jgcj.1'])

    closeChildFails = false
    operations.length = 0
    const rerun = await executeCloseEpic({ prNumber: 17, cleanup: false }, { abortSignal: new AbortController().signal, toolCallId: 'c10', sessionId: 'orch-a' }, sharedDeps)
    expect(rerun.details).toMatchObject({ overall: 'complete', closedBeadIds: ['factory-epic-closure-jgcj.1', 'factory-epic-closure'], supervision: { status: 'stopped' } })
    expect(operations).toEqual(['close:factory-epic-closure-jgcj.1', 'close:factory-epic-closure', 'supervision:orch-a'])
  })
})
