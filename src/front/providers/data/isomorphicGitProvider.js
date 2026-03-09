/**
 * Isomorphic-git-backed DataProvider (git only).
 *
 * Implements the GitProvider contract from types.js using
 * isomorphic-git + the shared LightningFS instance.
 *
 * @module providers/data/isomorphicGitProvider
 */
import git from 'isomorphic-git'
import { fs, pfs } from './lightningFs.js'

const throwIfAborted = (signal) => {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
}

const joinPath = (baseDir, relativePath) => {
  const base = String(baseDir || '/').replace(/\/+$/, '') || '/'
  const rel = String(relativePath || '').replace(/^\/+/, '')
  if (!rel) return base
  return base === '/' ? `/${rel}` : `${base}/${rel}`
}

const simpleDiff = (oldText, newText, path) => {
  if (oldText === newText) return ''
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  const lines = [`--- a/${path}`, `+++ b/${path}`]
  lines.push(`@@ -1,${oldLines.length} +1,${newLines.length} @@`)
  for (const line of oldLines) lines.push(`-${line}`)
  for (const line of newLines) lines.push(`+${line}`)
  return lines.join('\n')
}

/** @param {number} head @param {number} workdir @param {number} stage */
const normalizeStatus = (head, workdir, stage) => {
  if (head === 0 && workdir === 2 && stage === 0) return 'U'
  if (head === 0 && workdir === 2 && (stage === 2 || stage === 3)) return 'A'
  if (head === 1 && workdir === 0) return 'D'
  if (head === 1 && workdir === 1 && stage === 1) return null
  if (head === 1 && workdir === 2) return 'M'
  if (head === 1 && workdir === 1 && (stage === 2 || stage === 3)) return 'M'
  // Fallback to modified when matrix state doesn't map cleanly.
  return 'M'
}

/**
 * Default author used for auto-commits when none is configured.
 */
const DEFAULT_AUTHOR = { name: 'Boring UI', email: 'auto@boring.ui' }

/**
 * Create an isomorphic-git-backed GitProvider.
 *
 * @param {{ fs?: any, pfs?: any, dir?: string }} [opts]
 * @returns {import('./types').GitProvider}
 */
export const createIsomorphicGitProvider = (opts = {}) => {
  const fsApi = opts.fs || fs
  const fsPromises = opts.pfs || pfs
  const dir = String(opts.dir || '/')
  const gitOpts = { fs: fsApi, dir }

  const isGitRepo = async () => {
    try {
      await fsPromises.stat(joinPath(dir, '.git'))
      return true
    } catch {
      return false
    }
  }

  return {
    // -----------------------------------------------------------------------
    // Read operations
    // -----------------------------------------------------------------------

    status: async (statusOpts = {}) => {
      throwIfAborted(statusOpts.signal)

      if (!(await isGitRepo())) {
        return { available: true, is_repo: false, files: [] }
      }

      const matrix = await git.statusMatrix(gitOpts)
      throwIfAborted(statusOpts.signal)

      const files = []
      for (const [path, head, workdir, stage] of matrix) {
        const status = normalizeStatus(head, workdir, stage)
        if (!status) continue
        files.push({ path, status })
      }

      return { available: true, is_repo: true, files }
    },

    diff: async (path, diffOpts = {}) => {
      throwIfAborted(diffOpts.signal)
      if (!(await isGitRepo())) return ''

      const repoPath = String(path || '').replace(/^\//, '')

      let currentContent = ''
      try {
        const next = await fsPromises.readFile(joinPath(dir, repoPath), { encoding: 'utf8' })
        currentContent = typeof next === 'string' ? next : String(next || '')
      } catch {
        currentContent = ''
      }

      let headContent = ''
      try {
        const oid = await git.resolveRef({ ...gitOpts, ref: 'HEAD' })
        const { blob } = await git.readBlob({ ...gitOpts, oid, filepath: repoPath })
        headContent = new TextDecoder().decode(blob)
      } catch {
        headContent = ''
      }

      throwIfAborted(diffOpts.signal)
      return simpleDiff(headContent, currentContent, repoPath)
    },

    show: async (path, showOpts = {}) => {
      throwIfAborted(showOpts.signal)
      if (!(await isGitRepo())) return ''

      const repoPath = String(path || '').replace(/^\//, '')
      try {
        const oid = await git.resolveRef({ ...gitOpts, ref: 'HEAD' })
        const { blob } = await git.readBlob({ ...gitOpts, oid, filepath: repoPath })
        throwIfAborted(showOpts.signal)
        return new TextDecoder().decode(blob)
      } catch {
        return ''
      }
    },

    // -----------------------------------------------------------------------
    // Write operations
    // -----------------------------------------------------------------------

    init: async (initOpts = {}) => {
      throwIfAborted(initOpts.signal)
      await git.init(gitOpts)
    },

    add: async (paths, addOpts = {}) => {
      throwIfAborted(addOpts.signal)
      if (!paths || paths.length === 0) return
      for (const filepath of paths) {
        throwIfAborted(addOpts.signal)
        const rel = String(filepath).replace(/^\//, '')
        // Check if file was deleted — use remove instead of add
        try {
          await fsPromises.stat(joinPath(dir, rel))
          await git.add({ ...gitOpts, filepath: rel })
        } catch {
          await git.remove({ ...gitOpts, filepath: rel })
        }
      }
    },

    commit: async (message, commitOpts = {}) => {
      throwIfAborted(commitOpts.signal)
      const author = commitOpts.author || DEFAULT_AUTHOR
      const oid = await git.commit({ ...gitOpts, message, author })
      return { oid }
    },

    push: async (pushOpts = {}) => {
      throwIfAborted(pushOpts.signal)
      const pushArgs = {
        ...gitOpts,
        remote: pushOpts.remote || 'origin',
        corsProxy: pushOpts.corsProxy,
        onAuth: pushOpts.onAuth,
      }
      if (pushOpts.branch) pushArgs.ref = pushOpts.branch
      await git.push(pushArgs)
    },

    pull: async (pullOpts = {}) => {
      throwIfAborted(pullOpts.signal)
      const author = pullOpts.author || DEFAULT_AUTHOR
      const pullArgs = {
        ...gitOpts,
        remote: pullOpts.remote || 'origin',
        corsProxy: pullOpts.corsProxy,
        onAuth: pullOpts.onAuth,
        author,
        singleBranch: true,
      }
      if (pullOpts.branch) pullArgs.ref = pullOpts.branch
      await git.pull(pullArgs)
    },

    clone: async (url, cloneOpts = {}) => {
      throwIfAborted(cloneOpts.signal)
      await git.clone({
        ...gitOpts,
        url,
        ref: cloneOpts.branch,
        singleBranch: true,
        depth: 1,
        corsProxy: cloneOpts.corsProxy,
        onAuth: cloneOpts.onAuth,
      })
    },

    addRemote: async (name, url, remoteOpts = {}) => {
      throwIfAborted(remoteOpts.signal)
      // Remove existing remote with same name (if any) before adding
      try {
        await git.deleteRemote({ ...gitOpts, remote: name })
      } catch {
        // ok — remote didn't exist
      }
      await git.addRemote({ ...gitOpts, remote: name, url })
    },

    listRemotes: async (remoteOpts = {}) => {
      throwIfAborted(remoteOpts.signal)
      if (!(await isGitRepo())) return []
      return git.listRemotes(gitOpts)
    },
  }
}
