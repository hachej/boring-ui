import { spawnSync } from "node:child_process"
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

const appRoot = resolve(import.meta.dirname, "..")
const repoRoot = resolve(appRoot, "..", "..")
const [command, ...forgeArgs] = process.argv.slice(2)
if (command !== "package" && command !== "make") {
  throw new Error("usage: node scripts/forge-staged.mjs <package|make> [forge options]")
}

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "inherit",
    ...options,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${executable} ${args.join(" ")} exited ${result.status}`)
}

const stageBase = resolve(process.env.BORING_DESKTOP_STAGE_ROOT ?? tmpdir())
await mkdir(stageBase, { recursive: true })
const stage = await mkdtemp(join(stageBase, "boring-ui-desktop-forge-"))
run("pnpm", ["--filter", "boring-ui-macos-desktop", "deploy", stage, "--legacy"])
await writeFile(join(stage, ".npmrc"), "node-linker=hoisted\n", "utf8")
if (process.env.BORING_DESKTOP_SMOKE_BUILD === "1") {
  const packagePath = join(stage, "package.json")
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"))
  packageJson.main = "dist/smoke-main.js"
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8")
}

run(
  "pnpm",
  ["exec", "electron-forge", command, stage, ...forgeArgs],
  {
    cwd: appRoot,
    env: {
      ...process.env,
      TMPDIR: stageBase,
      npm_config_node_linker: "hoisted",
    },
  },
)

const result = { stage, outDir: join(stage, "out") }
if (process.env.BORING_DESKTOP_FORGE_RESULT_PATH) {
  await writeFile(process.env.BORING_DESKTOP_FORGE_RESULT_PATH, JSON.stringify(result), "utf8")
}
console.log(JSON.stringify(result))
