import { execFileSync } from "node:child_process"
import { appendFileSync, existsSync, readdirSync, statSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { shouldBuildCliDistForVitestArgv } from "./cliVitestBuildSelection.js"

const testDir = dirname(fileURLToPath(import.meta.url))
const cliRoot = resolve(testDir, "../..")
const repoRoot = resolve(cliRoot, "../..")

interface PackageBuildSpec {
  root: string
  artifacts: string[]
  sources: string[]
}

function packageSpec(relativeRoot: string, artifacts: string[], sources: string[]): PackageBuildSpec {
  const root = resolve(repoRoot, relativeRoot)
  return {
    root,
    artifacts: artifacts.map((artifact) => join(root, artifact)),
    sources: sources.map((source) => join(root, source)),
  }
}

function isSourceEntryNewer(path: string, artifactMtime: number): boolean {
  if (!existsSync(path)) return false
  const stat = statSync(path)
  if (stat.isDirectory()) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.name === "__tests__" || entry.name === "dist" || entry.name === "node_modules") continue
      if (isSourceEntryNewer(join(path, entry.name), artifactMtime)) return true
    }
    return false
  }
  return stat.isFile() && stat.mtimeMs > artifactMtime
}

function needsBuild(spec: PackageBuildSpec): boolean {
  if (spec.artifacts.some((artifact) => !existsSync(artifact))) return true
  const artifactMtime = Math.min(...spec.artifacts.map((artifact) => statSync(artifact).mtimeMs))
  return spec.sources.some((source) => isSourceEntryNewer(source, artifactMtime))
}

function buildIfNeeded(spec: PackageBuildSpec): void {
  if (!needsBuild(spec)) return
  execFileSync("pnpm", ["--dir", spec.root, "build"], { stdio: "pipe" })
}

export default function setup(): void {
  if (process.env.BORING_CLI_VITEST_SETUP_COUNTER_FILE) {
    appendFileSync(process.env.BORING_CLI_VITEST_SETUP_COUNTER_FILE, `${process.pid}\n`, "utf-8")
  }
  if (!shouldBuildCliDistForVitestArgv(process.argv)) return
  if (process.env.BORING_CLI_ENSURE_BUILT_FAIL_IF_CALLED === "1") {
    throw new Error("CLI dist build was requested unexpectedly")
  }

  buildIfNeeded(packageSpec("packages/agent", ["dist/server/index.js"], ["src", "package.json", "tsup.config.ts"]))
  buildIfNeeded(packageSpec("packages/workspace", ["dist/app-server.js", "dist/server.js"], ["src", "package.json", "tsup.config.ts", "vite.config.ts"]))
  buildIfNeeded(packageSpec("packages/plugin-cli", ["dist/index.js"], ["src", "package.json", "tsup.config.ts"]))
  buildIfNeeded(packageSpec("packages/cli", ["dist/index.js", "dist/server/cli.js"], ["src", "package.json", "tsup.config.ts"]))
}
