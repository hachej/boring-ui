import type { FastifyInstance, FastifyReply } from "fastify"
import { ZodError, type ZodSchema } from "zod"
import {
  AutomationCreateSchema,
  AutomationPatchSchema,
  BORING_AUTOMATION_ERROR_CODES,
  BORING_AUTOMATION_ROUTE_PREFIX,
  IdParamsSchema,
  PromptUpdateSchema,
} from "../shared"
import { ManualRunExecutor } from "./manualRunExecutor"
import { AutomationStoreError, automationNotFound, type AutomationStore } from "./store"

export interface AutomationRoutesOptions {
  store: AutomationStore
  manualRunExecutor?: Pick<ManualRunExecutor, "run">
}

export async function automationRoutes(app: FastifyInstance, opts: AutomationRoutesOptions): Promise<void> {
  app.get(`${BORING_AUTOMATION_ROUTE_PREFIX}/automations`, async (_request, reply) => {
    try {
      return { ok: true, automations: await opts.store.listAutomations() }
    } catch (cause) {
      return sendError(reply, cause)
    }
  })

  app.post(`${BORING_AUTOMATION_ROUTE_PREFIX}/automations`, async (request, reply) => {
    try {
      const automation = await opts.store.createAutomation(parseBody(AutomationCreateSchema, request.body))
      return reply.status(201).send({ ok: true, automation })
    } catch (cause) {
      return sendError(reply, cause)
    }
  })

  app.get(`${BORING_AUTOMATION_ROUTE_PREFIX}/automations/:id`, async (request, reply) => {
    try {
      const { id } = parseParams(IdParamsSchema, request.params)
      const automation = await opts.store.getAutomation(id)
      if (!automation) throw automationNotFound(id)
      return { ok: true, automation }
    } catch (cause) {
      return sendError(reply, cause)
    }
  })

  app.patch(`${BORING_AUTOMATION_ROUTE_PREFIX}/automations/:id`, async (request, reply) => {
    try {
      const { id } = parseParams(IdParamsSchema, request.params)
      const automation = await opts.store.updateAutomation(id, parseBody(AutomationPatchSchema, request.body))
      return { ok: true, automation }
    } catch (cause) {
      return sendError(reply, cause)
    }
  })

  app.delete(`${BORING_AUTOMATION_ROUTE_PREFIX}/automations/:id`, async (request, reply) => {
    try {
      const { id } = parseParams(IdParamsSchema, request.params)
      await opts.store.deleteAutomation(id)
      return reply.status(204).send()
    } catch (cause) {
      return sendError(reply, cause)
    }
  })

  app.get(`${BORING_AUTOMATION_ROUTE_PREFIX}/automations/:id/prompt`, async (request, reply) => {
    try {
      const { id } = parseParams(IdParamsSchema, request.params)
      return { ok: true, prompt: await opts.store.getPrompt(id) }
    } catch (cause) {
      return sendError(reply, cause)
    }
  })

  app.put(`${BORING_AUTOMATION_ROUTE_PREFIX}/automations/:id/prompt`, async (request, reply) => {
    try {
      const { id } = parseParams(IdParamsSchema, request.params)
      const { prompt } = parseBody(PromptUpdateSchema, request.body)
      await opts.store.updatePrompt(id, prompt)
      return { ok: true }
    } catch (cause) {
      return sendError(reply, cause)
    }
  })

  app.post(`${BORING_AUTOMATION_ROUTE_PREFIX}/automations/:id/run`, async (request, reply) => {
    try {
      const { id } = parseParams(IdParamsSchema, request.params)
      if (!opts.manualRunExecutor) {
        throw new AutomationStoreError(
          BORING_AUTOMATION_ERROR_CODES.RUN_EXECUTOR_UNAVAILABLE,
          "automation run executor is unavailable",
        )
      }
      const run = await opts.manualRunExecutor.run({ automationId: id, request })
      return reply.status(201).send({ ok: true, run })
    } catch (cause) {
      return sendError(reply, cause)
    }
  })

  app.get(`${BORING_AUTOMATION_ROUTE_PREFIX}/automations/:id/runs`, async (request, reply) => {
    try {
      const { id } = parseParams(IdParamsSchema, request.params)
      return { ok: true, runs: await opts.store.listRuns(id) }
    } catch (cause) {
      return sendError(reply, cause)
    }
  })
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
    return reply.status(httpStatusForStoreError(cause)).send({ ok: false, code: cause.code, error: cause.message })
  }
  throw cause
}

function httpStatusForStoreError(error: AutomationStoreError): number {
  switch (error.code) {
    case BORING_AUTOMATION_ERROR_CODES.INVALID_BODY:
    case BORING_AUTOMATION_ERROR_CODES.INVALID_MODEL:
      return 400
    case BORING_AUTOMATION_ERROR_CODES.AUTOMATION_NOT_FOUND:
    case BORING_AUTOMATION_ERROR_CODES.RUN_NOT_FOUND:
      return 404
    case BORING_AUTOMATION_ERROR_CODES.RUN_ALREADY_ACTIVE:
      return 409
    case BORING_AUTOMATION_ERROR_CODES.RUN_EXECUTOR_UNAVAILABLE:
      return 503
  }
}
