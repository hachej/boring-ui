// Single-process dev launcher: boots the macro Fastify backend, then starts
// Vite, which proxies /api and /health to it. Mirrors apps/full-app's dev
// flow.

import { createServer as createViteServer } from "vite"
import { buildServer } from "./index.js"

const API_PORT = Number(process.env.API_PORT) || 5210
const FRONTEND_PORT = Number(process.env.FRONTEND_PORT) || 5200

async function main() {
  const { app } = await buildServer({ port: API_PORT, host: "127.0.0.1" })
  await app.listen({ port: API_PORT, host: "127.0.0.1" })
  app.log.info(`boring.macro API on :${API_PORT}`)

  const vite = await createViteServer({
    server: {
      port: FRONTEND_PORT,
      strictPort: false,
    },
  })
  await vite.listen()
  vite.printUrls()
}

main().catch((err) => {
  console.error("dev launcher failed:", err)
  process.exit(1)
})
