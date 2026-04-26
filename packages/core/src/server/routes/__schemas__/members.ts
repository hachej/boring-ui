import { z } from 'zod'

export const addMemberBody = z
  .object({
    userId: z.string().uuid('userId must be a valid UUID'),
    role: z.enum(['owner', 'editor', 'viewer']),
  })
  .strict()
