import { spawn } from 'node:child_process'
import { readlinkSync } from 'node:fs'
import { createServer } from 'node:net'
import { resolve } from 'node:path'

const FALLBACK_PORT_MIN = 4300
const FALLBACK_PORT_MAX = 4399
const PROCESS_STOP_GRACE_MS = 1_000

export interface LocalDemoProcessRuntime {
  start(command: string, cwd: string, port: number): Promise<number>
  isAlive(processId: number | undefined, cwd?: string): boolean
  stop(processId: number | undefined, cwd?: string): Promise<void>
}

function processGroupIsAlive(processId: number | undefined, cwd?: string): boolean {
  if (!processId || !Number.isSafeInteger(processId) || processId <= 0) return false
  try {
    process.kill(process.platform === 'win32' ? processId : -processId, 0)
    if (cwd && process.platform === 'linux') {
      return resolve(readlinkSync(`/proc/${processId}/cwd`)) === resolve(cwd)
    }
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

async function waitForProcessGroupExit(processId: number, cwd?: string): Promise<boolean> {
  const deadline = Date.now() + PROCESS_STOP_GRACE_MS
  while (Date.now() < deadline) {
    if (!processGroupIsAlive(processId, cwd)) return true
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50))
  }
  return !processGroupIsAlive(processId, cwd)
}

async function killProcessGroup(processId: number | undefined, cwd?: string): Promise<void> {
  if (!processId || !processGroupIsAlive(processId, cwd)) return
  const target = process.platform === 'win32' ? processId : -processId
  try {
    process.kill(target, 'SIGTERM')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    return
  }
  if (await waitForProcessGroupExit(processId, cwd)) return
  try {
    process.kill(target, 'SIGKILL')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
}

export const nodeLocalProcessRuntime: LocalDemoProcessRuntime = {
  async start(command, cwd, port) {
    const child = spawn(command, {
      cwd,
      env: {
        ...process.env,
        PORT: String(port),
        HOST: '127.0.0.1',
        BORING_FACTORY_DEMO_PORT: String(port),
      },
      shell: true,
      detached: process.platform !== 'win32',
      stdio: 'ignore',
    })
    await new Promise<void>((resolveSpawn, rejectSpawn) => {
      child.once('spawn', resolveSpawn)
      child.once('error', rejectSpawn)
    })
    const processId = child.pid
    if (!processId) throw new Error('demo command did not return a process id')
    child.unref()
    return processId
  },
  isAlive: processGroupIsAlive,
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
): Promise<number> {
  if (await available(requestedPort)) return requestedPort
  for (let port = FALLBACK_PORT_MIN; port <= FALLBACK_PORT_MAX; port += 1) {
    if (port !== requestedPort && await available(port)) return port
  }
  throw new Error(
    `requested port ${requestedPort} is busy and no port is available in ${FALLBACK_PORT_MIN}-${FALLBACK_PORT_MAX}`,
  )
}
