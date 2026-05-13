import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { runCli } from "./server/cli.js"

const __dirname = dirname(fileURLToPath(import.meta.url))

try {
  await runCli({
    argv: process.argv.slice(2),
    publicDir: resolve(__dirname, "..", "public"),
  })
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
