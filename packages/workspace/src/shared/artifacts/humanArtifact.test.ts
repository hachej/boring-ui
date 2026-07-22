import { describe, expect, it } from "vitest"
import { HUMAN_ARTIFACT_LIMITS, HumanArtifactListSchema, HumanArtifactSchema } from "./humanArtifact"

function artifact(id: string, description?: string) {
  return { id, surfaceKind: "file", target: `docs/${id}.md`, title: `Artifact ${id}`, ...(description ? { description } : {}) }
}

describe("HumanArtifact schemas", () => {
  it("accepts strict registered Workspace surface metadata", () => {
    expect(HumanArtifactSchema.parse(artifact("plan"))).toEqual(artifact("plan"))
    expect(() => HumanArtifactSchema.parse({ ...artifact("plan"), url: "https://example.com" })).toThrow()
    expect(() => HumanArtifactSchema.parse({ ...artifact("plan"), title: "bad\ncontrol" })).toThrow()
  })

  it("rejects duplicate IDs and more than the hard artifact cap", () => {
    expect(() => HumanArtifactListSchema.parse([artifact("same"), artifact("same")])).toThrow(/duplicate artifact id/)
    const tooMany = Array.from({ length: HUMAN_ARTIFACT_LIMITS.maxArtifactsPerRun + 1 }, (_, index) => artifact(String(index)))
    expect(() => HumanArtifactListSchema.parse(tooMany)).toThrow()
  })

  it("accepts 100 compact artifacts and rejects metadata above the byte budget", () => {
    const maximum = Array.from({ length: HUMAN_ARTIFACT_LIMITS.maxArtifactsPerRun }, (_, index) => artifact(String(index)))
    expect(HumanArtifactListSchema.parse(maximum)).toHaveLength(100)

    const oversized = Array.from({ length: 100 }, (_, index) => ({
      ...artifact(String(index), "x".repeat(HUMAN_ARTIFACT_LIMITS.maxDescriptionLength)),
      target: "x".repeat(HUMAN_ARTIFACT_LIMITS.maxTargetLength),
    }))
    expect(() => HumanArtifactListSchema.parse(oversized)).toThrow(/artifact metadata exceeds/)
  })
})
