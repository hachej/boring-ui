import { createWorkspaceAgentServer } from "@hachej/boring-workspace/app/server"
import fastifyStatic from "@fastify/static"
import { AuthStorage, LoginDialogComponent, OAuthSelectorComponent, initTheme } from "@mariozechner/pi-coding-agent"
import { ProcessTerminal, TUI } from "@mariozechner/pi-tui"
import { execSync } from "node:child_process"
import { existsSync } from "node:fs"
import { createInterface } from "node:readline"
import { basename, dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"

const { values: args } = parseArgs({
  options: {
    port: { type: "string", short: "p" },
    host: { type: "string" },
    mode: { type: "string", short: "m" },
  },
  strict: false,
})

const PORT = Number(args.port ?? process.env.PORT) || 5200
const HOST = (args.host as string | undefined) ?? process.env.HOST ?? "0.0.0.0"

// CLI-facing mode names → internal runtime mode
const MODE_MAP = {
  "local":         "direct", // no sandbox, full network access
  "local-sandbox": "local",  // bwrap isolated, no network (Linux only)
} as const
type CliMode = keyof typeof MODE_MAP
type RuntimeMode = typeof MODE_MAP[CliMode]

const rawMode = (args.mode as string | undefined) ?? process.env.BORING_MODE ?? "local-sandbox"
if (!(rawMode in MODE_MAP)) {
  console.error(`\nError: invalid --mode "${rawMode}". Valid options: ${Object.keys(MODE_MAP).join(", ")}\n`)
  process.exit(1)
}
const CLI_MODE = rawMode as CliMode
const MODE: RuntimeMode = MODE_MAP[CLI_MODE]
const __dirname = dirname(fileURLToPath(import.meta.url))
const publicDir = resolve(__dirname, "..", "public")
const workspaceRoot = process.env.BORING_AGENT_WORKSPACE_ROOT ?? process.cwd()
const projectName = basename(resolve(workspaceRoot)) || "workspace"

if (!existsSync(publicDir)) {
  console.error("\nError: boring-ui frontend not found.")
  console.error("Run `pnpm build:full` in packages/cli to build it first.\n")
  process.exit(1)
}

function openBrowser(url: string) {
  try {
    const opener =
      process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open"
    execSync(`${opener} ${url}`, { stdio: "ignore" })
  } catch {}
}

async function loginWithPi(auth: AuthStorage): Promise<void> {
  const term = new ProcessTerminal()
  const tui = new TUI(term, false)
  initTheme("dark")

  tui.start()

  // Step 1: provider selector — same UI as pi
  const providerId = await new Promise<string>((resolve, reject) => {
    const selector = new OAuthSelectorComponent("login", auth, resolve, () =>
      reject(new Error("Login cancelled")),
    )
    tui.addChild(selector)
    tui.setFocus(selector)
    tui.requestRender()
  })

  // Step 2: login dialog for the chosen provider
  await new Promise<void>((resolve, reject) => {
    const dialog = new LoginDialogComponent(tui, providerId, (success: unknown) => {
      success !== false ? resolve() : reject(new Error("Login cancelled"))
    })

    tui.addChild(dialog)
    tui.setFocus(dialog)
    tui.requestRender()

    auth
      .login(providerId, {
        onAuth: ({ url }) => {
          openBrowser(url)
          dialog.showAuth(url, "Your browser should open automatically. Waiting for login…")
        },
        onProgress: (msg: string) => dialog.showProgress(msg),
        onPrompt: ({ message }) =>
          new Promise<string>((res) => {
            dialog.showManualInput(message)
            const rl = createInterface({ input: process.stdin, output: process.stdout })
            rl.question("", (code) => { rl.close(); res(code.trim()) })
          }),
      })
      .catch(reject)
  })

  tui.stop()
  term.stop()
}

async function resolveApiKey(): Promise<string> {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY

  const auth = AuthStorage.create()
  await auth.reload()

  const stored = await auth.getApiKey("anthropic")
  if (stored) return stored

  console.log("\nNo API key found — launching login…\n")
  await loginWithPi(auth)

  const key = await auth.getApiKey("anthropic")
  if (!key) {
    console.error("\nLogin failed. Set ANTHROPIC_API_KEY manually.\n")
    process.exit(1)
  }
  return key
}

const apiKey = await resolveApiKey()
process.env.ANTHROPIC_API_KEY = apiKey

console.log(`\n${projectName}`)
console.log(`  workspace  ${workspaceRoot}`)
console.log(`  mode       ${CLI_MODE}`)
console.log(`  port       ${PORT}`)
console.log(`  host       ${HOST}`)

const app = await createWorkspaceAgentServer({
  workspaceRoot,
  mode: MODE,
  logger: false,
})

app.get("/api/v1/workspace/meta", async () => ({
  workspaceRoot,
  projectName,
}))

await app.register(fastifyStatic, {
  root: publicDir,
  prefix: "/",
  wildcard: false,
})

app.setNotFoundHandler(async (req, reply) => {
  if (req.url.startsWith("/api/")) {
    return reply.code(404).send({ error: "Not found" })
  }
  return reply.sendFile("index.html", publicDir)
})

await app.listen({ port: PORT, host: HOST })
console.log(`\n  http://localhost:${PORT}\n`)

openBrowser(`http://localhost:${PORT}`)
