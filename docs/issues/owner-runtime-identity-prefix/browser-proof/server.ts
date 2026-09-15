import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createWorkspaceAgentServer } from "@hachej/boring-workspace/app/server"
import { createWorkspaceUiCommands } from "@hachej/boring-workspace/plugin"
import { defineServerPlugin } from "@hachej/boring-workspace/server"

const PREFIX = "/owners/alice/workspace"
const AUTHORIZATION = "Bearer pane-proof"
const workspaceRoot = await mkdtemp(join(tmpdir(), "owner-pane-proof-"))
let postCount = 0
let drainCount = 0
let deliveredSeqs: number[] = []

const app = await createWorkspaceAgentServer({
  workspaceRoot,
  routePrefix: PREFIX,
  mode: "direct",
  logger: false,
  provisionWorkspace: false,
  externalPlugins: false,
  defaults: [],
  plugins: [(ctx) => defineServerPlugin({
    id: "owner-agent-plugin",
    routes: async (routes) => {
      routes.post("/proof/open", async (request, reply) => {
        if (request.headers.authorization !== AUTHORIZATION) return reply.code(401).send({ ok: false })
        const body = request.body as { kind?: string; target?: string }
        postCount += 1
        const result = await createWorkspaceUiCommands(ctx.bridge).openSurface({
          kind: body.kind,
          target: body.target,
        })
        return { ok: true, postCount, result }
      })
      routes.get("/proof/stats", async (request, reply) => {
        if (request.headers.authorization !== AUTHORIZATION) return reply.code(401).send({ ok: false })
        return { postCount, drainCount, deliveredSeqs }
      })
    },
  })],
} as Parameters<typeof createWorkspaceAgentServer>[0])

app.addHook("onRequest", async (request, reply) => {
  const path = request.url.split("?", 1)[0]
  if (path === `${PREFIX}/api/v1/ui/commands/next` && request.headers.authorization !== AUTHORIZATION) {
    return reply.code(401).send({ error: "unauthorized" })
  }
})
app.addHook("onSend", async (request, _reply, payload) => {
  if (request.url.startsWith(`${PREFIX}/api/v1/ui/commands/next?poll=true`) && typeof payload === "string") {
    drainCount += 1
    try {
      const batch = JSON.parse(payload) as Array<{ seq?: unknown }>
      deliveredSeqs.push(...batch.flatMap(({ seq }) => typeof seq === "number" ? [seq] : []))
    } catch { /* An invalid response will fail the browser assertion. */ }
  }
})

let shuttingDown = false
async function shutdown(exitCode?: number): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  try { await app.close() } finally {
    await rm(workspaceRoot, { recursive: true, force: true })
    if (exitCode !== undefined) process.exit(exitCode)
  }
}
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => void shutdown(0))
process.once("uncaughtException", (error) => { console.error(error); void shutdown(1) })
process.once("unhandledRejection", (error) => { console.error(error); void shutdown(1) })

try {
  await app.listen({ host: "127.0.0.1", port: 5470 })
  console.log(`owner pane proof server ready workspaceRoot=${workspaceRoot}`)
} catch (error) {
  console.error(error)
  await shutdown(1)
}
