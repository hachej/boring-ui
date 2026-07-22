#!/usr/bin/env node
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { spawnSync } from "node:child_process"

const repoRoot = resolve(import.meta.dirname, "..")
const goldenPath = resolve(repoRoot, "docs/issues/391/runtime-refactor/golden-path.json")
const expectedPending = [
  "Decision 28 fleet and Environment service implementation through F7 conformance",
  "H2c/F2c contraction plus F8a/H8/F8b packed publication proof",
]
let failed = false

function fail(message) {
  failed = true
  console.error(`[p8] FAIL ${message}`)
}

function pass(message) {
  console.log(`[p8] PASS ${message}`)
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"))
}

function assertGoldenPathJson() {
  const rootPackage = readJson(resolve(repoRoot, "package.json"))
  const golden = readJson(goldenPath)

  if (typeof rootPackage.version !== "string" || rootPackage.version.length === 0) {
    fail("root package.json must declare version")
  } else if (golden.version !== rootPackage.version) {
    fail(`golden-path.json version ${golden.version} differs from root package.json ${rootPackage.version}`)
  } else {
    pass(`golden-path version matches root package.json (${rootPackage.version})`)
  }

  const pending = Array.isArray(golden.stagesPending) ? golden.stagesPending : null
  if (JSON.stringify(pending) !== JSON.stringify(expectedPending)) {
    fail(`stagesPending must be exactly ${JSON.stringify(expectedPending)}`)
  } else {
    pass("stagesPending records the current Decision 28 delivery gates")
  }

  const seconds = golden.seconds && typeof golden.seconds === "object" ? golden.seconds : null
  for (const key of ["compileAgentDirectory", "resolveAgentDeployment", "total"]) {
    if (typeof seconds?.[key] !== "number" || seconds[key] < 0) {
      fail(`seconds.${key} must be a non-negative number`)
    }
  }
  if (seconds) pass("golden-path seconds include compile, resolve, and total")
}

function runRg(label, pattern, paths, globs = [], options = {}) {
  const result = spawnSync("rg", [
    "-n",
    "--no-heading",
    "--color",
    "never",
    ...(options.multiline ? ["-U"] : []),
    "-e",
    pattern,
    ...paths,
    ...globs.flatMap((glob) => ["-g", glob]),
  ], {
    cwd: repoRoot,
    encoding: "utf8",
  })

  if (result.status === 0) {
    fail(`${label}:\n${result.stdout.trimEnd()}`)
  } else if (result.status === 1) {
    pass(label)
  } else {
    failed = true
    console.error(result.stderr || result.error?.message || `[p8] rg failed for ${label}`)
  }
}

assertGoldenPathJson()

runRg(
  "no public runtime none residue outside historical docs",
  "runtime\\s*:\\s*['\"]none['\"]|runtime\\s*:\\s*none",
  ["."],
  [
    "!docs/issues/391/runtime-refactor/**",
    // Child-owned packs preserve superseded runtime-none planning prose. Their
    // canonical issue plan.md files remain scanned.
    "!docs/issues/805/runtime-refactor/**",
    "!docs/issues/806/runtime-refactor/**",
    "!docs/issues/807/runtime-refactor/**",
    "!docs/issues/808/runtime-refactor/**",
    "!docs/issues/809/runtime-refactor/**",
    "!docs/DECISIONS.md",
    "!docs/plans/archive/**",
    "!packages/**/docs/plans/archive/**",
    "!**/node_modules/**",
    "!**/dist/**",
    "!**/.git/**",
  ],
)

runRg(
  "no node:* imports in src/shared/** not covered by package invariant scripts",
  "from\\s+['\"]node:|import\\s+['\"]node:|import\\s*\\(\\s*['\"]node:|require\\(\\s*['\"]node:",
  ["packages", "apps", "plugins"],
  [
    "**/src/shared/**",
    "!packages/agent/src/shared/**",
    "!packages/boring-bash/src/shared/**",
    "!packages/boring-sandbox/src/shared/**",
    "!**/__tests__/**",
    "!packages/agent/test-fixtures/invariants-bad/**",
    "!**/node_modules/**",
    "!**/dist/**",
  ],
)

runRg(
  "no Buffer references in src/shared/** not covered by package invariant scripts",
  "\\bBuffer\\b",
  ["packages", "apps", "plugins"],
  [
    "**/src/shared/**",
    "!packages/agent/src/shared/**",
    "!packages/boring-bash/src/shared/**",
    "!packages/boring-sandbox/src/shared/**",
    "!**/__tests__/**",
    "!packages/agent/test-fixtures/invariants-bad/**",
    "!**/node_modules/**",
    "!**/dist/**",
  ],
)

runRg(
  "no raw-path HTTP route module signatures",
  "^\\s*(getWorkspaceRoot|workspaceRoot|workspacePath|rootDir|rootPath|baseDir|cwd)\\??\\s*:\\s*[^\\n]*\\bstring\\b",
  ["packages", "apps"],
  [
    "**/src/server/http/routes/**",
    "**/src/server/routes/**",
    "**/src/server/**/routes.ts",
    "**/src/server/**/*Routes.ts",
    "!**/registerAgentRoutes.ts",
    "!**/__tests__/**",
    "!**/node_modules/**",
    "!**/dist/**",
  ],
)

if (failed) process.exit(1)
