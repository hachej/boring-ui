/**
 * Minimal E2E dev server — recreates the CLI entry point that was removed in
 * f0313c8. Starts the Fastify agent API and a Vite dev frontend, then emits
 * "[cli] listening at http://..." so that e2e/helpers/backend.ts can discover
 * the browser URL.
 *
 * Accepted flags (others are silently ignored for back-compat):
 *   --port <n>         API port
 *   --mode <id>        Runtime mode (default: direct)
 *   --workspace <path> Workspace root
 */
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createServer as createViteServer } from 'vite'
import react from '@vitejs/plugin-react'
import { createAgentApp } from '../server/createAgentApp'
import type { RuntimeModeId } from '../server/runtime/mode'

// ── Arg parsing ───────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): { port: number; mode: RuntimeModeId; workspaceRoot: string } {
  let port = 0
  let mode: RuntimeModeId = 'direct'
  let workspaceRoot = process.cwd()

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if ((arg === '--port' || arg === '-p') && argv[i + 1]) {
      port = Number(argv[++i])
    } else if (arg === '--mode' && argv[i + 1]) {
      mode = argv[++i] as RuntimeModeId
    } else if ((arg === '--workspace' || arg === '-w') && argv[i + 1]) {
      workspaceRoot = argv[++i]!
    }
  }

  return { port, mode, workspaceRoot }
}

// ── Version ───────────────────────────────────────────────────────────────────

async function readVersion(): Promise<string> {
  const pkgPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..', '..', 'package.json',
  )
  try {
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as { name?: string; version?: string }
    return `${pkg.name ?? '@boring/agent'}@${pkg.version ?? '0.0.0'}`
  } catch {
    return '@boring/agent@0.0.0'
  }
}

// ── Vite frontend ─────────────────────────────────────────────────────────────

async function startFrontend(apiPort: number): Promise<string> {
  const thisDir = path.dirname(fileURLToPath(import.meta.url))
  const playgroundRoot = path.resolve(thisDir, '..', '..', '..', '..', 'apps', 'agent-playground')
  const packageSrc = path.resolve(thisDir, '..')
  const apiTarget = `http://127.0.0.1:${apiPort}`

  // Dynamic import so the file can be resolved without @tailwindcss/vite in
  // package.json — it's available transitively from agent-playground.
  const { default: tailwindcss } = await import('@tailwindcss/vite')

  const vite = await createViteServer({
    configFile: false,
    root: playgroundRoot,
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@boring/agent/front/styles.css': path.resolve(packageSrc, 'front/styles/globals.css'),
        '@boring/agent/front': path.resolve(packageSrc, 'front/index.ts'),
        '@boring/agent/shared': path.resolve(packageSrc, 'shared/index.ts'),
        '@boring/agent/server': path.resolve(packageSrc, 'server/index.ts'),
        '@': packageSrc,
      },
    },
    server: {
      port: 0,
      strictPort: false,
      host: '127.0.0.1',
      proxy: {
        '/api': apiTarget,
        '/health': apiTarget,
        '/ready': apiTarget,
      },
    },
    logLevel: 'silent',
  })

  await vite.listen()

  const addr = vite.httpServer?.address()
  if (!addr || typeof addr === 'string') throw new Error('Vite did not bind to a port')
  return `http://127.0.0.1:${addr.port}/`
}

// ── Main ──────────────────────────────────────────────────────────────────────

const { port, mode, workspaceRoot } = parseArgs(process.argv.slice(2))
const version = await readVersion()

const app = await createAgentApp({
  mode,
  workspaceRoot,
  sessionId: 'e2e',
  version,
  logger: false,
})

const apiAddress = await app.listen({ port, host: '127.0.0.1' })
const apiPort = Number(new URL(apiAddress).port)

const frontendUrl = await startFrontend(apiPort)

// Emit the URL pattern that e2e/helpers/backend.ts (findBrowserUrl) scans for.
process.stderr.write(`[cli] listening at ${frontendUrl}\n`)
