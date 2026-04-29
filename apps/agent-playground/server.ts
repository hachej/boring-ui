import path from 'node:path'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { createServer as createViteServer } from 'vite'

import { applyCspHeaders } from '../../packages/agent/src/server/http/csp'
import { createAgentApp } from '../../packages/agent/src/server/createAgentApp'

const app = await createAgentApp({
  mode: 'direct',
  sessionId: 'playground',
})

const apiAddress = await app.listen({ port: 0, host: '127.0.0.1' })
const apiPort = Number(new URL(apiAddress).port)
const apiTarget = `http://127.0.0.1:${apiPort}`

const playgroundRoot = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(playgroundRoot, '../../packages/agent')
const packageSrc = path.resolve(packageRoot, 'src')

const vite = await createViteServer({
  root: playgroundRoot,
  css: { postcss: playgroundRoot },
  resolve: {
    alias: {
      '@boring/agent/front/styles.css': path.resolve(packageSrc, 'front/styles/globals.css'),
      '@boring/agent/front': path.resolve(packageSrc, 'front/index.ts'),
      '@boring/agent/shared': path.resolve(packageSrc, 'shared/index.ts'),
      '@boring/agent/server': path.resolve(packageSrc, 'server/index.ts'),
      '@': packageSrc,
    },
  },
  plugins: [
    react(),
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
              '    <title>playground — @boring/agent</title>',
              '  </head>',
              '  <body class="bg-background text-foreground antialiased">',
              '    <div id="root" class="h-screen"></div>',
              '    <script type="module" src="/src/main.tsx"></script>',
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
    port: Number(process.env.FRONTEND_PORT) || 5183,
    strictPort: false,
    host: process.env.HOST ?? '0.0.0.0',
    allowedHosts: true,
    proxy: {
      '/api': apiTarget,
      '/health': apiTarget,
      '/ready': apiTarget,
    },
  },
})

await vite.listen()
vite.printUrls()
app.log.info(`playground API listening at ${apiAddress}`)
