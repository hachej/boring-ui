import { spawn } from "node:child_process"
import { cp, mkdir, mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"

const args = process.argv.slice(2)
const scenario = readOption(args, "scenario") ?? "command-palette"
const critic = readOption(args, "critic") ?? process.env.UI_REVIEW_CRITIC ?? "fixture"

if (scenario !== "command-palette") {
  console.error(`unsupported UI review scenario: ${scenario}`)
  process.exit(2)
}
if (critic !== "fixture" && critic !== "pi") {
  console.error(`unsupported UI review critic: ${critic}`)
  process.exit(2)
}

const build = await run("pnpm", ["run", "build:deps"])
if (build !== 0) process.exit(build)

const isolationRoot = process.env.UI_REVIEW_ISOLATION_ROOT
  ? resolve(process.env.UI_REVIEW_ISOLATION_ROOT)
  : await mkdtemp(join(tmpdir(), "boring-ui-review."))
const isolated = {
  home: join(isolationRoot, "home"),
  config: join(isolationRoot, "config"),
  cache: join(isolationRoot, "cache"),
  workspace: join(isolationRoot, "workspace"),
  sessions: join(isolationRoot, "sessions"),
}
await Promise.all(Object.values(isolated).map((path) => mkdir(path, { recursive: true })))
await cp(resolve("e2e/fixtures/workspace"), isolated.workspace, { recursive: true, force: false, errorOnExist: false })
const outputDirOption = process.env.UI_REVIEW_OUTPUT_DIR?.trim() || join(isolationRoot, "output")
const outputDir = isAbsolute(outputDirOption) ? outputDirOption : resolve(outputDirOption)
await mkdir(outputDir, { recursive: true })

const testEnv = {
  PATH: requiredEnv("PATH"),
  HOME: isolated.home,
  XDG_CONFIG_HOME: isolated.config,
  XDG_CACHE_HOME: isolated.cache,
  BORING_AGENT_WORKSPACE_ROOT: isolated.workspace,
  BORING_AGENT_SESSION_ROOT: isolated.sessions,
  PI_CODING_AGENT_DIR: isolated.config,
  UI_REVIEW_OUTPUT_DIR: outputDir,
  UI_REVIEW_RUN_ID: process.env.UI_REVIEW_RUN_ID?.trim() || `command-palette-${Date.now()}`,
  UI_REVIEW_SCENARIO: scenario,
  UI_REVIEW_CRITIC: critic,
  UI_REVIEW_VITE_PORT: process.env.UI_REVIEW_VITE_PORT?.trim() || "5380",
  UI_REVIEW_AGENT_API_PORT: process.env.UI_REVIEW_AGENT_API_PORT?.trim() || "5390",
  ...(process.env.CI ? { CI: process.env.CI } : {}),
  PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || join(requiredEnv("HOME"), ".cache", "ms-playwright"),
  ...(critic === "pi" ? {
    GEMINI_API_KEY: requiredEnv("GEMINI_API_KEY"),
    ...(process.env.BORING_UI_REVIEW_MODEL ? { BORING_UI_REVIEW_MODEL: process.env.BORING_UI_REVIEW_MODEL } : {}),
  } : {}),
}

const test = await run("pnpm", [
  "exec",
  "playwright",
  "test",
  "--config",
  "playwright.config.ts",
  "apps/workspace-playground/e2e/ui-review.spec.ts",
], testEnv)
process.exit(test)

function readOption(argv, name) {
  const equals = argv.find((arg) => arg.startsWith(`--${name}=`))
  if (equals) return equals.slice(name.length + 3)
  const index = argv.indexOf(`--${name}`)
  return index >= 0 ? argv[index + 1] : undefined
}

function requiredEnv(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`UI_REVIEW_REQUIRED_ENV_MISSING:${name}`)
  return value
}

function run(command, argv, env = process.env) {
  return new Promise((resolveExit) => {
    const child = spawn(command, argv, { stdio: "inherit", env })
    child.on("exit", (code) => resolveExit(code ?? 1))
  })
}
