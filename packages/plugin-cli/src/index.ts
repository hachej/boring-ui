import {
  buildPluginStatus,
  findHintForError,
  createPlugin,
  formatPluginSourceList,
  formatVerifyResult,
  installPluginSource,
  listPluginSources,
  parseCreateArgs,
  parseScaffoldArgs,
  parseVerifyArgs,
  removePluginSource,
  scaffoldPlugin,
  verifyPlugin,
  workspaceLocalPluginRootsEnabled,
  type PluginInstallScope,
} from "./server/index"
import { formatSelfTestResult, runPluginSelfTest } from "./server/testPlugin"

export function pluginCommandUsage(): string {
  return [
    "usage: boring-ui-plugin <command>",
    "",
    "Commands:",
    "  boring-ui-plugin status [--json]",
    "  boring-ui-plugin create <name> [--path <dir>]",
    "  boring-ui-plugin scaffold <name> [workspace]",
    "  boring-ui-plugin verify [name] [workspace]",
    "  boring-ui-plugin test <name> [--url <url>] [--workspace <id>] [--panel-id <id>] [--timeout-ms <ms>] [--json]",
    "  boring-ui-plugin install [-l|--local|--global] [--workspace <dir>] <source>",
    "  boring-ui-plugin list [--local|--global|--all] [--workspace <dir>] [--json]",
    "  boring-ui-plugin remove [-l|--local|--global] [--workspace <dir>] <id-or-source>",
  ].join("\n")
}

function handleStatus(json: boolean): void {
  const status = buildPluginStatus()
  if (json) {
    console.log(JSON.stringify(status, null, 2))
    return
  }
  console.log(status.workspaceLocalPluginRoots
    ? `workspace-local plugin roots enabled: ${status.extensionsDir}`
    : `workspace-local plugin roots disabled: ${status.reason}`)
}

function handleCreate(argv: string[], positionals: string[]): void {
  const args = parseCreateArgs(positionals)
  const result = createPlugin({
    name: args.name,
    ...(readOption(argv, "--path") ? { path: readOption(argv, "--path") } : {}),
  })
  console.log(`created ${result.id}`)
  console.log(`  dir   ${result.pluginDir}`)
  console.log("")
  console.log("Next steps:")
  console.log(`  1. cd ${result.pluginDir}`)
  console.log("  2. pnpm install")
  console.log(`  3. pnpm --filter ${result.packageName} typecheck`)
  console.log(`  4. pnpm --filter ${result.packageName} test`)
}

function handleScaffold(positionals: string[]): void {
  const args = parseScaffoldArgs(positionals)
  const status = buildPluginStatus(args.workspaceRoot)
  if (!workspaceLocalPluginRootsEnabled()) {
    throw new Error(`${status.reason} Do not scaffold into .pi/extensions in this runtime.`)
  }
  const result = scaffoldPlugin(args)
  console.log(`scaffolded ${args.name}`)
  console.log(`  dir   ${result.pluginDir}`)
  for (const file of result.filesCreated) console.log(`  +     ${file}`)
  console.log("")
  console.log("Next steps:")
  console.log("  1. edit front/index.tsx for UI panels/commands/resolvers")
  console.log("  2. add pi.extensions / skills for hot-reloadable agent behavior")
  console.log("  3. bash `boring-ui-plugin verify` — confirms manifests + files are valid")
  console.log("  4. if the UI is open, bash `boring-ui-plugin test <name>` — catches panel render failures")
  console.log("  5. ask the user: /reload")
  console.log("  6. after /reload, call the plugin_diagnostics tool to confirm no load errors — /reload reports plugin/skill errors there")
}

function handleVerify(positionals: string[]): void {
  const result = verifyPlugin(parseVerifyArgs(positionals))
  console.log(formatVerifyResult(result))
  if (result.ok) return

  const hints: string[] = []
  for (const outcome of result.outcomes) {
    for (const err of outcome.errors) {
      const hint = findHintForError(err)
      if (hint) hints.push(`  hint (${outcome.id}): ${hint}`)
    }
  }
  if (hints.length > 0) {
    console.log("")
    console.log("Suggestions:")
    for (const hint of hints) console.log(hint)
  }
  process.exit(1)
}

function readOption(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name)
  if (index === -1) return undefined
  return argv[index + 1]
}

function pluginSourceScope(argv: string[]): PluginInstallScope {
  if (argv.includes("--global")) return "global"
  return "local"
}

function pluginSourceWorkspaceRoot(argv: string[]): string | undefined {
  return readOption(argv, "--workspace")
}

function commandPositionals(argv: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--workspace") {
      i++
      continue
    }
    if (arg.startsWith("-")) continue
    out.push(arg)
  }
  return out
}

function handleInstall(argv: string[], json: boolean): void {
  const source = commandPositionals(argv)[1]
  if (!source) throw new Error("usage: boring-ui-plugin install [--local|--global] [--workspace <dir>] <source>")
  const result = installPluginSource({
    source,
    scope: pluginSourceScope(argv),
    ...(pluginSourceWorkspaceRoot(argv) ? { workspaceRoot: pluginSourceWorkspaceRoot(argv) } : {}),
  })
  if (json) {
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (result.record.kind === "git" || result.record.kind === "npm") {
    console.warn("Security: Boring plugins run as trusted local code in CLI mode. Review third-party source before installing.")
  }
  console.log(`${result.replaced ? "updated" : "installed"} ${result.record.id}`)
  console.log(`  scope ${result.record.scope}`)
  console.log(`  kind  ${result.record.kind}`)
  console.log(`  dir   ${result.record.rootDir}`)
  if (result.dependencyHints.length > 0) {
    console.log("")
    console.log("Dependencies are not installed by boring-ui-plugin install. Run package-manager commands in the plugin folder:")
    for (const hint of result.dependencyHints) console.log(hint)
  }
  console.log("")
  console.log("Next step: ask the user to run /reload in the workspace UI.")
}

function handleList(argv: string[], json: boolean): void {
  const scope = argv.includes("--all") ? "all" : pluginSourceScope(argv)
  const result = listPluginSources({
    scope,
    ...(pluginSourceWorkspaceRoot(argv) ? { workspaceRoot: pluginSourceWorkspaceRoot(argv) } : {}),
  })
  console.log(json ? JSON.stringify(result, null, 2) : formatPluginSourceList(result))
}

function handleRemove(argv: string[], json: boolean): void {
  const target = commandPositionals(argv)[1]
  if (!target) throw new Error("usage: boring-ui-plugin remove [--local|--global] [--workspace <dir>] <id-or-source>")
  const result = removePluginSource({
    target,
    scope: pluginSourceScope(argv),
    ...(pluginSourceWorkspaceRoot(argv) ? { workspaceRoot: pluginSourceWorkspaceRoot(argv) } : {}),
  })
  if (json) {
    console.log(JSON.stringify(result, null, 2))
    return
  }
  console.log(`removed ${result.record.id}`)
  console.log(`  scope ${result.record.scope}`)
  if (result.removedSourceDir) console.log(`  deleted ${result.record.rootDir}`)
}

async function handleTest(argv: string[], positionals: string[], json: boolean): Promise<void> {
  const name = positionals[0]
  if (!name) throw new Error("usage: boring-ui-plugin test <name> [--url <local-server-url>] [--workspace <id>] [--panel-id <id>] [--timeout-ms <ms>] [--json]")
  const timeoutRaw = readOption(argv, "--timeout-ms")
  const timeoutMs = timeoutRaw ? Number(timeoutRaw) : undefined
  if (timeoutRaw && (timeoutMs == null || !Number.isFinite(timeoutMs) || timeoutMs <= 0)) throw new Error("--timeout-ms must be a positive number")
  const result = await runPluginSelfTest({
    pluginId: name,
    ...(readOption(argv, "--url") ? { url: readOption(argv, "--url") } : {}),
    ...(readOption(argv, "--workspace") ? { workspaceId: readOption(argv, "--workspace") } : {}),
    ...(readOption(argv, "--panel-id") ? { panelId: readOption(argv, "--panel-id") } : {}),
    ...(timeoutMs == null ? {} : { timeoutMs }),
  })
  console.log(json ? JSON.stringify(result, null, 2) : formatSelfTestResult(result))
  if (!result.ok) process.exit(1)
}

export async function runBoringUiPluginCli(argv = process.argv.slice(2)): Promise<void> {
  const positionals = argv.filter((arg) => !arg.startsWith("-"))
  const json = argv.includes("--json")
  const command = positionals[0]
  const rest = positionals.slice(1)

  if (command === "status") return handleStatus(json)
  if (command === "create") return handleCreate(argv, rest)
  if (command === "scaffold") return handleScaffold(rest)
  if (command === "verify") return handleVerify(rest)
  if (command === "test") return await handleTest(argv, rest, json)
  if (command === "install") return handleInstall(argv, json)
  if (command === "list") return handleList(argv, json)
  if (command === "remove") return handleRemove(argv, json)
  console.log(pluginCommandUsage())
}

export {
  createPlugin,
  findHintForError,
  formatPluginSourceList,
  formatVerifyResult,
  installPluginSource,
  listPluginSources,
  readPluginSourceRecords,
  readPluginSourceRecordsForRoots,
  removePluginSource,
  resolvePluginSourceScopePaths,
  scaffoldPlugin,
  verifyPlugin,
} from "./server/index"
export type {
  CreatePluginOptions,
  CreatePluginResult,
  InstallPluginSourceOptions,
  ListPluginSourcesOptions,
  PluginInstallResult,
  PluginInstallScope,
  PluginListResult,
  PluginRemoveResult,
  PluginSourceKind,
  PluginSourceRecord,
  PluginSourceScopePaths,
  PluginVerifyOutcome,
  RemovePluginSourceOptions,
  ScaffoldPluginOptions,
  ScaffoldPluginResult,
  VerifyPluginResult,
} from "./server/index"
export { formatSelfTestResult, runPluginSelfTest } from "./server/testPlugin"
export type { PaneSelfTestState, RunPluginSelfTestOptions, SelfTestEvent, SelfTestResult } from "./server/testPlugin"

