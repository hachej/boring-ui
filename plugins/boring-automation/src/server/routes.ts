import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { ZodError, type ZodSchema } from "zod"
import {
  AutomationCreateSchema,
  AutomationPatchSchema,
  AutomationRunCreateSchema,
  AutomationRunPatchSchema,
  BORING_AUTOMATION_DEFAULT_WORKSPACE_ID,
  BORING_AUTOMATION_ERROR_CODES,
  BORING_AUTOMATION_ROUTE_PREFIX,
  BORING_AUTOMATION_WORKSPACE_HEADER,
  IdParamsSchema,
  PromptUpdateSchema,
  RunIdParamsSchema,
  type AutomationStore,
  type AutomationStoreCtx,
} from "../shared"
import { AutomationStoreError } from "./store"

export interface AutomationRoutesOptions {
  store: AutomationStore
  defaultWorkspaceId?: string
}

type WorkspaceRequest = FastifyRequest & {
  workspaceContext?: { workspaceId?: string }
}

export async function automationRoutes(app: FastifyInstance, opts: AutomationRoutesOptions): Promise<void> {
  const ctxFor = (request: FastifyRequest) => workspaceCtxFromRequest(request as WorkspaceRequest, opts.defaultWorkspaceId)

  app.get(`${BORING_AUTOMATION_ROUTE_PREFIX}/automations`, async (request, reply) => {
    try {
      return { ok: true, automations: await opts.store.listAutomations(ctxFor(request)) }
    } catch (cause) {
      return sendError(reply, cause)
    }
  })

  app.post(`${BORING_AUTOMATION_ROUTE_PREFIX}/automations`, async (request, reply) => {
    try {
      const automation = await opts.store.createAutomation(ctxFor(request), parseBody(AutomationCreateSchema, request.body))
      return reply.status(201).send({ ok: true, automation })
    } catch (cause) {
      return sendError(reply, cause)
    }
  })

  app.get(`${BORING_AUTOMATION_ROUTE_PREFIX}/automations/:id`, async (request, reply) => {
    try {
      const { id } = parseParams(IdParamsSchema, request.params)
      const automation = await opts.store.getAutomation(ctxFor(request), id)
      if (!automation) throw new AutomationStoreError(BORING_AUTOMATION_ERROR_CODES.AUTOMATION_NOT_FOUND, `automation ${id} not found`, 404)
      return { ok: true, automation }
    } catch (cause) {
      return sendError(reply, cause)
    }
  })

  app.patch(`${BORING_AUTOMATION_ROUTE_PREFIX}/automations/:id`, async (request, reply) => {
    try {
      const { id } = parseParams(IdParamsSchema, request.params)
      const automation = await opts.store.updateAutomation(ctxFor(request), id, parseBody(AutomationPatchSchema, request.body))
      return { ok: true, automation }
    } catch (cause) {
      return sendError(reply, cause)
    }
  })

  app.delete(`${BORING_AUTOMATION_ROUTE_PREFIX}/automations/:id`, async (request, reply) => {
    try {
      const { id } = parseParams(IdParamsSchema, request.params)
      await opts.store.deleteAutomation(ctxFor(request), id)
      return reply.status(204).send()
    } catch (cause) {
      return sendError(reply, cause)
    }
  })

  app.get(`${BORING_AUTOMATION_ROUTE_PREFIX}/automations/:id/prompt`, async (request, reply) => {
    try {
      const { id } = parseParams(IdParamsSchema, request.params)
      return { ok: true, prompt: await opts.store.getPrompt(ctxFor(request), id) }
    } catch (cause) {
      return sendError(reply, cause)
    }
  })

  app.put(`${BORING_AUTOMATION_ROUTE_PREFIX}/automations/:id/prompt`, async (request, reply) => {
    try {
      const { id } = parseParams(IdParamsSchema, request.params)
      const { prompt } = parseBody(PromptUpdateSchema, request.body)
      await opts.store.updatePrompt(ctxFor(request), id, prompt)
      return { ok: true }
    } catch (cause) {
      return sendError(reply, cause)
    }
  })

  app.get(`${BORING_AUTOMATION_ROUTE_PREFIX}/automations/:id/runs`, async (request, reply) => {
    try {
      const { id } = parseParams(IdParamsSchema, request.params)
      return { ok: true, runs: await opts.store.listRuns(ctxFor(request), id) }
    } catch (cause) {
      return sendError(reply, cause)
    }
  })

  app.post(`${BORING_AUTOMATION_ROUTE_PREFIX}/automations/:id/runs`, async (request, reply) => {
    try {
      const { id } = parseParams(IdParamsSchema, request.params)
      const input = parseBody(AutomationRunCreateSchema, request.body)
      if (input.automationId !== id) {
        throw new AutomationStoreError(BORING_AUTOMATION_ERROR_CODES.INVALID_BODY, "run automationId must match route automation id", 400)
      }
      const run = await opts.store.createRun(ctxFor(request), input)
      return reply.status(201).send({ ok: true, run })
    } catch (cause) {
      return sendError(reply, cause)
    }
  })

  app.patch(`${BORING_AUTOMATION_ROUTE_PREFIX}/automations/:id/runs/:runId`, async (request, reply) => {
    try {
      const { id, runId } = parseParams(RunIdParamsSchema, request.params)
      const ctx = ctxFor(request)
      const existing = (await opts.store.listRuns(ctx, id)).find((run) => run.id === runId)
      if (!existing) {
        throw new AutomationStoreError(BORING_AUTOMATION_ERROR_CODES.RUN_NOT_FOUND, `automation run ${runId} not found`, 404)
      }
      const run = await opts.store.updateRun(ctx, runId, parseBody(AutomationRunPatchSchema, request.body))
      return { ok: true, run }
    } catch (cause) {
      return sendError(reply, cause)
    }
  })
}

export function workspaceCtxFromRequest(request: WorkspaceRequest, defaultWorkspaceId = BORING_AUTOMATION_DEFAULT_WORKSPACE_ID): AutomationStoreCtx {
  const decorated = request.workspaceContext?.workspaceId
  if (typeof decorated === "string" && decorated.length > 0) return { workspaceId: decorated }
  const header = request.headers[BORING_AUTOMATION_WORKSPACE_HEADER]
  if (typeof header === "string" && header.length > 0) return { workspaceId: header }
  if (Array.isArray(header) && typeof header[0] === "string" && header[0].length > 0) return { workspaceId: header[0] }
  return { workspaceId: defaultWorkspaceId }
}

function parseBody<T>(schema: ZodSchema<T>, body: unknown): T {
  return parse(schema, body)
}

function parseParams<T>(schema: ZodSchema<T>, params: unknown): T {
  return parse(schema, params)
}

function parse<T>(schema: ZodSchema<T>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw parsed.error
  return parsed.data
}

function sendError(reply: FastifyReply, cause: unknown) {
  if (cause instanceof ZodError) {
    return reply.status(400).send({
      ok: false,
      code: BORING_AUTOMATION_ERROR_CODES.INVALID_BODY,
      error: cause.issues[0]?.message ?? "invalid request",
    })
  }
  if (cause instanceof AutomationStoreError) {
    return reply.status(cause.status).send({ ok: false, code: cause.code, error: cause.message })
  }
  throw cause
}
