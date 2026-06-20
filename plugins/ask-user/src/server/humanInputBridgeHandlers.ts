import {
  WorkspaceBridgeErrorCode,
  createWorkspaceBridgeError,
  defineTrustedDomainBridgeHandler,
  type TrustedDomainBridgeHandlerRegistration,
  type WorkspaceBridgeCallContext,
  type WorkspaceBridgeHandler,
  type WorkspaceBridgeHandlerContribution,
} from "@hachej/boring-workspace/server"
import {
  ASK_USER_PLUGIN_ID,
  HUMAN_INPUT_CAPABILITIES,
  HUMAN_INPUT_OPS,
  type HumanInputAnswerInput,
  type HumanInputCancelInput,
  type HumanInputPendingInput,
  type HumanInputPendingOutput,
  type HumanInputRequestInput,
  type HumanInputRequestOutput,
  type HumanInputTranscriptInput,
  type HumanInputTranscriptOutput,
} from "../shared"
import { ASK_USER_ERROR_CODES } from "../shared/error-codes"
import type { AskUserQuestion, AskUserTranscriptEvent } from "../shared/types"
import { AskUserRuntime, AskUserRuntimeError } from "./askUserRuntime"
import { AskUserStoreError, type AskUserStore } from "./askUserStore"
import { QuestionsBridge, QuestionsBridgeError } from "./questionsBridge"

export interface AskUserHumanInputBridgeHandlersOptions {
  runtime: AskUserRuntime
  store: AskUserStore
}

const MAX_QUESTION_BYTES = 64 * 1024
const MAX_TRANSCRIPT_BYTES = 256 * 1024
const REQUEST_TIMEOUT_MS = 10 * 60_000
const MUTATION_TIMEOUT_MS = 30_000
const READ_TIMEOUT_MS = 10_000

export function createAskUserHumanInputBridgeHandlers(
  options: AskUserHumanInputBridgeHandlersOptions,
): WorkspaceBridgeHandlerContribution[] {
  return [
    contribution(defineTrustedDomainBridgeHandler<HumanInputRequestInput, HumanInputRequestOutput>({
      op: HUMAN_INPUT_OPS.request,
      version: 1,
      owner: ASK_USER_PLUGIN_ID,
      callerClassesAllowed: ["runtime", "server"],
      requiredCapabilities: [HUMAN_INPUT_CAPABILITIES.request],
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      timeoutMs: REQUEST_TIMEOUT_MS,
      maxInputBytes: MAX_QUESTION_BYTES,
      maxOutputBytes: MAX_QUESTION_BYTES,
      idempotencyPolicy: "request-id",
      handler: requestHandler(options),
    })),
    contribution(defineTrustedDomainBridgeHandler<HumanInputAnswerInput, { ok: true; status: string }>({
      op: HUMAN_INPUT_OPS.answer,
      version: 1,
      owner: ASK_USER_PLUGIN_ID,
      callerClassesAllowed: ["browser", "server"],
      requiredCapabilities: [HUMAN_INPUT_CAPABILITIES.answer],
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      timeoutMs: MUTATION_TIMEOUT_MS,
      maxInputBytes: MAX_QUESTION_BYTES,
      maxOutputBytes: 1024,
      idempotencyPolicy: "required",
      handler: answerHandler(options),
    })),
    contribution(defineTrustedDomainBridgeHandler<HumanInputCancelInput, { ok: true; status: string }>({
      op: HUMAN_INPUT_OPS.cancel,
      version: 1,
      owner: ASK_USER_PLUGIN_ID,
      callerClassesAllowed: ["browser", "server"],
      requiredCapabilities: [HUMAN_INPUT_CAPABILITIES.cancel],
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      timeoutMs: MUTATION_TIMEOUT_MS,
      maxInputBytes: MAX_QUESTION_BYTES,
      maxOutputBytes: 1024,
      idempotencyPolicy: "required",
      handler: cancelHandler(options),
    })),
    contribution(defineTrustedDomainBridgeHandler<HumanInputPendingInput, HumanInputPendingOutput>({
      op: HUMAN_INPUT_OPS.pending,
      version: 1,
      owner: ASK_USER_PLUGIN_ID,
      callerClassesAllowed: ["browser", "server"],
      requiredCapabilities: [HUMAN_INPUT_CAPABILITIES.pending],
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      timeoutMs: READ_TIMEOUT_MS,
      maxInputBytes: 1024,
      maxOutputBytes: MAX_QUESTION_BYTES,
      idempotencyPolicy: "none",
      handler: pendingHandler(options),
    })),
    contribution(defineTrustedDomainBridgeHandler<HumanInputTranscriptInput, HumanInputTranscriptOutput>({
      op: HUMAN_INPUT_OPS.transcript,
      version: 1,
      owner: ASK_USER_PLUGIN_ID,
      callerClassesAllowed: ["server"],
      requiredCapabilities: [HUMAN_INPUT_CAPABILITIES.transcriptRead],
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

function requestHandler({ runtime }: AskUserHumanInputBridgeHandlersOptions) {
  return async ({ input, context, signal }: { input: HumanInputRequestInput; context: WorkspaceBridgeCallContext; signal: AbortSignal }) => {
    assertRequestInput(input)
    assertRequestSessionScope(input.sessionId, context)
    try {
      return await runtime.ask({
        sessionId: input.sessionId,
        title: input.title,
        context: input.context,
        schema: input.schema,
        timeoutMs: input.timeoutMs,
        ownerPrincipalId: ownerPrincipalIdFromRuntimeContext(context),
      }, signal)
    } catch (error) {
      throw mapAskUserError(error)
    }
  }
}

function answerHandler(options: AskUserHumanInputBridgeHandlersOptions) {
  return async ({ input, context }: { input: HumanInputAnswerInput; context: WorkspaceBridgeCallContext }) => {
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

function cancelHandler(options: AskUserHumanInputBridgeHandlersOptions) {
  return async ({ input, context }: { input: HumanInputCancelInput; context: WorkspaceBridgeCallContext }) => {
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

function pendingHandler({ store }: AskUserHumanInputBridgeHandlersOptions) {
  return async ({ input, context }: { input: HumanInputPendingInput; context: WorkspaceBridgeCallContext }): Promise<HumanInputPendingOutput> => {
    if (!input || typeof input.sessionId !== "string" || input.sessionId.length === 0) {
      throw invalid("human-input pending requires sessionId")
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

function transcriptHandler({ store }: AskUserHumanInputBridgeHandlersOptions) {
  return async ({ input }: { input: HumanInputTranscriptInput }): Promise<HumanInputTranscriptOutput> => {
    if (!input || typeof input.sessionId !== "string" || input.sessionId.length === 0) {
      throw invalid("human-input transcript requires sessionId")
    }
    try {
      return { events: await store.listTranscriptEvents(input.sessionId) as AskUserTranscriptEvent[] }
    } catch (error) {
      throw mapAskUserError(error)
    }
  }
}

async function runQuestionsBridge(
  { runtime, store }: AskUserHumanInputBridgeHandlersOptions,
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

function assertRequestInput(input: HumanInputRequestInput): void {
  if (!input || typeof input !== "object") throw invalid("human-input request input is required")
  if (typeof input.sessionId !== "string" || input.sessionId.length === 0) throw invalid("human-input request requires sessionId")
  if (!input.schema || typeof input.schema !== "object") throw invalid("human-input request requires schema")
  if (input.title !== undefined && typeof input.title !== "string") throw invalid("human-input request title must be a string")
  if (input.context !== undefined && typeof input.context !== "string") throw invalid("human-input request context must be a string")
  if (input.timeoutMs !== undefined && (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0)) throw invalid("human-input request timeoutMs must be positive")
}

function assertAnswerInput(input: HumanInputAnswerInput): void {
  assertMutationBase(input, "answer")
  if (!input.values || typeof input.values !== "object" || Array.isArray(input.values)) throw invalid("human-input answer requires values")
}

function assertCancelInput(input: HumanInputCancelInput): void {
  assertMutationBase(input, "cancel")
}

function assertMutationBase(input: { questionId?: string; sessionId?: string; answerToken?: string }, op: string): void {
  if (!input || typeof input !== "object") throw invalid(`human-input ${op} input is required`)
  if (typeof input.questionId !== "string" || input.questionId.length === 0) throw invalid(`human-input ${op} requires questionId`)
  if (typeof input.sessionId !== "string" || input.sessionId.length === 0) throw invalid(`human-input ${op} requires sessionId`)
  if (typeof input.answerToken !== "string" || input.answerToken.length === 0) throw invalid(`human-input ${op} requires answerToken`)
}

function assertBrowserSessionScope(sessionId: string, context: WorkspaceBridgeCallContext): void {
  if (context.callerClass !== "browser") return
  if (context.sessionId && context.sessionId === sessionId) return
  throw createWorkspaceBridgeError(
    WorkspaceBridgeErrorCode.ResourceScopeDenied,
    "human-input session does not match browser bridge context",
  )
}

function assertRequestSessionScope(sessionId: string, context: WorkspaceBridgeCallContext): void {
  if (context.callerClass !== "runtime") return
  if (context.sessionId && context.sessionId === sessionId) return
  throw createWorkspaceBridgeError(
    WorkspaceBridgeErrorCode.ResourceScopeDenied,
    "human-input request session does not match runtime bridge context",
  )
}

function assertQuestionOwner(context: WorkspaceBridgeCallContext, question: AskUserQuestion | null): void {
  if (!question || context.callerClass !== "browser") return
  if (question.ownerPrincipalId === "anonymous") return
  const principalId = context.actor.performedBy?.id
  if (!principalId || principalId !== question.ownerPrincipalId) {
    throw createWorkspaceBridgeError(
      WorkspaceBridgeErrorCode.ResourceScopeDenied,
      "human-input question is not owned by this browser principal",
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
