import { createWorkspaceAgentServer } from "@boring/workspace/app/server"
import fastifyStatic from "@fastify/static"
import { AuthStorage } from "@mariozechner/pi-coding-agent"
import { execSync } from "node:child_process"
import { existsSync } from "node:fs"
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

// Resolve API key: env var → pi credential store → error
async function resolveApiKey(): Promise<string> {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY

  const auth = AuthStorage.create()
  await auth.reload()
  const key = await auth.getApiKey("anthropic")
  if (key) return key

  console.error("\nNo Anthropic API key found.")
  console.error("Either:")
  console.error("  export ANTHROPIC_API_KEY=sk-ant-...")
  console.error("  or log in with pi:  npx @mariozechner/pi-coding-agent  →  /login\n")
  process.exit(1)
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

try {
  const opener =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open"
  execSync(`${opener} http://localhost:${PORT}`, { stdio: "ignore" })
} catch {}
