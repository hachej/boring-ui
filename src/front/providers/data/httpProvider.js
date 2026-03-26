import { buildApiUrl } from '../../utils/apiBase'

/**
 * HTTP-backed DataProvider.
 *
 * URL patterns are inlined here (not imported from routes.js) so this module
 * is independent of the central route registry. When Phase 6 removes
 * routes.files / routes.git from routes.js, this file is unaffected.
 */

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

const API = {
  exec: '/api/v1/exec',
  files: {
    list: '/api/v1/files/list',
    read: '/api/v1/files/read',
    write: '/api/v1/files/write',
    delete: '/api/v1/files/delete',
    rename: '/api/v1/files/rename',
    move: '/api/v1/files/move',
    search: '/api/v1/files/search',
  },
  git: {
    status: '/api/v1/git/status',
    diff: '/api/v1/git/diff',
    show: '/api/v1/git/show',
    init: '/api/v1/git/init',
    add: '/api/v1/git/add',
    commit: '/api/v1/git/commit',
    push: '/api/v1/git/push',
    pull: '/api/v1/git/pull',
    clone: '/api/v1/git/clone',
    remote: '/api/v1/git/remote',
    remotes: '/api/v1/git/remotes',
    branches: '/api/v1/git/branches',
    branch: '/api/v1/git/branch',
    checkout: '/api/v1/git/checkout',
    merge: '/api/v1/git/merge',
  },
}

/**
 * JSON GET convenience.
 * @param {string} path   - API path (e.g. '/api/v1/files/list')
 * @param {Record<string, string>} [query]  - query-string params
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<any>}
 */
/** @type {Record<string, string>} Extra headers injected on every request. */
let _extraHeaders = {}

const fetchJson = async (path, query, opts = {}) => {
  const url = buildApiUrl(path, query)
  const res = await fetch(url, {
    credentials: 'include',
    signal: opts.signal,
    headers: _extraHeaders,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}: ${text || res.statusText} (${path})`)
  }
  return res.json()
}

/**
 * JSON mutation convenience.
 */
const sendJson = async (method, path, query, body, opts = {}) => {
  const url = buildApiUrl(path, query)
  const hasBody = body !== undefined
  const headers = { ..._extraHeaders, ...(hasBody ? { 'Content-Type': 'application/json' } : {}) }
  const res = await fetch(url, {
    method,
    credentials: 'include',
    headers,
    body: hasBody ? JSON.stringify(body) : undefined,
    signal: opts.signal,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}: ${text || res.statusText} (${path})`)
  }
  // Some endpoints return empty 200/204
  const ct = res.headers?.get?.('content-type') || 'application/json'
  if (ct.includes('application/json')) return res.json()
  return undefined
}

// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------

/**
 * Create the default HTTP-backed DataProvider.
 * @param {{ workspaceId?: string }} [options]
 * @returns {import('./types').DataProvider}
 */
export const createHttpProvider = (options = {}) => {
  if (options.workspaceId) {
    _extraHeaders = { 'x-workspace-id': options.workspaceId }
  }
  return ({
  github: {
    status: (workspaceId, opts) =>
      fetchJson('/api/v1/auth/github/status', { workspace_id: workspaceId }, opts),

    authorize: () =>
      fetchJson('/api/v1/auth/github/authorize'),

    callback: (code, state, opts) =>
      fetchJson('/api/v1/auth/github/callback', { code, state }, opts),

    connect: (workspaceId, installationId, opts) =>
      sendJson('POST', '/api/v1/auth/github/connect', undefined, {
        workspace_id: workspaceId,
        installation_id: installationId,
      }, opts),

    disconnect: (workspaceId, opts) =>
      sendJson('POST', '/api/v1/auth/github/disconnect', undefined, {
        workspace_id: workspaceId,
      }, opts),

    installations: (opts) =>
      fetchJson('/api/v1/auth/github/installations', undefined, opts),

    repos: (installationId, opts) =>
      fetchJson('/api/v1/auth/github/repos', { installation_id: installationId }, opts),

    gitCredentials: async (workspaceId, opts) => {
      const data = await fetchJson('/api/v1/auth/github/git-credentials', {
        workspace_id: workspaceId,
      }, opts)
      return { username: data?.username, password: data?.password }
    },
  },

  files: {
    list: async (dir, opts) => {
      const data = await fetchJson(API.files.list, { path: dir }, opts)
      return Array.isArray(data?.entries) ? data.entries : []
    },

    read: async (path, opts) => {
      const data = await fetchJson(API.files.read, { path }, opts)
      return typeof data?.content === 'string' ? data.content : ''
    },

    write: (path, content, opts) =>
      sendJson('PUT', API.files.write, { path }, { content }, opts),

    delete: (path, opts) =>
      sendJson('DELETE', API.files.delete, { path }, undefined, opts),

    rename: (oldPath, newName, opts) => {
      const parentDir = oldPath.includes('/') ? oldPath.substring(0, oldPath.lastIndexOf('/')) : ''
      const newPath = parentDir ? `${parentDir}/${newName}` : newName
      return sendJson('POST', API.files.rename, undefined, { old_path: oldPath, new_path: newPath }, opts)
    },

    move: (srcPath, destPath, opts) =>
      sendJson('POST', API.files.move, undefined, { src_path: srcPath, dest_dir: destPath }, opts),

    search: async (query, opts) => {
      const data = await fetchJson(API.files.search, { q: query }, opts)
      return Array.isArray(data?.results) ? data.results : []
    },
  },

  git: {
    status: (opts) =>
      fetchJson(API.git.status, undefined, opts),

    diff: async (path, opts) => {
      const data = await fetchJson(API.git.diff, { path }, opts)
      return typeof data?.diff === 'string' ? data.diff : ''
    },

    show: async (path, opts) => {
      const data = await fetchJson(API.git.show, { path }, opts)
      return typeof data?.content === 'string' ? data.content : ''
    },

    init: (opts) =>
      sendJson('POST', API.git.init, undefined, undefined, opts),

    add: (paths, opts) =>
      sendJson('POST', API.git.add, undefined, { paths }, opts),

    commit: async (message, opts) => {
      const data = await sendJson('POST', API.git.commit, undefined, {
        message,
        author: opts?.author,
      }, opts)
      return { oid: data?.oid || '' }
    },

    push: (opts) =>
      sendJson('POST', API.git.push, undefined, {
        remote: opts?.remote,
        branch: opts?.branch,
      }, opts),

    pull: (opts) =>
      sendJson('POST', API.git.pull, undefined, {
        remote: opts?.remote,
        branch: opts?.branch,
      }, opts),

    clone: (url, opts) =>
      sendJson('POST', API.git.clone, undefined, {
        url,
        branch: opts?.branch,
      }, opts),

    addRemote: (name, url, opts) =>
      sendJson('POST', API.git.remote, undefined, { name, url }, opts),

    listRemotes: async (opts) => {
      const data = await fetchJson(API.git.remotes, undefined, opts)
      return Array.isArray(data?.remotes) ? data.remotes : []
    },

    branches: async (opts) => {
      const data = await fetchJson(API.git.branches, undefined, opts)
      return { branches: data?.branches || [], current: data?.current || null }
    },

    currentBranch: async (opts) => {
      const data = await fetchJson(API.git.branch, undefined, opts)
      return data?.branch || null
    },

    createBranch: (name, checkout = true, opts) =>
      sendJson('POST', API.git.branch, undefined, { name, checkout }, opts),

    checkout: (name, opts) =>
      sendJson('POST', API.git.checkout, undefined, { name }, opts),

    merge: (source, message, opts) =>
      sendJson('POST', API.git.merge, undefined, { source, message }, opts),
  },

  runCommand: async (command, options = {}) => {
    const cwd = options?.cwd !== undefined ? String(options.cwd) : undefined
    const data = await sendJson('POST', API.exec, undefined, { command, cwd })
    return {
      stdout: data?.stdout || '',
      stderr: data?.stderr || '',
      exitCode: data?.exit_code ?? 0,
    }
  },
})}
