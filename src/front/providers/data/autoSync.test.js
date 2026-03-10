import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createAutoSyncEngine } from './autoSync'

const createGitMock = (files = []) => ({
  status: vi.fn(async () => ({ is_repo: true, files })),
  diff: vi.fn(async () => ''),
  show: vi.fn(async () => ''),
  init: vi.fn(async () => undefined),
  add: vi.fn(async () => undefined),
  commit: vi.fn(async () => ({ oid: 'abc123' })),
  push: vi.fn(async () => undefined),
  pull: vi.fn(async () => undefined),
  listRemotes: vi.fn(async () => []),
})

describe('createAutoSyncEngine', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('starts in disabled state', () => {
    const engine = createAutoSyncEngine(createGitMock())
    expect(engine.getState()).toBe('disabled')
  })

  it('transitions to idle after start when no dirty files', async () => {
    const git = createGitMock([])
    const engine = createAutoSyncEngine(git, { intervalMs: 1000 })
    const states = []
    engine.onStateChange((s) => states.push(s))

    engine.start()
    await vi.advanceTimersByTimeAsync(0) // flush first cycle

    expect(engine.getState()).toBe('idle')
    expect(git.status).toHaveBeenCalled()
    expect(git.commit).not.toHaveBeenCalled()
    engine.stop()
  })

  it('commits dirty files on cycle', async () => {
    const git = createGitMock([
      { path: 'a.txt', status: 'M' },
      { path: 'b.txt', status: 'U' },
    ])
    // After commit, status returns clean
    git.status
      .mockResolvedValueOnce({ is_repo: true, files: [{ path: 'a.txt', status: 'M' }, { path: 'b.txt', status: 'U' }] })
      .mockResolvedValueOnce({ is_repo: true, files: [{ path: 'a.txt', status: 'M' }, { path: 'b.txt', status: 'U' }] })
    const engine = createAutoSyncEngine(git, { intervalMs: 5000 })

    engine.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(git.add).toHaveBeenCalledWith(['a.txt', 'b.txt'])
    expect(git.commit).toHaveBeenCalledWith(
      expect.stringContaining('a.txt'),
      expect.objectContaining({ author: expect.any(Object) }),
    )
    expect(engine.getState()).toBe('idle')
    engine.stop()
  })

  it('does not push when pushEnabled is false', async () => {
    const git = createGitMock([{ path: 'a.txt', status: 'M' }])
    git.status.mockResolvedValueOnce({ is_repo: true, files: [{ path: 'a.txt', status: 'M' }] })
      .mockResolvedValueOnce({ is_repo: true, files: [{ path: 'a.txt', status: 'M' }] })
    const engine = createAutoSyncEngine(git, { pushEnabled: false })

    engine.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(git.push).not.toHaveBeenCalled()
    engine.stop()
  })

  it('pushes after commit when pushEnabled is true', async () => {
    const git = createGitMock([{ path: 'a.txt', status: 'M' }])
    git.status.mockResolvedValueOnce({ is_repo: true, files: [{ path: 'a.txt', status: 'M' }] })
      .mockResolvedValueOnce({ is_repo: true, files: [{ path: 'a.txt', status: 'M' }] })
    git.listRemotes = vi.fn(async () => [{ remote: 'origin', url: 'https://github.com/test/repo' }])
    const engine = createAutoSyncEngine(git, { pushEnabled: true })

    engine.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(git.commit).toHaveBeenCalled()
    expect(git.pull).toHaveBeenCalled()
    expect(git.push).toHaveBeenCalled()
    engine.stop()
  })

  it('enters conflict state when files have status C', async () => {
    const git = createGitMock([{ path: 'a.txt', status: 'C' }])
    const engine = createAutoSyncEngine(git)

    engine.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(engine.getState()).toBe('conflict')
    expect(engine.getLastError()).toContain('1 conflicted')
    expect(git.add).not.toHaveBeenCalled()
    engine.stop()
  })

  it('auto-inits repo when not a git repo', async () => {
    const git = createGitMock()
    git.status
      .mockResolvedValueOnce({ is_repo: false, files: [] })
      .mockResolvedValueOnce({ is_repo: true, files: [] })
    const engine = createAutoSyncEngine(git, { autoInit: true })

    engine.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(git.init).toHaveBeenCalled()
    engine.stop()
  })

  it('does not auto-init when autoInit is false', async () => {
    const git = createGitMock()
    git.status.mockResolvedValue({ is_repo: false, files: [] })
    const engine = createAutoSyncEngine(git, { autoInit: false })

    engine.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(git.init).not.toHaveBeenCalled()
    expect(engine.getState()).toBe('idle')
    engine.stop()
  })

  it('enters error state on commit failure', async () => {
    const git = createGitMock([{ path: 'a.txt', status: 'M' }])
    git.status.mockResolvedValueOnce({ is_repo: true, files: [{ path: 'a.txt', status: 'M' }] })
      .mockResolvedValueOnce({ is_repo: true, files: [{ path: 'a.txt', status: 'M' }] })
    git.commit.mockRejectedValue(new Error('nothing to commit'))
    const engine = createAutoSyncEngine(git)

    engine.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(engine.getState()).toBe('error')
    expect(engine.getLastError()).toContain('nothing to commit')
    engine.stop()
  })

  it('handles push failure gracefully (commit still succeeds)', async () => {
    const git = createGitMock([{ path: 'a.txt', status: 'M' }])
    git.status.mockResolvedValueOnce({ is_repo: true, files: [{ path: 'a.txt', status: 'M' }] })
      .mockResolvedValueOnce({ is_repo: true, files: [{ path: 'a.txt', status: 'M' }] })
    git.push.mockRejectedValue(new Error('network error'))
    git.listRemotes = vi.fn(async () => [{ remote: 'origin', url: 'https://github.com/test/repo' }])
    const engine = createAutoSyncEngine(git, { pushEnabled: true })

    engine.start()
    await vi.advanceTimersByTimeAsync(0)

    // Push failed but commit succeeded — state is error with push message
    expect(engine.getState()).toBe('error')
    expect(engine.getLastError()).toContain('Push failed')
    expect(git.commit).toHaveBeenCalled()
    engine.stop()
  })

  it('runs cycles on interval', async () => {
    const git = createGitMock([])
    const engine = createAutoSyncEngine(git, { intervalMs: 5000 })

    engine.start()
    await vi.advanceTimersByTimeAsync(0) // first cycle
    const afterFirst = git.status.mock.calls.length

    await vi.advanceTimersByTimeAsync(5000)
    const afterSecond = git.status.mock.calls.length
    expect(afterSecond).toBeGreaterThan(afterFirst)

    await vi.advanceTimersByTimeAsync(5000)
    expect(git.status.mock.calls.length).toBeGreaterThan(afterSecond)

    engine.stop()
  })

  it('stop clears interval and resets to disabled', async () => {
    const git = createGitMock([])
    const engine = createAutoSyncEngine(git, { intervalMs: 1000 })

    engine.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(engine.getState()).toBe('idle')

    engine.stop()
    expect(engine.getState()).toBe('disabled')

    // No more cycles after stop
    const callCount = git.status.mock.calls.length
    await vi.advanceTimersByTimeAsync(5000)
    expect(git.status).toHaveBeenCalledTimes(callCount)
  })

  it('syncNow triggers immediate cycle', async () => {
    const git = createGitMock([])
    const engine = createAutoSyncEngine(git, { intervalMs: 60000 })

    engine.start()
    await vi.advanceTimersByTimeAsync(0) // first cycle
    const afterFirst = git.status.mock.calls.length

    engine.syncNow()
    await vi.advanceTimersByTimeAsync(0)
    expect(git.status.mock.calls.length).toBeGreaterThan(afterFirst)

    engine.stop()
  })

  it('onStateChange notifies and unsubscribe works', async () => {
    const git = createGitMock([])
    const engine = createAutoSyncEngine(git, { intervalMs: 1000 })
    const states = []
    const unsub = engine.onStateChange((s) => states.push(s))

    engine.start()
    await vi.advanceTimersByTimeAsync(0)

    unsub()
    engine.stop()

    // Should have: idle (from start), then disabled should NOT be captured
    expect(states).toContain('idle')
    expect(states).not.toContain('disabled')
  })

  it('performs initial pull when initialPull is true and remotes exist', async () => {
    const git = createGitMock([])
    git.listRemotes = vi.fn(async () => [{ remote: 'origin', url: 'https://github.com/test/repo' }])
    const engine = createAutoSyncEngine(git, { initialPull: true })

    engine.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(git.listRemotes).toHaveBeenCalled()
    expect(git.pull).toHaveBeenCalled()
    engine.stop()
  })

  it('skips initial pull when no remotes configured', async () => {
    const git = createGitMock([])
    const engine = createAutoSyncEngine(git, { initialPull: true })

    engine.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(git.listRemotes).toHaveBeenCalled()
    expect(git.pull).not.toHaveBeenCalled()
    engine.stop()
  })

  it('continues sync loop even if initial pull fails', async () => {
    const git = createGitMock([])
    git.listRemotes = vi.fn(async () => [{ remote: 'origin', url: 'https://github.com/test/repo' }])
    git.pull.mockRejectedValueOnce(new Error('network error'))
    const engine = createAutoSyncEngine(git, { initialPull: true })
    const errors = []
    engine.onStateChange((_s, err) => { if (err) errors.push(err) })

    engine.start()
    await vi.advanceTimersByTimeAsync(0)

    // Should have captured the initial pull error, even though cycle then clears it
    expect(errors.some((e) => e.includes('Initial pull failed'))).toBe(true)
    // Sync loop still runs after the error
    expect(git.status).toHaveBeenCalled()
    engine.stop()
  })

  it('commit message truncates to 5 files', async () => {
    const files = Array.from({ length: 8 }, (_, i) => ({ path: `file${i}.txt`, status: 'M' }))
    const git = createGitMock(files)
    git.status.mockResolvedValueOnce({ is_repo: true, files })
      .mockResolvedValueOnce({ is_repo: true, files })
    const engine = createAutoSyncEngine(git)

    engine.start()
    await vi.advanceTimersByTimeAsync(0)

    const commitMsg = git.commit.mock.calls[0][0]
    expect(commitMsg).toContain('+3 more')
    engine.stop()
  })
})
