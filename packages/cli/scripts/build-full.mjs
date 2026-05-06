/**
 * Full CLI build: playground frontend → public/ → tsup compile.
 * Run from packages/cli: node scripts/build-full.mjs
 */
import { cpSync, mkdirSync, rmSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { execSync } from "node:child_process"

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, "../../..")
const playgroundDist = resolve(repoRoot, "apps/workspace-playground/dist")
const publicDir = resolve(__dirname, "..", "public")

const run = (cmd, cwd = repoRoot) => execSync(cmd, { cwd, stdio: "inherit" })

console.log("1/3  building workspace-playground…")
run("pnpm --filter workspace-playground build")

console.log("2/3  copying dist → public/…")
rmSync(publicDir, { recursive: true, force: true })
mkdirSync(publicDir, { recursive: true })
cpSync(playgroundDist, publicDir, { recursive: true })

console.log("3/3  compiling CLI…")
run("pnpm build", resolve(__dirname, ".."))

console.log("\ndone — packages/cli/dist/index.js ready")
