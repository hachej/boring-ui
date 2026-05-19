import type { FastifyInstance } from "fastify"
import type { BoringPluginAssetManager } from "./manager"
import type { BoringPluginEvent } from "./types"

export interface PluginReloadRebuild {
  ok: boolean
  diagnostics: { source: string; message: string; pluginId?: string }[]
}

export interface BoringPluginRoutesOptions {
  manager: BoringPluginAssetManager
  /**
   * Server-side plugin rebuild closure (jiti re-import of dir-source
   * entries). Called AFTER the asset manager scan. Per-plugin failures
   * surface as diagnostics; combined with asset-manager errors into the
   * 422 response body so the agent's /reload UI can show them. Optional —
   * tests that exercise the route in isolation can omit it.
   */
  rebuildPlugins?: () => Promise<PluginReloadRebuild>
}

export async function boringPluginRoutes(app: FastifyInstance, opts: BoringPluginRoutesOptions): Promise<void> {
  const { manager, rebuildPlugins } = opts

  app.post("/api/boring.reload", async (_request, reply) => {
    const scan = await manager.load()
    const rebuild = rebuildPlugins ? await rebuildPlugins() : { ok: true, diagnostics: [] }
    const hasFailures = scan.errors.length > 0 || rebuild.diagnostics.length > 0
    if (hasFailures) {
      return reply.status(422).send({
        ok: false,
        errors: scan.errors,
        diagnostics: rebuild.diagnostics,
        plugins: scan.loaded,
      })
    }
    return reply.send({ ok: true, plugins: scan.loaded })
  })

  app.get("/api/agent-plugins", async () => manager.list())

  app.get<{ Params: { id: string } }>("/api/agent-plugins/:id/error", async (request, reply) => {
    const error = manager.getError(request.params.id)
    if (error == null) return reply.status(404).send({ error: "not_found" })
    return reply.type("text/plain").send(error)
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
