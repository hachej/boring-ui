import type { AskUserStore } from "./askUserStore"

export type ReadIntentionToolDefinition = {
  name: "read_intention"
  label: string
  description: string
  parameters: Record<string, unknown>
  execute(params: Record<string, unknown>, ownerPrincipalId?: string): Promise<{
    content: Array<{ type: "text"; text: string }>
    details?: unknown
    isError?: boolean
  }>
}

/** Poll a durable intention without creating an in-process waiter. */
export function createReadIntentionTool(store: AskUserStore): ReadIntentionToolDefinition {
  return {
    name: "read_intention",
    label: "Read intention",
    description: "Read one durable user intention by id, including answer values when answered.",
    parameters: {
      type: "object",
      properties: { questionId: { type: "string", minLength: 1 } },
      required: ["questionId"],
      additionalProperties: false,
    },
    async execute(params, ownerPrincipalId) {
      const questionId = typeof params.questionId === "string" ? params.questionId.trim() : ""
      if (!questionId) return error("questionId is required")
      const question = await store.getByQuestionId(questionId)
      if (!question) return error("intention was not found")
      if (question.ownerPrincipalId !== "anonymous" && question.ownerPrincipalId !== ownerPrincipalId) {
        return error("intention was not found")
      }
      const answer = question.status === "answered" ? await store.getAnswer(questionId) : null
      const details = {
        questionId,
        status: question.status,
        ...(answer ? { values: answer.values, submittedAt: answer.submittedAt } : {}),
      }
      return { content: [{ type: "text", text: JSON.stringify(details) }], details }
    },
  }
}

function error(message: string) {
  return { isError: true as const, content: [{ type: "text" as const, text: message }] }
}
