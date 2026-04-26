import { z } from 'zod'

export const createWorkspaceBody = z
  .object({
    name: z.string().min(1, 'Name is required').max(100, 'Name must be 100 characters or fewer'),
  })
  .strict()

export const updateWorkspaceBody = z
  .object({
    name: z.string().min(1, 'Name is required').max(100, 'Name must be 100 characters or fewer').optional(),
  })
  .strict()
