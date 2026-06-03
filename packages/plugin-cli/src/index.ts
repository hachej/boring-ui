import {
  buildPluginStatus,
  findHintForError,
  formatVerifyResult,
  parseScaffoldArgs,
  parseVerifyArgs,
  scaffoldPlugin,
  verifyPlugin,
  workspaceLocalPluginRootsEnabled,
} from "./server/index"

export function pluginCommandUsage(): string {
  return [
    "usage: boring-ui-plugin <command>",
    "",
    "Commands:",
    "  boring-ui-plugin status [--json]",
    "  boring-ui-plugin scaffold <name> [workspace]",
    "  boring-ui-plugin verify [name] [workspace]",
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
  console.log("  4. ask the user: /reload")
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

export function runBoringUiPluginCli(argv = process.argv.slice(2)): void {
  const positionals = argv.filter((arg) => !arg.startsWith("-"))
  const json = argv.includes("--json")
  const command = positionals[0]
  const rest = positionals.slice(1)

  if (command === "status") return handleStatus(json)
  if (command === "scaffold") return handleScaffold(rest)
  if (command === "verify") return handleVerify(rest)
  console.log(pluginCommandUsage())
}

