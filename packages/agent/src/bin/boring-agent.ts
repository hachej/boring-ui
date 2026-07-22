/**
 * Minimal E2E dev server — recreates the CLI entry point that was removed in
 * f0313c8. Starts the Fastify agent API and a Vite dev frontend, then emits
 * "[cli] listening at http://..." so that e2e/helpers/backend.ts can discover
 * the browser URL.
 *
 * Accepted flags:
 *   --port <n>         API port
 *   --mode <id>        Runtime mode (default: direct)
 *   --workspace <path> Workspace root
 *   --dev             Accepted for legacy E2E helpers; no-op
 *   --no-open         Accepted for legacy E2E helpers; no-op
 *   --no-gitignore    Accepted for legacy E2E helpers; no-op
 */
import path from 'node:path'
import os from 'node:os'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createServer as createViteServer } from 'vite'
import react from '@vitejs/plugin-react'
import { createAgentApp } from '../server/createAgentApp'
import type { RuntimeModeId } from '../server/runtime/mode'
import { projectNameFromWorkspaceRoot } from './projectName'
import { createScriptedPiHarness } from '../server/testing/scriptedPiHarness'
import {
  agentSandboxRuntimeHostOperations,
  createAgentSandboxRuntimeModeAdapter,
} from '../../host/sandbox'

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
    } else if (arg === '--dev' || arg === '--no-open' || arg === '--no-gitignore') {
      // Legacy E2E helper flags; this bin is already a non-opening dev server.
    } else {
      throw new Error(`unknown argument: ${arg}`)
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
    return `${pkg.name ?? '@hachej/boring-agent'}@${pkg.version ?? '0.0.0'}`
  } catch {
    return '@hachej/boring-agent@0.0.0'
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
    // Store pre-bundled deps in a tmpdir shared across all E2E backends in the
    // same OS session. Avoids both (a) racing on the project-local
    // node_modules/.vite/deps when parallel workers run concurrently and
    // (b) cold-rebuilding on every sequential test in CI.
    cacheDir: path.join(os.tmpdir(), 'vite-boring-agent-cache'),
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@hachej/boring-agent/front/styles.css': path.resolve(packageSrc, 'front/styles/globals.css'),
        '@hachej/boring-agent/front': path.resolve(packageSrc, 'front/index.ts'),
        '@hachej/boring-agent/shared': path.resolve(packageSrc, 'shared/index.ts'),
        '@hachej/boring-agent/server': path.resolve(packageSrc, 'server/index.ts'),
        '@': packageSrc,
      },
    },
    server: {
      port: 0,
      strictPort: false,
      host: '127.0.0.1',
      hmr: false,
      // E2E starts many short-lived servers; watching can hit the host watcher limit.
      watch: null,
      proxy: {
        '/api': apiTarget,
        '/health': apiTarget,
        '/ready': apiTarget,
      },
    },
    logLevel: 'silent',
  } as any)

  await vite.listen()

  const addr = vite.httpServer?.address()
  if (!addr || typeof addr === 'string') throw new Error('Vite did not bind to a port')
  return `http://127.0.0.1:${addr.port}/`
}

// ── Main ──────────────────────────────────────────────────────────────────────

const { port, mode, workspaceRoot } = parseArgs(process.argv.slice(2))
const version = await readVersion()
const projectName = projectNameFromWorkspaceRoot(workspaceRoot)

const app = await createAgentApp({
  mode,
  runtimeModeAdapter: createAgentSandboxRuntimeModeAdapter(mode),
  runtimeHost: agentSandboxRuntimeHostOperations,
  workspaceRoot,
  sessionId: 'e2e',
  // This localhost-only dev/E2E host is intentionally a trusted direct/local composition.
  trustedDirectLocalNativeSessions: true,
  version,
  logger: false,
  ...(process.env.BORING_AGENT_E2E_SCRIPTED_PI === '1'
    ? { harnessFactory: createScriptedPiHarness }
    : {}),
})

// Allow cross-origin requests from the Vite dev server so that
// browserPage.evaluate() calls to the raw API port work in E2E tests.
// Set headers on reply.raw so they survive reply.hijack() for streaming responses.
app.addHook('onRequest', async (request, reply) => {
  reply.raw.setHeader('Access-Control-Allow-Origin', '*')
  reply.raw.setHeader('Access-Control-Expose-Headers', 'X-Turn-Id')
  if (request.method === 'OPTIONS') {
    reply.raw.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
    reply.raw.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Turn-Id')
    reply.hijack()
    reply.raw.writeHead(204)
    reply.raw.end()
  }
})

const apiAddress = await app.listen({ port, host: '127.0.0.1' })
const apiPort = Number(new URL(apiAddress).port)

// Pre-create a default session so the frontend's session list finds one
// on first load and renders the ChatPanel without requiring the user to click
// "Create session". The E2E tests were written against a single-session app.
try {
  await fetch(`http://127.0.0.1:${apiPort}/api/v1/agent/pi-chat/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: projectName }),
  })
} catch {
  // Non-fatal — tests that don't need a pre-existing session still work.
}

const frontendUrl = await startFrontend(apiPort)

// Emit the URL pattern that e2e/helpers/backend.ts (findBrowserUrl) scans for.
process.stderr.write(`[cli] listening at ${frontendUrl}\n`)
