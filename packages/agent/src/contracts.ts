import type { ConversationId, TaskId } from '@earendil-works/pi-durable';

/** Host services keep their own APIs. Native defineTool/ToolRegistration,
 * ToolExecutionApi and ToolExecutionResult are the tool contract; no parallel
 * Boring HostOperation, RuntimeSchema or reduced execution-result envelope.
 */
export interface RuntimeQuestionRef {
  readonly runtimeId: string;
  readonly conversationId: ConversationId;
  readonly taskId: TaskId;
  readonly questionId: string;
  readonly scopeId: string;
  readonly subjectDigest: string;
  readonly policyVersion: string;
  readonly expiresAt: string;
}

export interface QuestionResolution<Answer> {
  readonly question: RuntimeQuestionRef;
  readonly resolutionId: string;
  readonly answer: Answer;
}

/** References to native tasks, never a second job model. Preserve result type. */
export interface DeliveryBinding<Result = unknown> {
  readonly producer: TaskId<Result>;
  readonly delivery: TaskId;
  readonly operationId: string;
  readonly inputDigest: string;
  readonly recoverableInputRef: string;
}
