import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { HELP_TEXT } from "./server/help.js"
import { createLocalWorkspaceRegistry } from "./server/localWorkspaces.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const MODE_MAP = {
  "local": "direct",
  "local-sandbox": "local",
} as const

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase()
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1" || normalized === "[::1]"
}

function truthyEnv(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes"
}

async function handleWorkspaceRegistryCommand(positionals: string[], name?: string): Promise<boolean> {
  if (positionals[0] !== "workspaces") return false
  const subcommand = positionals[1]
  if (!new Set(["add", "list", "remove", "rename"]).has(subcommand ?? "")) return false

  const registry = createLocalWorkspaceRegistry()
  if (subcommand === "add") {
    const target = positionals[2]
    if (!target) throw new Error("usage: boring-ui workspaces add <folder>")
    const workspace = await registry.add(target, { name })
    console.log(`${workspace.name}\n  id    ${workspace.id}\n  path  ${workspace.path}`)
    return true
  }
  if (subcommand === "list") {
    const workspaces = await registry.list()
    if (workspaces.length === 0) {
      console.log("No workspaces. Add one with `boring-ui workspaces add <folder>`.")
      return true
    }
    for (const workspace of workspaces) {
      console.log(`${workspace.available ? "✓" : "!"} ${workspace.name}  ${workspace.id}\n  ${workspace.path}`)
    }
    return true
  }
  if (subcommand === "remove") {
    const id = positionals[2]
    if (!id) throw new Error("usage: boring-ui workspaces remove <id>")
    await registry.remove(id)
    console.log(`removed ${id}`)
    return true
  }
  if (subcommand === "rename") {
    const id = positionals[2]
    const workspaceName = positionals.slice(3).join(" ")
    if (!id || !workspaceName) throw new Error("usage: boring-ui workspaces rename <id> <name>")
    const workspace = await registry.rename(id, workspaceName)
    console.log(`renamed ${workspace.id} -> ${workspace.name}`)
    return true
  }
  return false
}

try {
  if (argv[0] !== "plugin" && (argv.includes("--help") || argv.includes("-h"))) {
    console.log(HELP_TEXT)
    process.exit(0)
  }
  if (argv[0] !== "plugin") {
    const { values: args, positionals } = parseArgs({
      args: argv,
      options: {
        port: { type: "string", short: "p" },
        host: { type: "string" },
        mode: { type: "string", short: "m" },
        name: { type: "string", short: "n" },
        path: { type: "string" as const },
        json: { type: "boolean" as const },
        url: { type: "string" as const },
        workspace: { type: "string" as const },
        "panel-id": { type: "string" as const },
        "timeout-ms": { type: "string" as const },
        "allow-insecure-local-bridge": { type: "boolean" as const },
      },
      allowPositionals: true,
      strict: false,
    })
    const rawMode = (args.mode as string | undefined) ?? process.env.BORING_MODE
    if (rawMode && !(rawMode in MODE_MAP)) {
      throw new Error(`invalid --mode "${rawMode}". Valid options: ${Object.keys(MODE_MAP).join(", ")}`)
    }
    const explicitHost = args.host !== undefined || process.env.HOST !== undefined
    const host = (args.host as string | undefined) ?? process.env.HOST ?? "127.0.0.1"
    const allowInsecureLocalBridgeAuth = isLoopbackHost(host)
      || truthyEnv(process.env.BORING_UI_ALLOW_INSECURE_LOCAL_BRIDGE)
      || args["allow-insecure-local-bridge"] === true
    const registrySubcommands = new Set(["add", "list", "remove", "rename"])
    const startsServer = positionals[0] !== "workspaces" || !registrySubcommands.has(positionals[1] ?? "")
    if (startsServer && !isLoopbackHost(host) && (!explicitHost || !allowInsecureLocalBridgeAuth)) {
      throw new Error("Binding boring-ui to a non-loopback host requires --host plus --allow-insecure-local-bridge. The local CLI WorkspaceBridge browser auth is unauthenticated.")
    }
    if (await handleWorkspaceRegistryCommand(positionals, args.name as string | undefined)) {
      process.exit(0)
    }
  }
  const { runCli } = await import("./server/cli.js")
  await runCli({
    argv,
    publicDir: resolve(__dirname, "..", "public"),
  })
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
