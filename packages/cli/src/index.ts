import { createWorkspaceAgentServer } from "@boring/workspace/app/server"
import fastifyStatic from "@fastify/static"
import { AuthStorage } from "@mariozechner/pi-coding-agent"
import { execSync } from "node:child_process"
import { existsSync } from "node:fs"
import { createInterface } from "node:readline"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const PORT = Number(process.env.PORT) || 5200
const __dirname = dirname(fileURLToPath(import.meta.url))
const publicDir = resolve(__dirname, "..", "public")
const workspaceRoot = process.env.BORING_AGENT_WORKSPACE_ROOT ?? process.cwd()

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

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => rl.question(question, (ans) => { rl.close(); resolve(ans.trim()) }))
}

async function resolveApiKey(): Promise<string> {
  // 1. env var
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY

  // 2. pi credential store
  const auth = AuthStorage.create()
  await auth.reload()
  const stored = await auth.getApiKey("anthropic")
  if (stored) return stored

  // 3. inline OAuth — same flow pi uses
  console.log("\nNo API key found. Logging in with Anthropic (Claude Pro/Max)...\n")

  await auth.login("anthropic", {
    onAuth: (url: string) => {
      console.log(`Opening browser: ${url}\n`)
      openBrowser(url)
    },
    onPrompt: (msg: string) => process.stdout.write(msg),
    onProgress: (msg: string) => process.stdout.write(msg),
    onManualCodeInput: () => prompt("Paste the code from your browser: "),
  })

  const key = await auth.getApiKey("anthropic")
  if (!key) {
    console.error("\nLogin failed. Try setting ANTHROPIC_API_KEY manually.\n")
    process.exit(1)
  }

  console.log("\nLogged in. Credentials saved to ~/.pi/agent/\n")
  return key
}

const apiKey = await resolveApiKey()
process.env.ANTHROPIC_API_KEY = apiKey

console.log(`\nboring-ui`)
console.log(`  workspace  ${workspaceRoot}`)
console.log(`  port       ${PORT}`)

const app = await createWorkspaceAgentServer({
  workspaceRoot,
  mode: "local",
  logger: false,
})

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

await app.listen({ port: PORT, host: "0.0.0.0" })
console.log(`\n  http://localhost:${PORT}\n`)

openBrowser(`http://localhost:${PORT}`)
