import { fileURLToPath } from "node:url"
import { runCoreMigrationsFromEnv } from "@hachej/boring-core/server"
import { buildServer } from "./index.js"

async function main() {
  // Two levels up from src/server/ → apps/boring-macro-v2-full/
  const appRoot = fileURLToPath(new URL("../..", import.meta.url))

  // Fly runs migrations in release_command before replacing the machine.
  // Keep opt-in startup migrations for one-off local production runs, but do
  // not block health checks on every deploy.
  if (process.env.BORING_RUN_MIGRATIONS_ON_START === "1") {
    await runCoreMigrationsFromEnv({ log: console })
  }

  const { app } = await buildServer({ appRoot })
  const address = await app.listen({ host: app.config.host, port: app.config.port })
  app.log.info(`boring.macro (full) on ${address}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
