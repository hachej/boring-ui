import path from 'node:path'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { createServer as createViteServer } from 'vite'

import { applyCspHeaders } from '../csp'
import { createAgentApp } from '../../src/server/createAgentApp'

// Minimal generic playground for @boring/agent. No demo tools, no fake
// messages, no custom shell — just <ChatPanel> + a session picker against
// the real agent backend so we can poke at panel props (chrome,
// thinkingControl, suggestions, …) in isolation. Companion to with-shadcn,
// which is a feature showcase rather than a prop sandbox.
const app = await createAgentApp({
  mode: 'direct',
  sessionId: 'playground',
})

const apiAddress = await app.listen({ port: 0, host: '127.0.0.1' })
const apiPort = Number(new URL(apiAddress).port)
const apiTarget = `http://127.0.0.1:${apiPort}`

const exampleRoot = path.dirname(fileURLToPath(import.meta.url))
const packagesAgentSrc = path.resolve(exampleRoot, '..', '..', 'src')

const vite = await createViteServer({
  root: exampleRoot,
  css: { postcss: exampleRoot },
  resolve: {
    alias: { '@': packagesAgentSrc },
  },
  plugins: [
    react(),
    {
      name: 'playground-virtual-index',
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
              '    <script type="module" src="/client.tsx"></script>',
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
    port: 5183,
    strictPort: false,
    host: process.env.HOST ?? 'localhost',
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
