import {
  createCheerpXRuntime,
  resolveWorkspacePath,
  shellQuote,
  toRelativeWorkspacePath,
} from './cheerpxRuntime'

const CANONICAL_GIT_CODES = new Set(['M', 'U', 'A', 'D', 'C'])

const throwIfAborted = (signal) => {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
}

const normalizePath = (path, fallback = '.') => {
  const trimmed = String(path || '').trim().replace(/^\/+/, '')
  return trimmed || fallback
}

const normalizeFilePath = (path) => {
  const normalized = normalizePath(path, '')
  if (!normalized) throw new Error('Path is required')
  return normalized
}

const normalizeStatusFromPair = (x, y) => {
  const pair = `${x}${y}`
  if (pair === '??') return 'U'
  if (pair.includes('U')) return 'C'
  if (pair.includes('D')) return 'D'
  if (pair.includes('A')) return 'A'
  if (pair.includes('C')) return 'C'
  if (pair.includes('M') || pair.includes('R') || pair.includes('T')) return 'M'
  if (pair.trim() === '') return null
  return 'C'
}

const parsePorcelainLine = (line) => {
  const raw = String(line || '').trimEnd()
  if (!raw) return null

  if (raw.startsWith('?? ')) {
    const path = raw.slice(3).trim().replace(/^"|"$/g, '')
    return path ? { path, status: 'U' } : null
  }

  if (raw.length < 4) return null
  const status = normalizeStatusFromPair(raw[0], raw[1])
  if (!status || !CANONICAL_GIT_CODES.has(status)) return null

  let path = raw.slice(3).trim()
  if (path.includes(' -> ')) path = path.split(' -> ').pop() || path
  path = path.replace(/^"|"$/g, '')
  if (!path) return null

  return { path, status }
}

const isGitRepo = async (runtime, workspaceRoot, signal) => {
  throwIfAborted(signal)
  const result = await runtime.exec(`test -d ${shellQuote(`${workspaceRoot}/.git`)}`)
  throwIfAborted(signal)
  return result.status === 0
}

const coerceCommandResult = (result) => {
  const output = typeof result?.output === 'string' ? result.output : ''
  const status = Number.isFinite(result?.status) ? Number(result.status) : -1
  return {
    exitCode: status,
    status,
    stdout: output,
    stderr: '',
    output,
    success: status === 0,
  }
}

/**
 * Create a CheerpX-backed DataProvider.
 *
 * @param {{
 *   runtime?: import('./cheerpxRuntime').CheerpXRuntime,
 *   workspaceRoot?: string,
 *   primaryDiskUrl?: string,
 *   overlayName?: string,
 *   cheerpxNamespace?: object,
 *   cheerpxLoader?: () => Promise<object>,
 *   cheerpxEsmUrl?: string,
 *   onConsole?: (chunk: string) => void
 * }} [opts]
 * @returns {import('./types').DataProvider & { runCommand: (command: string, options?: { cwd?: string }) => Promise<any>, pi: { bashOnly: true } }}
 */
export const createCheerpXDataProvider = (opts = {}) => {
  const runtime = opts.runtime || createCheerpXRuntime(opts)
  const workspaceRoot = runtime.workspaceRoot || '/workspace'

  return {
    files: {
      list: async (dir, options = {}) => {
        throwIfAborted(options.signal)
        const dirPath = normalizePath(dir)
        const listed = await runtime.listFiles(dirPath, { recursive: false })
        throwIfAborted(options.signal)
        const entries = Array.isArray(listed?.entries) ? listed.entries : []

        return entries.map((entry) => {
          const abs = resolveWorkspacePath(entry?.path || `${workspaceRoot}/${entry?.name || ''}`, workspaceRoot)
          return {
            name: String(entry?.name || toRelativeWorkspacePath(abs, workspaceRoot).split('/').pop() || ''),
            path: toRelativeWorkspacePath(abs, workspaceRoot),
            is_dir: Boolean(entry?.is_dir),
            size: Number(entry?.size || 0),
            mtime: Number(entry?.mtime || 0),
          }
        })
      },

      read: async (path, options = {}) => {
        throwIfAborted(options.signal)
        const value = await runtime.readFile(normalizeFilePath(path))
        throwIfAborted(options.signal)
        return typeof value === 'string' ? value : String(value || '')
      },

      write: async (path, content, options = {}) => {
        throwIfAborted(options.signal)
        await runtime.writeFile(normalizeFilePath(path), String(content || ''))
        throwIfAborted(options.signal)
      },

      delete: async (path, options = {}) => {
        throwIfAborted(options.signal)
        await runtime.deletePath(normalizeFilePath(path))
        throwIfAborted(options.signal)
      },

      rename: async (oldPath, newName, options = {}) => {
        throwIfAborted(options.signal)
        const sourceRel = normalizeFilePath(oldPath)
        const nextName = String(newName || '').trim()
        if (!nextName || nextName.includes('/')) {
          throw new Error('rename expects newName without path separators')
        }

        const sourceAbs = resolveWorkspacePath(sourceRel, workspaceRoot)
        const parentAbs = sourceAbs.includes('/') ? sourceAbs.slice(0, sourceAbs.lastIndexOf('/')) : workspaceRoot
        const destAbs = `${parentAbs}/${nextName}`
        const result = await runtime.exec(`mv -- ${shellQuote(sourceAbs)} ${shellQuote(destAbs)}`)
        throwIfAborted(options.signal)
        if (result.status !== 0) {
          throw new Error(result.output || `rename failed with status ${result.status}`)
        }
      },

      move: async (srcPath, destPath, options = {}) => {
        throwIfAborted(options.signal)
        const sourceRel = normalizeFilePath(srcPath)
        const destRel = normalizePath(destPath)
        const sourceAbs = resolveWorkspacePath(sourceRel, workspaceRoot)
        const destAbs = resolveWorkspacePath(destRel, workspaceRoot)
        const fileName = sourceAbs.split('/').filter(Boolean).pop()
        if (!fileName) throw new Error('Invalid source path')

        const targetAbs = `${destAbs}/${fileName}`
        const command = [
          `mkdir -p -- ${shellQuote(destAbs)}`,
          `mv -- ${shellQuote(sourceAbs)} ${shellQuote(targetAbs)}`,
        ].join(' && ')

        const result = await runtime.exec(command)
        throwIfAborted(options.signal)
        if (result.status !== 0) {
          throw new Error(result.output || `move failed with status ${result.status}`)
        }
      },

      search: async (query, options = {}) => {
        throwIfAborted(options.signal)
        const needle = String(query || '').trim().toLowerCase()
        if (!needle) return []

        const listed = await runtime.listFiles('.', { recursive: true })
        throwIfAborted(options.signal)
        const entries = Array.isArray(listed?.entries) ? listed.entries : []
        const matches = []

        for (const entry of entries) {
          throwIfAborted(options.signal)
          const abs = resolveWorkspacePath(entry?.path || `${workspaceRoot}/${entry?.name || ''}`, workspaceRoot)
          const relative = toRelativeWorkspacePath(abs, workspaceRoot)
          const haystack = `${relative}\n${String(entry?.name || '')}`.toLowerCase()
          if (!haystack.includes(needle)) continue
          matches.push({
            path: relative,
            name: String(entry?.name || relative.split('/').pop() || ''),
            is_dir: Boolean(entry?.is_dir),
          })
        }

        return matches
      },
    },

    git: {
      status: async (options = {}) => {
        throwIfAborted(options.signal)
        if (!(await isGitRepo(runtime, workspaceRoot, options.signal))) {
          return { available: true, is_repo: false, files: [] }
        }

        const result = await runtime.exec(`/usr/bin/git -C ${shellQuote(workspaceRoot)} status --porcelain`)
        throwIfAborted(options.signal)
        if (result.status !== 0) {
          throw new Error(result.output || `git status failed with status ${result.status}`)
        }

        const files = String(result.output || '')
          .split(/\r?\n/)
          .map(parsePorcelainLine)
          .filter(Boolean)

        return { available: true, is_repo: true, files }
      },

      diff: async (path, options = {}) => {
        throwIfAborted(options.signal)
        if (!(await isGitRepo(runtime, workspaceRoot, options.signal))) return ''

        const filePath = normalizeFilePath(path)
        const result = await runtime.exec(
          `/usr/bin/git -C ${shellQuote(workspaceRoot)} diff -- ${shellQuote(filePath)}`,
        )
        throwIfAborted(options.signal)
        if (result.status !== 0) {
          throw new Error(result.output || `git diff failed with status ${result.status}`)
        }
        return String(result.output || '')
      },

      show: async (path, options = {}) => {
        throwIfAborted(options.signal)
        if (!(await isGitRepo(runtime, workspaceRoot, options.signal))) return ''

        const filePath = normalizeFilePath(path)
        const result = await runtime.exec(
          `/usr/bin/git -C ${shellQuote(workspaceRoot)} show ${shellQuote(`HEAD:${filePath}`)}`,
        )
        throwIfAborted(options.signal)
        if (result.status !== 0) return ''
        return String(result.output || '')
      },
    },

    runCommand: async (command, options = {}) => {
      const cmd = String(command || '').trim()
      if (!cmd) throw new Error('command is required')
      const cwd = normalizePath(options?.cwd)
      const result = await runtime.exec(cmd, { cwd, stream: Boolean(options?.stream) })
      return coerceCommandResult(result)
    },

    // PI should expose only exec_bash for this backend.
    pi: {
      bashOnly: true,
    },
  }
}

