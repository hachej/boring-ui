#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { spawnSync } from "node:child_process"

const help = `
Usage:
  BASELINE_REF=<ref> pnpm test:e2e:baseline

Environment:
  BASELINE_REF             Git ref to test. Defaults to HEAD.
  BASELINE_JSON            Output JSON path. Defaults to /tmp/macro-e2e-baseline.json.
  BASELINE_LAST_RUN_JSON   Playwright last-run copy path. Defaults to /tmp/macro-e2e-baseline.last-run.json.
  BASELINE_WORKTREE_DIR    Optional worktree path. Defaults to ../baseline-<sha>-macro-e2e-<pid>.
  BASELINE_INSTALL_CMD     Install command. Defaults to pnpm install --frozen-lockfile.
  BASELINE_INSTALL_FALLBACK_CMD
                           Fallback when default install fails. Defaults to
                           pnpm install --no-frozen-lockfile --lockfile=false.
  BASELINE_PREP_CMD        Dependency build command. Defaults to agent/workspace/core build.
  BASELINE_TIMEOUT_MS      Playwright timeout. Defaults to 900000.
  BASELINE_KEEP_WORKTREE=1 Keep worktree after failure for debugging.
`

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  process.stdout.write(help.trimStart())
  process.exit(0)
}

const baselineRef = process.env.BASELINE_REF ?? "HEAD"
const baselineJson = process.env.BASELINE_JSON ?? "/tmp/macro-e2e-baseline.json"
const lastRunJson =
  process.env.BASELINE_LAST_RUN_JSON ?? "/tmp/macro-e2e-baseline.last-run.json"
const installCommand =
  process.env.BASELINE_INSTALL_CMD ?? "pnpm install --frozen-lockfile"
const installFallbackCommand =
  process.env.BASELINE_INSTALL_FALLBACK_CMD ??
  "pnpm install --no-frozen-lockfile --lockfile=false"
const prepCommand =
  process.env.BASELINE_PREP_CMD ??
  "pnpm --filter @boring/agent --filter @boring/workspace --filter @boring/core run build"
const baselineTimeoutMs = Number(process.env.BASELINE_TIMEOUT_MS ?? 900_000)
const keepWorktree = process.env.BASELINE_KEEP_WORKTREE === "1"
const e2ePort = process.env.E2E_PORT ?? String(15_000 + (process.pid % 10_000))
const e2eApiPort = process.env.E2E_API_PORT ?? String(25_000 + (process.pid % 10_000))

if (!Number.isInteger(baselineTimeoutMs) || baselineTimeoutMs <= 0) {
  throw new Error("BASELINE_TIMEOUT_MS must be a positive integer")
}

function run(command, args, options = {}) {
  process.stderr.write(`\n$ ${[command, ...args].join(" ")}\n`)
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: false,
    ...options,
  })
  if (result.status !== 0) {
    throw new Error(`command failed (${result.status ?? "signal"}): ${command}`)
  }
}

function runShell(command, cwd, options = {}) {
  process.stderr.write(`\n$ ${command}\n`)
  const result = spawnSync(command, {
    cwd,
    stdio: "inherit",
    shell: true,
  })
  if (result.status !== 0 && options.check !== false) {
    throw new Error(`command failed (${result.status ?? "signal"}): ${command}`)
  }
  return result
}

function installDependencies(cwd) {
  const result = runShell(installCommand, cwd, { check: false })
  if (result.status === 0) {
    return
  }

  if (process.env.BASELINE_INSTALL_CMD) {
    throw new Error(
      `command failed (${result.status ?? "signal"}): ${installCommand}`,
    )
  }

  process.stderr.write(
    "\nBaseline install failed with the frozen lockfile. " +
      "Retrying without lockfile writes for historical refs.\n",
  )
  runShell(installFallbackCommand, cwd)
}

function output(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: false,
    ...options,
  })
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? "")
    throw new Error(`command failed (${result.status ?? "signal"}): ${command}`)
  }
  return result.stdout.trim()
}

const repoRoot = output("git", ["rev-parse", "--show-toplevel"])
const fullSha = output("git", ["rev-parse", baselineRef], { cwd: repoRoot })
const shortSha = fullSha.slice(0, 12)
const defaultWorktreeDir = resolve(
  repoRoot,
  "..",
  `baseline-${shortSha}-macro-e2e-${process.pid}`,
)
const worktreeDir = resolve(process.env.BASELINE_WORKTREE_DIR ?? defaultWorktreeDir)
const macroDir = resolve(worktreeDir, "apps/boring-macro-v2")

let createdWorktree = false
let completed = false

function cleanup() {
  if (!createdWorktree || (keepWorktree && !completed)) {
    return
  }
  spawnSync("git", ["worktree", "remove", worktreeDir, "--force"], {
    cwd: repoRoot,
    stdio: "inherit",
  })
}

process.on("SIGINT", () => {
  cleanup()
  process.exit(130)
})
process.on("SIGTERM", () => {
  cleanup()
  process.exit(143)
})

try {
  if (existsSync(worktreeDir)) {
    throw new Error(`worktree path already exists: ${worktreeDir}`)
  }

  mkdirSync(dirname(baselineJson), { recursive: true })
  mkdirSync(dirname(lastRunJson), { recursive: true })

  run("git", ["worktree", "add", "--detach", worktreeDir, fullSha], { cwd: repoRoot })
  createdWorktree = true

  installDependencies(worktreeDir)
  runShell(prepCommand, worktreeDir)
  runShell("pnpm typecheck", macroDir)
  runShell("pnpm build:web", macroDir)

  process.stderr.write("\n$ pnpm exec playwright test -c e2e/playwright.config.ts --reporter=json\n")
  const testResult = spawnSync(
    "pnpm",
    ["exec", "playwright", "test", "-c", "e2e/playwright.config.ts", "--reporter=json"],
    {
      cwd: macroDir,
      env: {
        ...process.env,
        E2E_PORT: e2ePort,
        E2E_API_PORT: e2eApiPort,
      },
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
      timeout: baselineTimeoutMs,
    },
  )
  const jsonOutput = testResult.stdout ?? ""
  if (!jsonOutput.trim()) {
    process.stderr.write(testResult.stderr ?? "")
    throw new Error("playwright produced no JSON output; baseline JSON not written")
  }
  writeFileSync(baselineJson, jsonOutput)
  process.stderr.write(testResult.stderr ?? "")

  const lastRunSource = resolve(macroDir, "test-results/.last-run.json")
  if (existsSync(lastRunSource)) {
    const copyResult = spawnSync("cp", [lastRunSource, lastRunJson], { stdio: "inherit" })
    if (copyResult.status !== 0) {
      process.stderr.write(`warning: failed to copy ${lastRunSource}\n`)
    }
  }

  if (testResult.status !== 0) {
    throw new Error(
      `playwright baseline failed (${testResult.status ?? "signal"}); JSON written to ${baselineJson}`,
    )
  }

  process.stderr.write(`\nBaseline JSON: ${baselineJson}\n`)
  completed = true
} finally {
  cleanup()
}
