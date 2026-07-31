import { lstat, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, dirname, resolve } from 'node:path'

const SYSTEM_ENV_ALLOWLIST = Object.freeze([
  'HOME',
  'LANG',
  'LC_ALL',
  'LOGNAME',
  'PATH',
  'SHELL',
  'TEMP',
  'TMP',
  'TMPDIR',
  'TZ',
  'USER',
] as const)

export function buildHermeticDevSmokeEnv(
  exampleEnv: Readonly<Record<string, string>>,
  overrides: Readonly<Record<string, string>>,
  ambientEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const systemEnv = Object.fromEntries(
    SYSTEM_ENV_ALLOWLIST.flatMap((key) => {
      const value = ambientEnv[key]
      return value === undefined ? [] : [[key, value]]
    }),
  )
  return {
    ...systemEnv,
    ...exampleEnv,
    ...overrides,
  }
}

export function devSmokeTempRootPrefix(ownerPid: number): string {
  if (!Number.isInteger(ownerPid) || ownerPid < 1) {
    throw new Error('dev smoke temp-root owner PID must be a positive integer')
  }
  return `boring-full-app-smoke-${ownerPid}-`
}

type TempRootStats = {
  isDirectory(): boolean
  isSymbolicLink(): boolean
}

type RemoveOwnedDevSmokeTempRootOptions = {
  ownerPid?: number
  tempDirectory?: string
  inspect?: (path: string) => Promise<TempRootStats>
  remove?: (path: string, options: { recursive: true; force: false }) => Promise<void>
}

export async function removeOwnedDevSmokeTempRoot(
  tempRoot: string,
  options: RemoveOwnedDevSmokeTempRootOptions = {},
): Promise<void> {
  const ownerPid = options.ownerPid ?? process.pid
  const tempDirectory = resolve(options.tempDirectory ?? tmpdir())
  const ownedRoot = resolve(tempRoot)
  const prefix = devSmokeTempRootPrefix(ownerPid)
  const name = basename(ownedRoot)
  const suffix = name.slice(prefix.length)

  if (
    dirname(ownedRoot) !== tempDirectory
    || !name.startsWith(prefix)
    || suffix.length < 6
    || !/^[A-Za-z0-9_-]+$/.test(suffix)
  ) {
    throw new Error(`refusing to remove unowned dev smoke temp root: ${ownedRoot}`)
  }

  const inspect = options.inspect ?? lstat
  let stats: TempRootStats
  try {
    stats = await inspect(ownedRoot)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`refusing to remove unsafe dev smoke temp root: ${ownedRoot}`)
  }

  const remove = options.remove ?? rm
  await remove(ownedRoot, { recursive: true, force: false })
}

function listenOnEphemeralLoopbackPort(): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
      server.off('error', reject)
      resolve(server)
    })
  })
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
}

export async function allocateFreeLoopbackPorts(count: number): Promise<number[]> {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error('port allocation count must be a positive integer')
  }

  const reservations: Server[] = []
  try {
    for (let index = 0; index < count; index += 1) {
      reservations.push(await listenOnEphemeralLoopbackPort())
    }
    return reservations.map((server) => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        throw new Error('loopback port reservation did not expose a TCP address')
      }
      return address.port
    })
  } finally {
    await Promise.all(reservations.map(closeServer))
  }
}
