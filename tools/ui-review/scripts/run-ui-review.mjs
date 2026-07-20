import { spawn } from "node:child_process"
import { cp, mkdir, mkdtemp, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"
import { parseUiReviewArgs } from "./ui-review-args.mjs"
import { readUiReviewWorktreeIdentity } from "./ui-review-worktree.mjs"
import { getUiReviewSpec } from "../src/registry.ts"

let command
try { command = parseUiReviewArgs(process.argv.slice(2)) } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exit(2) }
let spec
try { spec = getUiReviewSpec(command.scenario) } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exit(2) }
if (command.critic !== "fixture" && command.critic !== "pi") { console.error(`UI_REVIEW_CRITIC_INVALID:${command.critic}`); process.exit(2) }
if (command.mode === "improve" && command.exploreOnly) { console.error("UI_REVIEW_COMMAND_INVALID:improve cannot be explore-only"); process.exit(2) }

const repoRoot = resolve(import.meta.dirname, "../../..")
const toolRoot = resolve(import.meta.dirname, "..")
const targetRoot = resolve(repoRoot, spec.target.root)
const [buildCommand, ...buildArgs] = spec.target.buildCommand
const build = await run(buildCommand, buildArgs, process.env, targetRoot)
if (build !== 0) process.exit(build)

const isolationRoot = process.env.UI_REVIEW_ISOLATION_ROOT ? resolve(process.env.UI_REVIEW_ISOLATION_ROOT) : await mkdtemp(join(tmpdir(), "boring-ui-review."))
const isolated = { home: join(isolationRoot, "home"), config: join(isolationRoot, "config"), cache: join(isolationRoot, "cache"), workspace: join(isolationRoot, "workspace"), sessions: join(isolationRoot, "sessions") }
await Promise.all(Object.values(isolated).map((path) => mkdir(path, { recursive: true })))
if (spec.target.fixturePath) await cp(resolve(repoRoot, spec.target.fixturePath), isolated.workspace, { recursive: true, force: false, errorOnExist: false })
const outputOption = process.env.UI_REVIEW_OUTPUT_DIR?.trim() || join(isolationRoot, "output")
const outputDir = isAbsolute(outputOption) ? outputOption : resolve(repoRoot, outputOption)
await mkdir(outputDir, { recursive: true })
if ((await readdir(outputDir)).length > 0) throw new Error(`UI_REVIEW_OUTPUT_NOT_EMPTY:${outputDir}`)
const baselineDir = command.baselineDir ? (isAbsolute(command.baselineDir) ? command.baselineDir : resolve(repoRoot, command.baselineDir)) : undefined
const identity = await readUiReviewWorktreeIdentity(repoRoot)
const port = Number(process.env.UI_REVIEW_VITE_PORT?.trim() || spec.target.defaultPort)
const apiPort = spec.target.defaultApiPort === undefined ? undefined : Number(process.env.UI_REVIEW_AGENT_API_PORT?.trim() || spec.target.defaultApiPort)
const targetEnv = spec.target.environment({ isolation: isolated, port, apiPort })
const unexpectedTargetEnv = Object.keys(targetEnv).find((key) => !spec.target.serverEnvironmentKeys.includes(key))
if (unexpectedTargetEnv) throw new Error(`UI_REVIEW_SPEC_ENV_UNDECLARED:${spec.id}:${unexpectedTargetEnv}`)
const testEnv = {
  ...targetEnv,
  PATH: requiredEnv("PATH"), HOME: isolated.home, XDG_CONFIG_HOME: isolated.config, XDG_CACHE_HOME: isolated.cache,
  COREPACK_HOME: process.env.COREPACK_HOME || join(requiredEnv("HOME"), ".cache/corepack"),
  PI_CODING_AGENT_DIR: isolated.config, UI_REVIEW_OUTPUT_DIR: outputDir,
  UI_REVIEW_RUN_ID: process.env.UI_REVIEW_RUN_ID?.trim() || `${spec.id}-${Date.now()}`,
  UI_REVIEW_SPEC: spec.id, UI_REVIEW_CRITIC: command.critic, UI_REVIEW_MODE: command.mode,
  UI_REVIEW_CANDIDATE_REVISION: identity.revision, UI_REVIEW_CANDIDATE_TREE_HASH: identity.treeHash,
  UI_REVIEW_VITE_PORT: String(port), ...(apiPort === undefined ? {} : { UI_REVIEW_AGENT_API_PORT: String(apiPort) }),
  ...(baselineDir ? { UI_REVIEW_BASELINE_DIR: baselineDir } : {}), ...(process.env.CI ? { CI: process.env.CI } : {}),
  ...(process.env.UI_REVIEW_UPDATE_SNAPSHOTS === "1" ? { UI_REVIEW_UPDATE_SNAPSHOTS: "1" } : {}),
  PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || join(requiredEnv("HOME"), ".cache", "ms-playwright"),
  ...(command.critic === "pi" ? { GEMINI_API_KEY: requiredEnv("GEMINI_API_KEY"), ...(process.env.BORING_UI_REVIEW_MODEL ? { BORING_UI_REVIEW_MODEL: process.env.BORING_UI_REVIEW_MODEL } : {}) } : {}),
}
const explorationEnv = { ...testEnv }; delete explorationEnv.GEMINI_API_KEY; delete explorationEnv.BORING_UI_REVIEW_MODEL
if (spec.exploration) {
  const exploration = await run("pnpm", ["exec", "tsx", "scripts/explore-review-spec.ts"], explorationEnv, toolRoot)
  if (exploration !== 0 || command.exploreOnly) process.exit(exploration)
} else if (command.exploreOnly) process.exit(0)
const test = await run("pnpm", ["exec", "playwright", "test", "--config", "playwright.config.ts"], testEnv, toolRoot)
process.exit(test)

function requiredEnv(name) { const value = process.env[name]?.trim(); if (!value) throw new Error(`UI_REVIEW_REQUIRED_ENV_MISSING:${name}`); return value }
function run(command, args, env = process.env, cwd = process.cwd()) { return new Promise((resolveExit) => { const child = spawn(command, args, { stdio: "inherit", env, cwd }); child.on("error", () => resolveExit(1)); child.on("exit", (code) => resolveExit(code ?? 1)) }) }
