import { fileURLToPath } from "node:url"
import { buildMacroServer } from "./index.js"

async function main() {
  // Two levels up from src/server/ → apps/boring-macro-v2/
  const appRoot = fileURLToPath(new URL("../..", import.meta.url))

  const { app, port, host } = await buildMacroServer({ appRoot })

  await app.listen({ port, host })
  app.log.info(`boring.macro on :${port}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
