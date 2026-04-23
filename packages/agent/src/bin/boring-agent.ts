import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import {
  access,
  chmod,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import type { FastifyInstance } from 'fastify'
import type { ViteDevServer } from 'vite'
import packageJson from '../../package.json'
import { createAgentApp } from '../server/createAgentApp'
import type { RuntimeModeId } from '../server/runtime/mode'
import { autoDetectMode } from '../server/runtime/resolveMode'

export const CLI_VERSION = String(packageJson.version ?? '0.0.0')
const HEALTH_VERSION = `@boring/agent@${CLI_VERSION}`
const CLI_PREFIX = '[cli]'
const DEFAULT_PORT = 8787
const DEFAULT_VITE_PORT = 5180
const MAX_PORT_ATTEMPTS = 10
const DEFAULT_CONFIG_DIR = path.join(homedir(), '.config', 'boring-agent')
const DEFAULT_CONFIG_PATH = path.join(DEFAULT_CONFIG_DIR, 'config.toml')
const DEFAULT_ENV_PATH = path.join(DEFAULT_CONFIG_DIR, 'env')

type HealthProbeResult = 'ours' | 'other' | 'unreachable'

interface ParsedArgs {
  workspacePositional?: string
  port?: number
  mode?: string
  model?: string
  noOpen?: boolean
  noGitignore?: boolean
  workspace?: string
  configPath?: string
  logout?: boolean
  resetKey?: boolean
  dev?: boolean
  verbose?: boolean
  help?: boolean
  version?: boolean
}

interface FileConfig {
  port?: number
  mode?: string
  model?: string
  workspace?: string
  noOpen?: boolean
  noGitignore?: boolean
  dev?: boolean
  verbose?: boolean
}

export interface ResolvedConfig {
  workspaceRoot: string
  workspaceId: string
  port: number
  mode: RuntimeModeId
  model?: string
  noOpen: boolean
  noGitignore: boolean
  logout: boolean
  resetKey: boolean
  dev: boolean
  verbose: boolean
}

export interface BrowserOpenDecision {
  open: boolean
  reason?: 'no-open' | 'ssh' | 'ci' | 'headless-linux'
}

export interface PortSelection {
  port: number
  attempts: number
  reuseExisting: boolean
}

interface RunOptions {
  argv?: string[]
  env?: NodeJS.ProcessEnv
  envPath?: string
}

function usageText(): string {
  return [
    '@boring/agent CLI',
    '',
    'Usage:',
    '  boring-agent [workspace] [flags]',
    '',
    'Flags:',
    '  --port <n>         HTTP port (default: 8787, auto-increment on conflict)',
    '  --mode <m>         direct | local | vercel-sandbox (default: auto)',
    '  --model <id>       Claude model override',
    '  --no-open          Skip browser auto-open',
    '  --no-gitignore     Skip .gitignore hygiene',
    '  --workspace <path> Workspace root (default: cwd)',
    `  --config <file>    Config file (default: ${DEFAULT_CONFIG_PATH})`,
    '  --logout           Remove persisted API key and exit',
    '  --reset-key        Delete persisted key and re-prompt',
    '  --dev              Start API + Vite HMR frontend',
    '  --verbose, -v      Verbose startup logs',
    '  --help, -h         Show this help',
    '  --version          Print version',
  ].join('\n')
}

function parsePositiveInt(raw: string, name: string): number {
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0 || value > 65_535) {
    throw new Error(
      `${name} must be an integer between 1 and 65535 (received "${raw}").`,
    )
  }
  return value
}

function parseBoolean(raw?: string): boolean | undefined {
  if (typeof raw !== 'string') return undefined
  const normalized = raw.trim().toLowerCase()
  if (!normalized) return undefined
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return undefined
}

function parseMode(raw?: string): RuntimeModeId | undefined {
  if (!raw) return undefined
  if (raw === 'direct' || raw === 'local' || raw === 'vercel-sandbox') {
    return raw
  }
  throw new Error(
    `Invalid mode "${raw}". Expected direct, local, or vercel-sandbox.`,
  )
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {}

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--port') {
      const value = argv[i + 1]
      if (!value) throw new Error('--port requires a value.')
      parsed.port = parsePositiveInt(value, '--port')
      i += 1
      continue
    }
    if (token === '--mode') {
      const value = argv[i + 1]
      if (!value) throw new Error('--mode requires a value.')
      parsed.mode = value
      i += 1
      continue
    }
    if (token === '--model') {
      const value = argv[i + 1]
      if (!value) throw new Error('--model requires a value.')
      parsed.model = value
      i += 1
      continue
    }
    if (token === '--workspace') {
      const value = argv[i + 1]
      if (!value) throw new Error('--workspace requires a value.')
      parsed.workspace = value
      i += 1
      continue
    }
    if (token === '--config') {
      const value = argv[i + 1]
      if (!value) throw new Error('--config requires a value.')
      parsed.configPath = value
      i += 1
      continue
    }
    if (token === '--no-open') {
      parsed.noOpen = true
      continue
    }
    if (token === '--no-gitignore') {
      parsed.noGitignore = true
      continue
    }
    if (token === '--logout') {
      parsed.logout = true
      continue
    }
    if (token === '--reset-key') {
      parsed.resetKey = true
      continue
    }
    if (token === '--dev') {
      parsed.dev = true
      continue
    }
    if (token === '--verbose' || token === '-v') {
      parsed.verbose = true
      continue
    }
    if (token === '--help' || token === '-h') {
      parsed.help = true
      continue
    }
    if (token === '--version') {
      parsed.version = true
      continue
    }
    if (token.startsWith('-')) {
      throw new Error(`Unknown flag: ${token}`)
    }
    if (parsed.workspacePositional) {
      throw new Error(`Unexpected positional argument: ${token}`)
    }
    parsed.workspacePositional = token
  }

  return parsed
}

function stripInlineComment(line: string): string {
  const hashIndex = line.indexOf('#')
  if (hashIndex === -1) return line
  return line.slice(0, hashIndex)
}

function parseTomlScalar(rawValue: string): string | number | boolean | undefined {
  const trimmed = rawValue.trim()
  if (!trimmed) return undefined
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  const numeric = Number(trimmed)
  if (Number.isFinite(numeric)) return numeric
  return trimmed
}

function applyConfigValue(
  target: FileConfig,
  section: string | undefined,
  key: string,
  value: string | number | boolean,
): void {
  const normalizedSection = section?.trim().toLowerCase()
  const normalizedKey = key.trim().toLowerCase().replace(/-/g, '_')

  if (
    normalizedSection === 'runtime' &&
    normalizedKey === 'mode' &&
    typeof value === 'string'
  ) {
    target.mode = value
    return
  }

  if (
    normalizedSection &&
    normalizedSection !== 'cli' &&
    normalizedSection !== 'workspace'
  ) {
    return
  }

  if (normalizedKey === 'port' && typeof value === 'number') {
    target.port = value
    return
  }
  if (normalizedKey === 'mode' && typeof value === 'string') {
    target.mode = value
    return
  }
  if (normalizedKey === 'model' && typeof value === 'string') {
    target.model = value
    return
  }
  if (normalizedKey === 'workspace' && typeof value === 'string') {
    target.workspace = value
    return
  }
  if (
    normalizedSection === 'workspace' &&
    normalizedKey === 'root' &&
    typeof value === 'string'
  ) {
    target.workspace = value
    return
  }
  if (normalizedKey === 'no_open' && typeof value === 'boolean') {
    target.noOpen = value
    return
  }
  if (normalizedKey === 'no_gitignore' && typeof value === 'boolean') {
    target.noGitignore = value
    return
  }
  if (normalizedKey === 'dev' && typeof value === 'boolean') {
    target.dev = value
    return
  }
  if (normalizedKey === 'verbose' && typeof value === 'boolean') {
    target.verbose = value
  }
}

async function readConfigFile(
  configPath: string,
  required: boolean,
): Promise<FileConfig> {
  let raw = ''
  try {
    raw = await readFile(configPath, 'utf8')
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException
    if (nodeError.code === 'ENOENT' && !required) {
      return {}
    }
    throw error
  }

  const result: FileConfig = {}
  let section: string | undefined
  const lines = raw.split(/\r?\n/u)
  for (const line of lines) {
    const trimmed = stripInlineComment(line).trim()
    if (!trimmed) continue
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      section = trimmed.slice(1, -1).trim().toLowerCase()
      continue
    }
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex <= 0) continue
    const key = trimmed.slice(0, eqIndex).trim()
    const value = parseTomlScalar(trimmed.slice(eqIndex + 1))
    if (typeof value === 'undefined') continue
    applyConfigValue(result, section, key, value)
  }

  return result
}

function resolveConfigPath(args: ParsedArgs, env: NodeJS.ProcessEnv): {
  path: string
  required: boolean
} {
  if (args.configPath) {
    return { path: path.resolve(args.configPath), required: true }
  }
  if (env.BORING_AGENT_CONFIG) {
    return { path: path.resolve(env.BORING_AGENT_CONFIG), required: true }
  }
  return { path: DEFAULT_CONFIG_PATH, required: false }
}

function workspaceIdFromPath(workspaceRoot: string): string {
  const absolute = path.resolve(workspaceRoot)
  return createHash('sha256').update(absolute).digest('hex').slice(0, 12)
}

export async function resolveCliConfig(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<ResolvedConfig & Pick<ParsedArgs, 'help' | 'version'>> {
  const args = parseArgs(argv)
  const configPathMeta = resolveConfigPath(args, env)
  const fileConfig = await readConfigFile(
    configPathMeta.path,
    configPathMeta.required,
  )

  const workspaceRoot = path.resolve(
    args.workspace ??
      args.workspacePositional ??
      env.BORING_AGENT_WORKSPACE_ROOT ??
      fileConfig.workspace ??
      process.cwd(),
  )

  const port = args.port ??
    parsePositiveInt(
      env.BORING_AGENT_PORT ?? String(fileConfig.port ?? DEFAULT_PORT),
      'port',
    )

  const explicitMode = parseMode(
    args.mode ?? env.BORING_AGENT_MODE ?? fileConfig.mode,
  )
  const mode = explicitMode ?? autoDetectMode()

  const noOpen = args.noOpen ??
    parseBoolean(env.BORING_AGENT_NO_OPEN) ??
    fileConfig.noOpen ??
    false

  const noGitignore = args.noGitignore ??
    parseBoolean(env.BORING_AGENT_NO_GITIGNORE) ??
    fileConfig.noGitignore ??
    false

  const dev = args.dev ?? parseBoolean(env.BORING_AGENT_DEV) ?? fileConfig.dev ?? false
  const verbose = args.verbose ??
    parseBoolean(env.BORING_AGENT_VERBOSE) ??
    fileConfig.verbose ??
    false

  return {
    workspaceRoot,
    workspaceId: workspaceIdFromPath(workspaceRoot),
    port,
    mode,
    model: args.model ?? env.BORING_AGENT_MODEL ?? fileConfig.model,
    noOpen,
    noGitignore,
    logout: args.logout ?? false,
    resetKey: args.resetKey ?? false,
    dev,
    verbose,
    help: args.help ?? false,
    version: args.version ?? false,
  }
}

export function parsePersistedEnv(raw: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex <= 0) continue
    const key = trimmed.slice(0, eqIndex).trim()
    const value = trimmed.slice(eqIndex + 1).trim()
    values[key] = value
  }
  return values
}

async function readPersistedEnv(envPath: string): Promise<Record<string, string>> {
  try {
    const raw = await readFile(envPath, 'utf8')
    return parsePersistedEnv(raw)
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException
    if (nodeError.code === 'ENOENT') return {}
    throw error
  }
}

function serializePersistedEnv(apiKey: string, now = new Date()): string {
  return [
    `# Added by boring-agent CLI on ${now.toISOString()}`,
    `ANTHROPIC_API_KEY=${apiKey}`,
    '',
  ].join('\n')
}

export async function persistApiKey(envPath: string, apiKey: string): Promise<void> {
  const dir = path.dirname(envPath)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await chmod(dir, 0o700)
  await writeFile(envPath, serializePersistedEnv(apiKey), {
    encoding: 'utf8',
    mode: 0o600,
  })
  await chmod(envPath, 0o600)
}

export async function deletePersistedKey(envPath: string): Promise<boolean> {
  try {
    await rm(envPath, { force: true })
    return true
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException
    if (nodeError.code === 'ENOENT') return false
    throw error
  }
}

async function promptHidden(label: string): Promise<string> {
  process.stdout.write(label)
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  })
  const mutable = rl as readline.Interface & {
    _writeToOutput?: (message: string) => void
  }
  const originalWrite = mutable._writeToOutput
  mutable._writeToOutput = () => {}

  return new Promise((resolve) => {
    rl.question('', (answer) => {
      mutable._writeToOutput = originalWrite
      rl.close()
      process.stdout.write('\n')
      resolve(answer.trim())
    })
  })
}

export async function ensureApiKey(
  envPath: string,
  opts: { resetKey: boolean; env: NodeJS.ProcessEnv },
): Promise<'env' | 'persisted' | 'prompt'> {
  if (opts.resetKey) {
    await deletePersistedKey(envPath)
    const prompted = await promptHidden('ANTHROPIC_API_KEY: ')
    if (!prompted) {
      throw new Error('ANTHROPIC_API_KEY is required.')
    }
    await persistApiKey(envPath, prompted)
    opts.env.ANTHROPIC_API_KEY = prompted
    return 'prompt'
  }

  const fromEnv = opts.env.ANTHROPIC_API_KEY?.trim()
  if (fromEnv) return 'env'

  const persisted = await readPersistedEnv(envPath)
  const fromFile = persisted.ANTHROPIC_API_KEY?.trim()
  if (fromFile) {
    opts.env.ANTHROPIC_API_KEY = fromFile
    return 'persisted'
  }

  const prompted = await promptHidden('ANTHROPIC_API_KEY: ')
  if (!prompted) {
    throw new Error('ANTHROPIC_API_KEY is required.')
  }
  await persistApiKey(envPath, prompted)
  opts.env.ANTHROPIC_API_KEY = prompted
  return 'prompt'
}

export async function ensureGitignoreEntries(workspaceRoot: string): Promise<boolean> {
  const gitDir = path.join(workspaceRoot, '.git')
  try {
    const gitDirStat = await stat(gitDir)
    if (!gitDirStat.isDirectory()) return false
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException
    if (nodeError.code === 'ENOENT') return false
    throw error
  }

  const gitignorePath = path.join(workspaceRoot, '.gitignore')
  let current = ''
  try {
    current = await readFile(gitignorePath, 'utf8')
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException
    if (nodeError.code !== 'ENOENT') throw error
  }

  const existing = new Set(
    current
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean),
  )
  const missing = ['.boring-agent/', '.pi/'].filter((entry) => !existing.has(entry))
  if (missing.length === 0) return false

  const parts: string[] = [current]
  if (current.length > 0 && !current.endsWith('\n')) {
    parts.push('\n')
  }
  parts.push('# boring-agent local state\n')
  for (const entry of missing) {
    parts.push(`${entry}\n`)
  }

  await writeFile(gitignorePath, parts.join(''), 'utf8')
  return true
}

export function decideBrowserOpen(opts: {
  noOpen: boolean
  env: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
}): BrowserOpenDecision {
  if (opts.noOpen) {
    return { open: false, reason: 'no-open' }
  }
  if (opts.env.SSH_TTY || opts.env.SSH_CONNECTION) {
    return { open: false, reason: 'ssh' }
  }
  const ciRaw = opts.env.CI?.trim()
  if (ciRaw) {
    const normalized = ciRaw.toLowerCase()
    if (!['0', 'false', 'no', 'off'].includes(normalized)) {
      return { open: false, reason: 'ci' }
    }
  }
  const platform = opts.platform ?? process.platform
  if (
    platform === 'linux' &&
    !opts.env.DISPLAY &&
    !opts.env.WAYLAND_DISPLAY
  ) {
    return { open: false, reason: 'headless-linux' }
  }
  return { open: true }
}

function openBrowser(url: string): boolean {
  try {
    if (process.platform === 'darwin') {
      const child = spawn('open', [url], {
        detached: true,
        stdio: 'ignore',
      })
      child.unref()
      return true
    }
    if (process.platform === 'win32') {
      const child = spawn('cmd', ['/c', 'start', '', url], {
        detached: true,
        stdio: 'ignore',
      })
      child.unref()
      return true
    }
    if (process.platform === 'linux') {
      const child = spawn('xdg-open', [url], {
        detached: true,
        stdio: 'ignore',
      })
      child.unref()
      return true
    }
  } catch {
    return false
  }
  return false
}

function mimeTypeFor(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.html':
      return 'text/html; charset=utf-8'
    case '.js':
      return 'text/javascript; charset=utf-8'
    case '.css':
      return 'text/css; charset=utf-8'
    case '.json':
      return 'application/json; charset=utf-8'
    case '.svg':
      return 'image/svg+xml'
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.woff':
      return 'font/woff'
    case '.woff2':
      return 'font/woff2'
    default:
      return 'application/octet-stream'
  }
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

async function resolveFrontendRoot(): Promise<string> {
  const currentFile = fileURLToPath(import.meta.url)
  const currentDir = path.dirname(currentFile)
  const distRoot = path.resolve(currentDir, '..', 'frontend')
  const distIndex = path.join(distRoot, 'index.html')
  if (await fileExists(distIndex)) {
    return distRoot
  }
  throw new Error(
    `Frontend bundle not found at ${distRoot}. Run "pnpm --filter @boring/agent build" or use --dev.`,
  )
}

async function registerFrontendSpa(
  app: FastifyInstance,
  frontendRoot: string,
): Promise<void> {
  const indexPath = path.join(frontendRoot, 'index.html')

  async function sendFileOrIndex(routePath: string, reply: { type: (value: string) => void; send: (body: Buffer) => void }) {
    const requested = routePath === '/' ? 'index.html' : routePath.slice(1)
    const candidate = path.resolve(frontendRoot, requested)
    const inRoot =
      candidate === frontendRoot ||
      candidate.startsWith(`${frontendRoot}${path.sep}`)
    const target = inRoot && (await fileExists(candidate)) ? candidate : indexPath
    const file = await readFile(target)
    reply.type(mimeTypeFor(target))
    reply.send(file)
  }

  app.get('/', async (_request, reply) => {
    await sendFileOrIndex('/', reply)
  })

  app.get('/*', async (request, reply) => {
    const wildcard = (
      request.params as {
        '*': string
      }
    )['*'] ?? ''
    const routePath = `/${wildcard}`
    if (
      routePath === '/health' ||
      routePath === '/ready' ||
      routePath.startsWith('/api/')
    ) {
      return reply.callNotFound()
    }
    await sendFileOrIndex(routePath, reply)
  })
}

export async function probeHealth(
  port: number,
  expectedVersion: string,
): Promise<HealthProbeResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 500)
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      method: 'GET',
      signal: controller.signal,
    })
    if (!response.ok) return 'other'
    const body = (await response.json()) as { version?: unknown }
    return body.version === expectedVersion ? 'ours' : 'other'
  } catch {
    return 'unreachable'
  } finally {
    clearTimeout(timeout)
  }
}

export async function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true))
    })
  })
}

export async function selectPort(opts: {
  startPort: number
  expectedVersion: string
  maxAttempts?: number
  probeHealthFn?: (port: number, expectedVersion: string) => Promise<HealthProbeResult>
  isPortFreeFn?: (port: number) => Promise<boolean>
}): Promise<PortSelection> {
  const maxAttempts = opts.maxAttempts ?? MAX_PORT_ATTEMPTS
  const probe = opts.probeHealthFn ?? probeHealth
  const portFree = opts.isPortFreeFn ?? isPortFree

  for (let offset = 0; offset < maxAttempts; offset += 1) {
    const port = opts.startPort + offset
    const health = await probe(port, opts.expectedVersion)
    if (health === 'ours') {
      return { port, attempts: offset + 1, reuseExisting: true }
    }
    if (await portFree(port)) {
      return { port, attempts: offset + 1, reuseExisting: false }
    }
  }
  throw new Error(
    `No available port after ${maxAttempts} attempts starting at ${opts.startPort}.`,
  )
}

function logVerbose(enabled: boolean, message: string): void {
  if (!enabled) return
  process.stdout.write(`${CLI_PREFIX} ${message}\n`)
}

async function startDevFrontend(apiPort: number): Promise<{
  vite: ViteDevServer
  url: string
}> {
  const [{ createServer }, { default: react }] = await Promise.all([
    import('vite'),
    import('@vitejs/plugin-react'),
  ])

  const currentFile = fileURLToPath(import.meta.url)
  const currentDir = path.dirname(currentFile)
  const appRoot = path.resolve(currentDir, '..', '..', 'app')
  const apiTarget = `http://127.0.0.1:${apiPort}`
  const vite = await createServer({
    root: appRoot,
    plugins: [react()],
    server: {
      port: DEFAULT_VITE_PORT,
      strictPort: false,
      proxy: {
        '/api': apiTarget,
        '/health': apiTarget,
        '/ready': apiTarget,
      },
    },
  })

  await vite.listen()
  const url =
    vite.resolvedUrls?.local?.[0] ??
    vite.resolvedUrls?.network?.[0] ??
    `http://127.0.0.1:${DEFAULT_VITE_PORT}/`

  return { vite, url }
}

function printSshHint(port: number): void {
  process.stdout.write(`Open this URL: http://127.0.0.1:${port}\n`)
  process.stdout.write(`SSH hint: ssh -L ${port}:localhost:${port} <host>\n`)
}

function installShutdownHandlers(opts: {
  app?: FastifyInstance
  vite?: ViteDevServer
  verbose: boolean
}): void {
  let shuttingDown = false

  const shutdown = async (signal: string) => {
    if (shuttingDown) return
    shuttingDown = true
    logVerbose(opts.verbose, `received ${signal}, shutting down`)

    const forceTimer = setTimeout(() => {
      process.stderr.write(`${CLI_PREFIX} shutdown timed out, forcing exit\n`)
      process.exit(1)
    }, 5_000)
    forceTimer.unref()

    try {
      if (opts.vite) {
        await opts.vite.close()
      }
      if (opts.app) {
        await opts.app.close()
      }
      process.stdout.write(`${CLI_PREFIX} shutdown complete\n`)
      process.exit(0)
    } catch (error) {
      process.stderr.write(
        `${CLI_PREFIX} shutdown failed: ${(error as Error).message}\n`,
      )
      process.exit(1)
    } finally {
      clearTimeout(forceTimer)
    }
  }

  process.on('SIGINT', () => {
    void shutdown('SIGINT')
  })
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM')
  })
}

async function startApp(
  config: ResolvedConfig,
  opts: { envPath: string },
): Promise<number> {
  const envPath = opts.envPath
  if (config.logout) {
    await deletePersistedKey(envPath)
    process.stdout.write(`${CLI_PREFIX} cleared persisted API key\n`)
    return 0
  }

  const keySource = await ensureApiKey(envPath, {
    resetKey: config.resetKey,
    env: process.env,
  })
  logVerbose(config.verbose, `api key source: ${keySource}`)

  if (config.model) {
    process.env.BORING_AGENT_MODEL = config.model
  }
  if (config.verbose) {
    process.env.BORING_AGENT_VERBOSE = '1'
  }

  if (!config.noGitignore) {
    const wroteGitignore = await ensureGitignoreEntries(config.workspaceRoot)
    logVerbose(config.verbose, `gitignore hygiene: ${wroteGitignore ? 'updated' : 'unchanged'}`)
  }

  logVerbose(config.verbose, `mode: ${config.mode}`)
  logVerbose(config.verbose, `workspace root: ${config.workspaceRoot}`)
  logVerbose(config.verbose, `workspace id: ${config.workspaceId}`)

  const portSelection = await selectPort({
    startPort: config.port,
    expectedVersion: HEALTH_VERSION,
  })
  logVerbose(
    config.verbose,
    `port selected: ${portSelection.port} (attempt ${portSelection.attempts})`,
  )

  let app: FastifyInstance | undefined
  let vite: ViteDevServer | undefined
  let browserUrl = `http://127.0.0.1:${portSelection.port}`

  if (!portSelection.reuseExisting) {
    app = await createAgentApp({
      workspaceRoot: config.workspaceRoot,
      sessionId: config.workspaceId,
      mode: config.mode,
      version: HEALTH_VERSION,
      logger: config.verbose,
    })

    if (!config.dev) {
      const frontendRoot = await resolveFrontendRoot()
      await registerFrontendSpa(app, frontendRoot)
    }

    await app.listen({
      host: '127.0.0.1',
      port: portSelection.port,
    })
  }

  if (config.dev) {
    const devServer = await startDevFrontend(portSelection.port)
    vite = devServer.vite
    browserUrl = devServer.url
    logVerbose(config.verbose, `vite dev server: ${browserUrl}`)
  }

  if (portSelection.reuseExisting && !vite) {
    process.stdout.write(
      `${CLI_PREFIX} attached to existing server at ${browserUrl}\n`,
    )
  } else {
    process.stdout.write(`${CLI_PREFIX} listening at ${browserUrl}\n`)
  }

  const browserDecision = decideBrowserOpen({
    noOpen: config.noOpen,
    env: process.env,
  })
  if (browserDecision.open) {
    const opened = openBrowser(browserUrl)
    logVerbose(
      config.verbose,
      `browser open: ${opened ? 'launched' : 'failed to launch'}`,
    )
  } else {
    process.stdout.write(
      `${CLI_PREFIX} browser-open skipped (${browserDecision.reason})\n`,
    )
    if (browserDecision.reason === 'ssh' || browserDecision.reason === 'headless-linux') {
      printSshHint(portSelection.port)
    } else {
      process.stdout.write(`Open this URL: ${browserUrl}\n`)
    }
  }

  if (portSelection.reuseExisting && !vite) {
    return 0
  }

  installShutdownHandlers({ app, vite, verbose: config.verbose })
  return 0
}

export async function runCli(opts: RunOptions = {}): Promise<number> {
  const argv = opts.argv ?? process.argv.slice(2)
  const env = opts.env ?? process.env
  const envPath = opts.envPath ?? DEFAULT_ENV_PATH
  const config = await resolveCliConfig(argv, env)

  if (config.help) {
    process.stdout.write(`${usageText()}\n`)
    return 0
  }
  if (config.version) {
    process.stdout.write(`${CLI_VERSION}\n`)
    return 0
  }

  return startApp(config, { envPath })
}

function isCliEntrypoint(): boolean {
  const argvPath = process.argv[1]
  if (!argvPath) return false
  return path.resolve(argvPath) === fileURLToPath(import.meta.url)
}

if (isCliEntrypoint()) {
  runCli().catch((error) => {
    process.stderr.write(`${CLI_PREFIX} ${(error as Error).message}\n`)
    process.exitCode = 1
  })
}
