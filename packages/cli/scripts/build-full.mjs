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

console.log("1/6  building agent package…")
run("pnpm --filter @hachej/boring-agent build", resolve(__dirname, "../../.."))

console.log("2/6  building workspace package…")
run("pnpm --filter @hachej/boring-workspace build", resolve(__dirname, "../../.."))

console.log("3/6  building core package…")
run("pnpm --filter @hachej/boring-core build", resolve(__dirname, "../../.."))

console.log("4/6  building CLI default plugin packages…")
run("pnpm --filter @hachej/boring-ask-user build", resolve(__dirname, "../../.."))
run("pnpm --filter @hachej/boring-diagram build", resolve(__dirname, "../../.."))

console.log("5/6  building CLI frontend…")
run("pnpm build:front")

console.log("6/6  compiling CLI server…")
run("pnpm build")

console.log("\ndone — packages/cli/dist/index.js and packages/cli/public ready")
