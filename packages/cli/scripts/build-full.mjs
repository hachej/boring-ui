/**
 * Full CLI build: package deps → default plugins → CLI frontend → public/ → tsup compile.
 * Run from packages/cli: node scripts/build-full.mjs
 */
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { execSync } from "node:child_process"

const __dirname = dirname(fileURLToPath(import.meta.url))
const cliRoot = resolve(__dirname, "..")

const run = (cmd, cwd = cliRoot) => execSync(cmd, { cwd, stdio: "inherit" })

console.log("1/5  building agent package…")
run("pnpm --filter @hachej/boring-agent build", resolve(__dirname, "../../.."))

console.log("2/5  building workspace package…")
run("pnpm --filter @hachej/boring-workspace build", resolve(__dirname, "../../.."))

console.log("3/5  building ask-user plugin…")
run("pnpm --filter @hachej/boring-ask-user build", resolve(__dirname, "../../.."))

console.log("4/5  building CLI frontend…")
run("pnpm build:front")

console.log("5/5  compiling CLI server…")
run("pnpm build")

console.log("\ndone — packages/cli/dist/index.js and packages/cli/public ready")
