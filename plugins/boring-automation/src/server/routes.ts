import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { ZodError, type ZodSchema } from "zod"
import {
  AutomationCreateSchema,
  AutomationPatchSchema,
  BORING_AUTOMATION_ERROR_CODES,
  BORING_AUTOMATION_ROUTE_PREFIX,
  IdParamsSchema,
  PromptUpdateSchema,
} from "../shared"
import type { HostedDueRunService } from "./hostedDueRunService"
import type { DueRunService } from "./dueRunService"
import { timingSafeEqual } from "node:crypto"
import { ManualRunExecutor } from "./manualRunExecutor"
import { AutomationStoreError, automationNotFound, type AutomationStore } from "./store"

export interface AutomationRoutesOptions {
  store: AutomationStore
  storeForRequest?: (request: FastifyRequest) => Promise<AutomationStore> | AutomationStore
  manualRunExecutor?: Pick<ManualRunExecutor, "run">
  manualRunExecutorForRequest?: (request: FastifyRequest) => Promise<Pick<ManualRunExecutor, "run">> | Pick<ManualRunExecutor, "run">
  dueRunService?: Pick<DueRunService, "runDue">
  dueRunServiceForRequest?: (request: FastifyRequest) => Promise<Pick<DueRunService, "runDue">> | Pick<DueRunService, "runDue">
  hostedDueRunService?: Pick<HostedDueRunService, "runDue">
  hostedTriggerToken?: string
}

export async function automationRoutes(app: FastifyInstance, opts: AutomationRoutesOptions): Promise<void> {
  app.get(`${BORING_AUTOMATION_ROUTE_PREFIX}/automations`, async (_request, reply) => {
    try {
      return { ok: true, automations: await (await resolveStore(opts, _request)).listAutomations() }
    } catch (cause) {
      return sendError(reply, cause)
    }
  })

  app.post(`${BORING_AUTOMATION_ROUTE_PREFIX}/automations`, async (request, reply) => {
    try {
      const automation = await (await resolveStore(opts, request)).createAutomation(parseBody(AutomationCreateSchema, request.body))
      return reply.status(201).send({ ok: true, automation })
    } catch (cause) {
      return sendError(reply, cause)
    }
  })

  app.get(`${BORING_AUTOMATION_ROUTE_PREFIX}/automations/:id`, async (request, reply) => {
    try {
      const { id } = parseParams(IdParamsSchema, request.params)
      const automation = await (await resolveStore(opts, request)).getAutomation(id)
      if (!automation) throw automationNotFound(id)
      return { ok: true, automation }
    } catch (cause) {
      return sendError(reply, cause)
    }
  })

  app.patch(`${BORING_AUTOMATION_ROUTE_PREFIX}/automations/:id`, async (request, reply) => {
    try {
      const { id } = parseParams(IdParamsSchema, request.params)
      const automation = await (await resolveStore(opts, request)).updateAutomation(id, parseBody(AutomationPatchSchema, request.body))
      return { ok: true, automation }
    } catch (cause) {
      return sendError(reply, cause)
    }
  })

  app.delete(`${BORING_AUTOMATION_ROUTE_PREFIX}/automations/:id`, async (request, reply) => {
    try {
      const { id } = parseParams(IdParamsSchema, request.params)
      await (await resolveStore(opts, request)).deleteAutomation(id)
      return reply.status(204).send()
    } catch (cause) {
      return sendError(reply, cause)
    }
  })

  app.get(`${BORING_AUTOMATION_ROUTE_PREFIX}/automations/:id/prompt`, async (request, reply) => {
    try {
      const { id } = parseParams(IdParamsSchema, request.params)
      const store = await resolveStore(opts, request)
      if (store.getPromptSnapshot) return { ok: true, ...await store.getPromptSnapshot(id) }
      const prompt = await store.getPrompt(id)
      const automation = await store.getAutomation(id)
      if (!automation) throw automationNotFound(id)
      return { ok: true, prompt, updatedAt: automation.updatedAt }
    } catch (cause) {
      return sendError(reply, cause)
    }
  })

  app.put(`${BORING_AUTOMATION_ROUTE_PREFIX}/automations/:id/prompt`, async (request, reply) => {
    try {
      const { id } = parseParams(IdParamsSchema, request.params)
      const { prompt, expectedUpdatedAt } = parseBody(PromptUpdateSchema, request.body)
      const store = await resolveStore(opts, request)
      let automation
      if (expectedUpdatedAt) {
        automation = await store.updatePromptIfCurrent(id, prompt, expectedUpdatedAt)
      } else {
        await store.updatePrompt(id, prompt)
        automation = await store.getAutomation(id)
      }
      if (!automation) throw automationNotFound(id)
      return { ok: true, automation }
    } catch (cause) {
      return sendError(reply, cause)
    }
  })

  app.post(`${BORING_AUTOMATION_ROUTE_PREFIX}/due/hosted`, async (request, reply) => {
    try {
      if (!opts.hostedDueRunService || !opts.hostedTriggerToken || !hasBearerToken(request.headers.authorization, opts.hostedTriggerToken)) {
        throw new AutomationStoreError(BORING_AUTOMATION_ERROR_CODES.TRIGGER_UNAUTHORIZED, "hosted automation trigger is unauthorized")
      }
      return { ok: true, ...(await opts.hostedDueRunService.runDue(request)) }
    } catch (cause) {
      return sendError(reply, cause)
    }
  })

  app.post(`${BORING_AUTOMATION_ROUTE_PREFIX}/due`, async (request, reply) => {
    try {
      if (!isLoopbackAddress(request.ip)) {
        throw new AutomationStoreError(
          BORING_AUTOMATION_ERROR_CODES.TRIGGER_FORBIDDEN,
          "automation due trigger is limited to loopback callers",
        )
      }
      const dueRunService = await opts.dueRunServiceForRequest?.(request) ?? opts.dueRunService
      if (!dueRunService) {
        throw new AutomationStoreError(
          BORING_AUTOMATION_ERROR_CODES.RUN_EXECUTOR_UNAVAILABLE,
          "automation due executor is unavailable",
        )
      }
      return { ok: true, ...(await dueRunService.runDue(request)) }
    } catch (cause) {
      return sendError(reply, cause)
    }
  })

  app.post(`${BORING_AUTOMATION_ROUTE_PREFIX}/automations/:id/run`, async (request, reply) => {
    try {
      const { id } = parseParams(IdParamsSchema, request.params)
      const manualRunExecutor = await opts.manualRunExecutorForRequest?.(request) ?? opts.manualRunExecutor
      if (!manualRunExecutor) {
        throw new AutomationStoreError(
          BORING_AUTOMATION_ERROR_CODES.RUN_EXECUTOR_UNAVAILABLE,
          "automation run executor is unavailable",
        )
      }
      const run = await manualRunExecutor.run({ automationId: id, request })
      return reply.status(201).send({ ok: true, run })
    } catch (cause) {
      return sendError(reply, cause)
    }
  })

  app.get(`${BORING_AUTOMATION_ROUTE_PREFIX}/automations/:id/runs`, async (request, reply) => {
    try {
      const { id } = parseParams(IdParamsSchema, request.params)
      return { ok: true, runs: await (await resolveStore(opts, request)).listRuns(id) }
    } catch (cause) {
      return sendError(reply, cause)
    }
  })
}

async function resolveStore(opts: AutomationRoutesOptions, request: FastifyRequest): Promise<AutomationStore> {
  return await opts.storeForRequest?.(request) ?? opts.store
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
    const issue = cause.issues[0]
    return reply.status(400).send({
      ok: false,
      code: zodIssueErrorCode(issue),
      error: issue?.message ?? "invalid request",
    })
  }
  if (cause instanceof AutomationStoreError) {
    return reply.status(httpStatusForStoreError(cause)).send({ ok: false, code: cause.code, error: cause.message })
  }
  throw cause
}

function zodIssueErrorCode(issue: ZodError["issues"][number] | undefined) {
  const field = issue?.path[0]
  if (field === "cron") return BORING_AUTOMATION_ERROR_CODES.INVALID_CRON
  if (field === "timezone") return BORING_AUTOMATION_ERROR_CODES.INVALID_TIMEZONE
  return BORING_AUTOMATION_ERROR_CODES.INVALID_BODY
}

function hasBearerToken(header: string | undefined, expected: string): boolean {
  if (!header?.startsWith("Bearer ")) return false
  const actual = Buffer.from(header.slice(7), "utf8")
  const target = Buffer.from(expected, "utf8")
  return actual.length === target.length && timingSafeEqual(actual, target)
}

function isLoopbackAddress(address: string): boolean {
  const normalized = address.trim().toLowerCase()
  return normalized === "127.0.0.1" || normalized === "::1" || normalized.startsWith("::ffff:127.")
}

function httpStatusForStoreError(error: AutomationStoreError): number {
  switch (error.code) {
    case BORING_AUTOMATION_ERROR_CODES.INVALID_BODY:
    case BORING_AUTOMATION_ERROR_CODES.INVALID_CRON:
    case BORING_AUTOMATION_ERROR_CODES.INVALID_TIMEZONE:
    case BORING_AUTOMATION_ERROR_CODES.INVALID_MODEL:
      return 400
    case BORING_AUTOMATION_ERROR_CODES.AUTOMATION_NOT_FOUND:
    case BORING_AUTOMATION_ERROR_CODES.RUN_NOT_FOUND:
      return 404
    case BORING_AUTOMATION_ERROR_CODES.PROMPT_CONFLICT:
    case BORING_AUTOMATION_ERROR_CODES.RUN_ALREADY_ACTIVE:
    case BORING_AUTOMATION_ERROR_CODES.RUN_ALREADY_RECORDED:
    case BORING_AUTOMATION_ERROR_CODES.TOOL_ABORTED:
      return 409
    case BORING_AUTOMATION_ERROR_CODES.TRIGGER_FORBIDDEN:
      return 403
    case BORING_AUTOMATION_ERROR_CODES.TRIGGER_UNAUTHORIZED:
      return 401
    case BORING_AUTOMATION_ERROR_CODES.OWNER_UNAUTHORIZED:
      return 403
    case BORING_AUTOMATION_ERROR_CODES.RUN_EXECUTOR_UNAVAILABLE:
    case BORING_AUTOMATION_ERROR_CODES.TOOL_CONTEXT_UNAVAILABLE:
      return 503
    case BORING_AUTOMATION_ERROR_CODES.OPERATION_FAILED:
      return 500
    case BORING_AUTOMATION_ERROR_CODES.RUN_FAILED:
      return 500
  }
}
