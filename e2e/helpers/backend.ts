import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const DEFAULT_BOOT_TIMEOUT_MS = 30_000
const HEALTH_POLL_INTERVAL_MS = 200
const PROCESS_EXIT_TIMEOUT_MS = 5_000
const SOURCE_BROWSER_URL_TIMEOUT_MS = 5_000
const MAX_PORT_INCREMENT_PROBE = 10

export interface BackendLogs {
  stdout: string[]
  stderr: string[]
}

export interface SpawnedBackend {
  // Back-compat alias for API URL.
  url: string
  apiUrl: string
  browserUrl: string
  port: number
  logs: BackendLogs
  stop(): Promise<void>
}

export interface SpawnBackendOptions {
  workspaceRoot: string
  repoRoot: string
  port?: number
  timeoutMs?: number
}

interface LineCollector {
  push(chunk: Buffer | string): void
  flush(): void
}

function createLineCollector(target: string[]): LineCollector {
  let pending = ''

  return {
    push(chunk) {
      const text = pending + chunk.toString('utf8')
      const lines = text.split(/\r?\n/u)
      pending = lines.pop() ?? ''
      for (const line of lines) {
        if (line.length > 0) {
          target.push(line)
        }
      }
    },
    flush() {
      if (pending.length > 0) {
        target.push(pending)
        pending = ''
      }
    },
  }
}

function findOpenPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('failed to allocate open port')))
        return
      }
      const { port } = address
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve(port)
      })
    })
  })
}

async function probeHealthPort(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`)
    if (!response.ok) {
      return false
    }
    const body = (await response.json()) as { version?: unknown }
    return typeof body.version === 'string' && body.version.startsWith('@boring/agent@')
  } catch {
    return false
  }
}

async function waitForExit(
  child: ReturnType<typeof spawn>,
  timeoutMs: number,
): Promise<void> {
  if (child.exitCode !== null) return

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.removeListener('exit', onExit)
      reject(new Error(`backend did not exit within ${timeoutMs}ms`))
    }, timeoutMs)

    const onExit = () => {
      clearTimeout(timeout)
      resolve()
    }

    child.once('exit', onExit)
  })
}

async function waitForHealthy(
  requestedPort: number,
  child: ReturnType<typeof spawn>,
  logs: BackendLogs,
  timeoutMs: number,
): Promise<number> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(
        `backend exited before becoming healthy (exit=${child.exitCode})\n${formatLogs(logs)}`,
      )
    }

    for (let offset = 0; offset <= MAX_PORT_INCREMENT_PROBE; offset += 1) {
      const candidatePort = requestedPort + offset
      if (await probeHealthPort(candidatePort)) {
        return candidatePort
      }
    }

    await sleep(HEALTH_POLL_INTERVAL_MS)
  }

  throw new Error(
    `backend health check timed out after ${timeoutMs}ms (start port=${requestedPort})\n${formatLogs(logs)}`,
  )
}

function findBrowserUrl(logs: BackendLogs): string | undefined {
  const pattern =
    /\[cli\]\s+(?:listening at|attached to existing server at)\s+(http:\/\/(?:127\.0\.0\.1|localhost):\d+\/?)/u

  const allLines = [...logs.stdout, ...logs.stderr]
  for (let index = allLines.length - 1; index >= 0; index -= 1) {
    const line = allLines[index] ?? ''
    const match = line.match(pattern)
    if (match?.[1]) {
      return match[1]
    }
  }
  return undefined
}

async function waitForBrowserUrl(
  logs: BackendLogs,
): Promise<string> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < SOURCE_BROWSER_URL_TIMEOUT_MS) {
    const browserUrl = findBrowserUrl(logs)
    if (browserUrl) {
      return browserUrl
    }
    await sleep(50)
  }
  throw new Error(
    `backend did not emit a browser URL within ${SOURCE_BROWSER_URL_TIMEOUT_MS}ms\n${formatLogs(logs)}`,
  )
}

export function formatLogs(logs: BackendLogs): string {
  const stdout = logs.stdout.join('\n')
  const stderr = logs.stderr.join('\n')
  return [
    '--- backend stdout ---',
    stdout || '(empty)',
    '--- backend stderr ---',
    stderr || '(empty)',
  ].join('\n')
}

export async function spawnBackend(
  options: SpawnBackendOptions,
): Promise<SpawnedBackend> {
  const port = options.port ?? (await findOpenPort())
  const timeoutMs = options.timeoutMs ?? DEFAULT_BOOT_TIMEOUT_MS
  const logs: BackendLogs = { stdout: [], stderr: [] }

  const stdoutCollector = createLineCollector(logs.stdout)
  const stderrCollector = createLineCollector(logs.stderr)
  const agentPackageDir = path.join(options.repoRoot, 'packages', 'agent')

  // The CLI retries bind attempts by incrementing the requested port.
  // waitForHealthy() probes the same increment window to discover the actual API port.
  const child = spawn(
    'node',
    [
      '--import',
      'tsx',
      'src/bin/boring-agent.ts',
      '--dev',
      '--no-open',
      '--no-gitignore',
      '--mode',
      'direct',
      '--port',
      String(port),
      '--workspace',
      options.workspaceRoot,
    ],
    {
      cwd: agentPackageDir,
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? 'e2e-test-key',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )

  child.stdout?.on('data', stdoutCollector.push)
  child.stderr?.on('data', stderrCollector.push)
  child.on('exit', () => {
    stdoutCollector.flush()
    stderrCollector.flush()
  })

  let apiPort: number
  try {
    apiPort = await waitForHealthy(port, child, logs, timeoutMs)
  } catch (error) {
    child.kill('SIGTERM')
    await waitForExit(child, PROCESS_EXIT_TIMEOUT_MS).catch(() => {
      child.kill('SIGKILL')
    })
    throw error
  }

  const apiUrl = `http://127.0.0.1:${apiPort}`
  let browserUrl: string
  try {
    browserUrl = await waitForBrowserUrl(logs)
  } catch (error) {
    child.kill('SIGTERM')
    await waitForExit(child, PROCESS_EXIT_TIMEOUT_MS).catch(() => {
      child.kill('SIGKILL')
    })
    throw error
  }

  return {
    url: apiUrl,
    apiUrl,
    browserUrl,
    port: apiPort,
    logs,
    async stop() {
      if (child.exitCode !== null) {
        return
      }
      child.kill('SIGTERM')
      try {
        await waitForExit(child, PROCESS_EXIT_TIMEOUT_MS)
      } catch {
        child.kill('SIGKILL')
        await waitForExit(child, PROCESS_EXIT_TIMEOUT_MS).catch(() => {
          // Process may already be gone.
        })
      }
    },
  }
}
