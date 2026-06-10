import { spawn } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'node:net'
import { setTimeout as sleep } from 'node:timers/promises'

const BOOT_TIMEOUT_MS = 30_000
const EXIT_TIMEOUT_MS = 5_000

const packageRoot = path.resolve(import.meta.dirname, '..')
const workspaceRoot = process.env.BOMBADIL_WORKSPACE_ROOT
  ?? await mkdtemp(path.join(tmpdir(), 'boring-agent-bombadil-workspace.'))
const outputPath = process.env.BOMBADIL_OUTPUT_PATH
  ?? path.join(tmpdir(), 'boring-agent-bombadil-pi-native-chat')
const timeLimit = process.env.BOMBADIL_TIME_LIMIT ?? '30s'
const tickMs = process.env.BORING_AGENT_E2E_SCRIPTED_PI_TICK_MS ?? '650'
const requestedPort = Number.parseInt(process.env.BOMBADIL_AGENT_PORT ?? '', 10)
const port = Number.isFinite(requestedPort) && requestedPort > 0
  ? requestedPort
  : await findOpenPort()

const server = spawn('node', [
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
  workspaceRoot,
], {
  cwd: packageRoot,
  env: {
    ...process.env,
    BORING_AGENT_E2E_SCRIPTED_PI: '1',
    BORING_AGENT_E2E_SCRIPTED_PI_TICK_MS: tickMs,
    CHOKIDAR_USEPOLLING: process.env.CHOKIDAR_USEPOLLING ?? '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

const logs = []
server.stdout.on('data', (chunk) => {
  const text = chunk.toString('utf8')
  logs.push(text)
  process.stdout.write(text)
})
server.stderr.on('data', (chunk) => {
  const text = chunk.toString('utf8')
  logs.push(text)
  process.stderr.write(text)
})

let exitCode = 1

try {
  const browserUrl = await waitForBrowserUrl(server, logs)
  const targetUrl = `${browserUrl.replace(/\/$/, '')}/?piNative=1`

  const result = await runCommand('pnpm', [
    'exec',
    'bombadil',
    'test',
    targetUrl,
    'e2e/bombadil/pi-native-chat.spec.ts',
    '--time-limit',
    timeLimit,
    '--exit-on-violation',
    '--output-path',
    outputPath,
    '--headless',
  ], { cwd: packageRoot })
  exitCode = result
} finally {
  await stop(server)
}

process.exit(exitCode)

function findOpenPort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('failed to allocate open port')))
        return
      }
      server.close((error) => {
        if (error) reject(error)
        else resolve(address.port)
      })
    })
  })
}

async function waitForBrowserUrl(child, logs) {
  const started = Date.now()
  while (Date.now() - started < BOOT_TIMEOUT_MS) {
    if (child.exitCode !== null) {
      throw new Error(`agent server exited before Bombadil target was ready\n${logs.join('')}`)
    }
    const match = logs.join('').match(/\[cli\]\s+(?:listening at|attached to existing server at)\s+(http:\/\/(?:127\.0\.0\.1|localhost):\d+\/?)/u)
    if (match?.[1]) return match[1]
    await sleep(100)
  }
  throw new Error(`timed out waiting for Bombadil target URL\n${logs.join('')}`)
}

function runCommand(command, args, options) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      ...options,
      stdio: 'inherit',
    })
    child.on('exit', (code) => resolve(code ?? 1))
  })
}

async function stop(child) {
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  const exited = await Promise.race([
    new Promise((resolve) => child.once('exit', () => resolve(true))),
    sleep(EXIT_TIMEOUT_MS).then(() => false),
  ])
  if (!exited && child.exitCode === null) {
    child.kill('SIGKILL')
  }
}
