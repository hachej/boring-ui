// Single-process dev launcher: boots the macro Fastify backend, then starts
// Vite, which proxies /api and /health to it. Mirrors apps/full-app's dev
// flow.

import { copyFileSync, mkdirSync, readdirSync, statSync } from "node:fs"
import { resolve } from "node:path"
import { createServer as createViteServer } from "vite"
import { buildServer } from "./index.js"

const API_PORT = Number(process.env.API_PORT) || 5210
const FRONTEND_PORT = Number(process.env.FRONTEND_PORT) || 5200
const APP_ROOT = process.cwd()
const WORKSPACE_ROOT = resolve(APP_ROOT, "workspace")
const SOURCE_DECK_ROOT = resolve(APP_ROOT, "deck")
const WORKSPACE_DECK_ROOT = resolve(WORKSPACE_ROOT, "deck")

function seedWorkspaceIfEmpty(): void {
  mkdirSync(WORKSPACE_DECK_ROOT, { recursive: true })
  const existing = readdirSync(WORKSPACE_DECK_ROOT).filter((name) => !name.startsWith("."))
  if (existing.length > 0) return
  for (const name of readdirSync(SOURCE_DECK_ROOT)) {
    const src = resolve(SOURCE_DECK_ROOT, name)
    if (!statSync(src).isFile()) continue
    copyFileSync(src, resolve(WORKSPACE_DECK_ROOT, name))
  }
}

async function main() {
  seedWorkspaceIfEmpty()
  process.env.BORING_AGENT_WORKSPACE_ROOT ??= WORKSPACE_ROOT
  process.env.BM_DECK_ROOT ??= WORKSPACE_DECK_ROOT
  process.env.BM_CH_DATABASE ??= "boring_macro"

  const { app } = await buildServer({ port: API_PORT, host: "127.0.0.1" })
  await app.listen({ port: API_PORT, host: "127.0.0.1" })
  app.log.info(`boring.macro API on :${API_PORT}`)

  const vite = await createViteServer({
    server: {
      port: FRONTEND_PORT,
      host: true,
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
