import path from 'node:path'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { createServer as createViteServer } from 'vite'

import type { AgentTool } from '../../src/shared/tool'
import { createAgentApp } from '../../src/server/createAgentApp'

const reverseTool: AgentTool = {
  name: 'reverse',
  description: 'Reverse a string.',
  parameters: {
    type: 'object',
    properties: {
      s: { type: 'string' },
    },
    required: ['s'],
  },
  async execute(params) {
    const input = typeof params.s === 'string' ? params.s : ''
    const reversed = input.split('').reverse().join('')
    return {
      content: [{ type: 'text', text: reversed }],
      details: { reversed },
    }
  },
}

const app = await createAgentApp({
  extraTools: [reverseTool],
  mode: 'direct',
  sessionId: 'demo',
})

const apiAddress = await app.listen({ port: 0, host: '127.0.0.1' })
const apiPort = Number(new URL(apiAddress).port)
const apiTarget = `http://127.0.0.1:${apiPort}`

const exampleRoot = path.dirname(fileURLToPath(import.meta.url))
const vite = await createViteServer({
  root: exampleRoot,
  css: {
    postcss: exampleRoot,
  },
  plugins: [
    react(),
    {
      name: 'with-shadcn-virtual-index',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (req.method === 'GET' && req.url && (req.url === '/' || req.url.startsWith('/?'))) {
            const rawHtml = [
              '<!doctype html>',
              '<html lang="en" class="dark">',
              '  <head>',
              '    <meta charset="UTF-8" />',
              '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
              '    <title>with-shadcn — @boring/agent</title>',
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
    port: 5182,
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
app.log.info(`with-shadcn API listening at ${apiAddress}`)
