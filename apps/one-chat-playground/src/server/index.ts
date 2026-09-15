import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createServer as createViteServer } from 'vite'

import { createOneChatRuntime } from './agentHost.js'
import { devCspPolicy } from './csp.js'
import { resolveAllowedOriginsFromEnv } from '../shared/allowedOrigins.js'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const repoRoot = path.resolve(appRoot, '../..')
const agentSourceRoot = path.resolve(repoRoot, 'packages/agent/src')
// The user's app. Overridable so a second instance can run against a copy
// without touching the one a live session is using.
const sampleAppRoot = path.resolve(process.env.ONE_CHAT_WORKSPACE_ROOT ?? path.join(appRoot, 'sample-app'))

const frontPort = Number(process.env.ONE_CHAT_PORT ?? 5320)
const sampleAppPort = Number(process.env.SAMPLE_APP_PORT ?? 5321)
// Host the browser uses to reach this machine (a Tailscale IP, a hostname).
// Defaults to loopback for local use; the app iframe must be reachable from the viewer.
const publicHost = process.env.ONE_CHAT_PUBLIC_HOST ?? '127.0.0.1'
const sampleAppUrl = `http://${publicHost}:${sampleAppPort}/`
const sessionRoot = path.resolve(
  process.env.BORING_AGENT_SESSION_ROOT ?? path.join(appRoot, '.boring-agent', 'sessions'),
)

// The user's app. The agent's filesystem and bash tools are rooted here, and
// Vite's HMR is what makes an agent edit show up in the base iframe without
// anyone being told to reload.
const sampleApp: ChildProcess = spawn('pnpm', ['exec', 'vite'], {
  cwd: sampleAppRoot,
  env: { ...process.env, SAMPLE_APP_PORT: String(sampleAppPort), PORT: String(sampleAppPort) },
  stdio: 'inherit',
})
sampleApp.on('exit', (code) => {
  if (code && code !== 0) console.error(`[one-chat] sample app exited with code ${code}`)
})

const allowedOrigins = resolveAllowedOriginsFromEnv()
const cspPolicy = devCspPolicy(allowedOrigins)

const runtime = await createOneChatRuntime({
  workspaceRoot: sampleAppRoot,
  allowedOrigins,
  sessionRoot,
  systemPromptPath: path.join(appRoot, 'prompts', 'system.md'),
  builderPromptPath: path.join(appRoot, 'prompts', 'builder.md'),
  documenterPromptPath: path.join(appRoot, 'prompts', 'documenter.md'),
  appBaseUrl: sampleAppUrl,
})

const apiAddress = await runtime.app.listen({ port: 0, host: '127.0.0.1' })
const apiTarget = `http://127.0.0.1:${new URL(apiAddress).port}`

const vite = await createViteServer({
  configFile: false,
  root: appRoot,
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'one-chat-index',
      configureServer(server) {
        server.middlewares.use((_req, res, next) => {
          res.setHeader('Content-Security-Policy', cspPolicy)
          next()
        })
        server.middlewares.use(async (req, res, next) => {
          if (req.method !== 'GET' || !req.url || !(req.url === '/' || req.url.startsWith('/?'))) {
            next()
            return
          }
          const rawHtml = [
            '<!doctype html>',
            '<html lang="en">',
            '  <head>',
            '    <meta charset="UTF-8" />',
            '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
            `    <script>window.__ONE_CHAT_BASE_URL__ = ${JSON.stringify(sampleAppUrl)}</script>`,
            '    <title>Your app</title>',
            '  </head>',
            '  <body>',
            '    <div id="root"></div>',
            '    <script type="module" src="/src/front/main.tsx"></script>',
            '  </body>',
            '</html>',
          ].join('\n')
          try {
            res.statusCode = 200
            res.setHeader('Content-Type', 'text/html; charset=utf-8')
            res.end(await server.transformIndexHtml(req.url, rawHtml))
          } catch (error) {
            server.ssrFixStacktrace(error as Error)
            next(error)
          }
        })
      },
    },
  ],
  server: {
    port: frontPort,
    strictPort: true,
    host: process.env.HOST ?? '127.0.0.1',
    allowedHosts: true,
    proxy: {
      '/api': apiTarget,
      '/health': apiTarget,
      '/ready': apiTarget,
    },
  },
  resolve: {
    alias: {
      '@hachej/boring-agent/front/styles.css': path.resolve(agentSourceRoot, 'front/styles/globals.css'),
      '@hachej/boring-agent/front': path.resolve(agentSourceRoot, 'front/index.ts'),
      '@hachej/boring-agent/shared': path.resolve(agentSourceRoot, 'shared/index.ts'),
      '@': agentSourceRoot,
    },
  },
})

await vite.listen()
runtime.app.log.info(`one-chat front  http://${publicHost}:${frontPort}/`)
runtime.app.log.info(`one-chat app    ${sampleAppUrl}`)
runtime.app.log.info(`one-chat api    ${apiAddress}`)

let shutdownPromise: Promise<void> | undefined
function shutdown(signal: NodeJS.Signals): Promise<void> {
  shutdownPromise ??= (async () => {
    runtime.app.log.info({ signal }, 'one-chat-playground shutting down')
    sampleApp.kill('SIGTERM')
    await runtime.close()
    await vite.close()
  })()
  return shutdownPromise
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void shutdown(signal)
      .catch((error) => {
        console.error(error)
        process.exitCode = 1
      })
      .finally(() => process.exit())
  })
}
