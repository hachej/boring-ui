import { describe, expect, test } from "vitest"
import { CliVersionBadge, chatSessionIdFromCliUrl, cliWorkspacePath, workspaceIdFromCliUrl } from "../front/App"

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

  test("builds navigable workspace paths without a session query", () => {
    expect(cliWorkspacePath("project-123")).toBe("/workspace/project-123")
    expect(cliWorkspacePath("project name")).toBe("/workspace/project%20name")
  })

  test("reads a legacy chat session id from the workspace URL query", () => {
    // Read-only back-compat: legacy deep links still carry ?session=, which we
    // honor once on load (then strip). The path builder above never writes it.
    expect(chatSessionIdFromCliUrl("?session=chat-abc")).toBe("chat-abc")
    expect(chatSessionIdFromCliUrl("?session=")).toBeNull()
    expect(chatSessionIdFromCliUrl("")).toBeNull()
  })
})
