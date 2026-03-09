/**
 * Auto-sync engine for git-backed workspaces.
 *
 * Provider-agnostic: works with any GitProvider that implements write ops
 * (init, add, commit, push, pull). Polls git status every `intervalMs` and
 * commits + pushes when dirty files are found.
 *
 * @module providers/data/autoSync
 */

/**
 * @typedef {'idle'|'syncing'|'error'|'conflict'|'disabled'} SyncState
 */

/**
 * @typedef {Object} AutoSyncEngine
 * @property {() => void} start - Start the sync loop.
 * @property {() => void} stop  - Stop the sync loop.
 * @property {() => void} syncNow - Trigger an immediate sync cycle.
 * @property {() => SyncState} getState - Current sync state.
 * @property {() => string|null} getLastError - Last error message (if any).
 * @property {() => number} getLastSyncTimestamp - Epoch ms of last successful sync.
 * @property {(fn: (state: SyncState, error?: string) => void) => () => void} onStateChange
 *   Subscribe to state changes. Returns unsubscribe function.
 */

/**
 * Run a sync cycle: status → add → commit → (pull → push).
 *
 * Shared logic used by both the auto-sync engine and useGitSync.
 *
 * @param {import('./types').GitProvider} gitProvider
 * @param {object} opts
 * @param {import('./types').GitAuthor} [opts.author]
 * @param {string} [opts.message]
 * @param {import('./types').GitRemoteOpts} [opts.remoteOpts]
 * @param {boolean} [opts.pushEnabled]
 * @param {boolean} [opts.pullBeforePush]
 * @param {boolean} [opts.autoInit]
 * @returns {Promise<{ skipped?: boolean, oid?: string, filesCount?: number, pushError?: string }>}
 */
export const performSyncCycle = async (gitProvider, opts = {}) => {
  const {
    author = { name: 'Boring UI', email: 'auto@boring.ui' },
    message,
    remoteOpts = {},
    pushEnabled = false,
    pullBeforePush = true,
    autoInit = true,
  } = opts

  // 1. Check if repo exists; auto-init if needed
  const status = await gitProvider.status()
  if (!status.is_repo) {
    if (autoInit && typeof gitProvider.init === 'function') {
      await gitProvider.init()
      const fresh = await gitProvider.status()
      if (!fresh.files || fresh.files.length === 0) {
        return { skipped: true }
      }
    } else {
      return { skipped: true }
    }
  }

  // 2. Get dirty files
  const { files = [] } = status.is_repo ? await gitProvider.status() : { files: [] }
  const dirty = files.filter((f) => f.status && f.status !== 'C')
  const conflicts = files.filter((f) => f.status === 'C')

  if (conflicts.length > 0) {
    throw Object.assign(new Error(`${conflicts.length} conflicted file(s)`), { isConflict: true })
  }

  if (dirty.length === 0) return { skipped: true }

  // 3. Stage all dirty files
  const paths = dirty.map((f) => f.path)
  await gitProvider.add(paths)

  // 4. Commit
  const names = paths.slice(0, 5).join(', ')
  const suffix = paths.length > 5 ? `, +${paths.length - 5} more` : ''
  const msg = message || `auto: update ${names}${suffix}`
  const { oid } = await gitProvider.commit(msg, { author })

  // 5. Push (if enabled, remote ops available, and remotes configured)
  let pushError = null
  if (pushEnabled && typeof gitProvider.push === 'function') {
    // Only push if at least one remote is configured
    const remotes = typeof gitProvider.listRemotes === 'function'
      ? await gitProvider.listRemotes()
      : []
    if (remotes.length > 0) {
      // Pull first (separate error handling)
      if (pullBeforePush && typeof gitProvider.pull === 'function') {
        try {
          await gitProvider.pull({ ...remoteOpts, author })
        } catch (pullErr) {
          pushError = `Pull failed: ${pullErr.message}`
        }
      }
      // Only push if pull succeeded
      if (!pushError) {
        try {
          await gitProvider.push(remoteOpts)
        } catch (pushErr) {
          pushError = `Push failed: ${pushErr.message}`
        }
      }
    }
  }

  return { oid, filesCount: dirty.length, pushError }
}

/**
 * Create an auto-sync engine for a DataProvider.
 *
 * @param {import('./types').GitProvider} gitProvider - Git provider with write ops.
 * @param {object} [options]
 * @param {number} [options.intervalMs=10000]    - Sync interval in ms.
 * @param {import('./types').GitAuthor} [options.author] - Commit author.
 * @param {import('./types').GitRemoteOpts} [options.remoteOpts] - Push/pull options.
 * @param {boolean} [options.pushEnabled=false]  - Whether to push after commit.
 * @param {boolean} [options.pullBeforePush=true] - Pull before pushing.
 * @param {boolean} [options.autoInit=true]      - Auto-init git repo if missing.
 * @returns {AutoSyncEngine}
 */
export const createAutoSyncEngine = (gitProvider, options = {}) => {
  const {
    intervalMs = 10_000,
    author = { name: 'Boring UI', email: 'auto@boring.ui' },
    remoteOpts = {},
    pushEnabled = false,
    pullBeforePush = true,
    autoInit = true,
  } = options

  /** @type {SyncState} */
  let state = 'disabled'
  /** @type {string|null} */
  let lastError = null
  let lastSyncTs = 0
  let timerId = null
  let syncing = false
  const listeners = new Set()

  const setState = (next, error) => {
    const changed = state !== next || lastError !== (error || null)
    state = next
    lastError = error || null
    if (changed) {
      for (const fn of listeners) {
        try { fn(state, lastError) } catch { /* ignore */ }
      }
    }
  }

  const hasWriteOps = () =>
    typeof gitProvider.init === 'function' &&
    typeof gitProvider.add === 'function' &&
    typeof gitProvider.commit === 'function'

  /**
   * Run one sync cycle using the shared performSyncCycle.
   */
  const cycle = async () => {
    if (syncing) return
    if (!hasWriteOps()) {
      setState('error', 'GitProvider does not support write operations')
      return
    }
    syncing = true
    setState('syncing')

    try {
      const result = await performSyncCycle(gitProvider, {
        author,
        remoteOpts,
        pushEnabled,
        pullBeforePush,
        autoInit,
      })

      if (result.pushError) {
        setState('error', result.pushError)
      } else {
        setState('idle')
      }
      lastSyncTs = Date.now()
    } catch (err) {
      if (err.isConflict) {
        setState('conflict', err.message)
      } else {
        setState('error', err.message)
      }
    } finally {
      syncing = false
    }
  }

  return {
    start: () => {
      if (timerId != null) return
      setState('idle')
      // Run first cycle immediately
      cycle()
      timerId = setInterval(cycle, intervalMs)
    },

    stop: () => {
      if (timerId != null) {
        clearInterval(timerId)
        timerId = null
      }
      setState('disabled')
    },

    syncNow: () => {
      cycle()
    },

    getState: () => state,
    getLastError: () => lastError,
    getLastSyncTimestamp: () => lastSyncTs,

    onStateChange: (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
}
