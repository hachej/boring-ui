import { z } from "zod"

export const HUMAN_ARTIFACT_LIMITS = {
  maxArtifactsPerRun: 100,
  maxSerializedMetadataBytes: 256 * 1024,
  maxIdLength: 128,
  maxSurfaceKindLength: 128,
  maxTargetLength: 2_048,
  maxTitleLength: 256,
  maxDescriptionLength: 2_048,
} as const

const boundedText = (max: number) => z.string().trim().min(1).max(max).refine(
  (value) => !/[\u0000-\u001f\u007f]/.test(value),
  "must not contain control characters",
)

export const HumanArtifactSchema = z.object({
  id: boundedText(HUMAN_ARTIFACT_LIMITS.maxIdLength),
  surfaceKind: boundedText(HUMAN_ARTIFACT_LIMITS.maxSurfaceKindLength),
  target: boundedText(HUMAN_ARTIFACT_LIMITS.maxTargetLength),
  title: boundedText(HUMAN_ARTIFACT_LIMITS.maxTitleLength),
  description: boundedText(HUMAN_ARTIFACT_LIMITS.maxDescriptionLength).optional(),
}).strict()

export type HumanArtifact = z.infer<typeof HumanArtifactSchema>

export const HumanArtifactListSchema = z.array(HumanArtifactSchema)
  .max(HUMAN_ARTIFACT_LIMITS.maxArtifactsPerRun)
  .superRefine((artifacts, context) => {
    const ids = new Set<string>()
    for (const [index, artifact] of artifacts.entries()) {
      if (ids.has(artifact.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate artifact id: ${artifact.id}`,
          path: [index, "id"],
        })
      }
      ids.add(artifact.id)
    }
    const bytes = new TextEncoder().encode(JSON.stringify(artifacts)).byteLength
    if (bytes > HUMAN_ARTIFACT_LIMITS.maxSerializedMetadataBytes) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `artifact metadata exceeds ${HUMAN_ARTIFACT_LIMITS.maxSerializedMetadataBytes} bytes`,
      })
    }
  })
