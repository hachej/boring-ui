import { resolve } from "node:path"

try { process.loadEnvFile(new URL("../../.env", import.meta.url)) } catch { /* optional */ }
import { createServer as createViteServer } from "vite"
import { buildServer } from "./index.js"
import { runCoreMigrationsFromEnv } from "@hachej/boring-core/server"

const API_PORT = Number(process.env.API_PORT) || 5211
const FRONTEND_PORT = Number(process.env.FRONTEND_PORT) || 5201
const APP_ROOT = process.cwd()
const WORKSPACE_ROOT = resolve(APP_ROOT, "workspace")
const WORKSPACE_DECK_ROOT = resolve(WORKSPACE_ROOT, "deck")

async function main() {
  process.env.BORING_AGENT_WORKSPACE_ROOT ??= WORKSPACE_ROOT
  process.env.BM_DECK_ROOT ??= WORKSPACE_DECK_ROOT
  process.env.BM_CH_DATABASE ??= "boring_macro"

  await runCoreMigrationsFromEnv({ log: console })

  const { app } = await buildServer({ port: API_PORT, host: "127.0.0.1" })
  await app.listen({ port: API_PORT, host: "127.0.0.1" })
  app.log.info(`boring.macro (full) API on :${API_PORT}`)

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
