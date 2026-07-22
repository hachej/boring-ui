import { describe, expect, it } from "vitest"
import { createManageHandoverTool } from "../createManageHandoverTool"
import { HANDOVER_ERROR_CODES } from "../../shared/error-codes"

const artifact = (id: string, title = id) => ({ id, surfaceKind: "workspace.open.path", target: `docs/${id}.md`, title })
const result = (operations: unknown[]) => ({
  detail: { kind: "boring.handover.operations", wireVersion: 1, operations },
})

describe("manage_handover tool", () => {
  it("exposes exactly the strict non-blocking actions and sequential execution", () => {
    const tool = createManageHandoverTool()
    expect(tool.name).toBe("manage_handover")
    expect(tool.executionMode).toBe("sequential")
    expect(tool.parameters).toMatchObject({ type: "object", oneOf: expect.any(Array) })
  })

  it("returns canonical upsert and remove operations without server persistence", async () => {
    const tool = createManageHandoverTool()
    const upsert = await tool.execute({ action: "upsert", artifact: artifact("plan", "Plan") }, [])
    expect(upsert.isError).toBeUndefined()
    expect(upsert).toMatchObject({
      details: { kind: "boring.handover.operation", wireVersion: 1, operation: { action: "upsert", artifact: artifact("plan", "Plan") } },
    })
    const remove = await tool.execute({ action: "remove", artifactId: "plan" }, [result([{ action: "upsert", artifact: artifact("plan") }])])
    expect(remove.details).toMatchObject({ operation: { action: "remove", artifactId: "plan" } })
  })

  it("lists the exact ordered current-run registry from structured native transcript details", async () => {
    const tool = createManageHandoverTool()
    const entries = [result([
      { action: "upsert", artifact: artifact("a", "A") },
      { action: "upsert", artifact: artifact("b", "B") },
      { action: "upsert", artifact: artifact("a", "A updated") },
    ])]
    const listed = await tool.execute({ action: "list" }, entries)
    expect(listed.details).toEqual({ kind: "boring.handover.snapshot", wireVersion: 1, artifacts: [artifact("a", "A updated"), artifact("b", "B")] })
  })

  it("rejects unknown fields, missing trusted transcript context, and aggregate overflow", async () => {
    const tool = createManageHandoverTool()
    await expect(tool.execute({ action: "list", extra: true }, [])).resolves.toMatchObject({ isError: true, details: { code: HANDOVER_ERROR_CODES.INVALID_INPUT } })
    await expect(tool.execute({ action: "list" })).resolves.toMatchObject({ isError: true, details: { code: HANDOVER_ERROR_CODES.CONTEXT_UNAVAILABLE } })

    const full = Array.from({ length: 100 }, (_, index) => ({ action: "upsert" as const, artifact: artifact(String(index)) }))
    await expect(tool.execute({ action: "upsert", artifact: artifact("overflow") }, [result(full)])).resolves.toMatchObject({ isError: true, details: { code: HANDOVER_ERROR_CODES.INVALID_INPUT } })
  })
})
