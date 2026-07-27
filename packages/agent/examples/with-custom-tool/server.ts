import path from 'node:path'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { createServer as createViteServer } from 'vite'

import { applyCspHeaders } from '../csp'
import type { AgentTool } from '../../src/shared/tool'
import { createAgentApp } from '../../src/server/createAgentApp'
import {
  agentSandboxRuntimeHostOperations,
  createAgentSandboxRuntimeModeAdapter,
} from '../../host/sandbox'

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
  runtimeModeAdapter: createAgentSandboxRuntimeModeAdapter('direct'),
  runtimeHost: agentSandboxRuntimeHostOperations,
  sessionId: 'demo',
})

const apiAddress = await app.listen({ port: 0, host: '127.0.0.1' })
const apiPort = Number(new URL(apiAddress).port)
const apiTarget = `http://127.0.0.1:${apiPort}`

const exampleRoot = path.dirname(fileURLToPath(import.meta.url))
const vite = await createViteServer({
  root: exampleRoot,
  plugins: [
    react(),
    {
      name: 'with-custom-tool-virtual-index',
      configureServer(server) {
        server.middlewares.use((_req, res, next) => {
          applyCspHeaders(res)
          next()
        })

        server.middlewares.use(async (req, res, next) => {
          if (req.method === 'GET' && req.url && (req.url === '/' || req.url.startsWith('/?'))) {
            const rawHtml = [
              '<!doctype html>',
              '<html lang="en">',
              '  <head>',
              '    <meta charset="UTF-8" />',
              '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
              '    <title>with-custom-tool</title>',
              '  </head>',
              '  <body>',
              '    <div id="root"></div>',
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
    port: 5181,
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
app.log.info(`with-custom-tool API listening at ${apiAddress}`)
