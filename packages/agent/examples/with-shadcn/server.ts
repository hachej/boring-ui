import path from 'node:path'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { createServer as createViteServer } from 'vite'

import { applyCspHeaders } from '../csp'
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

// Demo-only bash tool. Runs `bash -lc <command>` directly; this is a local
// developer example app with no network surface, so shell-quoting concerns
// don't apply. In production deployments, route through the sandbox runtime
// instead of exec().
const execAsync = promisify(exec)
const bashTool: AgentTool = {
  name: 'bash',
  description: 'Execute a bash command and return stdout, stderr, and exit code.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The shell command to run.' },
      description: { type: 'string', description: 'A short human-readable label.' },
    },
    required: ['command'],
  },
  async execute(params) {
    const command = typeof params.command === 'string' ? params.command : ''
    if (!command) {
      return {
        content: [{ type: 'text', text: 'no command provided' }],
        details: { stdout: '', stderr: 'no command provided', exitCode: 1 },
      }
    }
    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout: 10_000,
        maxBuffer: 64 * 1024,
        shell: '/bin/bash',
      })
      return {
        content: [{ type: 'text', text: stdout || stderr || '(no output)' }],
        details: { command, stdout, stderr, exitCode: 0 },
      }
    } catch (err) {
      const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number | string }
      const exitCode = typeof e.code === 'number' ? e.code : 1
      return {
        content: [{ type: 'text', text: e.stderr || e.stdout || e.message }],
        details: {
          command,
          stdout: e.stdout ?? '',
          stderr: e.stderr ?? e.message ?? '',
          exitCode,
        },
      }
    }
  },
}

const app = await createAgentApp({
  extraTools: [reverseTool, bashTool],
  mode: 'direct',
  sessionId: 'demo',
})

const apiAddress = await app.listen({ port: 0, host: '127.0.0.1' })
const apiPort = Number(new URL(apiAddress).port)
const apiTarget = `http://127.0.0.1:${apiPort}`

const exampleRoot = path.dirname(fileURLToPath(import.meta.url))
const packagesAgentSrc = path.resolve(exampleRoot, '..', '..', 'src')
const vite = await createViteServer({
  root: exampleRoot,
  css: {
    postcss: exampleRoot,
  },
  resolve: {
    alias: {
      '@': packagesAgentSrc,
    },
  },
  plugins: [
    react(),
    {
      name: 'with-shadcn-virtual-index',
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
