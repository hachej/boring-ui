import { spawn } from 'node:child_process'
import { readdirSync, readFileSync, readlinkSync } from 'node:fs'
import { createServer as createHttpServer, request as httpRequest, type Server as HttpServer } from 'node:http'
import { createServer, isIP } from 'node:net'

const FALLBACK_PORT_MIN = 4300
const FALLBACK_PORT_MAX = 4399
const PROCESS_STOP_GRACE_MS = 1_000

export type LocalDemoProxy = HttpServer

export interface LocalDemoHost {
  readonly bindHost: string
  readonly urlHost: string
  readonly needsProxy: boolean
}

export function localDemoHost(env: NodeJS.ProcessEnv): LocalDemoHost {
  const configured = env.BORING_FACTORY_DEMO_HOST?.trim()
  const bindHost = configured?.startsWith('[') && configured.endsWith(']')
    ? configured.slice(1, -1)
    : configured || '127.0.0.1'
  if (isIP(bindHost) === 0 || bindHost === '0.0.0.0' || bindHost === '::') {
    throw new Error('BORING_FACTORY_DEMO_HOST must be a non-wildcard IPv4 or IPv6 address owned by this host')
  }
  return {
    bindHost,
    urlHost: isIP(bindHost) === 6 ? `[${bindHost}]` : bindHost,
    needsProxy: bindHost !== '127.0.0.1',
  }
}

const INHERITED_LOCAL_ENV_KEYS = ['PATH', 'HOME', 'LANG', 'TZ', 'NODE_OPTIONS', 'CI'] as const

export function buildLocalDemoEnvironment(
  hostEnv: NodeJS.ProcessEnv,
  input: { readonly port: number; readonly leaseId: string; readonly sha: string; readonly readyToken: string },
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const key of INHERITED_LOCAL_ENV_KEYS) {
    const value = hostEnv[key]
    if (value !== undefined) result[key] = value
  }
  return {
    ...result,
    PORT: String(input.port),
    HOST: '127.0.0.1',
    BORING_FACTORY_DEMO_PORT: String(input.port),
    BORING_FACTORY_DEMO_LEASE_ID: input.leaseId,
    BORING_FACTORY_DEMO_SHA: input.sha,
    BORING_FACTORY_DEMO_READY_NONCE: input.readyToken,
  }
}

export function singleShellCommandError(command: string): string | undefined {
  let quote: "'" | '"' | undefined
  let escaped = false
  for (const character of command) {
    if (escaped) {
      escaped = false
      continue
    }
    if (character === '\\' && quote !== "'") {
      escaped = true
      continue
    }
    if (quote) {
      if (character === quote) quote = undefined
      continue
    }
    if (character === "'" || character === '"') {
      quote = character
      continue
    }
    if ('\r\n;&|<>()'.includes(character)) {
      return 'local demo commands must be one command line without shell control or redirection operators'
    }
  }
  return quote || escaped ? 'local demo commands must not contain unterminated quoting or escaping' : undefined
}

export async function startLocalProxy(host: LocalDemoHost, port: number): Promise<LocalDemoProxy | undefined> {
  if (!host.needsProxy) return undefined
  const server = createHttpServer((incoming, outgoing) => {
    const upstream = httpRequest({
      host: '127.0.0.1',
      port,
      method: incoming.method,
      path: incoming.url,
      headers: {
        ...incoming.headers,
        host: `127.0.0.1:${port}`,
        'x-forwarded-host': incoming.headers.host,
        'x-forwarded-proto': 'http',
      },
    }, (response) => {
      outgoing.writeHead(response.statusCode ?? 502, response.headers)
      response.pipe(outgoing)
    })
    upstream.on('error', () => {
      if (!outgoing.headersSent) outgoing.writeHead(502)
      outgoing.end('local demo is not ready')
    })
    incoming.pipe(upstream)
  })
  server.unref()
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen({ host: host.bindHost, port, exclusive: true }, () => {
      server.off('error', rejectListen)
      resolveListen()
    })
  })
  return server
}

export async function closeLocalProxy(server: LocalDemoProxy | undefined): Promise<void> {
  if (!server) return
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose())
  })
}

export interface LocalDemoProcessRuntime {
  start(command: string, cwd: string, env: Record<string, string>): Promise<LocalDemoProcessIdentity>
  run(command: string, cwd: string, env: Record<string, string>, timeoutMs: number): Promise<number>
  isAlive(identity: LocalDemoProcessIdentity | undefined): boolean
  isListeningOnLoopback(identity: LocalDemoProcessIdentity, port: number): boolean
  stop(identity: LocalDemoProcessIdentity | undefined): Promise<void>
}

export interface LocalDemoProcessIdentity {
  readonly processId: number
  /** Linux `/proc/<pid>/stat` field 22, in kernel clock ticks since boot. */
  readonly processStartTime: string
}

interface LinuxProcessStat {
  readonly processId: number
  readonly state: string
  readonly processGroupId: number
  readonly sessionId: number
  readonly startTime: string
}

function readLinuxProcessStat(processId: number): LinuxProcessStat | undefined {
  if (process.platform !== 'linux') return undefined
  try {
    const raw = readFileSync(`/proc/${processId}/stat`, 'utf8')
    const commandEnd = raw.lastIndexOf(')')
    if (commandEnd < 0) return undefined
    const fields = raw.slice(commandEnd + 2).trim().split(/\s+/)
    const processGroupId = Number(fields[2])
    const sessionId = Number(fields[3])
    const startTime = fields[19]
    if (!Number.isSafeInteger(processGroupId) || !Number.isSafeInteger(sessionId) || !startTime) return undefined
    return { processId, state: fields[0] ?? '', processGroupId, sessionId, startTime }
  } catch {
    return undefined
  }
}

function listLinuxProcessGroup(processGroupId: number): LinuxProcessStat[] {
  if (process.platform !== 'linux') return []
  try {
    return readdirSync('/proc')
      .filter((name) => /^\d+$/.test(name))
      .map((name) => readLinuxProcessStat(Number(name)))
      .filter((stat): stat is LinuxProcessStat => stat?.processGroupId === processGroupId && stat.state !== 'Z')
  } catch {
    return []
  }
}

/**
 * A detached child starts a new session whose process-group id is its pid. Linux
 * does not reuse that numeric id while members of the old group survive. If a
 * new leader appears with the same pid, its start time must still match before
 * the group is considered ours.
 */
function processGroupIsAlive(identity: LocalDemoProcessIdentity | undefined): boolean {
  if (!identity || !Number.isSafeInteger(identity.processId) || identity.processId <= 0) return false
  if (process.platform !== 'linux') return false
  const members = listLinuxProcessGroup(identity.processId)
  if (members.length === 0) return false
  const currentLeader = members.find((member) => member.processId === identity.processId)
  if (currentLeader && currentLeader.startTime !== identity.processStartTime) return false
  return members.every((member) => member.sessionId === identity.processId)
}

async function waitForProcessGroupExit(identity: LocalDemoProcessIdentity): Promise<boolean> {
  const deadline = Date.now() + PROCESS_STOP_GRACE_MS
  while (Date.now() < deadline) {
    if (!processGroupIsAlive(identity)) return true
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50))
  }
  return !processGroupIsAlive(identity)
}

async function killProcessGroup(identity: LocalDemoProcessIdentity | undefined): Promise<void> {
  if (!identity || !processGroupIsAlive(identity)) return
  try {
    process.kill(-identity.processId, 'SIGTERM')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    return
  }
  if (await waitForProcessGroupExit(identity)) return
  // Re-check the stable identity immediately before the irreversible signal.
  if (!processGroupIsAlive(identity)) return
  try {
    process.kill(-identity.processId, 'SIGKILL')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
}

async function startDetached(command: string, cwd: string, env: Record<string, string>) {
  if (process.platform !== 'linux') throw new Error('local demos require Linux /proc process identity')
  const child = spawn('/bin/sh', ['-c', command], { cwd, env, detached: true, stdio: 'ignore' })
  await new Promise<void>((resolveSpawn, rejectSpawn) => {
    child.once('spawn', resolveSpawn)
    child.once('error', rejectSpawn)
  })
  const processId = child.pid
  if (!processId) throw new Error('demo command did not return a process id')
  const stat = readLinuxProcessStat(processId)
  if (!stat) {
    try {
      process.kill(-processId, 'SIGKILL')
    } catch {
      // The command may already have exited.
    }
    throw new Error('demo command exited before its process identity could be recorded')
  }
  return { child, identity: { processId, processStartTime: stat.startTime } }
}

function listeningSocketInodes(): Map<string, { readonly port: number; readonly loopback: boolean }> {
  const sockets = new Map<string, { readonly port: number; readonly loopback: boolean }>()
  for (const path of ['/proc/net/tcp', '/proc/net/tcp6']) {
    let rows: string[]
    try {
      rows = readFileSync(path, 'utf8').trim().split('\n').slice(1)
    } catch {
      continue
    }
    for (const row of rows) {
      const fields = row.trim().split(/\s+/)
      const [address, rawPort] = (fields[1] ?? '').split(':')
      const port = Number.parseInt(rawPort ?? '', 16)
      if (!Number.isSafeInteger(port) || fields[3] !== '0A' || !fields[9]) continue
      const loopback = address === '0100007F' || address === '00000000000000000000000001000000'
      sockets.set(fields[9], { port, loopback })
    }
  }
  return sockets
}

function groupSocketInodes(identity: LocalDemoProcessIdentity): Set<string> {
  const inodes = new Set<string>()
  for (const member of listLinuxProcessGroup(identity.processId)) {
    let descriptors: string[]
    try {
      descriptors = readdirSync(`/proc/${member.processId}/fd`)
    } catch {
      continue
    }
    for (const descriptor of descriptors) {
      try {
        const target = readlinkSync(`/proc/${member.processId}/fd/${descriptor}`)
        const match = /^socket:\[(\d+)\]$/.exec(target)
        if (match?.[1]) inodes.add(match[1])
      } catch {
        // Descriptor closed during the scan.
      }
    }
  }
  return inodes
}

export const nodeLocalProcessRuntime: LocalDemoProcessRuntime = {
  async start(command, cwd, env) {
    const { child, identity } = await startDetached(command, cwd, env)
    child.unref()
    return identity
  },
  async run(command, cwd, env, timeoutMs) {
    return await new Promise<number>((resolveExit, rejectExit) => {
      if (process.platform !== 'linux') return rejectExit(new Error('local demos require Linux /proc process identity'))
      const child = spawn('/bin/sh', ['-c', command], { cwd, env, detached: true, stdio: 'ignore' })
      let identity: LocalDemoProcessIdentity | undefined
      let settled = false
      const settle = (callback: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        callback()
      }
      const timeout = setTimeout(() => {
        void killProcessGroup(identity).then(
          () => settle(() => rejectExit(new Error(`command timed out after ${timeoutMs}ms`))),
          (error) => settle(() => rejectExit(error)),
        )
      }, timeoutMs)
      timeout.unref?.()
      child.once('spawn', () => {
        const processId = child.pid
        if (!processId) return
        const stat = readLinuxProcessStat(processId)
        if (stat) identity = { processId, processStartTime: stat.startTime }
      })
      child.once('error', (error) => {
        settle(() => rejectExit(error))
      })
      child.once('exit', (code, signal) => {
        settle(() => {
          if (signal) rejectExit(new Error(`command terminated by ${signal}`))
          else resolveExit(code ?? 1)
        })
      })
    })
  },
  isAlive: processGroupIsAlive,
  isListeningOnLoopback(identity, port) {
    const listeners = listeningSocketInodes()
    const ownedListeners = [...groupSocketInodes(identity)]
      .map((inode) => listeners.get(inode))
      .filter((listener): listener is { readonly port: number; readonly loopback: boolean } => listener !== undefined)
    return ownedListeners.some((listener) => listener.port === port) && ownedListeners.every((listener) => listener.loopback)
  },
  stop: killProcessGroup,
}

export async function portIsAvailable(port: number): Promise<boolean> {
  return await new Promise((resolveAvailable, rejectAvailable) => {
    const server = createServer()
    server.unref()
    server.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') resolveAvailable(false)
      else rejectAvailable(error)
    })
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      server.close(() => resolveAvailable(true))
    })
  })
}

export async function resolveLocalPort(
  requestedPort: number,
  available: (port: number) => Promise<boolean>,
  excluded: ReadonlySet<number> = new Set(),
): Promise<number> {
  if (!excluded.has(requestedPort) && await available(requestedPort)) return requestedPort
  for (let port = FALLBACK_PORT_MIN; port <= FALLBACK_PORT_MAX; port += 1) {
    if (port !== requestedPort && !excluded.has(port) && await available(port)) return port
  }
  throw new Error(
    `requested port ${requestedPort} is busy and no port is available in ${FALLBACK_PORT_MIN}-${FALLBACK_PORT_MAX}`,
  )
}
