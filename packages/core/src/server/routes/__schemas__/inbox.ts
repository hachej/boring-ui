import { z } from 'zod'

const actionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  tone: z.enum(['primary', 'neutral', 'danger']).optional(),
})

const artifactSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('surface'), surfaceKind: z.string().min(1), target: z.string().optional(), params: z.record(z.string(), z.unknown()).optional() }),
  z.object({ type: z.literal('panel'), panelComponentId: z.string().min(1), params: z.record(z.string(), z.unknown()).optional() }),
])

export const createInboxItemBody = z.object({
  kind: z.enum(['question', 'review', 'approval', 'notice']),
  title: z.string().min(1).max(240),
  description: z.string().max(10_000).default(''),
  source: z.discriminatedUnion('type', [
    z.object({ type: z.literal('external-hook'), externalId: z.string().min(1), label: z.string().min(1) }),
    z.object({ type: z.literal('review'), reviewId: z.string().min(1), label: z.string().min(1) }),
  ]),
  sessionId: z.string().min(1).nullable().optional(),
  targetLabel: z.string().max(240).optional(),
  artifact: artifactSchema.nullable().optional(),
  priority: z.number().int().min(-1000).max(1000).optional(),
  actions: z.array(actionSchema).max(10).optional(),
}).strict()

export const listInboxItemsQuery = z.object({
  status: z.enum(['open', 'resolved', 'dismissed', 'all']).optional(),
  kind: z.enum(['question', 'review', 'approval', 'notice']).optional(),
})

export const patchInboxItemBody = z.object({
  status: z.enum(['open', 'resolved', 'dismissed']),
}).strict()

export const patchInboxViewStateBody = z.object({
  pinned: z.boolean().optional(),
}).strict()
