// @vitest-environment node

import { describe, expect, test } from "vitest"
import type { BoringTaskDetail } from "../shared"
import { TASK_DETAIL_LIMITS, TaskDetailValidationError, validateTaskDetail } from "./taskDtoValidation"

function detail(overrides: Partial<BoringTaskDetail> = {}): BoringTaskDetail {
  return {
    task: { id: "b1", number: "b1", title: "Bead", description: "Preview", statusId: "open", adapterId: "beads" },
    body: "Body",
    acceptanceCriteria: "Accepted when done",
    notes: "Notes",
    metadata: [{ id: "priority", label: "Priority", value: "P1" }],
    relations: [{ id: "root", title: "Root", nativeType: "parent-child", direction: "parent" }],
    ...overrides,
  }
}

describe("task detail DTO bounds", () => {
  test("accepts the exact generic detail shape", () => {
    expect(validateTaskDetail(detail())).toMatchObject({ task: { id: "b1" }, metadata: [{ id: "priority" }] })
  })

  test.each([
    ["title", detail({ task: { ...detail().task, title: "x".repeat(TASK_DETAIL_LIMITS.title + 1) } })],
    ["preview", detail({ task: { ...detail().task, description: "x".repeat(TASK_DETAIL_LIMITS.preview + 1) } })],
    ["section", detail({ body: "x".repeat(TASK_DETAIL_LIMITS.section + 1) })],
    ["metadata count", detail({ metadata: Array.from({ length: TASK_DETAIL_LIMITS.metadataCount + 1 }, (_, id) => ({ id: String(id), label: "L", value: "V" })) })],
    ["metadata value", detail({ metadata: [{ id: "m", label: "L", value: "x".repeat(TASK_DETAIL_LIMITS.metadataValue + 1) }] })],
    ["relation count", detail({ relations: Array.from({ length: TASK_DETAIL_LIMITS.relationCount + 1 }, (_, id) => ({ id: String(id), direction: "related" as const })) })],
    ["pull request title", detail({ task: { ...detail().task, pullRequests: [{ id: "1", number: "1", title: "x".repeat(TASK_DETAIL_LIMITS.title + 1) }] } })],
  ])("rejects over-limit %s", (_label, candidate) => {
    expect(() => validateTaskDetail(candidate)).toThrow(TaskDetailValidationError)
  })

  test("projects the exact DTO while sorting and deduplicating relations", () => {
    const candidate = {
      ...detail(),
      ignoredTopLevel: "/private/path",
      task: { ...detail().task, ignoredCardField: "secret" },
      relations: [
        { id: "z", title: "Related", nativeType: "related", direction: "related" as const, ignored: true },
        { id: "p", title: "Parent", nativeType: "parent-child", direction: "parent" as const },
        { id: "z", title: "Duplicate", nativeType: "related", direction: "related" as const },
        { id: "a", title: "Blocked", direction: "blocked-by" as const },
      ],
    } as BoringTaskDetail

    const projected = validateTaskDetail(candidate)

    expect(projected.relations.map(({ direction, id }) => `${direction}:${id}`)).toEqual([
      "blocked-by:a",
      "parent:p",
      "related:z",
    ])
    expect(projected.relations[2]?.title).toBe("Related")
    expect(projected).not.toHaveProperty("ignoredTopLevel")
    expect(projected.task).not.toHaveProperty("ignoredCardField")
    expect(projected.relations[2]).not.toHaveProperty("ignored")
  })

  test("rejects an invalid relation direction", () => {
    const candidate = detail({ relations: [{ id: "b2", direction: "sideways" as never }] })
    expect(() => validateTaskDetail(candidate)).toThrow("direction is invalid")
  })

  test("enforces the decoded total response limit", () => {
    const section = "x".repeat(TASK_DETAIL_LIMITS.section)
    const relations = Array.from({ length: TASK_DETAIL_LIMITS.relationCount }, (_, index) => ({
      id: String(index),
      title: "x".repeat(TASK_DETAIL_LIMITS.title),
      direction: "related" as const,
    }))
    expect(() => validateTaskDetail(detail({ body: section, acceptanceCriteria: section, notes: section, relations })))
      .toThrow("total byte limit")
  })
})
