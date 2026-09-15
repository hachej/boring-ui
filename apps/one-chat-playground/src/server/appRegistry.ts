import { spawn, type ChildProcess } from 'node:child_process'
import { cp, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import path from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'

const execFileAsync = promisify(execFile)

export interface OneChatApp {
  readonly slug: string
  readonly title: string
  readonly createdAt: string
  readonly port: number
}

interface RegistryFile {
  readonly apps: readonly OneChatApp[]
}

export interface AppRegistryOptions {
  readonly appsRoot: string
  readonly templateRoot: string
  readonly publicHost: string
  readonly appUrlPattern?: string
  readonly appBasePattern?: string
  readonly portStart: number
  readonly portEnd: number
  readonly legacyWorkspaceRoot?: string
  readonly runCommand?: (command: string, args: readonly string[], cwd: string, signal?: AbortSignal) => Promise<void>
  readonly spawnApp?: (app: OneChatApp, cwd: string) => ChildProcess
  readonly isPortAvailable?: (port: number) => Promise<boolean>
  readonly restartDelayMs?: number
  readonly logger?: Pick<Console, 'info' | 'error'>
}

export interface AppRegistry {
  readonly appsRoot: string
  init(): Promise<void>
  list(): readonly OneChatApp[]
  get(slug: string): OneChatApp | undefined
  rootFor(slug: string): string
  urlFor(app: OneChatApp): string
  create(title: string): Promise<OneChatApp>
  close(): Promise<void>
}

function isApp(value: unknown): value is OneChatApp {
  if (!value || typeof value !== 'object') return false
  const app = value as Record<string, unknown>
  return typeof app.slug === 'string'
    && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(app.slug)
    && typeof app.title === 'string'
    && app.title.trim().length > 0
    && typeof app.createdAt === 'string'
    && !Number.isNaN(Date.parse(app.createdAt))
    && Number.isInteger(app.port)
}

export function slugifyAppTitle(title: string): string {
  const normalized = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || 'app'
}

function processGroupKill(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid || child.exitCode !== null) return
  if (process.platform !== 'win32') {
    try {
      process.kill(-child.pid, signal)
      return
    } catch {
      // A custom spawner may not create a process group. Kill the direct child.
    }
  }
  child.kill(signal)
}

function renderPattern(pattern: string, app: OneChatApp): string {
  return pattern.replaceAll('{slug}', encodeURIComponent(app.slug)).replaceAll('{port}', String(app.port))
}

function defaultSpawn(app: OneChatApp, cwd: string, appBasePattern?: string): ChildProcess {
  // Spawn Vite itself, not a package-manager wrapper. It stays in the host's
  // process group and is also directly terminated during graceful shutdown.
  const args = [path.join(cwd, 'node_modules', 'vite', 'bin', 'vite.js'), 'dev']
  if (appBasePattern) args.push('--base', renderPattern(appBasePattern, app))
  return spawn(process.execPath, args, {
    cwd,
    detached: false,
    env: { ...process.env, PORT: String(app.port), SAMPLE_APP_PORT: String(app.port) },
    stdio: 'inherit',
  })
}

async function defaultRun(command: string, args: readonly string[], cwd: string, signal?: AbortSignal): Promise<void> {
  await execFileAsync(command, [...args], {
    cwd,
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
    signal,
  })
}

function renderAppUrl(pattern: string, app: OneChatApp): string {
  if (pattern.includes('{slug}') || pattern.includes('{port}')) {
    return renderPattern(pattern, app)
  }
  try {
    const url = new URL(pattern)
    url.port = String(app.port)
    return url.href
  } catch {
    return pattern
  }
}

function defaultPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.unref()
    server.once('error', () => resolve(false))
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      server.close(() => resolve(true))
    })
  })
}

export function createAppRegistry(options: AppRegistryOptions): AppRegistry {
  const appsRoot = path.resolve(options.appsRoot)
  const registryPath = path.join(appsRoot, 'apps.json')
  const logger = options.logger ?? console
  const runCommand = options.runCommand ?? defaultRun
  const spawnApp = options.spawnApp ?? ((app, cwd) => defaultSpawn(app, cwd, options.appBasePattern))
  const isPortAvailable = options.isPortAvailable ?? defaultPortAvailable
  const restartDelayMs = options.restartDelayMs ?? 1_000
  const apps = new Map<string, OneChatApp>()
  const children = new Map<string, ChildProcess>()
  const restartTimers = new Map<string, NodeJS.Timeout>()
  let initialized = false
  let closing = false
  let mutation = Promise.resolve()
  let provisioningController: AbortController | undefined

  const rootFor = (slug: string) => path.join(appsRoot, slug)
  const urlFor = (app: OneChatApp) => renderAppUrl(
    options.appUrlPattern ?? `http://${options.publicHost}:{port}/`,
    app,
  )

  const persist = async () => {
    const body: RegistryFile = { apps: [...apps.values()] }
    const temporary = `${registryPath}.tmp`
    await writeFile(temporary, `${JSON.stringify(body, null, 2)}\n`, 'utf8')
    await rename(temporary, registryPath)
  }

  const nextPort = async () => {
    const used = new Set([...apps.values()].map((app) => app.port))
    for (let port = options.portStart; port <= options.portEnd; port += 1) {
      if (!used.has(port) && await isPortAvailable(port)) return port
    }
    throw new Error(`No app port is available in ${options.portStart}-${options.portEnd}`)
  }

  const uniqueSlug = (title: string) => {
    const base = slugifyAppTitle(title)
    if (!apps.has(base)) return base
    let suffix = 2
    while (apps.has(`${base}-${suffix}`)) suffix += 1
    return `${base}-${suffix}`
  }

  const start = (app: OneChatApp) => {
    if (closing || children.has(app.slug)) return
    const child = spawnApp(app, rootFor(app.slug))
    children.set(app.slug, child)
    let settled = false
    const settle = (reason: string) => {
      if (settled) return
      settled = true
      if (children.get(app.slug) === child) children.delete(app.slug)
      if (closing || !apps.has(app.slug)) return
      logger.error(`[one-chat] app ${app.slug} stopped (${reason}); restarting`)
      const timer = setTimeout(() => {
        restartTimers.delete(app.slug)
        start(app)
      }, restartDelayMs)
      timer.unref?.()
      restartTimers.set(app.slug, timer)
    }
    child.once('error', (error) => settle(error.message))
    child.once('exit', (code, signal) => settle(signal ?? String(code ?? 'unknown')))
  }

  const copyApp = async (source: string, target: string, includeNodeModules: boolean) => {
    await cp(source, target, {
      recursive: true,
      errorOnExist: true,
      force: false,
      filter: includeNodeModules ? undefined : (candidate) => path.basename(candidate) !== 'node_modules',
    })
  }

  const registerExistingFolders = async () => {
    for (const entry of await readdir(appsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.name) || apps.has(entry.name)) continue
      try {
        await stat(path.join(appsRoot, entry.name, 'package.json'))
      } catch {
        continue
      }
      apps.set(entry.name, {
        slug: entry.name,
        title: entry.name === 'default'
          ? 'Default'
          : entry.name.split('-').map((word) => `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}`).join(' '),
        createdAt: new Date().toISOString(),
        port: await nextPort(),
      })
    }
  }

  const init = async () => {
    if (initialized) return
    await mkdir(appsRoot, { recursive: true })
    let needsPersist = false
    try {
      const parsed = JSON.parse(await readFile(registryPath, 'utf8')) as RegistryFile
      if (!Array.isArray(parsed.apps) || !parsed.apps.every(isApp)) throw new Error('apps.json has an invalid shape')
      const ports = new Set<number>()
      for (const app of parsed.apps) {
        if (apps.has(app.slug)) throw new Error(`apps.json repeats slug ${app.slug}`)
        if (app.port < options.portStart || app.port > options.portEnd) {
          throw new Error(`apps.json port ${app.port} is outside ${options.portStart}-${options.portEnd}`)
        }
        if (ports.has(app.port)) throw new Error(`apps.json repeats port ${app.port}`)
        ports.add(app.port)
        apps.set(app.slug, Object.freeze({ ...app }))
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      needsPersist = true
    }

    if (options.legacyWorkspaceRoot && !apps.has('default')) {
      const legacyRoot = path.resolve(options.legacyWorkspaceRoot)
      // Some existing launches pointed ONE_CHAT_WORKSPACE_ROOT at the parent
      // `.workspaces` directory. In that shape, discover its app folders below
      // rather than recursively copying the directory into itself.
      if (legacyRoot !== appsRoot) {
        const defaultRoot = rootFor('default')
        if (legacyRoot !== defaultRoot) await copyApp(legacyRoot, defaultRoot, true)
        apps.set('default', {
          slug: 'default',
          title: 'Default',
          createdAt: new Date().toISOString(),
          port: await nextPort(),
        })
        needsPersist = true
      }
    }

    await registerExistingFolders()
    for (const app of apps.values()) {
      if (!await isPortAvailable(app.port)) throw new Error(`App port ${app.port} for ${app.slug} is already in use`)
    }
    if (needsPersist || apps.size > 0) await persist()
    initialized = true
    for (const app of apps.values()) start(app)
  }

  const create = async (rawTitle: string): Promise<OneChatApp> => {
    const title = rawTitle.trim()
    if (!title) throw new Error('An app title is required')
    if (title.length > 80) throw new Error('App titles must be 80 characters or fewer')
    let result!: OneChatApp
    const operation = mutation.then(async () => {
      if (closing) throw new Error('The app registry is shutting down')
      if (!initialized) await init()
      const app: OneChatApp = Object.freeze({
        slug: uniqueSlug(title),
        title,
        createdAt: new Date().toISOString(),
        port: await nextPort(),
      })
      const root = rootFor(app.slug)
      const stagingRoot = path.join(appsRoot, `.${app.slug}-creating-${Date.now().toString(36)}`)
      const controller = new AbortController()
      provisioningController = controller
      try {
        await copyApp(path.resolve(options.templateRoot), stagingRoot, false)
        await runCommand('pnpm', [
          'install',
          '--frozen-lockfile',
          '--config.minimum-release-age=0',
          '--config.dangerously-allow-all-builds=true',
        ], stagingRoot, controller.signal)
        await runCommand('pnpm', ['run', 'db:push'], stagingRoot, controller.signal)
        if (closing) throw new Error('The app registry is shutting down')
        await rename(stagingRoot, root)
        apps.set(app.slug, app)
        await persist()
        start(app)
        result = app
      } finally {
        if (provisioningController === controller) provisioningController = undefined
      }
    })
    mutation = operation.catch(() => undefined)
    await operation
    return result
  }

  const close = async () => {
    if (closing) return
    closing = true
    provisioningController?.abort()
    await mutation.catch(() => undefined)
    for (const timer of restartTimers.values()) clearTimeout(timer)
    restartTimers.clear()
    const active = [...children.values()]
    for (const child of active) processGroupKill(child, 'SIGTERM')
    await Promise.all(active.map((child) => child.exitCode !== null
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            processGroupKill(child, 'SIGKILL')
            resolve()
          }, 5_000)
          child.once('exit', () => {
            clearTimeout(timeout)
            resolve()
          })
        })))
    children.clear()
  }

  return {
    appsRoot,
    init,
    list: () => [...apps.values()],
    get: (slug) => apps.get(slug),
    rootFor,
    urlFor,
    create,
    close,
  }
}
