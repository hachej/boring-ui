import path from 'node:path'
import { fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import { createServer as createViteServer } from 'vite'

import { applyCspHeaders, createAgentApp } from '@hachej/boring-agent/server'
import {
  createSandboxRuntimeModeAdapter,
  sandboxRuntimeHostOperations,
} from '@hachej/boring-workspace/app/server'

const app = await createAgentApp({
  mode: 'direct',
  runtimeModeAdapter: createSandboxRuntimeModeAdapter('direct'),
  runtimeHost: sandboxRuntimeHostOperations,
  sessionId: 'playground',
})

const apiAddress = await app.listen({ port: 0, host: '127.0.0.1' })
const apiPort = Number(new URL(apiAddress).port)
const apiTarget = `http://127.0.0.1:${apiPort}`

const playgroundRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const repoRoot = path.resolve(playgroundRoot, '../..')
const agentSourceRoot = path.resolve(repoRoot, 'packages/agent/src')
const configuredFrontendPort = process.env.FRONTEND_PORT
const frontendPort = configuredFrontendPort ? Number(configuredFrontendPort) : 5183
const frontendStrictPort = process.env.FRONTEND_STRICT_PORT === '1'

const vite = await createViteServer({
  configFile: false,
  root: playgroundRoot,
  plugins: [
    tailwindcss(),
    {
      name: 'agent-playground-index',
      configureServer(server) {
        server.middlewares.use((_req, res, next) => {
          applyCspHeaders(res, { dev: true })
          next()
        })

        server.middlewares.use(async (req, res, next) => {
          if (req.method === 'GET' && req.url && (req.url === '/' || req.url.startsWith('/?'))) {
            const rawHtml = [
              '<!doctype html>',
              '<html lang="en" class="dark">',
              '  <head>',
              '    <meta charset="UTF-8" />',
              '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
              '    <title>playground — @hachej/boring-agent</title>',
              '  </head>',
              '  <body class="bg-background text-foreground antialiased">',
              '    <div id="root" class="h-screen"></div>',
              '    <script type="module" src="/src/front/main.tsx"></script>',
              '  </body>',
              '</html>',
            ].join('\n')
            try {
              const html = await server.transformIndexHtml(req.url, rawHtml)
              res.statusCode = 200
              res.setHeader('Content-Type', 'text/html; charset=utf-8')
              res.end(html)
            } catch (err) {
              server.ssrFixStacktrace(err as Error)
              next(err)
            }
            return
          }
          next()
        })
      },
    },
  ],
  server: {
    port: Number.isFinite(frontendPort) ? frontendPort : 5183,
    strictPort: frontendStrictPort,
    host: process.env.HOST ?? '0.0.0.0',
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
vite.printUrls()
app.log.info(`playground API listening at ${apiAddress}`)
