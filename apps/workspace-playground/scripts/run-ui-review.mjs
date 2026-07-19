import { spawn } from "node:child_process"
import { cp, mkdir, mkdtemp, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"
import { parseUiReviewArgs } from "./ui-review-args.mjs"
import { readUiReviewWorktreeIdentity } from "./ui-review-worktree.mjs"

let command
try {
  command = parseUiReviewArgs(process.argv.slice(2))
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(2)
}
if (command.critic !== "fixture" && command.critic !== "pi") {
  console.error(`UI_REVIEW_CRITIC_INVALID:${command.critic}`)
  process.exit(2)
}
if (command.mode === "improve" && command.exploreOnly) {
  console.error("UI_REVIEW_COMMAND_INVALID:improve cannot be explore-only")
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
await cp(resolve("e2e/ui-review-fixture-workspace"), isolated.workspace, { recursive: true, force: false, errorOnExist: false })
const outputDirOption = process.env.UI_REVIEW_OUTPUT_DIR?.trim() || join(isolationRoot, "output")
const outputDir = isAbsolute(outputDirOption) ? outputDirOption : resolve(outputDirOption)
await mkdir(outputDir, { recursive: true })
if ((await readdir(outputDir)).length > 0) throw new Error(`UI_REVIEW_OUTPUT_NOT_EMPTY:${outputDir}`)
const baselineDir = command.baselineDir
  ? (isAbsolute(command.baselineDir) ? command.baselineDir : resolve(command.baselineDir))
  : undefined
const worktreeIdentity = await readUiReviewWorktreeIdentity()

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
  UI_REVIEW_SCENARIO: command.scenario,
  UI_REVIEW_CRITIC: command.critic,
  UI_REVIEW_MODE: command.mode,
  UI_REVIEW_CANDIDATE_REVISION: worktreeIdentity.revision,
  UI_REVIEW_CANDIDATE_TREE_HASH: worktreeIdentity.treeHash,
  UI_REVIEW_VITE_PORT: process.env.UI_REVIEW_VITE_PORT?.trim() || "5380",
  UI_REVIEW_AGENT_API_PORT: process.env.UI_REVIEW_AGENT_API_PORT?.trim() || "5390",
  PORT: process.env.UI_REVIEW_VITE_PORT?.trim() || "5380",
  AGENT_API_PORT: process.env.UI_REVIEW_AGENT_API_PORT?.trim() || "5390",
  ...(baselineDir ? { UI_REVIEW_BASELINE_DIR: baselineDir } : {}),
  ...(process.env.CI ? { CI: process.env.CI } : {}),
  PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || join(requiredEnv("HOME"), ".cache", "ms-playwright"),
  ...(command.critic === "pi" ? {
    GEMINI_API_KEY: requiredEnv("GEMINI_API_KEY"),
    ...(process.env.BORING_UI_REVIEW_MODEL ? { BORING_UI_REVIEW_MODEL: process.env.BORING_UI_REVIEW_MODEL } : {}),
  } : {}),
}

const explorationEnv = { ...testEnv }
delete explorationEnv.GEMINI_API_KEY
delete explorationEnv.BORING_UI_REVIEW_MODEL
const exploration = await run("pnpm", ["exec", "tsx", "scripts/explore-command-palette.ts"], explorationEnv)
if (exploration !== 0 || command.exploreOnly) process.exit(exploration)

const test = await run("pnpm", [
  "exec",
  "playwright",
  "test",
  "--config",
  "playwright.config.ts",
  "apps/workspace-playground/e2e/ui-review.spec.ts",
], testEnv)
process.exit(test)

function requiredEnv(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`UI_REVIEW_REQUIRED_ENV_MISSING:${name}`)
  return value
}

function run(command, argv, env = process.env) {
  return new Promise((resolveExit) => {
    const child = spawn(command, argv, { stdio: "inherit", env })
    child.on("error", () => resolveExit(1))
    child.on("exit", (code) => resolveExit(code ?? 1))
  })
}
