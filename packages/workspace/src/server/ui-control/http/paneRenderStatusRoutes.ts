import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z, type ZodSchema } from "zod"
import { createPaneRenderStatusStore, type PaneRenderStatusStore } from "../panelStatus/paneRenderStatusStore"

const reportBodySchema = z.object({
  workspaceId: z.string().optional(),
  pluginId: z.string().min(1),
  panelId: z.string().min(1),
  panelInstanceId: z.string().min(1),
  revision: z.number().optional(),
  state: z.enum(["loading", "ready", "error", "missing"]),
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
  }).optional(),
})

function createBodyValidator<T>(schema: ZodSchema<T>) {
  return async function validateBody(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const parsed = schema.safeParse(request.body)
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0]
      const fieldName = firstIssue?.path
        ?.map((segment: string | number) => String(segment))
        .join(".")
      reply.code(400).send({
        error: "validation_error",
        message: firstIssue?.message ?? "Invalid request body",
        field: fieldName || undefined,
      })
      return
    }
    request.body = parsed.data
  }
}

export interface PaneRenderStatusRoutesOptions {
  store?: PaneRenderStatusStore
  getWorkspaceId?: (request: FastifyRequest) => string | undefined | Promise<string | undefined>
}

export function resolvePaneStatusWorkspaceId(request: FastifyRequest): string | undefined {
  const headers = request.headers as Record<string, string | string[] | undefined>
  const header = headers["x-boring-workspace-id"] ?? headers["X-Boring-Workspace-Id"]
  if (Array.isArray(header)) return header[0]
  if (typeof header === "string" && header.trim()) return header
  const query = request.query as Record<string, unknown> | undefined
  const workspaceId = query?.workspaceId
  return typeof workspaceId === "string" && workspaceId.trim() ? workspaceId : undefined
}

export function paneRenderStatusRoutes(
  app: FastifyInstance,
  opts: PaneRenderStatusRoutesOptions = {},
  done: (err?: Error) => void,
): void {
  const store = opts.store ?? createPaneRenderStatusStore()
  const validateReport = createBodyValidator(reportBodySchema)
  const getWorkspaceId = async (request: FastifyRequest) => {
    return (await opts.getWorkspaceId?.(request)) ?? resolvePaneStatusWorkspaceId(request)
  }

  app.put(
    "/api/v1/ui/panels/status",
    { preHandler: validateReport },
    async (request, reply) => {
      const body = request.body as z.infer<typeof reportBodySchema>
      const workspaceId = (await getWorkspaceId(request)) ?? body.workspaceId
      const status = store.report({ ...body, workspaceId })
      return reply.code(200).send({ ok: true, status })
    },
  )

  app.get("/api/v1/ui/panels/status", async (request, reply) => {
    const query = request.query as Record<string, unknown>
    const panelInstanceId = query.panelInstanceId
    if (typeof panelInstanceId !== "string" || !panelInstanceId.trim()) {
      return reply.code(400).send({ error: "validation_error", message: "panelInstanceId is required", field: "panelInstanceId" })
    }
    const workspaceId = await getWorkspaceId(request)
    const pluginId = typeof query.pluginId === "string" ? query.pluginId : undefined
    const panelId = typeof query.panelId === "string" ? query.panelId : undefined
    const status = store.get({ workspaceId, panelInstanceId, pluginId, panelId })
    const connected = store.hasRecentUiContact(workspaceId)
    return {
      ok: true,
      connected,
      state: status?.state ?? (connected ? "missing" : "no-browser-connected"),
      ...(status ? { status } : {}),
    }
  })

  done()
}
