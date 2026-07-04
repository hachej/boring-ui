import { describe, expect, it } from "vitest"
import { captureFrontPlugin } from "@hachej/boring-workspace/plugin"
import tasksPlugin from "./index"

describe("tasksPlugin", () => {
  it("contributes the Tasks app-left action", () => {
    const captured = captureFrontPlugin(tasksPlugin)

    expect(captured.registrations.appLeftActions).toHaveLength(1)
    expect(captured.registrations.appLeftActions[0]?.id).toBe("tasks")
    expect(captured.registrations.appLeftActions[0]?.label).toBe("Tasks")
    expect(captured.registrations.appLeftActions[0]?.overlay).toBeTypeOf("function")
  })
})
