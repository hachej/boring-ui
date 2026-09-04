import {
  WorkspaceBridgeErrorCode,
  createWorkspaceBridgeError,
  defineTrustedDomainBridgeHandler,
  type TrustedDomainBridgeHandlerRegistration,
  type WorkspaceBridgeCallContext,
  type WorkspaceBridgeHandler,
  type WorkspaceBridgeHandlerContribution,
} from "@hachej/boring-workspace/server"
import { HUMAN_ARTIFACT_LIMITS } from "@hachej/boring-workspace/shared"
import {
  ASK_USER_PLUGIN_ID,
  ASK_USER_BRIDGE_CAPABILITIES,
  ASK_USER_ANSWERED_PAGE_LIMIT,
  ASK_USER_BRIDGE_OPS,
  type AskUserBridgeAnswerInput,
  type AskUserBridgeCancelInput,
  type AskUserAnsweredSummary,
  type AskUserBridgeAnsweredAllInput,
  type AskUserBridgeAnsweredAllOutput,
  type AskUserBridgePendingAllInput,
  type AskUserBridgePendingAllOutput,
  type AskUserBridgePendingInput,
  type AskUserBridgePendingOutput,
  type AskUserPendingSummary,
  type AskUserBridgeRequestInput,
  type AskUserBridgeRequestOutput,
  type AskUserBridgeTranscriptInput,
  type AskUserBridgeTranscriptOutput,
} from "../shared"
import { ASK_USER_ERROR_CODES } from "../shared/error-codes"
import type { AskUserAnswer, AskUserQuestion, AskUserTranscriptEvent } from "../shared/types"
import { AskUserRuntime, AskUserRuntimeError } from "./askUserRuntime"
import { AskUserStoreError, type AskUserResolvedQuestion, type AskUserStore } from "./askUserStore"
import { QuestionsBridge, QuestionsBridgeError } from "./questionsBridge"

export interface AskUserBridgeHandlersOptions {
  runtime: AskUserRuntime
  store: AskUserStore
}

const MAX_QUESTION_BYTES = HUMAN_ARTIFACT_LIMITS.maxSerializedMetadataBytes + 64 * 1024
const MAX_TRANSCRIPT_BYTES = 256 * 1024
const REQUEST_TIMEOUT_MS = 10 * 60_000
const MUTATION_TIMEOUT_MS = 30_000
const READ_TIMEOUT_MS = 10_000

export function createAskUserBridgeHandlers(
  options: AskUserBridgeHandlersOptions,
): WorkspaceBridgeHandlerContribution[] {
  return [
    contribution(defineTrustedDomainBridgeHandler<AskUserBridgeRequestInput, AskUserBridgeRequestOutput>({
      op: ASK_USER_BRIDGE_OPS.request,
      version: 1,
      owner: ASK_USER_PLUGIN_ID,
      callerClassesAllowed: ["runtime", "server"],
      requiredCapabilities: [ASK_USER_BRIDGE_CAPABILITIES.request],
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      timeoutMs: REQUEST_TIMEOUT_MS,
      maxInputBytes: MAX_QUESTION_BYTES,
      maxOutputBytes: MAX_QUESTION_BYTES,
      idempotencyPolicy: "request-id",
      handler: requestHandler(options),
    })),
    contribution(defineTrustedDomainBridgeHandler<AskUserBridgeAnswerInput, { ok: true; status: string }>({
      op: ASK_USER_BRIDGE_OPS.answer,
      version: 1,
      owner: ASK_USER_PLUGIN_ID,
      callerClassesAllowed: ["browser", "server"],
      requiredCapabilities: [ASK_USER_BRIDGE_CAPABILITIES.answer],
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      timeoutMs: MUTATION_TIMEOUT_MS,
      maxInputBytes: MAX_QUESTION_BYTES,
      maxOutputBytes: 1024,
      idempotencyPolicy: "required",
      handler: answerHandler(options),
    })),
    contribution(defineTrustedDomainBridgeHandler<AskUserBridgeCancelInput, { ok: true; status: string }>({
      op: ASK_USER_BRIDGE_OPS.cancel,
      version: 1,
      owner: ASK_USER_PLUGIN_ID,
      callerClassesAllowed: ["browser", "server"],
      requiredCapabilities: [ASK_USER_BRIDGE_CAPABILITIES.cancel],
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      timeoutMs: MUTATION_TIMEOUT_MS,
      maxInputBytes: MAX_QUESTION_BYTES,
      maxOutputBytes: 1024,
      idempotencyPolicy: "required",
      handler: cancelHandler(options),
    })),
    contribution(defineTrustedDomainBridgeHandler<AskUserBridgePendingInput, AskUserBridgePendingOutput>({
      op: ASK_USER_BRIDGE_OPS.pending,
      version: 1,
      owner: ASK_USER_PLUGIN_ID,
      callerClassesAllowed: ["browser", "server"],
      requiredCapabilities: [ASK_USER_BRIDGE_CAPABILITIES.pending],
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      timeoutMs: READ_TIMEOUT_MS,
      maxInputBytes: 1024,
      maxOutputBytes: MAX_QUESTION_BYTES,
      idempotencyPolicy: "none",
      handler: pendingHandler(options),
    })),
    contribution(defineTrustedDomainBridgeHandler<AskUserBridgePendingAllInput, AskUserBridgePendingAllOutput>({
      op: ASK_USER_BRIDGE_OPS.pendingAll,
      version: 1,
      owner: ASK_USER_PLUGIN_ID,
      callerClassesAllowed: ["browser", "server"],
      requiredCapabilities: [ASK_USER_BRIDGE_CAPABILITIES.pendingAll],
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      timeoutMs: READ_TIMEOUT_MS,
      maxInputBytes: 1024,
      maxOutputBytes: MAX_QUESTION_BYTES,
      idempotencyPolicy: "none",
      handler: pendingAllHandler(options),
    })),
    contribution(defineTrustedDomainBridgeHandler<AskUserBridgeAnsweredAllInput, AskUserBridgeAnsweredAllOutput>({
      op: ASK_USER_BRIDGE_OPS.answeredAll,
      version: 1,
      owner: ASK_USER_PLUGIN_ID,
      callerClassesAllowed: ["browser", "server"],
      requiredCapabilities: [ASK_USER_BRIDGE_CAPABILITIES.answeredAll],
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      timeoutMs: READ_TIMEOUT_MS,
      maxInputBytes: 1024,
      maxOutputBytes: MAX_QUESTION_BYTES,
      idempotencyPolicy: "none",
      handler: answeredAllHandler(options),
    })),
    contribution(defineTrustedDomainBridgeHandler<AskUserBridgeTranscriptInput, AskUserBridgeTranscriptOutput>({
      op: ASK_USER_BRIDGE_OPS.transcript,
      version: 1,
      owner: ASK_USER_PLUGIN_ID,
      callerClassesAllowed: ["server"],
      requiredCapabilities: [ASK_USER_BRIDGE_CAPABILITIES.transcriptRead],
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      timeoutMs: READ_TIMEOUT_MS,
      maxInputBytes: 1024,
      maxOutputBytes: MAX_TRANSCRIPT_BYTES,
      idempotencyPolicy: "none",
      handler: transcriptHandler(options),
    })),
  ]
}

function contribution<TInput, TOutput>(
  entry: TrustedDomainBridgeHandlerRegistration<TInput, TOutput>,
): WorkspaceBridgeHandlerContribution {
  return {
    definition: entry.definition,
    handler: entry.handler as WorkspaceBridgeHandler,
  }
}

function requestHandler({ runtime }: AskUserBridgeHandlersOptions) {
  return async ({ input, context, signal }: { input: AskUserBridgeRequestInput; context: WorkspaceBridgeCallContext; signal: AbortSignal }) => {
    assertRequestInput(input)
    assertRequestSessionScope(input.sessionId, context)
    try {
      return await runtime.ask({
        sessionId: input.sessionId,
        title: input.title,
        context: input.context,
        schema: input.schema,
        artifacts: input.artifacts,
        timeoutMs: input.timeoutMs,
        ownerPrincipalId: ownerPrincipalIdFromRuntimeContext(context),
      }, signal)
    } catch (error) {
      throw mapAskUserError(error)
    }
  }
}

function answerHandler(options: AskUserBridgeHandlersOptions) {
  return async ({ input, context }: { input: AskUserBridgeAnswerInput; context: WorkspaceBridgeCallContext }) => {
    assertAnswerInput(input)
    assertBrowserSessionScope(input.sessionId, context)
    return await runQuestionsBridge(options, context, {
      kind: "questions.submit",
      params: {
        questionId: input.questionId,
        sessionId: input.sessionId,
        answerToken: input.answerToken,
        values: input.values,
      },
    })
  }
}

function cancelHandler(options: AskUserBridgeHandlersOptions) {
  return async ({ input, context }: { input: AskUserBridgeCancelInput; context: WorkspaceBridgeCallContext }) => {
    assertCancelInput(input)
    assertBrowserSessionScope(input.sessionId, context)
    return await runQuestionsBridge(options, context, {
      kind: "questions.cancel",
      params: {
        questionId: input.questionId,
        sessionId: input.sessionId,
        answerToken: input.answerToken,
      },
    })
  }
}

function pendingHandler({ store }: AskUserBridgeHandlersOptions) {
  return async ({ input, context }: { input: AskUserBridgePendingInput; context: WorkspaceBridgeCallContext }): Promise<AskUserBridgePendingOutput> => {
    if (!input || typeof input.sessionId !== "string" || input.sessionId.length === 0) {
      throw invalid("ask-user pending requires sessionId")
    }
    assertBrowserSessionScope(input.sessionId, context)
    try {
      const pending = await store.getPending(input.sessionId)
      assertQuestionOwner(context, pending)
      return { pending }
    } catch (error) {
      throw mapAskUserError(error)
    }
  }
}

/** Workspace-wide pending list backing the Inbox. Deliberately not session
 * scoped: a question raised by a background agent session (an Orchestrator, a
 * Worker) is still the owner's to answer, and scoping this read to the browser
 * chat session is what made those questions invisible. Ownership is still
 * enforced per question, and answer tokens are never returned here. */
function pendingAllHandler({ store }: AskUserBridgeHandlersOptions) {
  return async ({ context }: { context: WorkspaceBridgeCallContext }): Promise<AskUserBridgePendingAllOutput> => {
    try {
      const pending = await store.listPending()
      return { pending: pending.filter((question) => isVisibleToCaller(context, question)).map(toPendingSummary) }
    } catch (error) {
      throw mapAskUserError(error)
    }
  }
}

function isVisibleToCaller(context: WorkspaceBridgeCallContext, question: AskUserQuestion): boolean {
  if (context.callerClass !== "browser") return true
  if (question.ownerPrincipalId === "anonymous") return true
  return context.actor.performedBy?.id === question.ownerPrincipalId
}

function toPendingSummary(question: AskUserQuestion): AskUserPendingSummary {
  return {
    questionId: question.questionId,
    sessionId: question.sessionId,
    ...(question.toolCallId ? { toolCallId: question.toolCallId } : {}),
    status: question.status,
    ...(question.title ? { title: question.title } : {}),
    ...(question.context ? { context: question.context } : {}),
    artifacts: question.artifacts ?? [],
    createdAt: question.createdAt,
    updatedAt: question.updatedAt,
  }
}

/** Workspace-wide answered history backing the Inbox's Answered tab. Like
 * `pending-all` this is deliberately not session scoped — the owner's decision
 * log spans every agent session — and it never returns answer tokens. */
function answeredAllHandler({ store }: AskUserBridgeHandlersOptions) {
  return async ({ input, context }: { input: AskUserBridgeAnsweredAllInput; context: WorkspaceBridgeCallContext }): Promise<AskUserBridgeAnsweredAllOutput> => {
    const limit = answeredPageLimit(input?.limit)
    try {
      const resolved = await store.listResolved()
      const ordered = resolved
        .filter((entry) => isVisibleToCaller(context, entry.question))
        .map(toAnsweredSummary)
        .sort(compareAnsweredNewestFirst)
      const start = input?.cursor ? cursorOffset(ordered, input.cursor) : 0
      const page = ordered.slice(start, start + limit)
      const next = ordered[start + limit]
      return {
        answered: page,
        ...(next ? { nextCursor: encodeAnsweredCursor(next) } : {}),
      }
    } catch (error) {
      throw mapAskUserError(error)
    }
  }
}

function answeredPageLimit(limit: unknown): number {
  if (limit === undefined) return ASK_USER_ANSWERED_PAGE_LIMIT.default
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit <= 0) throw invalid("ask-user answered-all limit must be a positive integer")
  return Math.min(limit, ASK_USER_ANSWERED_PAGE_LIMIT.max)
}

/** Keyset cursor over the (answeredAt, questionId) sort key, so a page boundary
 * survives new answers landing while the owner reads the list. */
function encodeAnsweredCursor(summary: AskUserAnsweredSummary): string {
  return `${summary.answeredAt}|${summary.questionId}`
}

function cursorOffset(ordered: AskUserAnsweredSummary[], cursor: string): number {
  const index = ordered.findIndex((entry) => encodeAnsweredCursor(entry) === cursor)
  if (index === -1) throw invalid("ask-user answered-all cursor is no longer valid")
  return index
}

function compareAnsweredNewestFirst(left: AskUserAnsweredSummary, right: AskUserAnsweredSummary): number {
  const byTime = Date.parse(right.answeredAt) - Date.parse(left.answeredAt)
  if (byTime !== 0 && Number.isFinite(byTime)) return byTime
  return left.questionId.localeCompare(right.questionId)
}

function toAnsweredSummary({ question, answer }: AskUserResolvedQuestion): AskUserAnsweredSummary {
  const contextFirstLine = firstLine(question.context)
  return {
    questionId: question.questionId,
    sessionId: question.sessionId,
    title: question.title ?? "Question",
    ...(contextFirstLine ? { contextFirstLine } : {}),
    askedAt: question.createdAt,
    answeredAt: answer?.submittedAt ?? question.updatedAt,
    ...(decisionValue(question, answer) ? { decision: decisionValue(question, answer)! } : {}),
    values: answer?.values ?? {},
    status: question.status === "answered" || question.status === "cancelled" ? question.status : "abandoned",
  }
}

function firstLine(context: string | undefined): string | undefined {
  const line = context?.split("\n").map((part) => part.trim()).find((part) => part.length > 0)
  return line || undefined
}

/** The verdict is whatever the owner picked in the question's first single-choice
 * field; free-text-only questions have no decision, only notes. */
function decisionValue(question: AskUserQuestion, answer: AskUserAnswer | null): string | undefined {
  if (!answer) return undefined
  const field = question.schema?.fields.find((candidate) => candidate.type === "radio" || candidate.type === "select")
  const value = field ? answer.values[field.name] : undefined
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function transcriptHandler({ store }: AskUserBridgeHandlersOptions) {
  return async ({ input }: { input: AskUserBridgeTranscriptInput }): Promise<AskUserBridgeTranscriptOutput> => {
    if (!input || typeof input.sessionId !== "string" || input.sessionId.length === 0) {
      throw invalid("ask-user transcript requires sessionId")
    }
    try {
      return { events: await store.listTranscriptEvents(input.sessionId) as AskUserTranscriptEvent[] }
    } catch (error) {
      throw mapAskUserError(error)
    }
  }
}

async function runQuestionsBridge(
  { runtime, store }: AskUserBridgeHandlersOptions,
  context: WorkspaceBridgeCallContext,
  command: Parameters<QuestionsBridge["handle"]>[0],
): Promise<{ ok: true; status: string }> {
  const auth = commandAuthSessionId(command.params.sessionId, context)
  const bridge = new QuestionsBridge({
    runtime,
    store,
    getAuthContext: () => auth,
  })
  try {
    return await bridge.handle(command)
  } catch (error) {
    throw mapAskUserError(error)
  }
}

function assertRequestInput(input: AskUserBridgeRequestInput): void {
  if (!input || typeof input !== "object") throw invalid("ask-user request input is required")
  if (typeof input.sessionId !== "string" || input.sessionId.length === 0) throw invalid("ask-user request requires sessionId")
  if (!input.schema || typeof input.schema !== "object") throw invalid("ask-user request requires schema")
  if (input.title !== undefined && typeof input.title !== "string") throw invalid("ask-user request title must be a string")
  if (input.context !== undefined && typeof input.context !== "string") throw invalid("ask-user request context must be a string")
  if (input.timeoutMs !== undefined && (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0)) throw invalid("ask-user request timeoutMs must be positive")
}

function assertAnswerInput(input: AskUserBridgeAnswerInput): void {
  assertMutationBase(input, "answer")
  if (!input.values || typeof input.values !== "object" || Array.isArray(input.values)) throw invalid("ask-user answer requires values")
}

function assertCancelInput(input: AskUserBridgeCancelInput): void {
  assertMutationBase(input, "cancel")
}

function assertMutationBase(input: { questionId?: string; sessionId?: string; answerToken?: string }, op: string): void {
  if (!input || typeof input !== "object") throw invalid(`ask-user ${op} input is required`)
  if (typeof input.questionId !== "string" || input.questionId.length === 0) throw invalid(`ask-user ${op} requires questionId`)
  if (typeof input.sessionId !== "string" || input.sessionId.length === 0) throw invalid(`ask-user ${op} requires sessionId`)
  if (typeof input.answerToken !== "string" || input.answerToken.length === 0) throw invalid(`ask-user ${op} requires answerToken`)
}

function assertBrowserSessionScope(sessionId: string, context: WorkspaceBridgeCallContext): void {
  if (context.callerClass !== "browser") return
  if (context.sessionId && context.sessionId === sessionId) return
  throw createWorkspaceBridgeError(
    WorkspaceBridgeErrorCode.ResourceScopeDenied,
    "ask-user session does not match browser bridge context",
  )
}

function assertRequestSessionScope(sessionId: string, context: WorkspaceBridgeCallContext): void {
  if (context.callerClass !== "runtime") return
  if (context.sessionId && context.sessionId === sessionId) return
  throw createWorkspaceBridgeError(
    WorkspaceBridgeErrorCode.ResourceScopeDenied,
    "ask-user request session does not match runtime bridge context",
  )
}

function assertQuestionOwner(context: WorkspaceBridgeCallContext, question: AskUserQuestion | null): void {
  if (!question || context.callerClass !== "browser") return
  if (question.ownerPrincipalId === "anonymous") return
  const principalId = context.actor.performedBy?.id
  if (!principalId || principalId !== question.ownerPrincipalId) {
    throw createWorkspaceBridgeError(
      WorkspaceBridgeErrorCode.ResourceScopeDenied,
      "ask-user question is not owned by this browser principal",
    )
  }
}

function commandAuthSessionId(sessionId: string, context: WorkspaceBridgeCallContext): { sessionId: string; principalId: string } {
  if (context.callerClass !== "browser") {
    return { sessionId, principalId: principalIdFromContext(context) }
  }
  assertBrowserSessionScope(sessionId, context)
  return { sessionId: context.sessionId!, principalId: principalIdFromContext(context) }
}

function principalIdFromContext(context: WorkspaceBridgeCallContext): string {
  return context.actor.performedBy?.id ?? context.actor.onBehalfOf?.id ?? "anonymous"
}

function ownerPrincipalIdFromRuntimeContext(context: WorkspaceBridgeCallContext): string | undefined {
  // Runtime token `performedBy.id` is the runtime id, not a human principal.
  // Only trusted `onBehalfOf.id` may stamp ownership; otherwise preserve the
  // main/no-auth behavior where answerToken + session scope is the mutation
  // guard for anonymous questions.
  return context.actor.onBehalfOf?.id
}

function mapAskUserError(error: unknown): never {
  if (error instanceof QuestionsBridgeError) {
    const code = error.statusCode === 403
      ? WorkspaceBridgeErrorCode.ResourceScopeDenied
      : WorkspaceBridgeErrorCode.InvalidRequest
    throw createWorkspaceBridgeError(code, error.message, { askUserCode: error.code })
  }
  if (error instanceof AskUserRuntimeError || error instanceof AskUserStoreError) {
    const code = error.code === ASK_USER_ERROR_CODES.RATE_LIMITED
      ? WorkspaceBridgeErrorCode.CapabilityDenied
      : WorkspaceBridgeErrorCode.InvalidRequest
    throw createWorkspaceBridgeError(code, error.message, { askUserCode: error.code })
  }
  throw error
}

function invalid(message: string): never {
  throw createWorkspaceBridgeError(WorkspaceBridgeErrorCode.InvalidRequest, message)
}
