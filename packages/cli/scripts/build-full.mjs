/**
 * Full CLI build: package deps → CLI frontend → public/ → tsup compile.
 * Run from packages/cli: node scripts/build-full.mjs
 */
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { execSync } from "node:child_process"

const __dirname = dirname(fileURLToPath(import.meta.url))
const cliRoot = resolve(__dirname, "..")

const run = (cmd, cwd = cliRoot) => execSync(cmd, { cwd, stdio: "inherit" })

console.log("1/4  building agent package…")
run("pnpm --filter @hachej/boring-agent build", resolve(__dirname, "../../.."))

console.log("2/4  building workspace package…")
run("pnpm --filter @hachej/boring-workspace build", resolve(__dirname, "../../.."))

console.log("3/4  building CLI frontend…")
run("pnpm build:front")

console.log("4/4  compiling CLI server…")
run("pnpm build")

console.log("\ndone — packages/cli/dist/index.js and packages/cli/public ready")
