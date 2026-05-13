import type { FastifyInstance } from "fastify"
import type { BoringPluginAssetManager } from "./manager"
import type { BoringPluginEvent } from "./types"

export interface BoringPluginRoutesOptions {
  manager: BoringPluginAssetManager
}

export async function boringPluginRoutes(app: FastifyInstance, opts: BoringPluginRoutesOptions): Promise<void> {
  const { manager } = opts

  app.post("/api/boring.reload", async (_request, reply) => {
    const result = await manager.load()
    if (result.errors.length > 0) {
      return reply.status(422).send({ ok: false, errors: result.errors, plugins: result.loaded })
    }
    return reply.send({ ok: true, plugins: result.loaded })
  })

  app.get("/api/agent-plugins", async () => manager.list())

  app.get<{ Params: { id: string } }>("/api/agent-plugins/:id/error", async (request, reply) => {
    const error = manager.getError(request.params.id)
    if (error == null) return reply.status(404).send({ error: "not_found" })
    return reply.type("text/plain").send(error)
  })

  app.all<{ Params: { pluginId: string; "*": string } }>("/api/boring-plugins/:pluginId/*", async (request, reply) => {
    return await manager.dispatch(
      request.params.pluginId,
      request.method,
      `/${request.params["*"] ?? ""}`,
      request,
      reply,
    )
  })

  app.get("/api/v1/agent-plugins/events", async (request, reply) => {
    reply.hijack()
    const res = reply.raw
    res.statusCode = 200
    res.setHeader("Content-Type", "text/event-stream")
    res.setHeader("Cache-Control", "no-cache, no-transform")
    res.setHeader("Connection", "keep-alive")
    res.setHeader("X-Accel-Buffering", "no")
    res.flushHeaders?.()

    const write = (event: BoringPluginEvent) => {
      try {
        res.write(`event: ${event.type}\n`)
        res.write(`data: ${JSON.stringify(event)}\n\n`)
      } catch {
        // client gone
      }
    }

    for (const plugin of manager.list()) {
      write({
        type: "boring.plugin.load",
        id: plugin.id,
        boring: plugin.boring,
        version: plugin.version,
        revision: plugin.revision,
        ...(plugin.frontUrl ? { frontUrl: plugin.frontUrl } : {}),
      })
    }

    const unsubscribe = manager.subscribe(write)
    const heartbeat = setInterval(() => {
      try { res.write(": heartbeat\n\n") } catch { /* ignore */ }
    }, 25_000)
    request.raw.on("close", () => {
      clearInterval(heartbeat)
      unsubscribe()
    })
  })
}
