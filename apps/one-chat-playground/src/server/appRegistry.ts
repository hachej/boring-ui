import { randomUUID } from 'node:crypto'
import { createServer } from 'node:net'
import path from 'node:path'

import type { RuntimeBundle, RuntimeModeAdapter } from '@hachej/boring-agent/server'

import { createAppLifecycle, type AppLifecycle } from './appLifecycle.js'
import { createAppRegistryState } from './appRegistryState.js'

export interface OneChatApp {
  readonly slug: string
  readonly title: string
  readonly createdAt: string
  readonly acceptedPort: number
  readonly candidatePort: number
}

export interface OneChatAppProcess extends OneChatApp {
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
  readonly runCommand?: (
    runtime: RuntimeBundle,
    command: string,
    args: readonly string[],
    signal?: AbortSignal,
    timeoutMs?: number,
  ) => Promise<void>
  readonly runApp?: (runtime: RuntimeBundle, app: OneChatAppProcess, signal: AbortSignal) => Promise<void>
  readonly healthCheck?: (runtime: RuntimeBundle, port: number, signal?: AbortSignal) => Promise<void>
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
  candidateUrlFor(app: OneChatApp): string
  lifecycleFor(slug: string): AppLifecycle
  create(title: string): Promise<OneChatApp>
  close(): Promise<void>
}

interface StoredApp extends Partial<OneChatApp> {
  readonly port?: number
}

function parseStoredApp(value: unknown): StoredApp | undefined {
  if (!value || typeof value !== 'object') return undefined
  const app = value as Record<string, unknown>
  if (
    typeof app.slug !== 'string' ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(app.slug) ||
    typeof app.title !== 'string' ||
    !app.title.trim() ||
    typeof app.createdAt !== 'string' ||
    Number.isNaN(Date.parse(app.createdAt))
  ) return undefined
  const acceptedPort = Number.isInteger(app.acceptedPort) ? app.acceptedPort as number : Number.isInteger(app.port) ? app.port as number : undefined
  if (acceptedPort === undefined) return undefined
  const candidatePort = Number.isInteger(app.candidatePort) ? app.candidatePort as number : undefined
  return { slug: app.slug, title: app.title, createdAt: app.createdAt, acceptedPort, candidatePort }
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

function renderPattern(pattern: string, app: OneChatApp, port: number = app.acceptedPort): string {
  return pattern.replaceAll('{slug}', encodeURIComponent(app.slug)).replaceAll('{port}', String(port))
}

function renderAppUrl(pattern: string, app: OneChatApp, port: number = app.acceptedPort): string {
  if (pattern.includes('{slug}') || pattern.includes('{port}')) return renderPattern(pattern, app, port)
  try {
    const url = new URL(pattern)
    url.port = String(port)
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

async function defaultRunCommand(
  runtime: RuntimeBundle,
  command: string,
  args: readonly string[],
  signal?: AbortSignal,
  timeoutMs?: number,
): Promise<void> {
  const result = await runtime.sandbox.exec([command, ...args].map(shellQuote).join(' '), {
    cwd: runtime.workspace.root,
    signal,
    timeoutMs,
    maxOutputBytes: 10 * 1024 * 1024,
  })
  if (result.exitCode !== 0) {
    throw new Error(`${command} failed (${result.exitCode}): ${decode(result.stderr).slice(0, 2_000)}`)
  }
}

async function defaultRunApp(runtime: RuntimeBundle, app: OneChatAppProcess, signal: AbortSignal, appBasePattern?: string): Promise<void> {
  const args = ['node', 'node_modules/vite/bin/vite.js', 'dev']
  if (appBasePattern) args.push('--base', renderPattern(appBasePattern, app, app.port))
  const launch = args.map(shellQuote).join(' ')
  const command = runtime.sandbox.id === 'direct'
    ? `${launch} & child=$!; cleanup() { trap - EXIT HUP INT TERM; kill "$child" 2>/dev/null || true; wait "$child" 2>/dev/null || true; }; trap 'cleanup; exit 143' HUP INT TERM; trap cleanup EXIT; while kill -0 "$child" 2>/dev/null; do kill -0 "$ONE_CHAT_HOST_PID" 2>/dev/null || exit 0; sleep 1; done; wait "$child"; status=$?; trap - EXIT; exit "$status"`
    : `exec ${launch}`
  const result = await runtime.sandbox.exec(command, {
    cwd: runtime.workspace.root,
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      PORT: String(app.port),
      SAMPLE_APP_PORT: String(app.port),
      ONE_CHAT_HOST_PID: String(process.pid),
    },
    signal,
    maxOutputBytes: 256 * 1024,
  })
  if (!signal.aborted && result.exitCode !== 0) {
    throw new Error(`app exited ${result.exitCode}: ${decode(result.stderr).slice(-2_000)}`)
  }
}

async function defaultHealthCheck(runtime: RuntimeBundle, port: number, signal?: AbortSignal): Promise<void> {
  const script = "fetch(process.env.ONE_CHAT_HEALTH).then(async r=>{if(!r.ok)throw new Error('HTTP '+r.status);const b=await r.json();if(b.ok!==true)throw new Error('unhealthy response')})"
  let last = ''
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (signal?.aborted) throw signal.reason
    const result = await runtime.sandbox.exec(`node -e ${shellQuote(script)}`, {
      cwd: runtime.workspace.root,
      env: {
        ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
        ONE_CHAT_HEALTH: `http://127.0.0.1:${port}/health`,
      },
      signal,
      timeoutMs: 2_000,
      maxOutputBytes: 64 * 1024,
    })
    if (result.exitCode === 0) return
    last = decode(result.stderr).trim()
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`health check failed${last ? `: ${last.slice(-500)}` : ''}`)
}

export function createAppRegistry(options: AppRegistryOptions): AppRegistry {
  const appsRoot = path.resolve(options.appsRoot)
  const state = createAppRegistryState(appsRoot)
  const logger = options.logger ?? console
  const runCommand = options.runCommand ?? defaultRunCommand
  const runApp = options.runApp ?? ((runtime, app, signal) => defaultRunApp(runtime, app, signal, options.appBasePattern))
  const healthCheck = options.healthCheck ?? defaultHealthCheck
  const isPortAvailable = options.isPortAvailable ?? defaultPortAvailable
  const restartDelayMs = options.restartDelayMs ?? 1_000
  const apps = new Map<string, OneChatApp>()
  const runtimes = new Map<string, Promise<RuntimeBundle>>()
  const lifecycles = new Map<string, AppLifecycle>()
  const appRuns = new Map<string, { controller: AbortController; done: Promise<void> }>()
  const restartTimers = new Map<string, NodeJS.Timeout>()
  let initialized = false
  let closing = false
  let mutation = Promise.resolve()
  let provisioningController: AbortController | undefined

  const rootFor = (slug: string) => path.join(appsRoot, slug)
  const urlFor = (app: OneChatApp) => renderAppUrl(options.appUrlPattern ?? `http://${options.publicHost}:{port}/`, app, app.acceptedPort)
  const candidateUrlFor = (app: OneChatApp) => renderAppUrl(options.appUrlPattern ?? `http://${options.publicHost}:{port}/`, app, app.candidatePort)
  const persist = () => state.write({ apps: [...apps.values()] })

  const nextPort = async (alsoUsed: ReadonlySet<number> = new Set()) => {
    const used = new Set([...apps.values()].flatMap((app) => [app.acceptedPort, app.candidatePort]))
    for (const port of alsoUsed) used.add(port)
    for (let port = options.portStart; port <= options.portEnd; port += 1) {
      if (!used.has(port) && (await isPortAvailable(port))) return port
    }
    throw new Error(`No app port is available in ${options.portStart}-${options.portEnd}`)
  }

  const nextPortPair = async (): Promise<readonly [number, number]> => {
    const acceptedPort = await nextPort()
    const candidatePort = await nextPort(new Set([acceptedPort]))
    return [acceptedPort, candidatePort]
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
    const processApp: OneChatAppProcess = { ...app, port: app.acceptedPort }
    const done = acquireRuntime(app)
      .then((runtime) => runApp(runtime, processApp, controller.signal))
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

  const stop = async (app: OneChatApp) => {
    const timer = restartTimers.get(app.slug)
    if (timer) clearTimeout(timer)
    restartTimers.delete(app.slug)
    const active = appRuns.get(app.slug)
    if (!active) return
    appRuns.delete(app.slug)
    active.controller.abort(new Error('accepted app paused'))
    await Promise.race([active.done.catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 5_000))])
  }

  const lifecycleFor = (slug: string): AppLifecycle => {
    const app = apps.get(slug)
    if (!app) throw new Error(`Unknown one-chat app: ${slug}`)
    let lifecycle = lifecycles.get(slug)
    if (lifecycle) return lifecycle
    lifecycle = createAppLifecycle({
      app,
      appRoot: rootFor(slug),
      acceptedUrl: urlFor(app),
      candidateUrl: candidateUrlFor(app),
      runtimeModeAdapter: options.runtimeModeAdapter,
      acquireAcceptedRuntime: () => acquireRuntime(app),
      stopAccepted: () => stop(app),
      startAccepted: () => start(app),
      startPreview(runtime, port, signal) {
        return runApp(runtime, { ...app, port }, signal)
      },
      health: healthCheck,
      log(message) {
        logger.error(`[one-chat] ${app.slug}: ${message}`)
      },
    })
    lifecycles.set(slug, lifecycle)
    return lifecycle
  }

  const ensureRepository = async (app: OneChatApp) => {
    const runtime = await acquireRuntime(app)
    const check = await runtime.sandbox.exec('git rev-parse --show-toplevel', {
      cwd: runtime.workspace.root,
      maxOutputBytes: 64 * 1024,
    })
    const repositoryRoot = check.exitCode === 0 ? decode(check.stdout).trim() : ''
    if (repositoryRoot && path.resolve(repositoryRoot) === path.resolve(runtime.workspace.root)) return
    await runCommand(runtime, 'git', ['init', '-b', 'main'])
    await runCommand(runtime, 'git', ['config', 'user.name', 'One Chat'])
    await runCommand(runtime, 'git', ['config', 'user.email', 'one-chat@local.invalid'])
    await runCommand(runtime, 'git', ['add', '-A'])
    await runCommand(runtime, 'git', ['commit', '-m', `Created ${app.title}`])
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
          const repository = await runtime.sandbox.exec('git rev-parse --show-toplevel && git rev-parse --verify HEAD', {
            cwd: path.join(runtime.workspace.root, entry.name),
            maxOutputBytes: 64 * 1024,
          })
          const [repositoryRoot] = decode(repository.stdout).split('\n')
          if (repository.exitCode !== 0 || path.resolve(repositoryRoot ?? '') !== path.resolve(runtime.workspace.root, entry.name)) continue
        } catch {
          continue
        }
        const [acceptedPort, candidatePort] = await nextPortPair()
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
          acceptedPort,
          candidatePort,
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
      if (!Array.isArray(stored.apps)) throw new Error('apps.json has an invalid shape')
      const parsed = stored.apps.map(parseStoredApp)
      if (parsed.some((app) => !app)) throw new Error('apps.json has an invalid shape')
      const ports = new Set<number>()
      for (const storedApp of parsed as StoredApp[]) {
        if (apps.has(storedApp.slug!)) throw new Error(`apps.json repeats slug ${storedApp.slug}`)
        const acceptedPort = storedApp.acceptedPort!
        if (acceptedPort < options.portStart || acceptedPort > options.portEnd) {
          throw new Error(`apps.json port ${acceptedPort} is outside ${options.portStart}-${options.portEnd}`)
        }
        if (ports.has(acceptedPort)) throw new Error(`apps.json repeats port ${acceptedPort}`)
        ports.add(acceptedPort)
        let candidatePort = storedApp.candidatePort
        if (candidatePort === undefined) {
          candidatePort = await nextPort(ports)
          needsPersist = true
        }
        if (candidatePort < options.portStart || candidatePort > options.portEnd) {
          throw new Error(`apps.json port ${candidatePort} is outside ${options.portStart}-${options.portEnd}`)
        }
        if (ports.has(candidatePort)) throw new Error(`apps.json repeats port ${candidatePort}`)
        ports.add(candidatePort)
        apps.set(storedApp.slug!, Object.freeze({
          slug: storedApp.slug!,
          title: storedApp.title!,
          createdAt: storedApp.createdAt!,
          acceptedPort,
          candidatePort,
        }))
      }
    } else {
      needsPersist = true
    }

    if (options.legacyWorkspaceRoot && !apps.has('default')) {
      const legacyRoot = path.resolve(options.legacyWorkspaceRoot)
      if (legacyRoot !== appsRoot) {
        const [acceptedPort, candidatePort] = await nextPortPair()
        const app: OneChatApp = Object.freeze({
          slug: 'default',
          title: 'Default',
          createdAt: new Date().toISOString(),
          acceptedPort,
          candidatePort,
        })
        await acquireRuntime(app, legacyRoot === rootFor(app.slug) ? undefined : legacyRoot)
        apps.set(app.slug, app)
        needsPersist = true
      }
    }

    await registerExistingFolders()
    for (const app of apps.values()) {
      await ensureRepository(app)
      for (const port of [app.acceptedPort, app.candidatePort]) {
        if (!(await isPortAvailable(port))) throw new Error(`App port ${port} for ${app.slug} is already in use`)
      }
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
      const [acceptedPort, candidatePort] = await nextPortPair()
      const app: OneChatApp = Object.freeze({
        slug: uniqueSlug(title),
        title,
        createdAt: new Date().toISOString(),
        acceptedPort,
        candidatePort,
      })
      const controller = new AbortController()
      provisioningController = controller
      let runtime: RuntimeBundle | undefined
      const stagingRoot = path.join(appsRoot, `.provisioning-${app.slug}-${randomUUID()}`)
      try {
        runtime = await options.runtimeModeAdapter.create({
          workspaceRoot: stagingRoot,
          workspaceId: `one-chat-app-provisioning:${app.slug}`,
          sessionId: `one-chat-app-provisioning:${app.slug}`,
          templatePath: path.resolve(options.templateRoot),
        })
        await runCommand(
          runtime,
          'pnpm',
          ['install', '--frozen-lockfile', '--config.minimum-release-age=0'],
          controller.signal,
          180_000,
        )
        await runCommand(runtime, 'pnpm', ['run', 'db:push'], controller.signal)
        await runCommand(runtime, 'git', ['init', '-b', 'main'], controller.signal)
        await runCommand(runtime, 'git', ['config', 'user.name', 'One Chat'], controller.signal)
        await runCommand(runtime, 'git', ['config', 'user.email', 'one-chat@local.invalid'], controller.signal)
        await runCommand(runtime, 'git', ['add', '-A'], controller.signal)
        await runCommand(runtime, 'git', ['commit', '-m', `Created ${title}`], controller.signal)
        if (closing) throw new Error('The app registry is shutting down')
        await runtime.disposeRuntime?.()
        runtime = undefined
        const registryRuntime = await options.runtimeModeAdapter.create({
          workspaceRoot: appsRoot,
          workspaceId: 'one-chat-app-registry-promotion',
          sessionId: `one-chat-app-registry-promotion:${app.slug}`,
        })
        try {
          await registryRuntime.workspace.rename(path.basename(stagingRoot), app.slug)
        } finally {
          await registryRuntime.disposeRuntime?.()
        }
        await acquireRuntime(app)
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
    await Promise.allSettled([...lifecycles.values()].map((lifecycle) => lifecycle.close()))
    lifecycles.clear()
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
    candidateUrlFor,
    lifecycleFor,
    create,
    close,
  }
}
