import { describe, expect, test } from "vitest"
import { CliVersionBadge, cliWorkspacePath, workspaceIdFromCliUrl } from "../front/App"

describe("CLI chrome", () => {
  test("renders a compact version badge when CLI meta has a version", () => {
    const badge = CliVersionBadge({ version: "0.1.16" })
    expect(badge).toBeTruthy()
    expect(badge && typeof badge === "object" && "props" in badge ? badge.props.children : null).toEqual(["v", "0.1.16"])
    expect(CliVersionBadge({ version: "" })).toBeNull()
  })

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
