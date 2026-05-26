import {
  WorkspaceBridgeErrorCode,
  createWorkspaceBridgeError,
  type BridgeActorAttribution,
  type WorkspaceBridgeOperationDefinition,
} from "../../shared/workspace-bridge-rpc"
import type { WorkspaceBridgeCallContext, WorkspaceBridgeHandler } from "../workspaceBridge/registry"
import type { PendingQuestionRuntime } from "./pendingQuestionRuntime"
import type { PendingQuestionCancelReason, PendingQuestionRecord, PendingQuestionStore } from "./pendingQuestionStore"

export const HUMAN_INPUT_OPS = {
  request: "human-input.v1.request",
  answer: "human-input.v1.answer",
  cancel: "human-input.v1.cancel",
  pending: "human-input.v1.pending",
  transcript: "human-input.v1.transcript",
} as const

export interface HumanInputBridgeHandlersOptions {
  runtime: PendingQuestionRuntime
  store: PendingQuestionStore
  resolveOwnerPrincipalId?: (
    sessionId: string,
    context: WorkspaceBridgeCallContext,
  ) => string | undefined | Promise<string | undefined>
}

export function createHumanInputBridgeHandlers(options: HumanInputBridgeHandlersOptions): Array<{
  definition: WorkspaceBridgeOperationDefinition
  handler: WorkspaceBridgeHandler
}> {
  return [
    { definition: definition(HUMAN_INPUT_OPS.request, ["runtime", "server"], ["human-input:request"], "request-id"), handler: requestHandler(options) },
    { definition: definition(HUMAN_INPUT_OPS.answer, ["browser", "server"], ["human-input:answer"], "none"), handler: answerHandler(options) },
    { definition: definition(HUMAN_INPUT_OPS.cancel, ["browser", "server"], ["human-input:cancel"], "none"), handler: cancelHandler(options) },
    { definition: definition(HUMAN_INPUT_OPS.pending, ["browser", "server"], ["human-input:pending"], "none"), handler: pendingHandler(options) },
    { definition: definition(HUMAN_INPUT_OPS.transcript, ["server"], ["human-input:transcript.read"], "none"), handler: transcriptHandler(options) },
  ]
}

function requestHandler({ runtime, resolveOwnerPrincipalId }: HumanInputBridgeHandlersOptions): WorkspaceBridgeHandler {
  return async ({ input, context, signal, emitUiEffect }) => {
    const body = input as { requestId?: string; sessionId?: string; toolCallId?: string; payload?: unknown; timeoutMs?: number }
    if (!body.requestId || !body.sessionId) throw invalid("human-input request requires requestId and sessionId")
    const ownerPrincipalId = context.actor.onBehalfOf?.id ?? await resolveOwnerPrincipalId?.(body.sessionId, context)
    const question = await runtime.createPending({
      requestId: body.requestId,
      sessionId: body.sessionId,
      toolCallId: body.toolCallId,
      actor: withOwnerPrincipalId(context.actor, ownerPrincipalId),
      payload: body.payload,
    })
    if (question.status === "pending") {
      await emitUiEffect?.({ kind: "openSurface", params: { kind: "human-input", target: question.questionId, meta: { question } } })
    }
    const timeout = question.status === "pending" && body.timeoutMs
      ? setTimeout(() => void runtime.cancel(question.questionId, "timeout"), body.timeoutMs)
      : undefined
    try {
      return await runtime.wait(question, signal)
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }
}

function answerHandler({ runtime, store }: HumanInputBridgeHandlersOptions): WorkspaceBridgeHandler {
  return async ({ input, context }) => {
    const body = input as { questionId?: string; sessionId?: string; nonce?: string; values?: unknown }
    const question = await requireQuestionForMutation(store, body, context)
    await runtime.answer(question.questionId, question.sessionId, body.nonce!, body.values)
    return { status: "answered", questionId: question.questionId, sessionId: question.sessionId }
  }
}

function cancelHandler({ runtime, store }: HumanInputBridgeHandlersOptions): WorkspaceBridgeHandler {
  return async ({ input, context }) => {
    const body = input as { questionId?: string; sessionId?: string; nonce?: string; reason?: PendingQuestionCancelReason }
    const question = await requireQuestionForMutation(store, body, context)
    await runtime.cancel(question.questionId, body.reason ?? "user_cancelled")
    return { status: "cancelled", questionId: question.questionId, sessionId: question.sessionId, reason: body.reason ?? "user_cancelled" }
  }
}

function pendingHandler({ store }: HumanInputBridgeHandlersOptions): WorkspaceBridgeHandler {
  return async ({ input, context }) => {
    const body = input as { sessionId?: string }
    if (!body.sessionId) throw invalid("human-input pending requires sessionId")
    const pending = await store.getPending(body.sessionId)
    assertQuestionOwner(context, pending)
    return { pending }
  }
}

function transcriptHandler({ store }: HumanInputBridgeHandlersOptions): WorkspaceBridgeHandler {
  return async ({ input }) => {
    const body = input as { sessionId?: string }
    if (!body.sessionId) throw invalid("human-input transcript requires sessionId")
    return { events: await store.listTranscriptEvents(body.sessionId) }
  }
}

async function requireQuestionForMutation(
  store: PendingQuestionStore,
  body: { questionId?: string; sessionId?: string; nonce?: string },
  context: WorkspaceBridgeCallContext,
) {
  if (!body.questionId || !body.sessionId || !body.nonce) throw invalid("human-input mutation requires questionId, sessionId, and nonce")
  const question = await store.getByQuestionId(body.questionId)
  if (!question || question.sessionId !== body.sessionId) throw invalid("human-input question/session mismatch")
  assertQuestionOwner(context, question)
  if (question.nonce !== body.nonce) throw invalid("human-input nonce mismatch")
  if (question.status !== "pending") throw invalid("human-input question is already finalized")
  return question
}

function definition(
  op: string,
  callerClassesAllowed: WorkspaceBridgeOperationDefinition["callerClassesAllowed"],
  requiredCapabilities: readonly string[],
  idempotencyPolicy: WorkspaceBridgeOperationDefinition["idempotencyPolicy"],
): WorkspaceBridgeOperationDefinition {
  return {
    op,
    version: 1,
    owner: "workspace-human-input",
    callerClassesAllowed,
    requiredCapabilities,
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    timeoutMs: 10 * 60_000,
    maxInputBytes: 64 * 1024,
    maxOutputBytes: 64 * 1024,
    idempotencyPolicy,
    auditCategory: "human-input",
  }
}

function assertQuestionOwner(
  context: WorkspaceBridgeCallContext,
  question: PendingQuestionRecord | null,
): void {
  if (!question?.ownerPrincipalId || context.callerClass !== "browser") return
  const principalId = context.actor.performedBy?.id
  if (!principalId || principalId !== question.ownerPrincipalId) {
    throw createWorkspaceBridgeError(
      WorkspaceBridgeErrorCode.ResourceScopeDenied,
      "human-input question is not owned by this browser principal",
    )
  }
}

function withOwnerPrincipalId(
  actor: BridgeActorAttribution,
  ownerPrincipalId: string | undefined,
): BridgeActorAttribution {
  if (!ownerPrincipalId) return actor
  return {
    ...actor,
    onBehalfOf: {
      label: actor.onBehalfOf?.label ?? `user:${ownerPrincipalId}`,
      id: ownerPrincipalId,
    },
  }
}

function invalid(message: string): never {
  throw createWorkspaceBridgeError(WorkspaceBridgeErrorCode.InvalidRequest, message)
}
