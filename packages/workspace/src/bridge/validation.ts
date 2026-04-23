import { z } from "zod"

const PATH_MAX = 1024
const MSG_MAX = 500
const PANEL_ID_RE = /^[a-zA-Z0-9_-]+$/
const PANEL_ID_MAX = 64
const MAX_PANELS = 50
const PARAMS_MAX_BYTES = 16_384

const safePath = z
  .string()
  .min(1)
  .max(PATH_MAX)
  .refine((p) => !p.includes(".."), "path traversal not allowed")
  .refine((p) => !p.includes("\0"), "null bytes not allowed")

export const openFileSchema = z.object({
  path: safePath,
  mode: z.enum(["view", "edit", "diff"]).optional(),
})

export const openPanelSchema = z.object({
  id: z.string().max(PANEL_ID_MAX).regex(PANEL_ID_RE, "invalid panel ID"),
  component: z.string().min(1),
  params: z
    .record(z.unknown())
    .optional()
    .refine(
      (p) => {
        if (!p) return true
        try {
          const bytes = new TextEncoder().encode(JSON.stringify(p))
          return bytes.byteLength <= PARAMS_MAX_BYTES
        } catch {
          return false
        }
      },
      `params must be JSON-serializable and under ${PARAMS_MAX_BYTES} bytes`,
    ),
  title: z.string().max(200).optional(),
})

export const closePanelSchema = z.object({
  id: z.string().min(1),
})

export const notificationSchema = z.object({
  msg: z.string().max(MSG_MAX),
  level: z.enum(["info", "warn", "error"]).optional(),
})

export const navigateToLineSchema = z.object({
  file: safePath,
  line: z.number().int().positive(),
})

export const expandToFileSchema = z.object({
  path: safePath,
})

export { MAX_PANELS }
