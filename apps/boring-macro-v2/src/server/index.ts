import { join } from "node:path"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { createWorkspaceAgentServer } from "@hachej/boring-workspace/app/server"
import { createMacroServerPlugin } from "../plugins/macro/server"

export interface MacroAppOptions {
  port?: number
  host?: string
  workspaceRoot?: string
  appRoot?: string
}

export async function buildMacroServer(opts: MacroAppOptions = {}) {
  const port = opts.port ?? (Number(process.env.PORT ?? process.env.API_PORT) || 5210)
  const host = opts.host ?? (process.env.HOST || "0.0.0.0")
  const workspaceRoot =
    opts.workspaceRoot ??
    (process.env.BORING_AGENT_WORKSPACE_ROOT ?? process.cwd())

  const macroPlugin = await createMacroServerPlugin()
  const macroTemplatePath = fileURLToPath(
    new URL("../plugins/macro/server/workspace-template", import.meta.url),
  )

  const app = await createWorkspaceAgentServer({
    workspaceRoot,
    templatePath: macroTemplatePath,
    plugins: [macroPlugin],
  })

  if (opts.appRoot) {
    const distDir = join(opts.appRoot, "dist")
    const indexPath = join(distDir, "index.html")
    const { default: fastifyStatic } = await import("@fastify/static")
    await app.register(fastifyStatic, {
      root: distDir,
      prefix: "/",
      wildcard: false,
    })
    // SPA catch-all: serve index.html for non-API GET requests
    app.setNotFoundHandler(async (request, reply) => {
      if (request.method === "GET" && !request.url.startsWith("/api/")) {
        const html = await readFile(indexPath, "utf-8")
        return reply.type("text/html; charset=utf-8").send(html)
      }
      reply.status(404).send({ error: "Not Found", statusCode: 404 })
    })
  }

  return { app, port, host }
}

export { buildMacroServer as buildServer }
