import { createServer } from 'node:net'
import path from 'node:path'

import type { RuntimeBundle, RuntimeModeAdapter } from '@hachej/boring-agent/server'

import { createAppRegistryState } from './appRegistryState.js'

export interface OneChatApp {
  readonly slug: string
  readonly title: string
  readonly createdAt: string
  readonly port: number
}

export interface AppRegistryOptions {
  readonly appsRoot: string
  readonly templateRoot: string
  readonly publicHost: string
  readonly runtimeModeAdapter: RuntimeModeAdapter
  readonly appUrlPattern?: string
  readonly appBasePattern?: string
  readonly portStart: number
  readonly portEnd: number
  readonly legacyWorkspaceRoot?: string
  readonly runCommand?: (runtime: RuntimeBundle, command: string, args: readonly string[], signal?: AbortSignal) => Promise<void>
  readonly runApp?: (runtime: RuntimeBundle, app: OneChatApp, signal: AbortSignal) => Promise<void>
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
  return (
    typeof app.slug === 'string' &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(app.slug) &&
    typeof app.title === 'string' &&
    app.title.trim().length > 0 &&
    typeof app.createdAt === 'string' &&
    !Number.isNaN(Date.parse(app.createdAt)) &&
    Number.isInteger(app.port)
  )
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

function renderPattern(pattern: string, app: OneChatApp): string {
  return pattern.replaceAll('{slug}', encodeURIComponent(app.slug)).replaceAll('{port}', String(app.port))
}

function renderAppUrl(pattern: string, app: OneChatApp): string {
  if (pattern.includes('{slug}') || pattern.includes('{port}')) return renderPattern(pattern, app)
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
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => server.close(() => resolve(true)))
  })
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

async function defaultRunCommand(runtime: RuntimeBundle, command: string, args: readonly string[], signal?: AbortSignal): Promise<void> {
  const result = await runtime.sandbox.exec([command, ...args].map(shellQuote).join(' '), {
    cwd: runtime.workspace.root,
    signal,
    maxOutputBytes: 10 * 1024 * 1024,
  })
  if (result.exitCode !== 0) {
    throw new Error(`${command} failed (${result.exitCode}): ${decode(result.stderr).slice(0, 2_000)}`)
  }
}

async function defaultRunApp(runtime: RuntimeBundle, app: OneChatApp, signal: AbortSignal, appBasePattern?: string): Promise<void> {
  const args = ['node', 'node_modules/vite/bin/vite.js', 'dev']
  if (appBasePattern) args.push('--base', renderPattern(appBasePattern, app))
  const result = await runtime.sandbox.exec(args.map(shellQuote).join(' '), {
    cwd: runtime.workspace.root,
    env: { PORT: String(app.port), SAMPLE_APP_PORT: String(app.port) },
    signal,
    maxOutputBytes: 256 * 1024,
  })
  if (!signal.aborted && result.exitCode !== 0) {
    throw new Error(`app exited ${result.exitCode}: ${decode(result.stderr).slice(-2_000)}`)
  }
}

export function createAppRegistry(options: AppRegistryOptions): AppRegistry {
  const appsRoot = path.resolve(options.appsRoot)
  const state = createAppRegistryState(appsRoot)
  const logger = options.logger ?? console
  const runCommand = options.runCommand ?? defaultRunCommand
  const runApp = options.runApp ?? ((runtime, app, signal) => defaultRunApp(runtime, app, signal, options.appBasePattern))
  const isPortAvailable = options.isPortAvailable ?? defaultPortAvailable
  const restartDelayMs = options.restartDelayMs ?? 1_000
  const apps = new Map<string, OneChatApp>()
  const runtimes = new Map<string, Promise<RuntimeBundle>>()
  const appRuns = new Map<string, { controller: AbortController; done: Promise<void> }>()
  const restartTimers = new Map<string, NodeJS.Timeout>()
  let initialized = false
  let closing = false
  let mutation = Promise.resolve()
  let provisioningController: AbortController | undefined

  const rootFor = (slug: string) => path.join(appsRoot, slug)
  const urlFor = (app: OneChatApp) => renderAppUrl(options.appUrlPattern ?? `http://${options.publicHost}:{port}/`, app)
  const persist = () => state.write({ apps: [...apps.values()] })

  const nextPort = async () => {
    const used = new Set([...apps.values()].map((app) => app.port))
    for (let port = options.portStart; port <= options.portEnd; port += 1) {
      if (!used.has(port) && (await isPortAvailable(port))) return port
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

  const acquireRuntime = (app: OneChatApp, templatePath?: string): Promise<RuntimeBundle> => {
    let runtime = runtimes.get(app.slug)
    if (!runtime) {
      runtime = options.runtimeModeAdapter.create({
        workspaceRoot: rootFor(app.slug),
        workspaceId: `one-chat-app:${app.slug}`,
        sessionId: `one-chat-app:${app.slug}`,
        templatePath,
      })
      runtimes.set(app.slug, runtime)
      runtime.catch(() => {
        if (runtimes.get(app.slug) === runtime) runtimes.delete(app.slug)
      })
    }
    return runtime
  }

  const start = (app: OneChatApp) => {
    if (closing || appRuns.has(app.slug)) return
    const controller = new AbortController()
    const done = acquireRuntime(app)
      .then((runtime) => runApp(runtime, app, controller.signal))
      .catch((error) => {
        if (!closing && !controller.signal.aborted) logger.error(`[one-chat] app ${app.slug} stopped: ${String(error)}`)
      })
      .finally(() => {
        if (appRuns.get(app.slug)?.controller === controller) appRuns.delete(app.slug)
        if (closing || controller.signal.aborted || !apps.has(app.slug)) return
        const timer = setTimeout(() => {
          restartTimers.delete(app.slug)
          start(app)
        }, restartDelayMs)
        timer.unref?.()
        restartTimers.set(app.slug, timer)
      })
    appRuns.set(app.slug, { controller, done })
  }

  const registerExistingFolders = async () => {
    const runtime = await options.runtimeModeAdapter.create({
      workspaceRoot: appsRoot,
      workspaceId: 'one-chat-app-registry',
      sessionId: 'one-chat-app-registry',
    })
    try {
      for (const entry of await runtime.workspace.readdir('.')) {
        if (entry.kind !== 'dir' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.name) || apps.has(entry.name)) continue
        try {
          if ((await runtime.workspace.stat(path.join(entry.name, 'package.json'))).kind !== 'file') continue
        } catch {
          continue
        }
        apps.set(entry.name, {
          slug: entry.name,
          title:
            entry.name === 'default'
              ? 'Default'
              : entry.name
                  .split('-')
                  .map((word) => `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}`)
                  .join(' '),
          createdAt: new Date().toISOString(),
          port: await nextPort(),
        })
      }
    } finally {
      await runtime.disposeRuntime?.()
    }
  }

  const init = async () => {
    if (initialized) return
    await state.initRoot()
    let needsPersist = false
    const stored = await state.read()
    if (stored) {
      if (!Array.isArray(stored.apps) || !stored.apps.every(isApp)) throw new Error('apps.json has an invalid shape')
      const ports = new Set<number>()
      for (const app of stored.apps) {
        if (apps.has(app.slug)) throw new Error(`apps.json repeats slug ${app.slug}`)
        if (app.port < options.portStart || app.port > options.portEnd) {
          throw new Error(`apps.json port ${app.port} is outside ${options.portStart}-${options.portEnd}`)
        }
        if (ports.has(app.port)) throw new Error(`apps.json repeats port ${app.port}`)
        ports.add(app.port)
        apps.set(app.slug, Object.freeze({ ...app }))
      }
    } else {
      needsPersist = true
    }

    if (options.legacyWorkspaceRoot && !apps.has('default')) {
      const legacyRoot = path.resolve(options.legacyWorkspaceRoot)
      if (legacyRoot !== appsRoot) {
        const app: OneChatApp = Object.freeze({
          slug: 'default',
          title: 'Default',
          createdAt: new Date().toISOString(),
          port: await nextPort(),
        })
        await acquireRuntime(app, legacyRoot === rootFor(app.slug) ? undefined : legacyRoot)
        apps.set(app.slug, app)
        needsPersist = true
      }
    }

    await registerExistingFolders()
    for (const app of apps.values()) {
      if (!(await isPortAvailable(app.port))) throw new Error(`App port ${app.port} for ${app.slug} is already in use`)
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
      const controller = new AbortController()
      provisioningController = controller
      let runtime: RuntimeBundle | undefined
      try {
        runtime = await acquireRuntime(app, path.resolve(options.templateRoot))
        await runCommand(
          runtime,
          'pnpm',
          ['install', '--frozen-lockfile', '--config.minimum-release-age=0', '--config.dangerously-allow-all-builds=true'],
          controller.signal,
        )
        await runCommand(runtime, 'pnpm', ['run', 'db:push'], controller.signal)
        if (closing) throw new Error('The app registry is shutting down')
        apps.set(app.slug, app)
        await persist()
        start(app)
        result = app
      } catch (error) {
        if (runtime) await runtime.disposeRuntime?.().catch(() => {})
        runtimes.delete(app.slug)
        throw error
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
    const active = [...appRuns.values()]
    for (const run of active) run.controller.abort(new Error('app registry is shutting down'))
    await Promise.race([Promise.allSettled(active.map((run) => run.done)), new Promise((resolve) => setTimeout(resolve, 5_000))])
    appRuns.clear()
    const acquired = await Promise.allSettled([...runtimes.values()])
    runtimes.clear()
    await Promise.allSettled(
      acquired.flatMap((result) => (result.status === 'fulfilled' && result.value.disposeRuntime ? [result.value.disposeRuntime()] : [])),
    )
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
