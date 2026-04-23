import { z } from "zod"

const panelIdSchema = z
  .string()
  .max(64)
  .regex(/^[a-zA-Z0-9_-]+$/)

const boundedString = z.string().max(1024)

const dimensionSchema = z.number().nonnegative()

const sidebarSchema = z.object({
  collapsed: z.boolean(),
  width: z.number().int().positive(),
})

const panelSizesSchema = z.record(panelIdSchema, dimensionSchema)

const dockviewGridSchema = z.object({
  root: z.unknown(),
  width: z.number().nonnegative().optional(),
  height: z.number().nonnegative().optional(),
  orientation: z.number().optional(),
}).passthrough()

const dockviewPanelSchema = z.object({
  id: boundedString,
  contentComponent: boundedString.optional(),
  title: boundedString.optional(),
}).passthrough()

const dockviewLayoutSchema = z
  .object({
    grid: dockviewGridSchema,
    panels: z.record(boundedString, dockviewPanelSchema),
  })
  .passthrough()
  .nullable()

const layoutPartitionSchema = z.object({
  layout: dockviewLayoutSchema,
  sidebar: sidebarSchema,
  panelSizes: panelSizesSchema,
})

const preferencesPartitionSchema = z.object({
  theme: z.enum(["light", "dark"]),
})

export function validateLayoutPartition(
  data: unknown
): z.infer<typeof layoutPartitionSchema> | null {
  const result = layoutPartitionSchema.safeParse(data)
  if (!result.success) {
    console.error("Layout validation failed:", result.error.issues)
    return null
  }
  return result.data
}

export function validatePreferencesPartition(
  data: unknown
): z.infer<typeof preferencesPartitionSchema> | null {
  const result = preferencesPartitionSchema.safeParse(data)
  if (!result.success) {
    console.error("Preferences validation failed:", result.error.issues)
    return null
  }
  return result.data
}
