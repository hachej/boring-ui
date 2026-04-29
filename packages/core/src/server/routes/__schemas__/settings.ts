import { z } from 'zod'

export const putSettingsBody = z
  .record(
    z.string().min(1, 'Key must be at least 1 character').max(128, 'Key must be 128 characters or fewer'),
    z.string().min(1, 'Value must not be empty').max(10_000, 'Value must be 10000 characters or fewer'),
  )
  .refine((obj) => Object.keys(obj).length > 0, { message: 'At least one setting is required' })
  .refine((obj) => Object.keys(obj).length <= 50, { message: 'Maximum 50 settings per request' })
