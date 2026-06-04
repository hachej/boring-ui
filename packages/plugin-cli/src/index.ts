import {
  buildPluginStatus,
  findHintForError,
  createPlugin,
  formatVerifyResult,
  parseCreateArgs,
  parseScaffoldArgs,
  parseVerifyArgs,
  scaffoldPlugin,
  verifyPlugin,
  workspaceLocalPluginRootsEnabled,
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
  console.log(pluginCommandUsage())
}

export { createPlugin } from "./server/createPlugin"
export type { CreatePluginOptions, CreatePluginResult } from "./server/createPlugin"
export { formatSelfTestResult, runPluginSelfTest } from "./server/testPlugin"
export type { PaneSelfTestState, RunPluginSelfTestOptions, SelfTestEvent, SelfTestResult } from "./server/testPlugin"

