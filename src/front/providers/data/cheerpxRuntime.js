const DEFAULT_PRIMARY_DISK_URL = 'wss://disks.webvm.io/alpine_20251007.ext2'
const DEFAULT_OVERLAY_NAME = 'boring-ui-cheerpx-overlay'
const DEFAULT_WORKSPACE_ROOT = '/workspace'
const DEFAULT_CHEERPX_ESM_URL = 'https://cdn.jsdelivr.net/npm/@leaningtech/cheerpx/+esm'
const DEFAULT_ENV = [
  'HOME=/home/user',
  'USER=user',
  'SHELL=/bin/bash',
  'EDITOR=vim',
  'LANG=C.UTF-8',
  'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
]

const JSON_START_MARKER = '__BORING_UI_CHEERPX_JSON_START__'
const JSON_END_MARKER = '__BORING_UI_CHEERPX_JSON_END__'

const normalizeUnixPath = (input) => {
  const segments = []
  for (const segment of String(input || '').split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (segments.length > 0) segments.pop()
      continue
    }
    segments.push(segment)
  }
  return `/${segments.join('/')}`
}

export const shellQuote = (value) => `'${String(value).replace(/'/g, `'"'"'`)}'`

export const utf8ToBase64 = (text) => {
  const bytes = new TextEncoder().encode(String(text || ''))
  const bufferCtor = typeof globalThis !== 'undefined' ? globalThis.Buffer : undefined
  if (typeof btoa !== 'function' && bufferCtor) {
    return bufferCtor.from(bytes).toString('base64')
  }
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

const resolveCheerpXNamespace = (maybeModule) => {
  if (!maybeModule) return null
  if (maybeModule.Linux && maybeModule.CloudDevice && maybeModule.IDBDevice) return maybeModule
  if (maybeModule.default?.Linux && maybeModule.default?.CloudDevice && maybeModule.default?.IDBDevice) {
    return maybeModule.default
  }
  return null
}

const loadCheerpXNamespace = async ({ cheerpxNamespace, cheerpxLoader, cheerpxEsmUrl = DEFAULT_CHEERPX_ESM_URL } = {}) => {
  if (resolveCheerpXNamespace(cheerpxNamespace)) return resolveCheerpXNamespace(cheerpxNamespace)
  if (typeof globalThis !== 'undefined' && resolveCheerpXNamespace(globalThis.CheerpX)) {
    return resolveCheerpXNamespace(globalThis.CheerpX)
  }

  if (typeof cheerpxLoader === 'function') {
    const loaded = await cheerpxLoader()
    const ns = resolveCheerpXNamespace(loaded)
    if (ns) return ns
  }

  const packageName = '@leaningtech/cheerpx'
  try {
    const loaded = await import(/* @vite-ignore */ packageName)
    const ns = resolveCheerpXNamespace(loaded)
    if (ns) return ns
  } catch {
    // Fall through to CDN import.
  }

  const loaded = await import(/* @vite-ignore */ cheerpxEsmUrl)
  const ns = resolveCheerpXNamespace(loaded)
  if (!ns) {
    throw new Error('Unable to load CheerpX runtime namespace')
  }
  return ns
}

const extractJsonBlock = (output) => {
  const start = String(output || '').indexOf(JSON_START_MARKER)
  const end = String(output || '').indexOf(JSON_END_MARKER)
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`Could not parse CheerpX JSON block.\n${String(output || '')}`)
  }
  const payload = String(output || '').slice(start + JSON_START_MARKER.length, end).trim()
  return JSON.parse(payload)
}

const createCloudDeviceWithFallback = async (cheerpx, url) => {
  try {
    return await cheerpx.CloudDevice.create(url)
  } catch (error) {
    if (typeof url === 'string' && url.startsWith('wss:')) {
      const fallback = `https:${url.slice(4)}`
      return cheerpx.CloudDevice.create(fallback)
    }
    throw error
  }
}

export const resolveWorkspacePath = (path, workspaceRoot = DEFAULT_WORKSPACE_ROOT) => {
  const root = normalizeUnixPath(workspaceRoot || DEFAULT_WORKSPACE_ROOT)
  const raw = String(path || '.').trim() || '.'
  const candidate = raw.startsWith('/') ? raw : `${root}/${raw}`
  const normalized = normalizeUnixPath(candidate)
  if (normalized !== root && !normalized.startsWith(`${root}/`)) {
    throw new Error(`Path escapes workspace: ${raw}`)
  }
  return normalized
}

export const toRelativeWorkspacePath = (path, workspaceRoot = DEFAULT_WORKSPACE_ROOT) => {
  const root = normalizeUnixPath(workspaceRoot || DEFAULT_WORKSPACE_ROOT)
  const normalized = normalizeUnixPath(path)
  if (normalized === root) return '.'
  if (normalized.startsWith(`${root}/`)) return normalized.slice(`${root}/`.length)
  return normalized
}

/**
 * Lightweight CheerpX runtime wrapper used by browser-side DataProvider backends.
 */
export class CheerpXRuntime {
  constructor(options = {}) {
    this.onConsole = typeof options.onConsole === 'function' ? options.onConsole : () => {}
    this.workspaceRoot = normalizeUnixPath(options.workspaceRoot || DEFAULT_WORKSPACE_ROOT)
    this.primaryDiskUrl = String(options.primaryDiskUrl || DEFAULT_PRIMARY_DISK_URL).trim()
    this.overlayName = String(options.overlayName || DEFAULT_OVERLAY_NAME).trim()
    this.cheerpxNamespace = options.cheerpxNamespace || null
    this.cheerpxLoader = options.cheerpxLoader
    this.cheerpxEsmUrl = options.cheerpxEsmUrl || DEFAULT_CHEERPX_ESM_URL
    this.env = Array.isArray(options.env) && options.env.length > 0 ? options.env : DEFAULT_ENV

    this.cx = null
    this.queue = Promise.resolve()
    this.bootPromise = null
    this.activeExec = null
    this.decoder = new TextDecoder('utf-8')
  }

  async boot() {
    if (this.cx) return
    if (this.bootPromise) return this.bootPromise

    this.bootPromise = (async () => {
      const cheerpx = await loadCheerpXNamespace({
        cheerpxNamespace: this.cheerpxNamespace,
        cheerpxLoader: this.cheerpxLoader,
        cheerpxEsmUrl: this.cheerpxEsmUrl,
      })

      const base = await createCloudDeviceWithFallback(cheerpx, this.primaryDiskUrl)
      const cache = await cheerpx.IDBDevice.create(this.overlayName)
      const overlay = await cheerpx.OverlayDevice.create(base, cache)

      this.cx = await cheerpx.Linux.create({
        mounts: [
          { type: 'ext2', path: '/', dev: overlay },
          { type: 'devs', path: '/dev' },
          { type: 'devpts', path: '/dev/pts' },
          { type: 'proc', path: '/proc' },
          { type: 'sys', path: '/sys' },
        ],
      })

      this.cx.setCustomConsole((buffer) => {
        const chunk = this.decoder.decode(new Uint8Array(buffer))
        if (!chunk) return

        if (this.activeExec) {
          this.activeExec.chunks.push(chunk)
          if (this.activeExec.stream) this.onConsole(chunk)
          return
        }

        this.onConsole(chunk)
      }, 120, 40)

      await this._run('/bin/bash', ['-lc', `mkdir -p -- ${shellQuote(this.workspaceRoot)}`], { cwd: '/' })
    })()

    try {
      await this.bootPromise
    } finally {
      this.bootPromise = null
    }
  }

  async enqueue(task) {
    const run = this.queue.then(task, task)
    this.queue = run.catch(() => {})
    return run
  }

  async _run(cmd, args, { cwd = this.workspaceRoot, stream = false } = {}) {
    const state = { chunks: [], stream }
    this.activeExec = state

    try {
      const result = await this.cx.run(cmd, args, {
        env: this.env,
        uid: 1000,
        gid: 1000,
        cwd,
      })
      return {
        status: Number(result?.status ?? -1),
        output: state.chunks.join(''),
        cwd,
      }
    } finally {
      if (this.activeExec === state) this.activeExec = null
    }
  }

  async exec(command, { cwd = '.', stream = false } = {}) {
    return this.enqueue(async () => {
      await this.boot()
      const absoluteCwd = resolveWorkspacePath(cwd, this.workspaceRoot)
      return this._run('/bin/bash', ['-lc', String(command)], { cwd: absoluteCwd, stream })
    })
  }

  async listFiles(path = '.', { recursive = false } = {}) {
    const absolutePath = resolveWorkspacePath(path, this.workspaceRoot)
    const command = [
      `python3 - ${shellQuote(absolutePath)} ${recursive ? '1' : '0'} <<'PY'`,
      'import json',
      'import os',
      'import stat',
      'import sys',
      '',
      'root = sys.argv[1]',
      'recursive = sys.argv[2] == "1"',
      'entries = []',
      '',
      'if recursive:',
      '    for base, dirs, files in os.walk(root):',
      '        dirs.sort()',
      '        files.sort()',
      '        for name in dirs:',
      '            full = os.path.join(base, name)',
      '            st = os.lstat(full)',
      '            entries.append({"name": name, "path": full, "is_dir": True, "size": st.st_size, "mtime": int(st.st_mtime)})',
      '        for name in files:',
      '            full = os.path.join(base, name)',
      '            st = os.lstat(full)',
      '            entries.append({"name": name, "path": full, "is_dir": False, "size": st.st_size, "mtime": int(st.st_mtime)})',
      'else:',
      '    for name in sorted(os.listdir(root)):',
      '        full = os.path.join(root, name)',
      '        st = os.lstat(full)',
      '        entries.append({"name": name, "path": full, "is_dir": stat.S_ISDIR(st.st_mode), "size": st.st_size, "mtime": int(st.st_mtime)})',
      '',
      `print("${JSON_START_MARKER}")`,
      'print(json.dumps({"path": root, "entries": entries}))',
      `print("${JSON_END_MARKER}")`,
      'PY',
    ].join('\n')

    const result = await this.exec(command, { cwd: absolutePath })
    if (result.status !== 0) {
      throw new Error(result.output || `listFiles failed with status ${result.status}`)
    }
    return extractJsonBlock(result.output)
  }

  async readFile(path) {
    const absolutePath = resolveWorkspacePath(path, this.workspaceRoot)
    const command = `cat -- ${shellQuote(absolutePath)}`
    const result = await this.exec(command)
    if (result.status !== 0) {
      throw new Error(result.output || `readFile failed with status ${result.status}`)
    }
    return result.output
  }

  async writeFile(path, content) {
    const absolutePath = resolveWorkspacePath(path, this.workspaceRoot)
    const payload = utf8ToBase64(String(content ?? ''))
    const command = [
      `python3 - ${shellQuote(absolutePath)} ${shellQuote(payload)} <<'PY'`,
      'import base64',
      'import pathlib',
      'import sys',
      '',
      'target = pathlib.Path(sys.argv[1])',
      'body = base64.b64decode(sys.argv[2])',
      'target.parent.mkdir(parents=True, exist_ok=True)',
      'target.write_bytes(body)',
      'print("ok")',
      'PY',
    ].join('\n')

    const result = await this.exec(command)
    if (result.status !== 0) {
      throw new Error(result.output || `writeFile failed with status ${result.status}`)
    }
  }

  async deletePath(path) {
    const absolutePath = resolveWorkspacePath(path, this.workspaceRoot)
    if (absolutePath === this.workspaceRoot) {
      throw new Error('Refusing to delete workspace root')
    }

    const command = [
      `python3 - ${shellQuote(absolutePath)} <<'PY'`,
      'import pathlib',
      'import shutil',
      'import sys',
      '',
      'target = pathlib.Path(sys.argv[1])',
      'if not target.exists():',
      '    raise SystemExit("path not found")',
      'if target.is_dir():',
      '    shutil.rmtree(target)',
      'else:',
      '    target.unlink()',
      'print("ok")',
      'PY',
    ].join('\n')

    const result = await this.exec(command)
    if (result.status !== 0) {
      throw new Error(result.output || `deletePath failed with status ${result.status}`)
    }
  }
}

export const createCheerpXRuntime = (options = {}) => new CheerpXRuntime(options)
