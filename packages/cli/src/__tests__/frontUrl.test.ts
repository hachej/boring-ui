import { describe, expect, test } from "vitest"
import { cliWorkspacePath, workspaceIdFromCliUrl } from "../front/App"

describe("CLI workspace URLs", () => {
  test("reads workspace id from /workspace/:id paths", () => {
    expect(workspaceIdFromCliUrl("/workspace/project-123")).toBe("project-123")
    expect(workspaceIdFromCliUrl("/workspace/project%20name")).toBe("project name")
    expect(workspaceIdFromCliUrl("/")).toBeNull()
  })

  test("builds navigable workspace paths", () => {
    expect(cliWorkspacePath("project-123")).toBe("/workspace/project-123")
    expect(cliWorkspacePath("project name")).toBe("/workspace/project%20name")
  })
})
