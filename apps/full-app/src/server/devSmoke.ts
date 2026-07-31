import { createServer, type Server } from 'node:net'

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
