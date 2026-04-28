import { z } from 'zod'

export const createInviteBody = z
  .object({
    email: z.string().email('email must be a valid email address'),
    role: z.enum(['owner', 'editor', 'viewer']),
  })
  .strict()

export const acceptInviteQuery = z
  .object({
    invite_token: z.string().min(1, 'invite_token is required'),
  })
  .strict()

export const tokenBody = z
  .object({
    token: z.string().min(1, 'token is required'),
  })
  .strict()
