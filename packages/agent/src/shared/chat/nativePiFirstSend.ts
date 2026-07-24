import { z } from 'zod'
import type { NativeSessionSummary } from '../session'
import { ChatErrorSchema, PromptPayloadSchema, PromptReceiptSchema } from './piChatSchemas'

export const NativeSessionStartSchema = z.object({
  idempotencyKey: z.string().min(1).max(128),
  retry: z.boolean(),
}).strict()

export type NativeSessionStart = z.infer<typeof NativeSessionStartSchema>

// Decode receipts from rolling upgrades too: older servers omitted the native
// summary adornments and source marker, but still identified the transcript.
const NativeReceiptSessionSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  turnCount: z.number(),
  nativeSessionId: z.string().min(1).optional(),
  hasAssistantReply: z.boolean().optional(),
})

const NativePromptReceiptFields = {
  nativeSessionId: z.string().min(1),
  sessionSource: z.enum(['durable', 'optimistic']).default('optimistic'),
  session: NativeReceiptSessionSchema,
}

function validateNativeSessionIdentity(
  receipt: { nativeSessionId: string; session: z.infer<typeof NativeReceiptSessionSchema> },
  context: z.RefinementCtx,
): void {
  if (receipt.session.id !== receipt.nativeSessionId || (receipt.session.nativeSessionId !== undefined && receipt.session.nativeSessionId !== receipt.nativeSessionId)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'native session receipt identity mismatch' })
  }
}

function canonicalizeNativeReceipt<T extends {
  nativeSessionId: string
  session: z.infer<typeof NativeReceiptSessionSchema>
}>(receipt: T): Omit<T, 'session'> & { session: NativeSessionSummary } {
  return {
    ...receipt,
    session: {
      ...receipt.session,
      nativeSessionId: receipt.session.nativeSessionId ?? receipt.nativeSessionId,
      hasAssistantReply: receipt.session.hasAssistantReply ?? false,
    },
  }
}

const NativePromptAcceptedReceiptSchema = PromptReceiptSchema.extend({
  firstSendState: z.literal('native_persisted'),
  ...NativePromptReceiptFields,
}).superRefine(validateNativeSessionIdentity).transform(canonicalizeNativeReceipt)

const NativePromptFailedReceiptSchema = z.object({
  accepted: z.literal(false),
  cursor: z.number().int().nonnegative(),
  clientNonce: z.string().min(1),
  firstSendState: z.literal('prompt_failed'),
  error: ChatErrorSchema.extend({ retryable: z.literal(true) }),
  ...NativePromptReceiptFields,
}).superRefine(validateNativeSessionIdentity).transform(canonicalizeNativeReceipt)

/** The only wire schema for browser-local Pi first-send outcomes. */
export const PromptNewSessionReceiptSchema = z.union([
  NativePromptAcceptedReceiptSchema,
  NativePromptFailedReceiptSchema,
])

export interface NativeSessionReceipt {
  session: NativeSessionSummary
  sessionSource: 'durable' | 'optimistic'
}
export type NativePromptFailedReceipt = z.infer<typeof NativePromptFailedReceiptSchema>
export type PromptNewSessionReceipt = z.infer<typeof PromptNewSessionReceiptSchema>
export const NativePromptRequestSchema = PromptPayloadSchema.extend({
  nativeSessionStart: NativeSessionStartSchema,
}).strict()
