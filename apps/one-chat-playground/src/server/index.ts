import path from 'node:path'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createServer as createViteServer } from 'vite'

import { createOneChatRuntime } from './agentHost.js'
import { createAppRegistry } from './appRegistry.js'
import { registerAppRoutes } from './appRoutes.js'
import { devCspPolicy } from './csp.js'
import { resolveAllowedOriginsFromEnv } from '../shared/allowedOrigins.js'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const repoRoot = path.resolve(appRoot, '../..')
const agentSourceRoot = path.resolve(repoRoot, 'packages/agent/src')
const appsRoot = path.resolve(process.env.ONE_CHAT_APPS_ROOT ?? path.join(appRoot, '.workspaces'))
const templateRoot = path.resolve(path.join(appRoot, 'template-app'))
const legacyWorkspaceRoot = process.env.ONE_CHAT_WORKSPACE_ROOT
  ? path.resolve(process.env.ONE_CHAT_WORKSPACE_ROOT)
  : undefined

const frontPort = Number(process.env.ONE_CHAT_PORT ?? 5320)
const firstAppPort = Number(process.env.SAMPLE_APP_PORT ?? 5321)
const configuredRange = process.env.ONE_CHAT_APP_PORT_RANGE?.match(/^(\d+)-(\d+)$/)
const portStart = Number(process.env.ONE_CHAT_APP_PORT_START ?? configuredRange?.[1] ?? firstAppPort)
const portEnd = Number(process.env.ONE_CHAT_APP_PORT_END ?? configuredRange?.[2] ?? (portStart + 8))
if (!Number.isInteger(portStart) || !Number.isInteger(portEnd) || portStart < 1 || portEnd < portStart) {
  throw new Error('ONE_CHAT_APP_PORT_RANGE must be an inclusive range such as 5321-5329')
}
const publicHost = process.env.ONE_CHAT_PUBLIC_HOST ?? '127.0.0.1'
const sessionRoot = path.resolve(
  process.env.BORING_AGENT_SESSION_ROOT ?? path.join(appRoot, '.boring-agent', 'sessions'),
)

const registry = createAppRegistry({
  appsRoot,
  templateRoot,
  publicHost,
  appUrlPattern: process.env.ONE_CHAT_APP_URL,
  appBasePattern: process.env.ONE_CHAT_APP_BASE,
  portStart,
  portEnd,
  legacyWorkspaceRoot,
})
await registry.init()

const allowedOrigins = resolveAllowedOriginsFromEnv()
const cspPolicy = devCspPolicy(allowedOrigins)
const runtime = await createOneChatRuntime({
  resolveApp(slug) {
    const registered = registry.get(slug)
    if (!registered) return undefined
    return {
      slug,
      workspaceRoot: registry.rootFor(slug),
      appBaseUrl: registry.urlFor(registered),
    }
  },
  allowedOrigins,
  sessionRoot,
})
registerAppRoutes(runtime.app, registry)

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
          const pathname = req.url?.split('?', 1)[0]
          const isAppRoute = pathname === '/' || pathname === '/new' || /^\/apps\/[^/]+\/?$/.test(pathname ?? '')
          if (req.method !== 'GET' || !req.url || !isAppRoute) {
            next()
            return
          }
          const rawHtml = [
            '<!doctype html>',
            '<html lang="en">',
            '  <head>',
            '    <meta charset="UTF-8" />',
            '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
            '    <title>Your apps</title>',
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
runtime.app.log.info(`one-chat apps   ${appsRoot} (${registry.list().length})`)
runtime.app.log.info(`one-chat api    ${apiAddress}`)

let shutdownPromise: Promise<void> | undefined
function shutdown(signal: NodeJS.Signals): Promise<void> {
  shutdownPromise ??= (async () => {
    runtime.app.log.info({ signal }, 'one-chat-playground shutting down')
    await registry.close()
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
