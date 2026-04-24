import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { createServer as createViteServer } from 'vite'
import { createAgentApp } from '@boring/agent/server'

const DEFAULT_API_PORT = 8001
const DEFAULT_FRONTEND_PORT = 5181

async function main() {
  const workspaceRoot = process.env.BORING_AGENT_WORKSPACE_ROOT ?? process.cwd()

  const app = await createAgentApp({
    workspaceRoot,
    mode: 'local',
    logger: true,
  })

  const address = await app.listen({
    port: Number(process.env.PORT) || DEFAULT_API_PORT,
    host: '0.0.0.0',
  })

  const apiPort = Number(new URL(address).port)
  const apiTarget = `http://127.0.0.1:${apiPort}`

  const thisDir = path.dirname(fileURLToPath(import.meta.url))
  const appRoot = path.resolve(thisDir, '..')

  const vite = await createViteServer({
    root: appRoot,
    plugins: [react()],
    server: {
      port: DEFAULT_FRONTEND_PORT,
      strictPort: false,
      proxy: {
        '/api': apiTarget,
        '/health': apiTarget,
        '/ready': apiTarget,
      },
    },
  })

  await vite.listen()
  vite.printUrls()
  app.log.info(`agent-backend API at ${address}`)
}

main()
