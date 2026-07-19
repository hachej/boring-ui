const KNOWN_CONCRETE_PURE_UNIT_FILES = [
  "src/__tests__/clivitestbuildselection.test.ts",
  "src/__tests__/foldermoderuntimeplugins.test.ts",
  "src/__tests__/fronturl.test.ts",
  "src/__tests__/localworkspaces.test.ts",
  "src/__tests__/plugindiscovery.test.ts",
  "src/__tests__/runtimeprovisioning.test.ts",
  "src/__tests__/workspacesmoderuntimeplugins.test.ts",
]

const VITEST_COMMANDS = new Set([
  "run",
  "watch",
  "dev",
  "related",
  "bench",
  "list",
])

const OPTIONS_WITH_VALUE = new Set([
  "--allowOnly",
  "--browser",
  "--config",
  "-c",
  "--coverage.provider",
  "--dir",
  "--environment",
  "--exclude",
  "--globalSetup",
  "--include",
  "--isolate",
  "--maxConcurrency",
  "--maxWorkers",
  "--minWorkers",
  "--name",
  "--outputFile",
  "--pool",
  "--poolOptions",
  "--project",
  "--reporter",
  "--root",
  "-r",
  "--sequence.shuffle.seed",
  "--shard",
  "--testNamePattern",
  "-t",
  "--testTimeout",
  "--typecheck",
])

function normalizeArgPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "").toLowerCase()
}

function optionName(token: string): string {
  const equalsIndex = token.indexOf("=")
  return equalsIndex === -1 ? token : token.slice(0, equalsIndex)
}

function isOptionValueToken(argv: readonly string[], index: number): boolean {
  const previous = argv[index - 1]
  return previous !== undefined && OPTIONS_WITH_VALUE.has(optionName(previous)) && !previous.includes("=")
}

export function collectVitestFileFilters(argv: readonly string[]): string[] {
  const filters: string[] = []
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === undefined) continue
    if (isOptionValueToken(argv, index)) continue
    if (token.startsWith("-")) continue
    if (VITEST_COMMANDS.has(token)) continue
    filters.push(normalizeArgPath(token))
  }
  return filters
}

function isKnownConcretePureUnitFile(filter: string): boolean {
  const normalized = normalizeArgPath(filter)
  return KNOWN_CONCRETE_PURE_UNIT_FILES.some((file) => (
    normalized === file
    || normalized.endsWith(`/${file}`)
    || normalized === file.split("/").at(-1)
  ))
}

export function shouldBuildCliDistForVitestArgv(argv: readonly string[]): boolean {
  const filters = collectVitestFileFilters(argv)
  if (filters.length === 0) return true
  return !filters.every(isKnownConcretePureUnitFile)
}
