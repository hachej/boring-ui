import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { QuestionsCommandSchema } from "../shared/schema"
import type { QuestionsCommand } from "../shared/types"
import { QuestionsBridge, QuestionsBridgeError, constantTimeEqual, type QuestionsAuthContext } from "./questionsBridge"
import type { AskUserRuntime } from "./askUserRuntime"
import type { AskUserStore } from "./askUserStore"

export type QuestionsRoutesOptions = {
  store: AskUserStore
  runtime: AskUserRuntime
  getAuthContext?: (request: FastifyRequest) => QuestionsAuthContext | Promise<QuestionsAuthContext>
  allowedOrigins?: string[]
  csrfHeaderName?: string
  csrfToken?: string | ((request: FastifyRequest) => string | undefined | Promise<string | undefined>)
}

export function questionsRoutes(app: FastifyInstance, opts: QuestionsRoutesOptions, done: (err?: Error) => void): void {
  registerQuestionsReadRoutes(app, opts)

  app.post("/api/v1/questions/commands", async (request, reply) => {
    if (!passesOrigin(request, opts.allowedOrigins)) return reply.code(403).send({ error: "forbidden", message: "invalid origin" })
    if (!(await passesCsrf(request, opts))) return reply.code(403).send({ error: "forbidden", message: "invalid csrf token" })

    const parsed = QuestionsCommandSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: "validation_error", message: parsed.error.issues[0]?.message ?? "invalid command" })
    }

    const bridge = new QuestionsBridge({
      store: opts.store,
      runtime: opts.runtime,
      getAuthContext: opts.getAuthContext ? () => opts.getAuthContext!(request) : undefined,
    })

    try {
      return await bridge.handle(parsed.data as QuestionsCommand)
    } catch (error) {
      return sendError(reply, error)
    }
  })

  done()
}

export function registerQuestionsReadRoutes(
  app: FastifyInstance,
  opts: Pick<QuestionsRoutesOptions, "store" | "getAuthContext" | "allowedOrigins">,
): void {
  app.get("/api/v1/questions", async (request, reply) => {
    if (!passesOrigin(request, opts.allowedOrigins)) return reply.code(403).send({ error: "forbidden", message: "invalid origin" })
    const query = request.query as { status?: unknown }
    if (query.status !== "ready") return reply.code(400).send({ error: "validation_error", message: "status must be ready" })
    const auth = await opts.getAuthContext?.(request)
    reply.header("Cache-Control", "no-store")
    const questions = (await opts.store.listPending()).filter((question) => (
      question.status === "ready"
      && (!auth || question.ownerPrincipalId === "anonymous" || question.ownerPrincipalId === auth.principalId)
    ))
    return { questions }
  })

  app.get("/api/v1/questions/events", async (request, reply) => {
    if (!passesOrigin(request, opts.allowedOrigins)) return reply.code(403).send({ error: "forbidden", message: "invalid origin" })
    await opts.getAuthContext?.(request)
    reply.hijack()
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    })
    reply.raw.write("event: ready\ndata: {}\n\n")
    const unsubscribe = opts.store.subscribe(() => {
      if (!reply.raw.destroyed) reply.raw.write("event: questions-changed\ndata: {}\n\n")
    })
    request.raw.once("close", unsubscribe)
  })
}

function passesOrigin(request: FastifyRequest, allowedOrigins?: string[]): boolean {
  if (!allowedOrigins || allowedOrigins.length === 0) return true
  const origin = request.headers.origin
  return typeof origin === "string" && allowedOrigins.includes(origin)
}

async function passesCsrf(request: FastifyRequest, opts: QuestionsRoutesOptions): Promise<boolean> {
  if (!opts.csrfToken) return true
  const headerName = (opts.csrfHeaderName ?? "x-csrf-token").toLowerCase()
  const actual = request.headers[headerName]
  const expected = typeof opts.csrfToken === "function" ? await opts.csrfToken(request) : opts.csrfToken
  return typeof actual === "string" && typeof expected === "string" && constantTimeEqual(expected, actual)
}

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof QuestionsBridgeError) {
    return reply.code(error.statusCode).send({ error: error.code, message: error.message })
  }
  throw error
}
