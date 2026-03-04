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
  },
}

/**
 * JSON GET convenience.
 * @param {string} path   - API path (e.g. '/api/v1/files/list')
 * @param {Record<string, string>} [query]  - query-string params
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<any>}
 */
const fetchJson = async (path, query, opts = {}) => {
  const url = buildApiUrl(path, query)
  const res = await fetch(url, { signal: opts.signal })
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
  const headers = hasBody ? { 'Content-Type': 'application/json' } : undefined
  const res = await fetch(url, {
    method,
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
 * @returns {import('./types').DataProvider}
 */
export const createHttpProvider = () => ({
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
  },
})
