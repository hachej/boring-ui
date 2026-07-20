import { z } from 'zod'
import { ErrorCode } from '../error-codes'
import type { ToolUiMetadata } from '../tool-ui'
import type { BoringChatMessage, BoringChatPart } from './boringChatMessage'
import type { ChatError } from './chatError'
import type {
  PromptPayload,
  FollowUpPayload,
  QueueClearPayload,
  InterruptPayload,
  StopPayload,
  CommandReceipt,
  FollowUpReceipt,
  QueueClearReceipt,
  StopReceipt,
} from './piChatCommand'
import type { PiChatEvent, PiChatStreamFrame } from './piChatEvent'
import type { PiChatSnapshot, QueuedUserMessage } from './piChatSnapshot'
import type { ChatAttachmentPayload, ChatModelSelection } from './chatSubmitPayload'

const nonEmptyString = z.string().min(1)
const seqNumber = z.number().int().nonnegative()

const ShallowPayloadSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.unknown()),
  z.record(z.unknown()),
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export const ToolUiMetadataSchema = z.object({
  rendererId: z.string().optional(),
  displayGroup: z.string().optional(),
  icon: z.string().optional(),
  details: z.unknown().optional(),
}) satisfies z.ZodType<ToolUiMetadata>

export function sanitizeToolUiMetadata(value: unknown): ToolUiMetadata | undefined {
  if (!isRecord(value)) return undefined
  const parsed = ToolUiMetadataSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

const OptionalToolUiMetadataSchema: z.ZodType<ToolUiMetadata | undefined, z.ZodTypeDef, unknown> = z.preprocess(
  (value) => sanitizeToolUiMetadata(value),
  ToolUiMetadataSchema.optional(),
)

export const ChatErrorSchema = z.object({
  code: ErrorCode,
  message: nonEmptyString,
  retryable: z.boolean().optional(),
  details: z.unknown().optional(),
}) satisfies z.ZodType<ChatError>

export const BoringChatPartSchema: z.ZodType<BoringChatPart, z.ZodTypeDef, unknown> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), id: z.string().optional(), text: z.string() }),
  z.object({
    type: z.literal('reasoning'),
    id: nonEmptyString,
    text: z.string(),
    state: z.enum(['streaming', 'done']).optional(),
  }),
  z.object({
    type: z.literal('tool-call'),
    id: nonEmptyString,
    toolName: nonEmptyString,
    input: z.unknown().optional(),
    state: z.enum(['input-streaming', 'input-available', 'output-available', 'output-error', 'aborted']),
    output: z.unknown().optional(),
    errorText: z.string().optional(),
    ui: OptionalToolUiMetadataSchema,
  }),
  z.object({
    type: z.literal('file'),
    id: z.string().optional(),
    filename: z.string().optional(),
    mediaType: z.string().optional(),
    url: z.string().optional(),
    path: z.string().optional(),
    filesystem: z.string().optional(),
  }),
  z.object({
    type: z.literal('notice'),
    id: z.string().optional(),
    level: z.enum(['info', 'warning', 'error']),
    text: z.string(),
  }),
])

export const BoringChatMessageSchema = z.object({
  id: nonEmptyString,
  role: z.enum(['user', 'assistant', 'system']),
  status: z.enum(['pending', 'streaming', 'done', 'aborted', 'error']).optional(),
  parts: z.array(BoringChatPartSchema),
  createdAt: z.string().optional(),
  clientNonce: z.string().optional(),
  clientSeq: z.number().int().nonnegative().optional(),
  piEntryId: z.string().optional(),
  turnId: z.string().optional(),
  runTerminalState: z.enum(['success', 'error', 'aborted', 'interrupted']).optional(),
}) satisfies z.ZodType<BoringChatMessage, z.ZodTypeDef, unknown>

export const QueuedUserMessageSchema = z.object({
  id: nonEmptyString,
  kind: z.literal('followup'),
  clientNonce: z.string().optional(),
  clientSeq: z.number().int().nonnegative().optional(),
  displayText: z.string(),
  createdAt: z.string().optional(),
}) satisfies z.ZodType<QueuedUserMessage>

export const PiChatStatusSchema = z.enum(['idle', 'hydrating', 'submitted', 'streaming', 'aborting', 'error'])

export const PiChatSnapshotSchema = z.object({
  protocolVersion: z.literal(1),
  sessionId: nonEmptyString,
  seq: seqNumber,
  status: PiChatStatusSchema,
  activeTurnId: z.string().optional(),
  messages: z.array(BoringChatMessageSchema),
  queue: z.object({ followUps: z.array(QueuedUserMessageSchema) }),
  followUpMode: z.literal('one-at-a-time'),
  error: ChatErrorSchema.optional(),
}) satisfies z.ZodType<PiChatSnapshot, z.ZodTypeDef, unknown>

const baseEvent = z.object({ seq: seqNumber })

export const PiChatEventSchema = z.discriminatedUnion('type', [
  baseEvent.extend({ type: z.literal('agent-start'), turnId: nonEmptyString }),
  baseEvent.extend({ type: z.literal('agent-end'), turnId: nonEmptyString, status: z.enum(['ok', 'aborted', 'error']), willRetry: z.boolean().optional() }),
  baseEvent.extend({
    type: z.literal('message-start'),
    messageId: nonEmptyString,
    role: z.enum(['user', 'assistant']),
    clientNonce: z.string().optional(),
    clientSeq: z.number().int().nonnegative().optional(),
    createdAt: z.string().optional(),
    text: z.string().optional(),
    files: z.array(BoringChatPartSchema).optional(),
  }),
  baseEvent.extend({
    type: z.literal('message-delta'),
    messageId: nonEmptyString,
    partId: nonEmptyString,
    kind: z.enum(['text', 'reasoning']),
    delta: z.string(),
  }),
  baseEvent.extend({
    type: z.literal('message-part-end'),
    messageId: nonEmptyString,
    partId: nonEmptyString,
    kind: z.enum(['text', 'reasoning']),
    text: z.string(),
  }),
  baseEvent.extend({ type: z.literal('message-end'), messageId: nonEmptyString, final: BoringChatMessageSchema }),
  baseEvent.extend({
    type: z.literal('tool-call'),
    messageId: nonEmptyString,
    toolCallId: nonEmptyString,
    toolName: nonEmptyString,
    input: ShallowPayloadSchema,
    ui: OptionalToolUiMetadataSchema,
  }),
  baseEvent.extend({
    type: z.literal('tool-result'),
    messageId: nonEmptyString,
    toolCallId: nonEmptyString,
    output: ShallowPayloadSchema,
    isError: z.boolean().optional(),
    errorText: z.string().optional(),
    ui: OptionalToolUiMetadataSchema,
  }),
  baseEvent.extend({ type: z.literal('queue-updated'), queue: z.object({ followUps: z.array(QueuedUserMessageSchema) }) }),
  baseEvent.extend({
    type: z.literal('followup-consumed'),
    clientNonce: z.string().optional(),
    clientSeq: z.number().int().nonnegative().optional(),
    messageId: nonEmptyString,
  }),
  baseEvent.extend({ type: z.literal('file-changed'), path: nonEmptyString, changeType: nonEmptyString }),
  baseEvent.extend({ type: z.literal('ui-command'), command: ShallowPayloadSchema, displayOnly: z.literal(true) }),
  baseEvent.extend({ type: z.literal('usage'), usage: ShallowPayloadSchema }),
  baseEvent.extend({
    type: z.literal('auto-retry-start'),
    attempt: z.number().int().nonnegative(),
    maxAttempts: z.number().int().nonnegative(),
    delayMs: z.number().int().nonnegative(),
    errorMessage: z.string(),
  }),
  baseEvent.extend({
    type: z.literal('auto-retry-end'),
    success: z.boolean(),
    attempt: z.number().int().nonnegative(),
    finalError: z.string().optional(),
  }),
  baseEvent.extend({ type: z.literal('error'), turnId: z.string().optional(), retryable: z.boolean().optional(), error: ChatErrorSchema }),
]) satisfies z.ZodType<PiChatEvent, z.ZodTypeDef, unknown>

export const PiChatHeartbeatFrameSchema = z.object({ type: z.literal('heartbeat'), now: z.string() })

export const PiChatStreamFrameSchema = z.union([PiChatEventSchema, PiChatHeartbeatFrameSchema]) satisfies z.ZodType<PiChatStreamFrame, z.ZodTypeDef, unknown>

export const ChatModelSelectionSchema = z.object({
  provider: nonEmptyString,
  id: nonEmptyString,
}) satisfies z.ZodType<ChatModelSelection>

export const ThinkingLevelSchema = z.enum(['off', 'low', 'medium', 'high'])

export const ChatAttachmentPayloadSchema = z.object({
  filename: z.string().optional(),
  mediaType: z.string().optional(),
  url: nonEmptyString,
  path: z.string().optional(),
}) satisfies z.ZodType<ChatAttachmentPayload>

export const PromptPayloadSchema = z.object({
  message: z.string().min(1).max(1_000_000),
  displayMessage: z.string().min(1).max(1_000_000).optional(),
  clientNonce: nonEmptyString.max(128),
  model: ChatModelSelectionSchema.optional(),
  thinkingLevel: ThinkingLevelSchema.optional(),
  attachments: z.array(ChatAttachmentPayloadSchema).max(20).optional(),
}) satisfies z.ZodType<PromptPayload>

export const FollowUpPayloadSchema = z.object({
  message: z.string().min(1).max(1_000_000),
  displayMessage: z.string().min(1).max(1_000_000).optional(),
  clientNonce: nonEmptyString.max(128),
  clientSeq: z.number().int().nonnegative(),
}) satisfies z.ZodType<FollowUpPayload>

export const QueueClearPayloadSchema = z.preprocess(
  (value) => value ?? {},
  z.object({
    clientNonce: nonEmptyString.max(128).optional(),
    clientSeq: z.number().int().nonnegative().optional(),
  }).strict(),
) satisfies z.ZodType<QueueClearPayload, z.ZodTypeDef, unknown>

export const InterruptPayloadSchema = z.object({}).strict() satisfies z.ZodType<InterruptPayload>

export const StopPayloadSchema = z.object({}).strict() satisfies z.ZodType<StopPayload>

export const CommandReceiptSchema = z.object({
  accepted: z.literal(true),
  cursor: seqNumber,
}) satisfies z.ZodType<CommandReceipt>

export const PromptReceiptSchema = CommandReceiptSchema.extend({
  clientNonce: nonEmptyString,
  duplicate: z.boolean().optional(),
})

export const FollowUpReceiptSchema = CommandReceiptSchema.extend({
  clientNonce: nonEmptyString,
  clientSeq: z.number().int().nonnegative(),
  queued: z.literal(true),
  duplicate: z.boolean().optional(),
}) satisfies z.ZodType<FollowUpReceipt>

export const QueueClearReceiptSchema = CommandReceiptSchema.extend({
  cleared: z.number().int().nonnegative(),
}) satisfies z.ZodType<QueueClearReceipt>

export const StopReceiptSchema = CommandReceiptSchema.extend({
  stopped: z.boolean(),
  clearedQueue: z.array(QueuedUserMessageSchema),
}) satisfies z.ZodType<StopReceipt>
